import Dexie from 'dexie';
import { type ClinicalEvent, ClinicalEventSchema } from '../../schemas';
import { type EncryptedField, decryptField, encryptField } from '../crypto';
import { requireDataKey } from '../keyring';
import { buildOutboxEntry } from '../outbox';
import { db } from '../schema';
import { commitWrite } from './base';

/**
 * The clinical event log (PRD §6.1) — APPEND-ONLY.
 *
 * There is deliberately no `update`. §6.1 and the `events_no_mutation` RLS
 * policy both forbid mutating an event; the only legal change is setting a
 * tombstone. A mistake is corrected by appending a `correction` event that
 * points at the original, which preserves the fact that the first record existed
 * and was revised — the audit property the whole log is for.
 *
 * Only `payload` is encrypted. `event_type`, `person_id` and `occurred_at` back
 * the §6.4 indexes and stay plaintext.
 */

type Distributive<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type ClinicalEventDraft = Distributive<
  ClinicalEvent,
  'created_at' | 'recorded_at' | 'deleted_at'
>;

function nowIso(): string {
  return new Date().toISOString();
}

async function decryptEvent(
  dataKey: CryptoKey,
  stored: Record<string, unknown>,
): Promise<ClinicalEvent> {
  // Decrypted clinical content — a symptom report, a triage outcome, a note.
  // NEVER log this value (§11: no clinical payloads in error reports).
  const payload = await decryptField(dataKey, stored.payload as EncryptedField);
  return { ...stored, payload } as ClinicalEvent;
}

export const eventsRepository = {
  /** Append one event. Writes the row and its outbox entry in one transaction. */
  async append(draft: ClinicalEventDraft): Promise<ClinicalEvent> {
    const dataKey = requireDataKey();
    const timestamp = nowIso();
    const event = ClinicalEventSchema.parse({
      ...draft,
      recorded_at: timestamp,
      created_at: timestamp,
      deleted_at: null,
    });

    // All crypto before the transaction opens — see base.ts ORDERING NOTE.
    const storedRow = {
      ...event,
      payload: await encryptField(dataKey, event.payload),
    };
    const outboxEntry = await buildOutboxEntry(dataKey, {
      table: 'clinical_events',
      op: 'upsert',
      row: event as unknown as Record<string, unknown>,
      clientUpdatedAt: timestamp,
    });

    await commitWrite('clinical_events', storedRow, outboxEntry);
    return event;
  },

  /**
   * Tombstone an event. The only mutation §6.1 permits, and even this appends an
   * outbox entry rather than editing history silently.
   */
  async tombstone(id: string): Promise<void> {
    const dataKey = requireDataKey();
    const stored = await db.clinical_events.get(id);
    if (!stored) throw new Error(`No clinical_events row with id ${id}`);

    const timestamp = nowIso();
    const storedRow = { ...stored, deleted_at: timestamp };
    // The outbox carries the plaintext row §7.2 expects, so the payload must be
    // decrypted here and re-encrypted by buildOutboxEntry. Not logged.
    const event = await decryptEvent(
      dataKey,
      stored as Record<string, unknown>,
    );
    const outboxEntry = await buildOutboxEntry(dataKey, {
      table: 'clinical_events',
      op: 'tombstone',
      row: { ...event, deleted_at: timestamp } as unknown as Record<
        string,
        unknown
      >,
      clientUpdatedAt: timestamp,
    });

    await commitWrite('clinical_events', storedRow, outboxEntry);
  },

  /** Retrievable even when tombstoned — a correction chain must reach it. */
  async getById(id: string): Promise<ClinicalEvent | null> {
    const dataKey = requireDataKey();
    const stored = await db.clinical_events.get(id);
    if (!stored) return null;
    return decryptEvent(dataKey, stored as Record<string, unknown>);
  },

  /**
   * Events for one person, newest first, tombstones excluded by default.
   *
   * Reads through the `[person_id+occurred_at]` index from §6.4 rather than
   * scanning, because step 13's timeline pages this and the decrypt cost must
   * scale with the page size, not the history size.
   */
  async listByPerson(
    personId: string,
    options?: { limit?: number; includeTombstoned?: boolean },
  ): Promise<ClinicalEvent[]> {
    const dataKey = requireDataKey();
    let collection = db.clinical_events
      .where('[person_id+occurred_at]')
      .between([personId, Dexie.minKey], [personId, Dexie.maxKey])
      .reverse();

    if (options?.limit !== undefined)
      collection = collection.limit(options.limit);

    const rows = await collection.toArray();
    const visible = options?.includeTombstoned
      ? rows
      : rows.filter(
          (row) => row.deleted_at === null || row.deleted_at === undefined,
        );

    // Decrypted clinical content below — do not log.
    return Promise.all(
      visible.map((row) =>
        decryptEvent(dataKey, row as Record<string, unknown>),
      ),
    );
  },
};
