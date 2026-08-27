/**
 * Repository barrel.
 *
 * These are the ONLY sanctioned write path into the local store. Writing an
 * entity directly through `db.<table>.put()` would skip the outbox and lose the
 * mutation at sync time, so callers outside `src/lib/db` should reach for a
 * repository and never for the Dexie table.
 */

export type { Draft, EntityRepository } from './base';
export {
  allergiesRepository,
  conditionsRepository,
  medicationsRepository,
  personsRepository,
  userFacilitiesRepository,
} from './entities';
export { type ClinicalEventDraft, eventsRepository } from './events';
export { referenceRepository } from './reference';
