import { createServerSupabase } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/push/subscribe — store a Web Push subscription (Tier 1).
 *
 * Subscriptions live in `sync_meta`-style key/value rows on the server rather
 * than a dedicated table, because migration 012 is not needed for step 11 and a
 * subscription is device state rather than clinical data.
 *
 * NOTE ON TIER 1's LIMITS: a stored subscription is not a guarantee. Push
 * requires a connection AT THE MOMENT the dose is due, and on iOS it requires
 * the PWA to be installed. The settings copy says so; this endpoint just stores
 * what it is given.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const subscription = (body as { subscription?: unknown })?.subscription;
  if (typeof subscription !== 'object' || subscription === null) {
    return NextResponse.json(
      { error: 'A subscription is required.' },
      { status: 400 },
    );
  }

  const endpoint = (subscription as { endpoint?: unknown }).endpoint;
  if (typeof endpoint !== 'string') {
    return NextResponse.json(
      { error: 'A subscription endpoint is required.' },
      { status: 400 },
    );
  }

  // Recorded as an audit event rather than a bespoke table: it is a device
  // registration, and §11 wants account-level actions traceable.
  await supabase.from('audit_log').insert({
    owner_id: auth.user.id,
    action: 'push.subscribed',
    resource: 'push_subscription',
    resource_id: null,
    user_agent: request.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true, stored: true });
}
