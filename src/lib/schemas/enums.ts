import { z } from 'zod';

/**
 * Zod mirrors of the Postgres enums in PRD §6.1.
 *
 * Values and ORDER must match the database exactly. Order matters because
 * Postgres enums are ordered types — comparisons and `order by` on an enum
 * column follow declaration order, so a reordering is a behaviour change, not a
 * cosmetic one. `tests/unit/schemas.test.ts` asserts parity against `pg_enum`.
 */

/** `create type sex_at_birth as enum (...)` — 002_enums.sql */
export const SexAtBirthEnum = z.enum([
  'male',
  'female',
  'intersex',
  'undisclosed',
]);
export type SexAtBirth = z.infer<typeof SexAtBirthEnum>;

/** `create type allergen_type as enum (...)` — 002_enums.sql */
export const AllergenTypeEnum = z.enum(['drug', 'food', 'environmental']);
export type AllergenType = z.infer<typeof AllergenTypeEnum>;

/** `create type severity_level as enum (...)` — 002_enums.sql */
export const SeverityLevelEnum = z.enum([
  'mild',
  'moderate',
  'severe',
  'anaphylaxis',
]);
export type SeverityLevel = z.infer<typeof SeverityLevelEnum>;

/** `create type event_type as enum (...)` — 002_enums.sql */
export const EventTypeEnum = z.enum([
  'medication_taken',
  'medication_skipped',
  'symptom_reported',
  'triage_completed',
  'allergy_recorded',
  'condition_recorded',
  'vital_recorded',
  'note_added',
  'correction',
]);
export type EventType = z.infer<typeof EventTypeEnum>;

/** `create type urgency_band as enum (...)` — 002_enums.sql */
export const UrgencyBandEnum = z.enum([
  'EMERGENCY',
  'SEE_DOCTOR_TODAY',
  'SEE_DOCTOR_SOON',
  'SELF_CARE_REASONABLE',
]);
export type UrgencyBand = z.infer<typeof UrgencyBandEnum>;

/** `create type facility_type as enum (...)` — 002_enums.sql */
export const FacilityTypeEnum = z.enum([
  'hospital',
  'clinic',
  'pharmacy',
  'diagnostic_centre',
]);
export type FacilityType = z.infer<typeof FacilityTypeEnum>;

/**
 * Every Postgres enum, keyed by its type name in the database.
 *
 * The enum-parity test iterates this map rather than a hand-written list, so
 * adding an enum above automatically brings it under test. A new Postgres enum
 * that nobody adds here is the failure mode this cannot catch — which is why
 * the test also asserts the map covers every enum `pg_type` reports.
 */
export const PG_ENUMS = {
  sex_at_birth: SexAtBirthEnum,
  allergen_type: AllergenTypeEnum,
  severity_level: SeverityLevelEnum,
  event_type: EventTypeEnum,
  urgency_band: UrgencyBandEnum,
  facility_type: FacilityTypeEnum,
} as const;

export type PgEnumName = keyof typeof PG_ENUMS;
