import { consumeRateLimit, reapExpiredRateLimits } from '@/lib/auth/rate-limit';
import { EmailSchema } from '@/lib/schemas';
import {
  createServerSupabase,
  createServiceRoleSupabase,
} from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Request a 6-digit sign-in code (US-1.1).
 *
 * CODE, NOT MAGIC LINK. `signInWithOtp` sends whichever Supabase email template
 * is configured; the template MUST use `{{ .Token }}` and must not contain
 * `{{ .ConfirmationURL }}`. A link opens in the mail client's webview or the
 * system browser rather than the installed PWA, so the session lands in the
 * wrong browsing context and the user comes back still apparently signed out.
 * `tests/e2e/auth.spec.ts` (i2) asserts the delivered mail carries a code and no
 * sign-in URL, so a future template edit cannot quietly reintroduce links.
 *
 * The rate limit is enforced HERE rather than in the UI, because a disabled
 * button stops nobody posting at this endpoint directly (AC-1.1.5).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const emailInput = (body as { email?: unknown })?.email;
  const parsed = EmailSchema.safeParse(emailInput);
  if (!parsed.success) {
    // No address in the response and none logged — step 5 constraint.
    return NextResponse.json(
      { error: 'Enter a valid email address.' },
      { status: 400 },
    );
  }
  const email = parsed.data;

  const serviceRole = createServiceRoleSupabase();
  const decision = await consumeRateLimit(serviceRole, email, 'email_otp');

  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: 'Too many codes requested. Wait 15 minutes before trying again.',
        retryAfterMs: decision.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
        },
      },
    );
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Signup and sign-in are one flow (AC-1.1.7): an existing user simply gets
      // a code, and the bootstrap on verify is idempotent.
      shouldCreateUser: true,
    },
  });

  if (error) {
    // Deliberately generic to the caller: distinguishing "no such account" from
    // "sent" here would turn this endpoint into an account-existence oracle.
    return NextResponse.json(
      { error: 'Could not send a code right now. Try again shortly.' },
      { status: 502 },
    );
  }

  // Opportunistic housekeeping; failure is harmless.
  void reapExpiredRateLimits(serviceRole).catch(() => undefined);

  return NextResponse.json({ ok: true, remaining: decision.remaining });
}
