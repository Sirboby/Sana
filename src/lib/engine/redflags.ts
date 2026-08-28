import { type RedFlagSymptomCode, labelForSymptom } from './redflag-codes';

/**
 * Red-flag evaluation (PRD §2.3, §5.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS COMPILED INTO THE BUNDLE AND MUST NEVER READ THE RULEPACK
 * ─────────────────────────────────────────────────────────────────────────────
 * §5.4: "Compiled into the application bundle — not loaded from the rulepack.
 * Rationale: red-flag detection must survive a corrupt, stale, or missing
 * rulepack (AC-6.1.6). Changing it requires a deploy and a passing safety
 * suite."
 *
 * So this module imports NOTHING but its own symptom vocabulary. No rulepack, no
 * database, no configuration, no network, no async. If a future change makes any
 * rule here configurable at runtime, that change has removed the guarantee this
 * file exists to provide — a rulepack that fails its checksum would then take
 * emergency detection down with it, at the exact moment it matters most.
 * `tests/safety/redflags.safety.test.ts` asserts the absence of such an import.
 *
 * Pure and synchronous by §5.4. Evaluation runs FIRST on every symptom check,
 * before any other logic, and a match terminates the flow.
 */

/** Only EMERGENCY exists here. Other urgency bands are step 12's concern. */
export type RedFlagOutcome = 'EMERGENCY';

export type RedFlagRuleId =
  | 'RF001'
  | 'RF002'
  | 'RF003'
  | 'RF004'
  | 'RF005'
  | 'RF006'
  | 'RF007'
  | 'RF008'
  | 'RF009'
  | 'RF010'
  | 'RF011'
  | 'RF012'
  | 'RF013'
  | 'RF014'
  | 'RF015';

export type ProfileContext = {
  /**
   * ISO date, or null when unknown.
   *
   * A null here does NOT suppress age-scoped rules — see AGE_UNKNOWN below.
   */
  dateOfBirth: string | null;
  isPregnant: boolean;
  /**
   * Measured temperature in Celsius, when one was taken.
   *
   * Lives on the context rather than being a symptom code because RF013 keys on
   * a VALUE (>= 38.0), not on someone's impression of a fever. §5.4 fixes the
   * two-argument signature, so a measurement that qualifies a rule belongs here.
   */
  temperatureCelsius?: number | null;
  /** Reference instant for age, injected so evaluation stays pure and testable. */
  now?: Date;
};

export type RedFlagMatch = {
  ruleId: RedFlagRuleId;
  outcome: RedFlagOutcome;
  /**
   * What was found, in plain language. NEVER a condition name — §2.2
   * prohibition 3 permits urgency and next action only, so this says "chest
   * pain" and never "heart attack".
   */
  concern: string;
  /** The user's own selections that triggered it, for the screen to echo back. */
  matchedSymptoms: RedFlagSymptomCode[];
};

// ─────────────────────────── age bands ───────────────────────────

const INFANT_MAX_AGE_MONTHS = 3;

/**
 * Upper bound for the "child" band used by RF014.
 *
 * §2.3 says "Child profile" without defining it. 12 is chosen as the wider of
 * the plausible readings (5 and 12) because widening over-triages and narrowing
 * under-triages, and severe dehydration is dangerous well past five. Flagged for
 * clinician confirmation in the step 7 handoff — it is a judgement call, not a
 * sourced fact.
 */
const CHILD_MAX_AGE_YEARS = 12;

/**
 * Lower bound for the "adult" band used by RF001.
 *
 * §2.3 scopes chest pain to adults, presumably because chest pain in young
 * children is usually musculoskeletal and firing EMERGENCY on it would
 * over-triage at scale — which §12.2 item 2 warns trains users to dismiss
 * alerts. Also flagged for clinician confirmation.
 */
const ADULT_MIN_AGE_YEARS = 18;

const RF013_TEMPERATURE_THRESHOLD_C = 38.0;

function ageInMonths(profile: ProfileContext): number | null {
  if (profile.dateOfBirth === null) return null;
  const born = new Date(profile.dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  const now = profile.now ?? new Date();
  const months =
    (now.getFullYear() - born.getFullYear()) * 12 +
    (now.getMonth() - born.getMonth());
  return now.getDate() < born.getDate() ? months - 1 : months;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE AGE-UNKNOWN RULE
 * ─────────────────────────────────────────────────────────────────────────────
 * When age is unknown, every age-scoped rule STILL EVALUATES. These helpers
 * return true on a null age deliberately.
 *
 * The failure directions are not symmetric. A missed infant fever is not
 * recoverable; an unnecessary trip to a clinic is. Suppressing an age-scoped
 * rule because a date of birth was never filled in would turn a blank form field
 * into a silent downgrade of emergency detection — and the users most likely to
 * have an incomplete profile are the ones who just installed the app in a hurry,
 * which is exactly when this fires.
 *
 * Do not "optimise" this by treating unknown age as adult, or as not-a-child.
 * `tests/safety/redflags.safety.test.ts` case (d) covers it.
 */
function couldBeInfant(profile: ProfileContext): boolean {
  const months = ageInMonths(profile);
  if (months === null) return true; // age unknown -> do not suppress
  return months < INFANT_MAX_AGE_MONTHS;
}

function couldBeChild(profile: ProfileContext): boolean {
  const months = ageInMonths(profile);
  if (months === null) return true; // age unknown -> do not suppress
  return months < CHILD_MAX_AGE_YEARS * 12;
}

function couldBeAdult(profile: ProfileContext): boolean {
  const months = ageInMonths(profile);
  if (months === null) return true; // age unknown -> do not suppress
  return months >= ADULT_MIN_AGE_YEARS * 12;
}

// ─────────────────────────── the rule table ───────────────────────────

type Rule = {
  id: RedFlagRuleId;
  /** Plain-language finding. Never a condition name (§2.2 prohibition 3). */
  concern: string;
  /** Returns the triggering symptoms, or null when the rule does not fire. */
  match: (
    has: (code: RedFlagSymptomCode) => boolean,
    profile: ProfileContext,
  ) => RedFlagSymptomCode[] | null;
};

/** Helper for "any one of these findings". */
function anyOf(
  has: (code: RedFlagSymptomCode) => boolean,
  codes: RedFlagSymptomCode[],
): RedFlagSymptomCode[] | null {
  const found = codes.filter(has);
  return found.length > 0 ? found : null;
}

/** Helper for "all of these findings" — the conjunctions in §2.3. */
function allOf(
  has: (code: RedFlagSymptomCode) => boolean,
  codes: RedFlagSymptomCode[],
): RedFlagSymptomCode[] | null {
  return codes.every(has) ? [...codes] : null;
}

/**
 * RF001–RF015, transcribed from the §2.3 table.
 *
 * ORDER IS SIGNIFICANT. Evaluation returns the FIRST match by rule id, so the
 * result is deterministic and traceable: the same input always yields the same
 * rule id, even when several rules would match. That matters for §2.5
 * provenance — a recorded escalation has to remain explainable later.
 */
const RULES: Rule[] = [
  {
    id: 'RF001',
    concern: 'Chest pain, pressure or tightness',
    match: (has, profile) =>
      couldBeAdult(profile) ? anyOf(has, ['SYM_CHEST_PAIN']) : null,
  },
  {
    id: 'RF002',
    concern: 'Difficulty breathing at rest',
    match: (has) => anyOf(has, ['SYM_BREATHING_DIFFICULTY']),
  },
  {
    id: 'RF003',
    // FAST. ANY single sign is enough — waiting for all three would mean waiting
    // past the window in which this is treatable.
    concern:
      'Signs of a stroke — face drooping, arm weakness or difficulty speaking',
    match: (has) =>
      anyOf(has, [
        'SYM_FACE_DROOP',
        'SYM_ARM_WEAKNESS',
        'SYM_SPEECH_DIFFICULTY',
      ]),
  },
  {
    id: 'RF004',
    concern: 'Heavy bleeding that will not stop',
    match: (has) => anyOf(has, ['SYM_SEVERE_BLEEDING']),
  },
  {
    id: 'RF005',
    concern: 'Fainting or unresponsiveness',
    match: (has) => anyOf(has, ['SYM_UNRESPONSIVE']),
  },
  {
    id: 'RF006',
    concern: 'A seizure',
    match: (has) => anyOf(has, ['SYM_SEIZURE']),
  },
  {
    id: 'RF007',
    // CONJUNCTION: all three. Fever alone, or fever with a rash, is common and
    // usually not this. Requiring all three is what keeps the alert meaningful.
    concern: 'Fever together with a stiff neck and a rash',
    match: (has) => allOf(has, ['SYM_FEVER', 'SYM_STIFF_NECK', 'SYM_RASH']),
  },
  {
    id: 'RF008',
    // CONJUNCTION per §2.3: "severe abdominal pain WITH a rigid or board-like
    // abdomen". Pain alone is far too common to escalate on.
    concern: 'Severe stomach pain with a hard, board-like abdomen',
    match: (has) => allOf(has, ['SYM_ABDO_PAIN', 'SYM_ABDO_RIGID']),
  },
  {
    id: 'RF009',
    // Facial or throat swelling alone is enough; hives only count alongside
    // breathing difficulty, since hives by themselves are common and not this.
    concern:
      'Swelling of the face or throat, or hives with difficulty breathing',
    match: (has) => {
      if (has('SYM_FACE_SWELLING')) return ['SYM_FACE_SWELLING'];
      if (has('SYM_HIVES') && has('SYM_BREATHING_DIFFICULTY')) {
        return ['SYM_HIVES', 'SYM_BREATHING_DIFFICULTY'];
      }
      return null;
    },
  },
  {
    id: 'RF010',
    concern: 'Thoughts of self-harm or of ending your life',
    match: (has) => anyOf(has, ['SYM_SUICIDAL_IDEATION']),
  },
  {
    id: 'RF011',
    concern: 'Suspected poisoning or too much medicine taken',
    match: (has) => anyOf(has, ['SYM_SUSPECTED_OVERDOSE']),
  },
  {
    id: 'RF012',
    concern: 'A pregnancy warning sign',
    match: (has, profile) =>
      profile.isPregnant
        ? anyOf(has, [
            'SYM_VAGINAL_BLEEDING',
            'SYM_SEVERE_HEADACHE_VISUAL',
            'SYM_REDUCED_FETAL_MOVEMENT',
          ])
        : null,
  },
  {
    id: 'RF013',
    concern: 'A fever in a baby under three months old',
    match: (has, profile) => {
      if (!couldBeInfant(profile)) return null;

      const temperature = profile.temperatureCelsius;
      if (typeof temperature === 'number') {
        return temperature >= RF013_TEMPERATURE_THRESHOLD_C
          ? ['SYM_FEVER']
          : null;
      }

      // No thermometer reading. A reported fever in an infant this young still
      // escalates: most households do not have a thermometer, and requiring a
      // measurement would silently disable this rule for the people it protects.
      return anyOf(has, ['SYM_FEVER']);
    },
  },
  {
    id: 'RF014',
    // ANY single sign, not all four. Each is a recognised danger sign on its
    // own, and a child who has reached all four is already critically unwell.
    // Flagged for clinician confirmation in the handoff.
    concern: 'Signs of severe dehydration in a child',
    match: (has, profile) =>
      couldBeChild(profile)
        ? anyOf(has, [
            'SYM_SUNKEN_EYES',
            'SYM_NO_TEARS',
            'SYM_LETHARGY',
            'SYM_NO_URINE_8H',
          ])
        : null,
  },
  {
    id: 'RF015',
    concern: 'New confusion or a change in alertness',
    match: (has) => anyOf(has, ['SYM_NEW_CONFUSION']),
  },
];

/**
 * Evaluate red flags (§5.4).
 *
 * Pure and synchronous. Returns the first matching rule by id order, or null.
 */
export function evaluateRedFlags(
  symptoms: RedFlagSymptomCode[],
  profile: ProfileContext,
): RedFlagMatch | null {
  const present = new Set(symptoms);
  const has = (code: RedFlagSymptomCode): boolean => present.has(code);

  for (const rule of RULES) {
    const matched = rule.match(has, profile);
    if (matched !== null) {
      return {
        ruleId: rule.id,
        outcome: 'EMERGENCY',
        concern: rule.concern,
        matchedSymptoms: matched,
      };
    }
  }

  return null;
}

/** Every rule id, for the safety suite's completeness check. */
export const RED_FLAG_RULE_IDS: RedFlagRuleId[] = RULES.map((rule) => rule.id);

/** Rule concerns, for the prohibition assertions in §12.2 item 7. */
export function concernForRule(ruleId: RedFlagRuleId): string | null {
  return RULES.find((rule) => rule.id === ruleId)?.concern ?? null;
}

export { labelForSymptom };
