import { referenceRepository } from '../db/repositories';
import {
  ReferenceSyncResponseSchema,
  RulepackDocumentSchema,
} from '../schemas';

/**
 * Client half of the reference sync (PRD §7.4).
 *
 * Reference data flows server -> device only. There is no outbox and no push:
 * the user never edits the drug catalog, so there is nothing to send back.
 */

export type ReferenceSyncOutcome = {
  applied: {
    drugs: number;
    interactions: number;
    crossReference: number;
    contraindications: number;
    facilities: number;
  };
  rulepack: 'applied' | 'unchanged' | 'rejected-checksum';
  serverTime: string;
};

/**
 * SHA-256 of a rulepack document, in the `sha256:<hex>` form §8 uses.
 *
 * Computed over the canonical JSON of `content`, which is what the server
 * hashed. Any difference in serialisation would produce a mismatch and reject a
 * perfectly good pack, so the two sides must agree on the exact bytes.
 */
export async function rulepackChecksum(content: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(content));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

export type RulepackVerification =
  | { ok: true; version: string }
  | { ok: false; reason: 'checksum-mismatch' | 'malformed' };

/**
 * Verify a rulepack BEFORE applying it (§7.4, AC-6.1.6).
 *
 * "On mismatch: reject, keep the previous pack, log, and continue with red-flag
 * evaluation intact." Two things make that safe. First, red-flag rules are
 * compiled into the bundle (§5.4), not loaded from here, so a rejected pack
 * cannot disable emergency detection. Second, keeping the PREVIOUS pack is
 * strictly better than accepting an unverified one: stale curated content is
 * still clinician-authored, whereas a pack that failed its checksum is content
 * of unknown origin being presented to a user as medical guidance.
 */
export async function verifyRulepack(
  candidate: { version: string; checksum: string; content: unknown } | null,
): Promise<RulepackVerification> {
  if (candidate === null) return { ok: false, reason: 'malformed' };

  const parsed = RulepackDocumentSchema.safeParse(candidate.content);
  if (!parsed.success) return { ok: false, reason: 'malformed' };

  const computed = await rulepackChecksum(candidate.content);
  if (computed !== candidate.checksum)
    return { ok: false, reason: 'checksum-mismatch' };

  return { ok: true, version: candidate.version };
}

export type FetchReferenceOptions = {
  since: string;
  rulepackVersion: string;
  /**
   * State codes to scope facilities to.
   *
   * §7.4 scopes facilities by state deliberately: syncing every facility in the
   * country to every device wastes storage and bandwidth on a connection that
   * may be metered, to deliver rows for places the user will never be.
   */
  states?: string[];
  fetchImpl?: typeof fetch;
};

/**
 * Pull reference data and write it to the local store.
 *
 * The rulepack is verified before anything is applied, and a rejected pack does
 * NOT block the rest: the drug catalog and facility data are independently
 * useful and independently trustworthy.
 */
export async function syncReferenceData(
  options: FetchReferenceOptions,
): Promise<ReferenceSyncOutcome> {
  const doFetch = options.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    since: options.since,
    rulepack_version: options.rulepackVersion,
  });
  if (options.states?.length) params.set('states', options.states.join(','));

  const response = await doFetch(`/api/reference/sync?${params.toString()}`);
  if (!response.ok)
    throw new Error(`Reference sync failed: ${response.status}`);

  const payload = ReferenceSyncResponseSchema.parse(await response.json());

  await referenceRepository.replaceDrugCatalog(payload.drug_catalog);
  await referenceRepository.replaceInteractions(payload.interactions);
  await referenceRepository.replaceCrossReference(payload.cross_reference);
  await referenceRepository.replaceContraindications(payload.contraindications);
  await referenceRepository.replaceFacilities(payload.facilities);

  let rulepackState: ReferenceSyncOutcome['rulepack'] = 'unchanged';

  if (payload.rulepack !== null) {
    const verification = await verifyRulepack(payload.rulepack);
    if (verification.ok) {
      await referenceRepository.putRulepack(payload.rulepack.content);
      rulepackState = 'applied';
    } else {
      // Keep the previous pack. Not logged with content — §11 forbids clinical
      // payloads in error reports.
      rulepackState = 'rejected-checksum';
    }
  }

  return {
    applied: {
      drugs: payload.drug_catalog.length,
      interactions: payload.interactions.length,
      crossReference: payload.cross_reference.length,
      contraindications: payload.contraindications.length,
      facilities: payload.facilities.length,
    },
    rulepack: rulepackState,
    serverTime: payload.server_time,
  };
}
