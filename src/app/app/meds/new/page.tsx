'use client';

import { ScreeningGate } from '@/components/meds/ScreeningGate';
import {
  allergiesRepository,
  conditionsRepository,
} from '@/lib/db/repositories';
import { db } from '@/lib/db/schema';
import { type ScreeningResult, screen } from '@/lib/engine/screening';
import { addMedication, listActive } from '@/lib/meds/service';
import { getActivePersonId } from '@/lib/person/active-person';
import {
  type SearchIndex,
  type SearchableDrug,
  buildSearchIndex,
  searchCatalog,
} from '@/lib/reference/search';
import { MedicationIdSchema, newId } from '@/lib/schemas';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

/**
 * Add a medicine (AC-3.1.1 to AC-3.1.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCREENING RUNS BEFORE THE SAVE COMMITS
 * ─────────────────────────────────────────────────────────────────────────────
 * Not after, and not alongside. A warning shown after the record is already
 * saved is a notification, not a check — the user has already been told the
 * thing is fine.
 *
 * DOSE IS NEVER SUGGESTED. The field starts empty, has no default, no
 * placeholder value and no calculation (§2.2 prohibition 2). It records what the
 * user was told elsewhere.
 */

type Stage = 'search' | 'details' | 'screening';

export default function NewMedicationPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('search');
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchableDrug | null>(null);
  const [manualName, setManualName] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState('');
  const [result, setResult] = useState<ScreeningResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const drugs =
        (await db.drug_catalog.toArray()) as unknown as SearchableDrug[];
      if (!cancelled) setIndex(buildSearchIndex(drugs));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Synchronous search — see lib/reference/search.ts for why this is not async.
  const results = useMemo(
    () => (index === null ? [] : searchCatalog(index, query, { limit: 10 })),
    [index, query],
  );

  const displayName = isCustom ? manualName : (selected?.generic_name ?? '');

  async function runScreening() {
    setBusy(true);
    try {
      const personId = (await getActivePersonId()) ?? '';
      const current = await listActive(personId);
      const [allergies, conditions] = await Promise.all([
        allergiesRepository.list(),
        conditionsRepository.list(),
      ]);

      const candidateId = MedicationIdSchema.parse(newId());
      const candidate = {
        id: candidateId,
        person_id: personId,
        owner_id: '',
        drug_id: isCustom ? null : (selected?.id ?? null),
        is_custom: isCustom,
        display_name: displayName,
        dose_amount: doseAmount === '' ? null : Number(doseAmount),
        dose_unit: doseUnit === '' ? null : doseUnit,
        schedule: { kind: 'as_needed' as const },
        start_date: new Date().toISOString().slice(0, 10),
        end_date: null,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      const ingredientsByMedicationId: Record<
        string,
        { code: string; name: string }[]
      > = {};
      const classesByMedicationId: Record<string, string[]> = {};
      if (!isCustom && selected) {
        ingredientsByMedicationId[candidateId] = selected.active_ingredients;
        classesByMedicationId[candidateId] = selected.drug_classes;
      }
      for (const medication of current) {
        const row = await db.drug_catalog.get(medication.drug_id ?? '');
        if (row) {
          ingredientsByMedicationId[medication.id] = row.active_ingredients;
          classesByMedicationId[medication.id] = row.drug_classes;
        }
      }

      const rulepackRows = await db.rulepack.toArray();

      setResult(
        screen({
          profile: {
            dateOfBirth: null,
            sexAtBirth: 'undisclosed',
            isPregnant: false,
          },
          allergies,
          conditions,
          currentMedications: current,
          candidate: candidate as never,
          rulepack: rulepackRows[0] ?? null,
          reference: {
            crossReference: (await db.cross_reference.toArray()) as never,
            interactions: (await db.interactions.toArray()) as never,
            contraindications: (await db.contraindications.toArray()) as never,
            pregnancyCautionClasses: [],
          },
          ingredientsByMedicationId,
          classesByMedicationId,
        }),
      );
      setStage('screening');
    } finally {
      setBusy(false);
    }
  }

  async function commitSave() {
    setBusy(true);
    try {
      const personId = (await getActivePersonId()) ?? '';
      await addMedication({
        id: MedicationIdSchema.parse(newId()),
        person_id: personId as never,
        owner_id: '' as never,
        drug_id: (isCustom ? null : (selected?.id ?? null)) as never,
        is_custom: isCustom,
        display_name: displayName,
        dose_amount: doseAmount === '' ? null : Number(doseAmount),
        dose_unit: doseUnit === '' ? null : doseUnit,
        schedule: { kind: 'as_needed' },
        start_date: new Date().toISOString().slice(0, 10),
        end_date: null,
        notes: null,
      });
      router.push('/app/meds');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'screening' && result !== null) {
    return (
      <main>
        <h1>Before you add this</h1>
        {result.status === 'CLEAR' ? (
          <>
            <p data-testid="screening-clear">
              Nothing was flagged against what you have recorded.
            </p>
            <button
              type="button"
              onClick={() => void commitSave()}
              disabled={busy}
            >
              Add {displayName}
            </button>
          </>
        ) : (
          <ScreeningGate
            result={result}
            medicationName={displayName}
            onCancel={() => router.push('/app/meds')}
            onConfirm={() => void commitSave()}
          />
        )}
      </main>
    );
  }

  if (stage === 'details') {
    return (
      <main>
        <h1>About this medicine</h1>
        <p data-testid="selected-name">{displayName}</p>

        {isCustom && (
          /*
            AC-3.1.2 — stated explicitly at entry time, not as a footnote or a
            tooltip. The user is choosing to record something Sana cannot check,
            and they should know that before they choose it, not afterwards.
          */
          <p data-testid="uncheckable-warning" role="alert">
            <strong>
              Sana cannot check this medicine for interactions or allergies
              because it isn&apos;t in our list.
            </strong>
          </p>
        )}

        <label htmlFor="dose-amount">Dose amount, if you know it</label>
        {/* No defaultValue, no numeric placeholder — §2.2 prohibition 2. */}
        <input
          id="dose-amount"
          name="dose-amount"
          inputMode="decimal"
          value={doseAmount}
          onChange={(event) => setDoseAmount(event.target.value)}
        />

        <label htmlFor="dose-unit">Unit</label>
        <input
          id="dose-unit"
          name="dose-unit"
          value={doseUnit}
          onChange={(event) => setDoseUnit(event.target.value)}
        />

        <button
          type="button"
          data-testid="run-screening"
          onClick={() => void runScreening()}
          disabled={busy || displayName === ''}
        >
          {busy ? 'Checking…' : 'Check and continue'}
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>Add a medicine</h1>
      <label htmlFor="drug-search">Search for the medicine</label>
      <input
        id="drug-search"
        data-testid="drug-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />

      <ul data-testid="search-results">
        {results.map((hit) => (
          <li key={hit.drug.id}>
            <button
              type="button"
              onClick={() => {
                setSelected(hit.drug);
                setIsCustom(false);
                setStage('details');
              }}
            >
              {hit.drug.generic_name}
              {hit.drug.brand_names.length > 0
                ? ` (${hit.drug.brand_names[0]})`
                : ''}
            </button>
          </li>
        ))}
      </ul>

      <section aria-label="Manual entry">
        <h2>Can&apos;t find it?</h2>
        <label htmlFor="manual-name">
          Type the name as it appears on the pack
        </label>
        <input
          id="manual-name"
          data-testid="manual-name"
          value={manualName}
          onChange={(event) => setManualName(event.target.value)}
        />
        <p data-testid="manual-warning">
          Sana cannot check this medicine for interactions or allergies because
          it isn&apos;t in our list.
        </p>
        <button
          type="button"
          data-testid="add-manually"
          onClick={() => {
            setIsCustom(true);
            setSelected(null);
            setStage('details');
          }}
          disabled={manualName.trim() === ''}
        >
          Add it manually
        </button>
      </section>
    </main>
  );
}
