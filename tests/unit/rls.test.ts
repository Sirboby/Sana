import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Step 2 verification gate — RLS isolation proof (PRD §6.2).
 *
 * PRD §6.2: "RLS must be proven, not assumed."
 *
 * These assertions run against a real Postgres with the real policies applied.
 * They cannot be satisfied by in-memory stand-ins: an RLS failure is silent —
 * a missing policy does not error, it returns another person's medical history.
 *
 * Run locally with:
 *   supabase start && supabase db reset
 *   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... bun run test:unit
 *
 * When no database is reachable the suite SKIPS rather than passing, so it can
 * never report green while proving nothing. In CI, or with SANA_RLS_LIVE=1, an
 * unreachable database is a hard failure instead.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Seed fixture identities (supabase/seed/seed.sql). */
const USER_A = {
  id: 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa',
  email: 'usera@example.com',
  personId: '11111111-1111-4111-a111-111111111111',
};
const USER_B = {
  id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  email: 'userb@example.com',
  personId: '22222222-2222-4222-b222-222222222222',
};
const SEED_PASSWORD = 'password123';

/** Fixture rows provisioned by this suite, torn down and rebuilt on each run. */
const A_EVENT_READABLE = 'e1111111-1111-4111-a111-111111111111';
const A_EVENT_FOR_MUTATION = 'e1111111-1111-4111-a111-222222222222';
const A_EVENT_FOR_TOMBSTONE = 'e1111111-1111-4111-a111-333333333333';
const B_EVENT = 'e2222222-2222-4222-b222-111111111111';

/**
 * Tables that must be invisible across owners, with a User B row for each.
 * Assertion (c) is only meaningful if these rows genuinely exist — reading zero
 * rows from an empty table proves nothing at all.
 */
const B_OWNED_ROWS: Array<{ table: string; row: Record<string, unknown> }> = [
  {
    table: 'persons',
    row: {
      id: USER_B.personId,
      owner_id: USER_B.id,
      display_name: 'User B Person',
      relationship: 'self',
      sex_at_birth: 'male',
    },
  },
  {
    table: 'consents',
    row: {
      id: 'c2222222-2222-4222-b222-111111111111',
      owner_id: USER_B.id,
      consent_type: 'data_processing',
      version: '1.0.0',
      granted_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    },
  },
  {
    table: 'allergies',
    row: {
      id: 'a2222222-2222-4222-b222-111111111111',
      person_id: USER_B.personId,
      owner_id: USER_B.id,
      allergen_type: 'drug',
      allergen_label: 'Penicillin',
      severity: 'severe',
    },
  },
  {
    table: 'conditions',
    row: {
      id: 'd2222222-2222-4222-b222-111111111111',
      person_id: USER_B.personId,
      owner_id: USER_B.id,
      condition_label: 'Asthma',
    },
  },
  {
    table: 'medications',
    row: {
      id: 'f2222222-2222-4222-b222-111111111111',
      person_id: USER_B.personId,
      owner_id: USER_B.id,
      display_name: 'Salbutamol Inhaler',
      start_date: '2026-01-01',
    },
  },
  {
    table: 'clinical_events',
    row: {
      id: B_EVENT,
      person_id: USER_B.personId,
      owner_id: USER_B.id,
      event_type: 'note_added',
      occurred_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      payload: { note: 'user b private note' },
      client_id: 'test-client-b',
    },
  },
  {
    table: 'user_facilities',
    row: {
      id: '92222222-2222-4222-b222-111111111111',
      owner_id: USER_B.id,
      label: 'User B Clinic',
    },
  },
];

async function databaseIsReachable(): Promise<boolean> {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: ANON_KEY },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * This suite is DESTRUCTIVE: it deletes and re-inserts fixture rows using the
 * service-role key, which bypasses RLS entirely.
 *
 * Against local Supabase that is harmless. Against a hosted project it is not —
 * one wrong URL in .env.local and this deletes rows from a database holding real
 * people's medication history. A hosted target therefore has to be opted into
 * explicitly rather than reached by default.
 *
 * The check runs only once a database has actually answered: an unreachable
 * host cannot be damaged, and failing on one would make the ordinary
 * no-database run impossible.
 */
const IS_LOCAL_TARGET =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(SUPABASE_URL);
const REMOTE_ALLOWED = process.env.SANA_ALLOW_REMOTE_TEST_DB === '1';

const REACHABLE = await databaseIsReachable();

if (REACHABLE && !IS_LOCAL_TARGET && !REMOTE_ALLOWED) {
  throw new Error(
    `Refusing to run destructive RLS tests against a non-local database (${SUPABASE_URL}). This suite deletes rows with the service-role key. If this really is a disposable dev project and not one holding real users, set SANA_ALLOW_REMOTE_TEST_DB=1 in .env.local to confirm.`,
  );
}

const LIVE = REACHABLE;
const LIVE_REQUIRED =
  process.env.CI === 'true' || process.env.SANA_RLS_LIVE === '1';

if (!LIVE) {
  const detail = `SUPABASE_URL=${SUPABASE_URL} anonKey=${ANON_KEY ? 'set' : 'MISSING'} serviceRoleKey=${
    SERVICE_ROLE_KEY ? 'set' : 'MISSING'
  }`;
  console.warn(
    `\n[RLS] SKIPPED — no reachable Supabase instance. RLS isolation is NOT proven by this run.\n[RLS] ${detail}\n[RLS] Start one with: supabase start && supabase db reset\n`,
  );
}

describe('RLS isolation proof — availability', () => {
  it('a live database is reachable when the proof is mandatory (CI or SANA_RLS_LIVE=1)', () => {
    if (LIVE_REQUIRED && !LIVE) {
      throw new Error(
        `RLS isolation proof is mandatory here but no Supabase instance is reachable at ${SUPABASE_URL}. Refusing to report green without proving cross-user isolation. Start Supabase and set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.`,
      );
    }
    expect(LIVE || !LIVE_REQUIRED).toBe(true);
  });
});

describe.skipIf(!LIVE)(
  'RLS Isolation & Safety Policy Verification (Step 2)',
  () => {
    let admin: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    /** An anon-key client carrying a real end-user JWT, so auth.uid() resolves. */
    async function signIn(email: string): Promise<SupabaseClient> {
      const auth = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await auth.auth.signInWithPassword({
        email,
        password: SEED_PASSWORD,
      });
      if (error || !data.session) {
        throw new Error(
          `Could not sign in ${email}: ${error?.message ?? 'no session returned'}`,
        );
      }
      return createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        },
      });
    }

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Rebuild fixtures from scratch so repeated runs are deterministic. The
      // service role bypasses RLS, which is what makes it usable for provisioning.
      await admin
        .from('clinical_events')
        .delete()
        .in('id', [
          A_EVENT_READABLE,
          A_EVENT_FOR_MUTATION,
          A_EVENT_FOR_TOMBSTONE,
          B_EVENT,
        ]);

      const aEvents = [
        A_EVENT_READABLE,
        A_EVENT_FOR_MUTATION,
        A_EVENT_FOR_TOMBSTONE,
      ].map((id) => ({
        id,
        person_id: USER_A.personId,
        owner_id: USER_A.id,
        event_type: 'note_added',
        occurred_at: new Date('2026-01-01T00:00:00Z').toISOString(),
        payload: { note: 'user a note' },
        client_id: 'test-client-a',
      }));
      const { error: aInsertError } = await admin
        .from('clinical_events')
        .insert(aEvents);
      expect(aInsertError, 'provisioning user A events').toBeNull();

      for (const { table, row } of B_OWNED_ROWS) {
        const { error } = await admin
          .from(table)
          .upsert(row, { onConflict: 'id' });
        expect(error, `provisioning user B row in ${table}`).toBeNull();
      }

      clientA = await signIn(USER_A.email);
      clientB = await signIn(USER_B.email);
    });

    it('(a) User A can read their own clinical_events -> rows returned', async () => {
      const { data, error } = await clientA
        .from('clinical_events')
        .select('id')
        .eq('owner_id', USER_A.id);

      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThan(0);
    });

    it('(b) User A reads User B clinical_events -> EXACTLY ZERO ROWS', async () => {
      // Anti-vacuity: prove the row is really there before asserting A cannot see it.
      const { data: adminView } = await admin
        .from('clinical_events')
        .select('id')
        .eq('id', B_EVENT);
      expect(
        adminView?.length,
        "user B's event must exist for this assertion to mean anything",
      ).toBe(1);

      const { data, error } = await clientA
        .from('clinical_events')
        .select('*')
        .eq('id', B_EVENT);

      // A silent empty result is the expected RLS behaviour — assert on length,
      // not on an error being thrown.
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(data?.length).toBe(0);
    });

    it.each(
      B_OWNED_ROWS.map(({ table, row }) => ({ table, id: row.id as string })),
    )(
      '(c) User A reads User B $table -> EXACTLY ZERO ROWS',
      async ({ table, id }) => {
        const { data: adminView } = await admin
          .from(table)
          .select('id')
          .eq('id', id);
        expect(
          adminView?.length,
          `user B's ${table} row must exist for this to be meaningful`,
        ).toBe(1);

        const { data, error } = await clientA
          .from(table)
          .select('*')
          .eq('id', id);

        expect(error).toBeNull();
        expect(data).toEqual([]);
      },
    );

    it('(d) User A INSERTs a row with owner_id set to User B -> rejected by WITH CHECK', async () => {
      const { error } = await clientA.from('persons').insert({
        id: '33333333-3333-4333-a333-333333333333',
        owner_id: USER_B.id,
        display_name: 'Smuggled Person',
        relationship: 'self',
        sex_at_birth: 'undisclosed',
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');

      const { data: leaked } = await admin
        .from('persons')
        .select('id')
        .eq('id', '33333333-3333-4333-a333-333333333333');
      expect(leaked).toEqual([]);
    });

    it('(e) User A UPDATEs own clinical_events non-tombstone field -> rejected by events_no_mutation', async () => {
      const { error } = await clientA
        .from('clinical_events')
        .update({ payload: { note: 'mutated' } })
        .eq('id', A_EVENT_FOR_MUTATION);

      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');

      const { data: unchanged } = await admin
        .from('clinical_events')
        .select('payload')
        .eq('id', A_EVENT_FOR_MUTATION)
        .single();
      expect(unchanged?.payload).toEqual({ note: 'user a note' });
    });

    it('(f) User A UPDATEs own clinical_events setting only deleted_at -> succeeds', async () => {
      const tombstone = new Date('2026-02-01T00:00:00Z').toISOString();
      const { error } = await clientA
        .from('clinical_events')
        .update({ deleted_at: tombstone })
        .eq('id', A_EVENT_FOR_TOMBSTONE);

      expect(error).toBeNull();

      const { data: after } = await admin
        .from('clinical_events')
        .select('deleted_at')
        .eq('id', A_EVENT_FOR_TOMBSTONE)
        .single();
      expect(after?.deleted_at).not.toBeNull();
    });

    it('(g) User A INSERTs into drug_catalog -> rejected (ref_read is SELECT only)', async () => {
      const { error } = await clientA.from('drug_catalog').insert({
        id: 'd9999999-9999-4999-a999-999999999999',
        generic_name: 'Fabricated Drug',
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');
    });

    it('(g2) User A INSERTs into facilities -> rejected (reference data, no write policy)', async () => {
      // A user-writable facilities table would let anyone plant an unverified
      // destination on the escalation screen (§5.5, §6.3). It is reference data:
      // readable by authenticated users, writable by none of them.
      const { error } = await clientA.from('facilities').insert({
        id: 'f9999999-9999-4999-a999-999999999999',
        facility_type: 'hospital',
        name: 'Fabricated Emergency Hospital',
        address: '9 Nowhere Street',
        state: 'Lagos',
        lga: 'Ikeja',
        latitude: 6.5,
        longitude: 3.3,
        has_emergency: true,
        verified_at: '2026-01-15',
        verified_by: 'nobody',
        source: 'fabricated',
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe('42501');

      const { data: leaked } = await admin
        .from('facilities')
        .select('id')
        .eq('id', 'f9999999-9999-4999-a999-999999999999');
      expect(leaked).toEqual([]);
    });

    it('(g3) User A SELECTs from facilities -> rows returned', async () => {
      const { data, error } = await clientA
        .from('facilities')
        .select('id, name, has_emergency');

      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it('(h) User A SELECTs from drug_catalog -> rows returned', async () => {
      const { data, error } = await clientA
        .from('drug_catalog')
        .select('id, generic_name');

      expect(error).toBeNull();
      expect(data?.length ?? 0).toBeGreaterThanOrEqual(3);
    });

    it('(i) Updating a row in persons bumps updated_at above its previous value', async () => {
      const { data: before } = await clientA
        .from('persons')
        .select('updated_at')
        .eq('id', USER_A.personId)
        .single();
      expect(before?.updated_at).toBeTruthy();

      const { error } = await clientA
        .from('persons')
        .update({ weight_kg: 61.5 })
        .eq('id', USER_A.personId);
      expect(error).toBeNull();

      const { data: after } = await clientA
        .from('persons')
        .select('updated_at')
        .eq('id', USER_A.personId)
        .single();

      expect(new Date(after?.updated_at as string).getTime()).toBeGreaterThan(
        new Date(before?.updated_at as string).getTime(),
      );
    });

    it('(j) User B cannot see User A clinical_events either -> isolation is symmetric', async () => {
      const { data, error } = await clientB
        .from('clinical_events')
        .select('*')
        .eq('id', A_EVENT_READABLE);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
