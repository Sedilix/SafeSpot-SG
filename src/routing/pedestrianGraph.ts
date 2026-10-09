/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pedestrianGraph.ts: In-memory directed pedestrian road graph with a spatial grid index
 * and connected component awareness for senior-friendly walkway snapping and traversal.
 */

import { readFileSync, existsSync } from 'fs';
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

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export class PedestrianGraph {
  public nodes: CompactPedestrianNode[];
  public edges: CompactPedestrianEdge[];
  public outgoingEdges: number[][];
  public nodeComponentSizes: Int32Array;
  public nodeComponentIds: Int32Array;
  private grid = new Map<number, number[]>();
  private static readonly GRID_SCALE = 100; // ~1.1 km cells

  constructor(data: PedestrianGraphData) {
    this.nodes = data.nodes;
    this.edges = data.edges;
    this.outgoingEdges = Array.from({ length: this.nodes.length }, () => [] as number[]);

    for (const e of this.edges) {
      this.outgoingEdges[e.from].push(e.id);
      this.indexNode(e.from);
      this.indexNode(e.to);
    }

    // Compute connected components for robust island-free snapping
    this.nodeComponentIds = new Int32Array(this.nodes.length).fill(-1);
    this.nodeComponentSizes = new Int32Array(this.nodes.length);
    const compSizeMap = new Map<number, number>();
    let compCount = 0;

    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodeComponentIds[i] !== -1) continue;
      const compId = compCount++;
      let size = 0;
      const q = [i];
      this.nodeComponentIds[i] = compId;
      while (q.length > 0) {
        const u = q.pop()!;
        size++;
        for (const eid of this.outgoingEdges[u] || []) {
          const v = this.edges[eid].to;
          if (this.nodeComponentIds[v] === -1) {
            this.nodeComponentIds[v] = compId;
            q.push(v);
          }
        }
      }
      compSizeMap.set(compId, size);
    }

    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeComponentSizes[i] = compSizeMap.get(this.nodeComponentIds[i]) || 0;
    }
  }

  private cell(lat: number, lng: number): number {
    return Math.floor(lat * PedestrianGraph.GRID_SCALE) * 100000 + Math.floor(lng * PedestrianGraph.GRID_SCALE);
  }

  private indexNode(nodeId: number): void {
    const node = this.nodes[nodeId];
    const h = this.cell(node.lat, node.lng);
    const list = this.grid.get(h);
    if (list) list.push(nodeId);
    else this.grid.set(h, [nodeId]);
  }

  /**
   * Snaps a geographic coordinate to the nearest pedestrian network node.
   * Filters out tiny disconnected islands (< minComponentSize) to ensure routability.
   */
  public findNearestNode(
    lat: number,
    lng: number,
    maxRadiusMeters = 300,
    minComponentSize = 50
  ): number | null {
    const S = PedestrianGraph.GRID_SCALE;
    const cLat = Math.floor(lat * S);
    const cLng = Math.floor(lng * S);

    let bestDist = Infinity;
    let bestNode: number | null = null;

    let fallbackDist = Infinity;
    let fallbackNode: number | null = null;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = (cLat + dy) * 100000 + (cLng + dx);
        for (const nid of this.grid.get(key) ?? []) {
          const node = this.nodes[nid];
          const d = haversineMeters(lat, lng, node.lat, node.lng);

          // Track fallback (any component)
          if (d < fallbackDist) {
            fallbackDist = d;
            fallbackNode = nid;
          }

          // Prioritize well-connected component
          if (this.nodeComponentSizes[nid] >= minComponentSize) {
            if (d < bestDist) {
              bestDist = d;
              bestNode = nid;
            }
          }
        }
      }
    }

    if (bestDist <= maxRadiusMeters && bestNode !== null) {
      return bestNode;
    }
    if (fallbackDist <= maxRadiusMeters && fallbackNode !== null) {
      return fallbackNode;
    }
    return null;
  }

  public static loadDefault(): PedestrianGraph {
    const p = join(process.cwd(), 'data', 'graph', 'singapore-pedestrian-graph.json');
    if (!existsSync(p)) {
      throw new Error(`Pedestrian graph not found at ${p}. Run: npx tsx tools/osm/build-pedestrian-graph.ts`);
    }
    return new PedestrianGraph(JSON.parse(readFileSync(p, 'utf8')));
  }
}
