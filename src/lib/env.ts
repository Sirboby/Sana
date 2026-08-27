import { z } from 'zod';

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_VERSION: z.string().min(1).default('1.0.0'),
  NEXT_PUBLIC_RULEPACK_MIN_VERSION: z.string().min(1).default('1.0.0'),
  SENTRY_DSN: z.string().optional(),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export const env = clientEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  NEXT_PUBLIC_RULEPACK_MIN_VERSION:
    process.env.NEXT_PUBLIC_RULEPACK_MIN_VERSION,
  SENTRY_DSN: process.env.SENTRY_DSN,
});

export function getServerEnv() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'SECURITY ERROR: Attempted to access server-only environment variables (SUPABASE_SERVICE_ROLE_KEY) from a client-side component.',
    );
  }
  return serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
