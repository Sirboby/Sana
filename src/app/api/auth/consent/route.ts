import { CONSENT_TYPE, currentDisclaimerVersion } from '@/lib/auth/consent';
import {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE,
} from '@/lib/auth/consent-marker';
import { newId } from '@/lib/schemas';
import { createServerSupabase } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Record acceptance of the safety disclaimer (AC-1.2.3).
 *
 * Server-side rather than written from the page, for one reason: the offline
 * marker cookie must be httpOnly and must only be set AFTER the consents row has
 * actually landed. Setting it from client JavaScript would mean a cookie that
 * claims a consent which may never have been stored — and page script could set
 * it with no row existing at all.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createServerSupabase();

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    return NextResponse.json(
      { error: 'Sign in again to continue.' },
      { status: 401 },
    );
  }

  const version = currentDisclaimerVersion();

  // RLS enforces owner_id = auth.uid() on the way in.
  const { error } = await supabase.from('consents').insert({
    id: newId(),
    owner_id: data.user.id,
    consent_type: CONSENT_TYPE,
    version,
    granted_at: new Date().toISOString(),
  });

  // A duplicate is not a failure: the unique constraint on
  // (owner, type, version) means this consent is already recorded, which is
  // exactly the state the caller wanted.
  const alreadyRecorded = error?.code === '23505';
  if (error && !alreadyRecorded) {
    return NextResponse.json(
      {
        error:
          'Could not record your acceptance. Check your connection and try again.',
      },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ ok: true, version });
  response.cookies.set(CONSENT_COOKIE, version, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CONSENT_COOKIE_MAX_AGE,
  });
  return response;
}
