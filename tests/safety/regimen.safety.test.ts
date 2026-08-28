import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Alert,
  type ReferenceData,
  type RegimenScreeningInput,
  type ScreeningInput,
  screen,
  screenRegimen,
} from '../../src/lib/engine/screening';

/**
 * REGIMEN RE-SCREEN SAFETY SUITE (step 10).
 *
 * The gap: §5.1 screens a candidate against the regimen, which covers the moment
 * a medicine is added. Nothing covered the profile changing AFTERWARDS. These
 * cases are the proof that it now does.
 */

const REFERENCE_DIR = path.resolve(__dirname, '../../content/reference');

type CatalogRow = {
  id: string;
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

const RULEPACK = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../content/rulepack/rulepack.v1.json'),
    'utf8',
  ),
) as ScreeningInput['rulepack'];

const reference: ReferenceData = {
  crossReference: readCsv(
    'cross-reference.csv',
  ) as unknown as ReferenceData['crossReference'],
  interactions: readCsv(
    'interactions.csv',
  ) as unknown as ReferenceData['interactions'],
  contraindications: readCsv(
    'contraindications.csv',
  ) as unknown as ReferenceData['contraindications'],
  pregnancyCautionClasses: [],
};

function product(brand: string): CatalogRow {
  const row = catalog.find((r) =>
    r.brand_names.some((b) => b.toLowerCase() === brand.toLowerCase()),
  );
  if (!row) throw new Error(`Fixture product not in catalog: ${brand}`);
  return row;
}

function medication(
  row: CatalogRow,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    person_id: 'person-1',
    owner_id: 'owner-1',
    drug_id: row.id,
    is_custom: false,
    display_name: row.brand_names[0] as string,
    dose_amount: null,
    dose_unit: null,
    schedule: { kind: 'as_needed' },
    start_date: '2026-01-01',
    end_date: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  } as unknown as RegimenScreeningInput['medications'][number];
}

function buildRegimen(options: {
  products: { row: CatalogRow; id: string }[];
  allergies?: { code: string | null; label: string; classes: string[] }[];
  conditions?: string[];
  extra?: RegimenScreeningInput['medications'];
}): RegimenScreeningInput {
  const medications = options.products.map((p) => medication(p.row, p.id));
  const ingredientsByMedicationId: Record<
    string,
    { code: string; name: string }[]
  > = {};
  const classesByMedicationId: Record<string, string[]> = {};
  for (const p of options.products) {
    ingredientsByMedicationId[p.id] = p.row.active_ingredients;
    classesByMedicationId[p.id] = p.row.drug_classes;
  }

  return {
    profile: {
      dateOfBirth: '1990-01-01',
      sexAtBirth: 'female',
      isPregnant: false,
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
    })) as unknown as RegimenScreeningInput['allergies'],
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
    })) as unknown as RegimenScreeningInput['conditions'],
    medications: [...medications, ...(options.extra ?? [])],
    rulepack: RULEPACK,
    reference,
    ingredientsByMedicationId,
    classesByMedicationId,
  };
}

function alertsOf(result: ReturnType<typeof screenRegimen>): Alert[] {
  return result.status === 'CLEAR' ? [] : result.alerts;
}

// ═══════════════ (e) THE GAP CASE ═══════════════

describe('(e) REGIMEN RE-SCREEN — an allergy recorded AFTER the medicine', () => {
  const amoxicillin = product('Amoxicillin');
  const amoxicillinCode = amoxicillin.active_ingredients[0]?.code as string;

  it('is silent while no allergy is recorded', () => {
    const before = screenRegimen(
      buildRegimen({ products: [{ row: amoxicillin, id: 'med-amox' }] }),
    );
    const allergyAlerts = alertsOf(before).filter((a) =>
      a.kind.startsWith('ALLERGY'),
    );

    console.log('\n[GAP CASE] before the allergy is recorded:');
    console.log(`  status: ${before.status}`);
    console.log(`  allergy alerts: ${allergyAlerts.length}`);

    expect(allergyAlerts).toHaveLength(0);
  });

  it('RAISES ALLERGY_DIRECT once the penicillin allergy is recorded', () => {
    /*
     * This is the whole point. The medicine was saved weeks earlier and screened
     * clean. The allergy arrives later. Without screenRegimen the app holds both
     * facts and never connects them — worse than not holding them, because the
     * user believes they are being checked.
     */
    const after = screenRegimen(
      buildRegimen({
        products: [{ row: amoxicillin, id: 'med-amox' }],
        allergies: [
          {
            code: amoxicillinCode,
            label: 'Penicillin',
            classes: ['penicillins'],
          },
        ],
      }),
    );

    const alert = alertsOf(after).find((a) => a.kind === 'ALLERGY_DIRECT');

    console.log('\n[GAP CASE] after the allergy is recorded:');
    console.log(`  status: ${after.status}`);
    console.log(`  rule fired: ${alert?.kind}`);
    console.log(`  severity: ${alert?.severity}`);
    console.log(`  explanation: ${alert?.explanation}`);
    console.log(
      `  involved: ${alert?.involvedDrugs.map((d) => d.label).join(', ')}\n`,
    );

    expect(alert, 'the existing medication was not re-screened').toBeDefined();
    expect(alert?.severity).toBe('CRITICAL');
    expect(alert?.involvedDrugs.some((d) => d.label === 'Amoxicillin')).toBe(
      true,
    );
  });

  it('also catches it through the CROSS-CLASS path', () => {
    const after = screenRegimen(
      buildRegimen({
        products: [{ row: product('Cefalexin'), id: 'med-cef' }],
        allergies: [
          { code: '723', label: 'Penicillin', classes: ['penicillins'] },
        ],
      }),
    );
    expect(alertsOf(after).some((a) => a.kind === 'ALLERGY_CROSS_CLASS')).toBe(
      true,
    );
  });
});

// ═══════════════ (f) conditions ═══════════════

describe('(f) REGIMEN RE-SCREEN — a condition recorded AFTER the medicine', () => {
  it('raises CONDITION_CONTRA for ibuprofen once a peptic ulcer is recorded', () => {
    const before = screenRegimen(
      buildRegimen({
        products: [{ row: product('Ibuprofen'), id: 'med-ibu' }],
      }),
    );
    expect(alertsOf(before).some((a) => a.kind === 'CONDITION_CONTRA')).toBe(
      false,
    );

    const after = screenRegimen(
      buildRegimen({
        products: [{ row: product('Ibuprofen'), id: 'med-ibu' }],
        conditions: ['PEPTIC_ULCER'],
      }),
    );

    const alert = alertsOf(after).find((a) => a.kind === 'CONDITION_CONTRA');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('SERIOUS');
  });
});

// ═══════════════ (g) tri-state across the regimen ═══════════════

describe('(g) a regimen containing a custom medicine never returns CLEAR', () => {
  it('is INCOMPLETE even when nothing else is flagged', () => {
    const custom = medication(product('Paracetamol'), 'med-custom', {
      is_custom: true,
      display_name: 'Herbal mixture',
    });

    const result = screenRegimen(
      buildRegimen({
        products: [{ row: product('Paracetamol'), id: 'med-para' }],
        extra: [custom],
      }),
    );

    expect(result.status).toBe('INCOMPLETE');
    if (result.status === 'INCOMPLETE') {
      expect(result.uncheckable).toContain('Herbal mixture');
    }
  });
});

// ═══════════════ deduplication ═══════════════

describe('a shared finding is reported ONCE, not once per direction', () => {
  it('deduplicates the duplicate-ingredient pair', () => {
    // Screening A against B and then B against A finds the same shared
    // ingredient twice. Showing the same warning twice teaches the user that
    // warnings are noise.
    const result = screenRegimen(
      buildRegimen({
        products: [
          { row: product('Panadol Extra'), id: 'med-a' },
          { row: product('Paracetamol'), id: 'med-b' },
        ],
      }),
    );

    const duplicates = alertsOf(result).filter(
      (a) => a.kind === 'DUPLICATE_INGREDIENT',
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.involvedDrugs).toHaveLength(2);
  });

  it('still reports genuinely distinct findings separately', () => {
    const result = screenRegimen(
      buildRegimen({
        products: [
          { row: product('Panadol Extra'), id: 'med-a' },
          { row: product('Paracetamol'), id: 'med-b' },
        ],
        conditions: ['LIVER_DISEASE'],
      }),
    );
    const kinds = new Set(alertsOf(result).map((a) => a.kind));
    expect(kinds).toContain('DUPLICATE_INGREDIENT');
    expect(kinds).toContain('CONDITION_CONTRA');
  });
});

// ═══════════════ (h) prohibition assertions on UI copy ═══════════════

describe('(h) PROHIBITIONS over all medication-flow UI copy', () => {
  const DOSE_PATTERN = /\d+\s?(mg|ml|g|mcg|iu)/i;
  const TREATMENT_VERB_PATTERN = /\b(take|use|apply|swallow)\b/i;

  /**
   * Reads the actual component sources and extracts the strings a user could
   * see. Testing only what a fixture happens to render would leave the rest of
   * the copy unchecked — and the copy is what ships.
   */
  function visibleStringsIn(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const strings: string[] = [];
    // JSX text nodes.
    for (const match of withoutComments.matchAll(
      />\s*([A-Z][^<>{}]{12,})\s*</g,
    )) {
      strings.push(match[1] as string);
    }
    // Quoted copy of a sentence-like length.
    for (const match of withoutComments.matchAll(/'([A-Z][^']{15,})'/g)) {
      strings.push(match[1] as string);
    }
    return strings;
  }

  const componentFiles = [
    path.resolve(__dirname, '../../src/components/meds/AlertList.tsx'),
    path.resolve(__dirname, '../../src/components/meds/ScreeningGate.tsx'),
    ...readdirSync(path.resolve(__dirname, '../../src/app/app/meds'), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name)),
  ];

  const corpus = componentFiles.flatMap((file) =>
    visibleStringsIn(file).map((text) => ({ file: path.basename(file), text })),
  );

  it('found UI copy to check', () => {
    console.log(
      `\n[UI PROHIBITIONS] ${corpus.length} visible strings across ${componentFiles.length} files`,
    );
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('no app-authored copy contains a dose figure', () => {
    const offending = corpus.filter((entry) => DOSE_PATTERN.test(entry.text));
    expect(offending.map((e) => `${e.file}: ${e.text}`)).toEqual([]);
  });

  it('no app-authored copy contains a treatment verb', () => {
    const offending = corpus.filter((entry) =>
      TREATMENT_VERB_PATTERN.test(entry.text),
    );
    expect(offending.map((e) => `${e.file}: ${e.text}`)).toEqual([]);
  });

  it('no dose input carries a default value (§2.2 prohibition 2)', () => {
    // A defaulted dose field is a suggested dose, however it is labelled.
    for (const file of componentFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(
        /<input[^>]*name="dose[^"]*"[^>]*>/g,
      )) {
        expect(
          match[0],
          `${path.basename(file)} dose input has a default`,
        ).not.toMatch(/defaultValue|placeholder="\d/);
      }
    }
  });
});
