import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files.
     *
     * The consent gate has to cover EVERY authenticated route (AC-1.2.1), so the
     * matcher is written as an exclusion rather than a list of protected paths —
     * a list is one forgotten entry away from a route that renders clinical
     * guidance to someone who never saw the disclaimer.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
