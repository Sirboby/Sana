'use client';

import {
  logDoseSkipped,
  logDoseTaken,
  loggedSlotKeys,
} from '@/lib/dosing/service';
import { listActive } from '@/lib/meds/service';
import { getActivePersonId } from '@/lib/person/active-person';
import { type DueDose, expandAll, partitionDue } from '@/lib/schedule/expand';
import type { Medication } from '@/lib/schemas';
import { requestSyncSoon } from '@/lib/sync/scheduler';
import { useCallback, useEffect, useState } from 'react';

/**
 * Today's doses — TIER 2 (step 11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE REMINDER PATH THAT ALWAYS WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Computed entirely from the local schedule. No network, no permission, no
 * service worker, nothing to grant or install. Web Push (Tier 1) is a
 * convenience layered on top; this is the floor, and it is the reason the app
 * remains useful for someone who is offline or who declined notifications.
 *
 * Logging writes locally first and the list updates immediately (AC-4.1.1). Sync
 * is requested afterwards and its failure is invisible here by design.
 */

type DoseRow = DueDose & { medication: Medication };

export function TodayDoses() {
  const [overdue, setOverdue] = useState<DoseRow[]>([]);
  const [upcoming, setUpcoming] = useState<DoseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [personId, setPersonId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string>('');

  const refresh = useCallback(async () => {
    const person = await getActivePersonId();
    if (person === null) {
      setLoading(false);
      return;
    }
    setPersonId(person);

    const medications = await listActive(person);
    setOwnerId((medications[0]?.owner_id as string) ?? '');

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const due = expandAll(
      medications.map((m) => ({
        id: m.id,
        schedule: m.schedule,
        start_date: m.start_date,
        end_date: m.end_date,
      })),
      { from: startOfDay, to: endOfDay },
    );

    const logged = await loggedSlotKeys(person, startOfDay, endOfDay);
    const split = partitionDue(due, now, logged);
    // Keyed as plain strings: DueDose carries an unbranded medicationId, and
    // branding the map key would make every lookup a cast.
    const byId = new Map<string, Medication>(medications.map((m) => [m.id, m]));

    const attach = (doses: DueDose[]): DoseRow[] =>
      doses
        .map((dose) => {
          const medication = byId.get(dose.medicationId);
          return medication ? { ...dose, medication } : null;
        })
        .filter((row): row is DoseRow => row !== null);

    setOverdue(attach(split.overdue));
    setUpcoming(attach(split.upcoming));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function takeDose(row: DoseRow) {
    if (personId === null) return;
    // Local write first; the list refreshes immediately whether or not sync
    // succeeds (AC-4.1.1).
    await logDoseTaken({
      medicationId: row.medicationId,
      personId,
      ownerId,
      scheduledFor: row.dueAt,
    });
    await refresh();
    requestSyncSoon();
  }

  async function skipDose(row: DoseRow) {
    if (personId === null) return;
    await logDoseSkipped({
      medicationId: row.medicationId,
      personId,
      ownerId,
      scheduledFor: row.dueAt,
    });
    await refresh();
    requestSyncSoon();
  }

  if (loading) return <p>Loading today&apos;s doses…</p>;

  if (overdue.length === 0 && upcoming.length === 0) {
    return (
      <section aria-label="Today's doses" data-testid="today-doses">
        <h2>Today</h2>
        <p data-testid="no-doses">Nothing scheduled for today.</p>
      </section>
    );
  }

  const renderRow = (row: DoseRow, testId: string) => (
    <li key={`${row.medicationId}:${row.dueAt}`} data-testid={testId}>
      <span>
        {row.scheduledTime} · {row.medication.display_name}
      </span>
      <button
        type="button"
        data-testid="log-dose"
        onClick={() => void takeDose(row)}
      >
        Log it
      </button>
      <button
        type="button"
        data-testid="skip-dose"
        onClick={() => void skipDose(row)}
      >
        Skipped
      </button>
    </li>
  );

  return (
    <section aria-label="Today's doses" data-testid="today-doses">
      <h2>Today</h2>

      {overdue.length > 0 && (
        /* Surfaced distinctly: an overdue dose is the one worth prompting about. */
        <div data-testid="overdue-section">
          <h3>Due now</h3>
          <ul>{overdue.map((row) => renderRow(row, 'overdue-dose'))}</ul>
        </div>
      )}

      {upcoming.length > 0 && (
        <div data-testid="upcoming-section">
          <h3>Later today</h3>
          <ul>{upcoming.map((row) => renderRow(row, 'upcoming-dose'))}</ul>
        </div>
      )}
    </section>
  );
}
