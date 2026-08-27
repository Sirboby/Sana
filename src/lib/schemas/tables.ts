import { z } from 'zod';
import {
  AllergenTypeEnum,
  FacilityTypeEnum,
  SeverityLevelEnum,
  SexAtBirthEnum,
} from './enums';
import { ClinicalEventInsertSchema, ClinicalEventSchema } from './events';
import { E164NigerianPhoneSchema, EmailSchema } from './identity';
import {
  AllergyIdSchema,
  ConditionIdSchema,
  ConsentIdSchema,
  DrugIdSchema,
  FacilityIdSchema,
  MedicationIdSchema,
  PersonIdSchema,
  ProfileIdSchema,
  UserFacilityIdSchema,
} from './ids';
import { ActiveIngredientSchema, MedicationScheduleSchema } from './medication';
import {
  IsoDateSchema,
  IsoDateTimeSchema,
  SemverSchema,
  TextArraySchema,
} from './primitives';
import { RulepackDocumentSchema } from './rulepack';

/**
 * One schema per table in PRD §6.1, mirroring every column, nullability and
 * default.
 *
 * Each table also exports an `Insert` variant with server-managed fields
 * omitted — `created_at`, `updated_at`, and `owner_id`. Per §7.2 the server
 * always derives `owner_id` from the JWT and ignores any client value, so an
 * Insert payload has no business carrying one.
 *
 * Insert variants are `.strict()` deliberately. Zod's default is to strip
 * unknown keys silently, which would let a client send `owner_id`, have it
 * quietly discarded, and never learn that the field it thought it controlled is
 * not its to set. A rejection says so.
 */

// ─────────────── ACCOUNTS ───────────────

/**
 * Email-primary since v1.3 (§4 US-1.1). `phone` is an optional recovery channel
 * and is never a login identifier (AC-1.4.3).
 */
export const ProfileSchema = z.object({
  id: ProfileIdSchema,
  email: EmailSchema,
  phone: E164NigerianPhoneSchema.nullable(),
  phone_verified_at: IsoDateTimeSchema.nullable(),
  display_name: z.string().min(1),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

/** `profiles.id` IS the owner, so there is no `owner_id` column to omit. */
export const ProfileInsertSchema = ProfileSchema.omit({
  created_at: true,
  updated_at: true,
}).strict();
export type ProfileInsert = z.infer<typeof ProfileInsertSchema>;

export const PersonSchema = z.object({
  id: PersonIdSchema,
  owner_id: ProfileIdSchema,
  display_name: z.string().min(1),
  relationship: z.string().min(1),
  date_of_birth: IsoDateSchema.nullable(),
  sex_at_birth: SexAtBirthEnum,
  is_pregnant: z.boolean(),
  weight_kg: z.number().nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  deleted_at: IsoDateTimeSchema.nullable(),
});
export type Person = z.infer<typeof PersonSchema>;

export const PersonInsertSchema = PersonSchema.omit({
  owner_id: true,
  created_at: true,
  updated_at: true,
}).strict();
export type PersonInsert = z.infer<typeof PersonInsertSchema>;

/** Immutable once written — §7.5 treats consents as insert-only. */
export const ConsentSchema = z.object({
  id: ConsentIdSchema,
  owner_id: ProfileIdSchema,
  consent_type: z.string().min(1),
  version: z.string().min(1),
  granted_at: IsoDateTimeSchema,
  revoked_at: IsoDateTimeSchema.nullable(),
});
export type Consent = z.infer<typeof ConsentSchema>;

/** `consents` has no created_at/updated_at columns — only owner_id is omitted. */
export const ConsentInsertSchema = ConsentSchema.omit({
  owner_id: true,
}).strict();
export type ConsentInsert = z.infer<typeof ConsentInsertSchema>;

// ─────────────── CLINICAL PROFILE ───────────────

export const AllergySchema = z.object({
  id: AllergyIdSchema,
  person_id: PersonIdSchema,
  owner_id: ProfileIdSchema,
  allergen_type: AllergenTypeEnum,
  allergen_code: z.string().nullable(),
  allergen_label: z.string().min(1),
  drug_classes: TextArraySchema,
  severity: SeverityLevelEnum,
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  deleted_at: IsoDateTimeSchema.nullable(),
});
export type Allergy = z.infer<typeof AllergySchema>;

export const AllergyInsertSchema = AllergySchema.omit({
  owner_id: true,
  created_at: true,
  updated_at: true,
}).strict();
export type AllergyInsert = z.infer<typeof AllergyInsertSchema>;

export const ConditionSchema = z.object({
  id: ConditionIdSchema,
  person_id: PersonIdSchema,
  owner_id: ProfileIdSchema,
  condition_code: z.string().nullable(),
  condition_label: z.string().min(1),
  onset_date: IsoDateSchema.nullable(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  deleted_at: IsoDateTimeSchema.nullable(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ConditionInsertSchema = ConditionSchema.omit({
  owner_id: true,
  created_at: true,
  updated_at: true,
}).strict();
export type ConditionInsert = z.infer<typeof ConditionInsertSchema>;

/**
 * `dose_amount` is a record of what the user was prescribed elsewhere. §2.2
 * prohibits Sana suggesting a dose, so nothing in this codebase may write this
 * field from a computation.
 */
export const MedicationSchema = z.object({
  id: MedicationIdSchema,
  person_id: PersonIdSchema,
  owner_id: ProfileIdSchema,
  drug_id: DrugIdSchema.nullable(),
  is_custom: z.boolean(),
  display_name: z.string().min(1),
  dose_amount: z.number().nullable(),
  dose_unit: z.string().nullable(),
  schedule: MedicationScheduleSchema,
  start_date: IsoDateSchema,
  end_date: IsoDateSchema.nullable(),
  notes: z.string().nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  deleted_at: IsoDateTimeSchema.nullable(),
});
export type Medication = z.infer<typeof MedicationSchema>;

export const MedicationInsertSchema = MedicationSchema.omit({
  owner_id: true,
  created_at: true,
  updated_at: true,
}).strict();
export type MedicationInsert = z.infer<typeof MedicationInsertSchema>;

// ─────────────── CLINICAL EVENT LOG ───────────────

// Defined in events.ts, where the payload union lives. Re-exported so that
// every §6.1 table schema is reachable from this module.
export { ClinicalEventSchema, ClinicalEventInsertSchema };
export type { ClinicalEvent, ClinicalEventInsert } from './events';

// ─────────────── REFERENCE DATA ───────────────

export const DrugCatalogSchema = z.object({
  id: DrugIdSchema,
  rxnorm_cui: z.string().nullable(),
  nafdac_reg_no: z.string().nullable(),
  generic_name: z.string().min(1),
  brand_names: TextArraySchema,
  active_ingredients: z.array(ActiveIngredientSchema),
  drug_classes: TextArraySchema,
  dosage_form: z.string().nullable(),
  is_otc: z.boolean(),
  region: z.string().min(1),
  updated_at: IsoDateTimeSchema,
});
export type DrugCatalog = z.infer<typeof DrugCatalogSchema>;

/** Reference tables have no owner_id — only `updated_at` is server-managed. */
export const DrugCatalogInsertSchema = DrugCatalogSchema.omit({
  updated_at: true,
}).strict();
export type DrugCatalogInsert = z.infer<typeof DrugCatalogInsertSchema>;

/** `recommendation` is curated content and is never generated (§2.2, §6.1). */
export const DrugInteractionSchema = z.object({
  id: z.string().uuid(),
  class_a: z.string().min(1),
  class_b: z.string().min(1),
  severity: z.string().min(1),
  mechanism: z.string().min(1),
  recommendation: z.string().min(1),
  source: z.string().min(1),
  evidence_url: z.string().nullable(),
  updated_at: IsoDateTimeSchema,
});
export type DrugInteraction = z.infer<typeof DrugInteractionSchema>;

export const DrugInteractionInsertSchema = DrugInteractionSchema.omit({
  updated_at: true,
}).strict();
export type DrugInteractionInsert = z.infer<typeof DrugInteractionInsertSchema>;

export const AllergyCrossReferenceSchema = z.object({
  id: z.string().uuid(),
  allergen_class: z.string().min(1),
  reactive_class: z.string().min(1),
  risk_level: z.string().min(1),
  note: z.string().min(1),
  source: z.string().min(1),
});
export type AllergyCrossReference = z.infer<typeof AllergyCrossReferenceSchema>;

/** No server-managed columns on this table, so Insert equals the row shape. */
export const AllergyCrossReferenceInsertSchema =
  AllergyCrossReferenceSchema.strict();
export type AllergyCrossReferenceInsert = z.infer<
  typeof AllergyCrossReferenceInsertSchema
>;

export const ConditionContraindicationSchema = z.object({
  id: z.string().uuid(),
  condition_code: z.string().min(1),
  drug_class: z.string().min(1),
  severity: z.string().min(1),
  explanation: z.string().min(1),
  source: z.string().min(1),
});
export type ConditionContraindication = z.infer<
  typeof ConditionContraindicationSchema
>;

export const ConditionContraindicationInsertSchema =
  ConditionContraindicationSchema.strict();
export type ConditionContraindicationInsert = z.infer<
  typeof ConditionContraindicationInsertSchema
>;

/**
 * A curated, human-verified facility. Tier 2 in the §5.5 trust hierarchy.
 *
 * `verified_at` is REQUIRED and non-nullable by design (§6.3): a facility that
 * can reach the escalation screen is a destination for someone in crisis, and
 * an unverified one is a safety defect rather than a data-quality one.
 *
 * Contrast `DiscoveredFacilitySchema` in ./facilities — a deliberately separate
 * type that cannot be substituted here.
 */
export const FacilitySchema = z.object({
  id: FacilityIdSchema,
  facility_type: FacilityTypeEnum,
  name: z.string().min(1),
  address: z.string().min(1),
  state: z.string().min(1),
  lga: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  phone_numbers: TextArraySchema,
  has_emergency: z.boolean(),
  is_24_hours: z.boolean(),
  opening_hours: z.record(z.string(), z.unknown()).nullable(),
  verified_at: IsoDateSchema,
  verified_by: z.string().min(1),
  source: z.string().min(1),
  region: z.string().min(1),
  updated_at: IsoDateTimeSchema,
});
export type Facility = z.infer<typeof FacilitySchema>;

export const FacilityInsertSchema = FacilitySchema.omit({
  updated_at: true,
}).strict();
export type FacilityInsert = z.infer<typeof FacilityInsertSchema>;

/** A user's own saved facility. Tier 1 — USER data, not reference data. */
export const UserFacilitySchema = z.object({
  id: UserFacilityIdSchema,
  owner_id: ProfileIdSchema,
  facility_id: FacilityIdSchema.nullable(),
  label: z.string().min(1),
  phone_number: z.string().nullable(),
  address: z.string().nullable(),
  is_emergency: z.boolean(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  deleted_at: IsoDateTimeSchema.nullable(),
});
export type UserFacility = z.infer<typeof UserFacilitySchema>;

export const UserFacilityInsertSchema = UserFacilitySchema.omit({
  owner_id: true,
  created_at: true,
  updated_at: true,
}).strict();
export type UserFacilityInsert = z.infer<typeof UserFacilityInsertSchema>;

export const RulepackRowSchema = z.object({
  id: z.string().uuid(),
  version: SemverSchema,
  checksum: z.string().min(1),
  /** The §8 document itself — typed, not opaque JSON. */
  content: RulepackDocumentSchema,
  review_status: z.string().min(1),
  reviewed_by: z.string().nullable(),
  reviewed_at: IsoDateTimeSchema.nullable(),
  published_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
});
export type RulepackRow = z.infer<typeof RulepackRowSchema>;

export const RulepackRowInsertSchema = RulepackRowSchema.omit({
  created_at: true,
}).strict();
export type RulepackRowInsert = z.infer<typeof RulepackRowInsertSchema>;

// ─────────────── AUDIT (NDPA) ───────────────

/** `audit_log.id` is `bigserial`, not a UUID — hence a number, and not branded. */
export const AuditLogSchema = z.object({
  id: z.number().int(),
  owner_id: ProfileIdSchema.nullable(),
  action: z.string().min(1),
  resource: z.string().min(1),
  resource_id: z.string().uuid().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  occurred_at: IsoDateTimeSchema,
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * `id` is database-assigned, `occurred_at` defaults, and `owner_id` comes from
 * the JWT like every other owned table (§7.2) — all three are omitted.
 */
export const AuditLogInsertSchema = AuditLogSchema.omit({
  id: true,
  owner_id: true,
  occurred_at: true,
}).strict();
export type AuditLogInsert = z.infer<typeof AuditLogInsertSchema>;
