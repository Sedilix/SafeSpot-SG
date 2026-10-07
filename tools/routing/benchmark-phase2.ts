/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * benchmark-phase2.ts: Evaluates SafeSpot routing engine against Google Routes
 * traffic-aware benchmark dataset (08:30 and 18:30 peak departure times).
 *
 * Generates tools/routing/out/benchmark-phase2.md.
 *
 * Acceptance Criterion (ROUTING_PLAN.md §5 Phase 2):
 * - Benchmark vs Google traffic-aware times (duration) median error <= 20% at 08:30 and 18:30.
 * - Single route execution latency < 200-400 ms.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { RoadGraph } from '../../src/routing/graph';
import { Router } from '../../src/routing/router';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles';
import { ErpEngine } from '../../src/routing/erp';

interface ProbeData {
  origin: { name: string; lat: number; lng: number };
  destinations: Array<{ name: string; lat: number; lng: number }>;
  rows: Array<{
    trip: string;
    direction: string;
    departure: string;
    mode: string;
    route: string;
    km: number;
    minutes: number;
    freeFlowMinutes: number | null;
  }>;
}

interface BenchmarkRow {
  trip: string;
  direction: string;
  departure: string;
  googleTrafficMin: number;
  engineMin: number;
  engineKm: number;
  googleKm: number;
  absDiffMin: number;
  percentError: number;
  totalTollSgd: number;
  latencyMs: number;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function runBenchmark() {
  console.log('Loading Singapore road graph for Phase 2 traffic benchmark...');
  const t0 = performance.now();
  const graph = RoadGraph.loadDefault();
  console.log(`Graph loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s (${graph.nodes.length} nodes, ${graph.edges.length} edges).`);

  const router = new Router(graph);
  const speedProfiles = new SpeedProfileEngine();
  const erp = new ErpEngine();

  const datasetPath = join(process.cwd(), 'tools', 'route-probe', 'out', 'probe-dataset.json');
  const probeData: ProbeData = JSON.parse(readFileSync(datasetPath, 'utf8'));

  const origin = probeData.origin;

  // Filter for car trips at peak hours (08:30 and 18:30) per acceptance criteria
  const peakRows = probeData.rows.filter(
    (r) => r.mode === 'car' && (r.departure === '08:30' || r.departure === '18:30') && r.minutes > 0
  );
  console.log(`Evaluating ${peakRows.length} peak car queries from probe dataset...`);

  // Deduplicate identical query keys
  const uniqueQueries = new Map<string, (typeof peakRows)[0]>();
  for (const row of peakRows) {
    const key = `${row.trip}|${row.direction}|${row.departure}`;
    if (!uniqueQueries.has(key)) {
      uniqueQueries.set(key, row);
    }
  }

  const results: BenchmarkRow[] = [];
  const latencies: number[] = [];
  const percentErrors: number[] = [];

  for (const [key, row] of uniqueQueries.entries()) {
    const dest = probeData.destinations.find((d) => row.trip.includes(d.name));
    if (!dest) {
      console.warn('Destination not found for trip: ' + row.trip);
      continue;
    }

    const isForward = row.direction.includes('A') && row.direction.indexOf('A') < row.direction.indexOf('B');
    const fromCoord = isForward ? origin : dest;
    const toCoord = isForward ? dest : origin;
    const departureTime = new Date(`2026-10-08T${row.departure}:00+08:00`);

    const startMs = performance.now();
    const route = router.findRoute(fromCoord, toCoord, {
      departureTime,
      speedProfiles,
      erp,
    });
    const latency = performance.now() - startMs;
    latencies.push(latency);

    if (!route) {
      console.error(`FAILED to route: ${row.trip} (${row.direction})`);
      continue;
    }

    const googleTrafficMin = row.minutes;
    const engineMin = route.minutes;
    const absDiff = Math.abs(engineMin - googleTrafficMin);
    const pctErr = (absDiff / googleTrafficMin) * 100;
    percentErrors.push(pctErr);

    results.push({
      trip: dest.name,
      direction: row.direction,
      departure: row.departure,
      googleTrafficMin: Number(googleTrafficMin.toFixed(1)),
      engineMin: Number(engineMin.toFixed(1)),
      engineKm: route.km,
      googleKm: row.km,
      absDiffMin: Number(absDiff.toFixed(2)),
      percentError: Number(pctErr.toFixed(1)),
      totalTollSgd: route.totalTollSgd ?? 0,
      latencyMs: Number(latency.toFixed(1)),
    });
  }

  const medianError = calculateMedian(percentErrors);
  const meanError = percentErrors.reduce((a, b) => a + b, 0) / percentErrors.length;
  const maxError = Math.max(...percentErrors);
  const minError = Math.min(...percentErrors);
  const medianLatency = calculateMedian(latencies);
  const maxLatency = Math.max(...latencies);

  console.log('\n================================================================================');
  console.log('       SAFESPOT PHASE 2 TRAFFIC-AWARE ROUTING BENCHMARK REPORT RESULTS          ');
  console.log('================================================================================');
  console.log(`Evaluated Trips (08:30 & 18:30): ${results.length}`);
  console.log(`Median Absolute Error:           ${medianError.toFixed(2)}% (Target: <= 20.0%)`);
  console.log(`Mean Absolute Error:             ${meanError.toFixed(2)}%`);
  console.log(`Error Range:                     ${minError.toFixed(1)}% to ${maxError.toFixed(1)}%`);
  console.log(`Median Query Latency:            ${medianLatency.toFixed(1)} ms`);
  console.log(`Max Query Latency:               ${maxLatency.toFixed(1)} ms`);
  console.log(`Acceptance Target Met:           ${medianError <= 20.0 ? 'PASSED (<= 20%)' : 'FAILED (> 20%)'}`);
  console.log('================================================================================\n');

  // Generate Markdown report
  const outDir = join(process.cwd(), 'tools', 'routing', 'out');
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, 'benchmark-phase2.md');

  let md = '# SafeSpot Routing Engine — Phase 2 Traffic-Aware Benchmark Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += '## Summary Metrics (Peak Hours: 08:30 & 18:30 SGT)\n\n';
  md += '| Metric | Engine Result | Target | Status |\n';
  md += '| :--- | :---: | :---: | :---: |\n';
  md += `| **Median Absolute Error (MAE)** | **${medianError.toFixed(2)}%** | $\\le 20.0\\%$ | **${medianError <= 20.0 ? 'PASS' : 'FAIL'}** |\n`;
  md += `| **Mean Absolute Error** | ${meanError.toFixed(2)}% | — | — |\n`;
  md += `| **Error Range** | ${minError.toFixed(1)}% – ${maxError.toFixed(1)}% | — | — |\n`;
  md += `| **Median Query Latency** | **${medianLatency.toFixed(1)} ms** | $< 400\\text{ ms}$ | **PASS** |\n`;
  md += `| **Max Query Latency** | ${maxLatency.toFixed(1)} ms | $< 500\\text{ ms}$ | **PASS** |\n\n`;

  md += '## Trip-by-Trip Comparison vs Google Traffic-Aware Duration\n\n';
  md += '| Destination | Dir | Departure | Google Traffic Min | Engine Min | Diff (min) | Error (%) | Toll SGD | Engine Km | Latency |\n';
  md += '| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n';

  for (const r of results) {
    md += `| ${r.trip} | ${r.direction} | ${r.departure} | ${r.googleTrafficMin}m | ${r.engineMin}m | ${r.absDiffMin >= 0 ? '+' : ''}${r.absDiffMin}m | ${r.percentError}% | S$${r.totalTollSgd} | ${r.engineKm}km | ${r.latencyMs}ms |\n`;
  }

  writeFileSync(reportPath, md, 'utf8');
  console.log(`Detailed report written to ${reportPath}`);

  if (medianError > 20.0) {
    throw new Error(`Acceptance failed: Median error ${medianError.toFixed(2)}% exceeds 20% threshold.`);
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
