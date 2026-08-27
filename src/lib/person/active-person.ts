import { db } from '../db/schema';

/**
 * Which person's record the clinical screens are showing (US-1.3, AC-1.3.3).
 *
 * Stored in IndexedDB `sync_meta` alongside `client_id`, NOT in localStorage.
 * Two reasons: a wipe clears it in the same sweep rather than leaving a pointer
 * to data that no longer exists, and a person id is a handle to a family
 * member's health record, which does not belong in the most casually-inspected
 * storage in the browser.
 *
 * AC-1.3.3 is the reason this is centralised: every clinical screen must read
 * the SAME active person, so that switching profiles cannot leave one screen
 * showing a different family member's medications than the next.
 */

const ACTIVE_PERSON_KEY = 'active_person_id';

export async function getActivePersonId(): Promise<string | null> {
  const row = await db.sync_meta.get(ACTIVE_PERSON_KEY);
  return row && typeof row.value === 'string' ? row.value : null;
}

export async function setActivePersonId(personId: string): Promise<void> {
  await db.sync_meta.put({ key: ACTIVE_PERSON_KEY, value: personId });
}

/**
 * The active person, falling back to the account's own 'self' person.
 *
 * Falling back matters after a wipe or on a new device: a clinical screen must
 * never render with no person selected, because "no person" would mean either an
 * empty screen or, worse, an unfiltered one.
 */
export async function resolveActivePersonId(
  fallbackSelfPersonId: string,
): Promise<string> {
  const stored = await getActivePersonId();
  if (stored !== null) return stored;
  await setActivePersonId(fallbackSelfPersonId);
  return fallbackSelfPersonId;
}

export async function clearActivePerson(): Promise<void> {
  await db.sync_meta.delete(ACTIVE_PERSON_KEY);
}
