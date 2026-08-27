import { z } from 'zod';
import { SexAtBirthEnum } from './enums';
import { IsoDateSchema } from './primitives';
import { RulepackSchema } from './rulepack';
import { AllergySchema, ConditionSchema, MedicationSchema } from './tables';

/**
 * Screening engine types (PRD §5.1).
 *
 * `screen()` is a pure function: no I/O, deterministic, same input always yields
 * the same output. These schemas describe its boundary.
 *
 * Derived from the PRD's TypeScript block via Zod rather than transcribed as
 * hand-written types — a duplicated `type Alert = {...}` would be free to drift
 * from what the engine actually validates.
 */

/**
 * The seven checks §5.1 runs. All stages always run and alerts accumulate;
 * `UNCHECKABLE` is emitted for a custom drug whose ingredients are unknown, and
 * is a statement about Sana's limits rather than about the medicine.
 */
export const AlertKindEnum = z.enum([
  'ALLERGY_DIRECT',
  'ALLERGY_CROSS_CLASS',
  'DUPLICATE_INGREDIENT',
  'INTERACTION',
  'CONDITION_CONTRA',
  'PREGNANCY_CAUTION',
  'UNCHECKABLE',
]);
export type AlertKind = z.infer<typeof AlertKindEnum>;

/** Alerts sort by severity descending (§5.1). */
export const AlertSeverityEnum = z.enum([
  'INFO',
  'CAUTION',
  'SERIOUS',
  'CRITICAL',
]);
export type AlertSeverity = z.infer<typeof AlertSeverityEnum>;

export const InvolvedDrugSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type InvolvedDrug = z.infer<typeof InvolvedDrugSchema>;

/**
 * `explanation` is plain-language copy taken FROM THE RULEPACK — never
 * generated (§5.1, §2.2). `rulepackVersion` travels with the alert so a
 * recorded screening result can always be traced to the content that produced
 * it (§2.5 provenance).
 */
export const AlertSchema = z.object({
  id: z.string(),
  kind: AlertKindEnum,
  severity: AlertSeverityEnum,
  title: z.string(),
  explanation: z.string(),
  involvedDrugs: z.array(InvolvedDrugSchema),
  source: z.string(),
  rulepackVersion: z.string(),
});
export type Alert = z.infer<typeof AlertSchema>;

/**
 * Note the camelCase here: §5.1 defines this as an in-memory function argument,
 * not a database row, and it stays as the PRD writes it. The snake_case row
 * schemas in ./tables are the persistence shapes.
 */
export const ScreeningProfileSchema = z.object({
  dateOfBirth: IsoDateSchema,
  sexAtBirth: SexAtBirthEnum,
  isPregnant: z.boolean(),
});
export type ScreeningProfile = z.infer<typeof ScreeningProfileSchema>;

export const ScreeningInputSchema = z.object({
  profile: ScreeningProfileSchema,
  allergies: z.array(AllergySchema),
  conditions: z.array(ConditionSchema),
  currentMedications: z.array(MedicationSchema),
  /** The drug being added or checked. */
  candidate: MedicationSchema,
  rulepack: RulepackSchema,
});
export type ScreeningInput = z.infer<typeof ScreeningInputSchema>;

/** The result of `screen(input)` — §5.1 `function screen(input): Alert[]`. */
export const ScreeningResultSchema = z.array(AlertSchema);
export type ScreeningResult = z.infer<typeof ScreeningResultSchema>;

/**
 * Severity ordering used for the descending sort in §5.1. Higher is more
 * severe; kept next to the enum so the two cannot fall out of step.
 */
export const ALERT_SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
  INFO: 0,
  CAUTION: 1,
  SERIOUS: 2,
  CRITICAL: 3,
};
