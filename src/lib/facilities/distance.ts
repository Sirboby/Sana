/**
 * Great-circle distance, on device (PRD §6.1).
 *
 * §6.1 is explicit that there is no PostGIS and no server round trip: "distance
 * is computed on-device in JS, which is ample for a few thousand rows and
 * removes an entire server-side query path." That matters more than performance
 * here — a person looking for the nearest hospital may have no connection, and a
 * server-side distance query would fail exactly when it is needed most.
 *
 * Haversine assumes a spherical Earth. Over the distances involved — someone
 * finding a facility in their own state — the error against the true ellipsoid
 * is well under a percent, far smaller than the error in the coordinates
 * themselves.
 */

export type Coordinates = {
  latitude: number;
  longitude: number;
};

/** Mean Earth radius in kilometres (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distance in kilometres between two points. */
export function haversineDistanceKm(
  from: Coordinates,
  to: Coordinates,
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Sort by distance from a point, nearest first.
 *
 * Generic over the facility type on purpose: §5.5 keeps verified facilities and
 * unverified OSM discoveries as DISTINCT types so the latter cannot reach the
 * escalation screen. Sorting must not be the place that quietly reunites them,
 * so this only orders whatever it is handed and never widens the type.
 */
export function sortByDistance<T extends Coordinates>(
  origin: Coordinates,
  items: T[],
): (T & { distanceKm: number })[] {
  return items
    .map((item) => ({ ...item, distanceKm: haversineDistanceKm(origin, item) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Coarsen coordinates to roughly a 1km grid cell (§5.5, §11).
 *
 * Facility search does not need street-level precision, and sending exact
 * coordinates to the discovery proxy would disclose where the user is standing.
 * Reduced precision is data minimisation in the NDPA sense, and it doubles as
 * the cache key for the discovery endpoint.
 *
 * 0.01 degrees of latitude is about 1.11km. Longitude cells narrow toward the
 * poles; at Nigerian latitudes the difference is small and erring toward a
 * larger cell only discloses less.
 */
export function coarsenToGrid(
  point: Coordinates,
  cellDegrees = 0.01,
): Coordinates {
  // Snap to the cell's own precision. Plain multiplication leaves float noise
  // (6.524412 coarsens to 6.5200000000000005), and that matters twice: the
  // coarsened pair is the server-side cache key for the discovery proxy, so
  // noisy digits fragment the cache, and the trailing digits carry back a
  // sliver of the precision this function exists to discard.
  const decimals = Math.max(0, Math.ceil(-Math.log10(cellDegrees)));
  const snap = (value: number): number =>
    Number((Math.round(value / cellDegrees) * cellDegrees).toFixed(decimals));

  return {
    latitude: snap(point.latitude),
    longitude: snap(point.longitude),
  };
}
