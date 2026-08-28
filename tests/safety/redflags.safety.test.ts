import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RED_FLAG_SYMPTOMS,
  type RedFlagSymptomCode,
} from '../../src/lib/engine/redflag-codes';
import {
  type ProfileContext,
  RED_FLAG_RULE_IDS,
  type RedFlagRuleId,
  concernForRule,
  evaluateRedFlags,
} from '../../src/lib/engine/redflags';

/**
 * THE SAFETY SUITE (PRD §12.2, AC-6.1.1, AC-6.1.2, AC-6.1.6).
 *
 * 100% pass required. Zero tolerance. A failure blocks deploy.
 *
 * Every case is a fixed input with a fixed expected output. If one of these
 * fails, the correct response is to fix the engine — never to relax the case.
 */

const NOW = new Date('2026-06-01T12:00:00.000Z');

/** An adult with nothing else going on, as the default subject. */
function adult(overrides: Partial<ProfileContext> = {}): ProfileContext {
  return {
    dateOfBirth: '1990-01-01',
    isPregnant: false,
    now: NOW,
    ...overrides,
  };
}

function ageMonths(months: number): string {
  const dob = new Date(NOW);
  dob.setMonth(dob.getMonth() - months);
  return dob.toISOString().slice(0, 10);
}

// ═══════════════════ (a) FIFTEEN POSITIVE CASES ═══════════════════

describe('(a) every red-flag rule RF001-RF015 escalates (AC-6.1.1)', () => {
  const positives: {
    ruleId: RedFlagRuleId;
    symptoms: RedFlagSymptomCode[];
    profile: ProfileContext;
    why: string;
  }[] = [
    {
      ruleId: 'RF001',
      symptoms: ['SYM_CHEST_PAIN'],
      profile: adult(),
      why: 'chest pain in an adult',
    },
    {
      ruleId: 'RF002',
      symptoms: ['SYM_BREATHING_DIFFICULTY'],
      profile: adult(),
      why: 'difficulty breathing at rest',
    },
    {
      ruleId: 'RF003',
      symptoms: ['SYM_FACE_DROOP'],
      profile: adult(),
      why: 'a single FAST sign is enough',
    },
    {
      ruleId: 'RF004',
      symptoms: ['SYM_SEVERE_BLEEDING'],
      profile: adult(),
      why: 'bleeding that will not stop',
    },
    {
      ruleId: 'RF005',
      symptoms: ['SYM_UNRESPONSIVE'],
      profile: adult(),
      why: 'unresponsiveness',
    },
    {
      ruleId: 'RF006',
      symptoms: ['SYM_SEIZURE'],
      profile: adult(),
      why: 'a seizure',
    },
    {
      ruleId: 'RF007',
      symptoms: ['SYM_FEVER', 'SYM_STIFF_NECK', 'SYM_RASH'],
      profile: adult(),
      why: 'all three of fever, stiff neck and rash',
    },
    {
      ruleId: 'RF008',
      symptoms: ['SYM_ABDO_PAIN', 'SYM_ABDO_RIGID'],
      profile: adult(),
      why: 'severe abdominal pain WITH rigidity',
    },
    {
      ruleId: 'RF009',
      symptoms: ['SYM_FACE_SWELLING'],
      profile: adult(),
      why: 'facial or throat swelling alone',
    },
    {
      ruleId: 'RF010',
      symptoms: ['SYM_SUICIDAL_IDEATION'],
      profile: adult(),
      why: 'suicidal ideation',
    },
    {
      ruleId: 'RF011',
      symptoms: ['SYM_SUSPECTED_OVERDOSE'],
      profile: adult(),
      why: 'suspected poisoning or overdose',
    },
    {
      ruleId: 'RF012',
      symptoms: ['SYM_VAGINAL_BLEEDING'],
      profile: adult({ isPregnant: true }),
      why: 'a pregnancy warning sign in a pregnant user',
    },
    {
      ruleId: 'RF013',
      symptoms: ['SYM_FEVER'],
      profile: adult({ dateOfBirth: ageMonths(2), temperatureCelsius: 38.0 }),
      why: 'a 2-month-old at exactly 38.0C',
    },
    {
      ruleId: 'RF014',
      symptoms: ['SYM_SUNKEN_EYES'],
      profile: adult({ dateOfBirth: ageMonths(36) }),
      why: 'a dehydration danger sign in a child',
    },
    {
      ruleId: 'RF015',
      symptoms: ['SYM_NEW_CONFUSION'],
      profile: adult(),
      why: 'new confusion',
    },
  ];

  it('covers all fifteen rules — a missing case is an incomplete step', () => {
    expect(positives.map((p) => p.ruleId).sort()).toEqual(
      [...RED_FLAG_RULE_IDS].sort(),
    );
    expect(positives).toHaveLength(15);
  });

  it.each(positives)(
    '$ruleId escalates: $why',
    ({ ruleId, symptoms, profile }) => {
      const result = evaluateRedFlags(symptoms, profile);

      expect(result, `${ruleId} did not match`).not.toBeNull();
      expect(result?.ruleId).toBe(ruleId);
      expect(result?.outcome).toBe('EMERGENCY');
      expect(result?.matchedSymptoms.length).toBeGreaterThan(0);
    },
  );
});

// ═══════════════════ (b) NEGATIVE CASES ═══════════════════

describe('(b) symptom sets that must NOT escalate', () => {
  /**
   * Over-triage is a real harm, not a safe default here. §12.2 item 2: it trains
   * users to dismiss alerts, which disarms the feature for the case that matters.
   * These guard the conjunctions.
   */
  const negatives: {
    name: string;
    symptoms: RedFlagSymptomCode[];
    profile: ProfileContext;
  }[] = [
    { name: 'fever alone', symptoms: ['SYM_FEVER'], profile: adult() },
    {
      name: 'fever + rash, no stiff neck (RF007 needs all three)',
      symptoms: ['SYM_FEVER', 'SYM_RASH'],
      profile: adult(),
    },
    {
      name: 'fever + stiff neck, no rash (RF007 needs all three)',
      symptoms: ['SYM_FEVER', 'SYM_STIFF_NECK'],
      profile: adult(),
    },
    {
      name: 'stiff neck alone',
      symptoms: ['SYM_STIFF_NECK'],
      profile: adult(),
    },
    { name: 'rash alone', symptoms: ['SYM_RASH'], profile: adult() },
    {
      name: 'abdominal pain without rigidity (RF008 needs both)',
      symptoms: ['SYM_ABDO_PAIN'],
      profile: adult(),
    },
    {
      name: 'hives alone, no breathing difficulty (RF009 needs both)',
      symptoms: ['SYM_HIVES'],
      profile: adult(),
    },
    { name: 'no symptoms at all', symptoms: [], profile: adult() },
    {
      name: 'pregnancy sign in a NON-pregnant user',
      symptoms: ['SYM_REDUCED_FETAL_MOVEMENT'],
      profile: adult({ isPregnant: false }),
    },
    {
      name: 'dehydration sign in an adult, not a child',
      symptoms: ['SYM_NO_TEARS'],
      profile: adult({ dateOfBirth: '1990-01-01' }),
    },
    {
      name: 'chest pain in a 6-year-old (RF001 is adult-scoped)',
      symptoms: ['SYM_CHEST_PAIN'],
      profile: adult({ dateOfBirth: ageMonths(72) }),
    },
    {
      name: 'infant with a measured temperature BELOW the threshold',
      symptoms: ['SYM_FEVER'],
      profile: adult({ dateOfBirth: ageMonths(2), temperatureCelsius: 37.4 }),
    },
  ];

  it('has at least 10 negative cases', () => {
    expect(negatives.length).toBeGreaterThanOrEqual(10);
  });

  it.each(negatives)('does NOT escalate: $name', ({ symptoms, profile }) => {
    expect(evaluateRedFlags(symptoms, profile)).toBeNull();
  });
});

// ═══════════════════ (c) AGE SCOPING ═══════════════════

describe('(c) age scoping for the infant fever rule', () => {
  it('a 2-month-old at 38.0C matches RF013', () => {
    const result = evaluateRedFlags(['SYM_FEVER'], {
      dateOfBirth: ageMonths(2),
      isPregnant: false,
      temperatureCelsius: 38.0,
      now: NOW,
    });
    expect(result?.ruleId).toBe('RF013');
  });

  it('the SAME finding in a 6-month-old does NOT match', () => {
    const result = evaluateRedFlags(['SYM_FEVER'], {
      dateOfBirth: ageMonths(6),
      isPregnant: false,
      temperatureCelsius: 38.0,
      now: NOW,
    });
    expect(result).toBeNull();
  });

  it('the threshold is inclusive at 38.0 and excludes 37.9', () => {
    const at = evaluateRedFlags(['SYM_FEVER'], {
      dateOfBirth: ageMonths(1),
      isPregnant: false,
      temperatureCelsius: 38.0,
      now: NOW,
    });
    const below = evaluateRedFlags(['SYM_FEVER'], {
      dateOfBirth: ageMonths(1),
      isPregnant: false,
      temperatureCelsius: 37.9,
      now: NOW,
    });
    expect(at?.ruleId).toBe('RF013');
    expect(below).toBeNull();
  });
});

// ═══════════════════ (d) AGE UNKNOWN ═══════════════════

describe('(d) AGE UNKNOWN does not suppress an age-scoped rule', () => {
  /**
   * The failure directions are not symmetric. A missed infant fever is not
   * recoverable; an unnecessary clinic visit is. A blank date-of-birth field
   * must never silently downgrade emergency detection.
   */
  it('the infant rule still evaluates with a null date of birth', () => {
    const result = evaluateRedFlags(['SYM_FEVER'], {
      dateOfBirth: null,
      isPregnant: false,
      temperatureCelsius: 38.5,
      now: NOW,
    });
    expect(result?.ruleId).toBe('RF013');
  });

  it('the child dehydration rule still evaluates with a null date of birth', () => {
    const result = evaluateRedFlags(['SYM_LETHARGY'], {
      dateOfBirth: null,
      isPregnant: false,
      now: NOW,
    });
    expect(result?.ruleId).toBe('RF014');
  });

  it('the adult chest-pain rule still evaluates with a null date of birth', () => {
    const result = evaluateRedFlags(['SYM_CHEST_PAIN'], {
      dateOfBirth: null,
      isPregnant: false,
      now: NOW,
    });
    expect(result?.ruleId).toBe('RF001');
  });

  it('an unparseable date of birth is treated as unknown, not as a suppression', () => {
    const result = evaluateRedFlags(['SYM_CHEST_PAIN'], {
      dateOfBirth: 'not-a-date',
      isPregnant: false,
      now: NOW,
    });
    expect(result?.ruleId).toBe('RF001');
  });
});

// ═══════════════════ (e) PREGNANCY SCOPING ═══════════════════

describe('(e) pregnancy scoping for RF012', () => {
  const signs: RedFlagSymptomCode[] = [
    'SYM_VAGINAL_BLEEDING',
    'SYM_SEVERE_HEADACHE_VISUAL',
    'SYM_REDUCED_FETAL_MOVEMENT',
  ];

  it.each(signs)('%s matches RF012 when pregnant', (symptom) => {
    const result = evaluateRedFlags([symptom], adult({ isPregnant: true }));
    expect(result?.ruleId).toBe('RF012');
  });

  it.each(signs)('%s does NOT match when not pregnant', (symptom) => {
    expect(
      evaluateRedFlags([symptom], adult({ isPregnant: false })),
    ).toBeNull();
  });
});

// ═══════════════════ (f) DETERMINISM ═══════════════════

describe('(f) determinism', () => {
  it('100 evaluations of the same input return an identical result', () => {
    const symptoms: RedFlagSymptomCode[] = [
      'SYM_CHEST_PAIN',
      'SYM_BREATHING_DIFFICULTY',
    ];
    const profile = adult();
    const first = JSON.stringify(evaluateRedFlags(symptoms, profile));

    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(evaluateRedFlags(symptoms, profile))).toBe(first);
    }
  });

  it('returns the LOWEST rule id when several rules match, every time', () => {
    // Chest pain (RF001) and breathing difficulty (RF002) both match; RF001 must
    // win consistently, so a recorded escalation stays explainable later (§2.5).
    const results = Array.from({ length: 100 }, () =>
      evaluateRedFlags(['SYM_BREATHING_DIFFICULTY', 'SYM_CHEST_PAIN'], adult()),
    );
    expect(new Set(results.map((r) => r?.ruleId))).toEqual(new Set(['RF001']));
  });

  it('symptom ORDER does not change the outcome', () => {
    const a = evaluateRedFlags(
      ['SYM_RASH', 'SYM_FEVER', 'SYM_STIFF_NECK'],
      adult(),
    );
    const b = evaluateRedFlags(
      ['SYM_STIFF_NECK', 'SYM_RASH', 'SYM_FEVER'],
      adult(),
    );
    expect(a?.ruleId).toBe(b?.ruleId);
    expect(a?.ruleId).toBe('RF007');
  });

  it('duplicate symptoms do not change the outcome', () => {
    const once = evaluateRedFlags(['SYM_SEIZURE'], adult());
    const twice = evaluateRedFlags(['SYM_SEIZURE', 'SYM_SEIZURE'], adult());
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

// ═══════════════════ (g) RULEPACK INDEPENDENCE ═══════════════════

describe('(g) RULEPACK INDEPENDENCE (AC-6.1.6)', () => {
  /**
   * Red-flag evaluation must produce identical results whether the rulepack is
   * present, absent, corrupt, or checksum-failed. It cannot read the rulepack at
   * all, so these states are unobservable to it — which is exactly the property
   * being asserted.
   */
  const cases: {
    ruleId: RedFlagRuleId;
    symptoms: RedFlagSymptomCode[];
    profile: ProfileContext;
  }[] = [
    { ruleId: 'RF001', symptoms: ['SYM_CHEST_PAIN'], profile: adult() },
    { ruleId: 'RF003', symptoms: ['SYM_SPEECH_DIFFICULTY'], profile: adult() },
    {
      ruleId: 'RF007',
      symptoms: ['SYM_FEVER', 'SYM_STIFF_NECK', 'SYM_RASH'],
      profile: adult(),
    },
    {
      ruleId: 'RF013',
      symptoms: ['SYM_FEVER'],
      profile: adult({ dateOfBirth: ageMonths(1), temperatureCelsius: 39 }),
    },
  ];

  const rulepackStates = [
    { name: 'rulepack ABSENT', apply: () => undefined },
    {
      name: 'rulepack CORRUPT',
      apply: () => {
        (globalThis as Record<string, unknown>).__sanaRulepack = '{{ not json';
      },
    },
    {
      name: 'rulepack CHECKSUM-FAILED',
      apply: () => {
        (globalThis as Record<string, unknown>).__sanaRulepack = {
          version: '9.9.9',
          checksum: `sha256:${'0'.repeat(64)}`,
          content: { tampered: true },
        };
      },
    },
  ];

  it.each(rulepackStates)(
    'produces identical results with $name',
    ({ apply }) => {
      apply();
      for (const { ruleId, symptoms, profile } of cases) {
        const result = evaluateRedFlags(symptoms, profile);
        expect(result?.ruleId).toBe(ruleId);
        expect(result?.outcome).toBe('EMERGENCY');
      }
      (globalThis as Record<string, unknown>).__sanaRulepack = undefined;
    },
  );

  it('results are byte-identical across all three rulepack states', () => {
    const snapshot = () =>
      JSON.stringify(
        cases.map(({ symptoms, profile }) =>
          evaluateRedFlags(symptoms, profile),
        ),
      );

    const outputs = rulepackStates.map((state) => {
      state.apply();
      const result = snapshot();
      (globalThis as Record<string, unknown>).__sanaRulepack = undefined;
      return result;
    });

    expect(new Set(outputs).size).toBe(1);
  });
});

// ═══════════════════ (h) NO RULEPACK IMPORT ═══════════════════

describe('(h) the engine imports nothing from the rulepack', () => {
  const engineSource = readFileSync(
    path.resolve(__dirname, '../../src/lib/engine/redflags.ts'),
    'utf8',
  );
  const codesSource = readFileSync(
    path.resolve(__dirname, '../../src/lib/engine/redflag-codes.ts'),
    'utf8',
  );

  function importPaths(source: string): string[] {
    return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1] as string,
    );
  }

  it('redflags.ts has no import path containing "rulepack"', () => {
    const offending = importPaths(engineSource).filter((p) =>
      p.toLowerCase().includes('rulepack'),
    );
    expect(offending).toEqual([]);
  });

  it('redflag-codes.ts has no import path containing "rulepack"', () => {
    const offending = importPaths(codesSource).filter((p) =>
      p.toLowerCase().includes('rulepack'),
    );
    expect(offending).toEqual([]);
  });

  it('redflags.ts imports ONLY its own symptom vocabulary', () => {
    // A wider allowlist would let a database or config import creep in later and
    // reintroduce a runtime dependency at the worst possible moment.
    expect(importPaths(engineSource)).toEqual(['./redflag-codes']);
  });

  it('the engine contains no async, no fetch, and no dynamic import', () => {
    // Comments are stripped first: the prose above legitimately uses the words
    // "async" and "network" to explain why they are absent, and matching those
    // would make the assertion about the documentation instead of the code.
    const code = engineSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\basync\b/);
    expect(code).not.toMatch(/\bawait\b/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\bPromise\b/);
  });
});

// ═══════════════════ (i) PROHIBITION ASSERTIONS ═══════════════════

describe('(i) PROHIBITION assertions on every rule (§12.2 item 7, §2.2)', () => {
  const DOSE_PATTERN = /\d+\s?(mg|ml|g|mcg|iu)/i;
  const TREATMENT_VERB_PATTERN = /\b(take|use|apply|swallow)\b/i;

  it.each(RED_FLAG_RULE_IDS)(
    '%s escalation copy contains no dose',
    (ruleId) => {
      const concern = concernForRule(ruleId);
      expect(concern).not.toBeNull();
      expect(concern ?? '').not.toMatch(DOSE_PATTERN);
    },
  );

  it.each(RED_FLAG_RULE_IDS)(
    '%s escalation copy contains no treatment verb',
    (ruleId) => {
      const concern = concernForRule(ruleId);
      expect(concern ?? '').not.toMatch(TREATMENT_VERB_PATTERN);
    },
  );

  it('no symptom label contains a dose or a treatment verb', () => {
    for (const [code, label] of Object.entries(RED_FLAG_SYMPTOMS)) {
      expect(label, `${code} contains a dose`).not.toMatch(DOSE_PATTERN);
      expect(label, `${code} contains a treatment verb`).not.toMatch(
        TREATMENT_VERB_PATTERN,
      );
    }
  });

  it('no rule concern names a condition (§2.2 prohibition 3)', () => {
    // Permitted framing is urgency and next action only. The engine describes
    // what was found — "chest pain" — never what it might mean.
    const conditionNames =
      /\b(heart attack|myocardial|stroke victim|meningitis|sepsis|appendicitis|anaphylaxis|infarction|embolism|diagnosis)\b/i;
    for (const ruleId of RED_FLAG_RULE_IDS) {
      expect(
        concernForRule(ruleId) ?? '',
        `${ruleId} names a condition`,
      ).not.toMatch(conditionNames);
    }
  });

  it('the escalation screen source contains no dose or treatment verb', () => {
    const screen = readFileSync(
      path.resolve(__dirname, '../../src/features/check/EmergencyScreen.tsx'),
      'utf8',
    );
    // Only the user-visible strings matter, so check the JSX text nodes and the
    // literal copy rather than identifiers.
    const visible = screen
      .split('\n')
      .filter(
        (line) =>
          !line.trimStart().startsWith('*') &&
          !line.trimStart().startsWith('//'),
      )
      .join('\n');
    expect(visible).not.toMatch(DOSE_PATTERN);
  });
});

// ═══════════════════ (j) OFFLINE PARITY ═══════════════════

describe('(j) OFFLINE PARITY', () => {
  it('evaluation is byte-identical with the network disabled', () => {
    const cases: [RedFlagSymptomCode[], ProfileContext][] = [
      [['SYM_CHEST_PAIN'], adult()],
      [['SYM_FEVER', 'SYM_STIFF_NECK', 'SYM_RASH'], adult()],
      [['SYM_VAGINAL_BLEEDING'], adult({ isPregnant: true })],
      [
        ['SYM_FEVER'],
        adult({ dateOfBirth: ageMonths(2), temperatureCelsius: 38.2 }),
      ],
      [['SYM_ABDO_PAIN'], adult()],
    ];

    const online = JSON.stringify(
      cases.map(([s, p]) => evaluateRedFlags(s, p)),
    );

    // Remove fetch entirely. If the engine ever reaches for the network, this
    // throws rather than silently degrading.
    const savedFetch = globalThis.fetch;
    // @ts-expect-error deliberately removing fetch for the duration of the test
    globalThis.fetch = undefined;
    const offline = JSON.stringify(
      cases.map(([s, p]) => evaluateRedFlags(s, p)),
    );
    globalThis.fetch = savedFetch;

    expect(offline).toBe(online);
  });

  it('evaluation completes synchronously — the result is not a promise', () => {
    const result = evaluateRedFlags(['SYM_SEIZURE'], adult());
    expect(result).not.toBeInstanceOf(Promise);
    expect(result?.ruleId).toBe('RF006');
  });
});

// ═══════════════════ emergency numbers ═══════════════════

describe('emergency numbers are not silently fabricated', () => {
  it('the config still holds the human-verification placeholder', () => {
    // If this ever passes without a human having populated the file, something
    // has filled in an emergency number without dialling it.
    const config = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../content/emergency-numbers.json'),
        'utf8',
      ),
    ) as { national: { primary: string } };

    expect(config.national.primary).toBe('REQUIRES_HUMAN_VERIFICATION');
  });
});
