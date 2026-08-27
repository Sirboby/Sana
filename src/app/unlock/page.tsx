'use client';

import {
  MAX_FAILED_ATTEMPTS,
  WARN_FROM_ATTEMPT,
  failedAttempts,
  isPinConfigured,
  setupPin,
  unlock,
} from '@/lib/db';
import { useEffect, useState } from 'react';

/**
 * Minimal PIN unlock screen (step 4).
 *
 * FUNCTIONAL ONLY — visual design is step 15.
 *
 * NOTE ON STATE: this component never holds the data key. It holds a PIN string
 * while the user is typing it and clears that on submit; everything else here is
 * booleans and message strings. The key itself lives in a module-scoped variable
 * inside keyring.ts and is deliberately unreachable from React, because React
 * state is serialised into the DOM and captured by devtools and error reporters.
 */

type Mode = 'loading' | 'setup' | 'unlock';

export default function UnlockPage() {
  const [mode, setMode] = useState<Mode>('loading');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const configured = await isPinConfigured();
      if (cancelled) return;
      setMode(configured ? 'unlock' : 'setup');
      if (configured) {
        const attempts = await failedAttempts();
        if (!cancelled && attempts >= WARN_FROM_ATTEMPT) {
          setWarning(remainingWarning(MAX_FAILED_ATTEMPTS - attempts));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function remainingWarning(remaining: number): string {
    return `${remaining} attempt${remaining === 1 ? '' : 's'} left. After that, data on this device is erased. Your account is not affected — it restores when you sign in again.`;
  }

  async function handleSetup(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (pin !== confirmPin) {
      setMessage('Those PINs do not match.');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setMessage('Choose a 6-digit PIN.');
      return;
    }
    setBusy(true);
    try {
      await setupPin(pin);
      setUnlocked(true);
    } catch (error) {
      // Safe to surface: this is a PIN-shape complaint, never clinical data.
      setMessage(
        error instanceof Error ? error.message : 'Could not set the PIN.',
      );
    } finally {
      setBusy(false);
      setPin('');
      setConfirmPin('');
    }
  }

  async function handleUnlock(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const result = await unlock(pin);
      if (result.ok) {
        setUnlocked(true);
        setWarning(null);
        return;
      }
      if (result.reason === 'wiped') {
        setMode('setup');
        setWarning(null);
        setMessage(
          'Too many incorrect attempts, so data on this device has been erased. Sign in again to restore it.',
        );
        return;
      }
      setMessage('That PIN is not correct.');
      setWarning(
        result.shouldWarn ? remainingWarning(result.attemptsRemaining) : null,
      );
    } finally {
      setBusy(false);
      setPin('');
    }
  }

  if (mode === 'loading') return <main>Loading…</main>;

  if (unlocked) {
    return (
      <main>
        <h1>Unlocked</h1>
        <p>Your health record on this device is available.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{mode === 'setup' ? 'Choose a PIN' : 'Enter your PIN'}</h1>

      {mode === 'setup' && (
        <p>
          This 6-digit PIN encrypts your health record on this device. We cannot
          recover it — if you forget it, the data here is erased and restored
          from your account instead.
        </p>
      )}

      <form onSubmit={mode === 'setup' ? handleSetup : handleUnlock}>
        <label htmlFor="pin">PIN</label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          disabled={busy}
        />

        {mode === 'setup' && (
          <>
            <label htmlFor="confirm-pin">Confirm PIN</label>
            <input
              id="confirm-pin"
              name="confirm-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={confirmPin}
              onChange={(event) =>
                setConfirmPin(event.target.value.replace(/\D/g, ''))
              }
              disabled={busy}
            />
          </>
        )}

        <button type="submit" disabled={busy || pin.length !== 6}>
          {busy ? 'Working…' : mode === 'setup' ? 'Set PIN' : 'Unlock'}
        </button>
      </form>

      {message && <p role="alert">{message}</p>}
      {warning && <p role="alert">{warning}</p>}
    </main>
  );
}
