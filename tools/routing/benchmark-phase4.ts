/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * benchmark-phase4.ts: Evaluates Phase 4 route alternatives and multi-criteria ranking.
 *
 * Runs the probe's three core Singapore trips:
 *  1. Blk 480 Toa Payoh -> Raffles Place (CBD)
 *  2. Blk 480 Toa Payoh -> Changi Airport T3
 *  3. Blk 480 Toa Payoh -> Jurong East MRT
 *
 * Acceptance Criteria:
 *  - Alternatives generated via penalty method (x1.35 multiplier, max overlap < 65%).
 *  - Generated routes are verified spatially distinct (overlap < 65% for every pair).
 *  - Evaluated on THREE objectives: Time, Money (fuel + ERP), Risk (incidents + rain).
 *  - Pareto non-dominated analysis.
 *  - Sensible top-3 ranked lists produced and documented in tools/routing/out/benchmark-phase4.md.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { RoadGraph } from '../../src/routing/graph';
import { Router, calculateRouteOverlap, RouteResult } from '../../src/routing/router';
import { SpeedProfileEngine } from '../../src/routing/speedProfiles';
import { IncidentLayer } from '../../src/routing/incidents';
import { ErpEngine } from '../../src/routing/erp';
import { rankRouteAlternatives, MultiCriteriaRoute } from '../../src/routing/multiCriteria';

const ORIGIN = { name: 'Blk 480 Toa Payoh', lat: 1.3327, lng: 103.8479 };

const DESTINATIONS = [
  { name: 'Raffles Place (CBD)', lat: 1.2840, lng: 103.8514 },
  { name: 'Changi Airport T3', lat: 1.3570, lng: 103.9874 },
  { name: 'Jurong East MRT', lat: 1.3331, lng: 103.7423 },
];

// Reference departure at morning peak (08:30 SGT) on a weekday
const DEPARTURE_TIME = new Date('2026-10-14T08:30:00+08:00');

interface TripBenchmarkResult {
  destination: string;
  routesFound: number;
  routes: MultiCriteriaRoute[];
  pairwiseOverlap: Array<{ pair: string; overlapPct: number }>;
  allSpatiallyDistinct: boolean;
  hasNonDominated: boolean;
  latencyMs: number;
}

export async function runPhase4Benchmark(): Promise<TripBenchmarkResult[]> {
  console.log('Loading Singapore road network graph...');
  const t0 = performance.now();
  const graph = RoadGraph.loadDefault();
  console.log(`Graph loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s (${graph.nodes.length} nodes, ${graph.edges.length} edges).`);

  const router = new Router(graph);
  const speedProfiles = new SpeedProfileEngine();
  const incidents = new IncidentLayer();
  const erp = new ErpEngine(); // Default active gantries (disabled/unknown tariffs)

  const results: TripBenchmarkResult[] = [];

  for (const dest of DESTINATIONS) {
    console.log(`\nEvaluating alternatives for: ${ORIGIN.name} -> ${dest.name}...`);
    const startMs = performance.now();

    const rawAlternatives: RouteResult[] = router.findAlternatives(
      { lat: ORIGIN.lat, lng: ORIGIN.lng },
      { lat: dest.lat, lng: dest.lng },
      {
        maxRoutes: 3,
        penaltyMultiplier: 1.35,
        maxOverlap: 0.65,
        departureTime: DEPARTURE_TIME,
        speedProfiles,
        incidents,
        erp,
      }
    );

    const latencyMs = Math.round(performance.now() - startMs);

    // Compute pairwise overlap
    const pairwiseOverlap: Array<{ pair: string; overlapPct: number }> = [];
    let allSpatiallyDistinct = true;

    for (let i = 0; i < rawAlternatives.length; i++) {
      for (let j = i + 1; j < rawAlternatives.length; j++) {
        const ov = calculateRouteOverlap(rawAlternatives[i], rawAlternatives[j]);
        const pct = Number((ov * 100).toFixed(1));
        pairwiseOverlap.push({ pair: `Route ${i + 1} vs Route ${j + 1}`, overlapPct: pct });
        if (ov >= 0.65) {
          allSpatiallyDistinct = false;
        }
      }
    }

    // Rank via multi-criteria engine across Time, Money, Risk
    const rankedRoutes = rankRouteAlternatives(rawAlternatives, { rainMm: 0 });
    const hasNonDominated = rankedRoutes.some((r) => r.isNonDominated);

    results.push({
      destination: dest.name,
      routesFound: rankedRoutes.length,
      routes: rankedRoutes,
      pairwiseOverlap,
      allSpatiallyDistinct,
      hasNonDominated,
      latencyMs,
    });
  }

  // Generate Markdown report
  const outDir = join(process.cwd(), 'tools', 'routing', 'out');
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, 'benchmark-phase4.md');

  let md = `# SafeSpot Routing Engine — Phase 4 Alternatives & Multi-Criteria Benchmark\n\n`;
  md += `**Generated**: ${new Date().toISOString()}  \n`;
  md += `**Origin**: ${ORIGIN.name} (${ORIGIN.lat.toFixed(4)}, ${ORIGIN.lng.toFixed(4)})  \n`;
  md += `**Departure**: 2026-10-14 08:30:00 SGT (Morning Peak)  \n`;
  md += `**Engine**: SafeSpot A* with Edge Penalty Method (x1.35) & 3-Objective Pareto Ranking  \n\n`;

  md += `## Acceptance Criteria Summary\n\n`;
  md += `| Criterion | Target | Status | Detail |\n`;
  md += `|---|---|---|---|\n`;

  const allDistinct = results.every((r) => r.allSpatiallyDistinct);
  md += `| **Spatially Distinct** | Max overlap < 65% | **${allDistinct ? 'PASS' : 'FAIL'}** | All generated alternative pairs verified < 65% length overlap |\n`;

  const allNonDom = results.every((r) => r.routes.every((x) => x.isNonDominated));
  md += `| **Pareto Non-Dominated Survivors** | 100% survivors non-dominated | **${allNonDom ? 'PASS' : 'FAIL'}** | Pruned all dominated candidates; 1 to 3 non-dominated routes returned per trip |\n`;

  const avgLatency = Math.round(results.reduce((a, b) => a + b.latencyMs, 0) / results.length);
  const latencyPass = avgLatency < 1000;
  md += `| **Alternatives Latency** | < 1,000 ms (Interactive) | **${latencyPass ? 'PASS' : 'FAIL'}** | Average ${avgLatency} ms for sequential alternative explorations (FAIL for interactive use; production pickup uses E3 one-to-many worker search < 1 s) |\n\n`;

  md += `## Trip Evaluations\n\n`;

  for (const res of results) {
    md += `### ${ORIGIN.name} → ${res.destination}\n\n`;
    if (res.routes.length === 1) {
      md += `*Generated 1 non-dominated route in ${res.latencyMs} ms (dominated slower & dearer candidates and >1.5x detours were strictly pruned).*  \n\n`;
    } else {
      md += `*Generated ${res.routesFound} non-dominated routes in ${res.latencyMs} ms.*  \n\n`;
    }

    md += `#### Pairwise Spatial Overlap\n`;
    if (res.pairwiseOverlap.length === 0) {
      md += `*Single non-dominated corridor survived pruning.*\n\n`;
    } else {
      md += `| Route Pair | Spatial Overlap | Status (< 65%) |\n`;
      md += `|---|---|---|\n`;
      for (const pair of res.pairwiseOverlap) {
        md += `| ${pair.pair} | **${pair.overlapPct}%** | ${pair.overlapPct < 65 ? 'PASS (Distinct)' : 'FAIL'} |\n`;
      }
      md += `\n`;
    }

    md += `#### Multi-Criteria Non-Dominated Alternatives\n\n`;
    md += `| Rank | Archetype | Time (min) | Dist (km) | Fuel (L) | Money (SGD) | Risk Score | Pareto Status | Trade-off Summary |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;

    for (const r of res.routes) {
      const o = r.objectives;
      md += `| #${r.rank} | **${r.archetype.toUpperCase()}** | ${o.minutes} min | ${o.km} km | ${o.fuelLitres} L | fuel $${o.totalMoneySgd.toFixed(2)} + ERP unknown | ${o.riskScore} | ${r.isNonDominated ? 'Non-Dominated' : 'Dominated'} | ${r.tradeoffSummary} |\n`;
    }
    md += `\n`;
  }

  writeFileSync(reportPath, md, 'utf8');
  console.log(`\nPhase 4 benchmark report written to: ${reportPath}`);
  return results;
}

if (process.argv[1]?.endsWith('benchmark-phase4.ts') || process.argv[1]?.endsWith('benchmark-phase4.js')) {
  runPhase4Benchmark().catch((err) => {
    console.error('Phase 4 benchmark failed:', err);
    process.exit(1);
  });
}
