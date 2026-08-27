import { z } from 'zod';

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_VERSION: z.string().min(1).default('1.0.0'),
  NEXT_PUBLIC_RULEPACK_MIN_VERSION: z.string().min(1).default('1.0.0'),
  /**
   * The safety-disclaimer version in force (§2.4, AC-1.2.4). Bumping this
   * invalidates every existing consent and forces re-acceptance, which is the
   * mechanism by which a changed disclaimer actually reaches users.
   */
  NEXT_PUBLIC_DISCLAIMER_VERSION: z.string().min(1).default('1.0.0'),
  SENTRY_DSN: z.string().optional(),
});

/**
 * Treat an empty variable as absent.
 *
 * `FOO=` in a .env file yields `''`, and Zod's `.default()` only fires on
 * `undefined` — so a defaulted variable left blank in a copied .env.example
 * fails validation and takes the whole build down, with an error naming a
 * variable that has a perfectly good default. There is no case in this app where
 * an empty string is a meaningful value distinct from "not set".
 */
function orUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

export const env = clientEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: orUndefined(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: orUndefined(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  NEXT_PUBLIC_APP_VERSION: orUndefined(process.env.NEXT_PUBLIC_APP_VERSION),
  NEXT_PUBLIC_RULEPACK_MIN_VERSION: orUndefined(
    process.env.NEXT_PUBLIC_RULEPACK_MIN_VERSION,
  ),
  NEXT_PUBLIC_DISCLAIMER_VERSION: orUndefined(
    process.env.NEXT_PUBLIC_DISCLAIMER_VERSION,
  ),
  SENTRY_DSN: orUndefined(process.env.SENTRY_DSN),
});

/**
 * Server-only variables live in ./env.server.ts, NOT here.
 *
 * This module is imported by client components, so anything in it ships to the
 * browser. Keeping the service-role schema out means the built client bundle
 * never so much as names that key.
 */
