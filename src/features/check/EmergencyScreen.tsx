'use client';

import type { RedFlagMatch } from '@/lib/engine/redflags';
import { useEffect, useRef, useState } from 'react';

/**
 * The emergency escalation screen (PRD §2.3, AC-6.1.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIREMENTS THIS SCREEN EXISTS TO MEET
 * ─────────────────────────────────────────────────────────────────────────────
 * §2.3: full-screen, non-dismissible without explicit acknowledgement, highest
 * contrast available, renders identically offline. Two actions in strict
 * priority order and NOTHING else — no navigation, no links, no other CTAs.
 *
 * It names what was found in plain language and never a condition (§2.2
 * prohibition 3): "chest pain", never "heart attack". It gives no dose and no
 * treatment verb (§2.2 prohibitions 1 and 2), which the safety suite asserts
 * against every rule's copy.
 *
 * OFFLINE: no fetch, no remote font, no remote image, no dynamic import. Someone
 * reaching this screen may have no signal, and everything on it must already be
 * on the device. Styles are inline for the same reason — a stylesheet that fails
 * to load must not be able to render this unreadable.
 */

export type EmergencyScreenProps = {
  match: RedFlagMatch;
  /**
   * Verified emergency number. NULL until a human populates
   * content/emergency-numbers.json — see scripts/validate-emergency-numbers.ts.
   * When null the screen says to get to a hospital rather than showing a
   * fabricated or dead number.
   */
  emergencyNumber: string | null;
  /**
   * Nearest VERIFIED emergency facility.
   *
   * ALWAYS null in step 7 — wired in step 13a. §2.3 is explicit that only a
   * facility with has_emergency = true AND a verified_at may appear, that there
   * is never a fallback to a pharmacy, clinic or unverified record, and that
   * when none is known the block is ABSENT. An absent block is correct; a wrong
   * destination is harm.
   */
  nearestVerifiedFacility?: null;
  onAcknowledge: () => void;
};

export function EmergencyScreen({
  match,
  emergencyNumber,
  nearestVerifiedFacility = null,
  onAcknowledge,
}: EmergencyScreenProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Block the routes out that are not an explicit acknowledgement (AC-6.1.2).
   *
   * Escape is swallowed, and a history entry is pushed so the back button
   * returns here instead of leaving. Someone can still close the tab — the
   * requirement is that the screen is not dismissible by a reflex gesture, not
   * that the user is trapped.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.history.pushState({ sanaEmergency: true }, '');
    const onPopState = () => {
      window.history.pushState({ sanaEmergency: true }, '');
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', onPopState);
    containerRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  function acknowledge() {
    setAcknowledged(true);
    onAcknowledge();
  }

  return (
    <div
      ref={containerRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-heading"
      aria-describedby="emergency-concern"
      tabIndex={-1}
      data-testid="emergency-screen"
      data-rule-id={match.ruleId}
      // Inline, maximum contrast, and not dependent on a stylesheet loading.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: '#000000',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '1.5rem',
        overflowY: 'auto',
      }}
    >
      <h1
        id="emergency-heading"
        style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 0.75rem' }}
      >
        Get emergency help now
      </h1>

      {/* Names the finding, never a condition (§2.2 prohibition 3). */}
      <p
        id="emergency-concern"
        style={{ fontSize: '1.25rem', margin: '0 0 1.5rem' }}
      >
        {match.concern}
      </p>

      {/* ── PRIMARY ACTION: call emergency services. Visually dominant. ── */}
      {emergencyNumber ? (
        <a
          href={`tel:${emergencyNumber}`}
          data-testid="emergency-call"
          style={{
            display: 'block',
            background: '#ffffff',
            color: '#000000',
            fontSize: '1.5rem',
            fontWeight: 700,
            textAlign: 'center',
            padding: '1.25rem',
            borderRadius: '0.5rem',
            textDecoration: 'none',
            marginBottom: '1rem',
          }}
        >
          Call {emergencyNumber}
        </a>
      ) : (
        /*
         * No verified number yet. We say what to do rather than showing a number
         * nobody has dialled — a dead tel: link on this screen is worse than no
         * link, because the user believes help is coming.
         */
        <p
          data-testid="emergency-number-unavailable"
          style={{
            background: '#ffffff',
            color: '#000000',
            fontSize: '1.25rem',
            fontWeight: 700,
            padding: '1.25rem',
            borderRadius: '0.5rem',
            marginBottom: '1rem',
          }}
        >
          Go to the nearest hospital straight away, or ask someone to help you
          get there.
        </p>
      )}

      {/*
        ── SECONDARY ACTION SLOT: nearest verified emergency facility ──
        Empty in step 7 and wired in step 13a. §2.3: when no verified emergency
        facility is known, show NOTHING. Rendering a pharmacy, a clinic, or an
        unverified record here would send someone in crisis to a place with no
        emergency department.
      */}
      {nearestVerifiedFacility === null ? null : null}

      <button
        type="button"
        onClick={acknowledge}
        disabled={acknowledged}
        data-testid="emergency-acknowledge"
        style={{
          marginTop: '1.5rem',
          background: 'transparent',
          color: '#ffffff',
          border: '2px solid #ffffff',
          borderRadius: '0.5rem',
          fontSize: '1rem',
          padding: '0.875rem',
          cursor: 'pointer',
        }}
      >
        I understand
      </button>
    </div>
  );
}
