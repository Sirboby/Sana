'use client';

import { EmailSchema } from '@/lib/schemas';
import { useEffect, useState } from 'react';

/**
 * Email + 6-digit code sign-in (US-1.1). Used by BOTH /signup and /login,
 * because AC-1.1.7 makes them one flow — an existing address simply receives a
 * code and creates no duplicate profile.
 *
 * Never renders or stores the code anywhere but the input the user typed it
 * into, and never puts an address or code into a log.
 */

const RESEND_COOLDOWN_SECONDS = 60;

type Stage = 'email' | 'code';

export function EmailCodeForm({ heading }: { heading: string }) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);

    // AC-1.1.3: validate BEFORE any network call, so an invalid address produces
    // a field error and fires no request at all.
    const parsed = EmailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: parsed.data }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Could not send a code.');
        return;
      }
      setStage('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      // AC-1.1.4: an explicit connection message, not a generic failure.
      setError('You need a connection to sign in. Reconnect and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EmailSchema.parse(email), token: code }),
      });
      const payload = await response.json();
      if (!response.ok) {
        // Distinct messages for expired vs already-used vs wrong (AC-1.1.6).
        setError(payload.error ?? 'That code did not work.');
        return;
      }
      window.location.assign('/consent');
    } catch {
      setError('You need a connection to sign in. Reconnect and try again.');
    } finally {
      setBusy(false);
      setCode('');
    }
  }

  if (!online) {
    return (
      <main>
        <h1>{heading}</h1>
        <p role="alert" data-testid="offline-notice">
          You need a connection to create an account or sign in. Your health
          record already on this device is unaffected — reconnect when you can.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{heading}</h1>

      {stage === 'email' ? (
        <form onSubmit={requestCode}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p>
            We sent a 6-digit code to your email. Enter it here to continue.
          </p>
          <label htmlFor="code">6-digit code</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            disabled={busy}
          />
          <button type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => requestCode()}
            disabled={busy || cooldown > 0}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" data-testid="auth-error">
          {error}
        </p>
      )}
    </main>
  );
}
