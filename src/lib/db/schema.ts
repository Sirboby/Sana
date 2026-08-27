import Dexie, { type Table } from 'dexie';
import type {
  Allergy,
  AllergyCrossReference,
  ClinicalEvent,
  Condition,
  ConditionContraindication,
  DiscoveredFacility,
  DrugCatalog,
  DrugInteraction,
  Facility,
  Medication,
  Person,
  RulepackDocument,
  UserFacility,
} from '../schemas';
import type { EncryptedField } from './crypto';
import type { OutboxEntry } from './outbox';

/**
 * The local store (PRD §6.4).
 *
 * Stored rows are NOT the same shape as the domain rows from `src/lib/schemas`:
 * content fields hold an `EncryptedField` in place of their real type. Those
 * stored shapes are DERIVED from the domain types below rather than hand-written,
 * so a column added to a Zod schema cannot silently go missing here.
 *
 * See ./crypto.ts for what field-level encryption does and does not protect.
 */

/** Replace selected keys of T with EncryptedField. */
type EncryptedOf<T, K extends keyof T> = Omit<T, K> & Record<K, EncryptedField>;

/**
 * `Omit` collapses a union into a single object type, which would destroy the
 * `event_type` discriminant on ClinicalEvent. Distributing over the union keeps
 * each member — and therefore keeps the payload union usable after a read.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type StoredPerson = EncryptedOf<
  Person,
  'display_name' | 'date_of_birth' | 'weight_kg'
>;
export type StoredAllergy = EncryptedOf<Allergy, 'allergen_label' | 'notes'>;
export type StoredCondition = EncryptedOf<
  Condition,
  'condition_label' | 'notes'
>;
export type StoredMedication = EncryptedOf<
  Medication,
  'display_name' | 'notes' | 'dose_amount' | 'dose_unit'
>;

/** Only `payload` is encrypted; `event_type` stays plaintext as an index. */
export type StoredClinicalEvent = DistributiveOmit<ClinicalEvent, 'payload'> & {
  payload: EncryptedField;
};

/**
 * Tier 3 OSM cache (§5.5, §6.4). LOCAL ONLY — never synced, never a server
 * table, never eligible for the escalation screen.
 *
 * DEVIATION: §6.4 indexes this on `id` and `[grid_lat+grid_lon]`, but
 * `DiscoveredFacilitySchema` (step 3) carries neither, because those are storage
 * concerns rather than parts of the API response in §7.4b. They are added here.
 * `grid_lat`/`grid_lon` are the ~1km coarsened cell the record was fetched for
 * (§5.5 privacy), which is what makes the cache addressable offline.
 */
export type StoredDiscoveredFacility = DiscoveredFacility & {
  id: string;
  grid_lat: number;
  grid_lon: number;
};

/** Key/value metadata. §6.4 gives no other KV store, so the keyring lives here. */
export type SyncMetaRow = {
  key: string;
  value: unknown;
};

export class SanaDatabase extends Dexie {
  // User data — content fields encrypted.
  persons!: Table<StoredPerson, string>;
  allergies!: Table<StoredAllergy, string>;
  conditions!: Table<StoredCondition, string>;
  medications!: Table<StoredMedication, string>;
  clinical_events!: Table<StoredClinicalEvent, string>;
  user_facilities!: Table<UserFacility, string>;

  // Public reference data — deliberately NOT encrypted. Encrypting it would
  // break offline search, and it is identical for every user, so it discloses
  // nothing about this one.
  drug_catalog!: Table<DrugCatalog, string>;
  interactions!: Table<DrugInteraction, string>;
  cross_reference!: Table<AllergyCrossReference, string>;
  contraindications!: Table<ConditionContraindication, string>;
  facilities!: Table<Facility, string>;
  discovered_facilities!: Table<StoredDiscoveredFacility, string>;
  rulepack!: Table<RulepackDocument, string>;

  // Sync plumbing. The outbox is written here but never drained — that is step 9.
  outbox!: Table<OutboxEntry, number>;
  sync_meta!: Table<SyncMetaRow, string>;

  constructor(name = 'sana') {
    super(name);
    // Transcribed from §6.4 exactly. Only indexed fields are listed; Dexie
    // stores every other property without indexing it.
    this.version(1).stores({
      persons: 'id, owner_id, deleted_at',
      allergies: 'id, person_id, deleted_at',
      conditions: 'id, person_id, deleted_at',
      medications: 'id, person_id, deleted_at, end_date',
      clinical_events:
        'id, person_id, [person_id+occurred_at], event_type, deleted_at',
      drug_catalog: 'id, generic_name, *brand_names, *drug_classes',
      interactions: 'id, [class_a+class_b]',
      cross_reference: 'id, allergen_class',
      contraindications: 'id, [condition_code+drug_class]',
      facilities: 'id, [state+lga], facility_type, has_emergency',
      user_facilities: 'id, owner_id, deleted_at',
      discovered_facilities:
        'id, [grid_lat+grid_lon], facility_type, fetched_at',
      rulepack: 'version',
      outbox: '++seq, mutation_id, status, created_at',
      sync_meta: 'key',
    });
  }
}

export const db = new SanaDatabase();

/** Every table holding user data, for the wipe path in keyring.ts. */
export const USER_DATA_TABLES = [
  'persons',
  'allergies',
  'conditions',
  'medications',
  'clinical_events',
  'user_facilities',
  'outbox',
] as const;
