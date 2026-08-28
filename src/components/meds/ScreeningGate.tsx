'use client';

import type { ScreeningResult } from '@/lib/engine/screening';
import { useState } from 'react';
import { ScreeningResultView, highestSeverity } from './AlertList';

/**
 * The gate between a screening result and the save (step 10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SANA RECORDS REALITY. "ADD ANYWAY" ALWAYS EXISTS.
 * ─────────────────────────────────────────────────────────────────────────────
 * §2.2 prohibition 5 forbids advising anyone to stop a prescribed medicine, and
 * a person whose doctor prescribed a flagged drug still has to be able to track
 * it. Blocking the save outright would push them to keep the medicine out of the
 * app entirely — which removes it from every future check too, and makes the
 * next screening silently wrong.
 *
 * What IS controlled is which path is default:
 *   - The dominant action is "Don't add".
 *   - "Add anyway" is present, secondary, de-emphasised.
 *   - For CRITICAL, "add anyway" needs a second, DIFFERENT confirmation that
 *     names what was flagged — not a second identical button.
 *   - There is never a single "OK" that both dismisses the alert and saves.
 *
 * Most apps invert this because they optimise for flow completion. The cost of
 * that inversion here is someone tapping past a critical allergy warning by
 * muscle memory, which is the exact event this whole application exists to
 * prevent.
 */

export type ScreeningGateProps = {
  result: ScreeningResult;
  onCancel: () => void;
  onConfirm: () => void;
  /** Name of the medicine, echoed back in the critical confirmation. */
  medicationName: string;
};

export function ScreeningGate({
  result,
  onCancel,
  onConfirm,
  medicationName,
}: ScreeningGateProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const severity = highestSeverity(result);
  const needsSecondConfirmation = severity === 'CRITICAL';
  const emphasiseCancel = severity === 'CRITICAL' || severity === 'SERIOUS';

  return (
    <div
      data-testid="screening-gate"
      data-highest-severity={severity ?? 'none'}
    >
      <ScreeningResultView result={result} />

      <div data-testid="gate-actions">
        {/*
          PRIMARY action, first in DOM order and visually dominant. First in the
          DOM matters as much as the styling: it is what a screen reader reaches
          first and what a keyboard user tabs to first.
        */}
        <button
          type="button"
          data-testid="gate-cancel"
          data-role="primary"
          onClick={onCancel}
          style={
            emphasiseCancel
              ? {
                  display: 'block',
                  width: '100%',
                  fontSize: '1.125rem',
                  fontWeight: 700,
                  padding: '1rem',
                  marginBottom: '0.75rem',
                }
              : undefined
          }
        >
          Don&apos;t add this medicine
        </button>

        {needsSecondConfirmation && (
          /*
            The second confirmation is a DIFFERENT act, not a repeat of the same
            one. It names the medicine and requires an explicit acknowledgement
            that something critical was flagged, so it cannot be cleared by
            tapping the same spot twice.
          */
          <label
            data-testid="critical-acknowledgement"
            style={{ display: 'block' }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              data-testid="critical-acknowledge-checkbox"
            />{' '}
            I have read the critical warning above and still want to record that
            I am taking {medicationName}.
          </label>
        )}

        {/* SECONDARY, de-emphasised, and disabled until acknowledged when critical. */}
        <button
          type="button"
          data-testid="gate-confirm"
          data-role="secondary"
          onClick={onConfirm}
          disabled={needsSecondConfirmation && !acknowledged}
          style={{
            display: 'block',
            marginTop: '0.75rem',
            fontSize: '0.875rem',
            fontWeight: 400,
            opacity: 0.75,
            background: 'transparent',
            textDecoration: 'underline',
          }}
        >
          Add anyway
        </button>
      </div>
    </div>
  );
}
