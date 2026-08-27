import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The safety-disclaimer consent gate (PRD §2.4, US-1.2).
 *
 * §2.4 is explicit that this is not a footer and not a dismissible modal: it is
 * a screen the user must actively accept, version-tracked, and a changed
 * disclaimer requires re-consent. AC-1.2.1 makes it blocking for EVERY
 * authenticated route, which is why the check lives in middleware rather than in
 * individual pages — a page-level check is one forgotten import away from a hole.
 */

export const CONSENT_TYPE = 'safety_disclaimer';

/**
 * The disclaimer version currently in force. Bumping this env var invalidates
 * every existing consent and forces re-acceptance (AC-1.2.4), which is the
 * mechanism by which a changed safety disclaimer actually reaches users rather
 * than sitting unread.
 */
export function currentDisclaimerVersion(): string {
  return process.env.NEXT_PUBLIC_DISCLAIMER_VERSION ?? '1.0.0';
}

/**
 * Has this user accepted the CURRENT version?
 *
 * Deliberately checks the exact version rather than "any consent": a user who
 * accepted 1.0.0 has not accepted 1.1.0, and treating them as consented would
 * silently defeat §2.4's version tracking.
 */
export async function hasCurrentConsent(
  supabase: SupabaseClient,
  ownerId: string,
  version: string = currentDisclaimerVersion(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from('consents')
    .select('id, revoked_at')
    .eq('owner_id', ownerId)
    .eq('consent_type', CONSENT_TYPE)
    .eq('version', version)
    .is('revoked_at', null)
    .limit(1);

  // A failed lookup must NOT be read as "consented". Failing closed here means
  // the worst case is an extra consent screen; failing open would let someone
  // reach clinical guidance without ever seeing the disclaimer.
  if (error) return false;
  return (data?.length ?? 0) > 0;
}
