import { encryptField } from '../db/crypto';
import { requireDataKey } from '../db/keyring';
import { buildOutboxEntry } from '../db/outbox';
import { medicationsRepository } from '../db/repositories';
import { commitWrites, encryptRow } from '../db/repositories/base';
import {
  type ClinicalEvent,
  ClinicalEventSchema,
  type Medication,
  MedicationSchema,
  newId,
} from '../schemas';

/**
 * Medication mutations (step 10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENTITY AND EVENT COMMIT TOGETHER
 * ─────────────────────────────────────────────────────────────────────────────
 * Every medication change also appends a `clinical_events` row, and all four
 * writes — two entity rows, two outbox entries — land in ONE transaction. A
 * medication saved without its event leaves a hole in the timeline that nothing
 * can reconstruct; an event without its medication describes something that does
 * not exist. Neither is recoverable after the fact, so neither is allowed to
 * happen alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REMOVING IS NOT DELETING
 * ─────────────────────────────────────────────────────────────────────────────
 * "Remove" sets `end_date`. The medication stays in the record because the user
 * really did take it, and a timeline that quietly loses a course of antibiotics
 * is a timeline that lies to the next clinician who reads it (AC-3.1.4).
 *
 * Tombstoning is a SEPARATE operation with different wording, reserved for
 * correcting an entry that was mistaken — a medicine recorded that was never
 * taken at all. Conflating the two would let "I finished this course" erase
 * history.
 */

export type MedicationDraft = Omit<
  Medication,
  'created_at' | 'updated_at' | 'deleted_at'
>;

const MEDICATION_ENCRYPTED_FIELDS = [
  'display_name',
  'notes',
  'dose_amount',
  'dose_unit',
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Build the paired clinical event for a medication change.
 *
 * `note_added` carries the human-readable record of what changed. The event
 * payload deliberately does NOT restate the dose: §2.2 prohibition 2 forbids
 * dose figures in app-authored output, and the dose already lives on the
 * medication row where it belongs.
 */
function changeEvent(
  medication: Medication,
  action: 'added' | 'updated' | 'ended' | 'removed',
): ClinicalEvent {
  const timestamp = nowIso();
  return ClinicalEventSchema.parse({
    id: newId(),
    person_id: medication.person_id,
    owner_id: medication.owner_id,
    event_type: 'note_added',
    occurred_at: timestamp,
    recorded_at: timestamp,
    created_at: timestamp,
    deleted_at: null,
    payload: { text: `Medication ${action}: ${medication.display_name}` },
    rulepack_version: null,
    ruleset_checksum: null,
    client_id: 'local',
    corrects_event_id: null,
  });
}

/** Write a medication row and its event in one transaction. */
async function commitMedication(
  medication: Medication,
  action: 'added' | 'updated' | 'ended' | 'removed',
  op: 'upsert' | 'tombstone',
): Promise<Medication> {
  const dataKey = requireDataKey();
  const validated = MedicationSchema.parse(medication);
  const event = changeEvent(validated, action);

  // All crypto BEFORE the transaction — see base.ts ORDERING NOTE.
  const storedMedication = await encryptRow(
    dataKey,
    validated,
    MEDICATION_ENCRYPTED_FIELDS,
  );
  const storedEvent = {
    ...event,
    payload: await encryptField(dataKey, event.payload),
  };

  const medicationEntry = await buildOutboxEntry(dataKey, {
    table: 'medications',
    op,
    row: validated as Record<string, unknown>,
    clientUpdatedAt: validated.updated_at,
  });
  const eventEntry = await buildOutboxEntry(dataKey, {
    table: 'clinical_events',
    op: 'upsert',
    row: event as unknown as Record<string, unknown>,
    clientUpdatedAt: event.recorded_at,
  });

  await commitWrites([
    {
      tableName: 'medications',
      storedRow: storedMedication,
      outboxEntry: medicationEntry,
    },
    {
      tableName: 'clinical_events',
      storedRow: storedEvent,
      outboxEntry: eventEntry,
    },
  ]);

  return validated;
}

export async function addMedication(
  draft: MedicationDraft,
): Promise<Medication> {
  const timestamp = nowIso();
  return commitMedication(
    {
      ...draft,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    } as Medication,
    'added',
    'upsert',
  );
}

export async function updateMedication(
  id: string,
  patch: Partial<MedicationDraft>,
): Promise<Medication> {
  const current = await medicationsRepository.getById(id);
  if (current === null) throw new Error(`No medication with id ${id}`);
  return commitMedication(
    { ...current, ...patch, updated_at: nowIso() } as Medication,
    'updated',
    'upsert',
  );
}

/**
 * End a course. Sets `end_date`; the record stays queryable (AC-3.1.4).
 *
 * This is what "Remove" in the UI does. It is not a deletion.
 */
export async function endMedication(
  id: string,
  endDate?: string,
): Promise<Medication> {
  const current = await medicationsRepository.getById(id);
  if (current === null) throw new Error(`No medication with id ${id}`);
  const timestamp = nowIso();
  return commitMedication(
    {
      ...current,
      end_date: endDate ?? timestamp.slice(0, 10),
      updated_at: timestamp,
    } as Medication,
    'ended',
    'upsert',
  );
}

/**
 * Correct a mistaken entry — a medicine recorded that was never taken.
 *
 * Distinct from `endMedication` and offered with distinct wording, because the
 * two mean opposite things about whether the person took the drug.
 */
export async function removeMistakenMedication(id: string): Promise<void> {
  const current = await medicationsRepository.getById(id);
  if (current === null) throw new Error(`No medication with id ${id}`);
  const timestamp = nowIso();
  await commitMedication(
    { ...current, deleted_at: timestamp, updated_at: timestamp } as Medication,
    'removed',
    'tombstone',
  );
}

/**
 * The ACTIVE regimen: not tombstoned, and not end-dated in the past (AC-3.1.4).
 *
 * A medicine whose course finished yesterday is not something the person is
 * taking, so it must not appear in the list they check against — but it is still
 * in the record, and `listInactive` is how it is reached.
 */
export async function listActive(
  personId: string,
  today = nowIso().slice(0, 10),
) {
  const all = await medicationsRepository.list();
  return all.filter(
    (m) =>
      m.person_id === personId && (m.end_date === null || m.end_date >= today),
  );
}

export async function listInactive(
  personId: string,
  today = nowIso().slice(0, 10),
) {
  const all = await medicationsRepository.list();
  return all.filter(
    (m) =>
      m.person_id === personId && m.end_date !== null && m.end_date < today,
  );
}
