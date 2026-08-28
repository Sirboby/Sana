import { SyncIndicator } from '@/components/SyncIndicator';
import { PersonSwitcher } from '@/components/auth/PersonSwitcher';
import { TodayDoses } from '@/components/dosing/TodayDoses';
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

/**
 * The today view (step 11).
 *
 * Leads with due doses, because that is what the app is for on an ordinary day
 * — and because this list is TIER 2, the reminder path that works with no
 * connection and no permissions.
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
      <h1>Today</h1>
      <SyncIndicator />

      <TodayDoses />

      <nav aria-label="Sections">
        <Link href="/app/meds">Your medicines</Link>
        <Link href="/app/settings">Settings</Link>
      </nav>

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
