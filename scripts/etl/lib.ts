import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Shared ETL plumbing (PRD §6.3).
 *
 * Every clinical fact in the catalog must trace to an authoritative source, so
 * these helpers exist to make that cheap: responses are cached verbatim, and the
 * cache key is part of each row's provenance.
 */

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const REFERENCE_DIR = path.join(ROOT, 'content', 'reference');
export const CACHE_DIR = path.join(REFERENCE_DIR, '.cache');

export function ensureDirs(): void {
  for (const dir of [REFERENCE_DIR, CACHE_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 40);
}

/**
 * Fetch with an on-disk cache.
 *
 * Cached so a re-run costs nothing and cannot be rate-limited into producing a
 * DIFFERENT catalog than the previous run. A build whose output depends on how
 * many requests happened to succeed is not reproducible, and for a drug catalog
 * that means silently losing ingredients between runs.
 */
export async function cachedFetch(
  url: string,
  options: { rateLimitMs?: number; label?: string } = {},
): Promise<unknown | null> {
  ensureDirs();
  const file = path.join(CACHE_DIR, `${cacheKey(url)}.json`);

  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8');
    return raw === 'null' ? null : JSON.parse(raw);
  }

  await sleep(options.rateLimitMs ?? 120);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'sana-etl/1.0 (health app reference build)' },
        signal: AbortSignal.timeout(25_000),
      });

      if (response.status === 404) {
        writeFileSync(file, 'null');
        return null;
      }

      // openFDA allows 240 req/min; 429 means we exceeded it. Back off rather
      // than dropping the row, or the catalog silently shrinks under load.
      if (response.status === 429 || response.status >= 500) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      if (!response.ok) {
        writeFileSync(file, 'null');
        return null;
      }

      const json = await response.json();
      writeFileSync(file, JSON.stringify(json));
      return json;
    } catch {
      await sleep(1000 * 2 ** attempt);
    }
  }

  console.warn(`  ! gave up on ${options.label ?? url}`);
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal CSV reader: quoted fields, `#` comments, header row. */
export function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(file, 'utf8');
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0] as string);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
}

export function writeCsv(
  file: string,
  rows: Record<string, unknown>[],
  header: string[],
): void {
  // Named escapeCell, not escape: the global escape is a deprecated built-in and
  // shadowing it makes this read like the wrong function.
  const escapeCell = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) =>
    header.map((key) => escapeCell(row[key])).join(','),
  );
  const csv = [header.join(','), ...body].join('\n');
  writeFileSync(file, `${csv}\n`, 'utf8');
}

export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}
