import { newId } from '../schemas';
import { db } from './schema';

/**
 * A stable per-device identifier (PRD §7.2 `client_id`).
 *
 * Generated once and persisted in `sync_meta`. It identifies the DEVICE, not the
 * person: §7.2 uses it so the server can attribute a mutation batch to an
 * origin, and step 9 uses it to recognise its own echoes on pull.
 *
 * Deliberately NOT stored in localStorage. IndexedDB is where the rest of the
 * local store lives, so a wipe clears this in the same sweep rather than leaving
 * a stale identifier behind that would outlive the data it described.
 *
 * It carries no clinical meaning and is not encrypted — it is a random opaque id
 * that reveals nothing about the user, and sync needs it before unlock.
 */

const CLIENT_ID_KEY = 'client_id';

export async function getClientId(): Promise<string> {
  const existing = await db.sync_meta.get(CLIENT_ID_KEY);
  if (existing && typeof existing.value === 'string') {
    return existing.value;
  }
  const clientId = newId();
  await db.sync_meta.put({ key: CLIENT_ID_KEY, value: clientId });
  return clientId;
}

/** Present only so a wipe can be verified as complete. */
export async function peekClientId(): Promise<string | null> {
  const existing = await db.sync_meta.get(CLIENT_ID_KEY);
  return existing && typeof existing.value === 'string' ? existing.value : null;
}
