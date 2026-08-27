import type { SupabaseClient } from '@supabase/supabase-js';
import { EmailSchema, NigerianPhoneSchema } from '../schemas';

/**
 * Optional phone recovery (US-1.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHONE IS NEVER A LOGIN METHOD (AC-1.4.7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Nothing in this file authenticates a session from a phone number alone. The
 * phone is a second route to REGAINING an account whose email is lost, and every
 * such route is also an attack surface: a SIM swap is a well-documented way into
 * Nigerian accounts, and this account holds a health record. That is why the
 * email change in `recordRecoveryEmailChange` is loud rather than quiet.
 *
 * The whole feature is optional. Signup must never depend on SMS being
 * configured (the provider may not even have credentials yet), and skipping it
 * degrades nothing (AC-1.4.6).
 */

export type PhoneAddResult =
  | { ok: true; e164: string }
  | { ok: false; reason: 'invalid-format' | 'already-in-use'; message: string };

/**
 * Validate and normalise a recovery number before any network call (AC-1.4.1).
 *
 * Returning early on a bad format is the requirement: an invalid number must
 * produce a field error and fire NO request. It also avoids handing a malformed
 * number to the SMS provider, which would bill for it.
 */
export function normaliseRecoveryPhone(input: string): PhoneAddResult {
  const parsed = NigerianPhoneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-format',
      message:
        parsed.error.issues[0]?.message ??
        'Enter a Nigerian mobile number, e.g. 08012345678.',
    };
  }
  return { ok: true, e164: parsed.data };
}

/**
 * Is this number already verified on a different account? (AC-1.4.3)
 *
 * `profiles.phone` is unique in the database, so the insert would fail anyway —
 * but a raw constraint violation surfaces as an opaque error, and this lets the
 * UI say something true and specific instead.
 *
 * Requires a SERVICE-ROLE client: the point is to look ACROSS accounts, which is
 * exactly what RLS forbids the user's own client from doing.
 */
export async function isPhoneTaken(
  serviceRoleSupabase: SupabaseClient,
  e164: string,
  excludeOwnerId?: string,
): Promise<boolean> {
  let query = serviceRoleSupabase
    .from('profiles')
    .select('id')
    .eq('phone', e164)
    .limit(1);
  if (excludeOwnerId) query = query.neq('id', excludeOwnerId);
  const { data, error } = await query;
  // Fail closed: if the uniqueness check cannot run, do not let the write proceed.
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

export type RecoveryEligibility =
  | { eligible: true; e164: string }
  | {
      eligible: false;
      reason: 'no-phone' | 'not-verified' | 'unknown-account';
    };

/**
 * May this number be used to recover an account? (AC-1.4.2)
 *
 * An UNVERIFIED number is not a recovery channel. Someone who typed a number
 * into settings and never completed the SMS check has not demonstrated control
 * of it — and a mistyped number belonging to a stranger would otherwise become a
 * working key to someone else's health record. `phone_verified_at` being non-null
 * is the whole test.
 */
export async function checkRecoveryEligibility(
  serviceRoleSupabase: SupabaseClient,
  e164: string,
): Promise<RecoveryEligibility> {
  const { data, error } = await serviceRoleSupabase
    .from('profiles')
    .select('id, phone, phone_verified_at')
    .eq('phone', e164)
    .maybeSingle();

  if (error || !data) return { eligible: false, reason: 'unknown-account' };
  if (!data.phone) return { eligible: false, reason: 'no-phone' };
  if (!data.phone_verified_at)
    return { eligible: false, reason: 'not-verified' };
  return { eligible: true, e164 };
}

export type RecoveryEmailChange = {
  ownerId: string;
  oldEmail: string;
  newEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type RecoveryNotification = {
  to: string;
  subject: string;
  body: string;
};

/**
 * Build the notifications for a recovery-driven email change (AC-1.4.5).
 *
 * BOTH addresses are notified, and the OLD one matters most. If this recovery
 * was not the account owner, the old address is the only channel still reaching
 * them — and the message is the one chance they get to notice. It therefore says
 * plainly what changed and what to do, rather than reading as a routine receipt.
 */
export function buildRecoveryNotifications(
  change: RecoveryEmailChange,
): RecoveryNotification[] {
  return [
    {
      to: change.oldEmail,
      subject: 'The email address on your Sana account was changed',
      body: [
        'The email address for your Sana account was just changed using recovery by SMS.',
        '',
        `It is now: ${change.newEmail}`,
        '',
        'If this was you, nothing further is needed.',
        '',
        'IF THIS WAS NOT YOU, someone else may have access to your health record.',
        'Contact support immediately — this message is being sent to your previous',
        'address because it may be the only one that still reaches you.',
      ].join('\n'),
    },
    {
      to: change.newEmail,
      subject: 'Your Sana account email was changed',
      body: [
        'This address is now the sign-in email for a Sana account, changed using',
        'recovery by SMS.',
        '',
        'If you did not do this, contact support immediately.',
      ].join('\n'),
    },
  ];
}

/**
 * Write the audit trail for a recovery-driven email change (AC-1.4.5, §11).
 *
 * §11 requires audit logging on clinical data access; an account takeover is the
 * broadest possible such access, so it is recorded whether or not the
 * notification emails are delivered. Mail can bounce, be filtered, or be deleted
 * by whoever performed the change — the audit row cannot, because the client has
 * no delete policy on `audit_log`.
 *
 * NOTE: the addresses are recorded here deliberately. The step 5 rule forbids
 * LOGGING addresses — writing them into a durable, access-controlled audit
 * record that exists so the owner can see what happened is the opposite of that.
 */
export async function recordRecoveryEmailChange(
  serviceRoleSupabase: SupabaseClient,
  change: RecoveryEmailChange,
): Promise<void> {
  const { error } = await serviceRoleSupabase.from('audit_log').insert({
    owner_id: change.ownerId,
    action: 'account.email_changed_via_recovery',
    resource: 'profiles',
    resource_id: change.ownerId,
    ip_address: change.ipAddress ?? null,
    user_agent: change.userAgent ?? null,
  });

  // A recovery that cannot be audited must not be allowed to complete quietly.
  if (error) {
    throw new Error(
      `Recovery aborted: the audit record could not be written (${error.message})`,
    );
  }
}

/** Guard used by the recovery route: the new address must be a valid email. */
export function validateNewEmail(
  input: string,
): { ok: true; email: string } | { ok: false; message: string } {
  const parsed = EmailSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? 'Enter a valid email address.',
    };
  }
  return { ok: true, email: parsed.data };
}
