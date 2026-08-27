import {
  buildRecoveryNotifications,
  recordRecoveryEmailChange,
  validateNewEmail,
} from '@/lib/auth/recovery';
import { sendTransactionalEmail } from '@/lib/email/send';
import {
  createServerSupabase,
  createServiceRoleSupabase,
} from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Complete a recovery by changing the account email (AC-1.4.4, AC-1.4.5).
 *
 * Requires an already-verified recovery session — the caller must have proved
 * control of the registered phone via /api/auth/recovery/verify first.
 *
 * ORDER MATTERS HERE. The audit row is written BEFORE the email is changed, and
 * a failure to write it aborts the whole operation. This flow is an account
 * takeover path into a health record: if the trail cannot be recorded, the
 * change must not happen. An untraceable takeover is worse than a failed
 * recovery, because the legitimate owner has no way to discover it.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const validated = validateNewEmail(
    String((body as { newEmail?: unknown })?.newEmail ?? ''),
  );
  if (!validated.ok) {
    return NextResponse.json({ error: validated.message }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: session, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !session.user) {
    return NextResponse.json(
      {
        error:
          'Verify your recovery phone number before changing the email address.',
      },
      { status: 401 },
    );
  }

  const serviceRole = createServiceRoleSupabase();

  const { data: profile } = await serviceRole
    .from('profiles')
    .select('id, email')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }

  const change = {
    ownerId: profile.id,
    oldEmail: profile.email as string,
    newEmail: validated.email,
    ipAddress: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  };

  // Throws if the audit row cannot be written, which aborts the change.
  await recordRecoveryEmailChange(serviceRole, change);

  const { error: updateError } = await serviceRole.auth.admin.updateUserById(
    profile.id,
    {
      email: validated.email,
      email_confirm: true,
    },
  );
  if (updateError) {
    return NextResponse.json(
      { error: 'Could not change the email address.' },
      { status: 502 },
    );
  }

  await serviceRole
    .from('profiles')
    .update({ email: validated.email })
    .eq('id', profile.id);

  // BOTH addresses are told (AC-1.4.5). Delivery failure does not roll the
  // change back — the audit row is already durable — but it is surfaced so the
  // gap is known rather than assumed away.
  const notifications = buildRecoveryNotifications(change);
  const delivery = await Promise.allSettled(
    notifications.map(sendTransactionalEmail),
  );
  const notified = delivery.every((result) => result.status === 'fulfilled');

  return NextResponse.json({ ok: true, notified });
}
