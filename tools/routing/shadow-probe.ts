/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * shadow-probe.ts: Scheduled background probe of the SafeSpot traffic-aware routing
 * engine across 10 fixed Singapore O-D corridors: ETA, distance and latency.
 *
 * Engine only. It used to store Google Routes ETAs next to ours; the Google Maps
 * Platform terms allow no caching of route durations or distances and bar using
 * Google results to build or tune a substitute (ToS §3.2.3 (b)-(d)), so it no
 * longer calls Google. Ground truth comes from LTA speed bands and our own measured
 * trips instead (docs/clean-room-calibration.md).
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
  localMs: number;   // Engine search execution latency in ms
  localMeters?: number; // SafeSpot engine distance in meters (0 = engine found no route)
  /** Live LTA incidents loaded into the engine for this run. */
  incidents?: number;
  /** Why the row has no ETA, e.g. the engine found no route. */
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
  /** false = never write to Cloud Storage (tests). */
  upload?: boolean;
  /** false = don't append to tools/routing/out/shadow/ (tests). */
  writeLocal?: boolean;
  graph?: RoadGraph;
}): Promise<ShadowRecord[]> {
  const ltaKey = resolveKey('LTA_DATAMALL_KEY', 'C:/Users/SIT EUC/lta_datamall_key.txt');
  const bucket = options?.bucket || process.env.SPEEDBANDS_BUCKET || 'safespot-sg-speedbands';
  const pairs = options?.pairs || SHADOW_PAIRS;

  console.log(`[SHADOW_PROBE] Starting probe cycle across ${pairs.length} fixed pairs...`);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const graph = options?.graph ?? (await loadOrDownloadRoadGraph());
  const router = new Router(graph);
  const speedProfiles = new SpeedProfileEngine();
  const liveIncidents = await fetchLiveIncidents(ltaKey);
  const incidents = new IncidentLayer(liveIncidents);
  const erp = new ErpEngine();

  const records: ShadowRecord[] = [];
  for (const p of pairs) {
    const t0 = performance.now();
    const route = router.findRoute(p.origin, p.dest, { departureTime: now, speedProfiles, incidents, erp });
    const localMs = Math.round(performance.now() - t0);
    const rec: ShadowRecord = {
      at: now.toISOString(),
      pairId: p.id,
      localSec: route ? Math.round(route.durationSeconds) : 0,
      localMs,
      localMeters: route ? Math.round(route.distanceMeters) : 0,
      incidents: liveIncidents.length,
      ...(route ? {} : { error: 'Engine found no route' }),
    };
    records.push(rec);
    console.log(`  -> ${p.id.padEnd(28)}: ${route ? `${rec.localSec}s (${rec.localMeters}m)` : 'NO ROUTE'} (${localMs}ms)`);
  }

  if (options?.writeLocal !== false) {
    const localFile = appendLocalShadowRecords(records, dateStr);
    console.log(`[SHADOW_PROBE] Appended ${records.length} records to local: ${localFile}`);
  }

  if (bucket && options?.upload !== false) {
    try {
      const gcsUri = await appendGcsShadowRecords(records, bucket, dateStr);
      console.log(`[SHADOW_PROBE] Synchronized records to Cloud Storage: ${gcsUri}`);
    } catch (err: any) {
      console.warn(`[SHADOW_PROBE] GCS sync skipped/failed: ${err.message}`);
    }
  }

  const ok = records.filter((r) => !r.error).length;
  console.log(`[SHADOW_PROBE] ${ok}/${records.length} pairs routed.`);
  if (records.length > 0 && ok === 0) {
    throw new Error('The engine found no route for any pair; no usable rows this run.');
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
