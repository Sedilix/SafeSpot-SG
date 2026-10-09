/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pedestrianRouter.ts: Senior-friendly walking route planner.
 *
 * Implements A* pathfinding over the pedestrian network graph with:
 *  - Elderly walking pace (default 0.9 m/s ≈ 3.24 km/h)
 *  - Stairs / steps avoidance (fall prevention)
 *  - Covered linkway prioritization during tropical downpours (NEA live rainfall)
 */

import { PedestrianGraph, CompactPedestrianEdge, haversineMeters } from './pedestrianGraph';
import { WeatherService } from './weather';

export interface PedestrianRoutingOptions {
  seniorPaceMps?: number;           // Default 0.9 m/s (~3.24 km/h)
  avoidStairs?: boolean;            // Default true
  stairsPenaltyMultiplier?: number;    // Default 4.0x
  rainMultiplier?: number;          // Default 3.0x for unsheltered edges
  isRaining?: boolean;              // Override rain condition; if undefined, queries weatherService
  weatherService?: WeatherService;
  maxSnapRadiusMeters?: number;     // Default 400m
}

export interface PedestrianRouteResult {
  durationSeconds: number;          // Expected walking time for elderly
  distanceMeters: number;           // Total route distance in metres
  shelteredDistanceMeters: number;    // Metres under covered walkways
  shelteredPercentage: number;      // 0 - 100%
  stepsCount: number;               // Number of stair segments traversed
  isRaining: boolean;               // Whether rain impedance was active
  path: Array<{ lat: number; lng: number }>;
  nodeIds: number[];
  edgeIds: number[];
}

interface HeapItem {
  nodeId: number;
  priority: number;
}

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
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const len = a.length;
      while (true) {
        let smallest = i;
        const left = (i << 1) + 1;
        const right = left + 1;
        if (left < len && a[left].priority < a[smallest].priority) smallest = left;
        if (right < len && a[right].priority < a[smallest].priority) smallest = right;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
}

export class PedestrianRouter {
  private graph: PedestrianGraph;
  private defaultWeatherService: WeatherService;

  constructor(graph?: PedestrianGraph) {
    this.graph = graph ?? PedestrianGraph.loadDefault();
    this.defaultWeatherService = new WeatherService();
  }

  /**
   * Plans a senior walking route between origin and destination coordinates.
   */
  public async findRoute(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    options: PedestrianRoutingOptions = {}
  ): Promise<PedestrianRouteResult | null> {
    const pace = options.seniorPaceMps ?? 0.9;
    const avoidStairs = options.avoidStairs ?? true;
    const stairsPenalty = options.stairsPenaltyMultiplier ?? 4.0;
    const rainMultiplier = options.rainMultiplier ?? 3.0;
    const maxSnap = options.maxSnapRadiusMeters ?? 400;

    // Determine rain condition
    let isRaining = options.isRaining;
    if (isRaining === undefined) {
      const ws = options.weatherService ?? this.defaultWeatherService;
      try {
        const weather = await ws.assessWeatherAt(origin.lat, origin.lng);
        isRaining = weather.isRaining;
      } catch {
        isRaining = false;
      }
    }

    const startNode = this.graph.findNearestNode(origin.lat, origin.lng, maxSnap);
    const destNode = this.graph.findNearestNode(destination.lat, destination.lng, maxSnap);

    if (startNode === null || destNode === null) {
      return null;
    }

    if (startNode === destNode) {
      const n = this.graph.nodes[startNode];
      return {
        durationSeconds: 0,
        distanceMeters: 0,
        shelteredDistanceMeters: 0,
        shelteredPercentage: 100,
        stepsCount: 0,
        isRaining: Boolean(isRaining),
        path: [{ lat: n.lat, lng: n.lng }],
        nodeIds: [startNode],
        edgeIds: [],
      };
    }

    const dest = this.graph.nodes[destNode];

    // A* search structures
    const gScore = new Map<number, number>();
    const cameFromEdge = new Map<number, number>();
    const cameFromNode = new Map<number, number>();
    const openSet = new MinHeap();

    gScore.set(startNode, 0);
    const startH = haversineMeters(this.graph.nodes[startNode].lat, this.graph.nodes[startNode].lng, dest.lat, dest.lng) / pace;
    openSet.push({ nodeId: startNode, priority: startH });

    let found = false;

    while (openSet.size > 0) {
      const current = openSet.pop()!;
      const u = current.nodeId;

      if (u === destNode) {
        found = true;
        break;
      }

      const currentG = gScore.get(u) ?? Infinity;
      const outgoing = this.graph.outgoingEdges[u] || [];

      for (const edgeId of outgoing) {
        const edge = this.graph.edges[edgeId];
        const v = edge.to;

        // Calculate edge impedance cost
        const baseSeconds = edge.length / pace;
        let impedance = 1.0;

        // Stairs penalty
        if (edge.isSteps && avoidStairs) {
          impedance *= edge.hasRamp ? 1.5 : stairsPenalty;
        }

        // Rain weather penalty for unsheltered edges
        if (isRaining && !edge.covered) {
          impedance *= rainMultiplier;
        }

        const tentativeG = currentG + baseSeconds * impedance;
        const prevG = gScore.get(v) ?? Infinity;

        if (tentativeG < prevG) {
          gScore.set(v, tentativeG);
          cameFromEdge.set(v, edgeId);
          cameFromNode.set(v, u);

          const vNode = this.graph.nodes[v];
          const h = haversineMeters(vNode.lat, vNode.lng, dest.lat, dest.lng) / pace;
          openSet.push({ nodeId: v, priority: tentativeG + h });
        }
      }
    }

    if (!found) {
      return null;
    }

    // Reconstruct path
    const pathNodes: number[] = [destNode];
    const pathEdges: number[] = [];
    let curr = destNode;

    while (curr !== startNode) {
      const edgeId = cameFromEdge.get(curr)!;
      pathEdges.unshift(edgeId);
      curr = cameFromNode.get(curr)!;
      pathNodes.unshift(curr);
    }

    let totalDistanceMeters = 0;
    let shelteredDistanceMeters = 0;
    let durationSeconds = 0;
    let stepsCount = 0;

    for (const eid of pathEdges) {
      const edge = this.graph.edges[eid];
      totalDistanceMeters += edge.length;
      if (edge.covered) {
        shelteredDistanceMeters += edge.length;
      }
      if (edge.isSteps) {
        stepsCount++;
      }
      // Actual walking duration (senior pace, with slight 1.5x delay on steps)
      durationSeconds += (edge.length / pace) * (edge.isSteps ? 1.5 : 1.0);
    }

    const shelteredPercentage =
      totalDistanceMeters > 0
        ? Math.round((shelteredDistanceMeters / totalDistanceMeters) * 100)
        : 0;

    const pathCoords = pathNodes.map((nid) => {
      const n = this.graph.nodes[nid];
      return { lat: n.lat, lng: n.lng };
    });

    return {
      durationSeconds: Math.round(durationSeconds),
      distanceMeters: Math.round(totalDistanceMeters),
      shelteredDistanceMeters: Math.round(shelteredDistanceMeters),
      shelteredPercentage,
      stepsCount,
      isRaining: Boolean(isRaining),
      path: pathCoords,
      nodeIds: pathNodes,
      edgeIds: pathEdges,
    };
  }
}
