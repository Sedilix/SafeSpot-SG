/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * build-graph.ts: Builds the compact Singapore road graph from OpenStreetMap.
 * Queries Overpass with a local disk cache (data/graph/overpass-cache.json) and
 * writes data/graph/singapore-road-graph.json.
 *
 *   npx tsx tools/osm/build-graph.ts
 *
 * Modelling notes:
 * - Every OSM way is split into one directed edge per geometry segment. Nodes
 *   are identified by coordinate (Overpass `geom` output carries no node ids),
 *   so two ways meet only where they share an exact coordinate.
 * - Turn restrictions are resolved to the graph node of their `via` node.
 *   Restrictions whose via is a way, or whose via node isn't in the graph, are
 *   counted and skipped (reported below), not silently applied.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface CompactNode { id: number; lat: number; lng: number }

export interface CompactEdge {
  id: number;
  from: number;
  to: number;
  length: number;    // metres
  maxspeed: number;  // km/h
  seconds: number;   // free-flow traversal seconds (length / maxspeed)
  wayId: number;
  name: string;
  highway: string;
  oneway: boolean;
  busLane?: string;
}

export interface TurnRestriction {
  type: string;       // OSM restriction=* value
  fromWayId: number;
  toWayId: number;
  viaNode: number;    // graph node id
}

export interface RoadGraphData {
  nodes: CompactNode[];
  edges: CompactEdge[];
  turnRestrictions: TurnRestriction[];
  generatedAt: string;
  stats: Record<string, number>;
}

const GRAPH_DIR = join(process.cwd(), 'data', 'graph');
const CACHE_FILE = join(GRAPH_DIR, 'overpass-cache.json');
const OUTPUT_FILE = join(GRAPH_DIR, 'singapore-road-graph.json');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Fallback speeds by highway class when OSM has no maxspeed (ASSUMPTION; ~96% of SG ways are tagged).
const DEFAULT_SPEEDS: Record<string, number> = {
  motorway: 90, motorway_link: 60, trunk: 70, trunk_link: 50, primary: 60, primary_link: 50,
  secondary: 50, secondary_link: 40, tertiary: 50, tertiary_link: 40, unclassified: 50,
  residential: 50, living_street: 30,
};

// Operating free-flow speed assumption by highway class (km/h) in urban Singapore.
// Signals every 200-400m and urban deceleration limit actual progression below legal maxspeed.
export const FREE_FLOW_SPEED_ASSUMPTIONS: Record<string, number> = {
  motorway: 68,
  motorway_link: 40,
  trunk: 48,
  trunk_link: 35,
  primary: 28,
  primary_link: 25,
  secondary: 25,
  secondary_link: 22,
  tertiary: 24,
  tertiary_link: 20,
  unclassified: 22,
  residential: 20,
  living_street: 15,
};

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function parseMaxspeed(val: string | undefined, highway: string): number {
  if (val) {
    const m = /^(\d+(?:\.\d+)?)\s*(mph)?$/.exec(val.trim());
    if (m) {
      const kmh = m[2] ? Number(m[1]) * 1.609 : Number(m[1]);
      if (kmh > 0 && kmh <= 130) return Math.round(kmh);
    }
  }
  return DEFAULT_SPEEDS[highway] ?? 50;
}

async function fetchFromOverpass(): Promise<any> {
  if (existsSync(CACHE_FILE)) {
    console.log(`Using cached Overpass data: ${CACHE_FILE}`);
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  }
  const query = `[out:json][timeout:240];
area["ISO3166-1"="SG"]->.sg;
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|living_street)$"]["access"!~"^(no|private)$"](area.sg);
  relation["type"="restriction"](area.sg);
);
out body geom qt;`;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying ${url} ...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'SafeSpot-SG-graph-builder/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) { console.warn(`  HTTP ${res.status}`); continue; }
      const json = (await res.json()) as any;
      if (json.elements?.length) {
        mkdirSync(GRAPH_DIR, { recursive: true });
        writeFileSync(CACHE_FILE, JSON.stringify(json));
        return json;
      }
    } catch (err: any) {
      console.warn(`  failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed.');
}

export function buildGraphFromElements(elements: any[]): RoadGraphData {
  const nodeMap = new Map<string, number>();
  const nodes: CompactNode[] = [];
  const edges: CompactEdge[] = [];
  const pending: Array<{ type: string; fromWayId: number; toWayId: number; viaKey: string }> = [];
  let viaWayRestrictions = 0, incompleteRestrictions = 0;

  const keyOf = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  function nodeFor(lat: number, lng: number): number {
    const key = keyOf(lat, lng);
    let id = nodeMap.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ id, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
      nodeMap.set(key, id);
    }
    return id;
  }

  for (const el of elements) {
    if (el.type === 'relation') {
      const type = el.tags?.restriction;
      if (!type) { incompleteRestrictions++; continue; }
      let fromWayId: number | undefined, toWayId: number | undefined, via: any;
      let viaIsWay = false;
      for (const m of el.members ?? []) {
        if (m.role === 'from' && m.type === 'way') fromWayId = m.ref;
        else if (m.role === 'to' && m.type === 'way') toWayId = m.ref;
        else if (m.role === 'via' && m.type === 'node') via = m;
        else if (m.role === 'via' && m.type === 'way') viaIsWay = true;
      }
      if (viaIsWay) { viaWayRestrictions++; continue; }
      if (fromWayId === undefined || toWayId === undefined || !via) { incompleteRestrictions++; continue; }
      pending.push({ type, fromWayId, toWayId, viaKey: keyOf(via.lat, via.lon) });
      continue;
    }

    if (el.type !== 'way' || !el.tags?.highway || (el.geometry?.length ?? 0) < 2) continue;
    const t = el.tags;
    const highway: string = t.highway;
    const maxspeed = parseMaxspeed(t.maxspeed, highway);
    const freeFlowCap = FREE_FLOW_SPEED_ASSUMPTIONS[highway] ?? 25;
    const effectiveSpeed = Math.min(maxspeed, freeFlowCap);
    const speedMs = effectiveSpeed / 3.6;
    const name: string = t.name || t['name:en'] || t.ref || '';
    const implied = highway === 'motorway' || highway === 'motorway_link' || t.junction === 'roundabout';
    const reverse = t.oneway === '-1';
    const forwardOnly = t.oneway === 'yes' || t.oneway === '1' || (implied && t.oneway !== 'no');
    const busLane: string | undefined = t['bus:lanes:conditional'] || t['bus:lanes'] || t['lanes:bus'] || undefined;

    for (let i = 0; i < el.geometry.length - 1; i++) {
      const p = el.geometry[i], q = el.geometry[i + 1];
      const a = nodeFor(p.lat, p.lon), b = nodeFor(q.lat, q.lon);
      if (a === b) continue; // identical coordinates
      // Keep sub-metre segments (floor 0.1 m): dropping them would break the way's node chain.
      const length = Math.max(0.1, haversine(p.lat, p.lon, q.lat, q.lon));
      const base = { length: Number(length.toFixed(2)), maxspeed, seconds: Number((length / speedMs).toFixed(3)), wayId: el.id, name, highway, busLane };
      const oneway = forwardOnly || reverse;
      if (!reverse) edges.push({ id: edges.length, from: a, to: b, ...base, oneway });
      if (!forwardOnly) edges.push({ id: edges.length, from: b, to: a, ...base, oneway });
    }
  }

  const turnRestrictions: TurnRestriction[] = [];
  const wayIdsInGraph = new Set<number>(edges.map((e) => e.wayId));
  let viaNotInGraph = 0, viaMissingButWaysPresent = 0;
  for (const r of pending) {
    const viaNode = nodeMap.get(r.viaKey);
    if (viaNode === undefined) {
      viaNotInGraph++;
      // Expected when the restriction concerns service roads we excluded; a real loss if both ways are in the graph.
      if (wayIdsInGraph.has(r.fromWayId) && wayIdsInGraph.has(r.toWayId)) viaMissingButWaysPresent++;
      continue;
    }
    turnRestrictions.push({ type: r.type, fromWayId: r.fromWayId, toWayId: r.toWayId, viaNode });
  }

  return {
    nodes, edges, turnRestrictions, generatedAt: new Date().toISOString(),
    stats: {
      nodes: nodes.length, edges: edges.length, restrictionsKept: turnRestrictions.length,
      restrictionsSkippedViaWay: viaWayRestrictions, restrictionsSkippedIncomplete: incompleteRestrictions,
      restrictionsSkippedViaNotInGraph: viaNotInGraph,
      restrictionsSkippedViaNotInGraphButBothWaysPresent: viaMissingButWaysPresent,
    },
  };
}

export async function buildRoadGraph(): Promise<RoadGraphData> {
  const data = buildGraphFromElements((await fetchFromOverpass()).elements ?? []);
  mkdirSync(GRAPH_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(data));
  console.log('Graph built:', data.stats, '->', OUTPUT_FILE);
  return data;
}

// Run only when executed directly (import.meta.url comparison is unreliable on Windows paths).
const entry = process.argv[1]?.replace(/\\/g, '/');
if (entry && /tools\/osm\/build-graph\.(ts|js)$/.test(entry)) {
  buildRoadGraph().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}

