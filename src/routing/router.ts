/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * router.ts: A* over an edge-based graph (state = directed edge) with turn
 * restrictions and turn delays. Free-flow time only (Phase 1): edge cost is
 * length / maxspeed; time-dependent speeds arrive in Phase 2.
 *
 * Assumptions (UNVERIFIED against Singapore ground truth; calibrate in Phase 2):
 *  - Turn delays apply only at junctions (3+ neighbouring nodes), never along
 *    a bend: left 5 s, straight 2 s, right (crosses opposing traffic) 18 s.
 *  - A U-turn (reversing onto the previous node) is only legal at a dead end.
 *    OSM has ~100k no_u_turn relations in Singapore and no data on permitted
 *    U-turn openings, so mid-road U-turns are never offered.
 */

import { RoadGraph, CompactEdge, haversineMeters, bearingDegrees } from './graph';

export interface RouteResult {
  distanceMeters: number;
  km: number;
  durationSeconds: number;
  minutes: number;
  edgeCount: number;
  edges: CompactEdge[];
  snapStartMeters: number;
  snapDestMeters: number;
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

  public findRoute(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }): RouteResult | null {
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

    // Start mid-segment: either direction, half the segment still to travel.
    for (const e of s.edges) {
      const c = e.seconds * 0.5;
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
        const cost = top.elapsed + turn.delaySec + next.seconds;
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
    const seconds = best[reached] - edges[reached].seconds * 0.5;
    let metres = path.reduce((sum, e) => sum + e.length, 0);
    metres -= path[0].length * 0.5 + (path.length > 1 ? path[path.length - 1].length * 0.5 : 0);
    metres = Math.max(0, metres);

    return {
      distanceMeters: Math.round(metres),
      km: Number((metres / 1000).toFixed(2)),
      durationSeconds: Math.round(seconds),
      minutes: Number((seconds / 60).toFixed(1)),
      edgeCount: path.length,
      edges: path,
      snapStartMeters: Math.round(s.distanceMeters),
      snapDestMeters: Math.round(t.distanceMeters),
    };
  }
}
