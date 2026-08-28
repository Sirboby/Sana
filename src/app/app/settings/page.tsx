'use client';

import {
  type PushSupport,
  REMINDER_COPY,
  detectPushSupport,
  reminderStatusCopy,
} from '@/lib/notifications/tiers';
import { useEffect, useState } from 'react';

/**
 * Notification settings (step 11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TIER 3 GAP IS STATED HERE, NOT BURIED
 * ─────────────────────────────────────────────────────────────────────────────
 * AC-3.2.2 asked for a notification with the app closed AND no network. No
 * browser can do that — the only API for it was abandoned before it shipped.
 * Rather than approximate it and hope, the limit is written on the screen where
 * someone decides whether to depend on reminders.
 *
 * A user who trusts a reminder that never fires is worse off than one who knows
 * to open the app. That is the whole reason this copy is worded as a limit
 * rather than a feature.
 *
 * NO REPEATED PROMPTING. Permission is requested once, on an explicit tap. A
 * denied permission is respected and the app carries on fully functional on
 * Tier 2 — nothing here breaks, and nothing nags.
 */
export default function SettingsPage() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    setSupport(detectPushSupport());
  }, []);

  async function enableReminders() {
    setRequesting(true);
    try {
      const permission = await Notification.requestPermission();
      setSupport({ ...(support as PushSupport), permission });

      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });
    } catch {
      // Subscribing failed. Tier 2 is unaffected, so there is nothing to
      // recover from and nothing alarming to say.
    } finally {
      setRequesting(false);
    }
  }

  if (support === null) return <main>Loading…</main>;

  const canAskForPermission =
    support.tier1Available && support.permission === 'default' && !requesting;

  return (
    <main>
      <h1>Settings</h1>

      <section aria-label="Reminders" data-testid="reminder-settings">
        <h2>{REMINDER_COPY.heading}</h2>

        {/* Tier 2 first, because it is the part that always works. */}
        <p data-testid="tier2-copy">{REMINDER_COPY.tier2Always}</p>

        <p data-testid="tier1-copy">{reminderStatusCopy(support)}</p>

        {/* Tier 3 — the honest gap. */}
        <p data-testid="tier3-copy">
          <strong>{REMINDER_COPY.tier3Gap}</strong>
        </p>

        {canAskForPermission && (
          <button
            type="button"
            data-testid="enable-reminders"
            onClick={() => void enableReminders()}
          >
            Turn on reminder notifications
          </button>
        )}

        {support.permission === 'granted' && (
          <p data-testid="reminders-on">
            Reminder notifications are on for this device.
          </p>
        )}

        {/*
          Denied is a final answer. No re-prompt, no banner, no nag — the browser
          would ignore a second request anyway, and asking again would only make
          the app feel like it is not listening.
        */}
        {support.permission === 'denied' && (
          <p data-testid="reminders-denied">{REMINDER_COPY.denied}</p>
        )}

        <p
          data-testid="support-detected"
          style={{ fontSize: '0.75rem', opacity: 0.7 }}
        >
          This browser: push {support.pushApi ? 'supported' : 'not supported'} ·
          service worker {support.serviceWorker ? 'supported' : 'not supported'}{' '}
          · permission {support.permission}
          {support.requiresInstall ? ' · add to home screen required' : ''}
        </p>
      </section>
    </main>
  );
}
