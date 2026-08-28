import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REFERENCE_DIR = path.resolve(__dirname, '../../content/reference');

type CatalogRow = {
  id: string;
  rxnorm_cui: string | null;
  generic_name: string;
  brand_names: string[];
  active_ingredients: { code: string; name: string }[];
  drug_classes: string[];
};

const catalog = JSON.parse(
  readFileSync(path.join(REFERENCE_DIR, 'drug-catalog.json'), 'utf8'),
) as CatalogRow[];

const unresolved = readFileSync(
  path.join(REFERENCE_DIR, 'unresolved.csv'),
  'utf8',
);

function findByBrand(brand: string): CatalogRow | undefined {
  return catalog.find((row) =>
    row.brand_names.some((name) => name.toLowerCase() === brand.toLowerCase()),
  );
}

function ingredientNames(row: CatalogRow): string[] {
  return row.active_ingredients.map((i) => i.name.toLowerCase());
}

/**
 * CONTENT CORRECTNESS spot-checks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS TEST CAN AND CANNOT ASSERT
 * ─────────────────────────────────────────────────────────────────────────────
 * The step 6 brief asks for at least 15 hand-verified products, including three
 * paracetamol COMBINATION products, Alabukun, Ampiclox and Septrin.
 *
 * The catalog is built from RxNorm and openFDA, which index US products.
 * Alabukun, Ampiclox, Coldrex, Procold, P-Alaxin and Fansidar are not in either,
 * so build-catalog.ts EXCLUDED them rather than shipping a guessed or partial
 * ingredient list. Asserting their composition here would mean asserting facts
 * this project has no source for — PRD §0 rule 2 forbids exactly that, and a
 * spot-check test built on invented data would be worse than no spot-check,
 * because it would report content correctness that was never established.
 *
 * So this file asserts two things instead:
 *   1. Every product that IS in the catalog has the ingredients its authoritative
 *      source reports, checked against RxCUI codes rather than name strings.
 *   2. Every product that could NOT be verified is EXCLUDED and recorded — the
 *      catalog must not silently contain it.
 *
 * The second half is the one that matters most. It is what stops the gap being
 * quietly closed by a future change that adds ingredients from memory.
 */

describe('SPOT-CHECK: products in the catalog match their source', () => {
  /**
   * Expected ingredient RxCUIs, each CONFIRMED against RxNorm rather than recalled.
   * The Coartem pair was pinned from memory first and was wrong (74784/351264
   * instead of 18343/847728) — this test caught it, which is the job.
   * Codes rather than names: names drift between labels, codes do not, and a
   * code is what duplicate detection actually compares.
   */
  const expectations: {
    brand: string;
    ingredientCodes: string[];
    classes?: string[];
  }[] = [
    { brand: 'Panadol', ingredientCodes: ['161'], classes: ['anilides'] },
    {
      brand: 'Panadol Extra',
      ingredientCodes: ['161', '1886'],
      classes: ['anilides'],
    },
    { brand: 'Paracetamol', ingredientCodes: ['161'], classes: ['anilides'] },
    {
      brand: 'Emzor Paracetamol',
      ingredientCodes: ['161'],
      classes: ['anilides'],
    },
    {
      brand: 'Amoxicillin',
      ingredientCodes: ['723'],
      classes: ['penicillins'],
    },
    { brand: 'Amoxil', ingredientCodes: ['723'], classes: ['penicillins'] },
    {
      brand: 'Augmentin',
      ingredientCodes: ['723', '48203'],
      classes: ['penicillins'],
    },
    {
      brand: 'Septrin',
      ingredientCodes: ['10180', '10829'],
      classes: ['sulfonamide-antibiotics'],
    },
    {
      brand: 'Co-trimoxazole',
      ingredientCodes: ['10180', '10829'],
      classes: ['sulfonamide-antibiotics'],
    },
    { brand: 'Ibuprofen', ingredientCodes: ['5640'], classes: ['nsaids'] },
    { brand: 'Brufen', ingredientCodes: ['5640'], classes: ['nsaids'] },
    { brand: 'Aspirin', ingredientCodes: ['1191'], classes: ['nsaids'] },
    { brand: 'Diclofenac', ingredientCodes: ['3355'], classes: ['nsaids'] },
    {
      brand: 'Coartem',
      ingredientCodes: ['18343', '847728'],
      classes: ['antimalarials'],
    },
    {
      brand: 'Lonart',
      ingredientCodes: ['18343', '847728'],
      classes: ['antimalarials'],
    },
    {
      brand: 'Ciprofloxacin',
      ingredientCodes: ['2551'],
      classes: ['fluoroquinolones'],
    },
    {
      brand: 'Metronidazole',
      ingredientCodes: ['6922'],
      classes: ['nitroimidazoles'],
    },
    {
      brand: 'Piriton',
      ingredientCodes: ['2400'],
      classes: ['antihistamines'],
    },
    {
      brand: 'Warfarin',
      ingredientCodes: ['11289'],
      classes: ['vitamin-k-antagonists'],
    },
    { brand: 'Metformin', ingredientCodes: ['6809'], classes: ['biguanides'] },
  ];

  it(`covers at least 15 products (${expectations.length} checked)`, () => {
    expect(expectations.length).toBeGreaterThanOrEqual(15);
  });

  it.each(expectations)(
    '$brand has exactly its source ingredients',
    ({ brand, ingredientCodes }) => {
      const row = findByBrand(brand);
      expect(row, `${brand} is missing from the catalog`).toBeDefined();
      if (!row) return;

      const actual = row.active_ingredients.map((i) => i.code).sort();
      expect(actual).toEqual([...ingredientCodes].sort());
    },
  );

  it.each(expectations.filter((e) => e.classes))(
    '$brand carries its expected drug class',
    ({ brand, classes }) => {
      const row = findByBrand(brand);
      expect(row).toBeDefined();
      for (const expected of classes ?? []) {
        expect(
          row?.drug_classes,
          `${brand} should be in class ${expected}`,
        ).toContain(expected);
      }
    },
  );

  it('Septrin and Co-trimoxazole resolve identically — same drug, two names', () => {
    // Load-bearing for both the sulfa allergy check and the G6PD
    // contraindication, so a user who records either name must be screened
    // the same way.
    const septrin = findByBrand('Septrin');
    const cotrimoxazole = findByBrand('Co-trimoxazole');
    expect(septrin?.active_ingredients.map((i) => i.code).sort()).toEqual(
      cotrimoxazole?.active_ingredients.map((i) => i.code).sort(),
    );
    expect(septrin?.drug_classes).toContain('sulfonamide-antibiotics');
  });

  it('every paracetamol product in the catalog shares RxCUI 161', () => {
    const paracetamol = catalog.filter((row) =>
      ingredientNames(row).includes('acetaminophen'),
    );
    expect(paracetamol.length).toBeGreaterThanOrEqual(4);
    for (const row of paracetamol) {
      const code = row.active_ingredients.find(
        (i) => i.name === 'acetaminophen',
      )?.code;
      expect(
        code,
        `${row.brand_names[0]} has a divergent paracetamol code`,
      ).toBe('161');
    }
  });

  it('at least one paracetamol COMBINATION product is present and complete', () => {
    // The combination products are the whole point of the duplicate check: they
    // are what makes paracetamol stacking invisible to the user.
    const combos = catalog.filter(
      (row) =>
        row.active_ingredients.length > 1 &&
        ingredientNames(row).includes('acetaminophen'),
    );
    expect(combos.length).toBeGreaterThanOrEqual(1);
    for (const combo of combos) {
      expect(combo.active_ingredients.every((i) => i.code)).toBe(true);
    }
  });
});

describe('SPOT-CHECK: unverifiable products are EXCLUDED, not guessed', () => {
  /**
   * These are in common Nigerian use and are absent from RxNorm and openFDA.
   * Each must be OUT of the catalog and recorded in unresolved.csv with a reason.
   *
   * If a future change adds them, this test fails — which is the intent. They
   * may only enter via curated-ingredients.csv, signed by someone who read the
   * actual pack, because Nigerian formulations differ from the US and UK
   * products sharing the same brand name.
   */
  const mustBeExcluded = [
    'Alabukun',
    'Ampiclox',
    'Coldrex',
    'Procold',
    'P-Alaxin',
    'Fansidar',
  ];

  it.each(mustBeExcluded)('%s is NOT in the catalog', (brand) => {
    expect(findByBrand(brand)).toBeUndefined();
  });

  it.each(mustBeExcluded)(
    '%s is recorded in unresolved.csv with a reason',
    (brand) => {
      const line = unresolved
        .split('\n')
        .find((l) => l.startsWith(`${brand},`));
      expect(line, `${brand} must be recorded as excluded`).toBeDefined();
      expect(
        line?.split(',')[2],
        `${brand} needs an exclusion reason`,
      ).toBeTruthy();
    },
  );

  it('no catalog row carries a single ingredient when flagged as a combination', () => {
    // The partial-list failure mode: a row that looks complete but is missing an
    // ingredient is indistinguishable from a correct one at the point of use.
    const products = readFileSync(
      path.join(REFERENCE_DIR, 'ng-products.csv'),
      'utf8',
    );
    const combinationBrands = products
      .split('\n')
      .filter((line) => !line.startsWith('#') && line.includes(',yes,'))
      .map((line) => line.split(',')[0] as string);

    for (const brand of combinationBrands) {
      const row = findByBrand(brand);
      if (!row) continue; // correctly excluded
      expect(
        row.active_ingredients.length,
        `${brand} is flagged as a combination but has one ingredient`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
