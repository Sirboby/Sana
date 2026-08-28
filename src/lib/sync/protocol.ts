/**
 * Shared sync protocol constants and pure helpers (PRD §7).
 *
 * Imported by BOTH the route handlers and the client engine so the two cannot
 * drift on thresholds. A client that thinks the skew window is 48 hours while
 * the server enforces 24 produces rejections the client believes are impossible.
 */

/** §7.2: max mutations per batch. The client chunks larger sets. */
export const MAX_MUTATIONS_PER_BATCH = 500;

/** §7.3: max rows per pull page. */
export const PULL_PAGE_LIMIT = 1000;

/**
 * A client_updated_at further ahead than this is rejected outright.
 *
 * 24 hours is wide enough to absorb a timezone misconfiguration or a device that
 * has not synced its clock in a while, and narrow enough that a year-fast device
 * cannot silently win every conflict forever. Rejecting is kinder than accepting:
 * an accepted future timestamp poisons that row's conflict resolution
 * permanently, and nothing later can undo it.
 */
export const CLOCK_SKEW_REJECT_MS = 24 * 60 * 60 * 1000;

/** Beyond this the skew is logged as a warning but the write is still accepted. */
export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

export const REJECTION_CODES = {
  CLOCK_SKEW_FUTURE: 'CLOCK_SKEW_FUTURE',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  UNKNOWN_TABLE: 'UNKNOWN_TABLE',
  WRITE_FAILED: 'WRITE_FAILED',
  STALE: 'STALE',
} as const;

export type RejectionCode =
  (typeof REJECTION_CODES)[keyof typeof REJECTION_CODES];

export type ClockSkewAssessment =
  | { verdict: 'ok'; skewMs: number }
  | { verdict: 'warn'; skewMs: number }
  | { verdict: 'reject'; skewMs: number; code: 'CLOCK_SKEW_FUTURE' };

/**
 * Compare a client timestamp against server time.
 *
 * Only FUTURE skew is rejected. A clock that is behind produces writes that lose
 * conflicts they should have won — bad, but self-correcting once the clock is
 * fixed, and the row can be re-saved. A clock ahead poisons the record
 * permanently, because every later legitimate write compares as older.
 */
export function assessClockSkew(
  clientUpdatedAt: string,
  serverNow: Date,
): ClockSkewAssessment {
  const clientTime = new Date(clientUpdatedAt).getTime();
  if (Number.isNaN(clientTime)) {
    return { verdict: 'reject', skewMs: 0, code: 'CLOCK_SKEW_FUTURE' };
  }

  const skewMs = clientTime - serverNow.getTime();

  if (skewMs > CLOCK_SKEW_REJECT_MS) {
    return { verdict: 'reject', skewMs, code: 'CLOCK_SKEW_FUTURE' };
  }
  if (Math.abs(skewMs) > CLOCK_SKEW_WARN_MS) {
    return { verdict: 'warn', skewMs };
  }
  return { verdict: 'ok', skewMs };
}

/**
 * Backoff for a failed sync cycle (§7.1, AC-8.1.5).
 *
 * Exponential from 1s, doubling, ±25% jitter, capped at 5 minutes. The jitter
 * matters more than it looks: without it every device that lost connectivity at
 * the same moment retries at the same moment, and the reconnect stampede is
 * itself the next outage.
 */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
export const BACKOFF_JITTER = 0.25;

export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const uncapped = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
  const base = Math.min(uncapped, BACKOFF_MAX_MS);
  const jitter = base * BACKOFF_JITTER * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/** The undelivered range of a backoff curve, for assertions and for display. */
export function backoffBounds(attempt: number): { min: number; max: number } {
  const base = Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempt),
    BACKOFF_MAX_MS,
  );
  return {
    min: Math.round(base * (1 - BACKOFF_JITTER)),
    max: Math.round(base * (1 + BACKOFF_JITTER)),
  };
}

/** §7.1 triggers. */
export const SYNC_DEBOUNCE_MS = 2000;
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** A mutation that has failed this many times stops retrying (step 9 build 4). */
export const MAX_MUTATION_ATTEMPTS = 5;

/**
 * Upper bound on pull pages in one cycle.
 *
 * A cursor that never advances would otherwise spin forever, burning the battery
 * and the data plan of a user who can see nothing wrong. Failing loudly after a
 * bounded number of pages turns an invisible infinite loop into a reportable bug.
 */
export const MAX_PULL_PAGES = 50;
