import { allergiesRepository, conditionsRepository } from '../db/repositories';
import { db } from '../db/schema';
import { type ScreeningResult, screenRegimen } from '../engine/screening';
import { getActivePersonId } from '../person/active-person';
import { listActive } from './service';

/**
 * Re-screen the active regimen after a profile change (step 10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CALL THIS AFTER ANY ALLERGY OR CONDITION CHANGE
 * ─────────────────────────────────────────────────────────────────────────────
 * `shouldReviewRegimen` decides whether the user is routed to
 * /app/meds/review. It returns true whenever anything at all was raised,
 * including an INCOMPLETE result — a check that could not run is exactly the
 * thing the user needs to know about, and quietly swallowing it would recreate
 * the gap this whole path exists to close.
 */

export async function runRegimenReview(): Promise<ScreeningResult> {
  const personId = await getActivePersonId();
  if (personId === null) return { status: 'CLEAR' };

  const medications = await listActive(personId);
  if (medications.length === 0) return { status: 'CLEAR' };

  const [allergies, conditions] = await Promise.all([
    allergiesRepository.list(),
    conditionsRepository.list(),
  ]);

  const ingredientsByMedicationId: Record<
    string,
    { code: string; name: string }[]
  > = {};
  const classesByMedicationId: Record<string, string[]> = {};

  for (const medication of medications) {
    if (medication.drug_id === null) continue;
    const row = await db.drug_catalog.get(medication.drug_id);
    if (row) {
      ingredientsByMedicationId[medication.id] = row.active_ingredients;
      classesByMedicationId[medication.id] = row.drug_classes;
    }
  }

  const rulepackRows = await db.rulepack.toArray();

  return screenRegimen({
    profile: {
      dateOfBirth: null,
      sexAtBirth: 'undisclosed',
      isPregnant: false,
    },
    allergies,
    conditions,
    medications,
    rulepack: rulepackRows[0] ?? null,
    reference: {
      crossReference: (await db.cross_reference.toArray()) as never,
      interactions: (await db.interactions.toArray()) as never,
      contraindications: (await db.contraindications.toArray()) as never,
      pregnancyCautionClasses: [],
    },
    ingredientsByMedicationId,
    classesByMedicationId,
  });
}

/** True when the result is worth interrupting the user for. */
export function shouldReviewRegimen(result: ScreeningResult): boolean {
  return result.status !== 'CLEAR';
}

/**
 * The hook every allergy and condition mutation must call.
 *
 * Returns the route to send the user to, or null to stay put. Kept as a function
 * rather than a side effect so the caller decides when to navigate — a redirect
 * fired from inside a save would interrupt a form mid-submit.
 */
export async function reviewAfterProfileChange(): Promise<string | null> {
  const result = await runRegimenReview();
  return shouldReviewRegimen(result) ? '/app/meds/review' : null;
}
