import path from 'node:path';
import {
  CACHE_DIR,
  REFERENCE_DIR,
  cachedFetch,
  readCsv,
  writeJson,
} from './lib';

/**
 * Pull structured active-ingredient and class data from openFDA labels (§6.3).
 *
 * openFDA is a SECONDARY source here. RxNorm supplies ingredient identity,
 * because its codes are what duplicate detection compares. openFDA adds two
 * things RxNorm does not: strength/unit as printed on a real label, and the
 * pharmacologic class (EPC), which seeds the controlled vocabulary.
 *
 * It indexes US labels, so many Nigerian brands are simply absent — Ampiclox
 * returns NOT_FOUND. That is expected and is not treated as an error; the row
 * keeps its RxNorm ingredients and gains no strength data.
 *
 * Rate limit is 240 req/min without a key. cachedFetch backs off on 429.
 */

const OPENFDA = 'https://api.fda.gov/drug/label.json';
/** 240/min = one per 250ms; 300ms leaves headroom. */
const RATE_LIMIT_MS = 300;

export type OpenFdaFacts = {
  term: string;
  found: boolean;
  activeIngredientText: string[];
  /** Established Pharmacologic Class, e.g. "Nonsteroidal Anti-inflammatory Drug". */
  pharmClassEpc: string[];
  brandNames: string[];
  genericNames: string[];
  sourceUrl: string | null;
};

type LabelResponse = {
  results?: {
    active_ingredient?: string[];
    openfda?: {
      brand_name?: string[];
      generic_name?: string[];
      pharm_class_epc?: string[];
    };
  }[];
};

export async function fetchFacts(term: string): Promise<OpenFdaFacts> {
  // Search generic name first: it is the stable field. Brand search is the
  // fallback for products indexed only under a trade name.
  const queries = [
    `openfda.generic_name:"${term}"`,
    `openfda.brand_name:"${term}"`,
  ];

  for (const query of queries) {
    const url = `${OPENFDA}?search=${encodeURIComponent(query)}&limit=1`;
    const data = (await cachedFetch(url, {
      rateLimitMs: RATE_LIMIT_MS,
      label: term,
    })) as LabelResponse | null;
    const result = data?.results?.[0];
    if (!result) continue;

    return {
      term,
      found: true,
      activeIngredientText: result.active_ingredient ?? [],
      pharmClassEpc: result.openfda?.pharm_class_epc ?? [],
      brandNames: (result.openfda?.brand_name ?? []).slice(0, 10),
      genericNames: (result.openfda?.generic_name ?? []).slice(0, 10),
      sourceUrl: url,
    };
  }

  return {
    term,
    found: false,
    activeIngredientText: [],
    pharmClassEpc: [],
    brandNames: [],
    genericNames: [],
    sourceUrl: null,
  };
}

async function main(): Promise<void> {
  const candidates = readCsv(path.join(REFERENCE_DIR, 'ng-products.csv'));
  const terms = [
    ...new Set(candidates.map((row) => row.lookup_term).filter(Boolean)),
  ] as string[];

  console.log(
    `Querying openFDA for ${terms.length} terms (240 req/min limit)...\n`,
  );

  const facts: Record<string, OpenFdaFacts> = {};
  let found = 0;

  for (const [index, term] of terms.entries()) {
    const result = await fetchFacts(term);
    facts[term] = result;
    if (result.found) found += 1;
    console.log(
      `  ${result.found ? '+' : '-'} [${index + 1}/${terms.length}] ${term}${
        result.pharmClassEpc.length ? ` :: ${result.pharmClassEpc[0]}` : ''
      }`,
    );
  }

  writeJson(path.join(CACHE_DIR, 'openfda-facts.json'), facts);
  console.log(`\nFound labels for ${found}/${terms.length} terms.`);
}

if (import.meta.main) {
  await main();
}
