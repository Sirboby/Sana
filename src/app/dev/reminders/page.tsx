'use client';

import {
  type PushSupport,
  REMINDER_COPY,
  detectPushSupport,
  reminderStatusCopy,
} from '@/lib/notifications/tiers';
import { useEffect, useState } from 'react';

/**
 * Harness for the reminder settings copy (step 11 E2E).
 *
 * The real /app/settings needs an authenticated session. The Tier 3 honesty
 * requirement is a property of the COPY, not of any data, so it is testable now
 * — and it is the requirement most likely to be softened later by someone
 * wanting the feature to sound better than it is.
 *
 * The interaction probe proves the page stays usable when push is unavailable,
 * which is the whole point of degrading to Tier 2 rather than erroring.
 */
export default function DevRemindersPage() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    setSupport(detectPushSupport());
  }, []);

  if (process.env.NODE_ENV === 'production') return null;
  if (support === null) return <main>Loading…</main>;

  return (
    <main>
      <section aria-label="Reminders" data-testid="reminder-settings">
        <h2>{REMINDER_COPY.heading}</h2>
        <p data-testid="tier2-copy">{REMINDER_COPY.tier2Always}</p>
        <p data-testid="tier1-copy">{reminderStatusCopy(support)}</p>
        <p data-testid="tier3-copy">
          <strong>{REMINDER_COPY.tier3Gap}</strong>
        </p>

        {support.tier1Available && support.permission === 'default' && (
          <button type="button" data-testid="enable-reminders">
            Turn on reminder notifications
          </button>
        )}

        <p data-testid="support-detected">
          push {support.pushApi ? 'supported' : 'not supported'} · service
          worker {support.serviceWorker ? 'supported' : 'not supported'} ·
          notifications {support.notifications ? 'supported' : 'not supported'}{' '}
          · permission {support.permission}
          {support.requiresInstall ? ' · add to home screen required' : ''} ·
          tier1 {support.tier1Available ? 'available' : 'unavailable'}
        </p>
      </section>

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
