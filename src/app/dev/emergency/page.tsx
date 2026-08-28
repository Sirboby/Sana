'use client';

import { EmergencyScreen } from '@/features/check/EmergencyScreen';
import type { RedFlagSymptomCode } from '@/lib/engine/redflag-codes';
import { evaluateRedFlags } from '@/lib/engine/redflags';
import { useState } from 'react';

/**
 * Harness route for the escalation screen (step 7 E2E).
 *
 * The real entry point is the symptom picker, which is step 12. This exists so
 * the screen's own properties — non-dismissible, one primary action, empty
 * facility slot — can be tested now rather than waiting five steps.
 *
 * It runs the REAL evaluator on real symptom codes. Nothing about the escalation
 * is faked, only the route that reaches it.
 */
export default function DevEmergencyPage() {
  // Never reachable in production. The middleware also refuses /dev/ there, but
  // a test harness that renders an emergency screen must not be one config
  // mistake away from being live.
  if (process.env.NODE_ENV === 'production') return null;

  const [acknowledged, setAcknowledged] = useState(false);

  const match = evaluateRedFlags(['SYM_CHEST_PAIN'] as RedFlagSymptomCode[], {
    dateOfBirth: '1990-01-01',
    isPregnant: false,
  });

  if (acknowledged) {
    return (
      <main data-testid="emergency-acknowledged">
        <h1>Acknowledged</h1>
      </main>
    );
  }

  if (!match) return <main>No red flag matched.</main>;

  return (
    <EmergencyScreen
      match={match}
      // Null until a human populates content/emergency-numbers.json. The screen
      // must never render a number nobody has dialled.
      emergencyNumber={null}
      onAcknowledge={() => setAcknowledged(true)}
    />
  );
}
