import { z } from 'zod';
import { UrgencyBandEnum } from './enums';
import { SemverSchema, Sha256ChecksumSchema } from './primitives';

/**
 * The rulepack document (PRD §8).
 *
 * A signed, versioned JSON document holding all non-red-flag clinical content.
 * Synced to the device; never generated at runtime (§2.2, §8).
 *
 * Red-flag rules are deliberately NOT in here — §5.4 compiles those into the
 * bundle so that detection survives a corrupt, stale or missing rulepack
 * (AC-6.1.6).
 */

export const SymptomQuestionSchema = z.object({
  code: z.string().min(1),
  type: z.string().min(1),
  options: z.array(z.string()),
});
export type SymptomQuestion = z.infer<typeof SymptomQuestionSchema>;

export const SymptomSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  bodySystem: z.string().min(1),
  questions: z.array(SymptomQuestionSchema),
});
export type Symptom = z.infer<typeof SymptomSchema>;

/** The condition a rule fires on: all of these codes, and any of those. */
export const UrgencyRuleConditionSchema = z.object({
  all: z.array(z.string()).optional(),
  any: z.array(z.string()).optional(),
});
export type UrgencyRuleCondition = z.infer<typeof UrgencyRuleConditionSchema>;

/**
 * `band` accepts ONLY the four `urgency_band` enum values (§8 hard constraint).
 *
 * A band outside the enum would either crash the triage screen or, worse, fall
 * through to a default that under-states urgency. Reusing `UrgencyBandEnum`
 * rather than restating the four strings means the database, the type layer and
 * the rulepack cannot disagree about what a valid band is.
 */
export const UrgencyRuleSchema = z.object({
  id: z.string().min(1),
  when: UrgencyRuleConditionSchema,
  band: UrgencyBandEnum,
  guidance: z.string().min(1),
  source: z.string().min(1),
});
export type UrgencyRule = z.infer<typeof UrgencyRuleSchema>;

/**
 * Copy shown for a screening alert. `body` may contain `{{placeholders}}` that
 * the engine substitutes — the prose itself is authored, never generated (§2.2).
 */
export const AlertCopySchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});
export type AlertCopy = z.infer<typeof AlertCopySchema>;

export const RulepackDocumentSchema = z.object({
  version: SemverSchema,
  checksum: Sha256ChecksumSchema,
  locale: z.string().min(1),
  reviewStatus: z.string().min(1),
  symptoms: z.array(SymptomSchema),
  urgencyRules: z.array(UrgencyRuleSchema),
  alertCopy: z.record(z.string(), AlertCopySchema),
  disclaimerVersion: SemverSchema,
});
export type RulepackDocument = z.infer<typeof RulepackDocumentSchema>;

/**
 * Alias matching the name §5.1 uses for the field on `ScreeningInput`.
 * Same schema — not a second definition.
 */
export const RulepackSchema = RulepackDocumentSchema;
export type Rulepack = RulepackDocument;
