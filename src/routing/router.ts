/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * router.ts: Time-dependent A* over an edge-based graph (state = directed edge)
 * with turn restrictions, turn delays, dynamic speed profiles, live incident
 * closures, and ERP toll evaluation (Phase 2).
 */

import { RoadGraph, CompactEdge, haversineMeters, bearingDegrees } from './graph';
import { SpeedProfileEngine } from './speedProfiles';
import { IncidentLayer } from './incidents';
import { ErpEngine } from './erp';

export interface RouteToll {
  gantryName: string;
  chargeSgd: number;
  arrivalTime: Date;
}

export interface RouteResult {
  distanceMeters: number;
  km: number;
  durationSeconds: number;
  minutes: number;
  edgeCount: number;
  edges: CompactEdge[];
  snapStartMeters: number;
  snapDestMeters: number;
  totalTollSgd?: number;
  tollStatus?: 'known' | 'unknown';
  tolls?: RouteToll[];
  incidentsEncountered?: string[];
}

export interface RoutingOptions {
  departureTime?: Date;
  speedProfiles?: SpeedProfileEngine;
  incidents?: IncidentLayer;
  erp?: ErpEngine;
  edgePenalties?: Map<number, number>;
}

export interface AlternativeRoutingOptions extends RoutingOptions {
  maxRoutes?: number;          // Default 3
  penaltyMultiplier?: number;  // Default 1.35 (penalty method)
  maxOverlap?: number;         // Default 0.65 (accept if overlap < 65%)
  maxIterations?: number;      // Default 8
}

interface HeapItem { edgeId: number; elapsed: number; priority: number }

class MinHeap {
  private a: HeapItem[] = [];
  get size(): number { return this.a.length; }
  push(item: HeapItem): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].priority <= a[i].priority) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): HeapItem | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority < a[m].priority) m = l;
        if (r < a.length && a[r].priority < a[m].priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Router {
  public static readonly DELAY_STRAIGHT_SEC = 2.0;
  public static readonly DELAY_LEFT_SEC = 5.0;
  public static readonly DELAY_RIGHT_SEC = 18.0;
  public static readonly DELAY_UTURN_SEC = 28.0;
  private static readonly MAX_SPEED_MS = 90 / 3.6;
  /** Heuristic slack (m) so the half-edge accounting at the destination can't make h inadmissible. */
  private static readonly HEURISTIC_SLACK_M = 200;

  constructor(private graph: RoadGraph) {}

  /** Signed turn angle in degrees, positive = right, in (-180, 180]. */
  private turnAngle(from: CompactEdge, to: CompactEdge): number {
    const g = this.graph.nodes;
    const b1 = bearingDegrees(g[from.from].lat, g[from.from].lng, g[from.to].lat, g[from.to].lng);
    const b2 = bearingDegrees(g[to.from].lat, g[to.from].lng, g[to.to].lat, g[to.to].lng);
    return ((b2 - b1 + 540) % 360) - 180;
  }

  /** Whether `from` -> `to` is legal, and the delay it costs. */
  public evaluateTurn(from: CompactEdge, to: CompactEdge): { allowed: boolean; delaySec: number } {
    const via = from.to;
    const isReverse = to.to === from.from;

    // Restrictions are matched on (from-way, via-node, to-way), as OSM defines them.
    for (const r of this.graph.restrictionsAt(from.wayId, via)) {
      const toMatches = to.wayId === r.toWayId;
      if (r.type === 'no_u_turn') {
        if (toMatches && (isReverse || Math.abs(this.turnAngle(from, to)) > 135)) return { allowed: false, delaySec: 0 };
      } else if (r.type.startsWith('no_')) {
        if (!toMatches) continue;
        if (from.wayId !== r.toWayId) return { allowed: false, delaySec: 0 };
        const a = this.turnAngle(from, to); // same way continues: fall back to angle class
        if ((r.type === 'no_left_turn' && a < -30) || (r.type === 'no_right_turn' && a > 30) ||
            (r.type === 'no_straight_on' && Math.abs(a) <= 30)) return { allowed: false, delaySec: 0 };
      } else if (r.type.startsWith('only_')) {
        if (!toMatches) return { allowed: false, delaySec: 0 };
        if (isReverse && r.type !== 'only_u_turn') return { allowed: false, delaySec: 0 };
      }
    }

    if (isReverse) {
      const exits = this.graph.outgoingEdges[via].filter((id) => this.graph.edges[id].to !== from.from);
      return exits.length === 0 ? { allowed: true, delaySec: Router.DELAY_UTURN_SEC } : { allowed: false, delaySec: 0 };
    }

    if (!this.graph.isJunction[via]) return { allowed: true, delaySec: 0 };

    const a = this.turnAngle(from, to);
    if (Math.abs(a) > 135) return { allowed: true, delaySec: Router.DELAY_UTURN_SEC };
    if (a > 30) return { allowed: true, delaySec: Router.DELAY_RIGHT_SEC };
    if (a < -30) return { allowed: true, delaySec: Router.DELAY_LEFT_SEC };
    return { allowed: true, delaySec: Router.DELAY_STRAIGHT_SEC };
  }

  public findRoute(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number },
    options?: RoutingOptions
  ): RouteResult | null {
    const s = this.graph.findNearestSegment(origin.lat, origin.lng);
    const t = this.graph.findNearestSegment(dest.lat, dest.lng);
    if (!s || !t) return null;

    const { edges, nodes } = this.graph;
    const targetIds = new Set(t.edges.map((e) => e.id));
    const best = new Float64Array(edges.length).fill(Infinity);
    const prev = new Int32Array(edges.length).fill(-1);
    const heap = new MinHeap();
    const h = (edge: CompactEdge) =>
      Math.max(0, haversineMeters(nodes[edge.to].lat, nodes[edge.to].lng, dest.lat, dest.lng) - Router.HEURISTIC_SLACK_M) / Router.MAX_SPEED_MS;

    const departureTime = options?.departureTime || new Date();
    const speedProfiles = options?.speedProfiles;
    const incidents = options?.incidents;
    const erp = options?.erp;
    const encounteredIncidents = new Set<string>();

    // Start mid-segment: either direction, half the segment still to travel.
    for (const e of s.edges) {
      if (incidents) {
        const a = nodes[e.from], b = nodes[e.to];
        const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, departureTime);
        if (impact.impassable) continue;
      }
      const initialSeconds = speedProfiles ? speedProfiles.calculateEdgeSeconds(e, departureTime) : e.seconds;
      const penalty = options?.edgePenalties?.get(e.id) ?? 1.0;
      const c = initialSeconds * 0.5 * penalty;
      best[e.id] = c;
      heap.push({ edgeId: e.id, elapsed: c, priority: c + h(e) });
    }

    let reached = -1;
    while (heap.size) {
      const top = heap.pop()!;
      if (top.elapsed > best[top.edgeId]) continue; // stale entry (Float64: exact comparison is safe)
      if (targetIds.has(top.edgeId)) { reached = top.edgeId; break; }
      const cur = edges[top.edgeId];

      for (const nid of this.graph.outgoingEdges[cur.to]) {
        const next = edges[nid];
        const turn = this.evaluateTurn(cur, next);
        if (!turn.allowed) continue;

        const arrivalMs = departureTime.getTime() + (top.elapsed + turn.delaySec) * 1000;
        const arrivalTime = new Date(arrivalMs);

        // 1. Live Incidents: impassable closures and decay delays
        let incidentDelay = 0;
        if (incidents) {
          const a = nodes[next.from], b = nodes[next.to];
          const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, arrivalTime);
          if (impact.impassable) {
            continue; // Closed edge is strictly avoided
          }
          if (impact.delaySec > 0) {
            incidentDelay = impact.delaySec;
            if (impact.reason) encounteredIncidents.add(impact.reason);
          }
        }

        // 2. Time-dependent speed profile at arrival time
        let nextSeconds = next.seconds;
        if (speedProfiles) {
          const a = nodes[next.from], b = nodes[next.to];
          const bearing = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
          nextSeconds = speedProfiles.calculateEdgeSeconds(next, arrivalTime, bearing);
        }

        const penalty = options?.edgePenalties?.get(next.id) ?? 1.0;
        const cost = top.elapsed + turn.delaySec + incidentDelay + nextSeconds * penalty;
        if (cost < best[nid]) {
          best[nid] = cost;
          prev[nid] = top.edgeId;
          heap.push({ edgeId: nid, elapsed: cost, priority: cost + h(next) });
        }
      }
    }
    if (reached < 0) return null;

    return this.reconstructRoute(
      reached,
      prev,
      best,
      departureTime,
      s.distanceMeters,
      t.distanceMeters,
      speedProfiles,
      incidents,
      erp,
      encounteredIncidents,
      options?.edgePenalties
    );
  }

  private reconstructRoute(
    reached: number,
    prev: Int32Array,
    best: Float64Array,
    departureTime: Date,
    snapStartMeters: number,
    snapDestMeters: number,
    speedProfiles?: SpeedProfileEngine,
    incidents?: IncidentLayer,
    erp?: ErpEngine,
    encounteredIncidents?: Set<string>,
    edgePenalties?: Map<number, number>
  ): RouteResult {
    const { edges, nodes } = this.graph;
    const path: CompactEdge[] = [];
    for (let c = reached; c !== -1; c = prev[c]) path.push(edges[c]);
    path.reverse();

    // Calculate real unpenalized travel duration
    let seconds: number;
    if (edgePenalties && edgePenalties.size > 0) {
      let unpenalizedSeconds = 0;
      let cumulativeSec = 0;
      for (let i = 0; i < path.length; i++) {
        const edge = path[i];
        const arrivalAtEdge = new Date(departureTime.getTime() + cumulativeSec * 1000);
        const a = nodes[edge.from], b = nodes[edge.to];
        const bearing = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
        const edgeSec = speedProfiles ? speedProfiles.calculateEdgeSeconds(edge, arrivalAtEdge, bearing) : edge.seconds;
        let turnDelay = 0;
        if (i > 0) {
          turnDelay = this.evaluateTurn(path[i - 1], edge).delaySec;
        }
        let incidentDelay = 0;
        if (incidents) {
          const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, arrivalAtEdge);
          incidentDelay = impact.delaySec;
        }
        const fullEdgeSec = edgeSec + turnDelay + incidentDelay;
        const edgeFraction = (i === 0 || (path.length > 1 && i === path.length - 1)) ? 0.5 : 1.0;
        unpenalizedSeconds += edgeSec * edgeFraction + turnDelay + incidentDelay;
        cumulativeSec += fullEdgeSec;
      }
      seconds = unpenalizedSeconds;
    } else {
      // We entered the last edge to detect arrival but the target is mid-segment: refund half of it.
      const lastEdgeSeconds = speedProfiles
        ? speedProfiles.calculateEdgeSeconds(edges[reached], new Date(departureTime.getTime() + best[reached] * 1000))
        : edges[reached].seconds;
      seconds = best[reached] - lastEdgeSeconds * 0.5;
    }

    let metres = path.reduce((sum, e) => sum + e.length, 0);
    metres -= path[0].length * 0.5 + (path.length > 1 ? path[path.length - 1].length * 0.5 : 0);
    metres = Math.max(0, metres);

    // 3. Evaluate ERP tolls along the route
    let totalTollSgd = 0;
    const tolls: RouteToll[] = [];
    if (erp) {
      let cumulativeSec = 0;
      for (const edge of path) {
        const arrivalAtEdge = new Date(departureTime.getTime() + cumulativeSec * 1000);
        const a = nodes[edge.from], b = nodes[edge.to];
        const toll = erp.evaluateSegmentToll(a.lat, a.lng, b.lat, b.lng, arrivalAtEdge);
        if (toll.chargeSgd > 0) {
          totalTollSgd += toll.chargeSgd;
          tolls.push({
            gantryName: toll.gantryName || 'ERP Gantry',
            chargeSgd: toll.chargeSgd,
            arrivalTime: arrivalAtEdge,
          });
        }
        const edgeSec = speedProfiles ? speedProfiles.calculateEdgeSeconds(edge, arrivalAtEdge) : edge.seconds;
        cumulativeSec += edgeSec;
      }
    }

    return {
      distanceMeters: Math.round(metres),
      km: Number((metres / 1000).toFixed(2)),
      durationSeconds: Math.round(seconds),
      minutes: Number((seconds / 60).toFixed(1)),
      edgeCount: path.length,
      edges: path,
      snapStartMeters: Math.round(snapStartMeters),
      snapDestMeters: Math.round(snapDestMeters),
      totalTollSgd: erp && erp.isConfigured() ? Number(totalTollSgd.toFixed(2)) : undefined,
      tollStatus: erp ? (erp.isConfigured() ? 'known' : 'unknown') : undefined,
      tolls: erp && erp.isConfigured() ? tolls : undefined,
      incidentsEncountered: incidents && encounteredIncidents ? Array.from(encounteredIncidents) : undefined,
    };
  }

  /**
   * One-to-many search from origin to multiple targets using single Dijkstra exploration.
   * Settles targets as their shortest path edges are expanded or until a 3,600s cap is reached.
   * Runs in O(V log V + E) for all N targets combined rather than N separate searches.
   */
  public findRoutesToMany(
    origin: { lat: number; lng: number },
    targets: Array<{ id: string; lat: number; lng: number }>,
    options?: RoutingOptions
  ): Map<string, RouteResult | null> {
    const results = new Map<string, RouteResult | null>();
    for (const t of targets) {
      results.set(t.id, null);
    }
    if (targets.length === 0) return results;

    const s = this.graph.findNearestSegment(origin.lat, origin.lng);
    if (!s) return results;

    const { edges, nodes } = this.graph;
    const edgeToTargets = new Map<number, Array<{ id: string; snapMeters: number }>>();
    const unsettledTargets = new Set<string>();

    for (const t of targets) {
      const seg = this.graph.findNearestSegment(t.lat, t.lng);
      if (!seg) continue;
      unsettledTargets.add(t.id);
      for (const e of seg.edges) {
        let list = edgeToTargets.get(e.id);
        if (!list) {
          list = [];
          edgeToTargets.set(e.id, list);
        }
        list.push({ id: t.id, snapMeters: seg.distanceMeters });
      }
    }

    if (unsettledTargets.size === 0) return results;

    const best = new Float64Array(edges.length).fill(Infinity);
    const prev = new Int32Array(edges.length).fill(-1);
    const heap = new MinHeap();

    const departureTime = options?.departureTime || new Date();
    const speedProfiles = options?.speedProfiles;
    const incidents = options?.incidents;
    const erp = options?.erp;
    const encounteredIncidents = new Set<string>();
    const MAX_ELAPSED_CAP_SEC = 3600; // 3,600 s cap per §8 E3

    // Start mid-segment: either direction, half the segment still to travel.
    for (const e of s.edges) {
      if (incidents) {
        const a = nodes[e.from], b = nodes[e.to];
        const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, departureTime);
        if (impact.impassable) continue;
      }
      const initialSeconds = speedProfiles ? speedProfiles.calculateEdgeSeconds(e, departureTime) : e.seconds;
      const penalty = options?.edgePenalties?.get(e.id) ?? 1.0;
      const c = initialSeconds * 0.5 * penalty;
      best[e.id] = c;
      heap.push({ edgeId: e.id, elapsed: c, priority: c });
    }

    while (heap.size > 0 && unsettledTargets.size > 0) {
      const top = heap.pop()!;
      if (top.elapsed > best[top.edgeId]) continue; // Stale entry
      if (top.elapsed > MAX_ELAPSED_CAP_SEC) break; // Reached cap

      // Check if this edge settles any target
      const matchingTargets = edgeToTargets.get(top.edgeId);
      if (matchingTargets) {
        for (const mt of matchingTargets) {
          if (unsettledTargets.has(mt.id)) {
            const route = this.reconstructRoute(
              top.edgeId,
              prev,
              best,
              departureTime,
              s.distanceMeters,
              mt.snapMeters,
              speedProfiles,
              incidents,
              erp,
              encounteredIncidents,
              options?.edgePenalties
            );
            results.set(mt.id, route);
            unsettledTargets.delete(mt.id);
          }
        }
        if (unsettledTargets.size === 0) break;
      }

      const cur = edges[top.edgeId];
      for (const nid of this.graph.outgoingEdges[cur.to]) {
        const next = edges[nid];
        const turn = this.evaluateTurn(cur, next);
        if (!turn.allowed) continue;

        const arrivalMs = departureTime.getTime() + (top.elapsed + turn.delaySec) * 1000;
        const arrivalTime = new Date(arrivalMs);

        let incidentDelay = 0;
        if (incidents) {
          const a = nodes[next.from], b = nodes[next.to];
          const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, arrivalTime);
          if (impact.impassable) continue;
          if (impact.delaySec > 0) {
            incidentDelay = impact.delaySec;
            if (impact.reason) encounteredIncidents.add(impact.reason);
          }
        }

        let nextSeconds = next.seconds;
        if (speedProfiles) {
          const a = nodes[next.from], b = nodes[next.to];
          const bearing = bearingDegrees(a.lat, a.lng, b.lat, b.lng);
          nextSeconds = speedProfiles.calculateEdgeSeconds(next, arrivalTime, bearing);
        }

        const penalty = options?.edgePenalties?.get(next.id) ?? 1.0;
        const cost = top.elapsed + turn.delaySec + incidentDelay + nextSeconds * penalty;
        if (cost < best[nid]) {
          best[nid] = cost;
          prev[nid] = top.edgeId;
          heap.push({ edgeId: nid, elapsed: cost, priority: cost });
        }
      }
    }

    return results;
  }

  /**
   * Generates alternative routes using the edge penalty method (Phase 4).
   * Traversed edges in accepted routes are penalized by penaltyMultiplier (default 1.35x).
   * A candidate alternative is accepted only if its spatial length overlap with each
   * already-accepted route is below maxOverlap (default 65%).
   * Returns up to maxRoutes (default 3) spatially distinct routes.
   */
  public findAlternatives(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number },
    options?: AlternativeRoutingOptions
  ): RouteResult[] {
    const maxRoutes = options?.maxRoutes ?? 3;
    const penaltyMultiplier = options?.penaltyMultiplier ?? 1.35;
    const maxOverlap = options?.maxOverlap ?? 0.65;
    const maxIterations = options?.maxIterations ?? 8;

    const primary = this.findRoute(origin, dest, options);
    if (!primary) return [];

    const accepted: RouteResult[] = [primary];
    if (maxRoutes <= 1) return accepted;

    const edgePenalties = new Map<number, number>();
    for (const e of primary.edges) {
      edgePenalties.set(e.id, (edgePenalties.get(e.id) ?? 1.0) * penaltyMultiplier);
      for (const outId of this.graph.outgoingEdges[e.from]) {
        if (this.graph.edges[outId].to === e.to) {
          edgePenalties.set(outId, (edgePenalties.get(outId) ?? 1.0) * penaltyMultiplier);
        }
      }
    }

    let iteration = 0;
    while (accepted.length < maxRoutes && iteration < maxIterations) {
      iteration++;
      const candidate = this.findRoute(origin, dest, {
        ...options,
        edgePenalties,
      });
      if (!candidate) break;

      // Reject detours exceeding 1.5x of the primary route's duration per §8 E5
      if (candidate.durationSeconds > primary.durationSeconds * 1.5) {
        continue;
      }

      let maxOverlapFound = 0;
      for (const acc of accepted) {
        const ov = calculateRouteOverlap(candidate, acc);
        if (ov > maxOverlapFound) maxOverlapFound = ov;
      }

      // Penalize candidate edges to discourage repeating identical segments in further iterations
      for (const e of candidate.edges) {
        edgePenalties.set(e.id, (edgePenalties.get(e.id) ?? 1.0) * penaltyMultiplier);
        for (const outId of this.graph.outgoingEdges[e.from]) {
          if (this.graph.edges[outId].to === e.to) {
            edgePenalties.set(outId, (edgePenalties.get(outId) ?? 1.0) * penaltyMultiplier);
          }
        }
      }

      if (maxOverlapFound < maxOverlap) {
        accepted.push(candidate);
      }
    }

    return accepted;
  }
}

/**
 * Calculates the spatial length overlap ratio between two routes.
 * Returns the maximum fraction of shared edge distance relative to either route.
 */
export function calculateRouteOverlap(routeA: RouteResult, routeB: RouteResult): number {
  if (!routeA.edges.length || !routeB.edges.length) return 0;
  const edgeIdsB = new Set(routeB.edges.map((e) => e.id));
  const nodePairsB = new Set(routeB.edges.map((e) => `${e.from}->${e.to}`));
  let sharedMeters = 0;
  let totalMetersA = 0;
  let totalMetersB = 0;

  for (const e of routeA.edges) {
    totalMetersA += e.length;
    if (edgeIdsB.has(e.id) || nodePairsB.has(`${e.from}->${e.to}`)) {
      sharedMeters += e.length;
    }
  }
  for (const e of routeB.edges) {
    totalMetersB += e.length;
  }

  if (totalMetersA === 0 || totalMetersB === 0) return 0;
  return Math.max(sharedMeters / totalMetersA, sharedMeters / totalMetersB);
}
