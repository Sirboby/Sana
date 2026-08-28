import path from 'node:path';
import {
  CACHE_DIR,
  REFERENCE_DIR,
  cachedFetch,
  readCsv,
  writeJson,
} from './lib';

/**
 * Resolve candidate products to RxNorm ingredients (PRD §6.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY RxCUI IS THE INGREDIENT CODE
 * ─────────────────────────────────────────────────────────────────────────────
 * The duplicate-ingredient check (§5.1 stage 4) is the highest-value safety
 * feature in v1, and it works by comparing ingredient IDENTITY across products.
 * That only works if the same substance always yields the same code, whatever
 * the label calls it. RxNorm does exactly this: `paracetamol` and
 * `acetaminophen` both resolve to RxCUI 161. Rolling our own synonym table would
 * mean maintaining a clinical dataset by hand, and every gap in it would be a
 * silent false negative — the failure mode that actually hurts someone.
 *
 * We ask RxNorm for TTY=IN (ingredient) and TTY=PIN (precise ingredient). IN is
 * the normalised form and is what we key on; PIN distinguishes salts, which
 * matters for display but not for duplicate detection — diclofenac sodium and
 * diclofenac potassium are the same active moiety for stacking purposes.
 */

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';
/** RxNav asks for courtesy limits; 20/s is well inside them. */
const RATE_LIMIT_MS = 60;

export type ResolvedIngredient = {
  /** RxCUI of the normalised ingredient (TTY=IN). The identity used for stacking. */
  code: string;
  name: string;
};

export type RxNormResolution = {
  lookupTerm: string;
  rxcui: string | null;
  /** How it resolved, kept so every row's provenance is inspectable. */
  strategy: 'exact' | 'normalized' | 'approximate' | 'unresolved';
  ingredients: ResolvedIngredient[];
  brandNames: string[];
  sourceUrl: string | null;
};

type IdGroup = { idGroup?: { rxnormId?: string[] } };
type RelatedGroup = {
  relatedGroup?: {
    conceptGroup?: {
      tty?: string;
      conceptProperties?: { rxcui: string; name: string }[];
    }[];
  };
};

async function findRxcui(term: string): Promise<{
  rxcui: string;
  strategy: RxNormResolution['strategy'];
  url: string;
} | null> {
  // search=0 exact, search=1 normalised, search=2 both. Try tightest first so a
  // loose match never silently shadows an exact one.
  for (const [search, strategy] of [
    ['0', 'exact'],
    ['1', 'normalized'],
    ['2', 'approximate'],
  ] as const) {
    const url = `${RXNAV}/rxcui.json?name=${encodeURIComponent(term)}&search=${search}`;
    const data = (await cachedFetch(url, {
      rateLimitMs: RATE_LIMIT_MS,
      label: term,
    })) as IdGroup | null;
    const rxcui = data?.idGroup?.rxnormId?.[0];
    if (rxcui) return { rxcui, strategy, url };
  }
  return null;
}

async function fetchIngredients(rxcui: string): Promise<ResolvedIngredient[]> {
  const url = `${RXNAV}/rxcui/${rxcui}/related.json?tty=IN`;
  const data = (await cachedFetch(url, {
    rateLimitMs: RATE_LIMIT_MS,
  })) as RelatedGroup | null;

  const groups = data?.relatedGroup?.conceptGroup ?? [];
  const ingredients: ResolvedIngredient[] = [];
  for (const group of groups) {
    if (group.tty !== 'IN') continue;
    for (const concept of group.conceptProperties ?? []) {
      ingredients.push({
        code: concept.rxcui,
        name: concept.name.toLowerCase(),
      });
    }
  }

  // A concept that IS an ingredient relates to nothing; it is its own ingredient.
  if (ingredients.length === 0) {
    const self = (await cachedFetch(
      `${RXNAV}/rxcui/${rxcui}/property.json?propName=RxNormName`,
      {
        rateLimitMs: RATE_LIMIT_MS,
      },
    )) as {
      propConceptGroup?: { propConcept?: { propValue: string }[] };
    } | null;
    const name = self?.propConceptGroup?.propConcept?.[0]?.propValue;
    if (name) ingredients.push({ code: rxcui, name: name.toLowerCase() });
  }

  return dedupeByCode(ingredients);
}

async function fetchBrandNames(rxcui: string): Promise<string[]> {
  const url = `${RXNAV}/rxcui/${rxcui}/related.json?tty=BN`;
  const data = (await cachedFetch(url, {
    rateLimitMs: RATE_LIMIT_MS,
  })) as RelatedGroup | null;
  const names = new Set<string>();
  for (const group of data?.relatedGroup?.conceptGroup ?? []) {
    if (group.tty !== 'BN') continue;
    for (const concept of group.conceptProperties ?? [])
      names.add(concept.name);
  }
  return [...names].slice(0, 12);
}

function dedupeByCode(items: ResolvedIngredient[]): ResolvedIngredient[] {
  const seen = new Map<string, ResolvedIngredient>();
  for (const item of items) if (!seen.has(item.code)) seen.set(item.code, item);
  return [...seen.values()];
}

export async function resolveTerm(term: string): Promise<RxNormResolution> {
  const found = await findRxcui(term);
  if (!found) {
    return {
      lookupTerm: term,
      rxcui: null,
      strategy: 'unresolved',
      ingredients: [],
      brandNames: [],
      sourceUrl: null,
    };
  }

  const ingredients = await fetchIngredients(found.rxcui);
  const brandNames = await fetchBrandNames(found.rxcui);

  return {
    lookupTerm: term,
    rxcui: found.rxcui,
    strategy: ingredients.length > 0 ? found.strategy : 'unresolved',
    ingredients,
    brandNames,
    sourceUrl: found.url,
  };
}

async function main(): Promise<void> {
  const candidates = readCsv(path.join(REFERENCE_DIR, 'ng-products.csv'));
  const terms = [
    ...new Set(candidates.map((row) => row.lookup_term).filter(Boolean)),
  ] as string[];

  console.log(
    `Resolving ${terms.length} distinct lookup terms against RxNorm...`,
  );
  console.log(`Cache: ${CACHE_DIR}\n`);

  const resolutions: Record<string, RxNormResolution> = {};
  let resolved = 0;

  for (const [index, term] of terms.entries()) {
    const resolution = await resolveTerm(term);
    resolutions[term] = resolution;
    if (resolution.ingredients.length > 0) resolved += 1;
    const mark = resolution.ingredients.length > 0 ? '+' : '!';
    console.log(
      `  ${mark} [${index + 1}/${terms.length}] ${term} -> ${
        resolution.ingredients.map((i) => i.name).join(' + ') || 'UNRESOLVED'
      }`,
    );
  }

  writeJson(path.join(CACHE_DIR, 'rxnorm-resolutions.json'), resolutions);
  console.log(
    `\nResolved ${resolved}/${terms.length} terms to at least one ingredient.`,
  );
}

if (import.meta.main) {
  await main();
}
