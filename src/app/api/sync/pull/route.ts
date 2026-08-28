import { createServerSupabase } from '@/lib/supabase/server';
import { PULL_PAGE_LIMIT } from '@/lib/sync/protocol';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/sync/pull (PRD §7.3).
 *
 * Uses the USER's client, not the service role, so every query is scoped by RLS
 * to auth.uid(). That is the point: the isolation proof from step 2 covers this
 * endpoint automatically, and there is no owner_id filter here to get wrong.
 *
 * Tombstones ARE included. A deletion that did not propagate would leave the
 * record alive on every other device, which is the failure users notice.
 */

const SYNCED_TABLES = [
  { name: 'persons', orderBy: 'updated_at' },
  { name: 'allergies', orderBy: 'updated_at' },
  { name: 'conditions', orderBy: 'updated_at' },
  { name: 'medications', orderBy: 'updated_at' },
  // Append-only, so ordering is by creation rather than modification (§7.3).
  { name: 'clinical_events', orderBy: 'created_at' },
  { name: 'consents', orderBy: 'granted_at' },
  { name: 'user_facilities', orderBy: 'updated_at' },
] as const;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const since =
    request.nextUrl.searchParams.get('since') ?? '1970-01-01T00:00:00.000Z';
  const limitParam = Number(
    request.nextUrl.searchParams.get('limit') ?? PULL_PAGE_LIMIT,
  );
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, limitParam), PULL_PAGE_LIMIT)
    : PULL_PAGE_LIMIT;

  if (Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json(
      { error: 'since must be an ISO-8601 timestamp.' },
      { status: 400 },
    );
  }

  // Captured BEFORE the reads. A row written during this request would otherwise
  // fall between the read and the timestamp and be skipped forever by the next
  // pull, since the watermark would already be past it.
  const serverTime = new Date().toISOString();

  const changes: Record<string, unknown[]> = {};
  let hasMore = false;

  for (const table of SYNCED_TABLES) {
    const { data, error } = await supabase
      .from(table.name)
      .select('*')
      .gt(table.orderBy, since)
      .order(table.orderBy, { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: `Could not read ${table.name}.` },
        { status: 502 },
      );
    }

    changes[table.name] = data ?? [];
    // A full page implies there may be another. The client re-pulls until this
    // is false, bounded by MAX_PULL_PAGES so a stuck cursor fails loudly.
    if ((data?.length ?? 0) >= limit) hasMore = true;
  }

  return NextResponse.json({
    changes,
    // HAZARD 3: this is the ONLY legitimate source of the client's watermark.
    server_time: serverTime,
    has_more: hasMore,
  });
}
