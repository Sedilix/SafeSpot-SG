import { readFileSync, writeFileSync } from 'fs';
import { RoadGraph } from '../../src/routing/graph.js';
import { Router } from '../../src/routing/router.js';
import { SpeedProfileEngine, DayType } from '../../src/routing/speedProfiles.js';
import { IncidentLayer } from '../../src/routing/incidents.js';
import { SHADOW_PAIRS, resolveKey } from './shadow-probe.js';

interface GoogleStep {
  distanceMeters: number;
  staticDuration?: string;
  duration?: string;
  navigationInstruction?: {
    instructions?: string;
    maneuver?: string;
  };
  localizedValues?: {
    distance?: { text: string };
    staticDuration?: { text: string };
  };
}

interface AlignedSegment {
  corridor: string;
  fromM: number;
  toM: number;
  lengthM: number;
  googleSec: number;
  engineSec: number;
  diffSec: number;
  diffPct: number;
  googleInstruction: string;
  engineStreets: string;
}

async function fetchGoogleSteps(origin: { lat: number; lng: number }, dest: { lat: number; lng: number }, mapsKey: string) {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.staticDuration,routes.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.localizedValues',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  return json.routes?.[0];
}

export async function auditCorridor(pairId: string, graph: RoadGraph, mapsKey: string) {
  const pair = SHADOW_PAIRS.find(p => p.id === pairId)!;
  const speedProfiles = new SpeedProfileEngine();
  const incidents = new IncidentLayer();
  const router = new Router(graph);
  const departure = new Date();

  // 1. Google
  const gRoute = await fetchGoogleSteps(pair.origin, pair.dest, mapsKey);
  const gSteps: GoogleStep[] = gRoute.legs?.[0]?.steps ?? [];
  const gTotalSec = parseInt(String(gRoute.duration).replace('s', ''), 10);
  const gTotalDist = gRoute.distanceMeters;

  // 2. SafeSpot engine detailed breakdown
  const res = router.findRoute(pair.origin, pair.dest, {
    departureTime: departure,
    speedProfiles,
    incidents,
  });
  if (!res) throw new Error(`No route found for ${pairId}`);

  // Build cumulative distance checkpoints for engine
  const engineSlices: Array<{
    startM: number;
    endM: number;
    lengthM: number;
    seconds: number;
    edgeSec: number;
    turnDelay: number;
    speedFactor: number;
    highway: string;
    name: string;
    wayId: number;
  }> = [];

  const baseDayType = SpeedProfileEngine.getDayType(departure);
  const baseSgtMs = departure.getTime() + 8 * 3600 * 1000;
  const baseDaySec = new Date(baseSgtMs).getUTCHours() * 3600 + new Date(baseSgtMs).getUTCMinutes() * 60;
  const slot = Math.floor(baseDaySec / 900);

  let cumM = 0;
  for (let i = 0; i < res.edges.length; i++) {
    const e = res.edges[i];
    const prev = i > 0 ? res.edges[i - 1] : undefined;
    const turn = prev ? router.evaluateTurn(prev, e) : { allowed: true, delaySec: 0 };
    const factor = SpeedProfileEngine.getTemporalSpeedFactor(e.highway, baseDayType, slot, graph.edgeBearings[e.id]);
    const edgeSec = speedProfiles.calculateEdgeSeconds(e, departure, graph.edgeBearings[e.id]);
    const fraction = (i === 0 || (res.edges.length > 1 && i === res.edges.length - 1)) ? 0.5 : 1.0;
    const actualEdgeSec = edgeSec * fraction;
    const totalSec = actualEdgeSec + turn.delaySec;
    const actualLength = e.length * fraction;

    engineSlices.push({
      startM: cumM,
      endM: cumM + actualLength,
      lengthM: actualLength,
      seconds: totalSec,
      edgeSec: actualEdgeSec,
      turnDelay: turn.delaySec,
      speedFactor: factor,
      highway: e.highway,
      name: e.name || e.highway,
      wayId: e.wayId,
    });
    cumM += actualLength;
  }

  // Build cumulative distance intervals for Google
  const googleSlices: Array<{
    startM: number;
    endM: number;
    lengthM: number;
    seconds: number;
    instruction: string;
  }> = [];

  let gCumM = 0;
  for (const s of gSteps) {
    const durSec = s.staticDuration ? parseInt(String(s.staticDuration).replace('s', ''), 10) : 0;
    const instr = s.navigationInstruction?.instructions?.replace(/<[^>]+>/g, '') || 'follow';
    googleSlices.push({
      startM: gCumM,
      endM: gCumM + s.distanceMeters,
      lengthM: s.distanceMeters,
      seconds: durSec,
      instruction: instr,
    });
    gCumM += s.distanceMeters;
  }

  // Align by Google Steps
  const aligned: AlignedSegment[] = [];
  for (const gs of googleSlices) {
    // Find engine slices overlapping [gs.startM, gs.endM]
    let engSec = 0;
    const streetNames = new Set<string>();
    for (const es of engineSlices) {
      const overlapStart = Math.max(gs.startM, es.startM);
      const overlapEnd = Math.min(gs.endM, es.endM);
      if (overlapEnd > overlapStart) {
        const overlapRatio = (overlapEnd - overlapStart) / es.lengthM;
        engSec += es.seconds * overlapRatio;
        streetNames.add(es.name);
      }
    }
    const diff = engSec - gs.seconds;
    const pct = gs.seconds > 0 ? (diff / gs.seconds) * 100 : 0;
    aligned.push({
      corridor: pairId,
      fromM: Math.round(gs.startM),
      toM: Math.round(gs.endM),
      lengthM: Math.round(gs.lengthM),
      googleSec: Math.round(gs.seconds),
      engineSec: Math.round(engSec),
      diffSec: Math.round(diff),
      diffPct: Number(pct.toFixed(1)),
      googleInstruction: gs.instruction,
      engineStreets: Array.from(streetNames).join(', '),
    });
  }

  // Sort by biggest absolute time difference
  aligned.sort((a, b) => Math.abs(b.diffSec) - Math.abs(a.diffSec));

  return {
    pairId,
    pairName: pair.name,
    gTotalSec,
    gTotalDist,
    engineTotalSec: Math.round(res.durationSeconds),
    engineTotalDist: Math.round(res.distanceMeters),
    top10Gaps: aligned.slice(0, 10),
  };
}

async function run() {
  const mapsKey = resolveKey('MAPS_SERVER_KEY', 'C:/Users/SIT EUC/maps_server_key.txt');
  if (!mapsKey) {
    console.error('No MAPS_SERVER_KEY found!');
    process.exit(1);
  }
  const graph = RoadGraph.loadDefault();

  const pairs = ['ang-mo-kio-to-punggol', 'novena-to-mbs', 'toa-payoh-to-raffles-place'];
  let md = `# Fix J2: Step-by-Step Segment Gap Analysis vs Google Routes\n\n`;

  for (const p of pairs) {
    console.log(`Auditing ${p}...`);
    const audit = await auditCorridor(p, graph, mapsKey);
    md += `## ${audit.pairName} (\`${audit.pairId}\`)\n\n`;
    md += `- **Google Routes Total:** ${audit.gTotalDist} m (${(audit.gTotalDist / 1000).toFixed(2)} km), ${audit.gTotalSec} s (${(audit.gTotalSec / 60).toFixed(1)} min)\n`;
    md += `- **SafeSpot Engine Total:** ${audit.engineTotalDist} m (${(audit.engineTotalDist / 1000).toFixed(2)} km), ${audit.engineTotalSec} s (${(audit.engineTotalSec / 60).toFixed(1)} min)\n`;
    const netDiff = audit.engineTotalSec - audit.gTotalSec;
    const netPct = ((netDiff / audit.gTotalSec) * 100).toFixed(1);
    const distDiff = audit.engineTotalDist - audit.gTotalDist;
    md += `- **Net Discrepancy:** Time: ${netDiff > 0 ? '+' : ''}${netDiff} s (${netDiff > 0 ? '+' : ''}${netPct}%), Distance: ${distDiff > 0 ? '+' : ''}${distDiff} m\n\n`;

    md += `### 10 Biggest Per-Segment Gaps (Aligned by Cumulative Distance)\n\n`;
    md += `| Range (m) | Length | Google Step | SafeSpot Engine Roads | Google (s) | Engine (s) | Diff (s) | Diff (%) |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;

    for (const g of audit.top10Gaps) {
      md += `| ${g.fromM}–${g.toM} | ${g.lengthM}m | ${g.googleInstruction} | ${g.engineStreets} | ${g.googleSec}s | ${g.engineSec}s | ${g.diffSec > 0 ? '+' : ''}${g.diffSec}s | ${g.diffPct > 0 ? '+' : ''}${g.diffPct}% |\n`;
    }
    md += `\n---\n\n`;
  }

  writeFileSync('tools/routing/out/corridor-step-audit.md', md, 'utf8');
  console.log('Saved report to tools/routing/out/corridor-step-audit.md');
  console.log(md);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
