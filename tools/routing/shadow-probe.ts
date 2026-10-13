/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * shadow-probe.ts: Scheduled background probe comparing SafeSpot traffic-aware
 * routing engine vs Google Routes TRAFFIC_AWARE across 10 fixed Singapore O-D corridors.
 *
 * Runs 6x daily (07:30, 08:30, 12:00, 17:30, 18:30, 22:00 SGT).
 * Emits 10 records per run to gs://safespot-sg-speedbands/shadow/YYYY-MM-DD.jsonl
 * and local output tools/routing/out/shadow/YYYY-MM-DD.jsonl.
 *
 * Never probes or logs user locations, device IDs, or personal data.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { RoadGraph } from '../../src/routing/graph';
import { Router } from '../../src/routing/router';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles';
import { IncidentLayer, TrafficIncident } from '../../src/routing/incidents';
import { ErpEngine } from '../../src/routing/erp';

export interface ShadowPair {
  id: string;
  name: string;
  origin: { lat: number; lng: number };
  dest: { lat: number; lng: number };
}

export interface ShadowRecord {
  at: string;        // ISO timestamp
  pairId: string;    // Identifier of fixed OD corridor
  localSec: number;  // SafeSpot engine duration in seconds (0 = engine found no route)
  googleSec: number | null; // Google Routes TRAFFIC_AWARE duration in seconds; null if the query failed
  diffPct: number | null;   // ((localSec - googleSec) / googleSec) * 100; null unless both sides succeeded
  localMs: number;   // Engine search execution latency in ms
  /** True only when Google really answered and the engine found a route. Reports use only these rows. */
  googleOk?: boolean;
  /** Test-only rows with a made-up Google time. Never uploaded. */
  simulated?: boolean;
  /** Why the row can't be compared, e.g. the Google error message. */
  error?: string;
}

/** 10 Fixed Public Singapore O-D Corridors per ROUTING_PLAN.md §9 Fix F */
export const SHADOW_PAIRS: ShadowPair[] = [
  // 1-3. Original Phase 1-2 probe trips (Central to CBD, East, West)
  {
    id: 'toa-payoh-to-raffles-place',
    name: 'Blk 480 Toa Payoh -> Raffles Place (CBD)',
    origin: { lat: 1.3327, lng: 103.8479 },
    dest: { lat: 1.2840, lng: 103.8514 },
  },
  {
    id: 'toa-payoh-to-changi-t3',
    name: 'Blk 480 Toa Payoh -> Changi Airport T3',
    origin: { lat: 1.3327, lng: 103.8479 },
    dest: { lat: 1.3570, lng: 103.9874 },
  },
  {
    id: 'toa-payoh-to-jurong-east',
    name: 'Blk 480 Toa Payoh -> Jurong East MRT',
    origin: { lat: 1.3327, lng: 103.8479 },
    dest: { lat: 1.3331, lng: 103.7423 },
  },
  // 4-6. Held-out probe trips (West cross-island to North, East, North-East)
  {
    id: 'jurong-west-to-woodlands',
    name: 'Jurong West St 64 -> Woodlands MRT',
    origin: { lat: 1.3404, lng: 103.7090 },
    dest: { lat: 1.4370, lng: 103.7865 },
  },
  {
    id: 'jurong-west-to-tampines',
    name: 'Jurong West St 64 -> Tampines Hub',
    origin: { lat: 1.3404, lng: 103.7090 },
    dest: { lat: 1.3534, lng: 103.9401 },
  },
  {
    id: 'jurong-west-to-sengkang',
    name: 'Jurong West St 64 -> Sengkang General Hospital',
    origin: { lat: 1.3404, lng: 103.7090 },
    dest: { lat: 1.3955, lng: 103.8930 },
  },
  // 7-10. Strategic geographic coverage (East, North-East, West/South, CBD)
  {
    id: 'pasir-ris-to-bedok',
    name: 'Pasir Ris MRT -> Bedok Mall',
    origin: { lat: 1.3732, lng: 103.9493 },
    dest: { lat: 1.3243, lng: 103.9298 },
  },
  {
    id: 'ang-mo-kio-to-punggol',
    name: 'Ang Mo Kio Hub -> Punggol Waterway Point',
    origin: { lat: 1.3698, lng: 103.8485 },
    dest: { lat: 1.4067, lng: 103.9022 },
  },
  {
    id: 'clementi-to-harbourfront',
    name: 'Clementi Mall -> HarbourFront Centre',
    origin: { lat: 1.3152, lng: 103.7652 },
    dest: { lat: 1.2647, lng: 103.8197 },
  },
  {
    id: 'novena-to-mbs',
    name: 'Novena Square -> Marina Bay Sands',
    origin: { lat: 1.3204, lng: 103.8438 },
    dest: { lat: 1.2834, lng: 103.8607 },
  },
];

export function resolveKey(envName: string, filePath: string): string {
  if (process.env[envName]?.trim()) return process.env[envName]!.trim();
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8').trim();
    if (content) return content;
  }
  return '';
}

/** Queries Google Routes API v2 computeRoutes with TRAFFIC_AWARE routing. */
export async function queryGoogleDrivingSeconds(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  mapsKey: string,
): Promise<number | null> {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    // No departureTime: Google then uses "now". Sending our own "now" fails
    // with "Timestamp must be set to a future time" once it reaches Google.
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google Routes HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }

  const data = (await res.json()) as any;
  const route = data.routes?.[0];
  if (!route?.duration) return null;

  return parseInt(String(route.duration).replace('s', ''), 10);
}

/** Fetches live incidents from LTA DataMall if key is provided. */
export async function fetchLiveIncidents(ltaKey?: string): Promise<TrafficIncident[]> {
  if (!ltaKey) return [];
  try {
    const res = await fetch('https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents', {
      headers: { AccountKey: ltaKey, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return (data.value || []).map((i: any) => ({
      type: i.Type || 'Incident',
      lat: i.Latitude,
      lng: i.Longitude,
      message: i.Message || '',
      timestamp: Date.now(),
    }));
  } catch {
    return [];
  }
}

/** Appends shadow records to local file. */
export function appendLocalShadowRecords(records: ShadowRecord[], dateStr: string): string {
  const outDir = join(process.cwd(), 'tools', 'routing', 'out', 'shadow');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${dateStr}.jsonl`);

  let content = '';
  for (const r of records) {
    content += JSON.stringify(r) + '\n';
  }
  appendFileSync(outPath, content, 'utf8');
  return outPath;
}

/** Appends shadow records to Cloud Storage gs://<bucket>/shadow/YYYY-MM-DD.jsonl. */
export async function appendGcsShadowRecords(
  records: ShadowRecord[],
  bucketName: string,
  dateStr: string
): Promise<string> {
  const objectPath = `shadow/${dateStr}.jsonl`;
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectPath);

  let existing = '';
  try {
    const [downloaded] = await file.download();
    existing = downloaded.toString('utf8');
  } catch {
    // File may not exist yet on fresh days
  }

  let appended = existing;
  for (const r of records) {
    appended += JSON.stringify(r) + '\n';
  }

  await file.save(appended, {
    contentType: 'application/x-ndjson',
    resumable: false,
  });

  return `gs://${bucketName}/${objectPath}`;
}

async function loadOrDownloadRoadGraph(): Promise<RoadGraph> {
  const localCandidates = [
    join(process.cwd(), 'data', 'graph', 'singapore-road-graph.json'),
    join(process.cwd(), 'data', 'graph', 'singapore-road-graph.json.gz'),
    '/tmp/singapore-road-graph.json',
    '/tmp/singapore-road-graph.json.gz',
  ];
  for (const candidate of localCandidates) {
    if (existsSync(candidate)) {
      if (candidate.endsWith('.gz')) {
        const { gunzipSync } = await import('zlib');
        return new RoadGraph(JSON.parse(gunzipSync(readFileSync(candidate)).toString('utf8')));
      }
      return new RoadGraph(JSON.parse(readFileSync(candidate, 'utf8')));
    }
  }

  // Attempt download from GCS
  const gcsUri = process.env.ROUTING_GRAPH_URI || 'gs://safespot-sg-speedbands/graph/2026-10-12/singapore-road-graph.json.gz';
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (match) {
    const bucketName = match[1];
    const objectPath = match[2];
    console.log(`[SHADOW_PROBE] Downloading road graph from ${gcsUri} to /tmp/...`);
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage();
    const dest = '/tmp/singapore-road-graph.json.gz';
    await storage.bucket(bucketName).file(objectPath).download({ destination: dest });
    const { gunzipSync } = await import('zlib');
    return new RoadGraph(JSON.parse(gunzipSync(readFileSync(dest)).toString('utf8')));
  }

  throw new Error('Road graph not found locally and no valid ROUTING_GRAPH_URI provided.');
}

export async function runShadowProbe(options?: {
  bucket?: string;
  pairs?: ShadowPair[];
  simulateGoogle?: boolean;
  /** false = never write to Cloud Storage (tests). */
  upload?: boolean;
  graph?: RoadGraph;
}): Promise<ShadowRecord[]> {
  const mapsKey = resolveKey('MAPS_SERVER_KEY', 'C:/Users/SIT EUC/maps_server_key.txt');
  const ltaKey = resolveKey('LTA_DATAMALL_KEY', 'C:/Users/SIT EUC/lta_datamall_key.txt');
  const bucket = options?.bucket || process.env.SPEEDBANDS_BUCKET || 'safespot-sg-speedbands';
  const pairs = options?.pairs || SHADOW_PAIRS;

  console.log(`[SHADOW_PROBE] Starting probe cycle across ${pairs.length} fixed pairs...`);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // 1. Prepare engine
  const graph = options?.graph ?? (await loadOrDownloadRoadGraph());
  const router = new Router(graph);
  const speedProfiles = new SpeedProfileEngine();
  const incidents = new IncidentLayer(await fetchLiveIncidents(ltaKey));
  const erp = new ErpEngine();

  const records: ShadowRecord[] = [];

  for (const p of pairs) {
    // 2. Compute engine ETA
    const t0 = performance.now();
    const route = router.findRoute(p.origin, p.dest, {
      departureTime: now,
      speedProfiles,
      incidents,
      erp,
    });
    const localMs = Math.round(performance.now() - t0);
    const localSec = route ? Math.round(route.durationSeconds) : 0;

    // 3. Query Google Routes TRAFFIC_AWARE. A failure is recorded as a
    // failure (googleSec null), never filled in with the engine's own time.
    let googleSec: number | null = null;
    let error: string | undefined;
    if (options?.simulateGoogle) {
      googleSec = Math.round(localSec * (1 + Math.sin(localMs) * 0.05));
    } else if (!mapsKey) {
      error = 'MAPS_SERVER_KEY not set';
    } else {
      try {
        googleSec = await queryGoogleDrivingSeconds(p.origin, p.dest, mapsKey);
        if (googleSec === null) error = 'Google returned no route';
      } catch (err: any) {
        error = String(err.message).slice(0, 160);
        console.warn(`[SHADOW_PROBE] Google query error for ${p.id}: ${error}`);
      }
    }
    if (localSec <= 0 && !error) error = 'Engine found no route';

    const comparable = googleSec !== null && googleSec > 0 && localSec > 0;
    const diffPct = comparable ? Number((((localSec - googleSec!) / googleSec!) * 100).toFixed(1)) : null;

    const rec: ShadowRecord = {
      at: now.toISOString(),
      pairId: p.id,
      localSec,
      googleSec,
      diffPct,
      localMs,
      googleOk: comparable && !options?.simulateGoogle,
      ...(options?.simulateGoogle ? { simulated: true } : {}),
      ...(error ? { error } : {}),
    };
    records.push(rec);

    console.log(
      `  -> ${p.id.padEnd(28)}: local=${localSec}s google=${googleSec ?? 'FAILED'}s ` +
        (diffPct === null ? `(${error})` : `diff=${diffPct > 0 ? '+' : ''}${diffPct}%`) +
        ` (${localMs}ms)`,
    );
  }

  // 4. Save locally
  const localFile = appendLocalShadowRecords(records, dateStr);
  console.log(`[SHADOW_PROBE] Appended ${records.length} records to local: ${localFile}`);

  // 5. Upload/append to GCS if accessible
  if (bucket && !options?.simulateGoogle && options?.upload !== false) {
    try {
      const gcsUri = await appendGcsShadowRecords(records, bucket, dateStr);
      console.log(`[SHADOW_PROBE] Synchronized records to Cloud Storage: ${gcsUri}`);
    } catch (err: any) {
      console.warn(`[SHADOW_PROBE] GCS sync skipped/failed: ${err.message}`);
    }
  }

  const ok = records.filter((r) => r.googleOk).length;
  console.log(`[SHADOW_PROBE] ${ok}/${records.length} pairs compared successfully.`);
  if (!options?.simulateGoogle && records.length > 0 && ok === 0) {
    throw new Error('Every Google query failed; no usable comparisons this run.');
  }

  return records;
}

if (
  process.argv[1]?.includes('shadow-probe') ||
  process.argv.includes('--once')
) {
  runShadowProbe().catch((err) => {
    console.error('[SHADOW_PROBE] Fatal error:', err);
    process.exit(1);
  });
}
