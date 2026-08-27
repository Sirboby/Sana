import { PersonSwitcher } from '@/components/auth/PersonSwitcher';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

/**
 * Authenticated placeholder (step 5), proving the whole chain works:
 * code sign-in -> bootstrap -> consent -> unlock -> here.
 *
 * The brief asks this to show "the authenticated user's phone"; since v1.3 made
 * email the login identifier and phone an optional recovery channel, it shows
 * the email and the phone's recovery status instead. A phone is frequently
 * absent by design (AC-1.4.6), so rendering it as the identity would show most
 * users a blank.
 *
 * No clinical content — step 5 is explicitly not that.
 */
export default async function AppPage() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, phone, phone_verified_at, display_name')
    .eq('id', data.user.id)
    .maybeSingle();

  const { data: persons } = await supabase
    .from('persons')
    .select('id, display_name, relationship')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  return (
    <main>
      <h1>Signed in</h1>

      <section aria-label="Account">
        <h2>Account</h2>
        <p>Email: {profile?.email ?? '—'}</p>
        <p>
          Recovery phone:{' '}
          {profile?.phone
            ? `${profile.phone} ${profile.phone_verified_at ? '(verified)' : '(not verified — not usable for recovery)'}`
            : 'not set (optional)'}
        </p>
      </section>

      <PersonSwitcher persons={persons ?? []} />
    </main>
  );
}
