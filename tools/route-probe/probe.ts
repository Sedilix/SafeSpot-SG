/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Route probe: a research tool, not part of the app.
 *
 * Probes every route Google returns between a fixed start point and up to 3
 * destinations, in both directions and at several departure times, enriches
 * each route with Singapore data, ranks them, and writes a dataset for
 * designing SafeSpot's own routing algorithm later.
 *
 *   MAPS_SERVER_KEY=... LTA_DATAMALL_KEY=... npx tsx tools/route-probe/probe.ts
 *
 * Data sources and what they can / can't give (checked October 2026):
 * - Google Routes: up to 3 alternative car routes with traffic-aware and
 *   free-flow times; public transport routes. It does NOT return ERP tolls,
 *   fuel estimates or transit fares for Singapore.
 * - LTA DataMall: live traffic incidents, road works, speed bands. Its ERP
 *   rates endpoint currently returns no rows, so ERP charges are not priced.
 * - OpenStreetMap: ERP gantry locations (no rates).
 * Fuel is therefore modelled, ERP is reported as gantries passed during
 * charging hours, and transit fares are left unpriced.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type LatLng = { lat: number; lng: number };

// ── Inputs ─────────────────────────────────────────────────────────────────
const ORIGIN = { name: 'Blk 480 Toa Payoh', lat: 1.3327, lng: 103.8479 };
const DESTINATIONS = [
  { name: 'Raffles Place (CBD)', lat: 1.284, lng: 103.8514 },
  { name: 'Changi Airport T3', lat: 1.357, lng: 103.9874 },
  { name: 'Jurong East MRT', lat: 1.3331, lng: 103.7423 },
];
const PROBE_DATE = '2026-10-08'; // a Thursday (weekday ERP and traffic)
const DEPARTURES_SGT = ['07:30', '08:30', '11:00', '18:30', '22:00'];

// Petrol price and a speed-dependent consumption curve for a compact petrol
// car (L/100 km = A + B/v + C*v^2, v in km/h): ~13 L at 15 km/h stop-go,
// ~7.5 L at 60 km/h, ~9 L at 90 km/h. Approximate; tune for your vehicle.
const FUEL_PRICE_SGD_PER_L = 2.95;
const FUEL_A = 3.2, FUEL_B = 150, FUEL_C = 0.0005;
// ERP 2.0 charges cars broadly on weekdays ~07:00–20:00 (gantry-specific).
const ERP_CHARGING = { days: [1, 2, 3, 4, 5], start: '07:00', end: '20:00' };

// Weather scenarios applied to every route. Rain slows Singapore traffic and
// makes walking (to stops, to the car) slower and riskier for seniors.
// Multipliers are assumptions to calibrate against observed trips.
const WEATHER_SCENARIOS = [
  { name: 'dry', driveTime: 1.0, walkTime: 1.0 },
  { name: 'moderate rain', driveTime: 1.12, walkTime: 1.2 },
  { name: 'heavy rain', driveTime: 1.3, walkTime: 1.5 },
] as const;

// Live incident types (LTA) weighted by how much they disrupt a trip, in
// penalty minutes. Planned road works are mostly already reflected in traffic
// times, so they count lightly.
const INCIDENT_WEIGHTS: Record<string, number> = {
  Accident: 8, 'Road Block': 10, 'Vehicle breakdown': 5, Obstacle: 4, 'Heavy Traffic': 3,
  Diversion: 4, 'Unattended Vehicle': 2, Roadwork: 0.5, Weather: 3, Misc: 1,
};

const MAPS_KEY = process.env.MAPS_SERVER_KEY || '';
const LTA_KEY = process.env.LTA_DATAMALL_KEY || '';
if (!MAPS_KEY) throw new Error('Set MAPS_SERVER_KEY');

// ── Geometry ───────────────────────────────────────────────────────────────
const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(a: LatLng, b: LatLng): number {
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/** Distance from p to segment ab, metres (local equirectangular approximation). */
function pointToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(rad(p.lat));
  const ax = (a.lng - p.lng) * k, ay = a.lat - p.lat, bx = (b.lng - p.lng) * k, by = b.lat - p.lat;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * (Math.PI / 180) * R;
}
function nearRoute(p: LatLng, path: LatLng[], within: number): boolean {
  for (let i = 1; i < path.length; i++) if (pointToSegment(p, path[i - 1], path[i]) <= within) return true;
  return false;
}
/** Google encoded polyline decoder. */
function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

// ── Data sources ───────────────────────────────────────────────────────────
async function datamall(path: string): Promise<any[]> {
  if (!LTA_KEY) return [];
  const rows: any[] = [];
  for (let skip = 0; skip < 20_000; skip += 500) {
    const res = await fetch(`https://datamall2.mytransport.sg/ltaodataservice/${path}${path.includes('?') ? '&' : '?'}$skip=${skip}`, {
      headers: { AccountKey: LTA_KEY, accept: 'application/json' },
    });
    if (!res.ok) break;
    const page = ((await res.json()) as any).value || [];
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const GANTRY_CACHE = join(process.cwd(), 'tools', 'route-probe', 'out', 'erp-gantries.json');

/** ERP gantry locations from OpenStreetMap, cached locally (public servers rate-limit). */
async function erpGantries(): Promise<LatLng[]> {
  if (existsSync(GANTRY_CACHE)) return JSON.parse(readFileSync(GANTRY_CACHE, 'utf8'));
  const q = '[out:json][timeout:60];area["ISO3166-1"="SG"]->.sg;(node["highway"="toll_gantry"](area.sg);way["highway"="toll_gantry"](area.sg);node["barrier"="toll_booth"](area.sg);way["barrier"="toll_booth"](area.sg););out center 500;';
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'SafeSpot-SG-route-probe/1.0 (research)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      const els = ((await res.json()) as any).elements || [];
      const g = els.map((e: any) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon })).filter((x: LatLng) => x.lat);
      if (g.length) {
        mkdirSync(join(process.cwd(), 'tools', 'route-probe', 'out'), { recursive: true });
        writeFileSync(GANTRY_CACHE, JSON.stringify(g));
        return g;
      }
    } catch {
      // try the next server
    }
  }
  return [];
}

/** Live rainfall (mm in the last 5 min) at the station nearest each route point; NEA via data.gov.sg. */
async function liveRainfall(): Promise<Array<LatLng & { mm: number }>> {
  const res = await fetch('https://api-open.data.gov.sg/v2/real-time/api/rainfall');
  const j = (await res.json()) as any;
  const stations = new Map<string, LatLng>((j.data?.stations || []).map((s: any) => [s.id, { lat: s.location.latitude, lng: s.location.longitude }]));
  return (j.data?.readings?.[0]?.data || []).map((r: any) => ({ ...(stations.get(r.stationId) as LatLng), mm: r.value })).filter((x: any) => x.lat);
}
function rainOnRoute(path: LatLng[], rain: Array<LatLng & { mm: number }>): number {
  let max = 0;
  for (let i = 0; i < path.length; i += 10) {
    let best: (LatLng & { mm: number }) | null = null, bd = Infinity;
    for (const r of rain) { const d = haversine(path[i], r); if (d < bd) { bd = d; best = r; } }
    if (best && bd < 5000) max = Math.max(max, best.mm);
  }
  return max;
}

async function computeRoutes(o: LatLng, d: LatLng, mode: 'DRIVE' | 'TRANSIT', departureUtc: string): Promise<any[]> {
  const body: any = {
    origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    travelMode: mode,
    computeAlternativeRoutes: true,
    departureTime: departureUtc,
  };
  if (mode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': MAPS_KEY,
      'X-Goog-FieldMask': [
        'routes.distanceMeters', 'routes.duration', 'routes.staticDuration', 'routes.description',
        'routes.polyline.encodedPolyline', 'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration',
        'routes.legs.steps.distanceMeters', 'routes.legs.steps.navigationInstruction.instructions',
        'routes.legs.steps.transitDetails.transitLine.nameShort', 'routes.legs.steps.transitDetails.stopCount',
      ].join(','),
    },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as any;
  if (j.error) throw new Error(`Routes: ${j.error.message}`);
  return j.routes || [];
}

// ── Metrics ────────────────────────────────────────────────────────────────
const secs = (s?: string) => (s ? parseInt(s.replace('s', ''), 10) : 0);
const fuelLitres = (km: number, avgKmh: number) => (km * (FUEL_A + FUEL_B / Math.max(avgKmh, 5) + FUEL_C * avgKmh * avgKmh)) / 100;
function inErpHours(dateIso: string, hhmm: string): boolean {
  const day = new Date(`${dateIso}T12:00:00+08:00`).getUTCDay();
  return ERP_CHARGING.days.includes(day) && hhmm >= ERP_CHARGING.start && hhmm < ERP_CHARGING.end;
}

interface ProbeRow {
  trip: string; direction: 'A→B' | 'B→A'; departure: string; mode: 'car' | 'public transport';
  route: string; km: number; minutes: number; freeFlowMinutes: number | null; delayRatio: number | null;
  fuelL: number | null; fuelSGD: number | null; erpGantries: number | null; erpCharging: boolean | null;
  incidentsOnRoute: string[]; incidentPenalty: number; roadWorksOnRoute: string[]; slowSegments: number | null;
  liveRainMm: number | null; weather: string;
  transfers: number | null; walkMinutes: number | null; lines: string | null; score: number; rank: number;
}

(async () => {
  console.log('Loading LTA live data and ERP gantries…');
  const [incidents, roadWorks, speedBands, gantries, rain] = await Promise.all([
    datamall('TrafficIncidents'), datamall('RoadWorks'), datamall('v4/TrafficSpeedBands'),
    erpGantries().catch(() => [] as LatLng[]), liveRainfall().catch(() => []),
  ]);
  console.log(`incidents ${incidents.length}, road works ${roadWorks.length}, speed-band links ${speedBands.length}, ERP gantries ${gantries.length}, rain stations ${rain.length} (${rain.filter((r) => r.mm > 0).length} wet)`);
  const today = new Date().toISOString().slice(0, 10);
  const activeWorks = roadWorks.filter((w: any) => (w.StartDate || '') <= today && (w.EndDate || '9999') >= today);
  const slowLinks = speedBands.filter((s: any) => Number(s.SpeedBand) <= 2); // bands 1-2: under ~20 km/h

  const rows: ProbeRow[] = [];
  for (const dest of DESTINATIONS) {
    for (const [direction, from, to] of [['A→B', ORIGIN, dest], ['B→A', dest, ORIGIN]] as const) {
      for (const hhmm of DEPARTURES_SGT) {
        const departureUtc = new Date(`${PROBE_DATE}T${hhmm}:00+08:00`).toISOString();
        const trip = `${ORIGIN.name} ↔ ${dest.name}`;
        const group: ProbeRow[] = [];

        for (const r of await computeRoutes(from, to, 'DRIVE', departureUtc)) {
          const km = r.distanceMeters / 1000, minutes = secs(r.duration) / 60, free = secs(r.staticDuration) / 60;
          const path = decodePolyline(r.polyline?.encodedPolyline || '');
          const roadText = (r.legs || []).flatMap((l: any) => l.steps || []).map((s: any) => s.navigationInstruction?.instructions || '').join(' ').toLowerCase();
          const fuel = fuelLitres(km, km / (minutes / 60));
          group.push({
            trip, direction, departure: hhmm, mode: 'car', route: r.description || 'Route',
            km: +km.toFixed(1), minutes: +minutes.toFixed(1), freeFlowMinutes: +free.toFixed(1), delayRatio: +(minutes / free).toFixed(2),
            fuelL: +fuel.toFixed(2), fuelSGD: +(fuel * FUEL_PRICE_SGD_PER_L).toFixed(2),
            erpGantries: gantries.filter((g) => nearRoute(g, path, 20)).length, erpCharging: inErpHours(PROBE_DATE, hhmm),
            incidentsOnRoute: incidents.filter((i: any) => nearRoute({ lat: i.Latitude, lng: i.Longitude }, path, 60)).map((i: any) => `${i.Type}: ${String(i.Message).slice(0, 60)}`),
            incidentPenalty: incidents.filter((i: any) => nearRoute({ lat: i.Latitude, lng: i.Longitude }, path, 60)).reduce((a: number, i: any) => a + (INCIDENT_WEIGHTS[i.Type] ?? 2), 0),
            liveRainMm: rainOnRoute(path, rain), weather: 'dry',
            roadWorksOnRoute: [...new Set(activeWorks.filter((w: any) => w.RoadName && roadText.includes(String(w.RoadName).toLowerCase())).map((w: any) => w.RoadName as string))],
            slowSegments: slowLinks.filter((s: any) => nearRoute({ lat: Number(s.StartLat), lng: Number(s.StartLon) }, path, 25)).length,
            transfers: null, walkMinutes: null, lines: null, score: 0, rank: 0,
          });
        }

        for (const r of (await computeRoutes(from, to, 'TRANSIT', departureUtc)).slice(0, 2)) {
          const steps = (r.legs || []).flatMap((l: any) => l.steps || []);
          const transitSteps = steps.filter((s: any) => s.transitDetails);
          const walkMin = steps.filter((s: any) => s.travelMode === 'WALK').reduce((a: number, s: any) => a + secs(s.staticDuration), 0) / 60;
          const lines = transitSteps.map((s: any) => s.transitDetails.transitLine?.nameShort || '?').join(' > ');
          if (group.some((g) => g.mode === 'public transport' && g.lines === lines)) continue; // duplicate itinerary
          group.push({
            trip, direction, departure: hhmm, mode: 'public transport', route: lines || 'Walk', km: +(r.distanceMeters / 1000).toFixed(1),
            minutes: +(secs(r.duration) / 60).toFixed(1), freeFlowMinutes: null, delayRatio: null, fuelL: null, fuelSGD: null,
            erpGantries: null, erpCharging: null, incidentsOnRoute: [], incidentPenalty: 0, roadWorksOnRoute: [], slowSegments: null,
            liveRainMm: null, weather: 'dry',
            transfers: Math.max(0, transitSteps.length - 1), walkMinutes: +walkMin.toFixed(1), lines, score: 0, rank: 0,
          });
        }

        // Score (lower is better): time, plus money converted at S$0.30 per minute,
        // plus penalties for unreliability, live incidents, transfers and walking.
        for (const w of WEATHER_SCENARIOS) {
          const scenario = group.map((g0) => {
            const g: ProbeRow = { ...g0, weather: w.name };
            if (g.mode === 'car') {
              g.minutes = +(g.minutes * w.driveTime).toFixed(1);
            } else {
              const walk = g.walkMinutes ?? 0;
              g.walkMinutes = +(walk * w.walkTime).toFixed(1);
              g.minutes = +(g.minutes - walk + g.walkMinutes).toFixed(1);
            }
            const money = (g.fuelSGD ?? 0) / 0.3;
            const unreliability = g.delayRatio ? (g.delayRatio - 1) * g.minutes * 0.5 : 0;
            const hazards = g.incidentPenalty + 0.25 * g.roadWorksOnRoute.length + 0.3 * (g.slowSegments ?? 0);
            const erp = g.erpCharging ? 3 * (g.erpGantries ?? 0) : 0; // unpriced: flat penalty per charging gantry
            // Seniors: transfers and walking cost more, and more so in the rain.
            const pt = 4 * (g.transfers ?? 0) + 0.5 * (g.walkMinutes ?? 0) * w.walkTime;
            g.score = +(g.minutes + money + unreliability + hazards + erp + pt).toFixed(1);
            return g;
          });
          scenario.sort((a, b) => a.score - b.score).forEach((g, i) => (g.rank = i + 1));
          rows.push(...scenario);
        }
        process.stdout.write('.');
      }
    }
  }

  const outDir = join(process.cwd(), 'tools', 'route-probe', 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'probe-dataset.json'), JSON.stringify({ origin: ORIGIN, destinations: DESTINATIONS, date: PROBE_DATE, generatedAt: new Date().toISOString(), rows }, null, 2));

  const md: string[] = [`# Route probe — ${PROBE_DATE} (Thu)`, '', `From **${ORIGIN.name}**. Car fuel at S$${FUEL_PRICE_SGD_PER_L}/L (modelled). ERP: gantries passed during charging hours (rates not available). Live incidents/road works/slow segments reflect conditions at probe time.`, ''];
  for (const dest of DESTINATIONS) for (const dir of ['A→B', 'B→A'] as const) {
    md.push(`## ${dir === 'A→B' ? `${ORIGIN.name} → ${dest.name}` : `${dest.name} → ${ORIGIN.name}`}`, '', '| Depart | # | Mode | Route | km | min (free-flow) | Fuel S$ | ERP gantries | Live issues | Transfers / walk | Score |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows.filter((x) => x.trip.endsWith(dest.name) && x.direction === dir && x.weather === 'dry')) {
      const counts: Record<string, number> = {};
      for (const i of r.incidentsOnRoute) counts[i.split(':')[0]] = (counts[i.split(':')[0]] || 0) + 1;
      const issues = [...Object.entries(counts).map(([k, n]) => `${n}× ${k}`), r.roadWorksOnRoute.length ? `${r.roadWorksOnRoute.length} works` : '', r.slowSegments ? `${r.slowSegments} slow seg.` : '', r.liveRainMm ? `rain ${r.liveRainMm}mm` : ''].filter(Boolean).join(', ');
      md.push(`| ${r.departure} | ${r.rank} | ${r.mode} | ${r.route} | ${r.km} | ${r.minutes}${r.freeFlowMinutes !== null ? ` (${r.freeFlowMinutes})` : ''} | ${r.fuelSGD ?? '–'} | ${r.erpGantries ?? '–'}${r.erpCharging ? ' (charging)' : ''} | ${issues} | ${r.transfers !== null ? `${r.transfers} / ${r.walkMinutes} min` : ''} | ${r.score} |`);
    }
    md.push('', `**Best option by weather:** ` + DEPARTURES_SGT.map((t) => {
      const best = (wn: string) => rows.find((x) => x.trip.endsWith(dest.name) && x.direction === dir && x.departure === t && x.weather === wn && x.rank === 1);
      return `${t}: ` + WEATHER_SCENARIOS.map((w) => { const b = best(w.name); return `${w.name} → ${b ? `${b.mode === 'car' ? b.route : 'MRT/bus ' + b.route} (${b.minutes} min)` : '–'}`; }).join(' | ');
    }).join('<br>'), '');
  }
  writeFileSync(join(outDir, 'probe-report.md'), md.join('\n'));
  console.log(`\nWrote ${rows.length} rows to tools/route-probe/out/`);
})().catch((e) => { console.error('Probe failed:', e.message); process.exit(1); });
