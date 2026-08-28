import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKeyringForTests, setupPin } from '../../src/lib/db/keyring';
import { eventsRepository } from '../../src/lib/db/repositories';
import { db } from '../../src/lib/db/schema';
import {
  correctDose,
  logDoseSkipped,
  logDoseTaken,
  loggedSlotKeys,
  rawStoredEvent,
} from '../../src/lib/dosing/service';
import {
  MedicationIdSchema,
  PersonIdSchema,
  ProfileIdSchema,
} from '../../src/lib/schemas';

const PIN = '123456';
const OWNER = ProfileIdSchema.parse('aaaaaaaa-aaaa-4aaa-baaa-aaaaaaaaaaaa');
const PERSON = PersonIdSchema.parse('11111111-1111-4111-a111-111111111111');
const MED = MedicationIdSchema.parse('ffffffff-1111-4111-a111-111111111111');

beforeEach(async () => {
  __resetKeyringForTests();
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  await setupPin(PIN);
});

function logParams(overrides: Record<string, unknown> = {}) {
  return {
    medicationId: MED,
    personId: PERSON,
    ownerId: OWNER,
    ...overrides,
  } as Parameters<typeof logDoseTaken>[0];
}

// ═══════════════ (f) logging appends, never updates ═══════════════

describe('(f) logging a dose APPENDS an event (AC-4.1.2)', () => {
  it('creates a medication_taken event', async () => {
    const event = await logDoseTaken(logParams());

    expect(event.event_type).toBe('medication_taken');
    expect(await db.clinical_events.count()).toBe(1);

    const stored = await eventsRepository.getById(event.id);
    expect(stored?.payload).toMatchObject({ medication_id: MED });
  });

  it('a SECOND log appends rather than replacing the first', async () => {
    await logDoseTaken(logParams({ takenAt: '2026-06-01T08:00:00.000Z' }));
    await logDoseTaken(logParams({ takenAt: '2026-06-01T20:00:00.000Z' }));

    expect(await db.clinical_events.count()).toBe(2);
  });

  it('NO update path is invoked on the events table', async () => {
    // Asserted at the table level rather than by inspecting the service, so a
    // future refactor that reaches for .update() is caught regardless of how it
    // is written.
    const updateSpy = vi.spyOn(db.clinical_events, 'update');
    const deleteSpy = vi.spyOn(db.clinical_events, 'delete');

    await logDoseTaken(logParams());

    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    // The row did land — the write path is a put, not an update.
    expect(await db.clinical_events.count()).toBe(1);

    updateSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it('records a skipped dose with its reason', async () => {
    const event = await logDoseSkipped({
      medicationId: MED,
      personId: PERSON,
      ownerId: OWNER,
      scheduledFor: '2026-06-01T07:00:00.000Z',
      reason: 'asleep',
    });

    expect(event.event_type).toBe('medication_skipped');
    if (event.event_type === 'medication_skipped') {
      expect(event.payload.reason).toBe('asleep');
    }
  });
});

// ═══════════════ (g) corrections ═══════════════

describe('(g) correcting a dose appends and tombstones (AC-4.1.3)', () => {
  it('leaves the ORIGINAL row intact apart from deleted_at', async () => {
    const original = await logDoseTaken(
      logParams({
        takenAt: '2026-06-01T08:00:00.000Z',
        doseAmount: 500,
        doseUnit: 'mg',
      }),
    );
    const beforeRaw = await rawStoredEvent(original.id);

    await correctDose({
      originalEventId: original.id,
      reason: 'Logged the wrong time',
      correctedTakenAt: '2026-06-01T09:30:00.000Z',
    });

    const afterRaw = await rawStoredEvent(original.id);

    console.log('\n[CORRECTION] original event after correcting:');
    console.log(`  still present:      ${afterRaw !== undefined}`);
    console.log(`  deleted_at set:     ${afterRaw?.deleted_at !== null}`);
    console.log(
      `  occurred_at:        ${afterRaw?.occurred_at} (was ${beforeRaw?.occurred_at})`,
    );
    console.log(`  event_type:         ${afterRaw?.event_type}`);
    console.log(
      `  payload unchanged:  ${JSON.stringify(afterRaw?.payload) === JSON.stringify(beforeRaw?.payload)}`,
    );

    // Never hard-deleted.
    expect(afterRaw).toBeDefined();
    // Tombstoned.
    expect(afterRaw?.deleted_at).not.toBeNull();
    // And NOTHING else changed. The payload comparison is on the stored
    // ciphertext, so even a re-encryption would show up here.
    expect(afterRaw?.occurred_at).toBe(beforeRaw?.occurred_at);
    expect(afterRaw?.event_type).toBe(beforeRaw?.event_type);
    expect(afterRaw?.recorded_at).toBe(beforeRaw?.recorded_at);
    expect(JSON.stringify(afterRaw?.payload)).toBe(
      JSON.stringify(beforeRaw?.payload),
    );
  });

  it('appends a correction event pointing at the original', async () => {
    const original = await logDoseTaken(logParams());
    const { correction } = await correctDose({
      originalEventId: original.id,
      reason: 'Wrong medicine',
    });

    expect(correction.event_type).toBe('correction');
    if (correction.event_type === 'correction') {
      expect(correction.payload.corrects_event_id).toBe(original.id);
      expect(correction.payload.reason).toBe('Wrong medicine');
    }
  });

  it('appends a replacement carrying the corrected value', async () => {
    const original = await logDoseTaken(
      logParams({ takenAt: '2026-06-01T08:00:00.000Z' }),
    );
    const { replacement } = await correctDose({
      originalEventId: original.id,
      reason: 'Logged the wrong time',
      correctedTakenAt: '2026-06-01T09:30:00.000Z',
    });

    expect(replacement.occurred_at).toBe('2026-06-01T09:30:00.000Z');
    expect(replacement.corrects_event_id).toBe(original.id);
  });

  it('the timeline shows the corrected value and hides the original', async () => {
    const original = await logDoseTaken(
      logParams({ takenAt: '2026-06-01T08:00:00.000Z' }),
    );
    await correctDose({
      originalEventId: original.id,
      reason: 'Wrong time',
      correctedTakenAt: '2026-06-01T09:30:00.000Z',
    });

    const visible = await eventsRepository.listByPerson(PERSON);
    const takenEvents = visible.filter(
      (e) => e.event_type === 'medication_taken',
    );

    expect(takenEvents).toHaveLength(1);
    expect(takenEvents[0]?.occurred_at).toBe('2026-06-01T09:30:00.000Z');

    // ...but the history is still reconstructible.
    const withTombstones = await eventsRepository.listByPerson(PERSON, {
      includeTombstoned: true,
    });
    expect(withTombstones.some((e) => e.id === original.id)).toBe(true);
  });

  it('commits the replacement, the correction and the tombstone TOGETHER', async () => {
    const original = await logDoseTaken(logParams());

    const failingHook = () => {
      throw new Error('simulated crash mid-correction');
    };
    db.outbox.hook('creating', failingHook);
    try {
      await expect(
        correctDose({ originalEventId: original.id, reason: 'test' }),
      ).rejects.toThrow();
    } finally {
      db.outbox.hook('creating').unsubscribe(failingHook);
    }

    // A half-applied correction would leave two live events describing one dose.
    expect(await db.clinical_events.count()).toBe(1);
    const raw = await rawStoredEvent(original.id);
    expect(raw?.deleted_at).toBeNull();
  });
});

// ═══════════════ (h) mutation is rejected ═══════════════

describe('(h) a logged event cannot be mutated', () => {
  it('the events repository exposes no update method', () => {
    // §6.1 and the events_no_mutation RLS policy both forbid it, so the client
    // API does not offer one either. There is nothing to call.
    expect('update' in eventsRepository).toBe(false);
  });

  it('correcting a non-existent event is rejected', async () => {
    await expect(
      correctDose({
        originalEventId: 'eeeeeeee-0000-4000-a000-000000000000',
        reason: 'x',
      }),
    ).rejects.toThrow(/not in your records/i);
  });

  it('only a logged dose can be corrected this way', async () => {
    const skipped = await logDoseSkipped({
      medicationId: MED,
      personId: PERSON,
      ownerId: OWNER,
      scheduledFor: '2026-06-01T07:00:00.000Z',
    });
    await expect(
      correctDose({ originalEventId: skipped.id, reason: 'x' }),
    ).rejects.toThrow(/logged dose/i);
  });
});

// ═══════════════ (i) outbox ═══════════════

describe('(i) each log produces exactly one outbox entry', () => {
  it('one entry per logged dose', async () => {
    await logDoseTaken(logParams());
    expect(await db.outbox.count()).toBe(1);

    await logDoseTaken(logParams());
    expect(await db.outbox.count()).toBe(2);
  });

  it('a correction produces three: replacement, correction, tombstone', async () => {
    const original = await logDoseTaken(logParams());
    expect(await db.outbox.count()).toBe(1);

    await correctDose({ originalEventId: original.id, reason: 'Wrong time' });

    // All three must reach the server, or the server's view of the correction
    // is incomplete.
    expect(await db.outbox.count()).toBe(4);
    const ops = (await db.outbox.toArray()).map((e) => e.op);
    expect(ops.filter((op) => op === 'tombstone')).toHaveLength(1);
  });
});

// ═══════════════ due-list integration ═══════════════

describe('logged slots feed back into the due list', () => {
  it('a logged scheduled dose is keyed for exclusion', async () => {
    await logDoseTaken(
      logParams({
        takenAt: '2026-06-01T08:05:00.000Z',
        scheduledFor: '2026-06-01T07:00:00.000Z',
      }),
    );

    const keys = await loggedSlotKeys(
      PERSON,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-02T00:00:00.000Z'),
    );
    expect(keys.has(`${MED}:2026-06-01T07:00:00.000Z`)).toBe(true);
  });
});
