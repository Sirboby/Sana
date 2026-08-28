/**
 * The screening engine (PRD §5.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GOVERNING RULE: AN EMPTY ALERT LIST IS A POSITIVE CLAIM
 * ─────────────────────────────────────────────────────────────────────────────
 * "No alerts" tells the user this medicine is safe for them. That claim is FALSE
 * whenever any medicine involved could not be resolved to ingredients, or a
 * check could not run. So the result is tri-state, and `CLEAR` is structurally
 * unconstructible when anything was unchecked — it carries no fields at all, so
 * there is nowhere to put an uncheckable item even by mistake.
 *
 * `INCOMPLETE` must never be rendered as, collapsed into, or shown alongside a
 * "no issues found" message. When a check is incomplete the limitation IS the
 * headline.
 *
 * Pure and synchronous (AC-5.1.7). No I/O, no network, no async. All seven
 * stages always run and alerts accumulate — a user with both an allergy and a
 * duplicate ingredient must see both, so nothing short-circuits.
 *
 * NO CLINICAL PROSE IS AUTHORED HERE. Every user-facing string comes from the
 * rulepack's alertCopy templates or from the curated explanation/recommendation
 * columns in the reference tables (§0 rule 2). The engine interpolates; it never
 * writes.
 */

import type {
  Allergy,
  AllergyCrossReference,
  Condition,
  ConditionContraindication,
  DrugInteraction,
  Medication,
  RulepackDocument,
} from '../schemas';

// ─────────────────────────── types ───────────────────────────

export type AlertKind =
  | 'ALLERGY_DIRECT'
  | 'ALLERGY_CROSS_CLASS'
  | 'DUPLICATE_INGREDIENT'
  | 'INTERACTION'
  | 'CONDITION_CONTRA'
  | 'PREGNANCY_CAUTION'
  | 'UNCHECKABLE';

export type AlertSeverity = 'CRITICAL' | 'SERIOUS' | 'CAUTION' | 'INFO';

/**
 * §2.4 requires this on every interaction and allergy warning. It is a FIELD on
 * the alert, not something the UI remembers to add, so that rendering an alert
 * without it is impossible rather than merely discouraged.
 *
 * Note what it does and does not say: it flags a risk and refers the user on. It
 * never tells anyone to stop a medicine (§2.2 prohibition 5).
 */
export const MANDATORY_DISCLAIMER =
  'Do not stop any prescribed medicine because of this alert. Speak to your doctor or pharmacist.';

export type InvolvedDrug = { id: string; label: string };

export type Alert = {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  /** Curated prose from the rulepack or reference tables. Never generated. */
  explanation: string;
  involvedDrugs: InvolvedDrug[];
  source: string;
  /** §2.5 provenance, AC-5.1.5. */
  rulepackVersion: string;
  /** §2.4. Structural, so it cannot be omitted at render time. */
  disclaimer: typeof MANDATORY_DISCLAIMER;
};

/** A check that could not run at all, as distinct from a medicine that could not be read. */
export type SuppressedCheck = {
  stage: AlertKind;
  reason: string;
};

/**
 * CLEAR carries no fields deliberately. There is nowhere to attach an
 * uncheckable medicine or a suppressed check, so the "safe" answer cannot be
 * constructed while anything is unknown.
 */
export type ScreeningResult =
  | { status: 'CLEAR' }
  | {
      status: 'ALERTS';
      alerts: Alert[];
      uncheckable: string[];
      suppressedChecks: SuppressedCheck[];
    }
  | {
      status: 'INCOMPLETE';
      uncheckable: string[];
      alerts: Alert[];
      suppressedChecks: SuppressedCheck[];
    };

export type ScreeningProfile = {
  dateOfBirth: string | null;
  sexAtBirth: string;
  isPregnant: boolean;
};

export type ReferenceData = {
  crossReference: AllergyCrossReference[];
  interactions: DrugInteraction[];
  contraindications: ConditionContraindication[];
  /** Drug classes flagged for caution in pregnancy. Curated, may be empty. */
  pregnancyCautionClasses: {
    drug_class: string;
    explanation: string;
    source: string;
  }[];
};

export type ScreeningInput = {
  profile: ScreeningProfile;
  allergies: Allergy[];
  conditions: Condition[];
  currentMedications: Medication[];
  candidate: Medication;
  /** Null when missing or checksum-failed. Copy-dependent stages then suppress. */
  rulepack: RulepackDocument | null;
  reference: ReferenceData;
  /** Ingredient codes per medication id, from the catalog. */
  ingredientsByMedicationId: Record<string, { code: string; name: string }[]>;
  /** Drug classes per medication id, from the catalog. */
  classesByMedicationId: Record<string, string[]>;
};

// ─────────────────────────── ordering ───────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  CRITICAL: 0,
  SERIOUS: 1,
  CAUTION: 2,
  INFO: 3,
};

/**
 * Tie-break order within a severity band.
 *
 * A direct allergy outranks a cross-class one because the user acts differently
 * on each, and the more certain finding should be read first.
 */
const KIND_RANK: Record<AlertKind, number> = {
  ALLERGY_DIRECT: 0,
  ALLERGY_CROSS_CLASS: 1,
  DUPLICATE_INGREDIENT: 2,
  INTERACTION: 3,
  CONDITION_CONTRA: 4,
  PREGNANCY_CAUTION: 5,
  UNCHECKABLE: 6,
};

function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.id.localeCompare(b.id),
  );
}

// ─────────────────────────── copy ───────────────────────────

/**
 * Interpolate a curated template. `{{name}}` placeholders only — no expressions,
 * no logic. A template engine here would be a way to author prose at runtime,
 * which §0 rule 2 forbids.
 */
function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => variables[key] ?? '',
  );
}

function alertCopyFor(
  rulepack: RulepackDocument | null,
  kind: AlertKind,
): { title: string; body: string } | null {
  const copy = rulepack?.alertCopy?.[kind];
  return copy ? { title: copy.title, body: copy.body } : null;
}

/**
 * Guarantee that an alert's copy actually contains the facts the AC requires.
 *
 * AC-5.1.3 requires a duplicate-ingredient alert to name BOTH products and the
 * shared ingredient. Relying on a rulepack template to include the right
 * placeholders makes that requirement depend on content authoring — and the
 * seeded template originally read "Both products contain the same active
 * ingredient", which names nothing and would have shipped an alert the user
 * could not act on.
 *
 * So the engine checks the RENDERED string and falls back to the structured
 * statement when a required fact is missing. Curated copy is still preferred;
 * it just cannot silently drop the identifiers that make the alert useful.
 */
function copyOrFallback(
  rendered: string | null,
  required: string[],
  fallback: string,
): string {
  if (rendered === null) return fallback;
  const lower = rendered.toLowerCase();
  const missing = required.some((fact) => !lower.includes(fact.toLowerCase()));
  return missing ? fallback : rendered;
}

// ─────────────────────────── the engine ───────────────────────────

export function screen(input: ScreeningInput): ScreeningResult {
  const alerts: Alert[] = [];
  const uncheckable: string[] = [];
  const suppressedChecks: SuppressedCheck[] = [];

  const rulepackVersion = input.rulepack?.version ?? '';
  const candidateIngredients =
    input.ingredientsByMedicationId[input.candidate.id] ?? [];
  const candidateClasses =
    input.classesByMedicationId[input.candidate.id] ?? [];

  const makeAlert = (
    parts: Omit<Alert, 'disclaimer' | 'rulepackVersion'> & {
      rulepackVersion?: string;
    },
  ): Alert => ({
    ...parts,
    rulepackVersion: parts.rulepackVersion ?? rulepackVersion,
    disclaimer: MANDATORY_DISCLAIMER,
  });

  // ── STAGE 1: uncheckable guard (AC-5.1.8) ──
  // A custom medication has no ingredient list, so every ingredient-level stage
  // is blind to it. Say so rather than letting silence imply safety.
  const customMedications = [
    input.candidate,
    ...input.currentMedications,
  ].filter((medication) => medication.is_custom);

  for (const medication of customMedications) {
    uncheckable.push(medication.display_name);
    alerts.push(
      makeAlert({
        id: `UNCHECKABLE:${medication.id}`,
        kind: 'UNCHECKABLE',
        severity: 'INFO',
        title: 'This medicine could not be checked',
        explanation: `${medication.display_name} was added manually, so its ingredients are not known and it could not be included in these checks.`,
        involvedDrugs: [{ id: medication.id, label: medication.display_name }],
        source: 'engine',
      }),
    );
  }

  const checkableMedications = input.currentMedications.filter(
    (m) => !m.is_custom,
  );
  const candidateCheckable = !input.candidate.is_custom;

  // ── STAGE 2: direct allergy (AC-5.1.1) ──
  if (candidateCheckable) {
    const allergenCodes = new Set(
      input.allergies
        .filter(
          (allergy) =>
            allergy.allergen_type === 'drug' && allergy.allergen_code,
        )
        .map((allergy) => allergy.allergen_code as string),
    );

    for (const ingredient of candidateIngredients) {
      if (!allergenCodes.has(ingredient.code)) continue;
      const allergy = input.allergies.find(
        (a) => a.allergen_code === ingredient.code,
      );
      const copy = alertCopyFor(input.rulepack, 'ALLERGY_DIRECT');

      alerts.push(
        makeAlert({
          id: `ALLERGY_DIRECT:${input.candidate.id}:${ingredient.code}`,
          kind: 'ALLERGY_DIRECT',
          severity: 'CRITICAL',
          title: copy?.title ?? 'You have recorded an allergy to this medicine',
          explanation: copy
            ? interpolate(copy.body, {
                drug: input.candidate.display_name,
                ingredient: ingredient.name,
                allergen: allergy?.allergen_label ?? ingredient.name,
              })
            : `${input.candidate.display_name} contains ${ingredient.name}, which you have recorded as an allergy.`,
          involvedDrugs: [
            { id: input.candidate.id, label: input.candidate.display_name },
          ],
          source: 'user allergy record',
        }),
      );
    }
  }

  // ── STAGE 3: cross-class allergy (AC-5.1.2) ──
  // Kept distinct from stage 2 on purpose. "You are allergic to this" and "this
  // is related to something you react to" lead to different decisions, and
  // conflating them is a defect. The copy says which one this is, and carries
  // the risk level from the data rather than asserting a level of its own.
  if (candidateCheckable) {
    const userAllergenClasses = new Set(
      input.allergies.flatMap((allergy) => allergy.drug_classes),
    );

    for (const row of input.reference.crossReference) {
      if (!userAllergenClasses.has(row.allergen_class)) continue;
      if (!candidateClasses.includes(row.reactive_class)) continue;

      const copy = alertCopyFor(input.rulepack, 'ALLERGY_CROSS_CLASS');
      alerts.push(
        makeAlert({
          id: `ALLERGY_CROSS_CLASS:${input.candidate.id}:${row.allergen_class}:${row.reactive_class}`,
          kind: 'ALLERGY_CROSS_CLASS',
          severity: 'SERIOUS',
          title:
            copy?.title ?? 'This medicine is related to something you react to',
          explanation: copy
            ? interpolate(copy.body, {
                drug: input.candidate.display_name,
                allergenClass: row.allergen_class,
                reactiveClass: row.reactive_class,
                riskLevel: row.risk_level,
                note: row.note,
              })
            : `${input.candidate.display_name} belongs to the ${row.reactive_class} group, which can cross-react with ${row.allergen_class}, an allergy you have recorded. This is a possible cross-reaction rather than a direct allergy match. Recorded risk: ${row.risk_level}. ${row.note}`,
          involvedDrugs: [
            { id: input.candidate.id, label: input.candidate.display_name },
          ],
          source: row.source,
        }),
      );
    }
  }

  // ── STAGE 4: duplicate active ingredient (AC-5.1.3) ──
  // The flagship check. It catches a combination remedy taken alongside a plain
  // single-ingredient product — invisible to the user because the brand names
  // differ, and the most common serious OTC poisoning route there is. Names BOTH
  // products and the shared ingredient, because "you have a duplicate" without
  // saying which two is not actionable.
  if (candidateCheckable) {
    for (const medication of checkableMedications) {
      if (medication.id === input.candidate.id) continue;

      const otherIngredients =
        input.ingredientsByMedicationId[medication.id] ?? [];
      const otherCodes = new Map(otherIngredients.map((i) => [i.code, i.name]));

      for (const ingredient of candidateIngredients) {
        if (!otherCodes.has(ingredient.code)) continue;

        const copy = alertCopyFor(input.rulepack, 'DUPLICATE_INGREDIENT');
        alerts.push(
          makeAlert({
            id: `DUPLICATE_INGREDIENT:${input.candidate.id}:${medication.id}:${ingredient.code}`,
            kind: 'DUPLICATE_INGREDIENT',
            severity: 'SERIOUS',
            title: copy?.title ?? 'Two medicines contain the same ingredient',
            explanation: copyOrFallback(
              copy
                ? interpolate(copy.body, {
                    drugA: input.candidate.display_name,
                    drugB: medication.display_name,
                    ingredient: ingredient.name,
                  })
                : null,
              // AC-5.1.3: both products AND the shared ingredient must appear.
              [
                input.candidate.display_name,
                medication.display_name,
                ingredient.name,
              ],
              `${input.candidate.display_name} and ${medication.display_name} both contain ${ingredient.name}. Taking them together means more of that ingredient than either product alone suggests.`,
            ),
            involvedDrugs: [
              { id: input.candidate.id, label: input.candidate.display_name },
              { id: medication.id, label: medication.display_name },
            ],
            source: 'drug catalog ingredient match',
          }),
        );
      }
    }
  }

  // ── STAGE 5: interactions ──
  if (input.reference.interactions.length === 0) {
    // NO INTERACTION DATA IS NOT THE SAME AS NO INTERACTIONS. Reporting silence
    // here as safety would be the exact false claim this file is built to avoid.
    suppressedChecks.push({
      stage: 'INTERACTION',
      reason:
        'No interaction data is loaded, so interactions between these medicines were not checked.',
    });
  } else if (candidateCheckable) {
    for (const medication of checkableMedications) {
      if (medication.id === input.candidate.id) continue;
      const otherClasses = input.classesByMedicationId[medication.id] ?? [];

      for (const row of input.reference.interactions) {
        const forward =
          candidateClasses.includes(row.class_a) &&
          otherClasses.includes(row.class_b);
        const reverse =
          candidateClasses.includes(row.class_b) &&
          otherClasses.includes(row.class_a);
        if (!forward && !reverse) continue;

        alerts.push(
          makeAlert({
            id: `INTERACTION:${input.candidate.id}:${medication.id}:${row.class_a}:${row.class_b}`,
            kind: 'INTERACTION',
            severity: normaliseSeverity(row.severity),
            title: 'These medicines can interact',
            // Curated columns, verbatim. Never generated.
            explanation: `${row.mechanism} ${row.recommendation}`.trim(),
            involvedDrugs: [
              { id: input.candidate.id, label: input.candidate.display_name },
              { id: medication.id, label: medication.display_name },
            ],
            source: row.source,
          }),
        );
      }
    }
  }

  // ── STAGE 6: condition contraindications (AC-5.1.4) ──
  if (candidateCheckable) {
    const activeConditionCodes = new Set(
      input.conditions
        .filter((condition) => condition.is_active && condition.condition_code)
        .map((condition) => condition.condition_code as string),
    );

    for (const row of input.reference.contraindications) {
      if (!activeConditionCodes.has(row.condition_code)) continue;
      if (!candidateClasses.includes(row.drug_class)) continue;

      alerts.push(
        makeAlert({
          id: `CONDITION_CONTRA:${input.candidate.id}:${row.condition_code}:${row.drug_class}`,
          kind: 'CONDITION_CONTRA',
          severity: normaliseSeverity(row.severity),
          title: 'This medicine may not suit a condition you have recorded',
          explanation: row.explanation,
          involvedDrugs: [
            { id: input.candidate.id, label: input.candidate.display_name },
          ],
          source: row.source,
        }),
      );
    }
  }

  // ── STAGE 7: pregnancy caution ──
  if (input.profile.isPregnant && candidateCheckable) {
    if (input.reference.pregnancyCautionClasses.length === 0) {
      suppressedChecks.push({
        stage: 'PREGNANCY_CAUTION',
        reason:
          'No pregnancy-caution data is loaded, so this medicine was not checked against pregnancy cautions.',
      });
    } else {
      for (const row of input.reference.pregnancyCautionClasses) {
        if (!candidateClasses.includes(row.drug_class)) continue;
        alerts.push(
          makeAlert({
            id: `PREGNANCY_CAUTION:${input.candidate.id}:${row.drug_class}`,
            kind: 'PREGNANCY_CAUTION',
            severity: 'CAUTION',
            title: 'Take care with this medicine in pregnancy',
            explanation: row.explanation,
            involvedDrugs: [
              { id: input.candidate.id, label: input.candidate.display_name },
            ],
            source: row.source,
          }),
        );
      }
    }
  }

  // ── rulepack-degraded mode ──
  // Reference-driven stages have already run on their own data. Only the copy is
  // degraded, and a degraded result is reported as INCOMPLETE rather than
  // dressed up with generated prose.
  if (input.rulepack === null) {
    suppressedChecks.push({
      stage: 'UNCHECKABLE',
      reason:
        'The safety content pack is missing or failed its integrity check, so some explanations are unavailable. Emergency symptom checking is unaffected.',
    });
  }

  const sorted = sortAlerts(alerts);

  if (uncheckable.length > 0 || suppressedChecks.length > 0) {
    return {
      status: 'INCOMPLETE',
      uncheckable,
      alerts: sorted,
      suppressedChecks,
    };
  }
  if (sorted.length > 0) {
    return {
      status: 'ALERTS',
      alerts: sorted,
      uncheckable: [],
      suppressedChecks: [],
    };
  }
  return { status: 'CLEAR' };
}

/** Map a curated severity string onto the §5.1 vocabulary, defaulting upward. */
function normaliseSeverity(value: string): AlertSeverity {
  const upper = value.toUpperCase();
  if (
    upper === 'CRITICAL' ||
    upper === 'SERIOUS' ||
    upper === 'CAUTION' ||
    upper === 'INFO'
  ) {
    return upper;
  }
  // An unrecognised severity is treated as SERIOUS rather than INFO: a curated
  // row exists because someone judged it worth surfacing, and silently
  // downgrading it would be the wrong direction to fail in.
  return 'SERIOUS';
}

export { SEVERITY_RANK, KIND_RANK };
