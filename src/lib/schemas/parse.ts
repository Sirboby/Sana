import type { z } from 'zod';

/**
 * Validation helpers, so every call site handles a parse failure the same way.
 *
 * Types are inferred from the schema argument — these never take a hand-written
 * type parameter describing a shape that a schema already defines.
 */

/** Thrown by `parseOrThrow`. Carries the underlying `ZodError` for callers that want detail. */
export class SchemaValidationError extends Error {
  readonly issues: z.ZodIssue[];
  readonly context: string;

  constructor(context: string, error: z.ZodError) {
    const summary = error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    super(`${context} failed validation — ${summary}`);
    this.name = 'SchemaValidationError';
    this.issues = error.issues;
    this.context = context;
  }
}

/**
 * Parse, or throw a `SchemaValidationError` naming what was being parsed.
 *
 * Use where invalid data is a programming error rather than an expected input —
 * reading back a row this app itself wrote, for instance.
 */
export function parseOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  context = 'value',
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SchemaValidationError(context, result.error);
  }
  return result.data;
}

/** Discriminated result from `safeParseResult`. */
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SchemaValidationError };

/**
 * Parse without throwing.
 *
 * Use at genuine trust boundaries — a sync response, a user-entered form, a
 * rulepack fetched from the network — where invalid data is a case to handle,
 * not a bug to crash on. Per §7.4 a bad rulepack must be rejected while the app
 * keeps running on the previous one, which is exactly this shape.
 */
export function safeParseResult<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  context = 'value',
): ParseResult<z.infer<TSchema>> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: new SchemaValidationError(context, result.error) };
}
