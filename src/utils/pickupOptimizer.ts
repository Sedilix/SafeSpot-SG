/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { haversineMeters, GeoPoint } from './geo';

// Chooses where a senior should be picked up. Straight-line distance is a poor
// guide in Singapore's estates (a point 200 m away can be a 750 m walk around
// a block or across a road), so candidates are ranked by real walking and
// driving times from a route matrix, not by distance.

export type PickupKind = 'taxi_stand' | 'taxi_stop' | 'kerbside';

export interface PickupCandidate {
  id: string;
  kind: PickupKind;
  name: string;
  lat: number;
  lng: number;
  /** LTA's barrier-free flag for taxi stands; unknown for kerbside points. */
  barrierFree?: boolean;
}

export interface RouteLeg {
  seconds: number;
  meters: number;
}

export interface ScoredPickup extends PickupCandidate {
  /** Walking time adjusted for an elderly pace. */
  seniorWalkSeconds: number;
  walkMeters: number;
  straightLineMeters: number;
  driveSeconds: number | null;
  /** Time until both senior and driver are there (they travel in parallel). */
  meetSeconds: number;
  score: number;
  reasons: string[];
}

/** Routing services assume ~4.8 km/h; seniors typically walk ~3.2 km/h. */
export const SENIOR_WALK_FACTOR = 1.5;
/** Beyond this (senior-adjusted) a pickup point is not offered. */
export const MAX_SENIOR_WALK_SECONDS = 10 * 60;
/** Walking effort matters beyond just arriving on time. */
export const WALK_EFFORT_WEIGHT = 0.25;
/** A driver may not be able to stop at an arbitrary kerb. */
export const KERBSIDE_PENALTY_SECONDS = 90;
/** Steps or kerbs at a stand without barrier-free access. */
export const NOT_BARRIER_FREE_PENALTY_SECONDS = 60;
export const MIN_SEPARATION_METERS = 25;
/** Walking speed routing services assume (~4.8 km/h), used for the straight-line floor. */
export const ROUTING_WALK_SPEED_MPS = 1.34;

/** Taxi stands/stops within `radiusMeters`, nearest first. */
export function nearbyCandidates(
  all: PickupCandidate[],
  origin: GeoPoint,
  radiusMeters: number,
  max: number,
): PickupCandidate[] {
  return all
    .map((c) => ({ c, d: haversineMeters(origin, { lat: c.lat, lng: c.lng }) }))
    .filter((x) => x.d <= radiusMeters)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.c);
}

/** Drops candidates within MIN_SEPARATION_METERS of a better one (stands beat kerbside). */
export function dedupeCandidates(candidates: PickupCandidate[]): PickupCandidate[] {
  const rank: Record<PickupKind, number> = { taxi_stand: 0, taxi_stop: 1, kerbside: 2 };
  const sorted = [...candidates].sort((a, b) => rank[a.kind] - rank[b.kind]);
  const kept: PickupCandidate[] = [];
  for (const c of sorted) {
    if (kept.every((k) => haversineMeters(k, c) >= MIN_SEPARATION_METERS)) kept.push(c);
  }
  return kept;
}

/**
 * Scores candidates given walking legs from the senior and (optionally)
 * driving legs from the driver. A candidate with no walking route, or too far
 * for a senior, is dropped. Returns the best `limit`, lowest score first.
 */
export function rankPickups(params: {
  origin: GeoPoint;
  candidates: PickupCandidate[];
  walk: Map<string, RouteLeg | null>;
  drive?: Map<string, RouteLeg | null>;
  limit?: number;
}): ScoredPickup[] {
  const { origin, candidates, walk, drive, limit = 3 } = params;
  const scored: ScoredPickup[] = [];

  for (const c of candidates) {
    const w = walk.get(c.id);
    if (!w) continue;
    // Routing snaps the start onto the nearest path, so the first stretch
    // (e.g. out of a block to the road) can be missing. Nobody walks less
    // than the straight line, so never count less than that.
    const straightLineMeters = Math.round(haversineMeters(origin, c));
    const walkMeters = Math.max(w.meters, straightLineMeters);
    const walkSeconds = Math.max(w.seconds, straightLineMeters / ROUTING_WALK_SPEED_MPS);
    const seniorWalkSeconds = Math.round(walkSeconds * SENIOR_WALK_FACTOR);
    if (seniorWalkSeconds > MAX_SENIOR_WALK_SECONDS) continue;

    const d = drive ? drive.get(c.id) : undefined;
    if (drive && !d) continue; // driver can't reach it
    const driveSeconds = d ? d.seconds : null;

    const reasons: string[] = [];
    let penalty = 0;
    if (c.kind === 'kerbside') {
      penalty += KERBSIDE_PENALTY_SECONDS;
      reasons.push('Not a designated taxi stop');
    }
    if (c.barrierFree === false) {
      penalty += NOT_BARRIER_FREE_PENALTY_SECONDS;
      reasons.push('Not barrier-free');
    }
    if (c.barrierFree === true) reasons.push('Barrier-free');

    // Senior and driver travel at the same time: they meet when the slower arrives.
    const meetSeconds = driveSeconds === null ? seniorWalkSeconds : Math.max(seniorWalkSeconds, driveSeconds);
    const score = meetSeconds + WALK_EFFORT_WEIGHT * seniorWalkSeconds + penalty;

    scored.push({
      ...c,
      seniorWalkSeconds,
      walkMeters,
      straightLineMeters,
      driveSeconds,
      meetSeconds,
      score: Math.round(score),
      reasons,
    });
  }

  return scored.sort((a, b) => a.score - b.score).slice(0, limit);
}
