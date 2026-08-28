import { describe, expect, it } from 'vitest';
import {
  type RouteInputs,
  decideRoute,
  isPublicRoute,
} from '../../src/lib/auth/route-decision';

/**
 * Route-protection tests.
 *
 * These exist because of a real bug that shipped: offline tolerance was applied
 * to requests with NO session, so an unauthenticated visitor walked past both
 * the auth gate and the consent gate whenever the auth server was unreachable.
 * Nothing caught it — the only thing exercising that path was an end-to-end spec
 * that could not run without a mail provider. The logic is a pure function now
 * so it is covered here regardless.
 */

const base: RouteInputs = {
  pathname: '/app',
  hasSessionCookie: false,
  unreachable: false,
  userId: null,
  hasConsentMarker: false,
  consented: null,
};

const signedIn = (over: Partial<RouteInputs> = {}): RouteInputs => ({
  ...base,
  hasSessionCookie: true,
  userId: 'user-1',
  consented: true,
  ...over,
});

describe('public routes', () => {
  it.each(['/', '/login', '/signup', '/recover', '/privacy', '/terms'])(
    '%s is public',
    (pathname) => {
      expect(isPublicRoute(pathname)).toBe(true);
    },
  );

  it.each(['/app', '/app/meds', '/consent', '/unlock', '/app/timeline'])(
    '%s is NOT public',
    (pathname) => {
      expect(isPublicRoute(pathname)).toBe(false);
    },
  );

  it('treats auth API paths as public so sign-in can work', () => {
    expect(isPublicRoute('/api/auth/request-code')).toBe(true);
    expect(isPublicRoute('/auth/callback')).toBe(true);
  });
});

describe('unauthenticated visitors', () => {
  it('is redirected to /login', () => {
    expect(decideRoute({ ...base, pathname: '/app' })).toEqual({
      action: 'redirect',
      to: '/login',
      reason: 'unauthenticated',
    });
  });

  it('may still reach public routes', () => {
    expect(decideRoute({ ...base, pathname: '/signup' }).action).toBe('allow');
  });
});

describe('REGRESSION: offline tolerance must not let strangers in', () => {
  const offlineStranger: RouteInputs = {
    ...base,
    unreachable: true,
    hasSessionCookie: false,
    userId: null,
  };

  it.each(['/app', '/app/meds', '/app/timeline', '/consent', '/unlock'])(
    'redirects %s to /login when unreachable AND no session',
    (pathname) => {
      const decision = decideRoute({ ...offlineStranger, pathname });
      expect(decision).toEqual({
        action: 'redirect',
        to: '/login',
        reason: 'no-session-and-unreachable',
      });
    },
  );

  it('does not leak which routes exist — an unbuilt path redirects too', () => {
    // Before the fix this fell through to a 404, telling an anonymous caller
    // that /app/meds does not exist yet while /app does.
    expect(
      decideRoute({ ...offlineStranger, pathname: '/app/does-not-exist' })
        .action,
    ).toBe('redirect');
  });

  it('still allows public routes while offline', () => {
    expect(decideRoute({ ...offlineStranger, pathname: '/login' }).action).toBe(
      'allow',
    );
  });
});

describe('offline WITH a session — the case tolerance is for', () => {
  it('lets a consented user through when the database is unreachable', () => {
    const decision = decideRoute(
      signedIn({
        unreachable: true,
        consented: null,
        hasConsentMarker: true,
        userId: null, // the auth server never answered
      }),
    );
    expect(decision.action).toBe('allow');
  });

  it('does NOT redirect to /login just because the token could not be revalidated', () => {
    const decision = decideRoute(
      signedIn({ unreachable: true, userId: null, hasConsentMarker: true }),
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('still stops someone who has never consented', () => {
    const decision = decideRoute(
      signedIn({ unreachable: true, userId: null, hasConsentMarker: false }),
    );
    expect(decision).toEqual({
      action: 'redirect',
      to: '/consent',
      reason: 'offline-without-consent-marker',
    });
  });
});

describe('consent gate (AC-1.2.1)', () => {
  it('redirects an authenticated user with no current consent', () => {
    expect(decideRoute(signedIn({ consented: false }))).toEqual({
      action: 'redirect',
      to: '/consent',
      reason: 'no-current-consent',
    });
  });

  it('FAILS CLOSED when the consent result is unknown but the server was reachable', () => {
    expect(decideRoute(signedIn({ consented: null })).action).toBe('redirect');
  });

  it('allows a consented user through', () => {
    expect(decideRoute(signedIn({ consented: true }))).toEqual({
      action: 'allow',
    });
  });

  it.each(['/consent', '/unlock'])(
    'exempts %s so it cannot redirect to itself forever',
    (pathname) => {
      expect(decideRoute(signedIn({ pathname, consented: false })).action).toBe(
        'allow',
      );
    },
  );

  it('a consent MARKER does not substitute for a real check when online', () => {
    // The cookie is a fallback for the unreachable case only. Honouring it while
    // the database is readable would make it a bypass.
    const decision = decideRoute(
      signedIn({ consented: false, hasConsentMarker: true }),
    );
    expect(decision.action).toBe('redirect');
    expect(decision).toMatchObject({ to: '/consent' });
  });
});
