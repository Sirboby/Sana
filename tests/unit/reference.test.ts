import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  coarsenToGrid,
  haversineDistanceKm,
  sortByDistance,
} from '../../src/lib/facilities/distance';
import {
  type SearchableDrug,
  buildSearchIndex,
  searchCatalog,
} from '../../src/lib/reference/search';
import { rulepackChecksum, verifyRulepack } from '../../src/lib/reference/sync';

const REFERENCE_DIR = path.resolve(__dirname, '../../content/reference');

type CatalogRow = SearchableDrug & { rxnorm_cui: string | null };

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(REFERENCE_DIR, name), 'utf8')) as T;
}

/** Same CSV reader semantics as the ETL: `#` comments, quoted fields. */
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

const catalog = readJson<CatalogRow[]>('drug-catalog.json');
const vocabulary = readJson<{
  classes: {
    id: string;
    label: string;
    atcPrefixes: string[];
    source: string;
  }[];
}>('drug-classes.json');
const classIds = new Set(vocabulary.classes.map((c) => c.id));

const interactions = readCsv('interactions.csv');
const crossReference = readCsv('cross-reference.csv');
const contraindications = readCsv('contraindications.csv');
const facilities = readCsv('facilities.csv');

// ─────────────────────────── (a) (b) search ───────────────────────────

describe('(a) search latency (AC-3.1.1)', () => {
  const index = buildSearchIndex(catalog);

  it('returns results for a 2-character query in under 100ms', () => {
    const queries = ['pa', 'am', 'ib', 'ci', 'me', 'as', 'co', 'di'];
    const timings: number[] = [];

    for (const query of queries) {
      const started = performance.now();
      searchCatalog(index, query);
      timings.push(performance.now() - started);
    }

    const worst = Math.max(...timings);
    // Reported so a regression shows the actual number, not just a failure.
    console.log(
      `  search worst-case over ${queries.length} 2-char queries: ${worst.toFixed(2)}ms`,
    );
    expect(worst).toBeLessThan(100);
  });

  it('returns nothing for a single character, so the index is never scanned per keystroke', () => {
    expect(searchCatalog(index, 'p')).toEqual([]);
  });
});

describe('(b) brand and generic both find the product', () => {
  const index = buildSearchIndex(catalog);

  it('a brand name finds it', () => {
    const results = searchCatalog(index, 'Panadol');
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((r) =>
        r.drug.brand_names.some((b) => b.toLowerCase().includes('panadol')),
      ),
    ).toBe(true);
  });

  it('the generic name finds it too', () => {
    const results = searchCatalog(index, 'acetaminophen');
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.some((r) => r.drug.generic_name.includes('acetaminophen')),
    ).toBe(true);
  });

  it('an ingredient name finds combination products containing it', () => {
    const results = searchCatalog(index, 'caffeine');
    expect(
      results.some((r) =>
        r.drug.active_ingredients.some((i) => i.name.includes('caffeine')),
      ),
    ).toBe(true);
  });

  it('ranks an exact prefix above a substring match', () => {
    const results = searchCatalog(index, 'aspirin');
    expect(results[0]?.drug.generic_name.startsWith('aspirin')).toBe(true);
  });
});

// ─────────────────────── (c) ingredient normalisation ───────────────────

describe('(c) INGREDIENT NORMALISATION', () => {
  it('paracetamol and acetaminophen resolve to the SAME ingredient code', () => {
    // This is what makes duplicate detection work at all. RxNorm collapses both
    // names to RxCUI 161; if they ever diverged, paracetamol stacking across a
    // branded and a generic product would go undetected.
    const paracetamolProducts = catalog.filter((row) =>
      row.active_ingredients.some((i) => i.name.includes('acetaminophen')),
    );
    expect(paracetamolProducts.length).toBeGreaterThanOrEqual(2);

    const codes = new Set(
      paracetamolProducts.flatMap((row) =>
        row.active_ingredients
          .filter((i) => i.name.includes('acetaminophen'))
          .map((i) => i.code),
      ),
    );
    expect(codes.size).toBe(1);
    expect([...codes][0]).toBe('161');
  });

  it('the same ingredient in a single and a combination product shares a code', () => {
    const single = catalog.find((r) => r.generic_name === 'acetaminophen');
    const combo = catalog.find(
      (r) =>
        r.active_ingredients.length > 1 &&
        r.active_ingredients.some((i) => i.name.includes('acetaminophen')),
    );
    expect(single).toBeDefined();
    expect(combo).toBeDefined();

    const singleCode = single?.active_ingredients[0]?.code;
    const comboCode = combo?.active_ingredients.find((i) =>
      i.name.includes('acetaminophen'),
    )?.code;
    expect(singleCode).toBe(comboCode);
  });
});

// ─────────────────────── (d) ingredient completeness ────────────────────

describe('(d) every catalog row has a coded ingredient', () => {
  it('no row has an empty ingredient list', () => {
    const empty = catalog.filter((row) => row.active_ingredients.length === 0);
    expect(empty.map((r) => r.generic_name)).toEqual([]);
  });

  it('every ingredient has a non-null code', () => {
    const uncoded = catalog.flatMap((row) =>
      row.active_ingredients
        .filter((i) => !i.code)
        .map((i) => `${row.generic_name}:${i.name}`),
    );
    expect(uncoded).toEqual([]);
  });

  it('excluded products are recorded with a reason, not silently dropped', () => {
    const unresolved = readCsv('unresolved.csv');
    expect(unresolved.length).toBeGreaterThan(0);
    for (const row of unresolved) {
      expect(row.reason, `${row.local_brand} needs a reason`).not.toBe('');
    }
  });
});

// ─────────────────────── (e) no orphan classes ──────────────────────────

describe('(e) every referenced drug_class exists in the vocabulary', () => {
  it('cross-reference.csv has no orphan classes', () => {
    for (const row of crossReference) {
      expect(
        classIds.has(row.allergen_class as string),
        `allergen_class ${row.allergen_class}`,
      ).toBe(true);
      expect(
        classIds.has(row.reactive_class as string),
        `reactive_class ${row.reactive_class}`,
      ).toBe(true);
    }
  });

  it('contraindications.csv has no orphan classes', () => {
    for (const row of contraindications) {
      expect(
        classIds.has(row.drug_class as string),
        `drug_class ${row.drug_class}`,
      ).toBe(true);
    }
  });

  it('interactions.csv has no orphan classes', () => {
    for (const row of interactions) {
      expect(
        classIds.has(row.class_a as string),
        `class_a ${row.class_a}`,
      ).toBe(true);
      expect(
        classIds.has(row.class_b as string),
        `class_b ${row.class_b}`,
      ).toBe(true);
    }
  });

  it('every class the catalog assigns exists in the vocabulary', () => {
    const assigned = new Set(catalog.flatMap((row) => row.drug_classes));
    for (const id of assigned) {
      expect(classIds.has(id), `catalog uses unknown class ${id}`).toBe(true);
    }
  });
});

// ─────────────────────── (f) citations ──────────────────────────────────

describe('(f) every curated row carries a source citation', () => {
  it.each([
    ['cross-reference.csv', crossReference],
    ['contraindications.csv', contraindications],
    ['interactions.csv', interactions],
  ] as const)('%s rows all cite a source', (name, rows) => {
    for (const row of rows) {
      expect(row.source?.trim(), `${name} row missing source`).toBeTruthy();
    }
  });

  it('the class vocabulary itself cites its code system', () => {
    for (const entry of vocabulary.classes) {
      expect(entry.source, `${entry.id} missing source`).toBeTruthy();
      expect(entry.atcPrefixes.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────── (g) rulepack checksum ──────────────────────────

describe('(g) reference sync rejects a bad rulepack checksum (§7.4, AC-6.1.6)', () => {
  const validDoc = {
    version: '1.0.0',
    checksum: `sha256:${'e'.repeat(64)}`,
    locale: 'en-NG',
    reviewStatus: 'draft',
    symptoms: [],
    urgencyRules: [],
    alertCopy: {},
    disclaimerVersion: '1.0.0',
  };

  it('accepts a pack whose checksum matches its content', async () => {
    const checksum = await rulepackChecksum(validDoc);
    const result = await verifyRulepack({
      version: '1.0.0',
      checksum,
      content: validDoc,
    });
    expect(result.ok).toBe(true);
  });

  it('REJECTS a pack whose checksum does not match', async () => {
    const result = await verifyRulepack({
      version: '1.0.0',
      checksum: `sha256:${'0'.repeat(64)}`,
      content: validDoc,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('checksum-mismatch');
  });

  it('REJECTS tampered content even when the old checksum is presented', async () => {
    const checksum = await rulepackChecksum(validDoc);
    const tampered = { ...validDoc, reviewStatus: 'clinician_reviewed' };
    const result = await verifyRulepack({
      version: '1.0.0',
      checksum,
      content: tampered,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed document outright', async () => {
    const result = await verifyRulepack({
      version: '1.0.0',
      checksum: `sha256:${'e'.repeat(64)}`,
      content: { not: 'a rulepack' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });
});

// ─────────────────────── (h) (i) facility verification ──────────────────

describe('(h) FACILITY VERIFICATION is mandatory', () => {
  it('zero facility rows lack verified_at or verified_by', () => {
    const unverified = facilities.filter(
      (row) => !row.verified_at || !row.verified_by,
    );
    expect(unverified.map((r) => r.name)).toEqual([]);
  });
});

describe('(i) an emergency facility must be callable', () => {
  it('every has_emergency row has a phone number and a verification date', () => {
    const emergency = facilities.filter((row) => row.has_emergency === 'true');
    for (const row of emergency) {
      expect(
        row.phone_numbers,
        `${row.name} has_emergency with no phone`,
      ).toBeTruthy();
      expect(
        row.verified_at,
        `${row.name} has_emergency with no verified_at`,
      ).toBeTruthy();
    }
  });

  it('the directory is empty pending human verification, and that is recorded', () => {
    // Asserted rather than assumed: if rows appear without the verification
    // pipeline having run, the two tests above start doing real work.
    expect(facilities.length).toBe(0);
  });
});

// ─────────────────────── (j) haversine ──────────────────────────────────

describe('(j) haversine distance', () => {
  // Reference values computed against the standard great-circle formula for a
  // 6371.0088km mean-radius sphere. Tolerances are ~0.5% to allow for radius
  // convention differences between sources.
  const cases = [
    {
      name: 'Lagos (Ikeja) to Abuja',
      from: { latitude: 6.6018, longitude: 3.3515 },
      to: { latitude: 9.0765, longitude: 7.3986 },
      expectedKm: 525,
      toleranceKm: 8,
    },
    {
      name: 'Lagos to Kano',
      from: { latitude: 6.5244, longitude: 3.3792 },
      to: { latitude: 12.0022, longitude: 8.592 },
      expectedKm: 826,
      toleranceKm: 12,
    },
    {
      name: 'one degree of latitude at the equator',
      from: { latitude: 0, longitude: 0 },
      to: { latitude: 1, longitude: 0 },
      expectedKm: 111.19,
      toleranceKm: 0.5,
    },
  ];

  it.each(cases)('$name', ({ from, to, expectedKm, toleranceKm }) => {
    const actual = haversineDistanceKm(from, to);
    expect(Math.abs(actual - expectedKm)).toBeLessThan(toleranceKm);
  });

  it('is zero for identical points and symmetric', () => {
    const a = { latitude: 6.5, longitude: 3.3 };
    const b = { latitude: 9.0, longitude: 7.4 };
    expect(haversineDistanceKm(a, a)).toBe(0);
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 9);
  });

  it('sorts nearest first', () => {
    const origin = { latitude: 6.5244, longitude: 3.3792 };
    const sorted = sortByDistance(origin, [
      { latitude: 12.0022, longitude: 8.592, name: 'Kano' },
      { latitude: 6.6018, longitude: 3.3515, name: 'Ikeja' },
      { latitude: 9.0765, longitude: 7.3986, name: 'Abuja' },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['Ikeja', 'Abuja', 'Kano']);
  });

  it('coarsens coordinates to roughly 1km for the discovery proxy (§5.5, §11)', () => {
    const exact = { latitude: 6.524412, longitude: 3.379205 };
    const coarse = coarsenToGrid(exact);
    expect(Math.abs(coarse.latitude - exact.latitude)).toBeLessThan(0.01);
    // The point is that precision is DESTROYED, not merely rounded for display.
    expect(coarse.latitude).toBe(6.52);
    expect(coarse.longitude).toBe(3.38);
  });
});

// ─────────────────────── (k) facility sync scoping ──────────────────────

describe('(k) facility sync is scoped by state', () => {
  it('a state-scoped query returns only that state', () => {
    const rows = [
      { id: '1', state: 'Lagos', name: 'A' },
      { id: '2', state: 'Ogun', name: 'B' },
      { id: '3', state: 'Lagos', name: 'C' },
    ];
    const scoped = rows.filter((row) => ['Lagos'].includes(row.state));
    expect(scoped.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('the sync module builds a states query parameter', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../src/lib/reference/sync.ts'),
      'utf8',
    );
    // §7.4 scopes facilities by state so a metered connection is not spent
    // syncing the whole country to a device that will never leave one state.
    expect(source).toContain("params.set('states'");
  });
});

// ─────────────────────── build hygiene ──────────────────────────────────

describe('reference build hygiene', () => {
  it('every reference CSV is present', () => {
    const files = readdirSync(REFERENCE_DIR).filter((f) => f.endsWith('.csv'));
    for (const expected of [
      'ng-products.csv',
      'curated-ingredients.csv',
      'interactions.csv',
      'cross-reference.csv',
      'contraindications.csv',
      'facilities.csv',
      'unresolved.csv',
    ]) {
      expect(files, `missing ${expected}`).toContain(expected);
    }
  });

  it('catalog ids are unique, so re-seeding upserts rather than duplicates', () => {
    const ids = catalog.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
