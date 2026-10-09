/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * build-pedestrian-graph.ts: Builds a compact Singapore pedestrian network graph
 * from Overpass OSM footways, paths, crossings, and steps.
 *
 * Tags parsed:
 *  - covered: yes / indoor: yes / tunnel: yes (Walk2Ride sheltered walkways)
 *  - highway: steps (penalised for senior routing)
 *  - ramp: yes (wheelchair / senior accessible)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface CompactPedestrianNode {
  id: number;
  lat: number;
  lng: number;
}

export interface CompactPedestrianEdge {
  id: number;
  from: number;
  to: number;
  length: number;    // Metres
  covered: boolean;  // Sheltered linkway / covered
  isSteps: boolean;  // Stairs
  hasRamp: boolean;  // Ramp attached
  name: string;
  highway: string;
  wayId: number;
}

export interface PedestrianGraphData {
  nodes: CompactPedestrianNode[];
  edges: CompactPedestrianEdge[];
  generatedAt: string;
  stats: Record<string, number>;
}

const GRAPH_DIR = join(process.cwd(), 'data', 'graph');
const CACHE_FILE = join(GRAPH_DIR, 'overpass-pedestrian-cache.json');
const OUTPUT_FILE = join(GRAPH_DIR, 'singapore-pedestrian-graph.json');

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function buildPedestrianGraphFromElements(elements: any[]): PedestrianGraphData {
  const nodeMap = new Map<string, number>();
  const nodes: CompactPedestrianNode[] = [];
  const edges: CompactPedestrianEdge[] = [];
  let coveredCount = 0;
  let stepsCount = 0;
  let rampCount = 0;

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
    if (el.type !== 'way' || !el.tags?.highway || (el.geometry?.length ?? 0) < 2) continue;
    const t = el.tags;
    const highway = t.highway;
    const isSteps = highway === 'steps';
    const isCovered =
      t.covered === 'yes' ||
      t.indoor === 'yes' ||
      t.tunnel === 'yes' ||
      t.layer === '1' && t.covered !== 'no';
    const hasRamp =
      t.ramp === 'yes' ||
      t['ramp:wheelchair'] === 'yes' ||
      t['ramp:stroller'] === 'yes';
    const name = t.name || t['name:en'] || '';

    if (isCovered) coveredCount++;
    if (isSteps) stepsCount++;
    if (hasRamp) rampCount++;

    for (let i = 0; i < el.geometry.length - 1; i++) {
      const p = el.geometry[i], q = el.geometry[i + 1];
      const a = nodeFor(p.lat, p.lon), b = nodeFor(q.lat, q.lon);
      if (a === b) continue;

      const length = Math.max(0.1, Number(haversine(p.lat, p.lon, q.lat, q.lon).toFixed(2)));
      const base = {
        length,
        covered: isCovered,
        isSteps,
        hasRamp,
        name,
        highway,
        wayId: el.id,
      };

      // Pedestrian ways are bidirectional
      edges.push({ id: edges.length, from: a, to: b, ...base });
      edges.push({ id: edges.length, from: b, to: a, ...base });
    }
  }

  return {
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      coveredWays: coveredCount,
      stepsWays: stepsCount,
      rampWays: rampCount,
    },
  };
}

export function buildPedestrianGraph(): PedestrianGraphData {
  if (!existsSync(CACHE_FILE)) {
    throw new Error(`Cache file not found at ${CACHE_FILE}`);
  }
  const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  const data = buildPedestrianGraphFromElements(raw.elements || []);
  mkdirSync(GRAPH_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(data));
  console.log('Pedestrian Graph built:', data.stats, '->', OUTPUT_FILE);
  return data;
}

const entry = process.argv[1]?.replace(/\\/g, '/');
if (entry && /tools\/osm\/build-pedestrian-graph\.(ts|js)$/.test(entry)) {
  try {
    buildPedestrianGraph();
  } catch (err: any) {
    console.error('Fatal:', err.message);
    process.exit(1);
  }
}
