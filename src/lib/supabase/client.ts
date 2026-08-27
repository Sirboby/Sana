import { createBrowserClient } from '@supabase/ssr';
import { env } from '../env';

/**
 * Browser Supabase client.
 *
 * Uses the ANON key only. The service-role key must never be imported into
 * anything that can reach the client bundle — `getServerEnv()` in ../env.ts
 * throws if it is touched from the browser, and the step 5 gate greps the built
 * output to confirm it never got there.
 */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
