import {
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  type WrappedDataKey,
  deriveKek,
  fromBase64,
  generateDataKey,
  randomBytes,
  toBase64,
  unwrapDataKey,
  wrapDataKey,
} from './crypto';
import { USER_DATA_TABLES, db } from './schema';

/**
 * PIN-based key management for the local store (PRD §14 decision 2).
 *
 * The data key is held in a MODULE-SCOPED variable and nowhere else. Not
 * localStorage, not sessionStorage, not React state, not a context provider.
 * React state is serialised into the DOM by server components and captured by
 * devtools and error reporters; a key that lands in a Sentry breadcrumb is not a
 * key any more.
 *
 * The PIN itself is never stored in any form. What is stored is the data key
 * wrapped under a PBKDF2 derivation of the PIN, plus the salt — from which the
 * PIN cannot be recovered without brute force.
 */

/** §14: 10 failed attempts wipes the local store. */
export const MAX_FAILED_ATTEMPTS = 10;

/** §14: warn the user from attempt 7, so the wipe is never a surprise. */
export const WARN_FROM_ATTEMPT = 7;

/** §14: auto-lock after 5 minutes in the background. */
export const AUTO_LOCK_MS = 5 * 60 * 1000;

const PIN_LENGTH = 6;
const KEYRING_KEY = 'keyring';

type KeyringRecord = {
  v: 1;
  salt: string;
  iterations: number;
  wrappedKey: WrappedDataKey;
  failedAttempts: number;
};

/**
 * The only in-memory copy of the data key. Cleared by `lock()`.
 * Non-extractable (see crypto.unwrapDataKey), so it cannot be read back out.
 */
let dataKey: CryptoKey | null = null;

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

/** Thrown when clinical data is requested while the store is locked. */
export class DatabaseLockedError extends Error {
  constructor() {
    super(
      'The local store is locked. Unlock with the PIN before reading or writing.',
    );
    this.name = 'DatabaseLockedError';
  }
}

export class InvalidPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPinError';
  }
}

function assertPinShape(pin: string): void {
  if (!/^\d{6}$/.test(pin)) {
    throw new InvalidPinError(`The PIN must be exactly ${PIN_LENGTH} digits.`);
  }
}

async function readKeyring(): Promise<KeyringRecord | null> {
  const row = await db.sync_meta.get(KEYRING_KEY);
  return (row?.value as KeyringRecord | undefined) ?? null;
}

async function writeKeyring(record: KeyringRecord): Promise<void> {
  await db.sync_meta.put({ key: KEYRING_KEY, value: record });
}

export async function isPinConfigured(): Promise<boolean> {
  return (await readKeyring()) !== null;
}

export function isUnlocked(): boolean {
  return dataKey !== null;
}

/**
 * The data key, for repositories. Throws rather than returning null so that a
 * caller who forgets to check cannot silently write plaintext or read ciphertext.
 */
export function requireDataKey(): CryptoKey {
  if (dataKey === null) throw new DatabaseLockedError();
  return dataKey;
}

/** First run: choose a PIN. Generates the data key and leaves the store unlocked. */
export async function setupPin(pin: string): Promise<void> {
  assertPinShape(pin);
  if (await isPinConfigured()) {
    throw new InvalidPinError('A PIN is already configured for this device.');
  }

  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(pin, salt, PBKDF2_ITERATIONS);

  // Generated extractable so it can be wrapped, then immediately re-acquired
  // through unwrap as a non-extractable key. The extractable original is never
  // retained.
  const extractableKey = await generateDataKey();
  const wrappedKey = await wrapDataKey(extractableKey, kek);

  await writeKeyring({
    v: 1,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrappedKey,
    failedAttempts: 0,
  });

  dataKey = await unwrapDataKey(wrappedKey, kek);
  scheduleAutoLock();
}

export type UnlockResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not-configured' | 'wrong-pin' | 'wiped';
      attemptsRemaining: number;
      shouldWarn: boolean;
    };

/**
 * Attempt to unlock with a candidate PIN.
 *
 * A wrong PIN produces a KEK that fails AES-GCM authentication, so `unwrapKey`
 * rejects. Nothing is written to the wrapped key on that path, so a failed
 * attempt cannot corrupt it — only the attempt counter moves.
 */
export async function unlock(pin: string): Promise<UnlockResult> {
  const keyring = await readKeyring();
  if (keyring === null) {
    return {
      ok: false,
      reason: 'not-configured',
      attemptsRemaining: 0,
      shouldWarn: false,
    };
  }

  if (!/^\d{6}$/.test(pin)) {
    return recordFailure(keyring);
  }

  const kek = await deriveKek(
    pin,
    fromBase64(keyring.salt),
    keyring.iterations,
  );

  try {
    dataKey = await unwrapDataKey(keyring.wrappedKey, kek);
  } catch {
    // Deliberately no detail: distinguishing "bad PIN" from "corrupt keyring"
    // to the caller would also distinguish it to someone guessing.
    return recordFailure(keyring);
  }

  if (keyring.failedAttempts !== 0) {
    await writeKeyring({ ...keyring, failedAttempts: 0 });
  }
  scheduleAutoLock();
  return { ok: true };
}

async function recordFailure(keyring: KeyringRecord): Promise<UnlockResult> {
  const failedAttempts = keyring.failedAttempts + 1;

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    await wipeLocalStore();
    return {
      ok: false,
      reason: 'wiped',
      attemptsRemaining: 0,
      shouldWarn: false,
    };
  }

  await writeKeyring({ ...keyring, failedAttempts });
  const attemptsRemaining = MAX_FAILED_ATTEMPTS - failedAttempts;
  return {
    ok: false,
    reason: 'wrong-pin',
    attemptsRemaining,
    shouldWarn: failedAttempts >= WARN_FROM_ATTEMPT,
  };
}

export async function failedAttempts(): Promise<number> {
  return (await readKeyring())?.failedAttempts ?? 0;
}

/** Drop the in-memory key. Cheap, synchronous, and safe to call when locked. */
export function lock(): void {
  dataKey = null;
  if (autoLockTimer !== null) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

/**
 * Destroy all local data.
 *
 * Only local: the server copy is untouched and re-syncs after the user
 * re-authenticates (step 9), so this is recoverable for a legitimate user who
 * forgot their PIN and destructive for someone guessing at a stolen device.
 *
 * The keyring goes too. Without the PIN the wrapped key is inert, so keeping it
 * would preserve nothing but a brute-force target.
 */
export async function wipeLocalStore(): Promise<void> {
  lock();
  await db.transaction('rw', [...USER_DATA_TABLES, 'sync_meta'], async () => {
    for (const table of USER_DATA_TABLES) {
      await db.table(table).clear();
    }
    await db.sync_meta.clear();
  });
}

/**
 * Restart the inactivity countdown. Call on user activity.
 *
 * `setTimeout` is not a security boundary — a suspended tab may fire it late.
 * `lockIfIdle` below is what actually enforces the deadline on resume.
 */
export function scheduleAutoLock(now: number = Date.now()): void {
  if (autoLockTimer !== null) clearTimeout(autoLockTimer);
  lastActivityAt = now;
  autoLockTimer = setTimeout(lock, AUTO_LOCK_MS);
  // Never hold the process open for an idle timer in Node-based tests.
  (autoLockTimer as unknown as { unref?: () => void }).unref?.();
}

let lastActivityAt = 0;

/**
 * Lock if the idle deadline has already passed.
 *
 * Browsers throttle or defer timers in backgrounded tabs, so a tab hidden for an
 * hour may fire its 5-minute timer only on return. Checking elapsed wall-clock
 * time on resume closes that gap.
 */
export function lockIfIdle(now: number = Date.now()): boolean {
  if (dataKey === null) return false;
  if (now - lastActivityAt >= AUTO_LOCK_MS) {
    lock();
    return true;
  }
  return false;
}

/** Wire auto-lock to tab visibility. No-op outside a browser. */
export function installAutoLockListeners(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onVisibility = () => {
    if (document.visibilityState === 'visible') lockIfIdle();
    else scheduleAutoLock();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}

/** Test-only: reset module state between cases. */
export function __resetKeyringForTests(): void {
  lock();
  lastActivityAt = 0;
}
