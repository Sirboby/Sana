import { z } from 'zod';
import { FacilityTypeEnum } from './enums';
import { IsoDateTimeSchema, TextArraySchema } from './primitives';
import { FacilitySchema, UserFacilitySchema } from './tables';

/**
 * Tier 3 of the facility trust hierarchy (§5.5): OpenStreetMap discovery.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS TYPE IS DELIBERATELY NOT A `Facility`, AND DELIBERATELY HAS NO
 * `has_emergency` FIELD.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * §5.5: "`DiscoveredFacility` is a distinct type from `Facility`, not a flag on
 * the same one. [...] A boolean that must be remembered is a boolean that will
 * be forgotten; a type that cannot be passed is a type that cannot be passed."
 *
 * These records are unverified community data. Nobody at Sana has phoned them.
 * They exist to soften coverage gaps outside the curated dataset — to give the
 * user *something* — while being honest that nobody checked it.
 *
 * Because `has_emergency` does not exist on this type, no amount of downstream
 * code can mark a discovered record as an emergency destination. §7.4b makes the
 * same guarantee at the API boundary: "`has_emergency` is never inferred from
 * OSM tags. Discovered records carry no emergency flag at all — the field does
 * not exist on the type."
 *
 * Storage: device-local Dexie only (§6.4). Never synced, never a server table,
 * never part of the reference dataset.
 */
export const DiscoveredFacilitySchema = z.object({
  /** OSM node/way id. Not a Sana UUID — these are not our records. */
  osm_id: z.string().min(1),
  name: z.string().min(1),
  facility_type: FacilityTypeEnum,
  latitude: z.number(),
  longitude: z.number(),
  /** Often empty — OSM phone coverage is patchy (§7.4b). */
  phone_numbers: TextArraySchema,
  address: z.string().nullable(),
  /** Cached for offline use; stale after 30 days (§5.5). */
  fetched_at: IsoDateTimeSchema,
});
export type DiscoveredFacility = z.infer<typeof DiscoveredFacilitySchema>;

/** §7.4b `GET /api/facilities/discover` response. */
export const DiscoverFacilitiesResponseSchema = z.object({
  discovered: z.array(DiscoveredFacilitySchema.omit({ fetched_at: true })),
  fetched_at: IsoDateTimeSchema,
  /** OSM/ODbL attribution. Must be displayed wherever these results appear. */
  attribution: z.string().min(1),
});
export type DiscoverFacilitiesResponse = z.infer<
  typeof DiscoverFacilitiesResponseSchema
>;

/**
 * The only facility types eligible for the escalation screen: tier 1 (the
 * user's own saved facilities) and tier 2 (curated, phone-verified).
 *
 * `nearestEmergencyFacility()` in step 13a accepts this union and nothing wider,
 * so a `DiscoveredFacility` cannot reach an escalation path even by mistake —
 * it is not a member, and it has no `has_emergency` to test.
 */
export const VerifiedFacilitySchema = z.union([
  FacilitySchema,
  UserFacilitySchema,
]);
export type VerifiedFacility = z.infer<typeof VerifiedFacilitySchema>;
