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
  tolls?: RouteToll[];
  incidentsEncountered?: string[];
}

export interface RoutingOptions {
  departureTime?: Date;
  speedProfiles?: SpeedProfileEngine;
  incidents?: IncidentLayer;
  erp?: ErpEngine;
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
      const c = initialSeconds * 0.5;
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

        const cost = top.elapsed + turn.delaySec + incidentDelay + nextSeconds;
        if (cost < best[nid]) {
          best[nid] = cost;
          prev[nid] = top.edgeId;
          heap.push({ edgeId: nid, elapsed: cost, priority: cost + h(next) });
        }
      }
    }
    if (reached < 0) return null;

    const path: CompactEdge[] = [];
    for (let c = reached; c !== -1; c = prev[c]) path.push(edges[c]);
    path.reverse();

    // We entered the last edge to detect arrival but the target is mid-segment: refund half of it.
    const lastEdgeSeconds = speedProfiles
      ? speedProfiles.calculateEdgeSeconds(edges[reached], new Date(departureTime.getTime() + best[reached] * 1000))
      : edges[reached].seconds;
    const seconds = best[reached] - lastEdgeSeconds * 0.5;

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
      snapStartMeters: Math.round(s.distanceMeters),
      snapDestMeters: Math.round(t.distanceMeters),
      totalTollSgd: erp ? Number(totalTollSgd.toFixed(2)) : undefined,
      tolls: erp ? tolls : undefined,
      incidentsEncountered: incidents ? Array.from(encounteredIncidents) : undefined,
    };
  }
}
