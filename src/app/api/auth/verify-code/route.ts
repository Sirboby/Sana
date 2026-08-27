import { bootstrapAccount } from '@/lib/auth/bootstrap';
import { classifyOtpFailure, otpFailureMessage } from '@/lib/auth/otp-errors';
import { EmailSchema } from '@/lib/schemas';
import {
  createServerSupabase,
  createServiceRoleSupabase,
} from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Verify a 6-digit code and bootstrap the account (AC-1.1.2, AC-1.1.6, AC-1.1.7).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const { email: emailInput, token } = (body ?? {}) as {
    email?: unknown;
    token?: unknown;
  };

  const parsedEmail = EmailSchema.safeParse(emailInput);
  if (!parsedEmail.success) {
    return NextResponse.json(
      { error: 'Enter a valid email address.' },
      { status: 400 },
    );
  }
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) {
    return NextResponse.json(
      { error: 'Enter the 6-digit code from the email.' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.verifyOtp({
    email: parsedEmail.data,
    token,
    type: 'email',
  });

  if (error || !data.user) {
    // Expired, already-used and simply-wrong get DISTINCT messages (AC-1.1.6):
    // each calls for a different action from the user.
    const reason = classifyOtpFailure(error);
    return NextResponse.json(
      { error: otpFailureMessage(reason), reason },
      { status: reason === 'rate-limited' ? 429 : 400 },
    );
  }

  // Runs on EVERY verification, not just the first — idempotent by construction.
  // Uses the service role because the profiles row must exist before the user
  // has one, and RLS policies are written in terms of a profile that is not
  // there yet.
  const bootstrap = await bootstrapAccount(createServiceRoleSupabase(), {
    userId: data.user.id,
    email: parsedEmail.data,
  });

  return NextResponse.json({
    ok: true,
    selfPersonId: bootstrap.selfPersonId,
    created: bootstrap.created,
  });
}
