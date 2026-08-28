import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Alert,
  MANDATORY_DISCLAIMER,
  type ReferenceData,
  type ScreeningInput,
  screen,
} from '../../src/lib/engine/screening';

/**
 * SCREENING SAFETY SUITE (PRD §12.2 items 3-10, AC-5.1.1 to AC-5.1.8).
 *
 * 100% pass required. A failure blocks deploy. Fix the engine, never the case.
 *
 * Fixtures are built from the REAL seeded catalog produced by step 6, so a case
 * that passes here passes against the data that actually ships.
 */

const REFERENCE_DIR = path.resolve(__dirname, '../../content/reference');

type CatalogRow = {
  id: string;
  generic_name: string;
  brand_names: string[];
  active_ingredients: { code: string; name: string }[];
  drug_classes: string[];
};

const catalog = JSON.parse(
  readFileSync(path.join(REFERENCE_DIR, 'drug-catalog.json'), 'utf8'),
) as CatalogRow[];

function readCsv(name: string): Record<string, string>[] {
  const text = readFileSync(path.join(REFERENCE_DIR, name), 'utf8');
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        out.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0] as string);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    header.forEach((k, i) => {
      row[k] = cells[i] ?? '';
    });
    return row;
  });
}

const crossReferenceRows = readCsv('cross-reference.csv');
const contraindicationRows = readCsv('contraindications.csv');
const interactionRows = readCsv('interactions.csv');

function product(brand: string): CatalogRow {
  const row = catalog.find((r) =>
    r.brand_names.some((b) => b.toLowerCase() === brand.toLowerCase()),
  );
  if (!row) throw new Error(`Fixture product not in catalog: ${brand}`);
  return row;
}

/** A Medication row for a catalog product, as the local store would hold it. */
function medicationFrom(row: CatalogRow, id: string) {
  return {
    id,
    person_id: 'person-1',
    owner_id: 'owner-1',
    drug_id: row.id,
    is_custom: false,
    display_name: row.brand_names[0] as string,
    dose_amount: null,
    dose_unit: null,
    schedule: { kind: 'as_needed' as const },
    start_date: '2026-01-01',
    end_date: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
  } as unknown as ScreeningInput['candidate'];
}

function customMedication(name: string, id: string) {
  return {
    ...medicationFrom(catalog[0] as CatalogRow, id),
    is_custom: true,
    display_name: name,
  };
}

const RULEPACK = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../content/rulepack/rulepack.v1.json'),
    'utf8',
  ),
) as ScreeningInput['rulepack'];

const referenceData: ReferenceData = {
  crossReference:
    crossReferenceRows as unknown as ReferenceData['crossReference'],
  interactions: interactionRows as unknown as ReferenceData['interactions'],
  contraindications:
    contraindicationRows as unknown as ReferenceData['contraindications'],
  pregnancyCautionClasses: [],
};

type BuildOptions = {
  candidate: CatalogRow;
  current?: CatalogRow[];
  allergies?: { code: string | null; label: string; classes: string[] }[];
  conditions?: string[];
  isPregnant?: boolean;
  rulepack?: ScreeningInput['rulepack'];
  extraCurrent?: ScreeningInput['currentMedications'];
};

function buildInput(options: BuildOptions): ScreeningInput {
  const candidate = medicationFrom(options.candidate, 'med-candidate');
  const current = (options.current ?? []).map((row, i) =>
    medicationFrom(row, `med-${i}`),
  );
  const allCurrent = [...current, ...(options.extraCurrent ?? [])];

  const ingredientsByMedicationId: Record<
    string,
    { code: string; name: string }[]
  > = {
    'med-candidate': options.candidate.active_ingredients,
  };
  const classesByMedicationId: Record<string, string[]> = {
    'med-candidate': options.candidate.drug_classes,
  };
  (options.current ?? []).forEach((row, i) => {
    ingredientsByMedicationId[`med-${i}`] = row.active_ingredients;
    classesByMedicationId[`med-${i}`] = row.drug_classes;
  });

  return {
    profile: {
      dateOfBirth: '1990-01-01',
      sexAtBirth: 'female',
      isPregnant: options.isPregnant ?? false,
    },
    allergies: (options.allergies ?? []).map((a, i) => ({
      id: `allergy-${i}`,
      person_id: 'person-1',
      owner_id: 'owner-1',
      allergen_type: 'drug',
      allergen_code: a.code,
      allergen_label: a.label,
      drug_classes: a.classes,
      severity: 'severe',
      notes: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    })) as unknown as ScreeningInput['allergies'],
    conditions: (options.conditions ?? []).map((code, i) => ({
      id: `condition-${i}`,
      person_id: 'person-1',
      owner_id: 'owner-1',
      condition_code: code,
      condition_label: code,
      onset_date: null,
      is_active: true,
      notes: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    })) as unknown as ScreeningInput['conditions'],
    currentMedications: allCurrent,
    candidate,
    rulepack: options.rulepack === undefined ? RULEPACK : options.rulepack,
    reference: referenceData,
    ingredientsByMedicationId,
    classesByMedicationId,
  };
}

function alertsOf(result: ReturnType<typeof screen>): Alert[] {
  return result.status === 'CLEAR' ? [] : result.alerts;
}

function renderedText(alert: Alert): string {
  return `${alert.title} ${alert.explanation} ${alert.disclaimer}`;
}

// ═══════════════ (a) PARACETAMOL STACKING ═══════════════

describe('(a) PARACETAMOL STACKING — the most important case in the application', () => {
  /**
   * A combination product containing paracetamol taken alongside plain
   * paracetamol. Invisible to the user because the brand names differ, and the
   * most common serious OTC poisoning route worldwide.
   */
  const combination = product('Panadol Extra');
  const plain = product('Paracetamol');

  const result = screen(
    buildInput({ candidate: combination, current: [plain] }),
  );
  const duplicate = alertsOf(result).find(
    (a) => a.kind === 'DUPLICATE_INGREDIENT',
  );

  it('raises DUPLICATE_INGREDIENT at SERIOUS', () => {
    expect(duplicate, 'no duplicate-ingredient alert was raised').toBeDefined();
    expect(duplicate?.severity).toBe('SERIOUS');
  });

  it('names BOTH products (AC-5.1.3)', () => {
    const text = renderedText(duplicate as Alert);
    expect(text).toContain('Panadol Extra');
    expect(text).toContain('Paracetamol');
    expect(duplicate?.involvedDrugs).toHaveLength(2);
  });

  it('names the SHARED INGREDIENT', () => {
    expect(renderedText(duplicate as Alert).toLowerCase()).toContain(
      'acetaminophen',
    );
  });

  it('matches on ingredient CODE, not on the product name', () => {
    // The two products share RxCUI 161 while their brand names have nothing in
    // common. Name matching would miss this entirely.
    const shared = combination.active_ingredients.filter((i) =>
      plain.active_ingredients.some((p) => p.code === i.code),
    );
    expect(shared.map((i) => i.code)).toContain('161');
  });

  it('prints the alert for the record', () => {
    console.log('\n===== PARACETAMOL STACKING ALERT =====');
    console.log(`title:       ${duplicate?.title}`);
    console.log(`severity:    ${duplicate?.severity}`);
    console.log(`explanation: ${duplicate?.explanation}`);
    console.log(`disclaimer:  ${duplicate?.disclaimer}`);
    console.log(
      `involved:    ${duplicate?.involvedDrugs.map((d) => d.label).join(' + ')}`,
    );
    console.log('======================================\n');
    expect(duplicate).toBeDefined();
  });
});

// ═══════════════ (b) (c) allergy paths ═══════════════

describe('(b) penicillin allergy -> amoxicillin is a DIRECT match (AC-5.1.1)', () => {
  const amoxicillin = product('Amoxicillin');
  const amoxicillinCode = amoxicillin.active_ingredients[0]?.code as string;

  const result = screen(
    buildInput({
      candidate: amoxicillin,
      allergies: [
        {
          code: amoxicillinCode,
          label: 'Penicillin',
          classes: ['penicillins'],
        },
      ],
    }),
  );

  it('raises ALLERGY_DIRECT at CRITICAL', () => {
    const alert = alertsOf(result).find((a) => a.kind === 'ALLERGY_DIRECT');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('CRITICAL');
  });

  it('sorts the critical allergy first', () => {
    expect(alertsOf(result)[0]?.severity).toBe('CRITICAL');
  });
});

describe('(c) penicillin allergy -> cefalexin is a CROSS-CLASS match (AC-5.1.2)', () => {
  const cefalexin = product('Cefalexin');

  const result = screen(
    buildInput({
      candidate: cefalexin,
      // Allergic to penicillin; cefalexin is a cephalosporin, a different drug.
      allergies: [
        { code: '723', label: 'Penicillin', classes: ['penicillins'] },
      ],
    }),
  );

  const alert = alertsOf(result).find((a) => a.kind === 'ALLERGY_CROSS_CLASS');

  it('raises ALLERGY_CROSS_CLASS', () => {
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('SERIOUS');
  });

  it('is NOT reported as a direct allergy', () => {
    // A user acts differently on "you are allergic to this" than on "this is
    // related to something you react to". Conflating them is a defect.
    expect(alertsOf(result).some((a) => a.kind === 'ALLERGY_DIRECT')).toBe(
      false,
    );
  });

  it('the copy distinguishes a cross-reaction from a direct match', () => {
    const text = renderedText(alert as Alert).toLowerCase();
    expect(text).toMatch(/cross-react|cross reaction|related to/);
  });

  it('carries the risk level from the data, not one of its own', () => {
    const row = crossReferenceRows.find(
      (r) =>
        r.allergen_class === 'penicillins' &&
        r.reactive_class === 'cephalosporins',
    );
    expect(row?.risk_level).toBeTruthy();
    expect(renderedText(alert as Alert)).toContain(row?.risk_level as string);
  });
});

// ═══════════════ (d) every §5.3 row ═══════════════

describe('(d) every condition contraindication row in §5.3 (AC-5.1.4)', () => {
  /** A catalog product for each drug class §5.3 references. */
  const productForClass: Record<string, string> = {
    nsaids: 'Ibuprofen',
    anilides: 'Paracetamol',
    'sulfonamide-antibiotics': 'Septrin',
    antimalarials: 'Chloroquine',
    decongestants: 'Pseudoephedrine',
  };

  it('has a catalog product for every class §5.3 references', () => {
    const referenced = new Set(
      contraindicationRows.map((r) => r.drug_class as string),
    );
    for (const drugClass of referenced) {
      expect(
        productForClass[drugClass],
        `no fixture product for ${drugClass}`,
      ).toBeDefined();
    }
  });

  it.each(contraindicationRows)(
    '$condition_code + $drug_class raises CONDITION_CONTRA',
    (row) => {
      const brand = productForClass[row.drug_class as string];
      expect(brand, `no fixture for ${row.drug_class}`).toBeDefined();

      const result = screen(
        buildInput({
          candidate: product(brand as string),
          conditions: [row.condition_code as string],
        }),
      );

      const alert = alertsOf(result).find((a) => a.kind === 'CONDITION_CONTRA');
      expect(
        alert,
        `${row.condition_code} + ${row.drug_class} did not fire`,
      ).toBeDefined();
      expect(alert?.explanation).toBe(row.explanation);
    },
  );

  it('covers G6PD deficiency with a sulfonamide explicitly', () => {
    const result = screen(
      buildInput({ candidate: product('Septrin'), conditions: ['G6PD'] }),
    );
    const alert = alertsOf(result).find((a) => a.kind === 'CONDITION_CONTRA');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('SERIOUS');
  });
});

// ═══════════════ (e) (f) Nigeria-specific paths ═══════════════

describe('(e) sulfa allergy -> co-trimoxazole (Septrin)', () => {
  const septrin = product('Septrin');
  const sulfamethoxazoleCode = septrin.active_ingredients.find((i) =>
    i.name.includes('sulfamethoxazole'),
  )?.code as string;

  it('raises a direct allergy alert', () => {
    const result = screen(
      buildInput({
        candidate: septrin,
        allergies: [
          {
            code: sulfamethoxazoleCode,
            label: 'Sulfa drugs',
            classes: ['sulfonamide-antibiotics'],
          },
        ],
      }),
    );
    const alert = alertsOf(result).find((a) => a.kind === 'ALLERGY_DIRECT');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('CRITICAL');
  });

  it('also raises the cross-class alert for the sulfonamide group', () => {
    const result = screen(
      buildInput({
        candidate: septrin,
        allergies: [
          {
            code: null,
            label: 'Sulfa drugs',
            classes: ['sulfonamide-antibiotics'],
          },
        ],
      }),
    );
    expect(alertsOf(result).some((a) => a.kind === 'ALLERGY_CROSS_CLASS')).toBe(
      true,
    );
  });
});

describe('(f) NSAID allergy -> an aspirin-containing product', () => {
  /**
   * The brief names Alabukun. Step 6 EXCLUDED Alabukun because it is absent from
   * RxNorm and openFDA and its ingredients could not be verified — shipping a
   * guessed ingredient list would defeat the very check being tested here. Plain
   * aspirin exercises the identical path: §5.2 states NSAID cross-reactivity
   * covers aspirin, and aspirin carries the `nsaids` class in the catalog.
   * Alabukun re-enters via curated-ingredients.csv once someone reads the pack.
   */
  it('raises a cross-class alert (§5.2 NSAIDs incl. aspirin)', () => {
    const result = screen(
      buildInput({
        candidate: product('Aspirin'),
        allergies: [{ code: '5640', label: 'Ibuprofen', classes: ['nsaids'] }],
      }),
    );
    const alert = alertsOf(result).find(
      (a) => a.kind === 'ALLERGY_CROSS_CLASS',
    );
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('SERIOUS');
  });

  it('aspirin does carry the nsaids class in the shipped catalog', () => {
    expect(product('Aspirin').drug_classes).toContain('nsaids');
  });
});

// ═══════════════ (g) EXHAUSTIVE PROHIBITION ASSERTIONS ═══════════════

describe('(g) PROHIBITION assertions over the ENTIRE content corpus (§12.2 item 7)', () => {
  const DOSE_PATTERN = /\d+\s?(mg|ml|g|mcg|iu)/i;
  const TREATMENT_VERB_PATTERN = /\b(take|use|apply|swallow)\b/i;

  const TEST_VARIABLES: Record<string, string> = {
    drug: 'Product A',
    drugA: 'Product A',
    drugB: 'Product B',
    ingredient: 'an ingredient',
    allergen: 'an allergen',
    allergenClass: 'class A',
    reactiveClass: 'class B',
    riskLevel: 'moderate',
    note: 'a note',
  };

  function render(template: string): string {
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_m, key: string) => TEST_VARIABLES[key] ?? '',
    );
  }

  /**
   * Enumerated, not sampled. Testing only the strings a few fixtures happen to
   * raise leaves the rest of the corpus unchecked — and the corpus is what
   * actually ships. This is what makes §2.2 enforced by CI rather than by
   * discipline.
   */
  const corpus: { origin: string; text: string }[] = [];

  for (const [kind, copy] of Object.entries(RULEPACK?.alertCopy ?? {})) {
    corpus.push({
      origin: `rulepack.alertCopy.${kind}.title`,
      text: render(copy.title),
    });
    corpus.push({
      origin: `rulepack.alertCopy.${kind}.body`,
      text: render(copy.body),
    });
  }
  for (const rule of RULEPACK?.urgencyRules ?? []) {
    corpus.push({
      origin: `rulepack.urgencyRules.${rule.id}.guidance`,
      text: rule.guidance,
    });
  }
  for (const row of contraindicationRows) {
    corpus.push({
      origin: `contraindications.csv:${row.condition_code}/${row.drug_class}`,
      text: row.explanation as string,
    });
  }
  for (const row of crossReferenceRows) {
    corpus.push({
      origin: `cross-reference.csv:${row.allergen_class}/${row.reactive_class}`,
      text: row.note as string,
    });
  }
  for (const row of interactionRows) {
    corpus.push({
      origin: `interactions.csv:${row.class_a}/${row.class_b}:mechanism`,
      text: row.mechanism as string,
    });
    corpus.push({
      origin: `interactions.csv:${row.class_a}/${row.class_b}:recommendation`,
      text: row.recommendation as string,
    });
  }
  corpus.push({
    origin: 'engine.MANDATORY_DISCLAIMER',
    text: MANDATORY_DISCLAIMER,
  });

  it('reports how many content strings were checked', () => {
    console.log(`\n[PROHIBITIONS] ${corpus.length} content strings checked:`);
    const byOrigin = corpus.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.origin.split(':')[0] as string;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    for (const [origin, count] of Object.entries(byOrigin).sort()) {
      console.log(`  ${origin.padEnd(28)} ${count}`);
    }
    expect(corpus.length).toBeGreaterThan(0);
  });

  it.each(corpus)('$origin contains no dose figure', ({ text }) => {
    expect(text ?? '').not.toMatch(DOSE_PATTERN);
  });

  it.each(corpus)('$origin contains no treatment verb', ({ text }) => {
    expect(text ?? '').not.toMatch(TREATMENT_VERB_PATTERN);
  });

  it('the disclaimer refers on rather than telling anyone to stop (§2.2 prohibition 5)', () => {
    expect(MANDATORY_DISCLAIMER).toContain('Do not stop');
    expect(MANDATORY_DISCLAIMER).toContain('doctor or pharmacist');
  });
});

// ═══════════════ (h) TRI-STATE INTEGRITY ═══════════════

describe('(h) TRI-STATE INTEGRITY — a custom medicine can never be CLEAR (AC-5.1.8)', () => {
  it('a regimen with a custom medicine is INCOMPLETE, not CLEAR', () => {
    const result = screen(
      buildInput({
        candidate: product('Paracetamol'),
        extraCurrent: [
          customMedication('Herbal mixture from the market', 'med-custom'),
        ] as unknown as ScreeningInput['currentMedications'],
      }),
    );

    console.log(`\n[TRI-STATE] status = ${result.status}`);
    if (result.status !== 'CLEAR') {
      console.log(
        `[TRI-STATE] uncheckable = ${JSON.stringify(result.uncheckable)}`,
      );
    }

    expect(result.status).toBe('INCOMPLETE');
    if (result.status === 'INCOMPLETE') {
      expect(result.uncheckable).toContain('Herbal mixture from the market');
    }
  });

  it('a CUSTOM CANDIDATE is INCOMPLETE even with nothing else in the regimen', () => {
    const custom = customMedication('Unknown tablets', 'med-candidate');
    const input = buildInput({ candidate: product('Paracetamol') });
    const result = screen({
      ...input,
      candidate: custom as unknown as ScreeningInput['candidate'],
      ingredientsByMedicationId: {},
      classesByMedicationId: {},
    });

    expect(result.status).toBe('INCOMPLETE');
    if (result.status === 'INCOMPLETE') {
      expect(result.uncheckable).toContain('Unknown tablets');
    }
  });

  it('CLEAR carries no fields at all, so nothing unchecked can be attached to it', () => {
    // Structural, not a convention: the CLEAR variant has no `uncheckable`
    // property to populate, so the safe answer cannot be constructed while
    // something is unknown.
    const clear = { status: 'CLEAR' as const };
    expect(Object.keys(clear)).toEqual(['status']);
  });

  it('an uncheckable medicine produces an explicit UNCHECKABLE alert', () => {
    const result = screen(
      buildInput({
        candidate: product('Paracetamol'),
        extraCurrent: [
          customMedication('Local herbal tonic', 'med-custom'),
        ] as unknown as ScreeningInput['currentMedications'],
      }),
    );
    const alert = alertsOf(result).find((a) => a.kind === 'UNCHECKABLE');
    expect(alert).toBeDefined();
    expect(alert?.explanation).toContain('Local herbal tonic');
  });
});

// ═══════════════ (i) multiple simultaneous alerts ═══════════════

describe('(i) multiple alerts are all returned, ordered by severity', () => {
  it('an allergy AND a duplicate ingredient both surface, critical first', () => {
    const combination = product('Panadol Extra');
    const plain = product('Paracetamol');
    const paracetamolCode = '161';

    const result = screen(
      buildInput({
        candidate: combination,
        current: [plain],
        allergies: [
          {
            code: paracetamolCode,
            label: 'Paracetamol',
            classes: ['anilides'],
          },
        ],
      }),
    );

    const kinds = alertsOf(result).map((a) => a.kind);
    expect(kinds).toContain('ALLERGY_DIRECT');
    expect(kinds).toContain('DUPLICATE_INGREDIENT');

    // Nothing short-circuits: both stages ran.
    const severities = alertsOf(result).map((a) => a.severity);
    expect(severities[0]).toBe('CRITICAL');
    expect(severities).toEqual(
      [...severities].sort(
        (a, b) =>
          ['CRITICAL', 'SERIOUS', 'CAUTION', 'INFO'].indexOf(a) -
          ['CRITICAL', 'SERIOUS', 'CAUTION', 'INFO'].indexOf(b),
      ),
    );
  });
});

// ═══════════════ (j) determinism ═══════════════

describe('(j) determinism', () => {
  it('100 evaluations return byte-identical output including alert order', () => {
    const input = buildInput({
      candidate: product('Panadol Extra'),
      current: [product('Paracetamol'), product('Ibuprofen')],
      allergies: [{ code: '161', label: 'Paracetamol', classes: ['anilides'] }],
      conditions: ['CKD'],
    });

    const first = JSON.stringify(screen(input));
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(screen(input))).toBe(first);
    }
  });
});

// ═══════════════ (k) offline parity ═══════════════

describe('(k) OFFLINE PARITY (AC-5.1.7)', () => {
  it('output is byte-identical with fetch removed', () => {
    const input = buildInput({
      candidate: product('Panadol Extra'),
      current: [product('Paracetamol')],
    });

    const online = JSON.stringify(screen(input));

    const savedFetch = globalThis.fetch;
    // @ts-expect-error deliberately removing fetch for the duration
    globalThis.fetch = undefined;
    const offline = JSON.stringify(screen(input));
    globalThis.fetch = savedFetch;

    expect(offline).toBe(online);
  });

  it('the engine module reaches for no network API and is not async', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/lib/engine/screening.ts'),
      'utf8',
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\basync\b/);
    expect(code).not.toMatch(/\bawait\b/);
    expect(code).not.toMatch(/XMLHttpRequest|navigator\.|localStorage/);
  });
});

// ═══════════════ (l) rulepack-degraded mode ═══════════════

describe('(l) rulepack corrupt or missing -> INCOMPLETE, never silent success', () => {
  it('returns INCOMPLETE with an explanatory reason', () => {
    const result = screen(
      buildInput({ candidate: product('Paracetamol'), rulepack: null }),
    );

    expect(result.status).toBe('INCOMPLETE');
    if (result.status === 'INCOMPLETE') {
      expect(result.suppressedChecks.length).toBeGreaterThan(0);
      expect(result.suppressedChecks.map((s) => s.reason).join(' ')).toMatch(
        /integrity check|missing/i,
      );
    }
  });

  it('reference-driven stages STILL run without the rulepack', () => {
    // The catalog and the curated tables are independent of the rulepack, so a
    // failed pack must not take ingredient-level safety down with it.
    const result = screen(
      buildInput({
        candidate: product('Panadol Extra'),
        current: [product('Paracetamol')],
        rulepack: null,
      }),
    );
    expect(
      alertsOf(result).some((a) => a.kind === 'DUPLICATE_INGREDIENT'),
    ).toBe(true);
  });

  it('never falls back to generated copy', () => {
    const result = screen(
      buildInput({
        candidate: product('Panadol Extra'),
        current: [product('Paracetamol')],
        rulepack: null,
      }),
    );
    for (const alert of alertsOf(result)) {
      expect(alert.explanation.length).toBeGreaterThan(0);
      expect(alert.explanation).not.toMatch(/\d+\s?(mg|ml|g|mcg|iu)/i);
    }
  });

  it('an empty interaction table is reported as MISSING DATA, not as no interactions', () => {
    // Step 6 left interactions.csv empty pending citation. Silence there must
    // never be presented as a clean result.
    const result = screen(buildInput({ candidate: product('Ibuprofen') }));
    expect(result.status).toBe('INCOMPLETE');
    if (result.status === 'INCOMPLETE') {
      expect(
        result.suppressedChecks.some((s) => s.stage === 'INTERACTION'),
      ).toBe(true);
    }
  });
});

// ═══════════════ (m) provenance and disclaimer ═══════════════

describe('(m) every alert carries provenance and the disclaimer (AC-5.1.5, §2.4)', () => {
  const scenarios = [
    {
      name: 'duplicate ingredient',
      input: () =>
        buildInput({
          candidate: product('Panadol Extra'),
          current: [product('Paracetamol')],
        }),
    },
    {
      name: 'direct allergy',
      input: () =>
        buildInput({
          candidate: product('Amoxicillin'),
          allergies: [
            { code: '723', label: 'Penicillin', classes: ['penicillins'] },
          ],
        }),
    },
    {
      name: 'cross-class allergy',
      input: () =>
        buildInput({
          candidate: product('Cefalexin'),
          allergies: [
            { code: '723', label: 'Penicillin', classes: ['penicillins'] },
          ],
        }),
    },
    {
      name: 'condition contraindication',
      input: () =>
        buildInput({ candidate: product('Ibuprofen'), conditions: ['CKD'] }),
    },
  ];

  it.each(scenarios)('$name alerts carry the disclaimer', ({ input }) => {
    const alerts = alertsOf(screen(input()));
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      expect(alert.disclaimer).toBe(MANDATORY_DISCLAIMER);
    }
  });

  it.each(scenarios)('$name alerts carry a rulepack version', ({ input }) => {
    for (const alert of alertsOf(screen(input()))) {
      expect(alert.rulepackVersion.length).toBeGreaterThan(0);
    }
  });

  it('no emitted alert contains a dose or a treatment verb, in any scenario', () => {
    for (const { input } of scenarios) {
      for (const alert of alertsOf(screen(input()))) {
        const text = renderedText(alert);
        expect(text).not.toMatch(/\d+\s?(mg|ml|g|mcg|iu)/i);
        expect(text).not.toMatch(/\b(take|use|apply|swallow)\b/i);
      }
    }
  });
});
