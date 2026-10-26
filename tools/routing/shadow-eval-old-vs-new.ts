/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * shadow-eval-old-vs-new.ts: Compares old vs new speed factors against
 * Google baseline across the legacy shadow probe rows (2026-10-13 to 2026-10-23).
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { RoadGraph } from '../../src/routing/graph';
import { Router } from '../../src/routing/router';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles';
import { SHADOW_PAIRS } from './shadow-probe';

const SHADOW_DIR = join(process.cwd(), 'tools', 'routing', 'out', 'shadow');

interface LegacyRow {
  at: string;
  pairId: string;
  localSec: number;
  googleSec?: number;
  googleOk?: boolean;
}

const pairsMap = new Map(SHADOW_PAIRS.map((p) => [p.id, p]));

function loadRows(): LegacyRow[] {
  const files = readdirSync(SHADOW_DIR).filter((f) => f.endsWith('.jsonl')).sort();
  const rows: LegacyRow[] = [];
  for (const f of files) {
    const lines = readFileSync(join(SHADOW_DIR, f), 'utf8').split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const obj = JSON.parse(l);
        if (obj.googleOk === true && typeof obj.googleSec === 'number' && obj.googleSec > 0 && !obj.simulated) {
          rows.push(obj);
        }
      } catch {}
    }
  }
  return rows;
}

const rows = loadRows();
console.log(`Loaded ${rows.length} usable shadow records with Google ground truth.`);

if (rows.length === 0) {
  console.log('No historical Google rows found.');
  process.exit(0);
}

const graph = RoadGraph.loadDefault();
const router = new Router(graph);
const engine = new SpeedProfileEngine();

// Evaluate each row
let sumAbsDiffOld = 0;
let sumSignedDiffOld = 0;
let sumAbsDiffNew = 0;
let sumSignedDiffNew = 0;
let count = 0;

const byHourOld: Record<number, { absErrSum: number; count: number }> = {};
const byHourNew: Record<number, { absErrSum: number; count: number }> = {};
const byPairOld: Record<string, { absErrSum: number; count: number }> = {};
const byPairNew: Record<string, { absErrSum: number; count: number }> = {};

for (const r of rows) {
  const pair = pairsMap.get(r.pairId);
  if (!pair) continue;
  const departure = new Date(r.at);
  const route = router.findRoute(pair.origin, pair.dest, { departureTime: departure, speedProfiles: engine });
  if (!route) continue;

  const googleSec = r.googleSec!;
  const oldSec = r.localSec;
  const newSec = route.durationSeconds;

  const oldAbsErr = Math.abs(oldSec - googleSec) / googleSec;
  const newAbsErr = Math.abs(newSec - googleSec) / googleSec;
  const oldSignedErr = (oldSec - googleSec) / googleSec;
  const newSignedErr = (newSec - googleSec) / googleSec;

  sumAbsDiffOld += oldAbsErr;
  sumSignedDiffOld += oldSignedErr;
  sumAbsDiffNew += newAbsErr;
  sumSignedDiffNew += newSignedErr;
  count++;

  const sgtHour = (departure.getUTCHours() + 8) % 24;
  if (!byHourOld[sgtHour]) {
    byHourOld[sgtHour] = { absErrSum: 0, count: 0 };
    byHourNew[sgtHour] = { absErrSum: 0, count: 0 };
  }
  byHourOld[sgtHour].absErrSum += oldAbsErr;
  byHourOld[sgtHour].count++;
  byHourNew[sgtHour].absErrSum += newAbsErr;
  byHourNew[sgtHour].count++;

  if (!byPairOld[r.pairId]) {
    byPairOld[r.pairId] = { absErrSum: 0, count: 0 };
    byPairNew[r.pairId] = { absErrSum: 0, count: 0 };
  }
  byPairOld[r.pairId].absErrSum += oldAbsErr;
  byPairOld[r.pairId].count++;
  byPairNew[r.pairId].absErrSum += newAbsErr;
  byPairNew[r.pairId].count++;
}

console.log(`\n=== OVERALL SHADOW PROBE COMPARISON (N = ${count}) ===`);
console.log(`Old Heuristic Mean Absolute Error: ${(sumAbsDiffOld / count * 100).toFixed(2)}%`);
console.log(`New Data-Derived Mean Absolute Error: ${(sumAbsDiffNew / count * 100).toFixed(2)}%`);
console.log(`Old Mean Signed Error (Bias): ${(sumSignedDiffOld / count * 100).toFixed(2)}%`);
console.log(`New Mean Signed Error (Bias): ${(sumSignedDiffNew / count * 100).toFixed(2)}%`);

console.log('\n=== ERROR BY TIME OF DAY (SGT Hour) ===');
console.log('Hour | Count | Old Abs Error | New Abs Error | Improvement');
console.log('---------------------------------------------------------');
for (const h of Object.keys(byHourOld).map(Number).sort((a, b) => a - b)) {
  const o = byHourOld[h];
  const n = byHourNew[h];
  const oldErr = (o.absErrSum / o.count * 100).toFixed(2);
  const newErr = (n.absErrSum / n.count * 100).toFixed(2);
  const imp = (Number(oldErr) - Number(newErr)).toFixed(2);
  console.log(`${String(h).padStart(4, '0')}:00 | ${String(o.count).padStart(5)} | ${oldErr.padStart(12)}% | ${newErr.padStart(12)}% | ${imp.padStart(10)}%`);
}

console.log('\n=== ERROR BY TRIP PAIR ===');
console.log('Pair ID                          | Count | Old Abs Error | New Abs Error | Improvement');
console.log('--------------------------------------------------------------------------------------');
for (const pid of Object.keys(byPairOld).sort()) {
  const o = byPairOld[pid];
  const n = byPairNew[pid];
  const oldErr = (o.absErrSum / o.count * 100).toFixed(2);
  const newErr = (n.absErrSum / n.count * 100).toFixed(2);
  const imp = (Number(oldErr) - Number(newErr)).toFixed(2);
  console.log(`${pid.padEnd(32)} | ${String(o.count).padStart(5)} | ${oldErr.padStart(12)}% | ${newErr.padStart(12)}% | ${imp.padStart(10)}%`);
}
