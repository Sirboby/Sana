import path from 'node:path';
import { Client } from 'pg';
import { REFERENCE_DIR, readCsv, readJson, writeCsv } from './lib';

/**
 * Load reference data into Postgres (PRD §6.1 reference tables).
 *
 * IDEMPOTENT. Every table upserts on its natural key, so a re-run updates rather
 * than duplicates. The ETL is expected to be run repeatedly as curation
 * proceeds, and a seed that duplicated rows would quietly corrupt the catalog
 * that duplicate detection depends on.
 *
 * Facilities are filtered here as well as at authoring time: a row missing
 * verification, or flagged has_emergency with no phone number, is written to
 * unverified-facilities.csv and NOT loaded. The database column is NOT NULL, so
 * an unverified row would fail the insert anyway — this turns that into a clear
 * report rather than a constraint violation.
 */

type CatalogRow = {
  id: string;
  rxnorm_cui: string | null;
  generic_name: string;
  brand_names: string[];
  active_ingredients: {
    code: string;
    name: string;
    strength?: string;
    unit?: string;
  }[];
  drug_classes: string[];
  is_otc: boolean;
  region: string;
};

function loadEnv(): string {
  const file = path.join(REFERENCE_DIR, '..', '..', '.env.local');
  try {
    const text = require('node:fs').readFileSync(file, 'utf8') as string;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // No .env.local; rely on the real environment.
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL is not set. See README "Database Setup".');
    process.exit(1);
  }
  return url;
}

/** Deterministic id so re-seeding a curated CSV row updates the same database row. */
function rowId(seed: string): string {
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

async function main(): Promise<void> {
  const connectionString = loadEnv();
  const local = /@(localhost|127\.0\.0\.1)/.test(connectionString);
  const client = new Client({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  });
  await client.connect();

  const counts: Record<string, number> = {};

  try {
    // ── drug_catalog ──
    const catalog = readJson<CatalogRow[]>(
      path.join(REFERENCE_DIR, 'drug-catalog.json'),
    );
    for (const drug of catalog) {
      await client.query(
        `insert into drug_catalog
           (id, rxnorm_cui, generic_name, brand_names, active_ingredients, drug_classes, is_otc, region)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
         on conflict (id) do update set
           rxnorm_cui = excluded.rxnorm_cui,
           generic_name = excluded.generic_name,
           brand_names = excluded.brand_names,
           active_ingredients = excluded.active_ingredients,
           drug_classes = excluded.drug_classes,
           is_otc = excluded.is_otc,
           updated_at = now()`,
        [
          drug.id,
          drug.rxnorm_cui,
          drug.generic_name,
          drug.brand_names,
          JSON.stringify(drug.active_ingredients),
          drug.drug_classes,
          drug.is_otc,
          drug.region,
        ],
      );
    }
    counts.drug_catalog = catalog.length;

    // ── drug_interactions ──
    const interactions = readCsv(path.join(REFERENCE_DIR, 'interactions.csv'));
    for (const row of interactions) {
      await client.query(
        `insert into drug_interactions
           (id, class_a, class_b, severity, mechanism, recommendation, source, evidence_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (class_a, class_b) do update set
           severity = excluded.severity,
           mechanism = excluded.mechanism,
           recommendation = excluded.recommendation,
           source = excluded.source,
           updated_at = now()`,
        [
          rowId(`interaction:${row.class_a}:${row.class_b}`),
          row.class_a,
          row.class_b,
          row.severity,
          row.mechanism,
          row.recommendation,
          row.source,
          row.evidence_url || null,
        ],
      );
    }
    counts.drug_interactions = interactions.length;

    // ── allergy_cross_reference ──
    const crossRef = readCsv(path.join(REFERENCE_DIR, 'cross-reference.csv'));
    for (const row of crossRef) {
      await client.query(
        `insert into allergy_cross_reference
           (id, allergen_class, reactive_class, risk_level, note, source)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (allergen_class, reactive_class) do update set
           risk_level = excluded.risk_level,
           note = excluded.note,
           source = excluded.source`,
        [
          rowId(`xref:${row.allergen_class}:${row.reactive_class}`),
          row.allergen_class,
          row.reactive_class,
          row.risk_level,
          row.note,
          row.source,
        ],
      );
    }
    counts.allergy_cross_reference = crossRef.length;

    // ── condition_contraindications ──
    const contra = readCsv(path.join(REFERENCE_DIR, 'contraindications.csv'));
    for (const row of contra) {
      await client.query(
        `insert into condition_contraindications
           (id, condition_code, drug_class, severity, explanation, source)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (condition_code, drug_class) do update set
           severity = excluded.severity,
           explanation = excluded.explanation,
           source = excluded.source`,
        [
          rowId(`contra:${row.condition_code}:${row.drug_class}`),
          row.condition_code,
          row.drug_class,
          row.severity,
          row.explanation,
          row.source,
        ],
      );
    }
    counts.condition_contraindications = contra.length;

    // ── facilities, with the verification gate ──
    const facilityRows = readCsv(path.join(REFERENCE_DIR, 'facilities.csv'));
    const rejected: Record<string, string>[] = [];
    let loaded = 0;

    for (const row of facilityRows) {
      const hasEmergency = row.has_emergency === 'true';
      const phones = (row.phone_numbers ?? '').split(/[;|]/).filter(Boolean);

      if (!row.verified_at || !row.verified_by) {
        rejected.push({
          id: row.id ?? '',
          name: row.name ?? '',
          state: row.state ?? '',
          reason: 'missing verified_at or verified_by',
        });
        continue;
      }
      if (hasEmergency && phones.length === 0) {
        // An emergency facility that cannot be phoned is of limited use in the
        // situation it exists for, and its verification cannot be re-checked.
        rejected.push({
          id: row.id ?? '',
          name: row.name ?? '',
          state: row.state ?? '',
          reason: 'has_emergency=true with no phone number',
        });
        continue;
      }

      await client.query(
        `insert into facilities
           (id, facility_type, name, address, state, lga, latitude, longitude,
            phone_numbers, has_emergency, is_24_hours, verified_at, verified_by, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (id) do update set
           name = excluded.name, address = excluded.address,
           phone_numbers = excluded.phone_numbers,
           has_emergency = excluded.has_emergency,
           verified_at = excluded.verified_at, verified_by = excluded.verified_by,
           updated_at = now()`,
        [
          row.id || rowId(`facility:${row.name}:${row.state}`),
          row.facility_type,
          row.name,
          row.address,
          row.state,
          row.lga,
          Number(row.latitude),
          Number(row.longitude),
          phones,
          hasEmergency,
          row.is_24_hours === 'true',
          row.verified_at,
          row.verified_by,
          row.source,
        ],
      );
      loaded += 1;
    }

    counts.facilities = loaded;
    writeCsv(path.join(REFERENCE_DIR, 'unverified-facilities.csv'), rejected, [
      'id',
      'name',
      'state',
      'reason',
    ]);

    console.log('\nRows loaded per table:');
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(30)} ${count}`);
    }
    if (rejected.length > 0) {
      console.log(
        `\n  ${rejected.length} facility row(s) EXCLUDED -> unverified-facilities.csv`,
      );
    }
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  await main();
}
