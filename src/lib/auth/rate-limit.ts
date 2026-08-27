import type { SupabaseClient } from '@supabase/supabase-js';
import { newId } from '../schemas';

/**
 * Server-side rate limiting for one-time-code requests (AC-1.1.5).
 *
 * "Server-side, not just in the UI" is the whole point: a disabled button and a
 * 60-second countdown are courtesies to an honest user and no obstacle at all to
 * anyone posting directly at the endpoint. Someone doing that is either
 * enumerating which addresses have accounts or using the service to send mail to
 * a third party, and both are stopped here rather than in React.
 */

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 3;

export type RateLimitKind = 'email_otp' | 'sms_otp';

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  /** When the window frees up, for a "try again in N minutes" message. */
  retryAfterMs: number;
};

/**
 * Hash the identifier before it is stored or compared.
 *
 * The rate-limit table must not become a register of every email address that
 * ever touched the service — including addresses that never completed signup and
 * so never consented to anything. A hash limits exactly as well and remembers
 * nobody. Applies equally to phone numbers on the SMS path.
 */
export async function hashIdentifier(identifier: string): Promise<string> {
  const normalised = identifier.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalised),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Check and record a request in one step.
 *
 * The check-then-record ordering means a rejected request is NOT recorded, so
 * hammering the endpoint cannot extend the user's own lockout indefinitely — the
 * window still drains on schedule.
 *
 * `supabase` must be a SERVICE-ROLE client: `auth_rate_limits` has RLS enabled
 * with no policy, precisely so no client can read which addresses have been
 * used or clear its own counter.
 */
export async function consumeRateLimit(
  supabase: SupabaseClient,
  identifier: string,
  kind: RateLimitKind,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const identifierHash = await hashIdentifier(identifier);
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  const { data, error } = await supabase
    .from('auth_rate_limits')
    .select('requested_at')
    .eq('identifier_hash', identifierHash)
    .eq('kind', kind)
    .gte('requested_at', windowStart.toISOString())
    .order('requested_at', { ascending: true });

  // Fail CLOSED. If the limiter cannot be consulted it is not doing its job, and
  // an unlimited code-sending endpoint is worse than a temporarily unavailable
  // one — the failure mode is "try again shortly", not "send unlimited mail".
  if (error) {
    return { allowed: false, remaining: 0, retryAfterMs: 60_000 };
  }

  const recent = data ?? [];
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = recent[0]?.requested_at;
    const retryAfterMs = oldest
      ? Math.max(
          0,
          new Date(oldest).getTime() + RATE_LIMIT_WINDOW_MS - now.getTime(),
        )
      : RATE_LIMIT_WINDOW_MS;
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  await supabase.from('auth_rate_limits').insert({
    id: newId(),
    identifier_hash: identifierHash,
    kind,
    requested_at: now.toISOString(),
  });

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - (recent.length + 1),
    retryAfterMs: 0,
  };
}

/** Housekeeping: drop rows older than the window. Safe to call opportunistically. */
export async function reapExpiredRateLimits(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  await supabase.from('auth_rate_limits').delete().lt('requested_at', cutoff);
}
