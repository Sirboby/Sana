import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '../env';
import { getServerEnv } from '../env.server';

/**
 * Server Supabase clients, for Route Handlers and Server Components.
 *
 * SERVER ONLY. Nothing here may be imported from a `'use client'` module.
 */

/** Acts as the signed-in user; every query stays subject to RLS. */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The
            // middleware refreshes the session instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}

/**
 * BYPASSES RLS. Use only where the server must act outside any one user's
 * scope: the first-run bootstrap, the rate limiter, and the recovery audit
 * trail. Every call site should be able to say why RLS could not do the job.
 */
export function createServiceRoleSupabase() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // A service-role client carries no user session, so it sets no cookies.
        },
      },
    },
  );
}
