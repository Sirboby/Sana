'use client';

import { CONSENT_TYPE, currentDisclaimerVersion } from '@/lib/auth/consent';
import { newId } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';

/**
 * The blocking safety disclaimer (PRD §2.4, US-1.2).
 *
 * §2.4: "Not a footer. Contextual and unavoidable at the moment of risk." This
 * screen is the first-run half of that — a screen the user must ACTIVELY accept,
 * version-tracked, with a changed disclaimer requiring re-consent.
 *
 * There is deliberately no dismiss, no "later", and no escape route. Middleware
 * sends every authenticated route here until a consent row exists for the
 * current version, so leaving without accepting simply returns here.
 */
export default function ConsentPage() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = currentDisclaimerVersion();

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) {
        setError('Your session expired. Sign in again.');
        return;
      }

      // AC-1.2.3: a consents row with the type, the current version, and
      // granted_at. owner_id is set by RLS's WITH CHECK against auth.uid().
      const { error: insertError } = await supabase.from('consents').insert({
        id: newId(),
        owner_id: data.user.id,
        consent_type: CONSENT_TYPE,
        version,
        granted_at: new Date().toISOString(),
      });

      if (insertError) {
        setError(
          'Could not record your acceptance. Check your connection and try again.',
        );
        return;
      }
      window.location.assign('/unlock');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Before you start</h1>

      <section aria-label="Safety disclaimer">
        <p>
          <strong>Sana is not a doctor and does not diagnose illness.</strong>
        </p>
        <p>
          It helps you keep track of the medicines you take, checks them against
          the allergies and conditions you record, and tells you when a symptom
          needs urgent attention. It is guidance, not a diagnosis, and it does
          not replace seeing a health professional.
        </p>
        <p>
          <strong>
            Never stop or change a prescribed medicine because of something Sana
            shows you.
          </strong>{' '}
          Speak to your doctor or pharmacist first.
        </p>
        <p>
          If you think you are having an emergency, do not use this app to
          decide. Get to a hospital or call for help.
        </p>
        <p>Disclaimer version {version}</p>
      </section>

      <label htmlFor="acknowledge">
        <input
          id="acknowledge"
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={busy}
        />
        I understand that Sana gives guidance, not a diagnosis.
      </label>

      {/* AC-1.2.2: continue stays disabled until the box is actually checked. */}
      <button type="button" onClick={accept} disabled={!acknowledged || busy}>
        {busy ? 'Saving…' : 'Continue'}
      </button>

      {error && <p role="alert">{error}</p>}
    </main>
  );
}
