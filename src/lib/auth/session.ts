/**
 * Session lifecycle, and the one decision this file exists to get right:
 * telling "cannot reach the server" apart from "the server says you are not
 * authenticated".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Supabase refreshes access tokens on a timer. Offline, that refresh fails. The
 * naive implementation treats any refresh failure as a sign-out and redirects to
 * /login — where the user cannot proceed, because signing in requires a
 * connection. The app becomes unusable in exactly the conditions it was built
 * for, and the failure looks to the user like their account stopped working.
 *
 * So the two cases must never be conflated, and when they cannot be told apart
 * the safe answer is to RETAIN the session:
 *
 *   - Wrongly retaining a session costs almost nothing. Every server read is
 *     still gated by RLS, and an expired token is rejected the moment the device
 *     is back online.
 *   - Wrongly clearing a session locks a person out of their own medication
 *     schedule while they have no connection to fix it with.
 *
 * The asymmetry is the whole argument. `unknown` therefore resolves to retain.
 */

export type AuthFailureKind =
  /** The request never got an answer. Keep the session and retry later. */
  | 'network'
  /** The server answered and rejected the credential. Clear the session. */
  | 'unauthenticated'
  /** Could not tell. Treated as `network` — see the asymmetry above. */
  | 'unknown';

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null
    ? (error as ErrorLike)
    : {};
}

/**
 * Supabase's own signal for a fetch that never completed. It sets status 0 and
 * this name, which is the most reliable marker available.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  'AuthRetryableFetchError',
  'TypeError',
  'AbortError',
]);

/**
 * Messages Supabase and GoTrue use when a refresh token is genuinely rejected.
 * These arrive with HTTP 400, which is otherwise ambiguous, so the message is
 * what distinguishes "this token is dead" from "this request was malformed".
 */
const INVALID_TOKEN_MARKERS = [
  'refresh_token_not_found',
  'refresh token not found',
  'invalid refresh token',
  'already used',
  'revoked',
  'user not found',
  'session_not_found',
  'session not found',
];

export function classifyAuthFailure(error: unknown): AuthFailureKind {
  const candidate = asErrorLike(error);
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message =
    typeof candidate.message === 'string'
      ? candidate.message.toLowerCase()
      : '';
  const status =
    typeof candidate.status === 'number' ? candidate.status : undefined;

  // A browser that knows it is offline settles the question immediately.
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return 'network';

  if (RETRYABLE_ERROR_NAMES.has(name)) return 'network';
  if (message.includes('failed to fetch') || message.includes('network'))
    return 'network';
  if (message.includes('timeout') || message.includes('timed out'))
    return 'network';

  // status 0 means the request never reached a server.
  if (status === 0) return 'network';

  // 5xx is the server failing, not the credential failing. Signing the user out
  // because Supabase had a bad minute would be its own outage.
  if (status !== undefined && status >= 500) return 'network';

  if (status === 401 || status === 403) return 'unauthenticated';

  if (
    status === 400 &&
    INVALID_TOKEN_MARKERS.some((marker) => message.includes(marker))
  ) {
    return 'unauthenticated';
  }

  return 'unknown';
}

/** Whether a failed refresh should leave the user signed in. */
export function shouldRetainSession(error: unknown): boolean {
  return classifyAuthFailure(error) !== 'unauthenticated';
}

export type RefreshOutcome =
  | { status: 'refreshed' }
  | { status: 'retained'; reason: AuthFailureKind }
  | { status: 'cleared' };

/**
 * Decide what a refresh attempt means.
 *
 * Pure and dependency-free so the offline path can be tested without a browser,
 * a network, or a Supabase instance — tests (g) and (h) hinge on it.
 */
export function resolveRefreshOutcome(result: {
  error: unknown;
  hasSession: boolean;
}): RefreshOutcome {
  if (!result.error && result.hasSession) return { status: 'refreshed' };

  const kind = classifyAuthFailure(result.error);
  if (kind === 'unauthenticated') return { status: 'cleared' };
  return { status: 'retained', reason: kind };
}

/** Exponential backoff with jitter for retrying a refresh once connectivity returns. */
export function nextRetryDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 5 * 60 * 1000);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}
