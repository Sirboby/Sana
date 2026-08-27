import type { z } from 'zod';
import type { MutationOp, MutationTable } from '../../schemas';
import { type EncryptedField, decryptField, encryptField } from '../crypto';
import { requireDataKey } from '../keyring';
import { type OutboxEntry, buildOutboxEntry } from '../outbox';
import { db } from '../schema';

/**
 * Shared repository machinery.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ATOMICITY GUARANTEE
 * ─────────────────────────────────────────────────────────────────────────────
 * Every local mutation writes the entity row AND its outbox entry inside ONE
 * Dexie transaction. If those could diverge, a crash between them would either
 * lose a mutation the user believes was saved, or replay one that already
 * applied. On an offline-first health record neither is acceptable: the first
 * silently drops a logged dose, the second duplicates it.
 *
 * This is enforced structurally rather than by convention — `commitWrite` is the
 * only write path, it always does both, and repositories are the only exported
 * way to reach it. There is deliberately no exported function that writes an
 * entity without enqueuing its mutation.
 *
 * ORDERING NOTE: all encryption happens BEFORE the transaction opens. Awaiting a
 * non-Dexie promise inside a Dexie transaction takes it out of Dexie's async
 * zone and can commit it early — which would quietly break the very guarantee
 * this file exists to provide.
 */

/** A row as the caller supplies it; timestamps are stamped by the repository. */
export type Draft<T> = Omit<T, 'created_at' | 'updated_at' | 'deleted_at'>;

export type EncryptedFieldMap<TDomain> = readonly (keyof TDomain & string)[];

function nowIso(): string {
  return new Date().toISOString();
}

/** Replace the named plaintext fields with their encrypted form. */
export async function encryptRow<TDomain extends Record<string, unknown>>(
  dataKey: CryptoKey,
  row: TDomain,
  fields: EncryptedFieldMap<TDomain>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...row };
  for (const field of fields) {
    out[field] = await encryptField(dataKey, row[field]);
  }
  return out;
}

/**
 * Restore the plaintext fields of a stored row.
 *
 * NEVER LOG THE RESULT. Every value produced here is decrypted clinical content
 * — a medication name, an allergy label, a free-text note. §11 forbids clinical
 * payloads reaching error reports, so this must not be console-logged, attached
 * to a Sentry scope, or interpolated into an exception message.
 */
export async function decryptRow<TDomain extends Record<string, unknown>>(
  dataKey: CryptoKey,
  stored: Record<string, unknown>,
  fields: EncryptedFieldMap<TDomain>,
): Promise<TDomain> {
  const out: Record<string, unknown> = { ...stored };
  for (const field of fields) {
    out[field] = await decryptField(dataKey, stored[field] as EncryptedField);
  }
  return out as TDomain;
}

/**
 * The single write path: entity row and outbox entry, one transaction.
 *
 * Both arguments are fully prepared (and encrypted) by the caller, so this
 * function performs only Dexie operations.
 */
export async function commitWrite(
  tableName: MutationTable,
  storedRow: Record<string, unknown>,
  outboxEntry: OutboxEntry,
): Promise<void> {
  await db.transaction('rw', db.table(tableName), db.outbox, async () => {
    await db.table(tableName).put(storedRow);
    await db.outbox.add(outboxEntry);
  });
}

export type EntityRepository<TDomain> = {
  create(draft: Draft<TDomain>): Promise<TDomain>;
  update(id: string, patch: Partial<Draft<TDomain>>): Promise<TDomain>;
  tombstone(id: string): Promise<void>;
  /** Returns tombstoned rows too — a correction chain needs to reach them. */
  getById(id: string): Promise<TDomain | null>;
  /** Excludes tombstones by default. */
  list(options?: { includeTombstoned?: boolean }): Promise<TDomain[]>;
};

/**
 * Build a repository for one current-state entity.
 *
 * `schema` validates the complete domain row on the way in, so a malformed row
 * cannot reach either the local store or the sync queue.
 */
export function createEntityRepository<
  TDomain extends Record<string, unknown>,
>(config: {
  tableName: MutationTable;
  /**
   * Input is `unknown` rather than `TDomain`: a branded schema's INPUT type is
   * the plain string it parses, while its OUTPUT carries the brand, so the two
   * genuinely differ and `z.ZodType<TDomain>` (which equates them) would reject
   * every schema in src/lib/schemas.
   */
  schema: z.ZodType<TDomain, z.ZodTypeDef, unknown>;
  encryptedFields: EncryptedFieldMap<TDomain>;
}): EntityRepository<TDomain> {
  const { tableName, schema, encryptedFields } = config;

  async function readOne(
    dataKey: CryptoKey,
    id: string,
  ): Promise<TDomain | null> {
    const stored = await db.table(tableName).get(id);
    if (!stored) return null;
    // Decrypted clinical content — see decryptRow. Do not log.
    return decryptRow<TDomain>(
      dataKey,
      stored as Record<string, unknown>,
      encryptedFields,
    );
  }

  async function writeRow(row: TDomain, op: MutationOp): Promise<TDomain> {
    const dataKey = requireDataKey();
    const validated = schema.parse(row);

    // All crypto first — see the ORDERING NOTE at the top of this file.
    const storedRow = await encryptRow(dataKey, validated, encryptedFields);
    const outboxEntry = await buildOutboxEntry(dataKey, {
      table: tableName,
      op,
      row: validated as Record<string, unknown>,
      clientUpdatedAt: validated.updated_at as string,
    });

    await commitWrite(tableName, storedRow, outboxEntry);
    return validated;
  }

  return {
    async create(draft) {
      const timestamp = nowIso();
      return writeRow(
        {
          ...draft,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
        } as unknown as TDomain,
        'upsert',
      );
    },

    async update(id, patch) {
      const dataKey = requireDataKey();
      const current = await readOne(dataKey, id);
      if (current === null)
        throw new Error(`No ${tableName} row with id ${id}`);
      return writeRow(
        { ...current, ...patch, updated_at: nowIso() } as TDomain,
        'upsert',
      );
    },

    async tombstone(id) {
      const dataKey = requireDataKey();
      const current = await readOne(dataKey, id);
      if (current === null)
        throw new Error(`No ${tableName} row with id ${id}`);
      const timestamp = nowIso();
      await writeRow(
        { ...current, deleted_at: timestamp, updated_at: timestamp } as TDomain,
        'tombstone',
      );
    },

    async getById(id) {
      return readOne(requireDataKey(), id);
    },

    async list(options) {
      const dataKey = requireDataKey();
      const rows = (await db.table(tableName).toArray()) as Record<
        string,
        unknown
      >[];
      // IndexedDB cannot index null, so a row with deleted_at = null is absent
      // from the deleted_at index entirely — `.where('deleted_at').equals(null)`
      // returns nothing. Tombstone filtering therefore happens in JS. The index
      // remains useful for the inverse query: finding tombstones to reap.
      const visible = options?.includeTombstoned
        ? rows
        : rows.filter(
            (row) => row.deleted_at === null || row.deleted_at === undefined,
          );
      // Decrypted clinical content below — do not log.
      return Promise.all(
        visible.map((row) =>
          decryptRow<TDomain>(dataKey, row, encryptedFields),
        ),
      );
    },
  };
}
