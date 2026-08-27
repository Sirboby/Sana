import { z } from 'zod';

/**
 * SERVER-ONLY environment.
 *
 * Kept in a separate module from ./env.ts on purpose. When the server schema
 * lived alongside the client one, any `'use client'` page that read `env` pulled
 * this whole module into the browser bundle — dead code there, and it put the
 * string "SUPABASE_SERVICE_ROLE_KEY" into shipped JavaScript. The key's VALUE was
 * never included (Next inlines only NEXT_PUBLIC_* vars), so nothing leaked, but
 * a build output that mentions the service-role key at all is a poor place to be
 * standing: the next careless edit is the one that does leak it.
 *
 * Import this only from Route Handlers, Server Components, and middleware.
 */

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function getServerEnv() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'SECURITY ERROR: server-only environment variables were accessed from client-side code.',
    );
  }
  return serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
