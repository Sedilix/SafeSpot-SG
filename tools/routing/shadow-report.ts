/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * shadow-report.ts: Summarises shadow-probe records into tools/routing/out/shadow-report.md:
 * engine ETA, distance and latency (median, p95) overall, by time of day and by pair.
 *
 * Engine only. Rows written before 2026-10-24 also carry Google Routes fields
 * (googleSec, googleMeters, diffPct); this report never reads them, because the
 * Google Maps Platform terms bar caching route durations and using them to tune a
 * substitute. Accuracy is measured against LTA speed bands and our own measured
 * trips instead (docs/clean-room-calibration.md).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ShadowRecord } from './shadow-probe';

export interface GroupStats {
  count: number;
  failures: number;
  medianLocalSec: number;
  minLocalSec: number;
  maxLocalSec: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  medianLocalMeters?: number;
}

/**
 * Rows where the engine produced an ETA. Legacy rows can carry an `error` from
 * the Google query; that says nothing about the engine, so only localSec counts.
 * Test-only simulated rows are skipped entirely.
 */
export function isUsable(r: ShadowRecord): boolean {
  return typeof r.localSec === 'number' && r.localSec > 0;
}

const isReal = (r: ShadowRecord) => !(r as { simulated?: boolean }).simulated;

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)];

export function computeStats(input: ShadowRecord[]): GroupStats {
  const all = input.filter(isReal);
  const records = all.filter(isUsable);
  const failures = all.length - records.length;
  if (records.length === 0) {
    return { count: 0, failures, medianLocalSec: 0, minLocalSec: 0, maxLocalSec: 0, medianLatencyMs: 0, p95LatencyMs: 0 };
  }
  const secs = records.map((r) => r.localSec).sort((a, b) => a - b);
  const latencies = records.map((r) => r.localMs).sort((a, b) => a - b);
  const meters = records
    .filter((r) => typeof r.localMeters === 'number' && (r.localMeters as number) > 0)
    .map((r) => r.localMeters as number)
    .sort((a, b) => a - b);
  return {
    count: records.length,
    failures,
    medianLocalSec: median(secs),
    minLocalSec: secs[0],
    maxLocalSec: secs[secs.length - 1],
    medianLatencyMs: Math.round(median(latencies)),
    p95LatencyMs: Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]),
    medianLocalMeters: meters.length > 0 ? median(meters) : undefined,
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
  const targetLatency = 200;
  const min = (sec: number) => (sec / 60).toFixed(1);

  let md = `# SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report

`;
  md += `**Generated**: ${new Date().toISOString()}  
`;
  md += `**Rows with an engine ETA**: ${overall.count} of ${records.filter(isReal).length}  
`;
  md += `**Basis**: engine only. Accuracy is not measured here; see docs/clean-room-calibration.md.  

`;

  md += `## Acceptance Criteria Summary

`;
  md += `| Metric | Target | Status | Measured Value |
`;
  md += `|---|---|---|---|
`;
  const latPass = overall.count > 0 && overall.medianLatencyMs < targetLatency;
  md += `| **Median Engine Latency** | $< 200$ ms | **${latPass ? 'PASS' : 'FAIL'}** | ${overall.medianLatencyMs} ms (p95: ${overall.p95LatencyMs} ms) |
`;
  md += `| **Rows Without a Route** | 0 | **${overall.failures === 0 ? 'PASS' : 'FAIL'}** | ${overall.failures} |

`;

  md += `## Time-of-Day Breakdown

`;
  md += `| Time Slot (SGT) | Rows | Median ETA | Median Latency | p95 Latency |
`;
  md += `|---|---|---|---|---|
`;
  const timeGroups = new Map<string, ShadowRecord[]>();
  for (const r of records) {
    const slot = resolveTimeOfDay(r.at);
    timeGroups.set(slot, [...(timeGroups.get(slot) ?? []), r]);
  }
  for (const slot of ['Morning Peak (07:00-09:30)', 'Midday (11:30-14:00)', 'Evening Peak (17:00-20:00)', 'Night / Off-Peak']) {
    const stats = computeStats(timeGroups.get(slot) || []);
    md += `| **${slot}** | ${stats.count} | ${min(stats.medianLocalSec)} min | ${stats.medianLatencyMs} ms | ${stats.p95LatencyMs} ms |
`;
  }
  md += `
`;

  md += `## Corridor Breakdown (10 Fixed Corridors)

`;
  md += `| Corridor ID | Rows | Median ETA | ETA Range | Median Distance | Median Latency |
`;
  md += `|---|---|---|---|---|---|
`;
  const pairGroups = new Map<string, ShadowRecord[]>();
  for (const r of records) pairGroups.set(r.pairId, [...(pairGroups.get(r.pairId) ?? []), r]);
  for (const [pairId, list] of pairGroups.entries()) {
    const stats = computeStats(list);
    const dist = stats.medianLocalMeters ? `${(stats.medianLocalMeters / 1000).toFixed(2)} km` : 'N/A';
    md += `| \`${pairId}\` | ${stats.count} | ${min(stats.medianLocalSec)} min | ${min(stats.minLocalSec)}–${min(stats.maxLocalSec)} min | ${dist} | ${stats.medianLatencyMs} ms |
`;
  }
  md += `
`;
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
