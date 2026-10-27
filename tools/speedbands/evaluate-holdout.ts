/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * evaluate-holdout.ts: Evaluates data-derived speed profiles against held-out
 * LTA Traffic Speed Bands (23–24 Oct 2026, 7.3M observations).
 *
 * Clean-room evaluation per docs/clean-room-calibration.md:
 * Uses zero Google data. Reports predicted vs observed speed across road classes,
 * directions, day types, and time slots with pass/fail computed against explicit targets.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  EXP_INBOUND_FACTORS,
  EXP_OUTBOUND_FACTORS,
  EXP_CROSS_FACTORS,
  ART_INBOUND_FACTORS,
  ART_OUTBOUND_FACTORS,
  ART_CROSS_FACTORS,
  SAT_EXP_INBOUND_FACTORS,
  SAT_EXP_OUTBOUND_FACTORS,
  SAT_EXP_CROSS_FACTORS,
  SAT_ART_INBOUND_FACTORS,
  SAT_ART_OUTBOUND_FACTORS,
  SAT_ART_CROSS_FACTORS,
} from '../../src/routing/speedProfileTables';

const HOLDOUT_FILE = join(process.cwd(), 'tools', 'speedbands', 'data', 'holdout-aggregates.json');
const OUT_DIR = join(process.cwd(), 'tools', 'speedbands', 'out');
const REPORT_FILE = join(OUT_DIR, 'lta-holdout-evaluation.md');

const REF_SPEED_EXP = 68.0; // km/h
const REF_SPEED_ART = 41.7; // km/h

// Explicit Clean-Room Acceptance Targets (docs/clean-room-calibration.md §4)
const TARGET_OVERALL_MAE = 10.0;    // <= 10.0%
const TARGET_MAX_BIAS = 5.0;        // within [-5.0%, +5.0%]
const TARGET_PEAK_MAE = 15.0;       // <= 15.0%

interface EvalRow {
  key: string;
  dayType: string;
  roadClass: 'EXPRESSWAY' | 'ARTERIAL';
  direction: 'INBOUND' | 'OUTBOUND' | 'CROSS';
  slot: number;
  timeStr: string;
  timeCategory: 'Morning Peak' | 'Midday' | 'Evening Peak' | 'Night / Off-Peak';
  predKmh: number;
  obsKmh: number;
  absErrPct: number;
  signedErrPct: number;
}

function getFactor(dayType: string, roadClass: string, direction: string, slot: number): number {
  if (dayType === 'WEEKDAY') {
    if (roadClass === 'EXPRESSWAY') {
      return direction === 'INBOUND' ? EXP_INBOUND_FACTORS[slot] : direction === 'OUTBOUND' ? EXP_OUTBOUND_FACTORS[slot] : EXP_CROSS_FACTORS[slot];
    } else {
      return direction === 'INBOUND' ? ART_INBOUND_FACTORS[slot] : direction === 'OUTBOUND' ? ART_OUTBOUND_FACTORS[slot] : ART_CROSS_FACTORS[slot];
    }
  } else if (dayType === 'SATURDAY') {
    if (roadClass === 'EXPRESSWAY') {
      return direction === 'INBOUND' ? SAT_EXP_INBOUND_FACTORS[slot] : direction === 'OUTBOUND' ? SAT_EXP_OUTBOUND_FACTORS[slot] : SAT_EXP_CROSS_FACTORS[slot];
    } else {
      return direction === 'INBOUND' ? SAT_ART_INBOUND_FACTORS[slot] : direction === 'OUTBOUND' ? SAT_ART_OUTBOUND_FACTORS[slot] : SAT_ART_CROSS_FACTORS[slot];
    }
  }
  return 1.0;
}

function getTimeCategory(slot: number): 'Morning Peak' | 'Midday' | 'Evening Peak' | 'Night / Off-Peak' {
  if (slot >= 28 && slot <= 38) return 'Morning Peak';
  if (slot >= 46 && slot <= 56) return 'Midday';
  if (slot >= 68 && slot <= 80) return 'Evening Peak';
  return 'Night / Off-Peak';
}

function runEvaluation() {
  if (!existsSync(HOLDOUT_FILE)) {
    console.error(`Holdout file not found: ${HOLDOUT_FILE}`);
    process.exit(1);
  }

  const holdout: Record<string, { medianKmh: number; meanKmh: number; count: number }> = JSON.parse(
    readFileSync(HOLDOUT_FILE, 'utf8')
  );

  const rows: EvalRow[] = [];

  for (const [key, val] of Object.entries(holdout)) {
    if (!val || val.count === 0 || !val.meanKmh) continue;
    const parts = key.split('|');
    if (parts.length !== 4) continue;
    const [dayType, roadClass, direction, slotStr] = parts;
    if (roadClass !== 'EXPRESSWAY' && roadClass !== 'ARTERIAL') continue;
    if (direction !== 'INBOUND' && direction !== 'OUTBOUND' && direction !== 'CROSS') continue;

    const slot = parseInt(slotStr, 10);
    const refSpeed = roadClass === 'EXPRESSWAY' ? REF_SPEED_EXP : REF_SPEED_ART;
    const factor = getFactor(dayType, roadClass, direction, slot);
    const predKmh = Number((refSpeed * factor).toFixed(2));
    const obsKmh = val.meanKmh;

    const absErrPct = Math.abs(predKmh - obsKmh) / obsKmh * 100;
    const signedErrPct = (predKmh - obsKmh) / obsKmh * 100;

    const hh = Math.floor(slot / 4);
    const mm = (slot % 4) * 15;
    const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    rows.push({
      key,
      dayType,
      roadClass: roadClass as any,
      direction: direction as any,
      slot,
      timeStr,
      timeCategory: getTimeCategory(slot),
      predKmh,
      obsKmh,
      absErrPct,
      signedErrPct,
    });
  }

  if (rows.length === 0) {
    console.error('No valid holdout evaluation rows extracted.');
    process.exit(1);
  }

  // Aggregate stats
  const calcStats = (items: EvalRow[]) => {
    const n = items.length;
    const mae = items.reduce((s, r) => s + r.absErrPct, 0) / n;
    const bias = items.reduce((s, r) => s + r.signedErrPct, 0) / n;
    const sortedAbs = [...items.map((r) => r.absErrPct)].sort((a, b) => a - b);
    const p95 = sortedAbs[Math.floor(n * 0.95)] ?? sortedAbs[n - 1];
    return { count: n, mae, bias, p95 };
  };

  const overall = calcStats(rows);
  const overallMaeStatus = overall.mae <= TARGET_OVERALL_MAE ? 'PASS' : 'FAIL';
  const overallBiasStatus = Math.abs(overall.bias) <= TARGET_MAX_BIAS ? 'PASS' : 'FAIL';

  // Group by Road Class
  const expRows = rows.filter((r) => r.roadClass === 'EXPRESSWAY');
  const artRows = rows.filter((r) => r.roadClass === 'ARTERIAL');
  const expStats = calcStats(expRows);
  const artStats = calcStats(artRows);

  // Group by Day Type
  const weekdayRows = rows.filter((r) => r.dayType === 'WEEKDAY');
  const saturdayRows = rows.filter((r) => r.dayType === 'SATURDAY');
  const weekdayStats = calcStats(weekdayRows);
  const saturdayStats = calcStats(saturdayRows);

  // Group by Time Category
  const timeCategories = ['Morning Peak', 'Midday', 'Evening Peak', 'Night / Off-Peak'] as const;
  const timeStats = timeCategories.map((cat) => ({
    category: cat,
    stats: calcStats(rows.filter((r) => r.timeCategory === cat)),
  }));

  // Build Markdown Report
  let md = `# Clean-Room Speed Profile Evaluation Report (LTA Held-Out Dataset)

**Dataset**: LTA DataMall Traffic Speed Bands held-out days: **2026-10-23 (Friday)** and **2026-10-24 (Saturday)**  
**Sample Size**: ${rows.length} 15-minute slot corridors evaluated (7.3M raw speed observations)  
**Methodology**: Clean-room calibration against open government telemetry per \`docs/clean-room-calibration.md\`. Zero Google Maps data used.  
**Generated At**: ${new Date().toISOString()}  

---

## 1. Executive Summary & Acceptance Gates

| Acceptance Gate | Target | Measured Value | Status |
| :--- | :---: | :---: | :---: |
| **Overall Mean Absolute Error (MAE)** | $\\le ${TARGET_OVERALL_MAE.toFixed(1)}\\%$ | **${overall.mae.toFixed(2)}%** | **${overallMaeStatus}** |
| **Mean Signed Error (Bias)** | $\\pm ${TARGET_MAX_BIAS.toFixed(1)}\\%$ | **${overall.bias >= 0 ? '+' : ''}${overall.bias.toFixed(2)}%** | **${overallBiasStatus}** |
| **p95 Absolute Error** | $\\le 20.0\\%$ | **${overall.p95.toFixed(2)}%** | **${overall.p95 <= 20.0 ? 'PASS' : 'FAIL'}** |

---

## 2. Road Class Breakdown

| Road Class | Slots (N) | Reference Free-Flow Speed | Mean Predicted Speed | Mean Observed Speed | MAE | Bias | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Expressway** | ${expStats.count} | ${REF_SPEED_EXP.toFixed(1)} km/h | ${(expRows.reduce((s, r) => s + r.predKmh, 0) / expRows.length).toFixed(1)} km/h | ${(expRows.reduce((s, r) => s + r.obsKmh, 0) / expRows.length).toFixed(1)} km/h | **${expStats.mae.toFixed(2)}%** | **${expStats.bias >= 0 ? '+' : ''}${expStats.bias.toFixed(2)}%** | **${expStats.mae <= TARGET_OVERALL_MAE ? 'PASS' : 'FAIL'}** |
| **Arterial** | ${artStats.count} | ${REF_SPEED_ART.toFixed(1)} km/h | ${(artRows.reduce((s, r) => s + r.predKmh, 0) / artRows.length).toFixed(1)} km/h | ${(artRows.reduce((s, r) => s + r.obsKmh, 0) / artRows.length).toFixed(1)} km/h | **${artStats.mae.toFixed(2)}%** | **${artStats.bias >= 0 ? '+' : ''}${artStats.bias.toFixed(2)}%** | **${artStats.mae <= TARGET_OVERALL_MAE ? 'PASS' : 'FAIL'}** |

---

## 3. Day Type Breakdown

| Day Type | Slots (N) | MAE | Bias | p95 Error | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Weekday (Fri 23 Oct)** | ${weekdayStats.count} | **${weekdayStats.mae.toFixed(2)}%** | **${weekdayStats.bias >= 0 ? '+' : ''}${weekdayStats.bias.toFixed(2)}%** | ${weekdayStats.p95.toFixed(2)}% | **${weekdayStats.mae <= TARGET_OVERALL_MAE ? 'PASS' : 'FAIL'}** |
| **Saturday (Sat 24 Oct)** | ${saturdayStats.count} | **${saturdayStats.mae.toFixed(2)}%** | **${saturdayStats.bias >= 0 ? '+' : ''}${saturdayStats.bias.toFixed(2)}%** | ${saturdayStats.p95.toFixed(2)}% | **${saturdayStats.mae <= TARGET_OVERALL_MAE ? 'PASS' : 'FAIL'}** |

---

## 4. Time-of-Day Breakdown

| Time Window | Slots (N) | Target MAE | Measured MAE | Bias | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
`;

  for (const t of timeStats) {
    const isPeak = t.category.includes('Peak');
    const target = isPeak ? TARGET_PEAK_MAE : TARGET_OVERALL_MAE;
    const status = t.stats.mae <= target ? 'PASS' : 'FAIL';
    md += `| **${t.category}** | ${t.stats.count} | $\\le ${target.toFixed(1)}\\%$ | **${t.stats.mae.toFixed(2)}%** | **${t.stats.bias >= 0 ? '+' : ''}${t.stats.bias.toFixed(2)}%** | **${status}** |\n`;
  }

  md += `
---

## 5. Directional Corridor Accuracy (Weekday vs Saturday)

| Day Type | Road Class | Direction | MAE | Bias |
| :--- | :--- | :--- | :---: | :---: |
`;

  for (const dt of ['WEEKDAY', 'SATURDAY']) {
    for (const rc of ['EXPRESSWAY', 'ARTERIAL']) {
      for (const dir of ['INBOUND', 'OUTBOUND', 'CROSS']) {
        const sub = rows.filter((r) => r.dayType === dt && r.roadClass === rc && r.direction === dir);
        if (sub.length === 0) continue;
        const s = calcStats(sub);
        md += `| ${dt} | ${rc} | ${dir} | **${s.mae.toFixed(2)}%** | **${s.bias >= 0 ? '+' : ''}${s.bias.toFixed(2)}%** |\n`;
      }
    }
  }

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  writeFileSync(REPORT_FILE, md, 'utf8');
  console.log(`\n=== LTA HELDOUT SPEED PROFILE EVALUATION (CLEAN-ROOM) ===`);
  console.log(`Evaluated Slots: ${rows.length}`);
  console.log(`Overall MAE:     ${overall.mae.toFixed(2)}% (Target <= ${TARGET_OVERALL_MAE}%) -> ${overallMaeStatus}`);
  console.log(`Overall Bias:    ${overall.bias >= 0 ? '+' : ''}${overall.bias.toFixed(2)}% (Target within +- ${TARGET_MAX_BIAS}%) -> ${overallBiasStatus}`);
  console.log(`p95 Error:       ${overall.p95.toFixed(2)}% (Target <= 20.0%)`);
  console.log(`Report written to: ${REPORT_FILE}\n`);
}

runEvaluation();
