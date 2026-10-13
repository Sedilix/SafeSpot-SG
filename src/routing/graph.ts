/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * graph.ts: in-memory directed road graph with a spatial grid for snapping,
 * junction flags and turn restrictions indexed by (from-way, via-node).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface CompactNode { id: number; lat: number; lng: number }

export interface CompactEdge {
  id: number;
  from: number;
  to: number;
  length: number;
  maxspeed: number;
  seconds: number;
  wayId: number;
  name: string;
  highway: string;
  oneway: boolean;
  busLane?: string;
}

export interface TurnRestriction {
  type: string;
  fromWayId: number;
  toWayId: number;
  viaNode: number;
}

export interface RoadGraphData {
  nodes: CompactNode[];
  edges: CompactEdge[];
  turnRestrictions: TurnRestriction[];
  generatedAt?: string;
  stats?: Record<string, number>;
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Distance (m) from point p to segment a-b (local equirectangular approximation). */
export function pointToSegmentDistance(pLat: number, pLng: number, aLat: number, aLng: number, bLat: number, bLng: number): number {
  const k = Math.cos(rad(pLat));
  const ax = (aLng - pLng) * k, ay = aLat - pLat;
  const bx = (bLng - pLng) * k, by = bLat - pLat;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq)) : 0;
  const px = ax + t * dx, py = ay + t * dy;
  return Math.sqrt(px * px + py * py) * (Math.PI / 180) * R;
}

export interface Snap {
  /** All directed edges of the nearest road segment (both directions on a two-way road). */
  edges: CompactEdge[];
  distanceMeters: number;
}

/** Classes a car can't be dropped onto from an arbitrary point (limited access). */
const NOT_SNAPPABLE = new Set(['motorway', 'motorway_link']);

const EMPTY_RESTRICTIONS: TurnRestriction[] = [];

export class RoadGraph {
  public nodes: CompactNode[];
  public edges: CompactEdge[];
  public outgoingEdges: number[][];
  /** 1 where 3+ distinct neighbouring nodes meet: only there do turn delays/angles apply. */
  public isJunction: Uint8Array;

  // Typed arrays for high-performance cache-friendly routing
  public nodeLat: Float64Array;
  public nodeLng: Float64Array;
  public nodeCos: Float32Array;
  public edgeFrom: Int32Array;
  public edgeTo: Int32Array;
  public edgeLength: Float32Array;
  public edgeSeconds: Float32Array;
  public edgeMaxspeed: Uint8Array;
  public edgeWayId: Int32Array;
  public edgeBearings: Float32Array;
  public edgeBaseSpeeds: Float32Array;
  public edgeSchoolSilver: Uint8Array;
  public edgeHighwayType: Uint8Array;
  public outgoingOffsets: Int32Array;
  public outgoingEdgeIds: Int32Array;
  public hasRestrictions: Uint8Array;

  private restrictionIndex = new Map<string, TurnRestriction[]>();
  private grid = new Map<number, number[]>();
  private static readonly GRID_SCALE = 100; // ~1.1 km cells

  constructor(data: RoadGraphData) {
    this.nodes = data.nodes;
    this.edges = data.edges;
    const N = this.nodes.length;
    const M = this.edges.length;

    this.outgoingEdges = Array.from({ length: N }, () => [] as number[]);
    const neighbours: Array<Set<number>> = Array.from({ length: N }, () => new Set<number>());

    this.nodeLat = new Float64Array(N);
    this.nodeLng = new Float64Array(N);
    this.nodeCos = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.nodeLat[i] = this.nodes[i].lat;
      this.nodeLng[i] = this.nodes[i].lng;
      this.nodeCos[i] = Math.cos((this.nodes[i].lat * Math.PI) / 180);
    }

    this.edgeFrom = new Int32Array(M);
    this.edgeTo = new Int32Array(M);
    this.edgeLength = new Float32Array(M);
    this.edgeSeconds = new Float32Array(M);
    this.edgeMaxspeed = new Uint8Array(M);
    this.edgeWayId = new Int32Array(M);
    this.edgeBearings = new Float32Array(M);
    this.edgeBaseSpeeds = new Float32Array(M);
    this.edgeSchoolSilver = new Uint8Array(M);
    this.edgeHighwayType = new Uint8Array(M);

    for (let i = 0; i < M; i++) {
      const e = this.edges[i];
      this.outgoingEdges[e.from].push(e.id);
      neighbours[e.from].add(e.to);
      neighbours[e.to].add(e.from);
      this.indexEdge(e);

      this.edgeFrom[i] = e.from;
      this.edgeTo[i] = e.to;
      this.edgeLength[i] = e.length;
      this.edgeSeconds[i] = e.seconds;
      this.edgeMaxspeed[i] = e.maxspeed;
      this.edgeWayId[i] = e.wayId;

      const aLat = this.nodeLat[e.from], aLng = this.nodeLng[e.from];
      const bLat = this.nodeLat[e.to], bLng = this.nodeLng[e.to];
      this.edgeBearings[i] = bearingDegrees(aLat, aLng, bLat, bLng);
      this.edgeBaseSpeeds[i] = (e.length / e.seconds) * 3.6;

      const nl = (e.name || '').toLowerCase();
      if (nl.includes('school') || nl.includes('primary')) this.edgeSchoolSilver[i] = 1;
      else if (nl.includes('silver zone')) this.edgeSchoolSilver[i] = e.highway === 'residential' ? 3 : 2;

      if (e.highway === 'motorway' || e.highway === 'motorway_link') this.edgeHighwayType[i] = 1;
      else if (e.highway === 'trunk' || e.highway === 'primary' || e.highway === 'primary_link') this.edgeHighwayType[i] = 2;
    }

    this.isJunction = new Uint8Array(N);
    for (let i = 0; i < neighbours.length; i++) this.isJunction[i] = neighbours[i].size >= 3 ? 1 : 0;

    // Build CSR for outgoing edges
    this.outgoingOffsets = new Int32Array(N + 1);
    let totalOut = 0;
    for (let i = 0; i < N; i++) {
      this.outgoingOffsets[i] = totalOut;
      totalOut += this.outgoingEdges[i].length;
    }
    this.outgoingOffsets[N] = totalOut;

    this.outgoingEdgeIds = new Int32Array(totalOut);
    for (let i = 0; i < N; i++) {
      const edges = this.outgoingEdges[i];
      const off = this.outgoingOffsets[i];
      for (let j = 0; j < edges.length; j++) {
        this.outgoingEdgeIds[off + j] = edges[j];
      }
    }

    this.hasRestrictions = new Uint8Array(N);
    for (const r of data.turnRestrictions ?? []) {
      if (r.viaNode >= 0 && r.viaNode < N) {
        this.hasRestrictions[r.viaNode] = 1;
      }
      const key = `${r.fromWayId}|${r.viaNode}`;
      const list = this.restrictionIndex.get(key);
      if (list) list.push(r); else this.restrictionIndex.set(key, [r]);
    }
  }

  public restrictionsAt(fromWayId: number, viaNode: number): TurnRestriction[] {
    if (!this.hasRestrictions[viaNode]) return EMPTY_RESTRICTIONS;
    return this.restrictionIndex.get(`${fromWayId}|${viaNode}`) ?? EMPTY_RESTRICTIONS;
  }

  private cell(lat: number, lng: number): number {
    return Math.floor(lat * RoadGraph.GRID_SCALE) * 100000 + Math.floor(lng * RoadGraph.GRID_SCALE);
  }

  private indexEdge(e: CompactEdge): void {
    const a = this.nodes[e.from], b = this.nodes[e.to];
    const S = RoadGraph.GRID_SCALE;
    for (let la = Math.floor(Math.min(a.lat, b.lat) * S); la <= Math.floor(Math.max(a.lat, b.lat) * S); la++) {
      for (let lo = Math.floor(Math.min(a.lng, b.lng) * S); lo <= Math.floor(Math.max(a.lng, b.lng) * S); lo++) {
        const h = la * 100000 + lo;
        const list = this.grid.get(h);
        if (list) list.push(e.id); else this.grid.set(h, [e.id]);
      }
    }
  }

  /**
   * Snap a coordinate to the nearest drivable road segment. Returns every
   * directed edge of that segment (so one-way/two-way is handled by the router
   * choosing the best direction). Limited-access roads are skipped.
   */
  public findNearestSegment(lat: number, lng: number, maxRings = 3): Snap | null {
    const S = RoadGraph.GRID_SCALE;
    const cLat = Math.floor(lat * S), cLng = Math.floor(lng * S);
    let best = Infinity;
    const dist = new Map<number, number>();

    for (let ring = 0; ring <= maxRings; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (ring > 0 && Math.abs(dy) < ring && Math.abs(dx) < ring) continue;
          for (const id of this.grid.get((cLat + dy) * 100000 + (cLng + dx)) ?? []) {
            if (dist.has(id)) continue;
            const e = this.edges[id];
            if (NOT_SNAPPABLE.has(e.highway)) continue;
            const a = this.nodes[e.from], b = this.nodes[e.to];
            const d = pointToSegmentDistance(lat, lng, a.lat, a.lng, b.lat, b.lng);
            dist.set(id, d);
            if (d < best) best = d;
          }
        }
      }
      if (best < 150) break;
    }
    if (!isFinite(best)) return null;
    const picked: CompactEdge[] = [];
    for (const [id, d] of dist) if (d <= best + 0.5) picked.push(this.edges[id]);
    return { edges: picked, distanceMeters: best };
  }

  public static loadDefault(): RoadGraph {
    const p = join(process.cwd(), 'data', 'graph', 'singapore-road-graph.json');
    if (!existsSync(p)) throw new Error(`Road graph not found at ${p}. Run: npx tsx tools/osm/build-graph.ts`);
    return new RoadGraph(JSON.parse(readFileSync(p, 'utf8')));
  }
}
