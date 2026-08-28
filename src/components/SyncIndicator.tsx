'use client';

import { db } from '@/lib/db/schema';
import { type SchedulerState, subscribeToSync } from '@/lib/sync/scheduler';
import { useEffect, useState } from 'react';

/**
 * Non-blocking sync status (AC-8.1.5).
 *
 * MUST NEVER BLOCK INTERACTION. No modal, no overlay, no disabled controls, no
 * spinner over the content. The whole premise of the app is that it works
 * offline, so a sync failure is an ordinary state rather than an error — and a
 * user logging a dose on a bad connection should not be able to tell the
 * difference.
 *
 * It reports a pending COUNT rather than a bare "syncing", because "3 changes
 * waiting" tells the user their data is safe on the device, which is the thing
 * they actually want to know.
 */
export function SyncIndicator() {
  const [state, setState] = useState<SchedulerState | null>(null);
  const [pending, setPending] = useState(0);
  const [dead, setDead] = useState(0);

  useEffect(() => subscribeToSync(setState), []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [pendingCount, deadCount] = await Promise.all([
        db.outbox.where('status').anyOf('pending', 'failed').count(),
        db.outbox.where('status').equals('dead').count(),
      ]);
      if (!cancelled) {
        setPending(pendingCount);
        setDead(deadCount);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (state === null) return null;

  const label = (() => {
    if (dead > 0)
      return `${dead} change${dead === 1 ? '' : 's'} could not be saved online`;
    if (state.status === 'offline') {
      return pending > 0 ? `Offline — ${pending} waiting to sync` : 'Offline';
    }
    if (state.status === 'syncing') return 'Syncing…';
    if (state.status === 'failed') {
      return pending > 0 ? `Sync paused — ${pending} waiting` : 'Sync paused';
    }
    return pending > 0 ? `${pending} waiting to sync` : 'All changes saved';
  })();

  return (
    <output
      data-testid="sync-indicator"
      data-status={dead > 0 ? 'dead' : state.status}
      data-pending={pending}
      aria-live="polite"
      // Inline and unobtrusive. Deliberately not position:fixed with a backdrop —
      // nothing here may sit above the content the user is trying to reach.
      style={{ display: 'inline-block', fontSize: '0.875rem', opacity: 0.8 }}
    >
      {label}
    </output>
  );
}
