/**
 * WebCrypto primitives for the local store (PRD §6.4, §11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROTECTS, AND WHAT IT DOES NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Field-level encryption protects CONTENT, not STRUCTURE. IndexedDB cannot index
 * encrypted values, and the indexes in §6.4 are load-bearing — encrypting the
 * columns they cover would break every query the app makes. So indexed and
 * structural columns stay plaintext and content columns are encrypted.
 *
 * The consequence is worth stating plainly: an attacker with access to the
 * unlocked device's IndexedDB can see THAT a user has seven medications, how
 * many allergies they recorded, when each dose was logged, and the shape of
 * their care over time. They cannot see WHICH medications, which allergies, or
 * what any note or event payload says.
 *
 * That is a real and deliberate limit. Metadata about a health record is itself
 * disclosive — a dense run of dose logs at 2am says something even without the
 * drug name. Anyone extending this file should not describe the local store as
 * "encrypted" without that qualification.
 *
 * The threat this addresses is device access: a lost, stolen, shared or seized
 * phone. It does nothing about a compromised running app, which necessarily
 * holds the key.
 */

/** Wire format for one encrypted value. Versioned so the format can change. */
export type EncryptedField = {
  v: 1;
  /** Base64 12-byte AES-GCM initialisation vector. Unique per encryption. */
  iv: string;
  /** Base64 ciphertext, including the GCM authentication tag. */
  ct: string;
};

/**
 * OWASP's 2023 floor for PBKDF2-SHA256. Measured at ~22ms on the development
 * machine; a mid-range Android is roughly 10–20x slower, which still leaves
 * unlock well inside the 1s budget. Not raised beyond the specified minimum
 * precisely because the slow-device case is the one that matters and cannot be
 * measured from here.
 */
export const PBKDF2_ITERATIONS = 210_000;

export const SALT_BYTES = 16;

/**
 * 12 bytes is the AES-GCM standard. A FRESH one is generated per encryption —
 * see `encryptField`. Reusing an IV under the same key breaks GCM catastrophically:
 * it leaks the XOR of the two plaintexts and can expose the authentication
 * subkey, allowing forgery. This is not a "should", it is the single way to
 * destroy this construction.
 */
export const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Base64 helpers that work in both the browser and Node, without Buffer. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Derive the key-encryption key (KEK) from the user's PIN.
 *
 * A 6-digit PIN has only 10^6 possibilities, so the iteration count is doing
 * essentially all of the work here: it is what makes offline brute force of a
 * stolen wrapped key cost real time rather than milliseconds. The 10-attempt
 * wipe in keyring.ts covers the online case.
 */
export async function deriveKek(
  pin: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Generate the random 256-bit data key that actually encrypts field content.
 *
 * Extractable, because it must be wrappable. `unwrapDataKey` deliberately
 * produces a NON-extractable key for in-memory use, so the copy the running app
 * holds cannot be exported back out.
 */
export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export type WrappedDataKey = {
  v: 1;
  iv: string;
  wrapped: string;
};

export async function wrapDataKey(
  dataKey: CryptoKey,
  kek: CryptoKey,
): Promise<WrappedDataKey> {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, kek, {
    name: 'AES-GCM',
    iv: iv as BufferSource,
  });
  return { v: 1, iv: toBase64(iv), wrapped: toBase64(new Uint8Array(wrapped)) };
}

/**
 * Unwrap the data key with a KEK derived from a candidate PIN.
 *
 * A wrong PIN produces a KEK that fails GCM authentication, so this REJECTS
 * rather than returning garbage. The caller treats that rejection as "wrong
 * PIN". Nothing is written here, so a failed attempt cannot corrupt the stored
 * wrapped key.
 */
export async function unwrapDataKey(
  wrappedKey: WrappedDataKey,
  kek: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64(wrappedKey.wrapped) as BufferSource,
    kek,
    { name: 'AES-GCM', iv: fromBase64(wrappedKey.iv) as BufferSource },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt one field value.
 *
 * Accepts any JSON-serialisable value, because the fields this covers range from
 * a display name to a number to a whole event payload object.
 *
 * A fresh IV is generated on every call — never derived, never counted, never
 * reused. `tests/unit/db.test.ts` (d) asserts that encrypting identical
 * plaintext twice yields different ciphertext, which is the observable
 * consequence of that.
 */
export async function encryptField(
  key: CryptoKey,
  value: unknown,
): Promise<EncryptedField> {
  const iv = randomBytes(IV_BYTES);
  const plaintext = encoder.encode(JSON.stringify(value ?? null));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ciphertext)) };
}

/**
 * Decrypt one field value.
 *
 * NEVER LOG THE RETURN VALUE OF THIS FUNCTION. It is decrypted clinical content:
 * a medication name, a symptom note, a diagnosis. It must not reach console,
 * Sentry, analytics, or any error message — §11 requires no clinical payloads in
 * error reports, and a stack trace carrying a drug name is exactly that.
 */
export async function decryptField<T>(
  key: CryptoKey,
  payload: EncryptedField,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) as BufferSource },
    key,
    fromBase64(payload.ct) as BufferSource,
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/** Structural check that a stored value is in encrypted form. */
export function isEncryptedField(value: unknown): value is EncryptedField {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EncryptedField).v === 1 &&
    typeof (value as EncryptedField).iv === 'string' &&
    typeof (value as EncryptedField).ct === 'string'
  );
}
