/**
 * Apply Sana's migrations to a Postgres database over a plain connection.
 *
 * Exists because `supabase db push` needs the Supabase CLI, and `supabase
 * db reset` additionally needs Docker — neither of which is available on every
 * machine this project is developed on. This script needs only `pg`, which is
 * already a dependency of the enum-parity test.
 *
 * Usage:
 *   bun run db:push            # apply pending migrations
 *   bun run db:push --seed     # apply migrations, then run the seed fixture
 *   bun run db:push --dry-run  # report what would be applied, change nothing
 *
 * Reads SUPABASE_DB_URL from the environment or .env.local.
 *
 * MIGRATIONS ARE FORWARD-ONLY. Each applied file's SHA-256 is recorded, and a
 * changed file is a hard error rather than a silent re-apply — editing a
 * migration that has already run is how two databases that ran "the same"
 * migrations end up with different schemas.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const SEED_FILE = path.join(ROOT, 'supabase', 'seed', 'seed.sql');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const WITH_SEED = args.has('--seed');

/** Minimal .env.local reader — avoids a dependency for six lines of parsing. */
function loadEnvFile(): void {
  const file = path.join(ROOT, '.env.local');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isLocal(connectionString: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
}

/** Redact the password so a connection string can be printed safely. */
function redact(connectionString: string): string {
  return connectionString.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

async function main(): Promise<void> {
  loadEnvFile();

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error(
      'SUPABASE_DB_URL is not set.\n' +
        'Add it to .env.local. For a hosted project it is under\n' +
        '  Project Settings -> Database -> Connection string -> URI\n' +
        'For local Supabase it is postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    );
    process.exit(1);
  }

  const local = isLocal(connectionString);
  const client = new Client({
    connectionString,
    // Hosted Supabase requires TLS. `rejectUnauthorized: false` accepts their
    // certificate chain without shipping a CA bundle; this is a schema-migration
    // path carrying no user data, and the alternative is not connecting at all.
    // Set SUPABASE_DB_SSL_STRICT=1 once you have the CA configured.
    ssl: local
      ? undefined
      : { rejectUnauthorized: process.env.SUPABASE_DB_SSL_STRICT === '1' },
    connectionTimeoutMillis: 15_000,
  });

  console.log(`Target: ${redact(connectionString)}`);
  console.log(
    `Mode:   ${DRY_RUN ? 'dry run' : 'apply'}${WITH_SEED ? ' + seed' : ''}\n`,
  );

  await client.connect();

  try {
    await client.query(`
      create table if not exists sana_migrations (
        version     text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )
    `);

    const { rows: applied } = await client.query<{
      version: string;
      checksum: string;
    }>('select version, checksum from sana_migrations');
    const appliedByVersion = new Map(
      applied.map((r) => [r.version, r.checksum]),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;

    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256(sql);
      const previous = appliedByVersion.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `${file} has changed since it was applied to this database.
Migrations are forward-only (step 2 constraint). Do not edit an applied
migration — add a new one instead. If this file was edited before it ever
reached a real database, reset the database rather than forcing it through.`,
          );
        }
        console.log(`  = ${file} (already applied)`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  + ${file} (would apply)`);
        appliedCount += 1;
        continue;
      }

      // The whole file runs as one statement batch inside one transaction, so a
      // migration either lands completely or not at all. Splitting on ';' would
      // break the `do $$ ... $$` block in 009 and the function body in 007.
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into sana_migrations (version, checksum) values ($1, $2)',
          [file, checksum],
        );
        await client.query('commit');
        console.log(`  + ${file}`);
        appliedCount += 1;
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${file} failed to apply: ${(error as Error).message}`);
      }
    }

    console.log(
      appliedCount === 0
        ? '\nNothing to apply — database is up to date.'
        : `\n${DRY_RUN ? 'Would apply' : 'Applied'} ${appliedCount} migration(s).`,
    );

    if (WITH_SEED) {
      if (DRY_RUN) {
        console.log('Would run the seed fixture.');
      } else {
        console.log('\nRunning seed fixture...');
        await client.query(readFileSync(SEED_FILE, 'utf8'));
        console.log('Seed applied.');
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${(error as Error).message}`);
  process.exit(1);
});
