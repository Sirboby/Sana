import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKeyringForTests, setupPin } from '../../src/lib/db/keyring';
import {
  medicationsRepository,
  personsRepository,
} from '../../src/lib/db/repositories';
import { db } from '../../src/lib/db/schema';
import {
  MedicationIdSchema,
  PersonIdSchema,
  ProfileIdSchema,
} from '../../src/lib/schemas';
import { applyMutation } from '../../src/lib/sync/apply';
import { __resetSyncForTests, sync } from '../../src/lib/sync/engine';
import {
  BACKOFF_MAX_MS,
  MAX_MUTATION_ATTEMPTS,
  assessClockSkew,
  backoffBounds,
  backoffDelayMs,
} from '../../src/lib/sync/protocol';

/**
 * Sync tests (PRD §7, AC-8.1.1 to AC-8.1.5).
 *
 * The server side is exercised through `applyMutation` against an in-memory
 * Postgres stand-in, so the conflict rules and the owner_id rule are tested as
 * logic rather than through HTTP. The client side runs the real engine against a
 * real Dexie via fake-indexeddb.
 */

const PIN = '123456';
const OWNER = ProfileIdSchema.parse('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa');
const ATTACKER = ProfileIdSchema.parse('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
const PERSON = PersonIdSchema.parse('11111111-1111-4111-a111-111111111111');
const MED = MedicationIdSchema.parse('ffffffff-1111-4111-a111-111111111111');

// ─────────────── in-memory server ───────────────

type Row = Record<string, unknown>;

/** Minimal PostgREST stand-in with the upsert semantics §7.2 relies on. */
function fakeServer(tables: Record<string, Row[]> = {}) {
  const store: Record<string, Row[]> = { ...tables };

  function from(table: string) {
    store[table] ??= [];
    let rows = [...(store[table] as Row[])];

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((r) => r[column] === value);
        return builder;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: async (row: Row) => {
        (store[table] as Row[]).push(row);
        return { data: [row], error: null };
      },
      upsert: async (
        row: Row,
        options?: { onConflict?: string; ignoreDuplicates?: boolean },
      ) => {
        const key = options?.onConflict ?? 'id';
        const existing = (store[table] as Row[]).findIndex(
          (r) => r[key] === row[key],
        );
        if (existing === -1) {
          (store[table] as Row[]).push(row);
        } else if (!options?.ignoreDuplicates) {
          (store[table] as Row[])[existing] = {
            ...(store[table] as Row[])[existing],
            ...row,
          };
        }
        // ignoreDuplicates && existing -> no-op, which is `do nothing`.
        return { data: [row], error: null };
      },
      // A PostgREST builder IS a thenable, which is what lets `await
      // supabase.from(x).select()` work with no execute step. The fake must be
      // one too, or it would not drive the same code paths as the real client.
      // biome-ignore lint/suspicious/noThenProperty: deliberately mimics PostgREST
      then: (resolve: (v: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows, error: null }),
    };
    return builder;
  }

  return { client: { from } as never, store };
}

function mutation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mutation_id: '01890000-0000-7000-8000-000000000001',
    table: 'medications' as const,
    op: 'upsert' as const,
    row: {
      id: MED,
      person_id: PERSON,
      owner_id: OWNER,
      drug_id: null,
      is_custom: false,
      display_name: 'Paracetamol',
      dose_amount: null,
      dose_unit: null,
      schedule: { kind: 'as_needed' },
      start_date: '2026-01-01',
      end_date: null,
      notes: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    } as Record<string, unknown>,
    client_updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Parameters<typeof applyMutation>[1]['mutation'];
}

// ═══════════════ (a) IDEMPOTENCY ═══════════════

describe('(a) IDEMPOTENCY (AC-8.1.3)', () => {
  it('pushing an identical batch twice leaves the same row counts', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-02T00:00:00.000Z');
    const m = mutation();

    await applyMutation(client, { mutation: m, ownerId: OWNER, serverNow });
    const afterFirst = (store.medications ?? []).length;

    await applyMutation(client, { mutation: m, ownerId: OWNER, serverNow });
    const afterSecond = (store.medications ?? []).length;

    console.log(`\n[IDEMPOTENCY] medications after push 1: ${afterFirst}`);
    console.log(`[IDEMPOTENCY] medications after push 2: ${afterSecond}`);

    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1);
  });

  it('an append-only event pushed twice is stored once', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-02T00:00:00.000Z');
    const event = mutation({
      table: 'clinical_events',
      row: {
        id: 'eeeeeeee-1111-4111-a111-111111111111',
        person_id: PERSON,
        owner_id: OWNER,
        event_type: 'medication_taken',
        occurred_at: '2026-01-01T08:00:00.000Z',
        recorded_at: '2026-01-01T08:00:00.000Z',
        payload: { medication_id: MED },
        rulepack_version: null,
        ruleset_checksum: null,
        client_id: 'device-a',
        corrects_event_id: null,
        deleted_at: null,
        created_at: '2026-01-01T08:00:00.000Z',
      },
    });

    await applyMutation(client, { mutation: event, ownerId: OWNER, serverNow });
    await applyMutation(client, { mutation: event, ownerId: OWNER, serverNow });

    console.log(
      `[IDEMPOTENCY] clinical_events after two pushes: ${(store.clinical_events ?? []).length}`,
    );
    expect((store.clinical_events ?? []).length).toBe(1);
  });
});

// ═══════════════ (c) (d) conflict resolution ═══════════════

describe('(c) LAST-WRITE-WINS on client_updated_at (AC-8.1.4)', () => {
  it('the higher client_updated_at wins', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-05T00:00:00.000Z');

    await applyMutation(client, {
      mutation: mutation({
        client_updated_at: '2026-01-02T00:00:00.000Z',
        row: { ...mutation().row, display_name: 'Older name' },
      }),
      ownerId: OWNER,
      serverNow,
    });

    await applyMutation(client, {
      mutation: mutation({
        mutation_id: '01890000-0000-7000-8000-000000000002',
        client_updated_at: '2026-01-03T00:00:00.000Z',
        row: { ...mutation().row, display_name: 'Newer name' },
      }),
      ownerId: OWNER,
      serverNow,
    });

    expect((store.medications?.[0] as Row)?.display_name).toBe('Newer name');
  });

  it('an OLDER write is rejected as STALE rather than clobbering', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-05T00:00:00.000Z');

    await applyMutation(client, {
      mutation: mutation({
        client_updated_at: '2026-01-03T00:00:00.000Z',
        row: { ...mutation().row, display_name: 'Newer name' },
      }),
      ownerId: OWNER,
      serverNow,
    });

    const result = await applyMutation(client, {
      mutation: mutation({
        mutation_id: '01890000-0000-7000-8000-000000000003',
        client_updated_at: '2026-01-01T00:00:00.000Z',
        row: { ...mutation().row, display_name: 'Older name' },
      }),
      ownerId: OWNER,
      serverNow,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('STALE');
    expect((store.medications?.[0] as Row)?.display_name).toBe('Newer name');
  });
});

describe('(d) append-only: two devices, two events, both retained (AC-8.1.4)', () => {
  it('neither event overwrites the other', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-05T00:00:00.000Z');

    const base = mutation({ table: 'clinical_events' }).row as Record<
      string,
      unknown
    >;
    const eventRow = (id: string, device: string) => ({
      ...base,
      id,
      person_id: PERSON,
      owner_id: OWNER,
      event_type: 'medication_taken',
      occurred_at: '2026-01-01T08:00:00.000Z',
      recorded_at: '2026-01-01T08:00:00.000Z',
      payload: { medication_id: MED },
      rulepack_version: null,
      ruleset_checksum: null,
      client_id: device,
      corrects_event_id: null,
      deleted_at: null,
      created_at: '2026-01-01T08:00:00.000Z',
    });

    await applyMutation(client, {
      mutation: mutation({
        table: 'clinical_events',
        mutation_id: '01890000-0000-7000-8000-00000000000a',
        row: eventRow('eeeeeeee-1111-4111-a111-111111111111', 'device-a'),
      }),
      ownerId: OWNER,
      serverNow,
    });
    await applyMutation(client, {
      mutation: mutation({
        table: 'clinical_events',
        mutation_id: '01890000-0000-7000-8000-00000000000b',
        row: eventRow('eeeeeeee-1111-4111-a111-222222222222', 'device-b'),
      }),
      ownerId: OWNER,
      serverNow,
    });

    expect((store.clinical_events ?? []).length).toBe(2);
  });
});

// ═══════════════ (e) owner_id spoofing ═══════════════

describe('(e) owner_id SPOOFING is impossible', () => {
  it('a row claiming another user is stored under the AUTHENTICATED user', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-05T00:00:00.000Z');

    // The attacker authenticates as themselves but claims the victim's owner_id.
    const spoofed = mutation({
      row: { ...(mutation().row as Row), owner_id: OWNER },
    });

    await applyMutation(client, {
      mutation: spoofed,
      ownerId: ATTACKER,
      serverNow,
    });

    const stored = store.medications?.[0] as Row;
    console.log('\n[SPOOFING] client claimed owner_id:', OWNER);
    console.log('[SPOOFING] authenticated user:      ', ATTACKER);
    console.log('[SPOOFING] row stored under:        ', stored?.owner_id);

    expect(stored?.owner_id).toBe(ATTACKER);
    expect(stored?.owner_id).not.toBe(OWNER);
  });

  it('reading back as the VICTIM returns zero rows', async () => {
    const { client, store } = fakeServer();
    const serverNow = new Date('2026-01-05T00:00:00.000Z');

    await applyMutation(client, {
      mutation: mutation({
        row: { ...(mutation().row as Row), owner_id: OWNER },
      }),
      ownerId: ATTACKER,
      serverNow,
    });

    const victimRows = (store.medications ?? []).filter(
      (r) => r.owner_id === OWNER,
    );
    console.log(`[SPOOFING] rows visible to the victim: ${victimRows.length}`);
    expect(victimRows).toEqual([]);
  });

  it('the claimed owner_id is overwritten, never merely compared', async () => {
    // Ordering matters: the spread puts owner_id AFTER the client row, so a
    // client value can only be overwritten and never win.
    const source = await import('../../src/lib/sync/apply');
    expect(typeof source.applyMutation).toBe('function');

    const { client, store } = fakeServer();
    for (const claimed of [OWNER, ATTACKER, 'not-a-uuid', null, undefined]) {
      await applyMutation(client, {
        mutation: mutation({
          mutation_id: `01890000-0000-7000-8000-0000000000${String(Math.random()).slice(2, 4)}`,
          row: { ...(mutation().row as Row), owner_id: claimed },
        }),
        ownerId: ATTACKER,
        serverNow: new Date('2026-01-05T00:00:00.000Z'),
      });
    }
    for (const row of store.medications ?? []) {
      expect(row.owner_id).toBe(ATTACKER);
    }
  });
});

// ═══════════════ (f) CLOCK SKEW ═══════════════

describe('(f) CLOCK SKEW (HAZARD 1)', () => {
  const serverNow = new Date('2026-01-05T12:00:00.000Z');

  it('rejects a timestamp 48 hours in the future with CLOCK_SKEW_FUTURE', () => {
    const future = new Date(
      serverNow.getTime() + 48 * 60 * 60 * 1000,
    ).toISOString();
    const assessment = assessClockSkew(future, serverNow);
    expect(assessment.verdict).toBe('reject');
    if (assessment.verdict === 'reject')
      expect(assessment.code).toBe('CLOCK_SKEW_FUTURE');
  });

  it('ACCEPTS a timestamp 1 hour in the future', () => {
    const future = new Date(serverNow.getTime() + 60 * 60 * 1000).toISOString();
    expect(assessClockSkew(future, serverNow).verdict).toBe('warn');
  });

  it('accepts a timestamp within 5 minutes without a warning', () => {
    const near = new Date(serverNow.getTime() + 60 * 1000).toISOString();
    expect(assessClockSkew(near, serverNow).verdict).toBe('ok');
  });

  it('does NOT reject a clock that is behind', () => {
    // A slow clock loses conflicts it should win, which is recoverable by
    // re-saving. A fast clock poisons the row permanently, which is not.
    const past = new Date(
      serverNow.getTime() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(assessClockSkew(past, serverNow).verdict).toBe('warn');
  });

  it('rejects an unparseable timestamp', () => {
    expect(assessClockSkew('not-a-date', serverNow).verdict).toBe('reject');
  });
});

// ═══════════════ (i) backoff ═══════════════

describe('(i) backoff curve (AC-8.1.5)', () => {
  it('starts at 1s and doubles', () => {
    expect(backoffBounds(0).min).toBeLessThanOrEqual(1000);
    expect(backoffBounds(1).max).toBeGreaterThanOrEqual(2000);
    expect(backoffBounds(2).max).toBeGreaterThanOrEqual(4000);
  });

  it('caps at 5 minutes', () => {
    expect(backoffBounds(20).max).toBeLessThanOrEqual(BACKOFF_MAX_MS * 1.25);
    expect(backoffDelayMs(20, () => 1)).toBeLessThanOrEqual(
      BACKOFF_MAX_MS * 1.25,
    );
  });

  it('stays within the +/-25% jitter band', () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { min, max } = backoffBounds(attempt);
      for (let i = 0; i < 50; i += 1) {
        const delay = backoffDelayMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(min - 1);
        expect(delay).toBeLessThanOrEqual(max + 1);
      }
    }
  });

  it('actually varies, so a reconnect stampede is spread out', () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffDelayMs(3)));
    expect(delays.size).toBeGreaterThan(1);
  });
});

// ═══════════════ client-side cycle ═══════════════

describe('client sync cycle', () => {
  beforeEach(async () => {
    __resetKeyringForTests();
    __resetSyncForTests();
    if (!db.isOpen()) await db.open();
    await Promise.all(db.tables.map((t) => t.clear()));
    await setupPin(PIN);
    await db.sync_meta.put({ key: 'client_id', value: 'device-test' });
  });

  async function seedOutbox(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await personsRepository.create({
        id: PersonIdSchema.parse(`1111111${i}-1111-4111-a111-111111111111`),
        owner_id: OWNER,
        display_name: `Person ${i}`,
        relationship: 'self',
        date_of_birth: null,
        sex_at_birth: 'undisclosed',
        is_pregnant: false,
        weight_kg: null,
      });
    }
  }

  function stubFetch(handlers: {
    push?: (body: unknown) => unknown;
    pull?: (url: string) => unknown;
    onPush?: () => void;
  }): typeof fetch {
    return (async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/sync/push')) {
        handlers.onPush?.();
        const body = JSON.parse(String(init?.body ?? '{}'));
        return {
          ok: true,
          status: 200,
          json: async () =>
            handlers.push?.(body) ?? {
              applied: (
                body as { mutations: { mutation_id: string }[] }
              ).mutations.map((m) => m.mutation_id),
              rejected: [],
              server_time: new Date().toISOString(),
            },
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          handlers.pull?.(url) ?? {
            changes: {},
            server_time: '2026-06-01T00:00:00.000Z',
            has_more: false,
          },
      };
    }) as unknown as typeof fetch;
  }

  // ── (b) partial failure ──
  it('(b) clears applied mutations and retains rejected ones with a reason (AC-8.1.2)', async () => {
    await seedOutbox(5);
    const entries = await db.outbox.orderBy('seq').toArray();
    const applied = entries.slice(0, 3).map((e) => e.mutation_id);
    const rejected = entries.slice(3).map((e) => ({
      mutation_id: e.mutation_id,
      reason: 'Schema invalid',
      code: 'SCHEMA_INVALID',
    }));

    await sync({
      fetchImpl: stubFetch({
        push: () => ({
          applied,
          rejected,
          server_time: new Date().toISOString(),
        }),
      }),
    });

    const remaining = await db.outbox.toArray();
    expect(remaining).toHaveLength(2);
    for (const entry of remaining) {
      expect(entry.status).toBe('failed');
      expect(entry.attempts).toBe(1);
      expect(entry.last_error).toBe('Schema invalid');
    }
  });

  // ── (g) watermark ──
  it('(g) stores the SERVER time as the watermark, not the client clock (HAZARD 3)', async () => {
    const serverTime = '2026-06-01T12:00:00.000Z';
    // Client clock 10 minutes ahead of the server.
    const clientNow = new Date('2026-06-01T12:10:00.000Z');
    vi.setSystemTime(clientNow);

    await sync({
      fetchImpl: stubFetch({
        pull: () => ({ changes: {}, server_time: serverTime, has_more: false }),
      }),
    });

    const stored = await db.sync_meta.get('sync_watermark');
    expect(stored?.value).toBe(serverTime);
    // The client's own clock must NOT have become the watermark: doing so would
    // skip every record the server writes in that 10-minute window, forever.
    expect(stored?.value).not.toBe(clientNow.toISOString());
    vi.useRealTimers();
  });

  // ── (h) single flight ──
  it('(h) two concurrent sync() calls make ONE push request (HAZARD 2)', async () => {
    await seedOutbox(2);
    let pushCount = 0;

    const fetchImpl = stubFetch({
      onPush: () => {
        pushCount += 1;
      },
    });
    const [a, b] = await Promise.all([
      sync({ fetchImpl }),
      sync({ fetchImpl }),
    ]);

    expect(pushCount).toBe(1);
    // The second caller receives the in-flight promise, so both see one result.
    expect(a).toEqual(b);
  });

  // ── (j) dead letter ──
  it('(j) a mutation failing 5 times reaches dead and stops retrying', async () => {
    await seedOutbox(1);

    for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
      __resetSyncForTests();
      const entries = await db.outbox.toArray();
      if (entries.length === 0) break;
      await sync({
        fetchImpl: stubFetch({
          push: (body) => ({
            applied: [],
            rejected: (
              body as { mutations: { mutation_id: string }[] }
            ).mutations.map((m) => ({
              mutation_id: m.mutation_id,
              reason: 'Server said no',
              code: 'WRITE_FAILED',
            })),
            server_time: new Date().toISOString(),
          }),
        }),
      });
    }

    const dead = await db.outbox.where('status').equals('dead').toArray();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.attempts).toBe(MAX_MUTATION_ATTEMPTS);

    // A dead entry is no longer picked up by the drain.
    __resetSyncForTests();
    let pushed = false;
    await sync({
      fetchImpl: stubFetch({
        onPush: () => {
          pushed = true;
        },
      }),
    });
    expect(pushed).toBe(false);
  });

  // ── (k) pagination ──
  it('(k) a stuck pull cursor throws instead of looping forever', async () => {
    await expect(
      sync({
        fetchImpl: stubFetch({
          // has_more never goes false and server_time never advances.
          pull: () => ({
            changes: {},
            server_time: '2026-06-01T00:00:00.000Z',
            has_more: true,
          }),
        }),
      }),
    ).rejects.toThrow(/did not advance|exceeded/i);
  });

  it('(k) pagination terminates normally when has_more goes false', async () => {
    let page = 0;
    const outcome = await sync({
      fetchImpl: stubFetch({
        pull: () => {
          page += 1;
          return {
            changes: { persons: [] },
            server_time: `2026-06-0${page}T00:00:00.000Z`,
            has_more: page < 3,
          };
        },
      }),
    });
    expect(page).toBe(3);
    expect(outcome.watermark).toBe('2026-06-03T00:00:00.000Z');
  });

  // ── (l) tombstones ──
  it('(l) a tombstone is queued so the deletion can propagate', async () => {
    await seedOutbox(1);
    const personId = PersonIdSchema.parse(
      '11111110-1111-4111-a111-111111111111',
    );
    await personsRepository.tombstone(personId);

    const entries = await db.outbox.toArray();
    const tombstone = entries.find((e) => e.op === 'tombstone');
    expect(tombstone).toBeDefined();
    expect(tombstone?.table).toBe('persons');

    // And it is excluded from active queries locally.
    expect(await personsRepository.list()).toHaveLength(0);
  });

  it('every repository write reaches the outbox, so nothing syncs silently', async () => {
    await medicationsRepository.create({
      id: MED,
      person_id: PERSON,
      owner_id: OWNER,
      drug_id: null,
      is_custom: false,
      display_name: 'Paracetamol',
      dose_amount: null,
      dose_unit: null,
      schedule: { kind: 'as_needed' },
      start_date: '2026-01-01',
      end_date: null,
      notes: null,
    });
    expect(await db.outbox.count()).toBe(1);
  });
});
