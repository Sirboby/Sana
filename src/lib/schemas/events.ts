import { z } from 'zod';
import { UrgencyBandEnum } from './enums';
import {
  AllergyIdSchema,
  ConditionIdSchema,
  EventIdSchema,
  MedicationIdSchema,
  PersonIdSchema,
  ProfileIdSchema,
} from './ids';
import { IsoDateTimeSchema } from './primitives';

/**
 * `clinical_events.payload` (§6.1), typed per `event_type`.
 *
 * The event table stores payload as opaque JSONB, so the database cannot tell a
 * `medication_taken` payload from a `note_added` one. This union is the only
 * thing that can: attaching the wrong payload to an event_type is a compile
 * error here, and a parse failure at runtime.
 *
 * The log is append-only (§6.1, and enforced by RLS in 008), so a payload
 * written wrongly is not editable afterwards — it can only be superseded by a
 * `correction` event. That makes validation at write time the only line of
 * defence there is.
 */

/**
 * Every payload schema below is `.strict()`.
 *
 * Zod's default is to strip unknown keys, which would let a `medication_skipped`
 * payload validate as `medication_taken` — its extra `reason` key silently
 * dropped, leaving a shape that happens to fit. The two events mean opposite
 * things about whether a person took their medicine, so that is precisely the
 * confusion this union exists to prevent. Strict makes the mismatch a rejection.
 */

export const MedicationTakenPayloadSchema = z
  .object({
    medication_id: MedicationIdSchema,
    dose_amount: z.number().optional(),
    dose_unit: z.string().optional(),
    scheduled_for: IsoDateTimeSchema.optional(),
  })
  .strict();

export const MedicationSkippedPayloadSchema = z
  .object({
    medication_id: MedicationIdSchema,
    scheduled_for: IsoDateTimeSchema,
    reason: z.string().optional(),
  })
  .strict();

export const SymptomReportedPayloadSchema = z
  .object({
    symptom_codes: z.array(z.string().min(1)),
    notes: z.string().optional(),
  })
  .strict();

export const TriageCompletedPayloadSchema = z
  .object({
    symptom_codes: z.array(z.string().min(1)),
    urgency_band: UrgencyBandEnum,
    matched_rule_id: z.string().optional(),
    red_flag_id: z.string().optional(),
  })
  .strict();

/**
 * NOTE: `allergy_recorded` and `condition_recorded` are structurally identical
 * at runtime — both are `{ record_id: <uuid string> }`. `AllergyId` and
 * `ConditionId` are compile-time brands, so the compiler separates them but a
 * runtime parse cannot. Distinguishing them at runtime would mean adding a
 * redundant discriminator inside the payload; the event's own `event_type`
 * column already carries that information.
 */
export const AllergyRecordedPayloadSchema = z
  .object({
    record_id: AllergyIdSchema,
  })
  .strict();

export const ConditionRecordedPayloadSchema = z
  .object({
    record_id: ConditionIdSchema,
  })
  .strict();

/**
 * A measurement the user recorded. `value` is a number and `unit` is explicit —
 * a bare number with an implied unit is how a weight in pounds becomes a weight
 * in kilograms.
 */
export const VitalRecordedPayloadSchema = z
  .object({
    kind: z.string().min(1),
    value: z.number(),
    unit: z.string().min(1),
  })
  .strict();

export const NoteAddedPayloadSchema = z
  .object({
    text: z.string(),
  })
  .strict();

/**
 * Supersedes an earlier event. The original is never mutated — §6.1 and the
 * `events_no_mutation` RLS policy both forbid it — so a correction is itself an
 * appended row pointing back at what it corrects.
 */
export const CorrectionPayloadSchema = z
  .object({
    corrects_event_id: EventIdSchema,
    reason: z.string().min(1),
  })
  .strict();

/** Payload shape keyed by event_type, for callers that need one directly. */
export const EVENT_PAYLOAD_SCHEMAS = {
  medication_taken: MedicationTakenPayloadSchema,
  medication_skipped: MedicationSkippedPayloadSchema,
  symptom_reported: SymptomReportedPayloadSchema,
  triage_completed: TriageCompletedPayloadSchema,
  allergy_recorded: AllergyRecordedPayloadSchema,
  condition_recorded: ConditionRecordedPayloadSchema,
  vital_recorded: VitalRecordedPayloadSchema,
  note_added: NoteAddedPayloadSchema,
  correction: CorrectionPayloadSchema,
} as const;

/**
 * Columns shared by every clinical event, spread into each union member.
 *
 * `z.discriminatedUnion` needs each member to be an object schema carrying the
 * discriminant, so the base cannot be composed with `.extend()` on a union.
 */
const eventColumns = {
  id: EventIdSchema,
  person_id: PersonIdSchema,
  owner_id: ProfileIdSchema,
  occurred_at: IsoDateTimeSchema,
  recorded_at: IsoDateTimeSchema,
  rulepack_version: z.string().nullable(),
  ruleset_checksum: z.string().nullable(),
  client_id: z.string().min(1),
  corrects_event_id: EventIdSchema.nullable(),
  deleted_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
} as const;

function eventVariant<
  TType extends keyof typeof EVENT_PAYLOAD_SCHEMAS,
  TPayload extends z.ZodTypeAny,
>(eventType: TType, payload: TPayload) {
  return z.object({
    ...eventColumns,
    event_type: z.literal(eventType),
    payload,
  });
}

/**
 * Insert variant of one union member.
 *
 * `owner_id` is dropped because §7.2 has the server derive it from the JWT and
 * ignore any client value; `recorded_at` and `created_at` are database defaults.
 * `.strict()` makes a payload that still carries `owner_id` a REJECTION rather
 * than a silent strip — a client that thinks it is setting an owner should be
 * told it is not.
 */
function insertVariant<
  TType extends keyof typeof EVENT_PAYLOAD_SCHEMAS,
  TPayload extends z.ZodTypeAny,
>(eventType: TType, payload: TPayload) {
  const {
    owner_id: _ownerId,
    recorded_at: _recordedAt,
    created_at: _createdAt,
    ...clientOwned
  } = eventColumns;
  return z
    .object({ ...clientOwned, event_type: z.literal(eventType), payload })
    .strict();
}

export const ClinicalEventSchema = z.discriminatedUnion('event_type', [
  eventVariant('medication_taken', MedicationTakenPayloadSchema),
  eventVariant('medication_skipped', MedicationSkippedPayloadSchema),
  eventVariant('symptom_reported', SymptomReportedPayloadSchema),
  eventVariant('triage_completed', TriageCompletedPayloadSchema),
  eventVariant('allergy_recorded', AllergyRecordedPayloadSchema),
  eventVariant('condition_recorded', ConditionRecordedPayloadSchema),
  eventVariant('vital_recorded', VitalRecordedPayloadSchema),
  eventVariant('note_added', NoteAddedPayloadSchema),
  eventVariant('correction', CorrectionPayloadSchema),
]);
export type ClinicalEvent = z.infer<typeof ClinicalEventSchema>;

/** Insert variant: server-managed columns omitted, unknown keys rejected. */
export const ClinicalEventInsertSchema = z.discriminatedUnion('event_type', [
  insertVariant('medication_taken', MedicationTakenPayloadSchema),
  insertVariant('medication_skipped', MedicationSkippedPayloadSchema),
  insertVariant('symptom_reported', SymptomReportedPayloadSchema),
  insertVariant('triage_completed', TriageCompletedPayloadSchema),
  insertVariant('allergy_recorded', AllergyRecordedPayloadSchema),
  insertVariant('condition_recorded', ConditionRecordedPayloadSchema),
  insertVariant('vital_recorded', VitalRecordedPayloadSchema),
  insertVariant('note_added', NoteAddedPayloadSchema),
  insertVariant('correction', CorrectionPayloadSchema),
]);
export type ClinicalEventInsert = z.infer<typeof ClinicalEventInsertSchema>;

export type MedicationTakenPayload = z.infer<
  typeof MedicationTakenPayloadSchema
>;
export type MedicationSkippedPayload = z.infer<
  typeof MedicationSkippedPayloadSchema
>;
export type SymptomReportedPayload = z.infer<
  typeof SymptomReportedPayloadSchema
>;
export type TriageCompletedPayload = z.infer<
  typeof TriageCompletedPayloadSchema
>;
export type AllergyRecordedPayload = z.infer<
  typeof AllergyRecordedPayloadSchema
>;
export type ConditionRecordedPayload = z.infer<
  typeof ConditionRecordedPayloadSchema
>;
export type VitalRecordedPayload = z.infer<typeof VitalRecordedPayloadSchema>;
export type NoteAddedPayload = z.infer<typeof NoteAddedPayloadSchema>;
export type CorrectionPayload = z.infer<typeof CorrectionPayloadSchema>;
