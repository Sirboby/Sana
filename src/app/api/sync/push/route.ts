import { MutationSchema } from '@/lib/schemas';
import {
  createServerSupabase,
  createServiceRoleSupabase,
} from '@/lib/supabase/server';
import { type MutationRejection, applyMutation } from '@/lib/sync/apply';
import {
  MAX_MUTATIONS_PER_BATCH,
  REJECTION_CODES,
  assessClockSkew,
} from '@/lib/sync/protocol';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/sync/push (PRD §7.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER_ID IS ALWAYS TAKEN FROM THE JWT
 * ─────────────────────────────────────────────────────────────────────────────
 * §7.2: "owner_id is always overwritten server-side from the JWT. A
 * client-supplied owner_id is ignored — never trusted."
 *
 * The client value is not validated, not compared, and not used for
 * authorisation. It is DISCARDED before the row is built, so there is no code
 * path in which it could influence where a row lands. Comparing it and rejecting
 * a mismatch would be weaker: it would mean the value had reached the logic at
 * all, and one refactor later someone trusts the comparison instead of the JWT.
 *
 * Per-mutation rejection, not whole-batch failure: a single malformed row must
 * not strand a user's other 499 changes on a device.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON is the one whole-batch failure — there is nothing to
    // partially apply.
    return NextResponse.json(
      { error: 'Malformed request body.' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const ownerId = auth.user.id;
  const payload = body as { client_id?: unknown; mutations?: unknown };
  const mutations = Array.isArray(payload.mutations) ? payload.mutations : null;

  if (mutations === null) {
    return NextResponse.json(
      { error: 'mutations must be an array.' },
      { status: 400 },
    );
  }
  if (mutations.length > MAX_MUTATIONS_PER_BATCH) {
    return NextResponse.json(
      {
        error: `A batch may carry at most ${MAX_MUTATIONS_PER_BATCH} mutations.`,
        max: MAX_MUTATIONS_PER_BATCH,
      },
      { status: 413 },
    );
  }

  const serverNow = new Date();
  const serviceRole = createServiceRoleSupabase();

  const applied: string[] = [];
  const rejected: MutationRejection[] = [];

  for (const raw of mutations) {
    const parsed = MutationSchema.safeParse(raw);
    if (!parsed.success) {
      const mutationId =
        typeof (raw as { mutation_id?: unknown })?.mutation_id === 'string'
          ? (raw as { mutation_id: string }).mutation_id
          : 'unknown';
      rejected.push({
        mutation_id: mutationId,
        reason: 'The mutation envelope failed validation.',
        code: REJECTION_CODES.SCHEMA_INVALID,
      });
      continue;
    }

    const mutation = parsed.data;

    // HAZARD 1: clock skew.
    const skew = assessClockSkew(mutation.client_updated_at, serverNow);
    if (skew.verdict === 'reject') {
      rejected.push({
        mutation_id: mutation.mutation_id,
        reason:
          'This change is dated too far in the future. Check the date and time on your device.',
        code: REJECTION_CODES.CLOCK_SKEW_FUTURE,
      });
      continue;
    }
    if (skew.verdict === 'warn') {
      // No identifiers, no clinical content — §11 forbids either in logs.
      console.warn(
        `[sync] clock skew ${Math.round(skew.skewMs / 1000)}s on table ${mutation.table}`,
      );
    }

    const outcome = await applyMutation(serviceRole, {
      mutation,
      ownerId,
      serverNow,
    });

    if (outcome.ok) applied.push(mutation.mutation_id);
    else rejected.push(outcome.rejection);
  }

  // §11: one audit_log row per accepted batch.
  if (applied.length > 0) {
    await serviceRole.from('audit_log').insert({
      owner_id: ownerId,
      action: 'sync.push',
      resource: 'sync',
      resource_id: null,
      ip_address: request.headers.get('x-forwarded-for'),
      user_agent: request.headers.get('user-agent'),
    });
  }

  return NextResponse.json({
    applied,
    rejected,
    // The client uses this to detect its own skew and to surface a
    // "check your device clock" state.
    server_time: serverNow.toISOString(),
  });
}
