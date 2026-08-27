import type { SupabaseClient } from '@supabase/supabase-js';
import { newId } from '../schemas';

/**
 * First-run bootstrap: the `profiles` row and the account's own `persons` row
 * (AC-1.1.2, AC-1.1.7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCE IS THE REQUIREMENT, NOT A NICETY
 * ─────────────────────────────────────────────────────────────────────────────
 * Signup and sign-in are one flow, so this runs on EVERY successful
 * verification, not only the first. A returning user of two years hits this code
 * path each time they sign in. If it were not idempotent they would accumulate a
 * duplicate "self" person on every login, and since every clinical record hangs
 * off `person_id`, their medication list would silently fragment across
 * duplicates.
 *
 * Idempotence rests on the database, not on a read-then-write check: two
 * verifications racing (two tabs, a retried request) would both read "no profile
 * exists" and both insert. `on conflict do nothing` — expressed here as
 * `upsert(..., { ignoreDuplicates: true })` — is decided by the primary key
 * inside a single statement, so the race has one winner and no error.
 *
 * `profiles.id` is `auth.users.id`, so it is naturally unique per account.
 * The self person is found by (owner_id, relationship='self') rather than a
 * generated id, because its id is client-generated and differs per call.
 */

export type BootstrapResult = {
  profileId: string;
  selfPersonId: string;
  /** True only on the run that actually created rows — for "welcome" copy. */
  created: boolean;
};

export async function bootstrapAccount(
  supabase: SupabaseClient,
  params: { userId: string; email: string; displayName?: string },
): Promise<BootstrapResult> {
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName?.trim() || 'Me';

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', params.userId)
    .maybeSingle();

  if (!existingProfile) {
    // ignoreDuplicates makes a concurrent second call a no-op rather than a
    // unique-violation error.
    const { error } = await supabase
      .from('profiles')
      .upsert(
        { id: params.userId, email, display_name: displayName },
        { ignoreDuplicates: true },
      );
    if (error)
      throw new Error(`Could not create the profile: ${error.message}`);
  }

  const { data: existingPerson } = await supabase
    .from('persons')
    .select('id')
    .eq('owner_id', params.userId)
    .eq('relationship', 'self')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (existingPerson) {
    return {
      profileId: params.userId,
      selfPersonId: existingPerson.id,
      created: false,
    };
  }

  // Client-generated UUIDv7 per PRD §0.
  const selfPersonId = newId();
  const { error: personError } = await supabase.from('persons').insert({
    id: selfPersonId,
    owner_id: params.userId,
    display_name: displayName,
    relationship: 'self',
    sex_at_birth: 'undisclosed',
  });

  if (personError) {
    // Lost a race with a concurrent bootstrap: re-read rather than fail, so the
    // second tab sees the same self person the first one created.
    const { data: raced } = await supabase
      .from('persons')
      .select('id')
      .eq('owner_id', params.userId)
      .eq('relationship', 'self')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (raced) {
      return {
        profileId: params.userId,
        selfPersonId: raced.id,
        created: false,
      };
    }
    throw new Error(`Could not create the self person: ${personError.message}`);
  }

  return { profileId: params.userId, selfPersonId, created: !existingProfile };
}
