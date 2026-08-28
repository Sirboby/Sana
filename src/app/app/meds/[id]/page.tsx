'use client';

import { medicationsRepository } from '@/lib/db/repositories';
import {
  endMedication,
  removeMistakenMedication,
  updateMedication,
} from '@/lib/meds/service';
import type { Medication } from '@/lib/schemas';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Medication detail (AC-3.1.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO DIFFERENT ENDINGS, DELIBERATELY WORDED APART
 * ─────────────────────────────────────────────────────────────────────────────
 * "I've stopped taking this" sets an end_date. The record stays, because the
 * person really did take it and a timeline that loses a course of antibiotics
 * misleads whoever reads it next.
 *
 * "I recorded this by mistake" tombstones. That is a claim the medicine was
 * never taken at all.
 *
 * Collapsing these into one "delete" would let the common action quietly erase
 * history, so they are separated in the UI and in the service.
 */
export default function MedicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [medication, setMedication] = useState<Medication | null | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [confirmMistake, setConfirmMistake] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await medicationsRepository.getById(params.id);
      if (!cancelled) setMedication(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (medication === undefined) return <main>Loading…</main>;
  if (medication === null)
    return <main>That medicine is not in your records.</main>;

  async function stopTaking() {
    setBusy(true);
    try {
      await endMedication(params.id);
      router.push('/app/meds');
    } finally {
      setBusy(false);
    }
  }

  async function markMistake() {
    setBusy(true);
    try {
      await removeMistakenMedication(params.id);
      router.push('/app/meds');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1 data-testid="medication-name">{medication.display_name}</h1>

      {medication.is_custom && (
        <p data-testid="uncheckable-warning" role="alert">
          <strong>
            Sana cannot check this medicine for interactions or allergies
            because it isn&apos;t in our list.
          </strong>
        </p>
      )}

      <dl>
        <dt>Started</dt>
        <dd>{medication.start_date}</dd>
        {medication.end_date && (
          <>
            <dt>Ended</dt>
            <dd data-testid="end-date">{medication.end_date}</dd>
          </>
        )}
      </dl>

      {medication.end_date === null && (
        <button
          type="button"
          data-testid="stop-taking"
          onClick={() => void stopTaking()}
          disabled={busy}
        >
          I&apos;ve stopped taking this
        </button>
      )}

      <section aria-label="Correct a mistake">
        <h2>Recorded by mistake?</h2>
        <p>
          This removes it from your records entirely. Only do this if you never
          actually started it. If you did, and have now stopped, choose the
          option above instead so it stays in your history.
        </p>
        {confirmMistake ? (
          <button
            type="button"
            data-testid="confirm-mistake"
            onClick={() => void markMistake()}
            disabled={busy}
          >
            Yes, remove it from my records
          </button>
        ) : (
          <button
            type="button"
            data-testid="mark-mistake"
            onClick={() => setConfirmMistake(true)}
          >
            I recorded this by mistake
          </button>
        )}
      </section>
    </main>
  );
}
