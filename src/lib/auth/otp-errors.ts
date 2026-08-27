/**
 * Mapping auth failures to messages a person can act on (AC-1.1.6).
 *
 * The requirement is that an EXPIRED code and an ALREADY-USED code produce
 * DISTINCT messages, never one generic "invalid code". The reason is practical:
 * those three situations call for three different actions. Expired means request
 * a new one. Already used means check whether you are already signed in on
 * another tab. Wrong means look at the email again. Collapsing them into one
 * message leaves the user guessing which of three things went wrong, and the
 * most common outcome is that they request code after code.
 */

export type OtpFailureReason =
  | 'expired'
  | 'already-used'
  | 'incorrect'
  | 'rate-limited'
  | 'network'
  | 'unknown';

type ErrorLike = { message?: unknown; status?: unknown; code?: unknown };

export function classifyOtpFailure(error: unknown): OtpFailureReason {
  const candidate: ErrorLike =
    typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
  const message =
    typeof candidate.message === 'string'
      ? candidate.message.toLowerCase()
      : '';
  const code =
    typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const status =
    typeof candidate.status === 'number' ? candidate.status : undefined;

  if (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    message.includes('rate limit')
  ) {
    return 'rate-limited';
  }
  if (code === 'otp_expired' || message.includes('expired')) return 'expired';
  if (
    message.includes('already been used') ||
    message.includes('already used') ||
    code === 'otp_disabled'
  ) {
    return 'already-used';
  }
  if (
    message.includes('invalid') ||
    message.includes('incorrect') ||
    code === 'invalid_credentials'
  ) {
    return 'incorrect';
  }
  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    status === 0
  ) {
    return 'network';
  }
  return 'unknown';
}

/**
 * User-facing copy. Deliberately contains no email address, no code, and no
 * internal error text — the step 5 constraints forbid logging or surfacing
 * either, and an error string is one screenshot away from being a log.
 */
export function otpFailureMessage(reason: OtpFailureReason): string {
  switch (reason) {
    case 'expired':
      return 'That code has expired. Request a new one — codes are only valid for a few minutes.';
    case 'already-used':
      return 'That code has already been used. If you are signed in on another tab you can continue there, otherwise request a new code.';
    case 'incorrect':
      return 'That code is not correct. Check the most recent email and try again.';
    case 'rate-limited':
      return 'Too many codes requested. Wait 15 minutes before trying again.';
    case 'network':
      return 'You need a connection to sign in. Reconnect and try again — data already on this device is unaffected.';
    default:
      return 'Something went wrong verifying that code. Request a new one.';
  }
}
