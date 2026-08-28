'use client';

import type { Alert, ScreeningResult } from '@/lib/engine/screening';

/**
 * Screening alert presentation (PRD §2.4, AC-5.1.5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS COMPONENT AUTHORS NO CLINICAL PROSE
 * ─────────────────────────────────────────────────────────────────────────────
 * Every explanation string comes from the engine, which took it from the
 * rulepack or the curated reference tables. The component supplies structure,
 * severity styling and the section headings — nothing that describes a drug, a
 * risk, or what to do about it (§0 rule 2).
 *
 * The disclaimer is read from `alert.disclaimer` rather than hardcoded here. It
 * is a field on the Alert type precisely so that rendering an alert without it
 * is impossible, and duplicating the string in the component would reintroduce
 * the possibility of the two drifting apart.
 */

const SEVERITY_LABEL: Record<Alert['severity'], string> = {
  CRITICAL: 'Critical',
  SERIOUS: 'Serious',
  CAUTION: 'Caution',
  INFO: 'For information',
};

export function AlertCard({ alert }: { alert: Alert }) {
  return (
    <li
      data-testid="alert-card"
      data-kind={alert.kind}
      data-severity={alert.severity}
    >
      <p data-testid="alert-severity">
        <strong>{SEVERITY_LABEL[alert.severity]}</strong>
      </p>
      <h3>{alert.title}</h3>

      {/* Curated copy from the rulepack or reference tables. Never generated. */}
      <p data-testid="alert-explanation">{alert.explanation}</p>

      {alert.involvedDrugs.length > 0 && (
        <p data-testid="alert-drugs">
          Medicines involved:{' '}
          {alert.involvedDrugs.map((d) => d.label).join(', ')}
        </p>
      )}

      {/* §2.4 — flags a risk and refers on. Never says to stop anything. */}
      <p data-testid="alert-disclaimer">
        <strong>{alert.disclaimer}</strong>
      </p>

      {/* §2.5 provenance, discreet but present (AC-5.1.5). */}
      <p
        data-testid="alert-provenance"
        style={{ fontSize: '0.75rem', opacity: 0.7 }}
      >
        Safety content version {alert.rulepackVersion || 'unavailable'} ·
        source: {alert.source}
      </p>
    </li>
  );
}

/**
 * Render a whole screening result.
 *
 * INCOMPLETE leads with the limitation. §5.1's governing rule is that an empty
 * alert list is a positive claim of safety, so a result that could not be fully
 * checked must never be presented as a clean one — the limitation is the
 * headline, above any alerts that did fire.
 */
export function ScreeningResultView({ result }: { result: ScreeningResult }) {
  if (result.status === 'CLEAR') {
    return (
      <section data-testid="screening-result" data-status="CLEAR">
        <h2>No issues found</h2>
        <p>
          This medicine was checked against everything you have recorded and
          nothing was flagged.
        </p>
      </section>
    );
  }

  const { alerts } = result;

  return (
    <section data-testid="screening-result" data-status={result.status}>
      {result.status === 'INCOMPLETE' && (
        <div data-testid="incomplete-notice">
          <h2>This check is incomplete</h2>
          {result.uncheckable.length > 0 && (
            <p data-testid="uncheckable-list">
              Sana cannot check {result.uncheckable.join(', ')} for interactions
              or allergies because{' '}
              {result.uncheckable.length === 1 ? 'it is not' : 'they are not'}{' '}
              in our list.
            </p>
          )}
          {result.suppressedChecks.map((check) => (
            <p key={check.stage} data-testid="suppressed-check">
              {check.reason}
            </p>
          ))}
        </div>
      )}

      {alerts.length > 0 && (
        <>
          <h2>
            {alerts.length} thing{alerts.length === 1 ? '' : 's'} to be aware of
          </h2>
          <ul data-testid="alert-list">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Highest severity present, for deciding the action hierarchy. */
export function highestSeverity(
  result: ScreeningResult,
): Alert['severity'] | null {
  if (result.status === 'CLEAR' || result.alerts.length === 0) return null;
  const order: Alert['severity'][] = ['CRITICAL', 'SERIOUS', 'CAUTION', 'INFO'];
  for (const severity of order) {
    if (result.alerts.some((a) => a.severity === severity)) return severity;
  }
  return null;
}
