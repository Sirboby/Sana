/**
 * The route-protection decision, as a pure function.
 *
 * Extracted from the middleware so it can be tested exhaustively without a
 * request, a network, or a Supabase instance. The bug this replaced — offline
 * tolerance being extended to requests with NO session, letting an
 * unauthenticated visitor past both the auth gate and the consent gate whenever
 * the auth server was unreachable — was invisible to every test that existed,
 * because the only thing exercising it was an end-to-end spec that could not run.
 *
 * Order (step 5 brief):
 *   unauthenticated                            -> /login
 *   authenticated, no consent for this version -> /consent
 *   otherwise                                  -> through
 *
 * The PIN stage is deliberately absent: lock state lives in a module variable in
 * the browser and the wrapped key in IndexedDB, neither visible to the server.
 */

export const PUBLIC_ROUTES = new Set([
  '/',
  '/login',
  '/signup',
  '/recover',
  '/privacy',
  '/terms',
]);

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  // Test harness routes for step 7's escalation screen. Reachable ONLY outside
  // production: the page itself returns 404 in production, and this keeps the
  // auth gate closed there even if that guard were ever removed.
  if (process.env.NODE_ENV !== 'production' && pathname.startsWith('/dev/')) {
    return true;
  }
  return pathname.startsWith('/auth/') || pathname.startsWith('/api/auth/');
}

export type RouteInputs = {
  pathname: string;
  /** A Supabase auth cookie is present on the request. */
  hasSessionCookie: boolean;
  /** The auth server could not be reached, so the token could not be revalidated. */
  unreachable: boolean;
  /** Resolved user id, when the auth server did answer. */
  userId: string | null;
  /** Consent marker cookie matches the current disclaimer version. */
  hasConsentMarker: boolean;
  /**
   * Result of the consents lookup, when it could run at all.
   * `null` means it was not attempted (unreachable, or not needed).
   */
  consented: boolean | null;
};

export type RouteDecision =
  | { action: 'allow' }
  | { action: 'redirect'; to: '/login' | '/consent'; reason: string };

export function decideRoute(input: RouteInputs): RouteDecision {
  const {
    pathname,
    hasSessionCookie,
    unreachable,
    userId,
    hasConsentMarker,
    consented,
  } = input;

  // Being offline does not make anyone signed in. A request with no session and
  // no way to check one is simply signed out, and gets the signed-out treatment.
  if (unreachable && !hasSessionCookie) {
    return isPublicRoute(pathname)
      ? { action: 'allow' }
      : {
          action: 'redirect',
          to: '/login',
          reason: 'no-session-and-unreachable',
        };
  }

  if (isPublicRoute(pathname)) return { action: 'allow' };

  if (!unreachable && userId === null) {
    return { action: 'redirect', to: '/login', reason: 'unauthenticated' };
  }

  // These two ARE authenticated routes, so they must be exempt from the checks
  // they exist to satisfy, or they redirect to themselves forever.
  if (pathname === '/consent' || pathname === '/unlock')
    return { action: 'allow' };

  // Offline with a session: the consents table cannot be read, so fall back to
  // the marker cookie written server-side after a successful consent row.
  // Bouncing a long-since-consented user to /consent — a screen that cannot
  // record anything offline — would make the app unusable without a connection.
  if (unreachable) {
    return hasConsentMarker
      ? { action: 'allow' }
      : {
          action: 'redirect',
          to: '/consent',
          reason: 'offline-without-consent-marker',
        };
  }

  // The check ran and said no, or could not be trusted. Fail closed: an extra
  // consent screen costs a tap, whereas failing open shows clinical guidance to
  // someone who never saw the disclaimer.
  if (consented !== true) {
    return { action: 'redirect', to: '/consent', reason: 'no-current-consent' };
  }

  return { action: 'allow' };
}
