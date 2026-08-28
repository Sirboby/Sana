import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetKeyringForTests, setupPin } from '../../src/lib/db/keyring';
import { medicationsRepository } from '../../src/lib/db/repositories';
import { db } from '../../src/lib/db/schema';
import {
  addMedication,
  endMedication,
  listActive,
  listInactive,
  removeMistakenMedication,
  updateMedication,
} from '../../src/lib/meds/service';
import {
  MedicationIdSchema,
  PersonIdSchema,
  ProfileIdSchema,
} from '../../src/lib/schemas';

const PIN = '123456';
const OWNER = ProfileIdSchema.parse('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa');
const PERSON = PersonIdSchema.parse('11111111-1111-4111-a111-111111111111');

function draft(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: MedicationIdSchema.parse(id),
    person_id: PERSON,
    owner_id: OWNER,
    drug_id: null,
    is_custom: false,
    display_name: 'Paracetamol',
    dose_amount: null,
    dose_unit: null,
    schedule: { kind: 'as_needed' as const },
    start_date: '2026-01-01',
    end_date: null,
    notes: null,
    ...overrides,
  } as Parameters<typeof addMedication>[0];
}

beforeEach(async () => {
  __resetKeyringForTests();
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await setupPin(PIN);
});

describe('(a) the active list excludes ended and tombstoned medicines (AC-3.1.4)', () => {
  it('excludes an end-dated medicine from active but keeps it in inactive', async () => {
    await addMedication(draft('ffffffff-1111-4111-a111-111111111111'));
    await addMedication(
      draft('ffffffff-2222-4222-a222-222222222222', {
        display_name: 'Amoxicillin',
        end_date: '2026-01-10',
      }),
    );

    const active = await listActive(PERSON, '2026-02-01');
    const inactive = await listInactive(PERSON, '2026-02-01');

    expect(active.map((m) => m.display_name)).toEqual(['Paracetamol']);
    expect(inactive.map((m) => m.display_name)).toEqual(['Amoxicillin']);
  });

  it('keeps a medicine active while its end date is still in the future', async () => {
    await addMedication(
      draft('ffffffff-3333-4333-a333-333333333333', { end_date: '2026-12-31' }),
    );
    expect(await listActive(PERSON, '2026-02-01')).toHaveLength(1);
  });

  it('excludes a tombstoned medicine from both lists', async () => {
    const id = 'ffffffff-4444-4444-a444-444444444444';
    await addMedication(draft(id));
    await removeMistakenMedication(id);

    expect(await listActive(PERSON, '2026-02-01')).toHaveLength(0);
    expect(await listInactive(PERSON, '2026-02-01')).toHaveLength(0);
  });
});

describe('(b) removing sets end_date and the record stays queryable', () => {
  it('ending a course leaves it retrievable for the timeline', async () => {
    const id = 'ffffffff-5555-4555-a555-555555555555';
    await addMedication(draft(id));
    await endMedication(id, '2026-03-01');

    const stored = await medicationsRepository.getById(id);
    expect(stored).not.toBeNull();
    expect(stored?.end_date).toBe('2026-03-01');
    // Not a tombstone: the person really did take it.
    expect(stored?.deleted_at).toBeNull();
  });

  it('a mistaken entry IS tombstoned, which is a different claim', async () => {
    const id = 'ffffffff-6666-4666-a666-666666666666';
    await addMedication(draft(id));
    await removeMistakenMedication(id);

    const stored = await medicationsRepository.getById(id);
    expect(stored?.deleted_at).not.toBeNull();
  });
});

describe('(c) editing dose or schedule updates the record', () => {
  it('an edit persists and bumps updated_at', async () => {
    const id = 'ffffffff-7777-4777-a777-777777777777';
    const created = await addMedication(draft(id));
    const updated = await updateMedication(id, {
      dose_amount: 500,
      dose_unit: 'mg',
    });

    expect(updated.dose_amount).toBe(500);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated_at).getTime(),
    );
  });

  it('a schedule change persists losslessly', async () => {
    const id = 'ffffffff-8888-4888-a888-888888888888';
    await addMedication(draft(id));
    const schedule = {
      kind: 'fixed_times' as const,
      times: ['08:00', '20:00'],
    };
    const updated = await updateMedication(id, { schedule });
    expect(updated.schedule).toEqual(schedule);
  });
});

describe('(d) every medication write produces one outbox entry AND one event', () => {
  it('adding writes both, atomically', async () => {
    await addMedication(draft('ffffffff-9999-4999-a999-999999999999'));

    expect(await db.medications.count()).toBe(1);
    expect(await db.clinical_events.count()).toBe(1);
    // Two outbox entries: one for the medication, one for the event. Both are
    // needed server-side, and both were committed in the same transaction.
    expect(await db.outbox.count()).toBe(2);

    const tables = (await db.outbox.toArray()).map((e) => e.table);
    expect(new Set(tables)).toEqual(
      new Set(['medications', 'clinical_events']),
    );
  });

  it('editing writes both again', async () => {
    const id = 'ffffffff-aaaa-4aaa-baaa-aaaaaaaaaaaa';
    await addMedication(draft(id));
    await updateMedication(id, { dose_unit: 'mg' });

    expect(await db.clinical_events.count()).toBe(2);
    expect(await db.outbox.count()).toBe(4);
  });

  it('ending a course writes both', async () => {
    const id = 'ffffffff-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    await addMedication(draft(id));
    await endMedication(id);

    expect(await db.clinical_events.count()).toBe(2);
  });

  it('the medication and its event land together or not at all', async () => {
    // The atomicity guarantee from step 4, extended to the two-entity write.
    const failingHook = () => {
      throw new Error('simulated crash between the two writes');
    };
    db.outbox.hook('creating', failingHook);
    try {
      await expect(
        addMedication(draft('ffffffff-cccc-4ccc-bccc-cccccccccccc')),
      ).rejects.toThrow();
    } finally {
      db.outbox.hook('creating').unsubscribe(failingHook);
    }

    expect(await db.medications.count()).toBe(0);
    expect(await db.clinical_events.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('dose is never defaulted (§2.2 prohibition 2)', () => {
  it('a medication added without a dose stores null, not a guess', async () => {
    const created = await addMedication(
      draft('ffffffff-dddd-4ddd-bddd-dddddddddddd'),
    );
    expect(created.dose_amount).toBeNull();
    expect(created.dose_unit).toBeNull();
  });
});
