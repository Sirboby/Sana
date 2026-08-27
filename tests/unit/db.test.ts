import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DatabaseLockedError,
  MAX_FAILED_ATTEMPTS,
  WARN_FROM_ATTEMPT,
  allergiesRepository,
  conditionsRepository,
  db,
  decryptOutboxRow,
  eventsRepository,
  failedAttempts,
  getClientId,
  isPinConfigured,
  isUnlocked,
  lock,
  medicationsRepository,
  personsRepository,
  referenceRepository,
  setupPin,
  unlock,
  userFacilitiesRepository,
} from '../../src/lib/db';
import { encryptField, isEncryptedField } from '../../src/lib/db/crypto';
import {
  __resetKeyringForTests,
  requireDataKey,
} from '../../src/lib/db/keyring';
import {
  AllergyIdSchema,
  ConditionIdSchema,
  DrugIdSchema,
  EventIdSchema,
  MedicationIdSchema,
  PersonIdSchema,
  ProfileIdSchema,
  UserFacilityIdSchema,
} from '../../src/lib/schemas';

const PIN = '123456';
const WRONG_PIN = '000000';

// Branded at the boundary, exactly as production code must. A bare string
// literal will not compile here — which is the step 3 branding doing its job.
const OWNER_ID = ProfileIdSchema.parse('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa');
const PERSON_ID = PersonIdSchema.parse('11111111-1111-4111-a111-111111111111');
const MED_ID = MedicationIdSchema.parse('ffffffff-1111-4111-a111-111111111111');
const EVENT_ID = EventIdSchema.parse('eeeeeeee-1111-4111-a111-111111111111');
const EVENT_ID_2 = EventIdSchema.parse('eeeeeeee-1111-4111-a111-222222222222');
const DRUG_ID = DrugIdSchema.parse('dddddddd-1111-4111-a111-111111111111');
const ALLERGY_ID = AllergyIdSchema.parse(
  'abababab-1111-4111-a111-111111111111',
);
const CONDITION_ID = ConditionIdSchema.parse(
  'cdcdcdcd-1111-4111-a111-111111111111',
);
const USER_FACILITY_ID = UserFacilityIdSchema.parse(
  'fbfbfbfb-1111-4111-a111-111111111111',
);

const personDraft = {
  id: PERSON_ID,
  owner_id: OWNER_ID,
  display_name: 'Adaeze Okonkwo',
  relationship: 'self',
  date_of_birth: '1990-05-04',
  sex_at_birth: 'female' as const,
  is_pregnant: false,
  weight_kg: 61.5,
};

const allergyDraft = {
  id: ALLERGY_ID,
  person_id: PERSON_ID,
  owner_id: OWNER_ID,
  allergen_type: 'drug' as const,
  allergen_code: 'PEN01',
  allergen_label: 'Penicillin',
  drug_classes: ['Penicillins'],
  severity: 'severe' as const,
  notes: 'Rash and swelling in 2019.',
};

const conditionDraft = {
  id: CONDITION_ID,
  person_id: PERSON_ID,
  owner_id: OWNER_ID,
  condition_code: 'ASTHMA',
  condition_label: 'Asthma',
  onset_date: '2015-03-01',
  is_active: true,
  notes: 'Worse in harmattan.',
};

const medicationDraft = {
  id: MED_ID,
  person_id: PERSON_ID,
  owner_id: OWNER_ID,
  drug_id: DRUG_ID,
  is_custom: false,
  display_name: 'Paracetamol 500mg',
  dose_amount: 500,
  dose_unit: 'mg',
  schedule: { kind: 'fixed_times' as const, times: ['08:00', '20:00'] },
  start_date: '2026-01-01',
  end_date: null,
  notes: 'For headaches only.',
};

const userFacilityDraft = {
  id: USER_FACILITY_ID,
  owner_id: OWNER_ID,
  facility_id: null,
  label: 'Ikeja General',
  phone_number: '+2348000000003',
  address: '1 Test Road',
  is_emergency: true,
};

const eventDraft = {
  id: EVENT_ID,
  person_id: PERSON_ID,
  owner_id: OWNER_ID,
  event_type: 'medication_taken' as const,
  occurred_at: '2026-02-01T08:00:00.000Z',
  payload: { medication_id: MED_ID, dose_amount: 500, dose_unit: 'mg' },
  rulepack_version: '1.0.0',
  ruleset_checksum: null,
  client_id: 'test-device',
  corrects_event_id: null,
};

beforeEach(async () => {
  __resetKeyringForTests();
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await setupPin(PIN);
});

describe('(a) round-trip: every entity type', () => {
  it('persons decrypt back to the original values', async () => {
    const created = await personsRepository.create(personDraft);
    const read = await personsRepository.getById(PERSON_ID);
    expect(read).not.toBeNull();
    expect(read?.display_name).toBe('Adaeze Okonkwo');
    expect(read?.date_of_birth).toBe('1990-05-04');
    expect(read?.weight_kg).toBe(61.5);
    expect(read).toEqual(created);
  });

  it('allergies decrypt back to the original values', async () => {
    await allergiesRepository.create(allergyDraft);
    const read = await allergiesRepository.getById(allergyDraft.id);
    expect(read?.allergen_label).toBe('Penicillin');
    expect(read?.notes).toBe('Rash and swelling in 2019.');
    expect(read?.drug_classes).toEqual(['Penicillins']);
  });

  it('conditions decrypt back to the original values', async () => {
    await conditionsRepository.create(conditionDraft);
    const read = await conditionsRepository.getById(conditionDraft.id);
    expect(read?.condition_label).toBe('Asthma');
    expect(read?.notes).toBe('Worse in harmattan.');
  });

  it('medications decrypt back to the original values', async () => {
    await medicationsRepository.create(medicationDraft);
    const read = await medicationsRepository.getById(MED_ID);
    expect(read?.display_name).toBe('Paracetamol 500mg');
    expect(read?.dose_amount).toBe(500);
    expect(read?.dose_unit).toBe('mg');
    expect(read?.schedule).toEqual({
      kind: 'fixed_times',
      times: ['08:00', '20:00'],
    });
  });

  it('clinical events decrypt back to the original payload', async () => {
    await eventsRepository.append(eventDraft);
    const read = await eventsRepository.getById(EVENT_ID);
    expect(read?.payload).toEqual({
      medication_id: MED_ID,
      dose_amount: 500,
      dose_unit: 'mg',
    });
    expect(read?.event_type).toBe('medication_taken');
  });

  it('user facilities round-trip', async () => {
    await userFacilitiesRepository.create(userFacilityDraft);
    const read = await userFacilitiesRepository.getById(userFacilityDraft.id);
    expect(read?.label).toBe('Ikeja General');
  });

  it('reference data round-trips and needs no key', async () => {
    await referenceRepository.replaceDrugCatalog([
      {
        id: DRUG_ID,
        rxnorm_cui: null,
        nafdac_reg_no: null,
        generic_name: 'Paracetamol',
        brand_names: ['Panadol'],
        active_ingredients: [{ code: 'PAR01', name: 'Paracetamol' }],
        drug_classes: ['Analgesics'],
        dosage_form: 'tablet',
        is_otc: true,
        region: 'NG',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    lock();
    // Readable while locked — step 7's red-flag engine depends on this.
    expect(await referenceRepository.countDrugs()).toBe(1);
    const hits = await referenceRepository.searchDrugsByGenericName('Para');
    expect(hits).toHaveLength(1);
  });
});

describe('(b) encrypted fields are ciphertext in the raw store', () => {
  it('person content fields are not readable in the raw record', async () => {
    await personsRepository.create(personDraft);
    const raw = await db.persons.get(PERSON_ID);
    const serialised = JSON.stringify(raw);

    for (const field of [
      'display_name',
      'date_of_birth',
      'weight_kg',
    ] as const) {
      const value = (raw as unknown as Record<string, unknown>)[field];
      expect(
        isEncryptedField(value),
        `${field} should be an EncryptedField`,
      ).toBe(true);
      expect(value).not.toBe(personDraft[field]);
    }

    // The plaintext must not appear anywhere in the stored record, including as
    // a substring — a partial leak is still a leak.
    expect(serialised).not.toContain('Adaeze');
    expect(serialised).not.toContain('1990-05-04');
    expect(serialised).not.toContain('61.5');
  });

  it('medication and event content is not readable in the raw record', async () => {
    await medicationsRepository.create(medicationDraft);
    await eventsRepository.append(eventDraft);

    const rawMed = JSON.stringify(await db.medications.get(MED_ID));
    expect(rawMed).not.toContain('Paracetamol 500mg');
    expect(rawMed).not.toContain('For headaches only.');

    const rawEvent = await db.clinical_events.get(EVENT_ID);
    expect(isEncryptedField(rawEvent?.payload)).toBe(true);
    expect(JSON.stringify(rawEvent)).not.toContain('dose_amount');
  });

  it('the outbox stores the queued row as ciphertext, not plaintext', async () => {
    await medicationsRepository.create(medicationDraft);
    const entries = await db.outbox.toArray();
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    expect(isEncryptedField(entry.row)).toBe(true);
    expect(JSON.stringify(entry)).not.toContain('Paracetamol 500mg');

    // ...and step 9 can still recover exactly what §7.2 needs to push.
    const plaintext = await decryptOutboxRow(requireDataKey(), entry);
    expect(plaintext.display_name).toBe('Paracetamol 500mg');
  });
});

describe('(c) indexed fields are plaintext in the raw store', () => {
  it('keeps every indexed and structural column readable', async () => {
    await personsRepository.create(personDraft);
    await medicationsRepository.create(medicationDraft);
    await eventsRepository.append(eventDraft);

    const rawPerson = await db.persons.get(PERSON_ID);
    expect(rawPerson?.id).toBe(PERSON_ID);
    expect(rawPerson?.owner_id).toBe(OWNER_ID);
    expect(rawPerson?.deleted_at).toBeNull();

    const rawMed = await db.medications.get(MED_ID);
    expect(rawMed?.person_id).toBe(PERSON_ID);
    expect(rawMed?.end_date).toBeNull();
    expect(rawMed?.is_custom).toBe(false);
    expect(rawMed?.drug_id).toBe(DRUG_ID);
    expect(rawMed?.start_date).toBe('2026-01-01');

    const rawEvent = await db.clinical_events.get(EVENT_ID);
    expect(rawEvent?.person_id).toBe(PERSON_ID);
    expect(rawEvent?.occurred_at).toBe('2026-02-01T08:00:00.000Z');
    expect(rawEvent?.event_type).toBe('medication_taken');
  });

  it('the compound [person_id+occurred_at] index is queryable', async () => {
    await eventsRepository.append(eventDraft);
    await eventsRepository.append({
      ...eventDraft,
      id: EVENT_ID_2,
      occurred_at: '2026-02-02T08:00:00.000Z',
    });
    const events = await eventsRepository.listByPerson(PERSON_ID);
    expect(events).toHaveLength(2);
    // Newest first.
    expect(events[0]?.occurred_at).toBe('2026-02-02T08:00:00.000Z');
  });
});

describe('(d) IV uniqueness', () => {
  it('encrypting identical plaintext twice yields different ciphertext', async () => {
    const key = requireDataKey();
    const first = await encryptField(key, 'Paracetamol 500mg');
    const second = await encryptField(key, 'Paracetamol 500mg');

    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  it('produces no repeated IV across many encryptions', async () => {
    const key = requireDataKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      ivs.add((await encryptField(key, 'same value')).iv);
    }
    expect(ivs.size).toBe(200);
  });

  it('two writes of the same value produce different stored ciphertext', async () => {
    await personsRepository.create(personDraft);
    const firstRaw = await db.persons.get(PERSON_ID);
    await personsRepository.update(PERSON_ID, {
      display_name: 'Adaeze Okonkwo',
    });
    const secondRaw = await db.persons.get(PERSON_ID);
    expect(firstRaw?.display_name.ct).not.toBe(secondRaw?.display_name.ct);
  });
});

describe('(e) wrong PIN', () => {
  it('fails to unwrap and leaves the wrapped key intact', async () => {
    const before = await db.sync_meta.get('keyring');
    lock();

    const result = await unlock(WRONG_PIN);
    expect(result.ok).toBe(false);
    expect(isUnlocked()).toBe(false);

    const after = await db.sync_meta.get('keyring');
    const beforeValue = before?.value as Record<string, unknown>;
    const afterValue = after?.value as Record<string, unknown>;
    // The wrapped key and salt must be untouched; only the counter moves.
    expect(afterValue.wrappedKey).toEqual(beforeValue.wrappedKey);
    expect(afterValue.salt).toBe(beforeValue.salt);
    expect(afterValue.failedAttempts).toBe(1);
  });

  it('reports remaining attempts and warns from attempt 7', async () => {
    lock();
    let result = await unlock(WRONG_PIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.shouldWarn).toBe(false);

    for (let attempt = 2; attempt < WARN_FROM_ATTEMPT; attempt += 1) {
      await unlock(WRONG_PIN);
    }
    result = await unlock(WRONG_PIN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.shouldWarn).toBe(true);
      expect(result.attemptsRemaining).toBe(
        MAX_FAILED_ATTEMPTS - WARN_FROM_ATTEMPT,
      );
    }
  });
});

describe('(f) correct PIN after a failed attempt', () => {
  it('still unlocks and resets the counter', async () => {
    await personsRepository.create(personDraft);
    lock();

    expect((await unlock(WRONG_PIN)).ok).toBe(false);
    expect(await failedAttempts()).toBe(1);

    expect((await unlock(PIN)).ok).toBe(true);
    expect(isUnlocked()).toBe(true);
    expect(await failedAttempts()).toBe(0);

    // And the data is still readable, so nothing was corrupted along the way.
    const read = await personsRepository.getById(PERSON_ID);
    expect(read?.display_name).toBe('Adaeze Okonkwo');
  });
});

describe('(g) ATOMICITY: entity row and outbox entry commit together', () => {
  it('persists NEITHER when the outbox write fails mid-transaction', async () => {
    const failingHook = () => {
      throw new Error('simulated crash between entity write and outbox write');
    };
    db.outbox.hook('creating', failingHook);

    try {
      await expect(personsRepository.create(personDraft)).rejects.toThrow();
    } finally {
      db.outbox.hook('creating').unsubscribe(failingHook);
    }

    expect(await db.persons.get(PERSON_ID)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it('persists BOTH on a successful write', async () => {
    await personsRepository.create(personDraft);

    expect(await db.persons.get(PERSON_ID)).toBeDefined();
    expect(await db.outbox.count()).toBe(1);
  });

  it('holds for events too', async () => {
    const failingHook = () => {
      throw new Error('simulated crash');
    };
    db.outbox.hook('creating', failingHook);
    try {
      await expect(eventsRepository.append(eventDraft)).rejects.toThrow();
    } finally {
      db.outbox.hook('creating').unsubscribe(failingHook);
    }

    expect(await db.clinical_events.get(EVENT_ID)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('(h) every repository write produces exactly one outbox entry', () => {
  it('one per create, update and tombstone', async () => {
    await personsRepository.create(personDraft);
    expect(await db.outbox.count()).toBe(1);

    await personsRepository.update(PERSON_ID, { display_name: 'Adaeze O.' });
    expect(await db.outbox.count()).toBe(2);

    await personsRepository.tombstone(PERSON_ID);
    expect(await db.outbox.count()).toBe(3);

    const entries = await db.outbox.toArray();
    expect(entries.map((entry) => entry.op)).toEqual([
      'upsert',
      'upsert',
      'tombstone',
    ]);
    expect(entries.every((entry) => entry.table === 'persons')).toBe(true);
    expect(entries.every((entry) => entry.status === 'pending')).toBe(true);
    expect(entries.every((entry) => entry.attempts === 0)).toBe(true);
    // Every mutation_id distinct — it is the §7.2 idempotency key.
    expect(new Set(entries.map((entry) => entry.mutation_id)).size).toBe(3);
  });

  it('one per write across every entity repository', async () => {
    await personsRepository.create(personDraft);
    await allergiesRepository.create(allergyDraft);
    await conditionsRepository.create(conditionDraft);
    await medicationsRepository.create(medicationDraft);
    await userFacilitiesRepository.create(userFacilityDraft);
    await eventsRepository.append(eventDraft);

    expect(await db.outbox.count()).toBe(6);
    const tables = (await db.outbox.toArray()).map((entry) => entry.table);
    expect(new Set(tables)).toEqual(
      new Set([
        'persons',
        'allergies',
        'conditions',
        'medications',
        'user_facilities',
        'clinical_events',
      ]),
    );
  });
});

describe('(i) tombstones', () => {
  it('are excluded from list queries but retrievable by id', async () => {
    await personsRepository.create(personDraft);
    await personsRepository.tombstone(PERSON_ID);

    expect(await personsRepository.list()).toHaveLength(0);
    expect(
      await personsRepository.list({ includeTombstoned: true }),
    ).toHaveLength(1);

    const read = await personsRepository.getById(PERSON_ID);
    expect(read).not.toBeNull();
    expect(read?.deleted_at).not.toBeNull();
    expect(read?.display_name).toBe('Adaeze Okonkwo');
  });

  it('excludes tombstoned events from the timeline but keeps them addressable', async () => {
    await eventsRepository.append(eventDraft);
    await eventsRepository.tombstone(EVENT_ID);

    expect(await eventsRepository.listByPerson(PERSON_ID)).toHaveLength(0);
    expect(
      await eventsRepository.listByPerson(PERSON_ID, {
        includeTombstoned: true,
      }),
    ).toHaveLength(1);
    // A correction chain must still reach the superseded event.
    expect(await eventsRepository.getById(EVENT_ID)).not.toBeNull();
  });
});

describe('(j) lock clears the in-memory key', () => {
  it('rejects reads cleanly rather than returning ciphertext', async () => {
    await personsRepository.create(personDraft);
    lock();

    expect(isUnlocked()).toBe(false);
    await expect(personsRepository.getById(PERSON_ID)).rejects.toBeInstanceOf(
      DatabaseLockedError,
    );
    await expect(personsRepository.list()).rejects.toBeInstanceOf(
      DatabaseLockedError,
    );
    await expect(
      eventsRepository.listByPerson(PERSON_ID),
    ).rejects.toBeInstanceOf(DatabaseLockedError);
  });

  it('rejects writes cleanly and writes nothing', async () => {
    lock();
    await expect(personsRepository.create(personDraft)).rejects.toBeInstanceOf(
      DatabaseLockedError,
    );
    expect(await db.persons.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('is idempotent and safe to call twice', () => {
    lock();
    expect(() => lock()).not.toThrow();
    expect(isUnlocked()).toBe(false);
  });
});

describe('(k) failed-attempt threshold wipes the local store', () => {
  it(`wipes after ${MAX_FAILED_ATTEMPTS} failed attempts`, async () => {
    await personsRepository.create(personDraft);
    await eventsRepository.append(eventDraft);
    await getClientId();
    expect(await db.persons.count()).toBe(1);

    lock();
    let result = await unlock(WRONG_PIN);
    for (let attempt = 2; attempt <= MAX_FAILED_ATTEMPTS; attempt += 1) {
      result = await unlock(WRONG_PIN);
    }

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wiped');

    expect(await db.persons.count()).toBe(0);
    expect(await db.clinical_events.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    // The keyring goes too: without the PIN the wrapped key is inert, so keeping
    // it would preserve nothing but a brute-force target.
    expect(await isPinConfigured()).toBe(false);
    expect(isUnlocked()).toBe(false);
  });

  it('leaves reference data intact — it is public and re-syncs anyway', async () => {
    await referenceRepository.replaceDrugCatalog([
      {
        id: DRUG_ID,
        rxnorm_cui: null,
        nafdac_reg_no: null,
        generic_name: 'Paracetamol',
        brand_names: ['Panadol'],
        active_ingredients: [{ code: 'PAR01', name: 'Paracetamol' }],
        drug_classes: ['Analgesics'],
        dosage_form: 'tablet',
        is_otc: true,
        region: 'NG',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);

    lock();
    for (let attempt = 1; attempt <= MAX_FAILED_ATTEMPTS; attempt += 1) {
      await unlock(WRONG_PIN);
    }

    expect(await db.drug_catalog.count()).toBe(1);
  });
});

describe('client_id', () => {
  it('is stable across calls and lives in IndexedDB, not localStorage', async () => {
    const first = await getClientId();
    const second = await getClientId();
    expect(first).toBe(second);
    expect(await db.sync_meta.get('client_id')).toBeDefined();
  });
});
