/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * gap-alignment-table.ts: compares the engine's route with Google's corridor by corridor.
 *
 *   npx tsx tools/routing/gap-alignment-table.ts [--pairs=a,b] [--departure=ISO] [--google-cache=file.json] [--graph=file.json] [--out=file.md]
 *
 * Aligning by cumulative distance (the previous approach) compares unrelated roads as soon
 * as the two routes take different corridors. Instead, every engine edge is checked against
 * Google's decoded polyline: edges within DIVERGENCE_M of it are "shared", runs further
 * away are "divergent". Each run is matched to the stretch of Google's route between the
 * points where the engine leaves and rejoins Google's corridor, so a divergent row compares
 * the engine's alternative with the road Google took instead.
 *
 * --graph=file.json loads another road graph (e.g. the previous build, for before/after).
 * --google-cache reuses a saved Google response, so a before/after engine comparison is
 * measured against the same Google route and times.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { RoadGraph, haversineMeters, pointToSegmentDistance } from '../../src/routing/graph.js';
import { Router } from '../../src/routing/router.js';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles.js';
import { IncidentLayer } from '../../src/routing/incidents.js';
import { SHADOW_PAIRS, resolveKey } from './shadow-probe.js';

export interface LatLng { lat: number; lng: number }

/** Engine edge distances from Google's polyline beyond this are a different corridor. */
export const DIVERGENCE_M = 35;
/** Runs shorter than this are merged into their neighbours (snap noise, parallel carriageways). */
const MIN_RUN_M = 50;

interface GoogleStep {
  distanceMeters?: number;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  navigationInstruction?: { instructions?: string; maneuver?: string };
}

export interface GoogleRouteRaw {
  duration: string;
  staticDuration?: string;
  distanceMeters: number;
  polyline?: { encodedPolyline?: string };
  legs?: Array<{ steps?: GoogleStep[] }>;
}

/** Google encoded polyline decoder. */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Google's route as a polyline with cumulative metres, seconds and the step at each vertex. */
export interface GoogleTrack {
  points: LatLng[];
  cumM: number[];
  cumSec: number[];
  stepOf: number[];
  stepLabels: string[];
  totalSec: number;
  totalM: number;
}

/**
 * Step staticDurations are free-flow; they are scaled uniformly so they sum to the
 * traffic-aware route duration (Google doesn't give per-step traffic times).
 */
export function buildGoogleTrack(route: GoogleRouteRaw): GoogleTrack {
  const steps = route.legs?.[0]?.steps ?? [];
  const totalSec = parseInt(String(route.duration).replace('s', ''), 10);
  const staticSum = steps.reduce((s, st) => s + (st.staticDuration ? parseInt(st.staticDuration, 10) : 0), 0);
  const scale = staticSum > 0 ? totalSec / staticSum : 1;
  const t: GoogleTrack = { points: [], cumM: [], cumSec: [], stepOf: [], stepLabels: [], totalSec, totalM: 0 };
  let m = 0, sec = 0;
  steps.forEach((st, k) => {
    t.stepLabels.push((st.navigationInstruction?.instructions ?? 'follow').split('\n')[0].replace(/<[^>]+>/g, ''));
    const pts = decodePolyline(st.polyline?.encodedPolyline ?? '');
    const stepSec = (st.staticDuration ? parseInt(st.staticDuration, 10) : 0) * scale;
    let stepLen = 0;
    for (let j = 1; j < pts.length; j++) stepLen += haversineMeters(pts[j - 1].lat, pts[j - 1].lng, pts[j].lat, pts[j].lng);
    for (let j = 0; j < pts.length; j++) {
      if (j === 0 && t.points.length > 0) continue; // shared with the previous step's last vertex
      if (t.points.length > 0) {
        const p = t.points[t.points.length - 1];
        const d = haversineMeters(p.lat, p.lng, pts[j].lat, pts[j].lng);
        m += d;
        sec += stepLen > 0 ? (d / stepLen) * stepSec : 0;
      }
      t.points.push(pts[j]); t.cumM.push(m); t.cumSec.push(sec); t.stepOf.push(k);
    }
  });
  t.totalM = m;
  return t;
}

/** Nearest point on the track at or after `minM` (keeps projections monotonic). */
export function projectOnTrack(t: GoogleTrack, p: LatLng, minM = -Infinity): { dist: number; m: number; sec: number; step: number } {
  let best = { dist: Infinity, m: 0, sec: 0, step: 0 };
  for (let i = 1; i < t.points.length; i++) {
    if (t.cumM[i] < minM) continue;
    const a = t.points[i - 1], b = t.points[i];
    const segLen = t.cumM[i] - t.cumM[i - 1];
    const d = pointToSegmentDistance(p.lat, p.lng, a.lat, a.lng, b.lat, b.lng);
    if (d < best.dist) {
      const da = haversineMeters(a.lat, a.lng, p.lat, p.lng);
      const frac = segLen > 0 ? Math.min(1, Math.sqrt(Math.max(0, da * da - d * d)) / segLen) : 0;
      best = {
        dist: d,
        m: t.cumM[i - 1] + frac * segLen,
        sec: t.cumSec[i - 1] + frac * (t.cumSec[i] - t.cumSec[i - 1]),
        step: t.stepOf[i],
      };
    }
  }
  return best;
}

function distanceToTrack(t: GoogleTrack, p: LatLng): number {
  let best = Infinity;
  for (let i = 1; i < t.points.length; i++) {
    const a = t.points[i - 1], b = t.points[i];
    best = Math.min(best, pointToSegmentDistance(p.lat, p.lng, a.lat, a.lng, b.lat, b.lng));
  }
  return best;
}

export interface EngineSlice {
  from: LatLng;
  to: LatLng;
  lengthM: number;
  seconds: number;
  signals: number;
  name: string;
}

export interface CorridorSegment {
  kind: 'shared' | 'divergent';
  engineM: number;
  engineSec: number;
  engineSignals: number;
  engineRoads: string;
  googleFromM: number;
  googleToM: number;
  googleM: number;
  googleSec: number;
  googleRoads: string;
  diffSec: number;
}

/** Splits the engine path into shared/divergent runs and matches each to Google's track. */
export function alignCorridors(slices: EngineSlice[], t: GoogleTrack, thresholdM = DIVERGENCE_M): CorridorSegment[] {
  if (slices.length === 0) return [];
  // Farthest interior sample (every ~25 m) of each edge from Google's polyline.
  const off = slices.map((s) => {
    const n = Math.max(1, Math.ceil(s.lengthM / 25));
    let worst = 0;
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      worst = Math.max(worst, distanceToTrack(t, { lat: s.from.lat + f * (s.to.lat - s.from.lat), lng: s.from.lng + f * (s.to.lng - s.from.lng) }));
    }
    return worst > thresholdM;
  });

  type Run = { off: boolean; start: number; end: number; len: number };
  const toRuns = (): Run[] => {
    const runs: Run[] = [];
    slices.forEach((s, i) => {
      const last = runs[runs.length - 1];
      if (last && last.off === off[i]) { last.end = i; last.len += s.lengthM; }
      else runs.push({ off: off[i], start: i, end: i, len: s.lengthM });
    });
    return runs;
  };
  // Short divergent blips first, then short shared blips between two divergences.
  for (const kind of [true, false]) {
    for (const r of toRuns()) {
      if (r.off === kind && r.len < MIN_RUN_M) for (let i = r.start; i <= r.end; i++) off[i] = !kind;
    }
  }
  const runs = toRuns();

  const segments: CorridorSegment[] = [];
  let gPos = { m: 0, sec: 0, step: 0 };
  runs.forEach((r, idx) => {
    const isLast = idx === runs.length - 1;
    const endPt = slices[r.end].to;
    const gEnd = isLast ? { m: t.totalM, sec: t.totalSec, step: t.stepLabels.length - 1 } : projectOnTrack(t, endPt, gPos.m - 30);
    const endM = Math.max(gEnd.m, gPos.m);
    const endSec = Math.max(gEnd.sec, gPos.sec);
    let engineSec = 0, engineSignals = 0, engineM = 0;
    const roads: string[] = [];
    for (let i = r.start; i <= r.end; i++) {
      engineSec += slices[i].seconds; engineSignals += slices[i].signals; engineM += slices[i].lengthM;
      if (roads[roads.length - 1] !== slices[i].name) roads.push(slices[i].name);
    }
    const gRoads: string[] = [];
    for (let k = gPos.step; k <= gEnd.step; k++) if (t.stepLabels[k] && !gRoads.includes(t.stepLabels[k])) gRoads.push(t.stepLabels[k]);
    const googleSec = endSec - gPos.sec;
    segments.push({
      kind: r.off ? 'divergent' : 'shared',
      engineM: Math.round(engineM),
      engineSec: Math.round(engineSec),
      engineSignals,
      engineRoads: [...new Set(roads)].join(', '),
      googleFromM: gPos.m,
      googleToM: endM,
      googleM: Math.round(endM - gPos.m),
      googleSec: Math.round(googleSec),
      googleRoads: gRoads.join('; '),
      diffSec: Math.round(engineSec - googleSec),
    });
    gPos = { m: endM, sec: endSec, step: gEnd.step };
  });
  return segments;
}

/**
 * Penalises every edge more than `thresholdM` from Google's polyline so the router follows
 * Google's corridor; the returned route's seconds are unpenalised (the engine's own estimate).
 */
export function corridorPenalties(graph: RoadGraph, t: GoogleTrack, thresholdM = DIVERGENCE_M, penalty = 20): Map<number, number> {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of t.points) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  }
  const pad = 0.002; // ~200 m
  const penalties = new Map<number, number>();
  for (let i = 0; i < graph.edges.length; i++) {
    const a = graph.edgeFrom[i], b = graph.edgeTo[i];
    const lat = (graph.nodeLat[a] + graph.nodeLat[b]) / 2, lng = (graph.nodeLng[a] + graph.nodeLng[b]) / 2;
    const inBox = lat > minLat - pad && lat < maxLat + pad && lng > minLng - pad && lng < maxLng + pad;
    if (!inBox || distanceToTrack(t, { lat, lng }) > thresholdM) penalties.set(i, penalty);
  }
  return penalties;
}

/** Engine seconds and signals of `slices` (a route along Google's corridor) within Google's [fromM, toM). */
export function engineTimeOnGoogleRange(slices: EngineSlice[], t: GoogleTrack, fromM: number, toM: number): { sec: number; signals: number } {
  let sec = 0, signals = 0, pos = -Infinity;
  for (const s of slices) {
    const mid = { lat: (s.from.lat + s.to.lat) / 2, lng: (s.from.lng + s.to.lng) / 2 };
    pos = Math.max(pos, projectOnTrack(t, mid, pos - 30).m);
    if (pos >= fromM && pos < toM) { sec += s.seconds; signals += s.signals; }
  }
  return { sec: Math.round(sec), signals };
}

async function fetchGoogleRoute(origin: LatLng, dest: LatLng, mapsKey: string, departure?: Date): Promise<GoogleRouteRaw> {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };
  // Google rejects "now" by the time it arrives; only send future departures.
  if (departure) body.departureTime = departure.toISOString();
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,' +
        'routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.polyline.encodedPolyline,' +
        'routes.legs.steps.navigationInstruction',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Routes HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const route = ((await res.json()) as any).routes?.[0];
  if (!route?.duration) throw new Error('Google returned no route');
  return route;
}

export function engineSlices(graph: RoadGraph, router: Router, res: { edges: import('../../src/routing/graph.js').CompactEdge[] }, departure: Date, speedProfiles: SpeedProfileEngine): EngineSlice[] {
  const slices: EngineSlice[] = [];
  let elapsed = 0;
  res.edges.forEach((e, i) => {
    const prev = i > 0 ? res.edges[i - 1] : undefined;
    const turn = prev ? router.evaluateTurn(prev, e) : { allowed: true, delaySec: 0 };
    const signals = prev && router.chargesSignal(prev, e) ? 1 : 0;
    const arrival = new Date(departure.getTime() + (elapsed + turn.delaySec) * 1000);
    const fraction = i === 0 || (res.edges.length > 1 && i === res.edges.length - 1) ? 0.5 : 1.0;
    const seconds = speedProfiles.calculateEdgeSeconds(e, arrival, graph.edgeBearings[e.id]) * fraction + turn.delaySec;
    elapsed += seconds;
    slices.push({
      from: graph.nodes[e.from], to: graph.nodes[e.to], lengthM: e.length * fraction, seconds, signals,
      name: e.name || e.highway,
    });
  });
  return slices;
}

async function run() {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const pairs = (arg('pairs') ?? 'novena-to-mbs,toa-payoh-to-raffles-place').split(',');
  const departureArg = arg('departure');
  const departure = departureArg ? new Date(departureArg) : new Date();
  const cacheFile = arg('google-cache');
  const outFile = arg('out') ?? 'tools/routing/out/corridor-step-audit.md';

  const cache: Record<string, GoogleRouteRaw> = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const mapsKey = resolveKey('MAPS_SERVER_KEY', 'C:/Users/SIT EUC/maps_server_key.txt');
  const graphFile = arg('graph');
  const graph = graphFile ? new RoadGraph(JSON.parse(readFileSync(graphFile, 'utf8'))) : RoadGraph.loadDefault();
  const router = new Router(graph);
  const speedProfiles = new SpeedProfileEngine();
  const signalNodes = graph.hasTrafficSignal.reduce((n, v) => n + v, 0);

  let md = `# Corridor audit: engine vs Google Routes\n\n`;
  md += `- Departure: ${departure.toISOString()} (engine and Google${departureArg ? '; Google times are predicted traffic' : ''})\n`;
  md += `- Graph: ${graph.nodes.length} nodes, ${signalNodes} traffic-signal nodes\n`;
  md += `- An engine edge more than ${DIVERGENCE_M} m from Google's polyline is **divergent**; each run is compared with Google's route between the points where the engine leaves and rejoins it.\n`;
  md += `- Google per-stretch seconds are step static durations scaled to the traffic-aware route total.\n\n`;

  for (const id of pairs) {
    const pair = SHADOW_PAIRS.find((p) => p.id === id);
    if (!pair) throw new Error(`Unknown pair ${id}`);
    console.log(`Auditing ${id}...`);
    if (!cache[id]) {
      if (!mapsKey) throw new Error('MAPS_SERVER_KEY not set and no cached Google route');
      cache[id] = await fetchGoogleRoute(pair.origin, pair.dest, mapsKey, departureArg ? departure : undefined);
    }
    const track = buildGoogleTrack(cache[id]);
    const res = router.findRoute(pair.origin, pair.dest, { departureTime: departure, speedProfiles, incidents: new IncidentLayer() });
    if (!res) throw new Error(`No route found for ${id}`);
    const slices = engineSlices(graph, router, res, departure, speedProfiles);
    const segments = alignCorridors(slices, track);
    // The engine's own estimate of Google's road: why didn't it pick it?
    const forced = router.findRoute(pair.origin, pair.dest, {
      departureTime: departure, speedProfiles, incidents: new IncidentLayer(), edgePenalties: corridorPenalties(graph, track),
    });
    const forcedSlices = forced ? engineSlices(graph, router, forced, departure, speedProfiles) : [];

    const engSec = Math.round(res.durationSeconds), engM = Math.round(res.distanceMeters);
    const net = engSec - track.totalSec;
    const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    md += `## ${pair.name} (\`${id}\`)\n\n`;
    md += `| | Distance | Time | Signals |\n|---|---|---|---|\n`;
    md += `| Google | ${cache[id].distanceMeters} m | ${track.totalSec} s | |\n`;
    md += `| Engine | ${engM} m | ${engSec} s | ${slices.reduce((n, s) => n + s.signals, 0)} |\n`;
    md += `| Engine − Google | ${sign(engM - cache[id].distanceMeters)} m | ${sign(net)} s (${sign(Number(((net / track.totalSec) * 100).toFixed(1)))}%) | |\n`;
    if (forced) {
      md += `| Engine timing of Google's road | ${Math.round(forced.distanceMeters)} m | ${Math.round(forced.durationSeconds)} s | ${forcedSlices.reduce((n, s) => n + s.signals, 0)} |\n`;
    }
    md += `\n`;
    const divergent = segments.filter((s) => s.kind === 'divergent');
    const divM = divergent.reduce((n, s) => n + s.engineM, 0);
    md += `Shared corridor: ${Math.round(100 - (divM / Math.max(1, engM)) * 100)}% of the engine's distance; ${divergent.length} divergent run(s).\n\n`;
    md += `"Engine s on Google's road" is the engine's own time for Google's stretch (its route forced onto Google's corridor).\n\n`;
    md += `| # | Kind | Engine roads | Engine m | Engine s | Signals | Google roads | Google m | Google s | Diff (s) | Engine s on Google's road (signals) |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
    segments.forEach((s, i) => {
      const k = s.kind === 'divergent' ? '**divergent**' : 'shared';
      const onG = engineTimeOnGoogleRange(forcedSlices, track, s.googleFromM, i === segments.length - 1 ? Infinity : s.googleToM);
      md += `| ${i + 1} | ${k} | ${s.engineRoads} | ${s.engineM} | ${s.engineSec} | ${s.engineSignals} | ${s.googleRoads} | ${s.googleM} | ${s.googleSec} | ${sign(s.diffSec)} | ${forced ? `${onG.sec} (${onG.signals})` : 'n/a'} |\n`;
    });
    md += `\n---\n\n`;
  }

  if (cacheFile) writeFileSync(cacheFile, JSON.stringify(cache));
  writeFileSync(outFile, md, 'utf8');
  console.log(md);
  console.log(`Saved report to ${outFile}`);
}

const entry = process.argv[1]?.replace(/\\/g, '/');
if (entry && /tools\/routing\/gap-alignment-table\.(ts|js)$/.test(entry)) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
