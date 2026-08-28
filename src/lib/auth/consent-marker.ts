import type { NextRequest } from 'next/server';

/**
 * A marker recording that consent for a given version was successfully written.
 *
 * READ ONLY WHEN THE DATABASE IS UNREACHABLE. The consents table stays the
 * source of truth; this exists so that an offline user who consented months ago
 * is not bounced to a screen that cannot record anything without a connection.
 *
 * Set server-side, httpOnly, only after the consents row actually lands — so it
 * cannot claim a consent that was never stored. It is a cache of a fact, not the
 * fact itself, and it is ignored entirely whenever the real check can run.
 */

export const CONSENT_COOKIE = 'sana-consent-version';

export function hasConsentMarker(
  request: NextRequest,
  version: string,
): boolean {
  return request.cookies.get(CONSENT_COOKIE)?.value === version;
}

/** One year: a disclaimer version bump invalidates it long before expiry does. */
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
