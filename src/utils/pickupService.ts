/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Server-side data gathering for the pickup optimiser: LTA taxi stands, kerb
// points on nearby roads, and real walking/driving times from Google Routes.
// Ranking itself is in pickupOptimizer.ts (pure and unit-tested).

import { ringSamplePoints, GeoPoint } from './geo';
import { PickupCandidate, RouteLeg, dedupeCandidates, nearbyCandidates, rankPickups, ScoredPickup } from './pickupOptimizer';

const STANDS_TTL_MS = 24 * 60 * 60 * 1000;
let standsCache: { at: number; stands: PickupCandidate[] } | null = null;

/** All LTA taxi stands/stops (DataMall), cached for a day. */
export async function getTaxiStands(accountKey: string): Promise<PickupCandidate[]> {
  if (standsCache && Date.now() - standsCache.at < STANDS_TTL_MS) return standsCache.stands;
  const stands: PickupCandidate[] = [];
  for (let skip = 0; skip < 5000; skip += 500) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/TaxiStands?$skip=${skip}`, {
      headers: { AccountKey: accountKey, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`DataMall ${res.status}`);
    const page = ((await res.json()) as any).value || [];
    for (const s of page) {
      if (typeof s.Latitude !== 'number' || typeof s.Longitude !== 'number') continue;
      stands.push({
        id: `lta-${s.TaxiCode}`,
        kind: s.Type === 'Stop' ? 'taxi_stop' : 'taxi_stand',
        name: s.Name || `Taxi ${s.Type === 'Stop' ? 'stop' : 'stand'} ${s.TaxiCode}`,
        lat: s.Latitude,
        lng: s.Longitude,
        barrierFree: s.Bfa === 'Yes' ? true : s.Bfa === 'No' ? false : undefined,
      });
    }
    if (page.length < 500) break;
  }
  standsCache = { at: Date.now(), stands };
  return stands;
}

/** Kerb points on roads near the senior (Roads API snaps sample points to the nearest road). */
export async function kerbsideCandidates(origin: GeoPoint, mapsKey: string): Promise<PickupCandidate[]> {
  const points = [origin, ...ringSamplePoints(origin, 40, 6), ...ringSamplePoints(origin, 100, 8)];
  const path = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
  const res = await fetch(`https://roads.googleapis.com/v1/nearestRoads?points=${encodeURIComponent(path)}&key=${mapsKey}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  return (data.snappedPoints || []).map((s: any, i: number) => ({
    id: `kerb-${i}`,
    kind: 'kerbside' as const,
    name: 'Roadside',
    lat: s.location.latitude,
    lng: s.location.longitude,
  }));
}

/** One origin to many destinations; null where no route exists. */
export async function routeMatrix(
  origin: GeoPoint,
  destinations: PickupCandidate[],
  mode: 'WALK' | 'DRIVE',
  mapsKey: string,
): Promise<Map<string, RouteLeg | null>> {
  const result = new Map<string, RouteLeg | null>(destinations.map((d) => [d.id, null]));
  if (destinations.length === 0) return result;
  const body: any = {
    origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
    destinations: destinations.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
    travelMode: mode,
  };
  if (mode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Routes ${res.status}`);
  const rows = (await res.json()) as any[];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.condition !== 'ROUTE_EXISTS') continue;
    const d = destinations[row.destinationIndex];
    const seconds = parseInt(String(row.duration || '0').replace('s', ''), 10);
    if (d && Number.isFinite(seconds)) result.set(d.id, { seconds, meters: row.distanceMeters ?? 0 });
  }
  return result;
}

export interface PickupOptionsResult {
  options: ScoredPickup[];
  usedTaxiStands: boolean;
  usedDriverLocation: boolean;
}

/** Gathers candidates and real route times, then ranks them. */
export async function findPickupOptions(params: {
  senior: GeoPoint;
  driver?: GeoPoint | null;
  mapsKey: string;
  ltaKey?: string;
}): Promise<PickupOptionsResult> {
  const { senior, driver, mapsKey, ltaKey } = params;

  let stands: PickupCandidate[] = [];
  if (ltaKey) {
    try {
      stands = nearbyCandidates(await getTaxiStands(ltaKey), senior, 400, 8);
    } catch (e: any) {
      console.warn('[PICKUP] Taxi stands unavailable:', e.message);
    }
  }
  const kerbs = await kerbsideCandidates(senior, mapsKey).catch(() => [] as PickupCandidate[]);
  const candidates = dedupeCandidates([...stands, ...kerbs]).slice(0, 14);

  const [walk, drive] = await Promise.all([
    routeMatrix(senior, candidates, 'WALK', mapsKey),
    driver ? routeMatrix(driver, candidates, 'DRIVE', mapsKey) : Promise.resolve(undefined),
  ]);

  return {
    options: rankPickups({ origin: senior, candidates, walk, drive, limit: 3 }),
    usedTaxiStands: stands.length > 0,
    usedDriverLocation: Boolean(driver),
  };
}
