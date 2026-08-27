import { z } from 'zod';

/**
 * Shared column primitives.
 *
 * These exist so that "a Postgres `date`" and "a Postgres `timestamptz`" have
 * exactly one definition each, rather than a regex copy-pasted across thirteen
 * table schemas that can drift independently.
 *
 * Types are always derived with `z.infer`. Never hand-write an equivalent.
 */

/**
 * ISO-8601 timestamp with an offset (PRD §0: "All timestamps are ISO-8601 UTC
 * strings at rest and in transit"). Postgres `timestamptz`.
 */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/**
 * Calendar date, `YYYY-MM-DD`. Postgres `date` — no time and no zone, which
 * matters for `date_of_birth`: a birthday is not an instant, and coercing it
 * through a timezone is how people's ages end up off by a day.
 */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a calendar date in YYYY-MM-DD form');
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Postgres `text[] not null default '{}'`. */
export const TextArraySchema = z.array(z.string());
export type TextArray = z.infer<typeof TextArraySchema>;

/** Semantic version string, as used by rulepacks and consent versions. */
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Expected a semver string, e.g. 1.0.0');
export type Semver = z.infer<typeof SemverSchema>;

/**
 * `sha256:<64 hex chars>` — the rulepack checksum form used in §7.4 and §8.
 * The client verifies this before applying a pack (AC-6.1.6).
 */
export const Sha256ChecksumSchema = z
  .string()
  .regex(
    /^sha256:[a-f0-9]{64}$/,
    'Expected a checksum of the form sha256:<64 hex chars>',
  );
export type Sha256Checksum = z.infer<typeof Sha256ChecksumSchema>;
