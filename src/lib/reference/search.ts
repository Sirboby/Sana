import type { DrugCatalog } from '../schemas';

/**
 * Offline catalog search (AC-3.1.1: results within 100ms for 2+ characters).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS IN MEMORY AND SYNCHRONOUS
 * ─────────────────────────────────────────────────────────────────────────────
 * The catalog is a few hundred to a few thousand rows — small enough to hold
 * entirely in memory. Querying Dexie per keystroke would put an async boundary
 * in the render path for no benefit, and async-per-keystroke brings its own bug
 * class: out-of-order responses where a slower query for "pa" resolves after
 * "para" and overwrites the better results with worse ones. A synchronous
 * function cannot do that.
 *
 * The index is built once from the local store and reused. AC-3.1.1 then becomes
 * trivially satisfiable rather than something to tune.
 */

export type SearchableDrug = Pick<
  DrugCatalog,
  'id' | 'generic_name' | 'brand_names' | 'active_ingredients' | 'drug_classes'
>;

export type SearchResult = {
  drug: SearchableDrug;
  /** Higher is better. Exact prefix beats substring. */
  score: number;
  /** Which field matched, for highlighting and for explaining a result. */
  matchedOn: 'generic' | 'brand' | 'ingredient';
};

export type SearchIndex = {
  drugs: SearchableDrug[];
  /** Lowercased haystacks, positionally aligned with `drugs`. */
  entries: {
    generic: string;
    brands: string[];
    ingredients: string[];
  }[];
};

const MIN_QUERY_LENGTH = 2;

/** Score bands, kept apart so a weaker field can never outrank a stronger one. */
const SCORE = {
  genericPrefix: 1000,
  brandPrefix: 900,
  ingredientPrefix: 800,
  genericSubstring: 500,
  brandSubstring: 400,
  ingredientSubstring: 300,
} as const;

export function buildSearchIndex(drugs: SearchableDrug[]): SearchIndex {
  return {
    drugs,
    entries: drugs.map((drug) => ({
      generic: drug.generic_name.toLowerCase(),
      brands: drug.brand_names.map((name) => name.toLowerCase()),
      ingredients: drug.active_ingredients.map((ingredient) =>
        ingredient.name.toLowerCase(),
      ),
    })),
  };
}

/**
 * Search the catalog.
 *
 * Matches generic name, brand names and ingredient names — all three, because a
 * user may know a medicine by any of them. Someone who was handed "Panadol
 * Extra" and someone told to avoid "paracetamol" must both find the same row.
 */
export function searchCatalog(
  index: SearchIndex,
  query: string,
  options: { limit?: number } = {},
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const limit = options.limit ?? 25;
  const results: SearchResult[] = [];

  for (let i = 0; i < index.drugs.length; i += 1) {
    const entry = index.entries[i];
    const drug = index.drugs[i];
    if (!entry || !drug) continue;

    let best = 0;
    let matchedOn: SearchResult['matchedOn'] = 'generic';

    if (entry.generic.startsWith(needle)) {
      best = SCORE.genericPrefix;
      matchedOn = 'generic';
    } else if (entry.brands.some((brand) => brand.startsWith(needle))) {
      best = SCORE.brandPrefix;
      matchedOn = 'brand';
    } else if (entry.ingredients.some((name) => name.startsWith(needle))) {
      best = SCORE.ingredientPrefix;
      matchedOn = 'ingredient';
    } else if (entry.generic.includes(needle)) {
      best = SCORE.genericSubstring;
      matchedOn = 'generic';
    } else if (entry.brands.some((brand) => brand.includes(needle))) {
      best = SCORE.brandSubstring;
      matchedOn = 'brand';
    } else if (entry.ingredients.some((name) => name.includes(needle))) {
      best = SCORE.ingredientSubstring;
      matchedOn = 'ingredient';
    }

    if (best > 0) {
      // Shorter names rank above longer ones at equal band, so "aspirin" beats
      // "aspirin / caffeine" for the query "asp".
      results.push({
        drug,
        score: best - Math.min(entry.generic.length, 99) / 100,
        matchedOn,
      });
    }
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.drug.generic_name.localeCompare(b.drug.generic_name),
  );
  return results.slice(0, limit);
}

/**
 * Every distinct ingredient code in the catalog.
 *
 * Step 8's duplicate-ingredient check compares these codes, so this is here to
 * make it obvious that identity is a CODE and never a name.
 */
export function ingredientCodesFor(drug: SearchableDrug): string[] {
  return drug.active_ingredients.map((ingredient) => ingredient.code);
}
