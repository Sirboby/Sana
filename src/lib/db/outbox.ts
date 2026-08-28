import type { MutationOp, MutationTable } from '../schemas';
import { newId } from '../schemas';
import { type EncryptedField, decryptField, encryptField } from './crypto';

/**
 * The sync outbox (PRD §7.1).
 *
 * Written by repositories, never drained here — push is step 9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `row` IS ENCRYPTED
 * ─────────────────────────────────────────────────────────────────────────────
 * §7.2 sends the server a PLAINTEXT row, validated against the table's Zod
 * schema. The obvious implementation therefore queues the plaintext row and
 * pushes it verbatim — which would leave unencrypted medication names and event
 * payloads sitting in IndexedDB for as long as the device is offline, defeating
 * the whole of ./crypto.ts through the back door. An outbox that drains promptly
 * on a good connection is exactly the one that does NOT drain on the patchy
 * connection this app is built for.
 *
 * So the queued row is encrypted as a single field, and step 9 decrypts it at
 * push time, in memory, immediately before the request. The invariant holds:
 * no plaintext clinical data is ever at rest on the device.
 */

/**
 * Outbox lifecycle.
 *
 * The 'dead' state was added in step 9: a mutation that has failed
 * MAX_MUTATION_ATTEMPTS times stops retrying and is surfaced to the user
 * instead. Retrying forever would drain the battery and data of someone who
 * can see nothing wrong, and would hide a permanently-failing change behind an
 * indicator that always says "syncing".
 */
export type OutboxStatus = 'pending' | 'in_flight' | 'failed' | 'dead';

export type OutboxEntry = {
  /** Auto-incremented by Dexie; absent until the row is stored. */
  seq?: number;
  /** UUIDv7. The §7.2 idempotency key — a retried push must not apply twice. */
  mutation_id: string;
  table: MutationTable;
  op: MutationOp;
  /** Encrypted form of the plaintext row destined for §7.2. */
  row: EncryptedField;
  client_updated_at: string;
  /** Required by the §6.4 `created_at` index; drives FIFO drain order. */
  created_at: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
};

/**
 * Build an outbox entry.
 *
 * Deliberately does NOT touch the database: all crypto happens before a Dexie
 * transaction is opened, because awaiting a non-Dexie promise inside a
 * transaction takes the transaction out of Dexie's async zone and can commit it
 * early. The repositories rely on that ordering for their atomicity guarantee.
 */
export async function buildOutboxEntry(
  dataKey: CryptoKey,
  params: {
    table: MutationTable;
    op: MutationOp;
    /** The PLAINTEXT row §7.2 will receive. Encrypted before it is stored. */
    row: Record<string, unknown>;
    clientUpdatedAt: string;
  },
): Promise<OutboxEntry> {
  return {
    mutation_id: newId(),
    table: params.table,
    op: params.op,
    row: await encryptField(dataKey, params.row),
    client_updated_at: params.clientUpdatedAt,
    created_at: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    last_error: null,
  };
}

/**
 * Recover the plaintext row from a queued entry, for step 9's push.
 *
 * NEVER LOG THE RETURN VALUE. It is decrypted clinical content — a medication
 * row, an event payload. §11 forbids clinical payloads in error reports, so this
 * must not reach console, Sentry, or an exception message.
 */
export async function decryptOutboxRow(
  dataKey: CryptoKey,
  entry: OutboxEntry,
): Promise<Record<string, unknown>> {
  return decryptField<Record<string, unknown>>(dataKey, entry.row);
}
