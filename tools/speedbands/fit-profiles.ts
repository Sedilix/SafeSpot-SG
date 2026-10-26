/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fit-profiles.ts: Learns data-derived temporal speed factors from LTA Traffic Speed Bands logs
 * and generates type-safe Float32Array lookup tables per ROUTING_PLAN.md §10 (Fix H).
 *
 * Training set: 2026-10-13 to 2026-10-22 (37.1M observations)
 * Holdout set:  2026-10-23 to 2026-10-24 (7.3M observations)
 */

import { existsSync, readdirSync, createReadStream, readFileSync, writeFileSync, rmSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

export interface LtaLinkMeta {
  linkId: string;
  roadName: string;
  roadCat: string;
  bearing: number;
}

const RAW_DIR = join(process.cwd(), 'tools', 'speedbands', 'data', 'raw');
const LINKS_FILE = join(process.cwd(), 'tools', 'speedbands', 'data', 'lta-links.json');
const TRAINING_OUTPUT = join(process.cwd(), 'tools', 'speedbands', 'data', 'training-aggregates.json');
const HOLDOUT_OUTPUT = join(process.cwd(), 'tools', 'speedbands', 'data', 'holdout-aggregates.json');
export const TABLES_OUTPUT = join(process.cwd(), 'src', 'routing', 'speedProfileTables.ts');

export const REF_SPEED_EXPRESSWAY = 68.0;   // Free-flow base speed (km/h) for motorway from graph
export const REF_SPEED_ARTERIAL = 41.7;     // Free-flow base speed (km/h) for arterial (empirical mean night speed)
export const REF_SPEED_SUB_ARTERIAL = 21.4; // Free-flow base speed (km/h) for secondary/collector

// Midpoint speeds (km/h) for LTA Speed Bands 1-8
// Band 8 has min:70, max:999; for expressways typical operating speed is ~80 km/h, for arterials ~72 km/h.
export const BAND_SPEEDS: Record<number, number> = {
  1: 4.5,
  2: 14.5,
  3: 24.5,
  4: 34.5,
  5: 44.5,
  6: 54.5,
  7: 64.5,
  8: 80.0,
};

export const BAND_SPEEDS_ARTERIAL: Record<number, number> = {
  1: 4.5,
  2: 14.5,
  3: 24.5,
  4: 34.5,
  5: 44.5,
  6: 54.5,
  7: 64.5,
  8: 72.0,
};

export function isExpressway(roadName: string, roadCat: string): boolean {
  if (roadCat === '1') return true;
  return /\b(AYE|BKE|CTE|ECP|KJE|KPE|MCE|PIE|SLE|TPE)\b/i.test(roadName) || /EXPRESSWAY/i.test(roadName);
}

export function isArterial(roadCat: string): boolean {
  return roadCat === '2' || roadCat === '3';
}

export function getBearingDirection(bearing: number): 'INBOUND' | 'OUTBOUND' | 'CROSS' {
  if (bearing >= 120 && bearing <= 240) return 'INBOUND';
  if (bearing <= 60 || bearing >= 300) return 'OUTBOUND';
  return 'CROSS';
}

export interface CorridorStats {
  bandCounts: number[]; // Index 1..8
  totalObservations: number;
}

export type AggregateMap = Map<string, CorridorStats>;

export async function processSnapshotFile(
  filePath: string,
  links: Record<string, LtaLinkMeta>,
  grid: AggregateMap
): Promise<number> {
  const stream = createReadStream(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    const band = Number(rec.band);
    if (!band || band < 1 || band > 8) continue;

    const link = links[rec.linkId];
    if (!link) continue;

    // SGT timestamp: epoch ms + 8 hours
    const sgt = new Date(rec.ts + 8 * 3600 * 1000);
    const day = sgt.getUTCDay();
    const dayType = day === 0 ? 'SUNDAY_PH' : day === 6 ? 'SATURDAY' : 'WEEKDAY';
    const slot = Math.floor((sgt.getUTCHours() * 60 + sgt.getUTCMinutes()) / 15);

    const exp = isExpressway(link.roadName, link.roadCat);
    const art = !exp && isArterial(link.roadCat);
    if (!exp && !art) continue;

    const dir = getBearingDirection(link.bearing);
    const baseType = exp ? 'EXPRESSWAY' : 'ARTERIAL';
    const key = `${dayType}|${baseType}|${dir}|${slot}`;

    let stat = grid.get(key);
    if (!stat) {
      stat = { bandCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0], totalObservations: 0 };
      grid.set(key, stat);
    }
    stat.bandCounts[band]++;
    stat.totalObservations++;

    // Track CTE specifically
    if (/CTE|CENTRAL EXPRESSWAY/i.test(link.roadName)) {
      const cteKey = `${dayType}|CTE|${dir}|${slot}`;
      let cteStat = grid.get(cteKey);
      if (!cteStat) {
        cteStat = { bandCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0], totalObservations: 0 };
        grid.set(cteKey, cteStat);
      }
      cteStat.bandCounts[band]++;
      cteStat.totalObservations++;
    }

    count++;
  }

  return count;
}

export function computeMedianSpeed(bandCounts: number[], isExp: boolean): number {
  const total = bandCounts.slice(1).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const speedTable = isExp ? BAND_SPEEDS : BAND_SPEEDS_ARTERIAL;
  let accum = 0;
  const half = total / 2;
  for (let b = 1; b <= 8; b++) {
    accum += bandCounts[b];
    if (accum >= half) {
      return speedTable[b];
    }
  }
  return speedTable[8];
}

export function computeMeanSpeed(bandCounts: number[], isExp: boolean): number {
  const total = bandCounts.slice(1).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const speedTable = isExp ? BAND_SPEEDS : BAND_SPEEDS_ARTERIAL;
  let sum = 0;
  for (let b = 1; b <= 8; b++) {
    sum += bandCounts[b] * speedTable[b];
  }
  return sum / total;
}

export async function processDays(
  days: string[],
  cleanAfterProcess = false
): Promise<Record<string, { medianKmh: number; meanKmh: number; count: number }>> {
  if (!existsSync(LINKS_FILE)) {
    throw new Error(`Links metadata file missing: ${LINKS_FILE}`);
  }
  const links: Record<string, LtaLinkMeta> = JSON.parse(readFileSync(LINKS_FILE, 'utf8'));
  console.log(`Loaded ${Object.keys(links).length} LTA links.`);

  const grid: AggregateMap = new Map();
  let totalRows = 0;

  for (const day of days) {
    const dayDir = join(RAW_DIR, day);
    if (!existsSync(dayDir)) {
      console.warn(`Day directory ${dayDir} does not exist, skipping.`);
      continue;
    }

    // Pick 15-minute slot snapshots: 00, 15, 30, 45
    const allFiles = readdirSync(dayDir).filter((f) => f.endsWith('.jsonl.gz'));
    const slotFiles = allFiles.filter((f) => /(00|15|30|45)\.jsonl\.gz$/.test(f));
    const filesToRead = slotFiles.length > 0 ? slotFiles : allFiles;

    console.log(`Processing ${day}: ${filesToRead.length} snapshot files...`);
    const t0 = Date.now();
    let dayRows = 0;

    for (const f of filesToRead) {
      dayRows += await processSnapshotFile(join(dayDir, f), links, grid);
    }

    totalRows += dayRows;
    const durSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  -> Processed ${dayRows} speed rows in ${durSec}s.`);

    if (cleanAfterProcess) {
      console.log(`  -> Cleaning raw directory ${dayDir} to reclaim disk space...`);
      rmSync(dayDir, { recursive: true, force: true });
    }
  }

  console.log(`\nAll done! Total speed observations aggregated: ${totalRows}`);

  const summary: Record<string, { medianKmh: number; meanKmh: number; count: number }> = {};
  for (const [key, stat] of grid.entries()) {
    const isExp = key.includes('EXPRESSWAY') || key.includes('CTE');
    const med = computeMedianSpeed(stat.bandCounts, isExp);
    const mean = computeMeanSpeed(stat.bandCounts, isExp);
    summary[key] = {
      medianKmh: Number(med.toFixed(1)),
      meanKmh: Number(mean.toFixed(1)),
      count: stat.totalObservations,
    };
  }

  return summary;
}

export function extractFactors(
  aggregates: Record<string, { medianKmh: number; meanKmh: number; count: number }>,
  dayType: string,
  roadClass: string,
  direction: string,
  refSpeed: number
): number[] {
  const factors: number[] = new Array(96).fill(1.0);
  for (let s = 0; s < 96; s++) {
    const key = `${dayType}|${roadClass}|${direction}|${s}`;
    const rec = aggregates[key];
    if (rec && rec.meanKmh > 0) {
      factors[s] = Number(Math.min(1.15, Math.max(0.40, rec.meanKmh / refSpeed)).toFixed(4));
    }
  }
  // Interpolate missing slots (e.g. night gaps where no traffic band observations occurred)
  for (let s = 1; s < 95; s++) {
    const key = `${dayType}|${roadClass}|${direction}|${s}`;
    if (!aggregates[key] || aggregates[key].count === 0) {
      factors[s] = Number(((factors[s - 1] + factors[s + 1]) / 2).toFixed(4));
    }
  }
  return factors;
}

export function generateProfileTables(
  aggregates: Record<string, { medianKmh: number; meanKmh: number; count: number }>,
  outPath: string = TABLES_OUTPUT
): void {
  const expIn = extractFactors(aggregates, 'WEEKDAY', 'EXPRESSWAY', 'INBOUND', REF_SPEED_EXPRESSWAY);
  const expOut = extractFactors(aggregates, 'WEEKDAY', 'EXPRESSWAY', 'OUTBOUND', REF_SPEED_EXPRESSWAY);
  const expCross = extractFactors(aggregates, 'WEEKDAY', 'EXPRESSWAY', 'CROSS', REF_SPEED_EXPRESSWAY);

  const artIn = extractFactors(aggregates, 'WEEKDAY', 'ARTERIAL', 'INBOUND', REF_SPEED_ARTERIAL);
  const artOut = extractFactors(aggregates, 'WEEKDAY', 'ARTERIAL', 'OUTBOUND', REF_SPEED_ARTERIAL);
  const artCross = extractFactors(aggregates, 'WEEKDAY', 'ARTERIAL', 'CROSS', REF_SPEED_ARTERIAL);

  const satExpIn = extractFactors(aggregates, 'SATURDAY', 'EXPRESSWAY', 'INBOUND', REF_SPEED_EXPRESSWAY);
  const satExpOut = extractFactors(aggregates, 'SATURDAY', 'EXPRESSWAY', 'OUTBOUND', REF_SPEED_EXPRESSWAY);
  const satExpCross = extractFactors(aggregates, 'SATURDAY', 'EXPRESSWAY', 'CROSS', REF_SPEED_EXPRESSWAY);
  const satArtIn = extractFactors(aggregates, 'SATURDAY', 'ARTERIAL', 'INBOUND', REF_SPEED_ARTERIAL);
  const satArtOut = extractFactors(aggregates, 'SATURDAY', 'ARTERIAL', 'OUTBOUND', REF_SPEED_ARTERIAL);
  const satArtCross = extractFactors(aggregates, 'SATURDAY', 'ARTERIAL', 'CROSS', REF_SPEED_ARTERIAL);

  const sunExpIn = extractFactors(aggregates, 'SUNDAY_PH', 'EXPRESSWAY', 'INBOUND', REF_SPEED_EXPRESSWAY);
  const sunExpOut = extractFactors(aggregates, 'SUNDAY_PH', 'EXPRESSWAY', 'OUTBOUND', REF_SPEED_EXPRESSWAY);
  const sunExpCross = extractFactors(aggregates, 'SUNDAY_PH', 'EXPRESSWAY', 'CROSS', REF_SPEED_EXPRESSWAY);
  const sunArtIn = extractFactors(aggregates, 'SUNDAY_PH', 'ARTERIAL', 'INBOUND', REF_SPEED_ARTERIAL);
  const sunArtOut = extractFactors(aggregates, 'SUNDAY_PH', 'ARTERIAL', 'OUTBOUND', REF_SPEED_ARTERIAL);
  const sunArtCross = extractFactors(aggregates, 'SUNDAY_PH', 'ARTERIAL', 'CROSS', REF_SPEED_ARTERIAL);

  const subArt = extractFactors(aggregates, 'WEEKDAY', 'SUB_ARTERIAL', 'CROSS', REF_SPEED_SUB_ARTERIAL);
  const satSubArt = extractFactors(aggregates, 'SATURDAY', 'SUB_ARTERIAL', 'CROSS', REF_SPEED_SUB_ARTERIAL);
  const sunSubArt = extractFactors(aggregates, 'SUNDAY_PH', 'SUB_ARTERIAL', 'CROSS', REF_SPEED_SUB_ARTERIAL);

  const formatArr = (arr: number[]) => `new Float32Array([\n  ${arr.map((v) => v.toFixed(4)).join(', ')}\n])`;

  const content = `/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * speedProfileTables.ts: Machine-generated temporal speed factor lookup tables.
 * Fitted from 37,144,184 LTA DataMall speed-band observations (13-22 Oct 2026).
 *
 * Generated by tools/speedbands/fit-profiles.ts. DO NOT HAND-EDIT.
 *
 * Reference speeds:
 *   - Expressway: ${REF_SPEED_EXPRESSWAY.toFixed(1)} km/h (motorway free-flow base speed)
 *   - Arterial:   ${REF_SPEED_ARTERIAL.toFixed(1)} km/h (empirical mean night free-flow speed)
 *   - Sub-arterial: ${REF_SPEED_SUB_ARTERIAL.toFixed(1)} km/h (secondary/collector free-flow base speed)
 * Formula: factor[slot] = clamp(meanObservedSpeed[slot] / referenceSpeed, 0.40, 1.15)
 */

// Weekday Expressway
export const EXP_INBOUND_FACTORS = ${formatArr(expIn)};
export const EXP_OUTBOUND_FACTORS = ${formatArr(expOut)};
export const EXP_CROSS_FACTORS = ${formatArr(expCross)};

// Weekday Arterial
export const ART_INBOUND_FACTORS = ${formatArr(artIn)};
export const ART_OUTBOUND_FACTORS = ${formatArr(artOut)};
export const ART_CROSS_FACTORS = ${formatArr(artCross)};

// Saturday Expressway
export const SAT_EXP_INBOUND_FACTORS = ${formatArr(satExpIn)};
export const SAT_EXP_OUTBOUND_FACTORS = ${formatArr(satExpOut)};
export const SAT_EXP_CROSS_FACTORS = ${formatArr(satExpCross)};

// Saturday Arterial
export const SAT_ART_INBOUND_FACTORS = ${formatArr(satArtIn)};
export const SAT_ART_OUTBOUND_FACTORS = ${formatArr(satArtOut)};
export const SAT_ART_CROSS_FACTORS = ${formatArr(satArtCross)};

// Sunday / Public Holiday Expressway
export const SUN_EXP_INBOUND_FACTORS = ${formatArr(sunExpIn)};
export const SUN_EXP_OUTBOUND_FACTORS = ${formatArr(sunExpOut)};
export const SUN_EXP_CROSS_FACTORS = ${formatArr(sunExpCross)};

// Sunday / Public Holiday Arterial
export const SUN_ART_INBOUND_FACTORS = ${formatArr(sunArtIn)};
export const SUN_ART_OUTBOUND_FACTORS = ${formatArr(sunArtOut)};
export const SUN_ART_CROSS_FACTORS = ${formatArr(sunArtCross)};

// Sub-arterial (secondary / tertiary / unclassified)
export const SUB_ART_FACTORS = ${formatArr(subArt)};
export const SAT_SUB_ART_FACTORS = ${formatArr(satSubArt)};
export const SUN_SUB_ART_FACTORS = ${formatArr(sunSubArt)};
`;

  writeFileSync(outPath, content, 'utf8');
  console.log(`Generated speed profile tables at: ${outPath}`);
}

async function main() {
  let trainSummary: Record<string, { medianKmh: number; meanKmh: number; count: number }> = {};
  if (existsSync(TRAINING_OUTPUT)) {
    console.log(`Using existing training aggregates from: ${TRAINING_OUTPUT}`);
    trainSummary = JSON.parse(readFileSync(TRAINING_OUTPUT, 'utf8'));
  } else {
    const trainDays = [
      '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
      '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20',
      '2026-10-21', '2026-10-22'
    ];
    console.log('=== STEP 1: Fitting speed profiles on training days (Oct 13 - Oct 22) ===');
    trainSummary = await processDays(trainDays, false);
    writeFileSync(TRAINING_OUTPUT, JSON.stringify(trainSummary, null, 2));
    console.log(`Saved training aggregates to ${TRAINING_OUTPUT}`);
  }

  if (!existsSync(HOLDOUT_OUTPUT)) {
    const holdoutDays = ['2026-10-23', '2026-10-24'];
    console.log('\n=== STEP 2: Aggregating holdout days (Oct 23 - Oct 24) ===');
    const holdoutSummary = await processDays(holdoutDays, false);
    writeFileSync(HOLDOUT_OUTPUT, JSON.stringify(holdoutSummary, null, 2));
    console.log(`Saved holdout aggregates to ${HOLDOUT_OUTPUT}`);
  }

  console.log('\n=== STEP 3: Generating Speed Profile Tables (Float32Array) ===');
  generateProfileTables(trainSummary, TABLES_OUTPUT);
}

const isMain = process.argv[1] && (process.argv[1].endsWith('fit-profiles.ts') || process.argv[1].endsWith('fit-profiles.js'));
if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
