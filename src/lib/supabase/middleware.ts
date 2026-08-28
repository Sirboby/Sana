import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { currentDisclaimerVersion, hasCurrentConsent } from '../auth/consent';
import { hasConsentMarker } from '../auth/consent-marker';
import { decideRoute, isPublicRoute } from '../auth/route-decision';
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

  /**
   * @supabase/ssr names session cookies `sb-<project-ref>-auth-token`, chunked
   * with a `.0`/`.1` suffix when the value is large.
   */
  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name));

  let userId: string | null = null;
  let authFailure: unknown = null;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) authFailure = error;
    userId = data.user?.id ?? null;
  } catch (error) {
    authFailure = error;
  }

  const unreachable =
    authFailure !== null &&
    classifyAuthFailure(authFailure) !== 'unauthenticated';

  const version = currentDisclaimerVersion();

  // The consents lookup is only attempted when it can actually succeed and is
  // actually needed — it is a database round trip on every authenticated request.
  const needsConsentCheck =
    !unreachable &&
    userId !== null &&
    !isPublicRoute(pathname) &&
    pathname !== '/consent' &&
    pathname !== '/unlock';

  const consented =
    needsConsentCheck && userId !== null
      ? await hasCurrentConsent(supabase, userId, version)
      : null;

  const decision = decideRoute({
    pathname,
    hasSessionCookie,
    unreachable,
    userId,
    hasConsentMarker: hasConsentMarker(request, version),
    consented,
  });

  if (decision.action === 'allow') return response;

  const url = request.nextUrl.clone();
  url.pathname = decision.to;
  if (decision.to === '/login') url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}
