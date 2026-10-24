/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Server-side data gathering for the pickup optimiser: LTA taxi stands, kerb
// points on nearby roads, and real walking/driving times from Google Routes.
// Ranking itself is in pickupOptimizer.ts (pure and unit-tested).

import { ringSamplePoints, GeoPoint } from './geo';
import { PickupCandidate, RouteLeg, dedupeCandidates, nearbyCandidates, rankPickups, ScoredPickup, SENIOR_WALK_FACTOR } from './pickupOptimizer';
import { PedestrianRouter } from '../routing/pedestrianRouter';
import { RoadGraph } from '../routing/graph';
import { Router } from '../routing/router';
import { DriveWorkerClient } from '../routing/driveWorkerClient';
import { SpeedProfileEngine } from '../routing/speedProfiles';
import { IncidentLayer, TrafficIncident } from '../routing/incidents';
import { ErpEngine } from '../routing/erp';

const STANDS_TTL_MS = 24 * 60 * 60 * 1000;
let standsCache: { at: number; stands: PickupCandidate[] } | null = null;

const INCIDENTS_TTL_MS = 5 * 60 * 1000;
let incidentsCache: { at: number; incidents: TrafficIncident[] } | null = null;

let pedestrianRouterInstance: PedestrianRouter | null = null;
export function getPedestrianRouter(): PedestrianRouter {
  if (!pedestrianRouterInstance) {
    pedestrianRouterInstance = new PedestrianRouter();
  }
  return pedestrianRouterInstance;
}

let roadRouterInstance: Router | null = null;
export function getRoadRouter(): Router {
  if (!roadRouterInstance) {
    roadRouterInstance = new Router(RoadGraph.loadDefault());
  }
  return roadRouterInstance;
}

let speedProfileEngineInstance: SpeedProfileEngine | null = null;
export function getSpeedProfileEngine(): SpeedProfileEngine {
  if (!speedProfileEngineInstance) {
    speedProfileEngineInstance = new SpeedProfileEngine();
  }
  return speedProfileEngineInstance;
}

let incidentLayerInstance: IncidentLayer | null = null;
export function getIncidentLayer(): IncidentLayer {
  if (!incidentLayerInstance) {
    incidentLayerInstance = new IncidentLayer();
  }
  return incidentLayerInstance;
}

let erpEngineInstance: ErpEngine | null = null;
export function getErpEngine(): ErpEngine {
  if (!erpEngineInstance) {
    erpEngineInstance = new ErpEngine();
  }
  return erpEngineInstance;
}

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

/** Live traffic incidents from LTA DataMall, cached for 5 minutes. */
export async function getLiveTrafficIncidents(accountKey?: string): Promise<TrafficIncident[]> {
  if (!accountKey) return [];
  if (incidentsCache && Date.now() - incidentsCache.at < INCIDENTS_TTL_MS) {
    return incidentsCache.incidents;
  }
  try {
    const res = await fetch('https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents', {
      headers: { AccountKey: accountKey, accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return incidentsCache?.incidents ?? [];
    const page = ((await res.json()) as any).value || [];
    const incidents: TrafficIncident[] = page.map((i: any) => ({
      type: i.Type || 'Incident',
      lat: i.Latitude,
      lng: i.Longitude,
      message: i.Message || '',
      timestamp: Date.now(),
    }));
    incidentsCache = { at: Date.now(), incidents };
    return incidents;
  } catch {
    return incidentsCache?.incidents ?? [];
  }
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

/** Helper to query Google Routes matrix. */
async function fetchGoogleRouteMatrix(
  origin: GeoPoint,
  destinations: PickupCandidate[],
  mode: 'WALK' | 'DRIVE',
  mapsKey: string
): Promise<Map<string, RouteLeg | null>> {
  const result = new Map<string, RouteLeg | null>(destinations.map((d) => [d.id, null]));
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

/** Triggers background shadow comparison logging without blocking the HTTP response. */
function triggerDriveShadowEvaluation(
  origin: GeoPoint,
  destinations: PickupCandidate[],
  liveIncidents?: TrafficIncident[]
): void {
  setImmediate(async () => {
    try {
      const departure = new Date();
      const sgt = new Date(departure.getTime() + 8 * 3600 * 1000);
      const departureHhmm = `${String(sgt.getUTCHours()).padStart(2, '0')}:${String(sgt.getUTCMinutes()).padStart(2, '0')}`;

      const targets = destinations.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng }));
      const workerClient = DriveWorkerClient.getInstance();
      const workerRes = await workerClient.findRoutesToMany(origin, targets, {
        departureTime: departure,
        liveIncidents,
      });

      if (!workerRes) return;

      // Engine only: Google's ETAs are never logged next to ours (Maps Platform
      // terms bar caching route durations and using them to tune a substitute).
      // Accuracy is measured against real trips instead (docs/clean-room-calibration.md).
      for (const d of destinations) {
        const localLeg = workerRes.results.get(d.id);
        if (!localLeg) continue;
        // Exactly one [PICKUP_DRIVE_EVAL] JSON line. No coordinates, device IDs, or names.
        console.log(
          `[PICKUP_DRIVE_EVAL] ${JSON.stringify({
            candidateId: d.id,
            departure: departureHhmm,
            localSec: localLeg.seconds,
            localMs: workerRes.durationMs,
          })}`
        );
      }
    } catch (err: any) {
      console.warn('[PICKUP_DRIVE_EVAL] Shadow evaluation error:', err.message);
    }
  });
}

/** One origin to many destinations; null where no route exists. */
export async function routeMatrix(
  origin: GeoPoint,
  destinations: PickupCandidate[],
  mode: 'WALK' | 'DRIVE',
  mapsKey?: string,
  customPedestrianRouter?: PedestrianRouter,
  customRoadRouter?: Router,
  liveIncidents?: TrafficIncident[]
): Promise<Map<string, RouteLeg | null>> {
  const result = new Map<string, RouteLeg | null>(destinations.map((d) => [d.id, null]));
  if (destinations.length === 0) return result;

  // Phase 3: Senior walking route using local pedestrian engine behind feature flag
  if (mode === 'WALK' && (process.env.ROUTING_ENGINE === 'local' || customPedestrianRouter)) {
    try {
      const router = customPedestrianRouter ?? getPedestrianRouter();
      for (const d of destinations) {
        const leg = await router.findRoute(origin, { lat: d.lat, lng: d.lng });
        if (leg) {
          result.set(d.id, {
            seconds: Math.round(leg.durationSeconds / SENIOR_WALK_FACTOR),
            meters: leg.distanceMeters,
          });
        }
      }
      return result;
    } catch (e: any) {
      console.warn('[PICKUP] Local pedestrian router error, falling back to Google:', e.message);
    }
  }

  // Phase 4: Driver routing using SafeSpot local road engine behind feature flag
  const driveEngine = process.env.ROUTING_ENGINE_DRIVE || 'google';
  const shadowDrive = process.env.ROUTING_SHADOW_DRIVE === '1';

  if (mode === 'DRIVE' && (driveEngine === 'local' || customRoadRouter)) {
    try {
      const departureTime = new Date();
      const targets = destinations.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng }));

      if (customRoadRouter) {
        const speedProfiles = getSpeedProfileEngine();
        const incidents = getIncidentLayer();
        if (liveIncidents) incidents.setIncidents(liveIncidents);
        const erp = getErpEngine();

        if (typeof (customRoadRouter as any).findRoutesToMany === 'function') {
          const routes = customRoadRouter.findRoutesToMany(origin, targets, {
            departureTime,
            speedProfiles,
            incidents,
            erp,
          });

          for (const [id, r] of routes) {
            if (r) {
              result.set(id, {
                seconds: Math.round(r.durationSeconds),
                meters: Math.round(r.distanceMeters),
              });
            }
          }
        } else {
          for (const d of destinations) {
            const leg = customRoadRouter.findRoute(origin, { lat: d.lat, lng: d.lng }, {
              departureTime,
              speedProfiles,
              incidents,
              erp,
            });
            if (leg) {
              result.set(d.id, {
                seconds: Math.round(leg.durationSeconds),
                meters: Math.round(leg.distanceMeters),
              });
            }
          }
        }
        return result;
      }

      // Try worker client
      const workerClient = DriveWorkerClient.getInstance();
      const workerRes = await workerClient.findRoutesToMany(origin, targets, {
        departureTime,
        liveIncidents,
      });

      if (workerRes) {
        for (const [id, r] of workerRes.results) {
          result.set(id, r);
        }
        return result;
      }
    } catch (e: any) {
      console.warn('[PICKUP] Local road router error, falling back to Google:', e.message);
    }
  }

  if (!mapsKey) return result;

  const googleLegs = await fetchGoogleRouteMatrix(origin, destinations, mode, mapsKey);

  // If shadow evaluation is enabled for DRIVE mode, schedule non-blocking evaluation
  if (mode === 'DRIVE' && shadowDrive) {
    triggerDriveShadowEvaluation(origin, destinations, liveIncidents);
  }

  return googleLegs;
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
  mapsKey?: string;
  ltaKey?: string;
  customPedestrianRouter?: PedestrianRouter;
  customRoadRouter?: Router;
}): Promise<PickupOptionsResult> {
  const { senior, driver, mapsKey = '', ltaKey, customPedestrianRouter, customRoadRouter } = params;

  let stands: PickupCandidate[] = [];
  let liveIncidents: TrafficIncident[] = [];
  if (ltaKey) {
    const [standsRes, incidentsRes] = await Promise.all([
      getTaxiStands(ltaKey).catch((e: any) => {
        console.warn('[PICKUP] Taxi stands unavailable:', e.message);
        return [] as PickupCandidate[];
      }),
      getLiveTrafficIncidents(ltaKey).catch(() => [] as TrafficIncident[]),
    ]);
    stands = nearbyCandidates(standsRes, senior, 400, 8);
    liveIncidents = incidentsRes;
  }
  const kerbs = mapsKey ? await kerbsideCandidates(senior, mapsKey).catch(() => [] as PickupCandidate[]) : [];
  const candidates = dedupeCandidates([...stands, ...kerbs]).slice(0, 14);

  const driveEngine = process.env.ROUTING_ENGINE_DRIVE || 'google';
  const canDrive = Boolean(driver && (mapsKey || driveEngine === 'local' || customRoadRouter));

  // Fix parameter order per §8 E7: pass customPedestrianRouter ONLY to WALK, and customRoadRouter ONLY to DRIVE
  const [walk, drive] = await Promise.all([
    routeMatrix(senior, candidates, 'WALK', mapsKey, customPedestrianRouter, undefined, liveIncidents),
    canDrive && driver
      ? routeMatrix(driver, candidates, 'DRIVE', mapsKey, undefined, customRoadRouter, liveIncidents)
      : Promise.resolve(undefined),
  ]);

  return {
    options: rankPickups({ origin: senior, candidates, walk, drive, limit: 3 }),
    usedTaxiStands: stands.length > 0,
    usedDriverLocation: Boolean(driver),
  };
}
