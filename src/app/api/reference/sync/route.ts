import { createServerSupabase } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/reference/sync (PRD §7.4).
 *
 * Reference data flows server -> device only. No outbox, no push: the user never
 * edits the drug catalog.
 *
 * The rulepack is returned WITH its checksum and the client verifies before
 * applying (§7.4, AC-6.1.6). The server does not get to assert a pack is good —
 * a corrupted row in transit or at rest would otherwise become clinical guidance.
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const since = params.get('since') ?? '1970-01-01T00:00:00.000Z';
  const rulepackVersion = params.get('rulepack_version') ?? '';
  const states = (params.get('states') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json(
      { error: 'since must be ISO-8601.' },
      { status: 400 },
    );
  }

  const serverTime = new Date().toISOString();

  const [catalog, interactions, crossReference, contraindications] =
    await Promise.all([
      supabase.from('drug_catalog').select('*').gt('updated_at', since),
      supabase.from('drug_interactions').select('*').gt('updated_at', since),
      supabase.from('allergy_cross_reference').select('*'),
      supabase.from('condition_contraindications').select('*'),
    ]);

  /**
   * Facilities are scoped by state (§7.4).
   *
   * Syncing every facility in the country to every device would spend a metered
   * connection on rows for places the user will never be. With no state given we
   * return NOTHING rather than everything — an unscoped query here is a bug, and
   * silently sending the whole table would hide it.
   */
  let facilities: unknown[] = [];
  if (states.length > 0) {
    const { data } = await supabase
      .from('facilities')
      .select('*')
      .in('state', states)
      .gt('updated_at', since);
    facilities = data ?? [];
  }

  // Only send a pack when the client is behind. `null` means "you are current".
  const { data: rulepackRows } = await supabase
    .from('rulepacks')
    .select('version, checksum, content')
    .eq('review_status', 'published')
    .order('published_at', { ascending: false })
    .limit(1);

  const latest = rulepackRows?.[0] ?? null;
  const rulepack =
    latest && latest.version !== rulepackVersion
      ? {
          version: latest.version,
          checksum: latest.checksum,
          content: latest.content,
        }
      : null;

  return NextResponse.json({
    drug_catalog: catalog.data ?? [],
    interactions: interactions.data ?? [],
    cross_reference: crossReference.data ?? [],
    contraindications: contraindications.data ?? [],
    facilities,
    rulepack,
    server_time: serverTime,
  });
}
