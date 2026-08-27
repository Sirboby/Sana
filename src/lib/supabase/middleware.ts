import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { currentDisclaimerVersion, hasCurrentConsent } from '../auth/consent';
import { classifyAuthFailure } from '../auth/session';
import { env } from '../env';

/**
 * Route protection and session refresh.
 *
 * Order, per step 6 of the step-5 brief:
 *   unauthenticated                              -> /login
 *   authenticated, no consent for this version   -> /consent
 *   consented, PIN not set / locked              -> /unlock
 *   all satisfied                                -> requested route
 *
 * The PIN stage is NOT decided here. Lock state lives in a module variable in
 * the browser and the wrapped key lives in IndexedDB — neither is visible to
 * middleware, which runs on the server with only cookies. Making the server
 * authoritative for it would mean writing lock state into a cookie, which is
 * both a lie (the server cannot know whether the in-memory key was cleared) and
 * a leak. The client gate in ./route-guard enforces that stage instead.
 */

const PUBLIC_ROUTES = new Set([
  '/',
  '/login',
  '/signup',
  '/recover',
  '/privacy',
  '/terms',
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return pathname.startsWith('/auth/') || pathname.startsWith('/api/auth/');
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const pathname = request.nextUrl.pathname;

  let userId: string | null = null;
  let authFailure: unknown = null;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) authFailure = error;
    userId = data.user?.id ?? null;
  } catch (error) {
    authFailure = error;
  }

  // OFFLINE TOLERANCE. If the auth server could not be reached we do NOT treat
  // the user as signed out. Redirecting to /login here would strand someone with
  // no connection on a page that requires one — see ../auth/session.ts for why
  // the asymmetry favours retaining the session. Let the request through and let
  // the client, which has the cached session and the local data, carry on.
  if (
    authFailure !== null &&
    classifyAuthFailure(authFailure) !== 'unauthenticated'
  ) {
    return response;
  }

  if (isPublic(pathname)) {
    return response;
  }

  if (userId === null) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve where they were headed so sign-in can return them there.
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // /consent and /unlock are themselves authenticated routes, so exempt them
  // from the checks they exist to satisfy — otherwise they redirect to
  // themselves forever.
  if (pathname === '/consent' || pathname === '/unlock') {
    return response;
  }

  const consented = await hasCurrentConsent(
    supabase,
    userId,
    currentDisclaimerVersion(),
  );
  if (!consented) {
    const url = request.nextUrl.clone();
    url.pathname = '/consent';
    return NextResponse.redirect(url);
  }

  return response;
}
