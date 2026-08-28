import type { SupabaseClient } from '@supabase/supabase-js';
import { MUTATION_ROW_SCHEMAS, type Mutation } from '../schemas';
import { REJECTION_CODES } from './protocol';

/**
 * Apply one mutation server-side (PRD §7.2, §7.5).
 *
 * Split out of the route handler so the conflict rules are testable without an
 * HTTP layer, and so there is exactly ONE place that decides where a row's
 * owner_id comes from.
 */

export type MutationRejection = {
  mutation_id: string;
  reason: string;
  code: string;
};

export type ApplyOutcome =
  | { ok: true }
  | { ok: false; rejection: MutationRejection };

/** Tables whose rows are append-only (§7.5). */
const APPEND_ONLY_TABLES = new Set(['clinical_events', 'consents']);

export async function applyMutation(
  serviceRole: SupabaseClient,
  params: { mutation: Mutation; ownerId: string; serverNow: Date },
): Promise<ApplyOutcome> {
  const { mutation, ownerId, serverNow } = params;

  const rowSchema = MUTATION_ROW_SCHEMAS[mutation.table];
  if (!rowSchema) {
    return {
      ok: false,
      rejection: {
        mutation_id: mutation.mutation_id,
        reason: `Unknown table: ${mutation.table}`,
        code: REJECTION_CODES.UNKNOWN_TABLE,
      },
    };
  }

  /**
   * THE OWNER_ID RULE.
   *
   * Whatever the client sent is stripped here and the JWT's value substituted.
   * Note the ordering: `...mutation.row` first, `owner_id` after, so a client
   * value can only ever be overwritten and never win. It is never compared and
   * never used to decide anything — a comparison would mean the client value had
   * reached the authorisation logic, and the next person to touch this could
   * mistake the comparison for the check.
   */
  const candidateRow: Record<string, unknown> = {
    ...mutation.row,
    owner_id: ownerId,
    server_received_at: serverNow.toISOString(),
  };

  const parsedRow = rowSchema.safeParse({
    ...candidateRow,
    server_received_at: undefined,
  });
  if (!parsedRow.success) {
    return {
      ok: false,
      rejection: {
        mutation_id: mutation.mutation_id,
        reason: parsedRow.error.issues
          .map(
            (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          )
          .join('; '),
        code: REJECTION_CODES.SCHEMA_INVALID,
      },
    };
  }

  const row = { ...candidateRow };
  if (mutation.op === 'tombstone') {
    row.deleted_at = mutation.client_updated_at;
  }

  try {
    if (APPEND_ONLY_TABLES.has(mutation.table)) {
      // §7.2: `insert … on conflict (id) do nothing`. Re-pushing an event is a
      // no-op rather than an error, which is what makes the whole push
      // idempotent (AC-8.1.3). A second device creating a DIFFERENT event is
      // untouched by this — both persist (AC-8.1.4).
      const { error } = await serviceRole
        .from(mutation.table)
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    /**
     * Current-state tables: last-write-wins on client_updated_at (§7.5).
     *
     * PostgREST cannot express `on conflict do update WHERE excluded.x > target.x`
     * directly, so the guard is applied by reading the incumbent first. That is a
     * read-then-write race in principle; in practice §7.5 notes single-user
     * ownership makes concurrent edits to one row rare, and the loser of a race
     * re-syncs on the next cycle. A stored procedure would close it fully and is
     * the right upgrade if this ever becomes multi-user.
     */
    const { data: existing } = await serviceRole
      .from(mutation.table)
      .select('updated_at')
      .eq('id', row.id as string)
      .maybeSingle();

    if (existing?.updated_at) {
      const incoming = new Date(mutation.client_updated_at).getTime();
      const incumbent = new Date(existing.updated_at as string).getTime();
      if (incoming <= incumbent) {
        // Not an error. The server already holds a newer version, so the client's
        // copy is stale and dropping it is the correct resolution. Reported so
        // the client can clear it from the outbox rather than retry forever.
        return {
          ok: false,
          rejection: {
            mutation_id: mutation.mutation_id,
            reason:
              'A newer version of this record already exists on the server.',
            code: REJECTION_CODES.STALE,
          },
        };
      }
    }

    row.updated_at = mutation.client_updated_at;

    const { error } = await serviceRole
      .from(mutation.table)
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      rejection: {
        mutation_id: mutation.mutation_id,
        reason: error instanceof Error ? error.message : 'Write failed.',
        code: REJECTION_CODES.WRITE_FAILED,
      },
    };
  }
}
