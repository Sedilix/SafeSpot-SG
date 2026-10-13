/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * shadow-report.ts: Synthesizes comparative evaluation telemetry from
 * shadow-probe records into a structured markdown report.
 *
 * Evaluates:
 *  - Median absolute error & mean signed error overall, by time of day, and by pair.
 *  - Median and p95 latency.
 *  - Generates tools/routing/out/shadow-report.md.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ShadowRecord } from './shadow-probe';

export interface GroupStats {
  count: number;
  medianAbsErrorPct: number;
  meanSignedErrorPct: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
}

/**
 * Rows where Google really answered. Rows from before 2026-10-13 ~08:00 UTC
 * (no `googleOk` field) were written while every Google query failed and the
 * engine's own time was copied in, so they read as false 0% errors.
 */
export function isUsable(r: ShadowRecord): boolean {
  return r.googleOk === true && typeof r.diffPct === 'number' && !r.simulated;
}

export function computeStats(all: ShadowRecord[]): GroupStats {
  const records = all.filter(isUsable);
  if (records.length === 0) {
    return {
      count: 0,
      medianAbsErrorPct: 0,
      meanSignedErrorPct: 0,
      medianLatencyMs: 0,
      p95LatencyMs: 0,
    };
  }

  const absErrors = records.map((r) => Math.abs(r.diffPct as number)).sort((a, b) => a - b);
  const signedErrors = records.map((r) => r.diffPct as number);
  const latencies = records.map((r) => r.localMs).sort((a, b) => a - b);

  const medianAbs = absErrors[Math.floor(absErrors.length / 2)];
  const meanSigned = signedErrors.reduce((a, b) => a + b, 0) / signedErrors.length;

  const medianLat = latencies[Math.floor(latencies.length / 2)];
  const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  const p95Lat = latencies[p95Idx];

  return {
    count: records.length,
    medianAbsErrorPct: Number(medianAbs.toFixed(2)),
    meanSignedErrorPct: Number(meanSigned.toFixed(2)),
    medianLatencyMs: Math.round(medianLat),
    p95LatencyMs: Math.round(p95Lat),
  };
}

export function resolveTimeOfDay(isoString: string): string {
  const d = new Date(isoString);
  // SGT is UTC+8
  const sgtHours = (d.getUTCHours() + 8) % 24;
  const sgtMins = d.getUTCMinutes();
  const timeNum = sgtHours + sgtMins / 60;

  if (timeNum >= 7.0 && timeNum <= 9.5) return 'Morning Peak (07:00-09:30)';
  if (timeNum >= 11.5 && timeNum <= 14.0) return 'Midday (11:30-14:00)';
  if (timeNum >= 17.0 && timeNum <= 20.0) return 'Evening Peak (17:00-20:00)';
  return 'Night / Off-Peak';
}

export function loadLocalRecords(shadowDir: string): ShadowRecord[] {
  if (!existsSync(shadowDir)) return [];
  const files = readdirSync(shadowDir).filter((f) => f.endsWith('.jsonl'));
  const records: ShadowRecord[] = [];

  for (const f of files) {
    const lines = readFileSync(join(shadowDir, f), 'utf8').split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        records.push(JSON.parse(l));
      } catch {
        // Skip malformed lines
      }
    }
  }
  return records;
}

export function generateReportMarkdown(records: ShadowRecord[]): string {
  const overall = computeStats(records);
  const targetMae = 20.0;
  const targetLatency = 200;

  let md = `# SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report\n\n`;
  md += `**Generated**: ${new Date().toISOString()}  \n`;
  md += `**Usable Observations**: ${records.filter(isUsable).length} of ${records.length} (rows where Google failed, or written before the 2026-10-13 fix, are excluded)  \n`;
  md += `**Evaluation Basis**: SafeSpot Traffic-Aware Engine vs Google Routes API (TRAFFIC_AWARE)  \n\n`;

  md += `## Acceptance Criteria Summary\n\n`;
  md += `| Metric | Target | Status | Measured Value |\n`;
  md += `|---|---|---|---|\n`;

  const maePass = overall.count > 0 && overall.medianAbsErrorPct <= targetMae;
  md += `| **Median Absolute Error** | $\\le 20.0\\%$ | **${maePass ? 'PASS' : 'FAIL'}** | ${overall.medianAbsErrorPct}% |\n`;

  const latPass = overall.count > 0 && overall.medianLatencyMs < targetLatency;
  md += `| **Median Engine Latency** | $< 200$ ms | **${latPass ? 'PASS' : 'FAIL'}** | ${overall.medianLatencyMs} ms (p95: ${overall.p95LatencyMs} ms) |\n`;

  md += `| **Mean Signed Error** | Bias monitor | **INFO** | ${overall.meanSignedErrorPct > 0 ? '+' : ''}${overall.meanSignedErrorPct}% |\n\n`;

  // Time of day breakdown
  md += `## Time-of-Day Performance Breakdown\n\n`;
  md += `| Time Slot (SGT) | Probes | Median Abs Error | Mean Signed Error | Median Latency | p95 Latency |\n`;
  md += `|---|---|---|---|---|---|\n`;

  const timeGroups = new Map<string, ShadowRecord[]>();
  for (const r of records) {
    const slot = resolveTimeOfDay(r.at);
    let list = timeGroups.get(slot);
    if (!list) {
      list = [];
      timeGroups.set(slot, list);
    }
    list.push(r);
  }

  const slotsOrder = [
    'Morning Peak (07:00-09:30)',
    'Midday (11:30-14:00)',
    'Evening Peak (17:00-20:00)',
    'Night / Off-Peak',
  ];

  for (const slot of slotsOrder) {
    const list = timeGroups.get(slot) || [];
    const stats = computeStats(list);
    md += `| **${slot}** | ${stats.count} | ${stats.medianAbsErrorPct}% | ${stats.meanSignedErrorPct > 0 ? '+' : ''}${stats.meanSignedErrorPct}% | ${stats.medianLatencyMs} ms | ${stats.p95LatencyMs} ms |\n`;
  }
  md += `\n`;

  // By Pair breakdown
  md += `## Corridor Pairwise Breakdown (10 Fixed Corridors)\n\n`;
  md += `| Corridor ID | Observations | Median Abs Error | Mean Signed Error | Median Latency |\n`;
  md += `|---|---|---|---|---|\n`;

  const pairGroups = new Map<string, ShadowRecord[]>();
  for (const r of records) {
    let list = pairGroups.get(r.pairId);
    if (!list) {
      list = [];
      pairGroups.set(r.pairId, list);
    }
    list.push(r);
  }

  for (const [pairId, list] of pairGroups.entries()) {
    const stats = computeStats(list);
    md += `| \`${pairId}\` | ${stats.count} | ${stats.medianAbsErrorPct}% | ${stats.meanSignedErrorPct > 0 ? '+' : ''}${stats.meanSignedErrorPct}% | ${stats.medianLatencyMs} ms |\n`;
  }
  md += `\n`;

  return md;
}

export async function runShadowReport(options?: {
  sampleRecords?: ShadowRecord[];
  outFile?: string;
}): Promise<string> {
  const shadowDir = join(process.cwd(), 'tools', 'routing', 'out', 'shadow');
  let records = options?.sampleRecords || loadLocalRecords(shadowDir);

  if (records.length === 0) {
    console.log('[SHADOW_REPORT] No local records found; generating initial report template.');
  }

  const md = generateReportMarkdown(records);
  const outPath = options?.outFile || join(process.cwd(), 'tools', 'routing', 'out', 'shadow-report.md');
  mkdirSync(join(process.cwd(), 'tools', 'routing', 'out'), { recursive: true });
  writeFileSync(outPath, md, 'utf8');
  console.log(`[SHADOW_REPORT] Written report to ${outPath}`);
  return md;
}

if (
  process.argv[1]?.includes('shadow-report') ||
  process.argv.includes('--report')
) {
  runShadowReport().catch((err) => {
    console.error('[SHADOW_REPORT] Fatal error:', err);
    process.exit(1);
  });
}
