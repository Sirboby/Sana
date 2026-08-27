import { classifyOtpFailure, otpFailureMessage } from '@/lib/auth/otp-errors';
import {
  checkRecoveryEligibility,
  normaliseRecoveryPhone,
} from '@/lib/auth/recovery';
import {
  createServerSupabase,
  createServiceRoleSupabase,
} from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/** Verify a recovery SMS code, establishing a session for the email change only. */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const { phone, token } = (body ?? {}) as { phone?: unknown; token?: unknown };
  const normalised = normaliseRecoveryPhone(
    typeof phone === 'string'
      ? phone
      : String((phone as { e164?: string })?.e164 ?? ''),
  );
  if (!normalised.ok) {
    return NextResponse.json({ error: normalised.message }, { status: 400 });
  }
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) {
    return NextResponse.json(
      { error: 'Enter the 6-digit code from the SMS.' },
      { status: 400 },
    );
  }

  // Re-checked here as well as in /request: the two endpoints are independently
  // reachable, and a verified-number check that only runs on the send path is no
  // check at all for anyone posting straight to this one.
  const eligibility = await checkRecoveryEligibility(
    createServiceRoleSupabase(),
    normalised.e164,
  );
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error:
          'That number is not a verified recovery channel for any account.',
      },
      { status: 403 },
    );
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalised.e164,
    token,
    type: 'sms',
  });

  if (error || !data.user) {
    const reason = classifyOtpFailure(error);
    return NextResponse.json(
      { error: otpFailureMessage(reason), reason },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
