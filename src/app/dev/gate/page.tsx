'use client';

import { ScreeningGate } from '@/components/meds/ScreeningGate';
import {
  type Alert,
  MANDATORY_DISCLAIMER,
  type ScreeningResult,
} from '@/lib/engine/screening';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

/**
 * Harness for the screening gate (step 10 E2E).
 *
 * The real path needs authentication and a seeded regimen. The gate's OWN
 * properties — which action is primary, whether a critical alert needs a second
 * confirmation — are independent of all that and testable now. They are also the
 * properties most likely to regress, since the natural instinct when tuning a
 * flow is to make the save easier to reach.
 */
function GateHarness() {
  const params = useSearchParams();
  const severity =
    params.get('severity') === 'SERIOUS' ? 'SERIOUS' : 'CRITICAL';
  const [outcome, setOutcome] = useState<string | null>(null);

  if (process.env.NODE_ENV === 'production') return null;

  const criticalAlert: Alert = {
    id: 'ALLERGY_DIRECT:demo',
    kind: 'ALLERGY_DIRECT' as const,
    severity: 'CRITICAL' as const,
    title: 'You have recorded an allergy to this medicine',
    explanation:
      'Amoxicillin contains amoxicillin, which you have recorded as an allergy.',
    involvedDrugs: [{ id: 'med-1', label: 'Amoxicillin' }],
    source: 'user allergy record',
    rulepackVersion: '1.0.0',
    disclaimer: MANDATORY_DISCLAIMER,
  };

  const seriousAlert: Alert = {
    id: 'DUPLICATE_INGREDIENT:demo',
    kind: 'DUPLICATE_INGREDIENT' as const,
    severity: 'SERIOUS' as const,
    title: 'Two medicines contain the same ingredient',
    explanation:
      'Panadol Extra and Paracetamol both contain acetaminophen. Taking them together means more of that ingredient than either product alone suggests.',
    involvedDrugs: [
      { id: 'med-1', label: 'Panadol Extra' },
      { id: 'med-2', label: 'Paracetamol' },
    ],
    source: 'drug catalog ingredient match',
    rulepackVersion: '1.0.0',
    disclaimer: MANDATORY_DISCLAIMER,
  };

  const result: ScreeningResult = {
    status: 'ALERTS',
    uncheckable: [],
    suppressedChecks: [],
    alerts: [severity === 'CRITICAL' ? criticalAlert : seriousAlert],
  };

  if (outcome !== null)
    return <main data-testid="gate-outcome">{outcome}</main>;

  return (
    <main>
      <ScreeningGate
        result={result}
        medicationName={
          severity === 'CRITICAL' ? 'Amoxicillin' : 'Panadol Extra'
        }
        onCancel={() => setOutcome('cancelled')}
        onConfirm={() => setOutcome('confirmed')}
      />
    </main>
  );
}

export default function DevGatePage() {
  return (
    <Suspense fallback={<main>Loading…</main>}>
      <GateHarness />
    </Suspense>
  );
}
