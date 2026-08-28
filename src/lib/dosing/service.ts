import { encryptField } from '../db/crypto';
import { requireDataKey } from '../db/keyring';
import { buildOutboxEntry } from '../db/outbox';
import { eventsRepository } from '../db/repositories';
import { commitWrites } from '../db/repositories/base';
import { db } from '../db/schema';
import {
  type ClinicalEvent,
  ClinicalEventSchema,
  EventIdSchema,
  newId,
} from '../schemas';

/**
 * Dose logging and corrections (AC-4.1.1 to AC-4.1.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APPEND-ONLY, WITHOUT EXCEPTION
 * ─────────────────────────────────────────────────────────────────────────────
 * A logged dose is a claim about something that happened at a moment in time.
 * Editing it in place would silently rewrite history: the record would say the
 * person took 08:00's dose at 14:00 with no trace that it ever said otherwise,
 * and nobody reading it later could tell.
 *
 * So a correction APPENDS a new event pointing at the original, and tombstones
 * the original. The original row is never mutated beyond `deleted_at` and never
 * hard-deleted. The `events_no_mutation` RLS policy from step 2 enforces the
 * same rule server-side — this file agrees with it rather than working around it.
 *
 * Everything here writes LOCALLY FIRST and works fully offline (AC-4.1.1). Sync
 * is the outbox's problem, not the user's.
 */

export type LogDoseParams = {
  medicationId: string;
  personId: string;
  ownerId: string;
  /** When the dose was actually taken. Defaults to now. */
  takenAt?: string;
  /** The scheduled slot this fulfils, when it came from the due list. */
  scheduledFor?: string;
  doseAmount?: number;
  doseUnit?: string;
};

export type SkipDoseParams = {
  medicationId: string;
  personId: string;
  ownerId: string;
  scheduledFor: string;
  reason?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Write one clinical event and its outbox entry atomically.
 *
 * Uses `commitWrites` rather than the events repository so a correction can
 * commit the new event AND the tombstone in a single transaction — a correction
 * that landed halfway would leave two live events describing the same dose.
 */
async function appendEvents(events: ClinicalEvent[]): Promise<void> {
  const dataKey = requireDataKey();

  const writes = await Promise.all(
    events.map(async (event) => ({
      tableName: 'clinical_events' as const,
      storedRow: {
        ...event,
        payload: await encryptField(dataKey, event.payload),
      },
      outboxEntry: await buildOutboxEntry(dataKey, {
        table: 'clinical_events' as const,
        op:
          event.deleted_at === null
            ? ('upsert' as const)
            : ('tombstone' as const),
        row: event as unknown as Record<string, unknown>,
        clientUpdatedAt: event.recorded_at,
      }),
    })),
  );

  await commitWrites(writes);
}

/** Log a dose as taken (AC-4.1.2). Appends; never updates. */
export async function logDoseTaken(
  params: LogDoseParams,
): Promise<ClinicalEvent> {
  const timestamp = nowIso();
  const event = ClinicalEventSchema.parse({
    id: EventIdSchema.parse(newId()),
    person_id: params.personId,
    owner_id: params.ownerId,
    event_type: 'medication_taken',
    occurred_at: params.takenAt ?? timestamp,
    recorded_at: timestamp,
    created_at: timestamp,
    deleted_at: null,
    payload: {
      medication_id: params.medicationId,
      ...(params.doseAmount === undefined
        ? {}
        : { dose_amount: params.doseAmount }),
      ...(params.doseUnit === undefined ? {} : { dose_unit: params.doseUnit }),
      ...(params.scheduledFor === undefined
        ? {}
        : { scheduled_for: params.scheduledFor }),
    },
    rulepack_version: null,
    ruleset_checksum: null,
    client_id: 'local',
    corrects_event_id: null,
  });

  await appendEvents([event]);
  return event;
}

/** Record a deliberately skipped dose. */
export async function logDoseSkipped(
  params: SkipDoseParams,
): Promise<ClinicalEvent> {
  const timestamp = nowIso();
  const event = ClinicalEventSchema.parse({
    id: EventIdSchema.parse(newId()),
    person_id: params.personId,
    owner_id: params.ownerId,
    event_type: 'medication_skipped',
    occurred_at: timestamp,
    recorded_at: timestamp,
    created_at: timestamp,
    deleted_at: null,
    payload: {
      medication_id: params.medicationId,
      scheduled_for: params.scheduledFor,
      ...(params.reason === undefined ? {} : { reason: params.reason }),
    },
    rulepack_version: null,
    ruleset_checksum: null,
    client_id: 'local',
    corrects_event_id: null,
  });

  await appendEvents([event]);
  return event;
}

export type CorrectionParams = {
  originalEventId: string;
  reason: string;
  /** Replacement values. Omitted fields keep the original's. */
  correctedTakenAt?: string;
  correctedDoseAmount?: number;
  correctedDoseUnit?: string;
};

/**
 * Correct a logged dose (AC-4.1.3).
 *
 * Appends TWO things in one transaction: a `correction` event pointing at the
 * original, and a replacement `medication_taken` carrying the corrected values.
 * The original is tombstoned.
 *
 * The correction event exists separately from the replacement because they say
 * different things. The replacement says what actually happened; the correction
 * says that a previous claim was withdrawn and why. A timeline can then show the
 * corrected value while the history stays reconstructible — which is the whole
 * point of an append-only log.
 */
export async function correctDose(params: CorrectionParams): Promise<{
  correction: ClinicalEvent;
  replacement: ClinicalEvent;
}> {
  const original = await eventsRepository.getById(params.originalEventId);
  if (original === null) throw new Error('That dose is not in your records.');
  if (original.event_type !== 'medication_taken') {
    throw new Error('Only a logged dose can be corrected this way.');
  }

  const timestamp = nowIso();
  const originalPayload = original.payload;

  const replacement = ClinicalEventSchema.parse({
    id: EventIdSchema.parse(newId()),
    person_id: original.person_id,
    owner_id: original.owner_id,
    event_type: 'medication_taken',
    occurred_at: params.correctedTakenAt ?? original.occurred_at,
    recorded_at: timestamp,
    created_at: timestamp,
    deleted_at: null,
    payload: {
      medication_id: originalPayload.medication_id,
      ...(params.correctedDoseAmount === undefined
        ? originalPayload.dose_amount === undefined
          ? {}
          : { dose_amount: originalPayload.dose_amount }
        : { dose_amount: params.correctedDoseAmount }),
      ...(params.correctedDoseUnit === undefined
        ? originalPayload.dose_unit === undefined
          ? {}
          : { dose_unit: originalPayload.dose_unit }
        : { dose_unit: params.correctedDoseUnit }),
      ...(originalPayload.scheduled_for === undefined
        ? {}
        : { scheduled_for: originalPayload.scheduled_for }),
    },
    rulepack_version: null,
    ruleset_checksum: null,
    client_id: 'local',
    corrects_event_id: original.id,
  });

  const correction = ClinicalEventSchema.parse({
    id: EventIdSchema.parse(newId()),
    person_id: original.person_id,
    owner_id: original.owner_id,
    event_type: 'correction',
    occurred_at: timestamp,
    recorded_at: timestamp,
    created_at: timestamp,
    deleted_at: null,
    payload: { corrects_event_id: original.id, reason: params.reason },
    rulepack_version: null,
    ruleset_checksum: null,
    client_id: 'local',
    corrects_event_id: original.id,
  });

  /**
   * THE ONLY PERMITTED CHANGE TO THE ORIGINAL IS `deleted_at`.
   *
   * Built from the RAW STORED ROW, not from the decrypted event. Re-encrypting
   * the decrypted payload would produce a fresh IV and therefore different
   * ciphertext — the plaintext would be identical, but the stored row would have
   * changed in a column §6.1 says is never updated, and anyone auditing the
   * store could no longer tell a tombstone apart from a rewrite.
   *
   * It also avoids re-encrypting clinical content for no reason.
   */
  const rawOriginal = await db.clinical_events.get(original.id);
  if (rawOriginal === undefined)
    throw new Error('That dose is not in your records.');
  const tombstonedRow = { ...rawOriginal, deleted_at: timestamp };

  const dataKey = requireDataKey();
  const tombstoneEntry = await buildOutboxEntry(dataKey, {
    table: 'clinical_events',
    op: 'tombstone',
    row: { ...original, deleted_at: timestamp } as unknown as Record<
      string,
      unknown
    >,
    clientUpdatedAt: timestamp,
  });

  const appended = await Promise.all(
    [replacement, correction].map(async (event) => ({
      tableName: 'clinical_events' as const,
      storedRow: {
        ...event,
        payload: await encryptField(dataKey, event.payload),
      },
      outboxEntry: await buildOutboxEntry(dataKey, {
        table: 'clinical_events' as const,
        op: 'upsert' as const,
        row: event as unknown as Record<string, unknown>,
        clientUpdatedAt: event.recorded_at,
      }),
    })),
  );

  await commitWrites([
    ...appended,
    {
      tableName: 'clinical_events',
      storedRow: tombstonedRow as Record<string, unknown>,
      outboxEntry: tombstoneEntry,
    },
  ]);

  return { correction, replacement };
}

/**
 * Doses logged for a person in a window, tombstones excluded.
 *
 * Used by the today view to strike through what has already been taken, so the
 * due list shrinks as the day goes on rather than nagging about a dose already
 * swallowed.
 */
export async function loggedDoses(
  personId: string,
  from: Date,
  to: Date,
): Promise<ClinicalEvent[]> {
  const events = await eventsRepository.listByPerson(personId);
  return events.filter(
    (event) =>
      event.event_type === 'medication_taken' &&
      event.occurred_at >= from.toISOString() &&
      event.occurred_at < to.toISOString(),
  );
}

/** Keys of scheduled slots already logged, for `partitionDue`. */
export async function loggedSlotKeys(
  personId: string,
  from: Date,
  to: Date,
): Promise<Set<string>> {
  const events = await loggedDoses(personId, from, to);
  const keys = new Set<string>();
  for (const event of events) {
    if (event.event_type !== 'medication_taken') continue;
    const scheduledFor = event.payload.scheduled_for;
    if (scheduledFor)
      keys.add(`${event.payload.medication_id}:${scheduledFor}`);
  }
  return keys;
}

/** Raw stored row, for tests asserting the original was not mutated. */
export async function rawStoredEvent(
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return db.clinical_events.get(id) as Promise<
    Record<string, unknown> | undefined
  >;
}
