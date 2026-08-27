import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/**
 * Branded ID types.
 *
 * Every ID in this system is a UUID string, so without branding the compiler
 * sees `medication.id` and `person.id` as the same type and will happily let you
 * pass one where the other belongs. In a schema this interconnected — where
 * allergies, conditions, medications and events all hang off `person_id`, and
 * events additionally reference `medication_id` inside their payload — that is a
 * live class of bug, and one that produces a silent wrong-record read rather
 * than a crash.
 *
 * Branding is a compile-time device only: at runtime these are plain strings.
 */

const UuidSchema = z.string().uuid();

export const ProfileIdSchema = UuidSchema.brand<'ProfileId'>();
export type ProfileId = z.infer<typeof ProfileIdSchema>;

export const PersonIdSchema = UuidSchema.brand<'PersonId'>();
export type PersonId = z.infer<typeof PersonIdSchema>;

export const AllergyIdSchema = UuidSchema.brand<'AllergyId'>();
export type AllergyId = z.infer<typeof AllergyIdSchema>;

export const ConditionIdSchema = UuidSchema.brand<'ConditionId'>();
export type ConditionId = z.infer<typeof ConditionIdSchema>;

export const MedicationIdSchema = UuidSchema.brand<'MedicationId'>();
export type MedicationId = z.infer<typeof MedicationIdSchema>;

export const EventIdSchema = UuidSchema.brand<'EventId'>();
export type EventId = z.infer<typeof EventIdSchema>;

export const DrugIdSchema = UuidSchema.brand<'DrugId'>();
export type DrugId = z.infer<typeof DrugIdSchema>;

export const ConsentIdSchema = UuidSchema.brand<'ConsentId'>();
export type ConsentId = z.infer<typeof ConsentIdSchema>;

export const MutationIdSchema = UuidSchema.brand<'MutationId'>();
export type MutationId = z.infer<typeof MutationIdSchema>;

/** Added in v1.3 alongside the facility directory (§5.5, §6.1). */
export const FacilityIdSchema = UuidSchema.brand<'FacilityId'>();
export type FacilityId = z.infer<typeof FacilityIdSchema>;

export const UserFacilityIdSchema = UuidSchema.brand<'UserFacilityId'>();
export type UserFacilityId = z.infer<typeof UserFacilityIdSchema>;

/**
 * Generate a client-side UUIDv7 (PRD §0: "All IDs are UUIDv7, generated
 * client-side").
 *
 * v7 rather than v4 because the high bits are a Unix millisecond timestamp, so
 * IDs sort chronologically. That matters twice here: `clinical_events` is an
 * append-only log read in time order, and B-tree inserts of time-ordered keys
 * stay in the rightmost page instead of scattering writes across the index the
 * way random v4 keys do.
 *
 * Returns a plain string — brand it at the boundary with the appropriate schema,
 * e.g. `PersonIdSchema.parse(newId())`.
 */
export function newId(): string {
  return uuidv7();
}
