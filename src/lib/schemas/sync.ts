import { z } from 'zod';
import { MutationIdSchema } from './ids';
import { IsoDateTimeSchema, SemverSchema } from './primitives';
import { RulepackDocumentSchema } from './rulepack';
import {
  AllergyCrossReferenceSchema,
  AllergySchema,
  ClinicalEventSchema,
  ConditionContraindicationSchema,
  ConditionSchema,
  ConsentSchema,
  DrugCatalogSchema,
  DrugInteractionSchema,
  FacilitySchema,
  MedicationSchema,
  PersonSchema,
  UserFacilitySchema,
} from './tables';

/**
 * Sync protocol contracts (PRD §7).
 *
 * Single-user ownership plus an append-only event log reduces sync to an outbox
 * push and a watermark pull — no CRDTs, no sync DSL (§7.1).
 */

/** The tables a client may push. `user_facilities` added in v1.3. */
export const MutationTableEnum = z.enum([
  'persons',
  'allergies',
  'conditions',
  'medications',
  'clinical_events',
  'consents',
  'user_facilities',
]);
export type MutationTable = z.infer<typeof MutationTableEnum>;

/**
 * `tombstone` rather than `delete`: nothing is hard-deleted, because a deletion
 * must propagate to other devices and a removed row cannot carry that news.
 */
export const MutationOpEnum = z.enum(['upsert', 'tombstone']);
export type MutationOp = z.infer<typeof MutationOpEnum>;

/**
 * One queued change.
 *
 * `mutation_id` is a client-generated UUIDv7 acting as the idempotency key — a
 * push retried after a timeout must not apply twice, and on a connection that
 * drops mid-request the client cannot know whether the server got it.
 *
 * `row` is `Record<string, unknown>` here exactly as §7.2 specifies; it is
 * validated against the target table's own schema, which is what
 * `MUTATION_ROW_SCHEMAS` below is for.
 */
export const MutationSchema = z.object({
  mutation_id: MutationIdSchema,
  table: MutationTableEnum,
  op: MutationOpEnum,
  row: z.record(z.string(), z.unknown()),
  client_updated_at: IsoDateTimeSchema,
});
export type Mutation = z.infer<typeof MutationSchema>;

/** Row schema per pushable table, so a mutation's `row` can be validated. */
export const MUTATION_ROW_SCHEMAS = {
  persons: PersonSchema,
  allergies: AllergySchema,
  conditions: ConditionSchema,
  medications: MedicationSchema,
  clinical_events: ClinicalEventSchema,
  consents: ConsentSchema,
  user_facilities: UserFacilitySchema,
} as const;

/** §7.2 — max 500 mutations per batch; the client chunks larger sets. */
export const MAX_MUTATIONS_PER_BATCH = 500;

export const SyncPushRequestSchema = z.object({
  client_id: z.string().min(1),
  mutations: z
    .array(MutationSchema)
    .max(
      MAX_MUTATIONS_PER_BATCH,
      `A push batch may carry at most ${MAX_MUTATIONS_PER_BATCH} mutations`,
    ),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const RejectedMutationSchema = z.object({
  mutation_id: MutationIdSchema,
  reason: z.string(),
  code: z.string(),
});
export type RejectedMutation = z.infer<typeof RejectedMutationSchema>;

/** Rejections are reported per mutation, so one bad row cannot stall a queue. */
export const SyncPushResponseSchema = z.object({
  applied: z.array(MutationIdSchema),
  rejected: z.array(RejectedMutationSchema),
  server_time: IsoDateTimeSchema,
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

export const SyncPullQuerySchema = z.object({
  since: IsoDateTimeSchema,
  limit: z.number().int().positive().max(1000).optional(),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;

/** Tombstones are included so deletions propagate (§7.3). */
export const SyncPullChangesSchema = z.object({
  persons: z.array(PersonSchema),
  allergies: z.array(AllergySchema),
  conditions: z.array(ConditionSchema),
  medications: z.array(MedicationSchema),
  clinical_events: z.array(ClinicalEventSchema),
  consents: z.array(ConsentSchema),
  user_facilities: z.array(UserFacilitySchema),
});
export type SyncPullChanges = z.infer<typeof SyncPullChangesSchema>;

export const SyncPullResponseSchema = z.object({
  changes: SyncPullChangesSchema,
  /** Becomes the client's new watermark. */
  server_time: IsoDateTimeSchema,
  /** The client re-pulls until this is false. */
  has_more: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export const ReferenceSyncQuerySchema = z.object({
  since: IsoDateTimeSchema,
  rulepack_version: SemverSchema,
  /** State codes the facility slice is scoped to, e.g. ['LA', 'OG']. */
  states: z.array(z.string()).optional(),
});
export type ReferenceSyncQuery = z.infer<typeof ReferenceSyncQuerySchema>;

/**
 * §7.4. `rulepack` is null when the client is already current.
 *
 * The client verifies the SHA-256 against `checksum` BEFORE applying. On
 * mismatch it rejects the pack, keeps the previous one, logs, and carries on
 * with red-flag evaluation intact (AC-6.1.6) — which works because §5.4
 * compiles red flags into the bundle rather than loading them from here.
 */
export const ReferenceSyncResponseSchema = z.object({
  drug_catalog: z.array(DrugCatalogSchema),
  interactions: z.array(DrugInteractionSchema),
  cross_reference: z.array(AllergyCrossReferenceSchema),
  contraindications: z.array(ConditionContraindicationSchema),
  facilities: z.array(FacilitySchema),
  rulepack: z
    .object({
      version: SemverSchema,
      checksum: z.string().min(1),
      content: RulepackDocumentSchema,
    })
    .nullable(),
  server_time: IsoDateTimeSchema,
});
export type ReferenceSyncResponse = z.infer<typeof ReferenceSyncResponseSchema>;
