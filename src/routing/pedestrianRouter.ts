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

export interface PedestrianRouteSegment {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  distanceMeters: number;
  covered: boolean;
  isSteps: boolean;
  hasRamp: boolean;
  name: string;
  highway: string;
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
  segments: PedestrianRouteSegment[];
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
        segments: [],
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

    const segments: PedestrianRouteSegment[] = pathEdges.map((eid) => {
      const edge = this.graph.edges[eid];
      const fn = this.graph.nodes[edge.from];
      const tn = this.graph.nodes[edge.to];
      return {
        from: { lat: fn.lat, lng: fn.lng },
        to: { lat: tn.lat, lng: tn.lng },
        distanceMeters: edge.length,
        covered: edge.covered,
        isSteps: edge.isSteps,
        hasRamp: edge.hasRamp,
        name: edge.name || '',
        highway: edge.highway,
      };
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
      segments,
    };
  }
}

export type SeniorGuidanceLang = 'en' | 'zh' | 'ms' | 'ta';

/**
 * Generates clear, localized, step-by-step guidance tailored for elderly listeners.
 * Highlights sheltered linkways, warns of stairs vs ramps, and advises safe crossings.
 */
export function generateSeniorInstructions(
  result: PedestrianRouteResult,
  lang: SeniorGuidanceLang = 'en'
): string[] {
  if (!result || result.segments.length === 0) {
    switch (lang) {
      case 'zh': return ['您已到达目的地。'];
      case 'ms': return ['Anda telah tiba di destinasi.'];
      case 'ta': return ['உங்கள் இலக்கை அடைந்துவிட்டீர்கள்.'];
      default: return ['You have arrived at your destination.'];
    }
  }

  const instructions: string[] = [];

  interface GroupedStretch {
    type: 'covered' | 'uncovered' | 'steps' | 'ramp' | 'crossing';
    distanceMeters: number;
    name?: string;
  }

  const stretches: GroupedStretch[] = [];
  for (const seg of result.segments) {
    let t: 'covered' | 'uncovered' | 'steps' | 'ramp' | 'crossing' = 'uncovered';
    if (seg.isSteps) {
      t = seg.hasRamp ? 'ramp' : 'steps';
    } else if (seg.highway === 'crossing' || (seg.name && seg.name.toLowerCase().includes('crossing'))) {
      t = 'crossing';
    } else if (seg.covered) {
      t = 'covered';
    }

    const last = stretches[stretches.length - 1];
    if (last && last.type === t) {
      last.distanceMeters += seg.distanceMeters;
    } else {
      stretches.push({ type: t, distanceMeters: seg.distanceMeters, name: seg.name });
    }
  }

  for (const s of stretches) {
    const dist = Math.max(5, Math.round(s.distanceMeters));
    switch (s.type) {
      case 'covered':
        if (lang === 'zh') instructions.push(`沿着有盖走廊直行约 ${dist} 米。`);
        else if (lang === 'ms') instructions.push(`Teruskan di laluan berbumbung sejauh lebih kurang ${dist} meter.`);
        else if (lang === 'ta') instructions.push(`கூரை வேய்ந்த நடைபாதையில் சுமார் ${dist} மீட்டர் நேராகச் செல்லவும்.`);
        else instructions.push(`Continue along the covered linkway for about ${dist} metres.`);
        break;

      case 'ramp':
        if (lang === 'zh') instructions.push(`走前方无障碍缓坡（避开楼梯），约 ${dist} 米。`);
        else if (lang === 'ms') instructions.push(`Gunakan tanjakan bebas halangan di hadapan (mengelak tangga), kira-kira ${dist} meter.`);
        else if (lang === 'ta') instructions.push(`முன்னால் உள்ள தடையில்லா சாய்வுதளத்தைப் பயன்படுத்தவும் (படிக்கட்டுகளைத் தவிர்க்கவும்), சுமார் ${dist} மீட்டர்.`);
        else instructions.push(`Take the gentle barrier-free ramp ahead (avoiding stairs), about ${dist} metres.`);
        break;

      case 'steps':
        if (lang === 'zh') instructions.push(`注意：前方有台阶，请扶好扶手小心上下（约 ${dist} 米）。`);
        else if (lang === 'ms') instructions.push(`Perhatian: ada tangga di hadapan, sila pegang pemegang dengan berhati-hati (kira-kira ${dist} meter).`);
        else if (lang === 'ta') instructions.push(`கவனம்: முன்னால் படிகள் உள்ளன, கைப்பிடியைப் பிடித்து கவனமாக நடக்கவும் (சுமார் ${dist} மீட்டர்).`);
        else instructions.push(`Caution: steps ahead, please hold the handrail carefully (about ${dist} metres).`);
        break;

      case 'crossing':
        if (lang === 'zh') instructions.push('在行人过街横道处，等待绿灯安全过马路。');
        else if (lang === 'ms') instructions.push('Di lintasan pejalan kaki, tunggu lampu hijau sebelum melintas dengan selamat.');
        else if (lang === 'ta') instructions.push('பாதசாரி கடவையில், பாதுகாப்பாக கடக்க பச்சை விளக்குக்காக காத்திருக்கவும்.');
        else instructions.push('At the pedestrian crossing, wait for the green signal to cross safely.');
        break;

      case 'uncovered':
      default:
        if (lang === 'zh') instructions.push(`沿人行道直行约 ${dist} 米。`);
        else if (lang === 'ms') instructions.push(`Teruskan di laluan pejalan kaki sejauh lebih kurang ${dist} meter.`);
        else if (lang === 'ta') instructions.push(`நடைபாதையில் சுமார் ${dist} மீட்டர் நேராகச் செல்லவும்.`);
        else instructions.push(`Walk along the footpath for about ${dist} metres.`);
        break;
    }
  }

  if (lang === 'zh') instructions.push('您即将到达安全上车点。');
  else if (lang === 'ms') instructions.push('Anda hampir sampai di tempat menunggu yang selamat.');
  else if (lang === 'ta') instructions.push('நீங்கள் பாதுகாப்பான இடத்திற்கு வந்துவிட்டீர்கள்.');
  else instructions.push('You are arriving at the safe pickup point.');

  return instructions;
}

let defaultPedestrianRouterInstance: PedestrianRouter | null = null;
export function getPedestrianRouter(): PedestrianRouter {
  if (!defaultPedestrianRouterInstance) {
    defaultPedestrianRouterInstance = new PedestrianRouter();
  }
  return defaultPedestrianRouterInstance;
}

