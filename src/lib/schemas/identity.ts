import { z } from 'zod';

/**
 * Account identifiers.
 *
 * PRD v1.3 moved authentication from phone-primary to email-primary (§4 US-1.1).
 * Email is the ONLY login identifier. Phone is an optional recovery channel
 * (US-1.4) and must never be accepted as a login method — AC-1.4.3.
 *
 * This file was specified as `phone.ts` in the original step 3 brief and renamed
 * to `identity.ts` by the v1.3 correction, because it is no longer about phones.
 */

/**
 * Login identifier (AC-1.1.1, AC-1.1.3).
 *
 * Trimmed and lowercased so that `  User@Example.COM ` and `user@example.com`
 * cannot become two accounts. Postgres holds `profiles.email` under a plain
 * unique constraint, which is case-SENSITIVE — normalising here is what makes
 * that constraint mean what we intend it to mean.
 */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter an email address')
  .max(254, 'That email address is too long')
  .email('Enter a valid email address');
export type Email = z.infer<typeof EmailSchema>;

/**
 * E.164 Nigerian mobile number.
 *
 * RECOVERY ONLY. Phone is never a login method (AC-1.4.3) — if you are reaching
 * for this in an auth path, that is the bug.
 */
export const E164NigerianPhoneSchema = z
  .string()
  .regex(
    /^\+234[789]\d{9}$/,
    'Expected a normalised Nigerian number, e.g. +2348012345678',
  );
export type E164NigerianPhone = z.infer<typeof E164NigerianPhoneSchema>;

const PHONE_ERROR =
  'Enter a Nigerian mobile number, e.g. 08012345678, +2348012345678 or 2348012345678';

/**
 * Reduce a Nigerian mobile number to its 10-digit national significant number.
 *
 * Accepts the three forms people actually type (AC-1.4.2):
 *   `0` + 10 digits      — 08012345678, how it is written locally
 *   `234` + 10 digits    — 2348012345678, common when copied from a contact list
 *   `+234` + 10 digits   — +2348012345678, already E.164
 *
 * The national number always begins 7, 8 or 9; those are the mobile prefixes
 * NCC has allocated. Landlines are deliberately rejected — this field exists to
 * receive a recovery SMS.
 *
 * Returns null when the input is not a recognisable Nigerian mobile number.
 */
function toNationalSignificantNumber(input: string): string | null {
  // Strip the separators people type: spaces, dashes, dots, brackets.
  const cleaned = input.replace(/[\s().-]/g, '');
  if (cleaned.length === 0) return null;

  let national: string;
  if (cleaned.startsWith('+234')) {
    national = cleaned.slice(4);
  } else if (cleaned.startsWith('234')) {
    national = cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    national = cleaned.slice(1);
  } else {
    return null;
  }

  if (!/^[789]\d{9}$/.test(national)) return null;
  return national;
}

/**
 * Normalise any accepted Nigerian phone form to E.164 (AC-1.4.2).
 *
 * RECOVERY ONLY — see the note on `E164NigerianPhoneSchema`.
 *
 * All of `08012345678`, `+2348012345678` and `2348012345678` yield the same
 * output, which is the point: the same person typing their number three
 * different ways must not produce three different stored values.
 */
export const NigerianPhoneSchema = z
  .string()
  .transform((value, ctx) => {
    const national = toNationalSignificantNumber(value);
    if (national === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PHONE_ERROR });
      return z.NEVER;
    }
    return `+234${national}`;
  })
  .pipe(E164NigerianPhoneSchema);
export type NigerianPhone = z.infer<typeof NigerianPhoneSchema>;

/** Optional recovery phone: absent, or a number that normalises cleanly. */
export const OptionalNigerianPhoneSchema = NigerianPhoneSchema.nullable();
export type OptionalNigerianPhone = z.infer<typeof OptionalNigerianPhoneSchema>;
