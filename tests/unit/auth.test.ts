import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapAccount } from '../../src/lib/auth/bootstrap';
import { CONSENT_TYPE, hasCurrentConsent } from '../../src/lib/auth/consent';
import {
  classifyOtpFailure,
  otpFailureMessage,
} from '../../src/lib/auth/otp-errors';
import {
  RATE_LIMIT_MAX_REQUESTS,
  consumeRateLimit,
  hashIdentifier,
} from '../../src/lib/auth/rate-limit';
import {
  buildRecoveryNotifications,
  checkRecoveryEligibility,
  isPhoneTaken,
  normaliseRecoveryPhone,
  recordRecoveryEmailChange,
} from '../../src/lib/auth/recovery';
import {
  classifyAuthFailure,
  resolveRefreshOutcome,
} from '../../src/lib/auth/session';
import { EmailSchema } from '../../src/lib/schemas';

/**
 * Auth unit tests (step 5).
 *
 * The Supabase client is faked with a tiny in-memory query builder rather than
 * mocked call-by-call, so these exercise the real module logic — the ordering in
 * bootstrap, the fail-closed branches, the classifier tables — instead of
 * asserting that mocks were called.
 */

type Row = Record<string, unknown>;

/** Minimal stand-in for the PostgREST builder surface these modules use. */
function fakeSupabase(
  tables: Record<string, Row[]>,
  options?: { failOn?: Set<string> },
) {
  const failOn = options?.failOn ?? new Set<string>();

  function from(table: string) {
    let rows = [...(tables[table] ?? [])];

    // A thenable: every chain method returns `builder`, and awaiting it resolves
    // to the current row set. PostgREST builders behave the same way, which is
    // what lets `await supabase.from(x).select().eq(...)` work.
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] !== value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        rows = rows.filter((row) =>
          value === null ? row[column] == null : row[column] === value,
        );
        return builder;
      },
      gte: (column: string, value: unknown) => {
        rows = rows.filter((row) => String(row[column]) >= String(value));
        return builder;
      },
      lt: () => builder,
      order: () => builder,
      limit: (count: number) => {
        rows = rows.slice(0, count);
        return builder;
      },
      maybeSingle: async () =>
        failOn.has(table)
          ? { data: null, error: { message: 'boom' } }
          : { data: rows[0] ?? null, error: null },
      insert: async (row: Row | Row[]) => {
        if (failOn.has(table))
          return { data: null, error: { message: 'insert failed' } };
        const incoming = Array.isArray(row) ? row : [row];
        tables[table] = [...(tables[table] ?? []), ...incoming];
        return { data: incoming, error: null };
      },
      upsert: async (row: Row) => {
        if (failOn.has(table))
          return { data: null, error: { message: 'upsert failed' } };
        const existing = tables[table] ?? [];
        if (!existing.some((candidate) => candidate.id === row.id)) {
          tables[table] = [...existing, row];
        }
        return { data: [row], error: null };
      },
      update: (patch: Row) => ({
        eq: async (column: string, value: unknown) => {
          tables[table] = (tables[table] ?? []).map((row) =>
            row[column] === value ? { ...row, ...patch } : row,
          );
          return { data: null, error: null };
        },
      }),
      delete: () => ({ lt: async () => ({ data: null, error: null }) }),
      // A PostgREST query builder IS a thenable — that is what makes
      // `await supabase.from(x).select().eq(...)` work with no execute step.
      // The fake has to be one too, or it would not exercise the code paths the
      // real client drives.
      // biome-ignore lint/suspicious/noThenProperty: deliberately mimics PostgREST
      then: (
        resolve: (value: { data: Row[] | null; error: unknown }) => void,
      ) =>
        resolve(
          failOn.has(table)
            ? { data: null, error: { message: 'select failed' } }
            : { data: rows, error: null },
        ),
    };

    return builder;
  }

  return { from, __tables: tables } as unknown as Parameters<
    typeof hasCurrentConsent
  >[0] & {
    __tables: Record<string, Row[]>;
  };
}

// ─────────────────────── (a) email validation before any call ───────────────

describe('(a) email validation runs before any auth call (AC-1.1.3)', () => {
  it.each(['', 'nope', 'a@b', 'no-at-sign.com', '   '])(
    'rejects %s without firing a request',
    (input) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const parsed = EmailSchema.safeParse(input);
      if (parsed.success) {
        // Would only reach the network on a valid address.
        void fetch('/api/auth/request-code');
      }

      expect(parsed.success).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );

  it('normalises a valid address before it is sent anywhere', () => {
    expect(EmailSchema.parse('  User@Example.COM ')).toBe('user@example.com');
  });
});

// ─────────────────────── (b) (f3) bootstrap idempotence ─────────────────────

describe('(b) bootstrap is idempotent', () => {
  it('two verifications create one profile and one person', async () => {
    const tables: Record<string, Row[]> = { profiles: [], persons: [] };
    const supabase = fakeSupabase(tables);

    const first = await bootstrapAccount(supabase, {
      userId: 'user-1',
      email: 'a@example.com',
    });
    const second = await bootstrapAccount(supabase, {
      userId: 'user-1',
      email: 'a@example.com',
    });

    expect(tables.profiles).toHaveLength(1);
    expect(tables.persons).toHaveLength(1);
    expect(second.selfPersonId).toBe(first.selfPersonId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('creates the self person with relationship=self and a UUIDv7 id', async () => {
    const tables: Record<string, Row[]> = { profiles: [], persons: [] };
    await bootstrapAccount(fakeSupabase(tables), {
      userId: 'user-1',
      email: 'a@example.com',
    });

    const person = tables.persons?.[0];
    expect(person?.relationship).toBe('self');
    expect(person?.owner_id).toBe('user-1');
    expect(String(person?.id)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('(f3) an existing user creates no duplicate profile (AC-1.1.7)', () => {
  it('reuses the existing profile and self person', async () => {
    const tables: Record<string, Row[]> = {
      profiles: [{ id: 'user-1', email: 'a@example.com', display_name: 'Me' }],
      persons: [
        {
          id: 'person-1',
          owner_id: 'user-1',
          relationship: 'self',
          deleted_at: null,
        },
      ],
    };

    const result = await bootstrapAccount(fakeSupabase(tables), {
      userId: 'user-1',
      email: 'a@example.com',
    });

    expect(tables.profiles).toHaveLength(1);
    expect(tables.persons).toHaveLength(1);
    expect(result.selfPersonId).toBe('person-1');
    expect(result.created).toBe(false);
  });
});

// ─────────────────────── (c) (d) (e) consent gate ───────────────────────────

describe('consent gate (AC-1.2.1, AC-1.2.4)', () => {
  const OWNER = 'user-1';

  it('(c) reports not-consented when no consent row exists', async () => {
    const supabase = fakeSupabase({ consents: [] });
    expect(await hasCurrentConsent(supabase, OWNER, '1.0.0')).toBe(false);
  });

  it('(d) reports not-consented when only an OLD version is accepted', async () => {
    const supabase = fakeSupabase({
      consents: [
        {
          id: 'c1',
          owner_id: OWNER,
          consent_type: CONSENT_TYPE,
          version: '1.0.0',
          revoked_at: null,
        },
      ],
    });
    // A version bump must force re-consent.
    expect(await hasCurrentConsent(supabase, OWNER, '1.1.0')).toBe(false);
  });

  it('(e) passes through when the current version is consented', async () => {
    const supabase = fakeSupabase({
      consents: [
        {
          id: 'c1',
          owner_id: OWNER,
          consent_type: CONSENT_TYPE,
          version: '1.1.0',
          revoked_at: null,
        },
      ],
    });
    expect(await hasCurrentConsent(supabase, OWNER, '1.1.0')).toBe(true);
  });

  it('ignores a revoked consent', async () => {
    const supabase = fakeSupabase({
      consents: [
        {
          id: 'c1',
          owner_id: OWNER,
          consent_type: CONSENT_TYPE,
          version: '1.1.0',
          revoked_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(await hasCurrentConsent(supabase, OWNER, '1.1.0')).toBe(false);
  });

  it('FAILS CLOSED when the consent lookup errors', async () => {
    // A failed lookup must never read as "consented" — the worst case of failing
    // closed is an extra consent screen; failing open would show clinical
    // guidance to someone who never saw the disclaimer.
    const supabase = fakeSupabase(
      { consents: [] },
      { failOn: new Set(['consents']) },
    );
    expect(await hasCurrentConsent(supabase, OWNER, '1.1.0')).toBe(false);
  });
});

// ─────────────────────── (f) rate limiting ──────────────────────────────────

describe('(f) rate limiting rejects a 4th request in the window (AC-1.1.5)', () => {
  it('allows three then rejects', async () => {
    const tables: Record<string, Row[]> = { auth_rate_limits: [] };
    const supabase = fakeSupabase(tables);
    const now = new Date('2026-01-01T12:00:00.000Z');

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      const decision = await consumeRateLimit(
        supabase,
        'a@example.com',
        'email_otp',
        now,
      );
      expect(decision.allowed, `attempt ${attempt} should be allowed`).toBe(
        true,
      );
    }

    const fourth = await consumeRateLimit(
      supabase,
      'a@example.com',
      'email_otp',
      now,
    );
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);

    // A rejected request is not recorded, so hammering cannot extend the lockout.
    expect(tables.auth_rate_limits).toHaveLength(RATE_LIMIT_MAX_REQUESTS);
  });

  it('allows again once the window has passed', async () => {
    const tables: Record<string, Row[]> = { auth_rate_limits: [] };
    const supabase = fakeSupabase(tables);
    const start = new Date('2026-01-01T12:00:00.000Z');

    for (let attempt = 0; attempt < RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      await consumeRateLimit(supabase, 'a@example.com', 'email_otp', start);
    }

    const later = new Date(start.getTime() + 16 * 60 * 1000);
    expect(
      (await consumeRateLimit(supabase, 'a@example.com', 'email_otp', later))
        .allowed,
    ).toBe(true);
  });

  it('limits per address, not globally', async () => {
    const supabase = fakeSupabase({ auth_rate_limits: [] });
    const now = new Date('2026-01-01T12:00:00.000Z');
    for (let attempt = 0; attempt < RATE_LIMIT_MAX_REQUESTS; attempt += 1) {
      await consumeRateLimit(supabase, 'a@example.com', 'email_otp', now);
    }
    expect(
      (await consumeRateLimit(supabase, 'b@example.com', 'email_otp', now))
        .allowed,
    ).toBe(true);
  });

  it('stores a hash, never the address itself', async () => {
    const tables: Record<string, Row[]> = { auth_rate_limits: [] };
    await consumeRateLimit(fakeSupabase(tables), 'a@example.com', 'email_otp');
    const stored = JSON.stringify(tables.auth_rate_limits);
    expect(stored).not.toContain('a@example.com');
    expect(tables.auth_rate_limits?.[0]?.identifier_hash).toBe(
      await hashIdentifier('a@example.com'),
    );
  });

  it('FAILS CLOSED if the limiter cannot be consulted', async () => {
    const supabase = fakeSupabase(
      { auth_rate_limits: [] },
      { failOn: new Set(['auth_rate_limits']) },
    );
    expect(
      (await consumeRateLimit(supabase, 'a@example.com', 'email_otp')).allowed,
    ).toBe(false);
  });
});

// ─────────────────────── (f2) distinct OTP failure messages ─────────────────

describe('(f2) expired and already-used codes fail with DISTINCT messages (AC-1.1.6)', () => {
  const expired = {
    message: 'Token has expired or is invalid',
    code: 'otp_expired',
    status: 403,
  };
  const alreadyUsed = { message: 'Token has already been used', status: 400 };
  const incorrect = { message: 'Invalid token', status: 400 };

  it('classifies each differently', () => {
    expect(classifyOtpFailure(expired)).toBe('expired');
    expect(classifyOtpFailure(alreadyUsed)).toBe('already-used');
    expect(classifyOtpFailure(incorrect)).toBe('incorrect');
  });

  it('produces three different messages, none of them generic', () => {
    const messages = [expired, alreadyUsed, incorrect].map((error) =>
      otpFailureMessage(classifyOtpFailure(error)),
    );
    expect(new Set(messages).size).toBe(3);
    expect(messages[0]).toContain('expired');
    expect(messages[1]).toContain('already been used');
    expect(messages[2]).toContain('not correct');
  });

  it('never leaks the code or the address into the message', () => {
    for (const reason of [
      'expired',
      'already-used',
      'incorrect',
      'rate-limited',
    ] as const) {
      const message = otpFailureMessage(reason);
      expect(message).not.toMatch(/\d{6}/);
      expect(message).not.toContain('@');
    }
  });
});

// ─────────────────────── (f4) (f5) (f6) recovery ────────────────────────────

describe('(f4) an unverified phone is rejected as a recovery channel (AC-1.4.2)', () => {
  it('rejects a number with no phone_verified_at', async () => {
    const supabase = fakeSupabase({
      profiles: [
        { id: 'user-1', phone: '+2348012345678', phone_verified_at: null },
      ],
    });
    const result = await checkRecoveryEligibility(supabase, '+2348012345678');
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toBe('not-verified');
  });

  it('accepts a verified number', async () => {
    const supabase = fakeSupabase({
      profiles: [
        {
          id: 'user-1',
          phone: '+2348012345678',
          phone_verified_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(
      (await checkRecoveryEligibility(supabase, '+2348012345678')).eligible,
    ).toBe(true);
  });

  it('rejects an unknown number', async () => {
    const supabase = fakeSupabase({ profiles: [] });
    const result = await checkRecoveryEligibility(supabase, '+2348012345678');
    expect(result.eligible).toBe(false);
  });
});

describe('(f5) a phone verified on another account cannot be added (AC-1.4.3)', () => {
  it('reports the number as taken', async () => {
    const supabase = fakeSupabase({
      profiles: [{ id: 'other-user', phone: '+2348012345678' }],
    });
    expect(await isPhoneTaken(supabase, '+2348012345678', 'user-1')).toBe(true);
  });

  it('does not report the caller’s own number as taken', async () => {
    const supabase = fakeSupabase({
      profiles: [{ id: 'user-1', phone: '+2348012345678' }],
    });
    expect(await isPhoneTaken(supabase, '+2348012345678', 'user-1')).toBe(
      false,
    );
  });

  it('normalises before comparing, so 0801… and +234801… are the same number', () => {
    const a = normaliseRecoveryPhone('08012345678');
    const b = normaliseRecoveryPhone('+2348012345678');
    expect(a.ok && b.ok && a.e164 === b.e164).toBe(true);
  });

  it('rejects an invalid format with no network call (AC-1.4.1)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = normaliseRecoveryPhone('1234');
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('(f6) a recovery email change notifies BOTH addresses and audits (AC-1.4.5)', () => {
  const change = {
    ownerId: 'user-1',
    oldEmail: 'old@example.com',
    newEmail: 'new@example.com',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
  };

  it('builds notifications for the old AND the new address', () => {
    const notifications = buildRecoveryNotifications(change);
    expect(notifications.map((n) => n.to)).toEqual([
      'old@example.com',
      'new@example.com',
    ]);
  });

  it('tells the OLD address plainly that this may not have been them', () => {
    const [toOld] = buildRecoveryNotifications(change);
    // The old address may be the only channel still reaching a victim, so the
    // message has to be alarming enough to act on, not a routine receipt.
    expect(toOld?.body).toContain('IF THIS WAS NOT YOU');
    expect(toOld?.body).toContain('new@example.com');
  });

  it('writes an audit_log row', async () => {
    const tables: Record<string, Row[]> = { audit_log: [] };
    await recordRecoveryEmailChange(fakeSupabase(tables), change);

    expect(tables.audit_log).toHaveLength(1);
    expect(tables.audit_log?.[0]).toMatchObject({
      owner_id: 'user-1',
      action: 'account.email_changed_via_recovery',
      resource: 'profiles',
    });
  });

  it('ABORTS the recovery if the audit row cannot be written', async () => {
    // An untraceable account takeover is worse than a failed recovery: the
    // legitimate owner would have no way to discover it.
    const supabase = fakeSupabase(
      { audit_log: [] },
      { failOn: new Set(['audit_log']) },
    );
    await expect(recordRecoveryEmailChange(supabase, change)).rejects.toThrow(
      /audit/i,
    );
  });
});

// ─────────────────────── (g) (h) offline vs invalid ─────────────────────────

describe('(g) OFFLINE: a network-failed refresh RETAINS the session', () => {
  const networkFailures = [
    { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
    new TypeError('Failed to fetch'),
    { message: 'network request timed out' },
    { name: 'AbortError', message: 'The operation was aborted' },
    { message: 'Service Unavailable', status: 503 },
    { message: 'Internal Server Error', status: 500 },
  ];

  it.each(networkFailures)('classifies %o as network', (error) => {
    expect(classifyAuthFailure(error)).toBe('network');
  });

  it('retains the session and does not redirect', () => {
    const outcome = resolveRefreshOutcome({
      error: {
        name: 'AuthRetryableFetchError',
        message: 'Failed to fetch',
        status: 0,
      },
      hasSession: true,
    });
    expect(outcome.status).toBe('retained');
  });

  it('retains on an UNRECOGNISED error too — the asymmetry favours staying in', () => {
    // Wrongly retaining costs little: RLS still gates every server read. Wrongly
    // clearing locks someone out of their medication schedule with no connection
    // to fix it with.
    const outcome = resolveRefreshOutcome({
      error: { message: 'something odd' },
      hasSession: true,
    });
    expect(outcome.status).toBe('retained');
    if (outcome.status === 'retained') expect(outcome.reason).toBe('unknown');
  });

  it('treats navigator.onLine === false as decisive', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(classifyAuthFailure({ status: 401, message: 'Unauthorized' })).toBe(
      'network',
    );
    vi.unstubAllGlobals();
  });
});

describe('(h) a server 401 CLEARS the session', () => {
  const rejections = [
    { message: 'Unauthorized', status: 401 },
    { message: 'Forbidden', status: 403 },
    { message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400 },
    { message: 'refresh_token_not_found', status: 400 },
    { message: 'Session not found', status: 400 },
  ];

  it.each(rejections)('classifies %o as unauthenticated', (error) => {
    expect(classifyAuthFailure(error)).toBe('unauthenticated');
  });

  it('clears the session', () => {
    const outcome = resolveRefreshOutcome({
      error: { message: 'Unauthorized', status: 401 },
      hasSession: false,
    });
    expect(outcome.status).toBe('cleared');
  });

  it('reports refreshed on success', () => {
    expect(
      resolveRefreshOutcome({ error: null, hasSession: true }).status,
    ).toBe('refreshed');
  });
});

describe('(g)+(h) together: the two cases are never conflated', () => {
  it('a network failure and a 401 produce opposite outcomes', () => {
    const offline = resolveRefreshOutcome({
      error: {
        name: 'AuthRetryableFetchError',
        status: 0,
        message: 'Failed to fetch',
      },
      hasSession: true,
    });
    const rejected = resolveRefreshOutcome({
      error: { status: 401, message: 'Unauthorized' },
      hasSession: false,
    });

    expect(offline.status).toBe('retained');
    expect(rejected.status).toBe('cleared');
    expect(offline.status).not.toBe(rejected.status);
  });
});

// ─────────────────────── phone is never a login method ──────────────────────

describe('AC-1.4.7: phone is never a login identifier', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('the email schema rejects a phone number outright', () => {
    expect(EmailSchema.safeParse('+2348012345678').success).toBe(false);
    expect(EmailSchema.safeParse('08012345678').success).toBe(false);
  });
});
