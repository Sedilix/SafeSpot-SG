/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fit-profiles.ts: Learns data-derived temporal speed factors and free-flow speeds
 * from LTA Traffic Speed Bands logs per ROUTING_PLAN.md §10 (Fix H).
 *
 * Training set: 2026-10-13 to 2026-10-22
 * Holdout set:  2026-10-23 to 2026-10-24
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
  cleanAfterProcess = true
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

async function main() {
  const trainDays = [
    '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
    '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20',
    '2026-10-21', '2026-10-22'
  ];
  console.log('=== STEP 1: Fitting speed profiles on training days (Oct 13 - Oct 22) ===');
  const trainSummary = await processDays(trainDays, true);
  writeFileSync(TRAINING_OUTPUT, JSON.stringify(trainSummary, null, 2));
  console.log(`Saved training aggregates to ${TRAINING_OUTPUT}`);

  const holdoutDays = ['2026-10-23', '2026-10-24'];
  console.log('\n=== STEP 2: Aggregating holdout days (Oct 23 - Oct 24) ===');
  const holdoutSummary = await processDays(holdoutDays, true);
  writeFileSync(HOLDOUT_OUTPUT, JSON.stringify(holdoutSummary, null, 2));
  console.log(`Saved holdout aggregates to ${HOLDOUT_OUTPUT}`);
}

const isMain = process.argv[1] && (process.argv[1].endsWith('fit-profiles.ts') || process.argv[1].endsWith('fit-profiles.js'));
if (isMain) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
