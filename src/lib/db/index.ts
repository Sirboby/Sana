/**
 * Local store (PRD §6.4).
 *
 * Read ./crypto.ts before using this: field-level encryption protects content,
 * not structure, and that limit needs to be understood by anyone relying on it.
 */

export {
  type EncryptedField,
  IV_BYTES,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  isEncryptedField,
} from './crypto';
export { getClientId } from './client-id';
export {
  AUTO_LOCK_MS,
  DatabaseLockedError,
  InvalidPinError,
  MAX_FAILED_ATTEMPTS,
  WARN_FROM_ATTEMPT,
  type UnlockResult,
  failedAttempts,
  installAutoLockListeners,
  isPinConfigured,
  isUnlocked,
  lock,
  lockIfIdle,
  scheduleAutoLock,
  setupPin,
  unlock,
  wipeLocalStore,
} from './keyring';
export {
  type OutboxEntry,
  type OutboxStatus,
  decryptOutboxRow,
} from './outbox';
export * from './repositories';
export { type SanaDatabase, db } from './schema';
