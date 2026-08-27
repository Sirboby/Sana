/**
 * Transactional email for account-security notices (AC-1.4.5).
 *
 * NOT the sign-in code path — that is sent by Supabase Auth from its own
 * template. This is for messages Sana itself must send, currently just the
 * recovery email-change notices to the old and new address.
 *
 * PROVIDER STATUS: no provider is configured yet. Supabase's built-in SMTP is
 * rate-limited and, on hosted projects, only delivers to project members — it is
 * unsuitable for production, which is why the step 5 brief requires Resend,
 * Postmark or SendGrid with SPF, DKIM and DMARC on the sending domain.
 *
 * Until credentials exist this runs in TEST MODE: the message is handed to a
 * recorder rather than sent, so the recovery flow is complete and testable
 * end-to-end and the only missing piece is the provider call. It deliberately
 * does NOT silently no-op in production — see the throw below.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  body: string;
};

/**
 * Messages captured in test mode, for assertions. Never populated in production
 * because production refuses to run in test mode at all.
 */
const captured: OutboundEmail[] = [];

export function capturedEmails(): readonly OutboundEmail[] {
  return captured;
}

export function clearCapturedEmails(): void {
  captured.length = 0;
}

function providerConfigured(): boolean {
  return Boolean(
    process.env.EMAIL_PROVIDER_API_KEY && process.env.EMAIL_FROM_ADDRESS,
  );
}

export async function sendTransactionalEmail(
  message: OutboundEmail,
): Promise<void> {
  if (!providerConfigured()) {
    // Refuse to pretend in production. A security notice that was never sent,
    // reported as sent, is exactly the failure AC-1.4.5 exists to prevent: the
    // account owner would have no idea their email had been changed.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No transactional email provider is configured. Account-security notices cannot be delivered, so this operation is refused rather than completed silently.',
      );
    }
    // Never log the address or body — step 5 forbids it.
    captured.push(message);
    return;
  }

  // Provider call goes here once credentials exist. Left unimplemented rather
  // than guessed at, because the choice between Resend/Postmark/SendGrid is the
  // user's and each has a different payload shape.
  throw new Error('Email provider configured but no adapter implemented yet.');
}
