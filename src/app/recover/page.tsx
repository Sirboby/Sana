'use client';

import { normaliseRecoveryPhone } from '@/lib/auth/recovery';
import { useState } from 'react';

/**
 * Account recovery by SMS to a VERIFIED phone (US-1.4, AC-1.4.4).
 *
 * This page is an account-takeover path into a health record, and is treated as
 * one: only a verified number works (AC-1.4.2), and completing an email change
 * notifies both the old and new addresses and writes an audit row (AC-1.4.5).
 *
 * Phone is never a login method (AC-1.4.7). This flow does not sign anyone in —
 * it re-points the email on an account whose owner has proved control of the
 * registered number, and the owner then signs in with a code as usual.
 */
export default function RecoverPage() {
  const [stage, setStage] = useState<'phone' | 'code' | 'email' | 'done'>(
    'phone',
  );
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestSms(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // AC-1.4.1: normalise and validate BEFORE any network call, so a bad format
    // produces a field error and never reaches (or bills) the SMS provider.
    const normalised = normaliseRecoveryPhone(phone);
    if (!normalised.ok) {
      setError(normalised.message);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalised.e164 }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Could not send a recovery code.');
        return;
      }
      setStage('code');
    } catch {
      setError('You need a connection to recover your account.');
    } finally {
      setBusy(false);
    }
  }

  async function verifySms(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: normaliseRecoveryPhone(phone),
          token: code,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'That code did not work.');
        return;
      }
      setStage('email');
    } catch {
      setError('You need a connection to recover your account.');
    } finally {
      setBusy(false);
      setCode('');
    }
  }

  async function changeEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/auth/recovery/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? 'Could not change the email address.');
        return;
      }
      setStage('done');
    } catch {
      setError('You need a connection to recover your account.');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'done') {
    return (
      <main>
        <h1>Email address changed</h1>
        <p>
          We have notified both the old and the new address. If you did not make
          this change, contact support immediately — someone else may have
          access to your health record.
        </p>
        <p>
          <a href="/login">Sign in with your new address</a>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Recover your account</h1>
      <p>
        If you can no longer reach your email address, and you added a phone
        number as a recovery channel, we can send a code to that number.
      </p>

      {stage === 'phone' && (
        <form onSubmit={requestSms}>
          <label htmlFor="phone">Recovery phone number</label>
          <input
            id="phone"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      )}

      {stage === 'code' && (
        <form onSubmit={verifySms}>
          <label htmlFor="sms-code">6-digit code</label>
          <input
            id="sms-code"
            name="sms-code"
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
        </form>
      )}

      {stage === 'email' && (
        <form onSubmit={changeEmail}>
          <label htmlFor="new-email">New email address</label>
          <input
            id="new-email"
            name="new-email"
            type="email"
            autoComplete="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            disabled={busy}
          />
          <p>
            Both your old and new address will be notified of this change, and
            it will be recorded in your account history.
          </p>
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Change email address'}
          </button>
        </form>
      )}

      {error && <p role="alert">{error}</p>}
    </main>
  );
}
