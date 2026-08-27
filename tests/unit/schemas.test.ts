import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  AllergyCrossReferenceSchema,
  AllergySchema,
  AuditLogInsertSchema,
  AuditLogSchema,
  ClinicalEventInsertSchema,
  ClinicalEventSchema,
  ConditionContraindicationSchema,
  ConditionSchema,
  ConsentSchema,
  DrugCatalogSchema,
  DrugInteractionSchema,
  EmailSchema,
  FacilitySchema,
  MedicationScheduleSchema,
  MedicationSchema,
  NigerianPhoneSchema,
  PG_ENUMS,
  PersonSchema,
  type PgEnumName,
  ProfileSchema,
  RulepackDocumentSchema,
  RulepackRowSchema,
  UserFacilitySchema,
} from '../../src/lib/schemas';
import {
  AllergyInsertSchema,
  ConditionInsertSchema,
  ConsentInsertSchema,
  MedicationInsertSchema,
  PersonInsertSchema,
  UserFacilityInsertSchema,
} from '../../src/lib/schemas/tables';

const SCHEMA_DIR = path.resolve(__dirname, '../../src/lib/schemas');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

// ─────────────────────────── fixtures ───────────────────────────

const TS = '2026-01-01T00:00:00.000Z';
const PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa';
const PERSON_ID = '11111111-1111-4111-a111-111111111111';
const MED_ID = 'ffffffff-1111-4111-a111-111111111111';
const EVENT_ID = 'eeeeeeee-1111-4111-a111-111111111111';
const DRUG_ID = 'dddddddd-1111-4111-a111-111111111111';

const profileFixture = {
  id: PROFILE_ID,
  email: 'usera@example.com',
  phone: '+2348012345678',
  phone_verified_at: TS,
  display_name: 'Test User A',
  created_at: TS,
  updated_at: TS,
};

const personFixture = {
  id: PERSON_ID,
  owner_id: PROFILE_ID,
  display_name: 'User A Person',
  relationship: 'self',
  date_of_birth: '1990-05-04',
  sex_at_birth: 'female',
  is_pregnant: false,
  weight_kg: 61.5,
  created_at: TS,
  updated_at: TS,
  deleted_at: null,
};

const consentFixture = {
  id: 'cccccccc-1111-4111-a111-111111111111',
  owner_id: PROFILE_ID,
  consent_type: 'safety_disclaimer',
  version: '1.0.0',
  granted_at: TS,
  revoked_at: null,
};

const allergyFixture = {
  id: 'abababab-1111-4111-a111-111111111111',
  person_id: PERSON_ID,
  owner_id: PROFILE_ID,
  allergen_type: 'drug',
  allergen_code: 'PEN01',
  allergen_label: 'Penicillin',
  drug_classes: ['Penicillins'],
  severity: 'severe',
  notes: null,
  created_at: TS,
  updated_at: TS,
  deleted_at: null,
};

const conditionFixture = {
  id: 'cdcdcdcd-1111-4111-a111-111111111111',
  person_id: PERSON_ID,
  owner_id: PROFILE_ID,
  condition_code: 'ASTHMA',
  condition_label: 'Asthma',
  onset_date: '2015-03-01',
  is_active: true,
  notes: null,
  created_at: TS,
  updated_at: TS,
  deleted_at: null,
};

const medicationFixture = {
  id: MED_ID,
  person_id: PERSON_ID,
  owner_id: PROFILE_ID,
  drug_id: DRUG_ID,
  is_custom: false,
  display_name: 'Paracetamol 500mg',
  dose_amount: 500,
  dose_unit: 'mg',
  schedule: { kind: 'fixed_times', times: ['08:00', '20:00'] },
  start_date: '2026-01-01',
  end_date: null,
  notes: null,
  created_at: TS,
  updated_at: TS,
  deleted_at: null,
};

const clinicalEventFixture = {
  id: EVENT_ID,
  person_id: PERSON_ID,
  owner_id: PROFILE_ID,
  event_type: 'medication_taken',
  occurred_at: TS,
  recorded_at: TS,
  payload: { medication_id: MED_ID },
  rulepack_version: '1.0.0',
  ruleset_checksum: null,
  client_id: 'test-client',
  corrects_event_id: null,
  deleted_at: null,
  created_at: TS,
};

const drugCatalogFixture = {
  id: DRUG_ID,
  rxnorm_cui: null,
  nafdac_reg_no: null,
  generic_name: 'Paracetamol',
  brand_names: ['Panadol'],
  active_ingredients: [
    { code: 'PAR01', name: 'Paracetamol', strength: '500', unit: 'mg' },
  ],
  drug_classes: ['Analgesics'],
  dosage_form: 'tablet',
  is_otc: true,
  region: 'NG',
  updated_at: TS,
};

const drugInteractionFixture = {
  id: 'd1d1d1d1-1111-4111-a111-111111111111',
  class_a: 'NSAIDs',
  class_b: 'Anticoagulants',
  severity: 'SERIOUS',
  mechanism: 'Additive bleeding risk.',
  recommendation: 'Discuss with a pharmacist or doctor before combining.',
  source: 'Curated',
  evidence_url: null,
  updated_at: TS,
};

const crossReferenceFixture = {
  id: 'c1c1c1c1-1111-4111-a111-111111111111',
  allergen_class: 'Penicillins',
  reactive_class: 'Cephalosporins',
  risk_level: 'low-moderate',
  note: 'Some cross-reactivity is recognised.',
  source: 'Curated',
};

const contraindicationFixture = {
  id: 'c2c2c2c2-1111-4111-a111-111111111111',
  condition_code: 'CKD',
  drug_class: 'NSAIDs',
  severity: 'SERIOUS',
  explanation: 'NSAIDs can reduce kidney function further.',
  source: 'Curated',
};

const rulepackDocumentFixture = {
  version: '1.0.0',
  checksum: `sha256:${'e'.repeat(64)}`,
  locale: 'en-NG',
  reviewStatus: 'draft',
  symptoms: [
    { code: 'SYM_FEVER', label: 'Fever', bodySystem: 'general', questions: [] },
  ],
  urgencyRules: [
    {
      id: 'UR_001',
      when: { all: ['SYM_FEVER'] },
      band: 'SEE_DOCTOR_TODAY',
      guidance: 'A fever lasting more than three days should be assessed.',
      source: 'WHO Clinical Guidelines',
    },
  ],
  alertCopy: {
    DUPLICATE_INGREDIENT: {
      title: 'Two medicines contain the same ingredient',
      body: 'Both products contain the same active ingredient.',
    },
  },
  disclaimerVersion: '1.0.0',
};

const rulepackRowFixture = {
  id: 'r1r1r1r1-1111-4111-a111-111111111111'.replace(/r/g, 'a'),
  version: '1.0.0',
  checksum: `sha256:${'e'.repeat(64)}`,
  content: rulepackDocumentFixture,
  review_status: 'draft',
  reviewed_by: null,
  reviewed_at: null,
  published_at: null,
  created_at: TS,
};

const facilityFixture = {
  id: 'fafafafa-1111-4111-a111-111111111111',
  facility_type: 'hospital',
  name: 'Test Emergency Hospital',
  address: '1 Test Road',
  state: 'Lagos',
  lga: 'Ikeja',
  latitude: 6.605874,
  longitude: 3.349149,
  phone_numbers: ['+2348000000001'],
  has_emergency: true,
  is_24_hours: true,
  opening_hours: null,
  verified_at: '2026-01-15',
  verified_by: 'seed-fixture',
  source: 'test-fixture',
  region: 'NG',
  updated_at: TS,
};

const userFacilityFixture = {
  id: 'fbfbfbfb-1111-4111-a111-111111111111',
  owner_id: PROFILE_ID,
  facility_id: 'fafafafa-1111-4111-a111-111111111111',
  label: 'My clinic',
  phone_number: '+2348000000003',
  address: null,
  is_emergency: false,
  created_at: TS,
  updated_at: TS,
  deleted_at: null,
};

const auditLogFixture = {
  id: 1,
  owner_id: PROFILE_ID,
  action: 'sync.push',
  resource: 'clinical_events',
  resource_id: EVENT_ID,
  ip_address: '127.0.0.1',
  user_agent: 'vitest',
  occurred_at: TS,
};

/** Every table schema, its fixture, and a required field to strip for test (c). */
const TABLE_CASES = [
  {
    name: 'ProfileSchema',
    schema: ProfileSchema,
    fixture: profileFixture,
    required: 'email',
  },
  {
    name: 'PersonSchema',
    schema: PersonSchema,
    fixture: personFixture,
    required: 'display_name',
  },
  {
    name: 'ConsentSchema',
    schema: ConsentSchema,
    fixture: consentFixture,
    required: 'granted_at',
  },
  {
    name: 'AllergySchema',
    schema: AllergySchema,
    fixture: allergyFixture,
    required: 'allergen_label',
  },
  {
    name: 'ConditionSchema',
    schema: ConditionSchema,
    fixture: conditionFixture,
    required: 'condition_label',
  },
  {
    name: 'MedicationSchema',
    schema: MedicationSchema,
    fixture: medicationFixture,
    required: 'schedule',
  },
  {
    name: 'ClinicalEventSchema',
    schema: ClinicalEventSchema,
    fixture: clinicalEventFixture,
    required: 'payload',
  },
  {
    name: 'DrugCatalogSchema',
    schema: DrugCatalogSchema,
    fixture: drugCatalogFixture,
    required: 'generic_name',
  },
  {
    name: 'DrugInteractionSchema',
    schema: DrugInteractionSchema,
    fixture: drugInteractionFixture,
    required: 'recommendation',
  },
  {
    name: 'AllergyCrossReferenceSchema',
    schema: AllergyCrossReferenceSchema,
    fixture: crossReferenceFixture,
    required: 'reactive_class',
  },
  {
    name: 'ConditionContraindicationSchema',
    schema: ConditionContraindicationSchema,
    fixture: contraindicationFixture,
    required: 'drug_class',
  },
  {
    name: 'FacilitySchema',
    schema: FacilitySchema,
    fixture: facilityFixture,
    // verified_at is NOT NULL by design (§6.3) — an unverified facility on the
    // escalation screen is a safety defect.
    required: 'verified_at',
  },
  {
    name: 'UserFacilitySchema',
    schema: UserFacilitySchema,
    fixture: userFacilityFixture,
    required: 'label',
  },
  {
    name: 'RulepackRowSchema',
    schema: RulepackRowSchema,
    fixture: rulepackRowFixture,
    required: 'checksum',
  },
  {
    name: 'AuditLogSchema',
    schema: AuditLogSchema,
    fixture: auditLogFixture,
    required: 'action',
  },
] as const;

/** Insert variants for tables that carry an owner_id (test d). */
const OWNED_INSERT_CASES = [
  {
    name: 'PersonInsertSchema',
    schema: PersonInsertSchema,
    fixture: personFixture,
  },
  {
    name: 'ConsentInsertSchema',
    schema: ConsentInsertSchema,
    fixture: consentFixture,
  },
  {
    name: 'AllergyInsertSchema',
    schema: AllergyInsertSchema,
    fixture: allergyFixture,
  },
  {
    name: 'ConditionInsertSchema',
    schema: ConditionInsertSchema,
    fixture: conditionFixture,
  },
  {
    name: 'MedicationInsertSchema',
    schema: MedicationInsertSchema,
    fixture: medicationFixture,
  },
  {
    name: 'UserFacilityInsertSchema',
    schema: UserFacilityInsertSchema,
    fixture: userFacilityFixture,
  },
  {
    name: 'AuditLogInsertSchema',
    schema: AuditLogInsertSchema,
    fixture: auditLogFixture,
  },
] as const;

// ───────────────────── (a) enum parity ─────────────────────

/**
 * Parse `create type <name> as enum (...)` out of the migration files.
 *
 * This runs with no database and is the local half of the parity check: it
 * catches a migration that adds an enum value the Zod layer does not know about,
 * which is the drift the gate exists to prevent. The pg_enum half below is the
 * authoritative check, because only the live database proves what actually
 * applied.
 */
function enumsDeclaredInMigrations(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const pattern = /create\s+type\s+(\w+)\s+as\s+enum\s*\(([^)]*)\)/gis;
    let match = pattern.exec(sql);
    while (match !== null) {
      const name = match[1];
      const body = match[2];
      if (name !== undefined && body !== undefined) {
        const values = Array.from(body.matchAll(/'([^']*)'/g)).flatMap((m) =>
          m[1] === undefined ? [] : [m[1]],
        );
        declared.set(name, values);
      }
      match = pattern.exec(sql);
    }
  }
  return declared;
}

describe('(a) enum parity — migrations', () => {
  const declared = enumsDeclaredInMigrations();

  it('every Zod enum is declared in a migration', () => {
    for (const name of Object.keys(PG_ENUMS)) {
      expect(
        declared.has(name),
        `${name} is not declared in any migration`,
      ).toBe(true);
    }
  });

  it('every enum declared in a migration has a Zod counterpart', () => {
    // Catches the reverse drift: a migration adds an enum the type layer has
    // never heard of, so nothing downstream can validate it.
    for (const name of declared.keys()) {
      expect(
        Object.hasOwn(PG_ENUMS, name),
        `${name} exists in SQL but not in PG_ENUMS`,
      ).toBe(true);
    }
  });

  it.each(Object.keys(PG_ENUMS) as PgEnumName[])(
    '%s values and order match the migration exactly',
    (name) => {
      expect(declared.get(name)).toEqual([...PG_ENUMS[name].options]);
    },
  );
});

const PG_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LIVE_REQUIRED =
  process.env.CI === 'true' || process.env.SANA_RLS_LIVE === '1';

async function readPgEnums(): Promise<Map<string, string[]> | null> {
  const client = new Client({
    connectionString: PG_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
  } catch {
    return null;
  }
  try {
    // `enumlabel` is of type `name`, so `array_agg(e.enumlabel)` yields name[]
    // (oid 1003) — a type node-postgres has no parser for, so it hands back the
    // raw literal '{a,b,c}' as a string instead of an array. Casting to text
    // makes it text[] (oid 1009), which is parsed into a real JS array.
    const { rows } = await client.query<{ typname: string; values: string[] }>(
      `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as values
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
        group by t.typname`,
    );
    return new Map(rows.map((r) => [r.typname, r.values]));
  } finally {
    await client.end();
  }
}

const pgEnums = await readPgEnums();

if (pgEnums === null) {
  console.warn(
    `\n[SCHEMAS] pg_enum parity SKIPPED — no database at ${PG_URL}. Migration-file parity still ran.\n`,
  );
}

describe('(a) enum parity — live pg_enum', () => {
  it('a live database is reachable when the proof is mandatory (CI or SANA_RLS_LIVE=1)', () => {
    if (LIVE_REQUIRED && pgEnums === null) {
      throw new Error(
        `Enum parity against pg_enum is mandatory here but no database is reachable at ${PG_URL}. Refusing to report green without checking the live catalog.`,
      );
    }
    expect(pgEnums !== null || !LIVE_REQUIRED).toBe(true);
  });

  it.runIf(pgEnums !== null)(
    'pg_enum reports no enum the type layer lacks',
    () => {
      for (const name of (pgEnums as Map<string, string[]>).keys()) {
        expect(
          Object.hasOwn(PG_ENUMS, name),
          `${name} exists in pg_enum but not in PG_ENUMS`,
        ).toBe(true);
      }
    },
  );

  it.each(Object.keys(PG_ENUMS) as PgEnumName[])(
    '%s matches pg_enum exactly, including order',
    (name) => {
      if (pgEnums === null) return;
      expect(pgEnums.get(name)).toEqual([...PG_ENUMS[name].options]);
    },
  );
});

// ───────────────────── (b) (c) table schemas ─────────────────────

describe('(b) table schemas round-trip', () => {
  it.each(TABLE_CASES)(
    '$name parses and re-serialises identically',
    ({ schema, fixture }) => {
      const parsed = schema.parse(fixture);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture);
    },
  );
});

describe('(c) table schemas reject a missing required field', () => {
  it.each(TABLE_CASES)(
    '$name rejects a fixture missing $required',
    ({ schema, fixture, required }) => {
      const incomplete: Record<string, unknown> = { ...fixture };
      delete incomplete[required];
      expect(schema.safeParse(incomplete).success).toBe(false);
    },
  );
});

// ───────────────────── (d) insert variants ─────────────────────

describe('(d) Insert variants reject owner_id', () => {
  // §7.2: the server always derives owner_id from the JWT and ignores any
  // client value. Rejecting rather than silently stripping means a client that
  // believes it controls the owner is told otherwise.
  it.each(OWNED_INSERT_CASES)(
    '$name rejects a payload containing owner_id',
    ({ schema, fixture }) => {
      const result = schema.safeParse(fixture);
      expect(result.success).toBe(false);
    },
  );

  it('ClinicalEventInsertSchema rejects a payload containing owner_id', () => {
    expect(
      ClinicalEventInsertSchema.safeParse(clinicalEventFixture).success,
    ).toBe(false);
  });

  it('a stripped payload without owner_id is accepted', () => {
    const {
      owner_id: _ownerId,
      created_at: _c,
      updated_at: _u,
      ...rest
    } = personFixture;
    expect(PersonInsertSchema.safeParse(rest).success).toBe(true);
  });
});

// ───────────────────── (e) event payload union ─────────────────────

const EVENT_PAYLOAD_FIXTURES: Array<{
  event_type: string;
  payload: Record<string, unknown>;
}> = [
  {
    event_type: 'medication_taken',
    payload: { medication_id: MED_ID, dose_amount: 500 },
  },
  {
    event_type: 'medication_skipped',
    payload: { medication_id: MED_ID, scheduled_for: TS, reason: 'asleep' },
  },
  { event_type: 'symptom_reported', payload: { symptom_codes: ['SYM_FEVER'] } },
  {
    event_type: 'triage_completed',
    payload: { symptom_codes: ['SYM_FEVER'], urgency_band: 'SEE_DOCTOR_TODAY' },
  },
  { event_type: 'allergy_recorded', payload: { record_id: allergyFixture.id } },
  {
    event_type: 'condition_recorded',
    payload: { record_id: conditionFixture.id },
  },
  {
    event_type: 'vital_recorded',
    payload: { kind: 'weight', value: 61.5, unit: 'kg' },
  },
  { event_type: 'note_added', payload: { text: 'Felt better today.' } },
  {
    event_type: 'correction',
    payload: { corrects_event_id: EVENT_ID, reason: 'wrong time' },
  },
];

function eventWith(eventType: string, payload: Record<string, unknown>) {
  return { ...clinicalEventFixture, event_type: eventType, payload };
}

/**
 * `allergy_recorded` and `condition_recorded` are both `{ record_id: uuid }`.
 * `AllergyId` and `ConditionId` differ only by a compile-time brand, so the
 * compiler rejects a swap but a runtime parse cannot see one. Excluded from the
 * cross-product below and asserted separately, rather than quietly skipped.
 */
const RUNTIME_IDENTICAL_PAIRS = new Set([
  'allergy_recorded->condition_recorded',
  'condition_recorded->allergy_recorded',
]);

const CROSS_PAIRS = EVENT_PAYLOAD_FIXTURES.flatMap((target) =>
  EVENT_PAYLOAD_FIXTURES.filter(
    (source) =>
      source.event_type !== target.event_type &&
      !RUNTIME_IDENTICAL_PAIRS.has(
        `${target.event_type}->${source.event_type}`,
      ),
  ).map((source) => ({
    target: target.event_type,
    source: source.event_type,
    payload: source.payload,
  })),
);

describe('(e) event payload union', () => {
  it.each(EVENT_PAYLOAD_FIXTURES)(
    '$event_type accepts its own payload',
    ({ event_type, payload }) => {
      expect(
        ClinicalEventSchema.safeParse(eventWith(event_type, payload)).success,
      ).toBe(true);
    },
  );

  // Full cross-product: every event_type against every other type's payload.
  it.each(CROSS_PAIRS)(
    '$target rejects a $source payload',
    ({ target, payload }) => {
      expect(
        ClinicalEventSchema.safeParse(eventWith(target, payload)).success,
      ).toBe(false);
    },
  );

  it('covers every ordered pair except the runtime-identical ones', () => {
    const n = EVENT_PAYLOAD_FIXTURES.length;
    expect(CROSS_PAIRS.length).toBe(n * (n - 1) - RUNTIME_IDENTICAL_PAIRS.size);
  });

  it('allergy_recorded and condition_recorded are separated by branding, not by parsing', () => {
    // Documented limitation, asserted so it cannot change silently: these two
    // DO parse interchangeably. The event's own event_type column is what
    // distinguishes them at runtime.
    const conditionPayload = { record_id: conditionFixture.id };
    expect(
      ClinicalEventSchema.safeParse(
        eventWith('allergy_recorded', conditionPayload),
      ).success,
    ).toBe(true);
  });

  it('rejects an unknown event_type outright', () => {
    expect(
      ClinicalEventSchema.safeParse(eventWith('teleport', { x: 1 })).success,
    ).toBe(false);
  });

  it('rejects a payload carrying an unexpected extra key', () => {
    expect(
      ClinicalEventSchema.safeParse(
        eventWith('note_added', { text: 'hello', smuggled: true }),
      ).success,
    ).toBe(false);
  });
});

// ───────────────────── (f) medication schedule ─────────────────────

const SCHEDULE_FIXTURES = [
  { kind: 'fixed_times', times: ['08:00', '20:00'], timezone: 'Africa/Lagos' },
  { kind: 'interval_hours', every_hours: 6, anchor_time: '07:30' },
  { kind: 'as_needed', max_per_day: 4, note: 'for pain' },
];

describe('(f) medication schedule round-trips losslessly (AC-3.2.1)', () => {
  it.each(SCHEDULE_FIXTURES)('$kind round-trips', (fixture) => {
    const parsed = MedicationScheduleSchema.parse(fixture);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture);
  });

  it('rejects a schedule with no discriminant', () => {
    expect(
      MedicationScheduleSchema.safeParse({ times: ['08:00'] }).success,
    ).toBe(false);
  });

  it('rejects a malformed time of day', () => {
    expect(
      MedicationScheduleSchema.safeParse({
        kind: 'fixed_times',
        times: ['25:00'],
      }).success,
    ).toBe(false);
  });
});

// ───────────────────── (g) identity ─────────────────────

describe('(g) Nigerian phone normalisation — RECOVERY ONLY, never a login method', () => {
  it.each(['08012345678', '+2348012345678', '2348012345678'])(
    '%s normalises to +2348012345678',
    (input) => {
      expect(NigerianPhoneSchema.parse(input)).toBe('+2348012345678');
    },
  );

  it('tolerates the separators people actually type', () => {
    expect(NigerianPhoneSchema.parse('0801 234 5678')).toBe('+2348012345678');
    expect(NigerianPhoneSchema.parse('+234-801-234-5678')).toBe(
      '+2348012345678',
    );
  });

  it.each(['1234', '080123', '', '0601234567', 'not a phone'])(
    'rejects %s',
    (input) => {
      expect(NigerianPhoneSchema.safeParse(input).success).toBe(false);
    },
  );

  it('reports a useful message rather than a regex dump', () => {
    const result = NigerianPhoneSchema.safeParse('1234');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        'Nigerian mobile number',
      );
    }
  });
});

describe('(g) email is the login identifier (v1.3)', () => {
  it('trims and lowercases so one person cannot become two accounts', () => {
    expect(EmailSchema.parse('  User@Example.COM ')).toBe('user@example.com');
  });

  it.each(['', 'nope', 'a@b', 'no-at-sign.com'])('rejects %s', (input) => {
    expect(EmailSchema.safeParse(input).success).toBe(false);
  });
});

// ───────────────────── (h) rulepack ─────────────────────

describe('(h) rulepack band constraint (§8)', () => {
  it('accepts the reference document', () => {
    expect(
      RulepackDocumentSchema.safeParse(rulepackDocumentFixture).success,
    ).toBe(true);
  });

  it.each([
    'EMERGENCY',
    'SEE_DOCTOR_TODAY',
    'SEE_DOCTOR_SOON',
    'SELF_CARE_REASONABLE',
  ])('accepts band %s', (band) => {
    const doc = {
      ...rulepackDocumentFixture,
      urgencyRules: [{ ...rulepackDocumentFixture.urgencyRules[0], band }],
    };
    expect(RulepackDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it.each(['URGENT', 'see_doctor_today', 'CALL_AMBULANCE', ''])(
    'rejects band outside the urgency_band enum: %s',
    (band) => {
      const doc = {
        ...rulepackDocumentFixture,
        urgencyRules: [{ ...rulepackDocumentFixture.urgencyRules[0], band }],
      };
      expect(RulepackDocumentSchema.safeParse(doc).success).toBe(false);
    },
  );

  it('matches the checked-in rulepack fixture', () => {
    const raw = readFileSync(
      path.resolve(__dirname, '../../content/rulepack/rulepack.v1.json'),
      'utf8',
    );
    expect(RulepackDocumentSchema.safeParse(JSON.parse(raw)).success).toBe(
      true,
    );
  });
});

// ───────────────────── (i) no duplicate types ─────────────────────

describe('(i) no hand-written interfaces in src/lib/schemas', () => {
  /**
   * PRD §0 and the step 3 core rule: Zod schemas are the ONLY definition of
   * every boundary type, and types are derived with `z.infer`. A hand-written
   * `interface` duplicating a schema's shape is free to drift from the schema
   * that actually validates the data, which is how a type layer stops
   * describing reality.
   *
   * `type X = z.infer<...>` is a derivation, not a duplicate, and is fine.
   */
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'));

  it('finds schema files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s declares no bare interface', (file) => {
    const source = readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/^\s*(export\s+)?interface\s+\w+/m);
  });
});
