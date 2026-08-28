import { requireDataKey } from '../db/keyring';
import { type OutboxEntry, decryptOutboxRow } from '../db/outbox';
import { db } from '../db/schema';
import {
  MAX_MUTATIONS_PER_BATCH,
  MAX_MUTATION_ATTEMPTS,
  MAX_PULL_PAGES,
} from './protocol';

/**
 * The client sync cycle (PRD §7.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PUSH FIRST, THEN PULL
 * ─────────────────────────────────────────────────────────────────────────────
 * Order is not arbitrary. Pulling first would apply the server's version of a
 * record the device has already edited locally but not yet sent — overwriting
 * the user's unsynced change with an older one, and losing work that the app
 * had told them was saved. Pushing first means every local change is server-side
 * before anything comes back down.
 */

export type SyncOutcome = {
  pushed: number;
  rejected: number;
  dead: number;
  pulled: number;
  watermark: string | null;
  /** Set when the server's clock disagreed enough to matter. */
  clockSkewMs?: number;
};

const WATERMARK_KEY = 'sync_watermark';
const CLIENT_ID_KEY = 'client_id';

type PushResponse = {
  applied: string[];
  rejected: { mutation_id: string; reason: string; code: string }[];
  server_time: string;
};

type PullResponse = {
  changes: Record<string, Record<string, unknown>[]>;
  server_time: string;
  has_more: boolean;
};

/**
 * HAZARD 2 — the single-flight lock.
 *
 * Two overlapping cycles would push the same outbox rows twice and interleave
 * watermark writes, so the later cycle could rewind the watermark set by the
 * earlier one and re-pull records already applied. A second caller receives the
 * IN-FLIGHT promise rather than starting a second cycle, so every trigger in
 * §7.1 can fire freely without coordinating with the others.
 */
let inFlight: Promise<SyncOutcome> | null = null;

export function isSyncing(): boolean {
  return inFlight !== null;
}

export async function sync(
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SyncOutcome> {
  if (inFlight !== null) return inFlight;

  inFlight = runCycle(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readMeta(key: string): Promise<string | null> {
  const row = await db.sync_meta.get(key);
  return row && typeof row.value === 'string' ? row.value : null;
}

async function runCycle(options: {
  fetchImpl?: typeof fetch;
}): Promise<SyncOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const clientId = (await readMeta(CLIENT_ID_KEY)) ?? 'unknown-device';

  const pushResult = await push(doFetch, clientId);
  const pullResult = await pull(doFetch);

  return {
    pushed: pushResult.pushed,
    rejected: pushResult.rejected,
    dead: pushResult.dead,
    pulled: pullResult.pulled,
    watermark: pullResult.watermark,
    ...(pushResult.clockSkewMs === undefined
      ? {}
      : { clockSkewMs: pushResult.clockSkewMs }),
  };
}

async function push(
  doFetch: typeof fetch,
  clientId: string,
): Promise<{
  pushed: number;
  rejected: number;
  dead: number;
  clockSkewMs?: number;
}> {
  const dataKey = requireDataKey();

  // seq order: the outbox is a queue, and applying a create after the update
  // that depends on it would fail. Chunked to the §7.2 batch limit.
  const pending = await db.outbox
    .where('status')
    .anyOf('pending', 'failed')
    .sortBy('seq');

  if (pending.length === 0) return { pushed: 0, rejected: 0, dead: 0 };

  let pushed = 0;
  let rejectedCount = 0;
  let deadCount = 0;
  let clockSkewMs: number | undefined;

  for (
    let offset = 0;
    offset < pending.length;
    offset += MAX_MUTATIONS_PER_BATCH
  ) {
    const chunk = pending.slice(offset, offset + MAX_MUTATIONS_PER_BATCH);

    // Decrypted immediately before the request and never stored in plaintext —
    // see db/outbox.ts for why the queued row is encrypted at rest.
    const mutations = await Promise.all(
      chunk.map(async (entry) => ({
        mutation_id: entry.mutation_id,
        table: entry.table,
        op: entry.op,
        row: await decryptOutboxRow(dataKey, entry),
        client_updated_at: entry.client_updated_at,
      })),
    );

    const response = await doFetch('/api/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, mutations }),
    });

    if (!response.ok) {
      // A transport-level failure is not a per-mutation rejection: nothing was
      // decided about these rows, so they stay pending and the scheduler backs
      // off. Marking them failed here would burn retry budget on a server outage.
      throw new Error(`Push failed with ${response.status}`);
    }

    const result = (await response.json()) as PushResponse;

    const serverTime = new Date(result.server_time).getTime();
    const localSkew = Date.now() - serverTime;
    if (Math.abs(localSkew) > 5 * 60 * 1000) clockSkewMs = localSkew;

    const appliedIds = new Set(result.applied);
    const rejectionById = new Map(
      result.rejected.map((r) => [r.mutation_id, r]),
    );

    await db.transaction('rw', db.outbox, async () => {
      for (const entry of chunk) {
        if (appliedIds.has(entry.mutation_id)) {
          if (entry.seq !== undefined) await db.outbox.delete(entry.seq);
          pushed += 1;
          continue;
        }

        const rejection = rejectionById.get(entry.mutation_id);
        if (!rejection) continue;

        // A STALE rejection means the server already holds a newer version, so
        // retrying can never succeed. Drop it rather than burning attempts.
        if (rejection.code === 'STALE') {
          if (entry.seq !== undefined) await db.outbox.delete(entry.seq);
          rejectedCount += 1;
          continue;
        }

        const attempts = entry.attempts + 1;
        const status = attempts >= MAX_MUTATION_ATTEMPTS ? 'dead' : 'failed';
        if (status === 'dead') deadCount += 1;
        rejectedCount += 1;

        if (entry.seq !== undefined) {
          await db.outbox.update(entry.seq, {
            status,
            attempts,
            last_error: rejection.reason,
          });
        }
      }
    });
  }

  return {
    pushed,
    rejected: rejectedCount,
    dead: deadCount,
    ...(clockSkewMs === undefined ? {} : { clockSkewMs }),
  };
}

async function pull(
  doFetch: typeof fetch,
): Promise<{ pulled: number; watermark: string | null }> {
  let watermark = (await readMeta(WATERMARK_KEY)) ?? '1970-01-01T00:00:00.000Z';
  let pulled = 0;
  let pages = 0;

  for (;;) {
    pages += 1;
    if (pages > MAX_PULL_PAGES) {
      // A cursor that never advances would spin forever, silently draining a
      // battery and a data plan. Fail loudly instead.
      throw new Error(
        `Pull exceeded ${MAX_PULL_PAGES} pages — the cursor is not advancing. Aborting rather than looping.`,
      );
    }

    const response = await doFetch(
      `/api/sync/pull?since=${encodeURIComponent(watermark)}`,
    );
    if (!response.ok) throw new Error(`Pull failed with ${response.status}`);

    const result = (await response.json()) as PullResponse;

    for (const rows of Object.values(result.changes)) pulled += rows.length;

    /**
     * HAZARD 3 — the watermark comes from the SERVER, never from Date.now().
     *
     * A device whose clock runs ten minutes fast would otherwise store a future
     * watermark and permanently skip every record the server writes in that
     * window. The bug is invisible: sync reports success, and the records simply
     * never arrive.
     */
    const previous = watermark;
    watermark = result.server_time;
    await db.sync_meta.put({ key: WATERMARK_KEY, value: watermark });

    if (!result.has_more) break;
    if (watermark === previous) {
      throw new Error('Pull cursor did not advance while has_more was true.');
    }
  }

  return { pulled, watermark };
}

/** Test-only: clear the single-flight lock between cases. */
export function __resetSyncForTests(): void {
  inFlight = null;
}
