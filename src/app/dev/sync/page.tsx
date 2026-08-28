'use client';

import { SyncIndicator } from '@/components/SyncIndicator';
import { triggerSync } from '@/lib/sync/scheduler';
import { useState } from 'react';

/**
 * Harness for the sync indicator (step 9 E2E).
 *
 * The full offline round trip needs authentication and the dose-logging UI from
 * step 11. What IS testable now is the property most likely to regress: that a
 * failing sync never blocks interaction. The probe button proves the page still
 * responds while sync is failing.
 */
export default function DevSyncPage() {
  const [clicks, setClicks] = useState(0);

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <main data-testid="sync-harness">
      <h1>Sync harness</h1>
      <SyncIndicator />
      <button
        type="button"
        data-testid="sync-trigger"
        onClick={() => void triggerSync('manual')}
      >
        Trigger sync
      </button>
      <button
        type="button"
        data-testid="interaction-probe"
        onClick={() => setClicks((c) => c + 1)}
      >
        Probe interaction
      </button>
      <p data-testid="interaction-count">{clicks}</p>
    </main>
  );
}
