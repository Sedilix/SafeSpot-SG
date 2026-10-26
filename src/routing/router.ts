/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * router.ts: Time-dependent A* over an edge-based graph (state = directed edge)
 * with turn restrictions, turn delays, dynamic speed profiles, live incident
 * closures, and ERP toll evaluation (Phase 2).
 */

import { RoadGraph, CompactEdge, haversineMeters, bearingDegrees } from './graph';
import { SpeedProfileEngine, DayType } from './speedProfiles';
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

class FlatMinHeap {
  public edgeIds: Int32Array;
  public elapsedArr: Float64Array;
  public priorityArr: Float64Array;
  private _size = 0;

  constructor(capacity = 131072) {
    this.edgeIds = new Int32Array(capacity);
    this.elapsedArr = new Float64Array(capacity);
    this.priorityArr = new Float64Array(capacity);
  }

  get size(): number { return this._size; }
  clear(): void { this._size = 0; }

  private grow(): void {
    const newCap = this.edgeIds.length * 2;
    const newEdges = new Int32Array(newCap);
    newEdges.set(this.edgeIds);
    this.edgeIds = newEdges;

    const newElapsed = new Float64Array(newCap);
    newElapsed.set(this.elapsedArr);
    this.elapsedArr = newElapsed;

    const newPriority = new Float64Array(newCap);
    newPriority.set(this.priorityArr);
    this.priorityArr = newPriority;
  }

  push(edgeId: number, elapsed: number, priority: number): void {
    if (this._size >= this.edgeIds.length) this.grow();
    let i = this._size++;
    const edges = this.edgeIds;
    const elapseds = this.elapsedArr;
    const priorities = this.priorityArr;

    edges[i] = edgeId;
    elapseds[i] = elapsed;
    priorities[i] = priority;

    while (i > 0) {
      const p = (i - 1) >> 1;
      if (priorities[p] <= priorities[i]) break;
      const te = edges[p], tel = elapseds[p], tp = priorities[p];
      edges[p] = edges[i]; elapseds[p] = elapseds[i]; priorities[p] = priorities[i];
      edges[i] = te; elapseds[i] = tel; priorities[i] = tp;
      i = p;
    }
  }

  pop(out: { edgeId: number; elapsed: number }): boolean {
    if (this._size === 0) return false;
    const edges = this.edgeIds;
    const elapseds = this.elapsedArr;
    const priorities = this.priorityArr;

    out.edgeId = edges[0];
    out.elapsed = elapseds[0];

    const last = --this._size;
    if (last > 0) {
      edges[0] = edges[last];
      elapseds[0] = elapseds[last];
      priorities[0] = priorities[last];

      let i = 0;
      for (;;) {
        const l = (i << 1) + 1, r = l + 1;
        let m = i;
        if (l < this._size && priorities[l] < priorities[m]) m = l;
        if (r < this._size && priorities[r] < priorities[m]) m = r;
        if (m === i) break;
        const te = edges[m], tel = elapseds[m], tp = priorities[m];
        edges[m] = edges[i]; elapseds[m] = elapseds[i]; priorities[m] = priorities[i];
        edges[i] = te; elapseds[i] = tel; priorities[i] = tp;
        i = m;
      }
    }
    return true;
  }
}

export class Router {
  public static readonly DELAY_STRAIGHT_SEC = 2.0;
  public static readonly DELAY_LEFT_SEC = 5.0;
  public static readonly DELAY_RIGHT_SEC = 18.0;
  public static readonly DELAY_UTURN_SEC = 28.0;
  /**
   * Expected wait at a signalized junction for movements that would otherwise cost less
   * (straight, left). UNVERIFIED heuristic: random arrival at a ~120 s cycle with a green wave
   * on arterials; to be replaced by measured values in Fix H.
   */
  public static readonly DELAY_SIGNAL_SEC = 9.0;
  private static readonly MAX_SPEED_MS = 90 / 3.6;
  /** Heuristic slack (m) so the half-edge accounting at the destination can't make h inadmissible. */
  private static readonly HEURISTIC_SLACK_M = 200;

  private heap = new FlatMinHeap();
  private popItem = { edgeId: 0, elapsed: 0 };
  private best: Float64Array;
  private prev: Int32Array;
  private enteredFromWay: Int32Array;

  constructor(private graph: RoadGraph) {
    this.best = new Float64Array(graph.edges.length);
    this.prev = new Int32Array(graph.edges.length);
    this.enteredFromWay = new Int32Array(graph.edges.length);
  }

  /** Signed turn angle in degrees, positive = right, in (-180, 180]. */
  public turnAngle(from: CompactEdge, to: CompactEdge): number {
    return ((this.graph.edgeBearings[to.id] - this.graph.edgeBearings[from.id] + 540) % 360) - 180;
  }

  /** True when `from` -> `to` enters a traffic-signal cluster (one charge per signalized junction). */
  public chargesSignal(from: CompactEdge, to: CompactEdge): boolean {
    const via = from.to;
    if (!this.graph.hasTrafficSignal[via] || to.to === from.from) return false;
    return this.graph.signalCluster[from.from] !== this.graph.signalCluster[via];
  }

  /** Whether `from` -> `to` is legal, and the delay it costs. */
  /**
   * Fast inline turn evaluation returning turn delay in seconds, or -1 if the turn is illegal.
   * Avoids object allocation and property lookups in the inner Dijkstra loop.
   */
  public evaluateTurnDelayFast(
    curId: number,
    nid: number,
    curWayId: number,
    nextWayId: number,
    fromNode: number,
    viaNode: number,
    toNode: number
  ): number {
    const isReverse = toNode === fromNode;

    if (this.graph.hasRestrictions[viaNode]) {
      for (const r of this.graph.restrictionsAt(curWayId, viaNode)) {
        const toMatches = nextWayId === r.toWayId;
        if (r.type === 'no_u_turn') {
          if (toMatches && (isReverse || Math.abs(((this.graph.edgeBearings[nid] - this.graph.edgeBearings[curId] + 540) % 360) - 180) > 135)) {
            return -1;
          }
        } else if (r.type.startsWith('no_')) {
          if (!toMatches) continue;
          if (curWayId !== r.toWayId) return -1;
          const a = ((this.graph.edgeBearings[nid] - this.graph.edgeBearings[curId] + 540) % 360) - 180;
          if ((r.type === 'no_left_turn' && a < -30) || (r.type === 'no_right_turn' && a > 30) ||
              (r.type === 'no_straight_on' && Math.abs(a) <= 30)) return -1;
        } else if (r.type.startsWith('only_')) {
          if (!toMatches) return -1;
          if (isReverse && r.type !== 'only_u_turn') return -1;
        }
      }
    }

    if (isReverse) {
      const start = this.graph.outgoingOffsets[viaNode];
      const end = this.graph.outgoingOffsets[viaNode + 1];
      for (let k = start; k < end; k++) {
        if (this.graph.edgeTo[this.graph.outgoingEdgeIds[k]] !== fromNode) return -1;
      }
      return Router.DELAY_UTURN_SEC;
    }

    const signal = (this.graph.hasTrafficSignal[viaNode] && !isReverse && this.graph.signalCluster[fromNode] !== this.graph.signalCluster[viaNode])
      ? Router.DELAY_SIGNAL_SEC
      : 0;

    if (!this.graph.isJunction[viaNode]) return signal;

    const a = ((this.graph.edgeBearings[nid] - this.graph.edgeBearings[curId] + 540) % 360) - 180;
    if (Math.abs(a) > 135) return Math.max(signal, Router.DELAY_UTURN_SEC);
    if (a > 30) return Math.max(signal, Router.DELAY_RIGHT_SEC);
    if (a < -30) return Math.max(signal, Router.DELAY_LEFT_SEC);
    return Math.max(signal, Router.DELAY_STRAIGHT_SEC);
  }

  /** Whether `from` -> `to` is legal, and the delay it costs. */
  public evaluateTurn(from: CompactEdge, to: CompactEdge): { allowed: boolean; delaySec: number } {
    const d = this.evaluateTurnDelayFast(from.id, to.id, from.wayId, to.wayId, from.from, from.to, to.to);
    return { allowed: d >= 0, delaySec: Math.max(0, d) };
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

    if (this.best.length !== edges.length) {
      this.best = new Float64Array(edges.length);
      this.prev = new Int32Array(edges.length);
      this.enteredFromWay = new Int32Array(edges.length);
    }
    const best = this.best;
    const prev = this.prev;
    const enteredFromWay = this.enteredFromWay;
    best.fill(Infinity);
    prev.fill(-1);
    enteredFromWay.fill(0);

    const heap = this.heap;
    heap.clear();
    const popObj = this.popItem;

    const destLat = dest.lat, destLng = dest.lng;
    const destCos = Math.cos((destLat * Math.PI) / 180);
    const hFast = (toNode: number) => {
      const dx = (destLng - this.graph.nodeLng[toNode]) * destCos;
      const dy = destLat - this.graph.nodeLat[toNode];
      return (Math.sqrt(dx * dx + dy * dy) * 111000) / Router.MAX_SPEED_MS;
    };

    const departureTime = options?.departureTime || new Date();
    const speedProfiles = options?.speedProfiles;
    const incidents = options?.incidents;
    const erp = options?.erp;
    const hasIncidents = incidents && incidents.count > 0;
    const hasPenalties = options?.edgePenalties && options.edgePenalties.size > 0;
    const encounteredIncidents = new Set<string>();

    const baseDayType = speedProfiles ? SpeedProfileEngine.getDayType(departureTime) : 'WEEKDAY';
    const baseSgtMs = departureTime.getTime() + 8 * 3600 * 1000;
    const dSgt = new Date(baseSgtMs);
    const baseDaySec = dSgt.getUTCHours() * 3600 + dSgt.getUTCMinutes() * 60 + dSgt.getUTCSeconds();
    const baseSlot = Math.floor(baseDaySec / 900);

    // Start mid-segment: either direction, half the segment still to travel.
    for (const e of s.edges) {
      if (hasIncidents) {
        const a = nodes[e.from], b = nodes[e.to];
        const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, departureTime);
        if (impact.impassable) continue;
      }
      const initialSeconds = speedProfiles
        ? speedProfiles.calculateEdgeSecondsFast(
            e.id,
            this.graph.edgeLength[e.id],
            this.graph.edgeMaxspeed[e.id],
            this.graph.edgeBaseSpeeds[e.id],
            this.graph.edgeBearings[e.id],
            this.graph.edgeHighwayType[e.id],
            this.graph.edgeSchoolSilver[e.id],
            baseDayType,
            baseSlot
          )
        : this.graph.edgeSeconds[e.id];

      const penalty = hasPenalties ? (options?.edgePenalties?.get(e.id) ?? 1.0) : 1.0;
      const c = initialSeconds * 0.5 * penalty;
      best[e.id] = c;
      heap.push(e.id, c, c + hFast(e.to));
    }

    let reached = -1;
    while (heap.size) {
      heap.pop(popObj);
      const topEdgeId = popObj.edgeId;
      const topElapsed = popObj.elapsed;

      if (topElapsed > best[topEdgeId]) continue; // stale entry (Float64: exact comparison is safe)
      if (targetIds.has(topEdgeId)) { reached = topEdgeId; break; }
      const cur = edges[topEdgeId];

      const startOut = this.graph.outgoingOffsets[cur.to];
      const endOut = this.graph.outgoingOffsets[cur.to + 1];

      for (let j = startOut; j < endOut; j++) {
        const nid = this.graph.outgoingEdgeIds[j];
        const next = edges[nid];
        const fromWayId = enteredFromWay[topEdgeId];
        if (fromWayId > 0 && cur.wayId !== next.wayId && this.graph.viaWayIds.has(cur.wayId) && this.graph.isViaWayRestricted(fromWayId, cur.wayId, next.wayId)) {
          continue;
        }

        const turnDelay = this.evaluateTurnDelayFast(topEdgeId, nid, cur.wayId, next.wayId, cur.from, cur.to, next.to);
        if (turnDelay < 0) continue;

        const arrivalElapsed = topElapsed + turnDelay;

        // 1. Live Incidents: impassable closures and decay delays
        let incidentDelay = 0;
        if (hasIncidents) {
          const arrivalTime = new Date(departureTime.getTime() + arrivalElapsed * 1000);
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
        let nextSeconds: number;
        if (speedProfiles) {
          const slotIndex = Math.floor((baseDaySec + arrivalElapsed) / 900) % 96;
          nextSeconds = speedProfiles.calculateEdgeSecondsFast(
            nid,
            this.graph.edgeLength[nid],
            this.graph.edgeMaxspeed[nid],
            this.graph.edgeBaseSpeeds[nid],
            this.graph.edgeBearings[nid],
            this.graph.edgeHighwayType[nid],
            this.graph.edgeSchoolSilver[nid],
            baseDayType,
            slotIndex
          );
        } else {
          nextSeconds = this.graph.edgeSeconds[nid];
        }

        const penalty = hasPenalties ? (options?.edgePenalties?.get(nid) ?? 1.0) : 1.0;
        const cost = arrivalElapsed + incidentDelay + nextSeconds * penalty;
        if (cost < best[nid]) {
          best[nid] = cost;
          prev[nid] = topEdgeId;
          enteredFromWay[nid] = (next.wayId === cur.wayId) ? fromWayId : cur.wayId;
          heap.push(nid, cost, cost + hFast(next.to));
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
      options?.edgePenalties,
      baseDayType,
      baseDaySec
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
    edgePenalties?: Map<number, number>,
    baseDayType: DayType = 'WEEKDAY',
    baseDaySec = 0
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
      let lastEdgeSeconds: number;
      if (speedProfiles) {
        const arrivalElapsed = best[reached];
        const slot = Math.floor((baseDaySec + arrivalElapsed) / 900) % 96;
        lastEdgeSeconds = speedProfiles.calculateEdgeSecondsFast(
          reached,
          this.graph.edgeLength[reached],
          this.graph.edgeMaxspeed[reached],
          this.graph.edgeBaseSpeeds[reached],
          this.graph.edgeBearings[reached],
          this.graph.edgeHighwayType[reached],
          this.graph.edgeSchoolSilver[reached],
          baseDayType,
          slot
        );
      } else {
        lastEdgeSeconds = edges[reached].seconds;
      }
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
    const enteredFromWay = new Int32Array(edges.length);
    const heap = new FlatMinHeap();
    const popObj = { edgeId: 0, elapsed: 0 };

    const departureTime = options?.departureTime || new Date();
    const speedProfiles = options?.speedProfiles;
    const incidents = options?.incidents;
    const erp = options?.erp;
    const hasIncidents = incidents && incidents.count > 0;
    const hasPenalties = options?.edgePenalties && options.edgePenalties.size > 0;
    const encounteredIncidents = new Set<string>();
    const MAX_ELAPSED_CAP_SEC = 3600; // 3,600 s cap per §8 E3

    const baseDayType = speedProfiles ? SpeedProfileEngine.getDayType(departureTime) : 'WEEKDAY';
    const baseSgtMs = departureTime.getTime() + 8 * 3600 * 1000;
    const dSgt = new Date(baseSgtMs);
    const baseDaySec = dSgt.getUTCHours() * 3600 + dSgt.getUTCMinutes() * 60 + dSgt.getUTCSeconds();
    const baseSlot = Math.floor(baseDaySec / 900);

    // Start mid-segment: either direction, half the segment still to travel.
    for (const e of s.edges) {
      if (hasIncidents) {
        const a = nodes[e.from], b = nodes[e.to];
        const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, departureTime);
        if (impact.impassable) continue;
      }
      const initialSeconds = speedProfiles
        ? speedProfiles.calculateEdgeSecondsFast(
            e.id,
            this.graph.edgeLength[e.id],
            this.graph.edgeMaxspeed[e.id],
            this.graph.edgeBaseSpeeds[e.id],
            this.graph.edgeBearings[e.id],
            this.graph.edgeHighwayType[e.id],
            this.graph.edgeSchoolSilver[e.id],
            baseDayType,
            baseSlot
          )
        : this.graph.edgeSeconds[e.id];

      const penalty = hasPenalties ? (options?.edgePenalties?.get(e.id) ?? 1.0) : 1.0;
      const c = initialSeconds * 0.5 * penalty;
      best[e.id] = c;
      heap.push(e.id, c, c);
    }

    while (heap.size > 0 && unsettledTargets.size > 0) {
      heap.pop(popObj);
      const topEdgeId = popObj.edgeId;
      const topElapsed = popObj.elapsed;

      if (topElapsed > best[topEdgeId]) continue; // Stale entry
      if (topElapsed > MAX_ELAPSED_CAP_SEC) break; // Reached cap

      // Check if this edge settles any target
      const matchingTargets = edgeToTargets.get(topEdgeId);
      if (matchingTargets) {
        for (const mt of matchingTargets) {
          if (unsettledTargets.has(mt.id)) {
            const route = this.reconstructRoute(
              topEdgeId,
              prev,
              best,
              departureTime,
              s.distanceMeters,
              mt.snapMeters,
              speedProfiles,
              incidents,
              erp,
              encounteredIncidents,
              options?.edgePenalties,
              baseDayType,
              baseDaySec
            );
            results.set(mt.id, route);
            unsettledTargets.delete(mt.id);
          }
        }
        if (unsettledTargets.size === 0) break;
      }

      const cur = edges[topEdgeId];
      const startOut = this.graph.outgoingOffsets[cur.to];
      const endOut = this.graph.outgoingOffsets[cur.to + 1];

      for (let j = startOut; j < endOut; j++) {
        const nid = this.graph.outgoingEdgeIds[j];
        const next = edges[nid];
        const fromWayId = enteredFromWay[topEdgeId];
        if (fromWayId > 0 && cur.wayId !== next.wayId && this.graph.viaWayIds.has(cur.wayId) && this.graph.isViaWayRestricted(fromWayId, cur.wayId, next.wayId)) {
          continue;
        }

        const turnDelay = this.evaluateTurnDelayFast(topEdgeId, nid, cur.wayId, next.wayId, cur.from, cur.to, next.to);
        if (turnDelay < 0) continue;

        const arrivalElapsed = topElapsed + turnDelay;

        let incidentDelay = 0;
        if (hasIncidents) {
          const arrivalTime = new Date(departureTime.getTime() + arrivalElapsed * 1000);
          const a = nodes[next.from], b = nodes[next.to];
          const impact = incidents.evaluateEdgeImpact(a.lat, a.lng, b.lat, b.lng, arrivalTime);
          if (impact.impassable) continue;
          if (impact.delaySec > 0) {
            incidentDelay = impact.delaySec;
            if (impact.reason) encounteredIncidents.add(impact.reason);
          }
        }

        let nextSeconds: number;
        if (speedProfiles) {
          const slotIndex = Math.floor((baseDaySec + arrivalElapsed) / 900) % 96;
          nextSeconds = speedProfiles.calculateEdgeSecondsFast(
            nid,
            this.graph.edgeLength[nid],
            this.graph.edgeMaxspeed[nid],
            this.graph.edgeBaseSpeeds[nid],
            this.graph.edgeBearings[nid],
            this.graph.edgeHighwayType[nid],
            this.graph.edgeSchoolSilver[nid],
            baseDayType,
            slotIndex
          );
        } else {
          nextSeconds = this.graph.edgeSeconds[nid];
        }

        const penalty = hasPenalties ? (options?.edgePenalties?.get(nid) ?? 1.0) : 1.0;
        const cost = arrivalElapsed + incidentDelay + nextSeconds * penalty;
        if (cost < best[nid]) {
          best[nid] = cost;
          prev[nid] = topEdgeId;
          enteredFromWay[nid] = (next.wayId === cur.wayId) ? fromWayId : cur.wayId;
          heap.push(nid, cost, cost);
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
