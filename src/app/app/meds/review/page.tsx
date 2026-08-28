'use client';

import { ScreeningResultView } from '@/components/meds/AlertList';
import type { ScreeningResult } from '@/lib/engine/screening';
import { runRegimenReview } from '@/lib/meds/review';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Regimen review (step 10, the gap-closing screen).
 *
 * Reached after an allergy or condition changes. §5.1 only ever screened a
 * candidate against the regimen; nothing re-checked a saved regimen when the
 * PROFILE changed underneath it, so a penicillin allergy recorded three weeks
 * after amoxicillin was added went unremarked forever.
 *
 * Surfaced as a SCREEN rather than a background pass, because a finding the user
 * never sees is the same as no finding at all.
 */
export default function RegimenReviewPage() {
  const [result, setResult] = useState<ScreeningResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await runRegimenReview();
      if (!cancelled) setResult(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (result === null) return <main>Checking your medicines…</main>;

  return (
    <main data-testid="regimen-review">
      <h1>We rechecked your medicines</h1>
      <p>
        Something you recorded has changed, so we checked it against the
        medicines already in your list.
      </p>
      <ScreeningResultView result={result} />
      <Link href="/app/meds">Back to your medicines</Link>
    </main>
  );
}
