import path from 'node:path';
import type { OpenFdaFacts } from './fetch-openfda';
import type { RxNormResolution } from './fetch-rxnorm';
import {
  CACHE_DIR,
  REFERENCE_DIR,
  cachedFetch,
  readCsv,
  readJson,
  writeCsv,
  writeJson,
} from './lib';

/**
 * Join RxNorm, openFDA and the candidate list into drug_catalog rows (§6.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO EXCLUSION RULES, BOTH SAFETY RULES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. No resolved ingredients -> EXCLUDED. A product with unknown ingredients is
 *    worse than an absent one: it shows up in search, the user adds it, and the
 *    duplicate check silently passes because there is nothing to compare.
 *
 * 2. Flagged as a combination but resolved to fewer than two ingredients ->
 *    EXCLUDED. This is the subtler and more dangerous case. Fansidar is
 *    sulfadoxine AND pyrimethamine, but the lookup resolves only sulfadoxine, so
 *    the row would look complete while missing an ingredient. A PARTIAL list is
 *    indistinguishable from a full one at the point of use, and it produces
 *    exactly the false negative this catalog exists to prevent.
 *
 * Drug classes come from RxClass ATC per INGREDIENT, never from an openFDA label
 * match. Taking the first matching label produced `lisinopril -> Thiazide
 * Diuretic` and `metformin -> DPP-4 Inhibitor`, because the labels that matched
 * were combination products and the class described the other ingredient.
 */

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';

type ClassVocabulary = {
  version: string;
  classes: {
    id: string;
    label: string;
    atcPrefixes: string[];
    source: string;
  }[];
};

type CatalogRow = {
  id: string;
  rxnorm_cui: string | null;
  nafdac_reg_no: string | null;
  generic_name: string;
  brand_names: string[];
  active_ingredients: {
    code: string;
    name: string;
    strength?: string;
    unit?: string;
  }[];
  drug_classes: string[];
  dosage_form: string | null;
  is_otc: boolean;
  region: string;
  updated_at: string;
  /** Provenance for the build artifact; not a database column. */
  _sources: string[];
};

/** Deterministic id from the lookup key, so re-runs upsert rather than duplicate. */
function stableId(seed: string): string {
  let h1 = 0x9e3779b9;
  let h2 = 0x85ebca6b;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 0xc2b2ae35) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const raw = `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex((h1 + h2) >>> 0)}`;
  const variant = (
    (Number.parseInt(raw[16] as string, 16) & 0x3) |
    0x8
  ).toString(16);
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `4${raw.slice(13, 16)}`,
    `${variant}${raw.slice(17, 20)}`,
    raw.slice(20, 32),
  ].join('-');
}

async function atcCodesFor(rxcui: string): Promise<string[]> {
  const url = `${RXNAV}/rxclass/class/byRxcui.json?rxcui=${rxcui}&relaSource=ATC`;
  const data = (await cachedFetch(url, { rateLimitMs: 60 })) as {
    rxclassDrugInfoList?: {
      rxclassDrugInfo?: { rxclassMinConceptItem?: { classId: string } }[];
    };
  } | null;

  const codes = new Set<string>();
  for (const info of data?.rxclassDrugInfoList?.rxclassDrugInfo ?? []) {
    const id = info.rxclassMinConceptItem?.classId;
    if (id) codes.add(id);
  }
  return [...codes];
}

function classesForAtcCodes(
  codes: string[],
  vocabulary: ClassVocabulary,
): string[] {
  const matched = new Set<string>();
  for (const entry of vocabulary.classes) {
    if (
      codes.some((code) =>
        entry.atcPrefixes.some((prefix) => code.startsWith(prefix)),
      )
    ) {
      matched.add(entry.id);
    }
  }
  return [...matched];
}

/** Pull a "500 mg" style strength out of an openFDA active_ingredient string. */
function parseStrength(text: string): { strength?: string; unit?: string } {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(mg|g|mcg|ml|iu|%)/i);
  if (!match) return {};
  return { strength: match[1], unit: match[2]?.toLowerCase() };
}

async function main(): Promise<void> {
  const candidates = readCsv(path.join(REFERENCE_DIR, 'ng-products.csv'));
  const rxnorm = readJson<Record<string, RxNormResolution>>(
    path.join(CACHE_DIR, 'rxnorm-resolutions.json'),
  );
  const openfda = readJson<Record<string, OpenFdaFacts>>(
    path.join(CACHE_DIR, 'openfda-facts.json'),
  );
  const vocabulary = readJson<ClassVocabulary>(
    path.join(REFERENCE_DIR, 'drug-classes.json'),
  );

  const curatedRows = readCsv(
    path.join(REFERENCE_DIR, 'curated-ingredients.csv'),
  );

  /**
   * Human-verified ingredients, keyed by local brand.
   *
   * Only rows carrying BOTH verified_by and verified_at count. An unsigned row
   * is treated as absent, on the same principle as an unverified facility: an
   * unverified clinical fact must never reach the catalog just because someone
   * typed it into a spreadsheet.
   */
  const curatedByBrand = new Map<
    string,
    { code: string; name: string; strength?: string; unit?: string }[]
  >();
  for (const row of curatedRows) {
    if (!row.verified_by || !row.verified_at) continue;
    if (!row.ingredient_rxcui || !row.ingredient_name) continue;
    const list = curatedByBrand.get(row.local_brand as string) ?? [];
    list.push({
      code: row.ingredient_rxcui as string,
      name: (row.ingredient_name as string).toLowerCase(),
      strength: row.strength || undefined,
      unit: row.unit || undefined,
    });
    curatedByBrand.set(row.local_brand as string, list);
  }

  const atcCache = new Map<string, string[]>();
  const catalog: CatalogRow[] = [];
  const unresolved: Record<string, string>[] = [];

  for (const candidate of candidates) {
    const brand = candidate.local_brand as string;
    const term = candidate.lookup_term as string;
    const isCombination = candidate.combination === 'yes';

    const resolution = rxnorm[term];
    const facts = openfda[term];

    // A human-verified ingredient list WINS over the API lookup. Someone holding
    // the actual pack is a better authority on a Nigerian formulation than a US
    // drug index, and this is the only route by which the products in
    // unresolved.csv can ever enter the catalog.
    const curated = curatedByBrand.get(brand) ?? [];
    const ingredients =
      curated.length > 0 ? curated : (resolution?.ingredients ?? []);
    const provenance = curated.length > 0 ? 'curated-pack-verified' : 'rxnorm';

    if (ingredients.length === 0) {
      unresolved.push({
        local_brand: brand,
        lookup_term: term,
        reason: 'no ingredient resolved from RxNorm',
        detail:
          'Absent from RxNorm, which indexes US products. Needs local curation.',
      });
      continue;
    }

    if (isCombination && ingredients.length < 2) {
      unresolved.push({
        local_brand: brand,
        lookup_term: term,
        reason: 'combination product resolved to a single ingredient',
        detail: `Resolved only ${ingredients
          .map((i) => i.name)
          .join(
            ' and ',
          )}. A partial ingredient list would silently defeat duplicate detection.`,
      });
      continue;
    }

    // Classes are the UNION over ingredients: a combination belongs to every
    // class its components do, which is what the class-level checks in §5.1 need.
    const classes = new Set<string>();
    for (const ingredient of ingredients) {
      if (!atcCache.has(ingredient.code)) {
        atcCache.set(ingredient.code, await atcCodesFor(ingredient.code));
      }
      for (const id of classesForAtcCodes(
        atcCache.get(ingredient.code) ?? [],
        vocabulary,
      )) {
        classes.add(id);
      }
    }

    const strengthByName = new Map<
      string,
      { strength?: string; unit?: string }
    >();
    for (const text of facts?.activeIngredientText ?? []) {
      for (const ingredient of ingredients) {
        if (text.toLowerCase().includes(ingredient.name)) {
          strengthByName.set(ingredient.name, parseStrength(text));
        }
      }
    }

    const brandNames = [
      ...new Set([brand, ...(resolution?.brandNames ?? [])]),
    ].filter(Boolean);

    catalog.push({
      id: stableId(`${term}::${brand}`),
      rxnorm_cui: resolution?.rxcui ?? null,
      nafdac_reg_no: null,
      generic_name: ingredients.map((i) => i.name).join(' / '),
      brand_names: brandNames,
      active_ingredients: ingredients.map((ingredient) => ({
        code: ingredient.code,
        name: ingredient.name,
        ...strengthByName.get(ingredient.name),
      })),
      drug_classes: [...classes].sort(),
      dosage_form: null,
      is_otc: false,
      region: 'NG',
      updated_at: new Date().toISOString(),
      _sources: [provenance, resolution?.sourceUrl, facts?.sourceUrl].filter(
        Boolean,
      ) as string[],
    });
  }

  writeJson(path.join(REFERENCE_DIR, 'drug-catalog.json'), catalog);
  writeCsv(path.join(REFERENCE_DIR, 'unresolved.csv'), unresolved, [
    'local_brand',
    'lookup_term',
    'reason',
    'detail',
  ]);

  const classless = catalog.filter((row) => row.drug_classes.length === 0);
  const allCoded = catalog.every(
    (row) =>
      row.active_ingredients.length > 0 &&
      row.active_ingredients.every((i) => i.code),
  );

  console.log(`\nCatalog rows:        ${catalog.length}`);
  console.log(`Excluded:            ${unresolved.length}  -> unresolved.csv`);
  console.log(`Rows with no class:  ${classless.length}`);
  if (classless.length > 0) {
    console.log(`  ${classless.map((r) => r.generic_name).join(', ')}`);
  }
  console.log(`Every row has a coded ingredient: ${allCoded}`);
}

if (import.meta.main) {
  await main();
}
