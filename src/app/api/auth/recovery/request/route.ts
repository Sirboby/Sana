import { consumeRateLimit } from '@/lib/auth/rate-limit';
import {
  checkRecoveryEligibility,
  normaliseRecoveryPhone,
} from '@/lib/auth/recovery';
import {
  createServerSupabase,
  createServiceRoleSupabase,
} from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Send a recovery code by SMS (AC-1.4.2, AC-1.4.4).
 *
 * SMS PROVIDER STATUS: none configured. Nigerian networks block A2P SMS to
 * DND-registered numbers unless routed as transactional traffic through an
 * approved sender ID, so Termii or Africa's Talking is required rather than
 * Twilio. Until credentials exist this depends on whatever Supabase Auth is
 * configured with, and recovery is effectively test-mode only.
 *
 * Signup does NOT depend on any of this — email is the only login method, and
 * this whole feature is optional (AC-1.4.6).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const normalised = normaliseRecoveryPhone(
    String((body as { phone?: unknown })?.phone ?? ''),
  );
  if (!normalised.ok) {
    return NextResponse.json({ error: normalised.message }, { status: 400 });
  }

  const serviceRole = createServiceRoleSupabase();

  const limit = await consumeRateLimit(serviceRole, normalised.e164, 'sms_otp');
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          'Too many recovery codes requested. Wait 15 minutes before trying again.',
      },
      { status: 429 },
    );
  }

  // AC-1.4.2: an UNVERIFIED number is not a recovery channel. Someone who typed
  // a number into settings and never completed the SMS check has not shown
  // control of it, and a mistyped number belonging to a stranger must never
  // become a working key to someone else's health record.
  const eligibility = await checkRecoveryEligibility(
    serviceRole,
    normalised.e164,
  );
  if (!eligibility.eligible) {
    // One response for every ineligible case. Distinguishing "no such account"
    // from "not verified" would let anyone test which numbers hold accounts.
    return NextResponse.json({
      ok: true,
      note: 'If that number is a verified recovery channel, a code has been sent.',
    });
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    phone: normalised.e164,
  });

  if (error) {
    return NextResponse.json(
      { error: 'Could not send a recovery code right now. Try again shortly.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
