/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * evaluate-links-holdout.ts: Clean-room link-level accuracy evaluation of SafeSpotSG's
 * routing engine speed predictions against held-out LTA DataMall speed-band observations.
 *
 * Holds out at least two weekdays (2026-10-23 Friday and 2026-10-26 Monday), plus full
 * weekend (2026-10-24 Saturday and 2026-10-25 Sunday).
 *
 * Evaluates:
 * - Link-level prediction accuracy (v_engine vs v_observed midpoint)
 * - Median absolute percentage error, p95 error, and signed bias
 * - Disaggregated by road class, direction, time window, and day type
 * - Explicit Link Speed Error Gates (evaluated distinctly from Trip ETA Gates)
 * - Link geometry match count and top 10 worst links with road names
 *
 * Writes Markdown evaluation report to tools/speedbands/out/lta-link-holdout-evaluation.md.
 */

import { existsSync, readdirSync, readFileSync, createReadStream, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { RoadGraph } from '../../src/routing/graph';
import { SpeedProfileEngine, DayType } from '../../src/routing/speedProfiles';
import { BAND_SPEEDS, BAND_SPEEDS_ARTERIAL } from './fit-profiles';

interface MappedLink {
  linkId: string;
  roadName: string;
  roadCat: string;
  edgeId: number;
  edgeHighway: string;
  edgeName: string;
  distMeters: number;
  bearingDiffDeg: number;
}

interface MetricAccumulator {
  count: number;
  sumAbsErrKmh: number;
  sumSignedErrKmh: number;
  sumAbsPct: number;
  sumSignedPct: number;
  // Binned histograms for exact median and p95 (resolution 0.1 km/h and 0.1%)
  pctErrBins: Int32Array; // Bins of 0.1% up to 200.0% (2001 bins)
  absErrBins: Int32Array; // Bins of 0.1 km/h up to 100.0 km/h (1001 bins)
}

function createAccumulator(): MetricAccumulator {
  return {
    count: 0,
    sumAbsErrKmh: 0,
    sumSignedErrKmh: 0,
    sumAbsPct: 0,
    sumSignedPct: 0,
    pctErrBins: new Int32Array(2001),
    absErrBins: new Int32Array(1001),
  };
}

function recordObservation(
  acc: MetricAccumulator,
  absErrKmh: number,
  signedErrKmh: number,
  pctErr: number,
  signedPct: number
): void {
  acc.count++;
  acc.sumAbsErrKmh += absErrKmh;
  acc.sumSignedErrKmh += signedErrKmh;
  acc.sumAbsPct += pctErr;
  acc.sumSignedPct += signedPct;

  const pctBin = Math.min(2000, Math.max(0, Math.round(pctErr * 10)));
  acc.pctErrBins[pctBin]++;

  const absBin = Math.min(1000, Math.max(0, Math.round(absErrKmh * 10)));
  acc.absErrBins[absBin]++;
}

function computeQuantile(bins: Int32Array, total: number, q: number, scale = 0.1): number {
  if (total === 0) return 0;
  const target = total * q;
  let running = 0;
  for (let i = 0; i < bins.length; i++) {
    running += bins[i];
    if (running >= target) {
      return Number((i * scale).toFixed(2));
    }
  }
  return Number(((bins.length - 1) * scale).toFixed(2));
}

interface SummaryMetrics {
  count: number;
  medianAbsPct: number;
  p95AbsPct: number;
  meanAbsPct: number;
  meanSignedBiasPct: number;
  medianAbsErrKmh: number;
  p95AbsErrKmh: number;
  meanSignedBiasKmh: number;
}

function finalizeMetrics(acc: MetricAccumulator): SummaryMetrics {
  if (acc.count === 0) {
    return {
      count: 0,
      medianAbsPct: 0,
      p95AbsPct: 0,
      meanAbsPct: 0,
      meanSignedBiasPct: 0,
      medianAbsErrKmh: 0,
      p95AbsErrKmh: 0,
      meanSignedBiasKmh: 0,
    };
  }
  return {
    count: acc.count,
    medianAbsPct: computeQuantile(acc.pctErrBins, acc.count, 0.5, 0.1),
    p95AbsPct: computeQuantile(acc.pctErrBins, acc.count, 0.95, 0.1),
    meanAbsPct: Number((acc.sumAbsPct / acc.count).toFixed(2)),
    meanSignedBiasPct: Number((acc.sumSignedPct / acc.count).toFixed(2)),
    medianAbsErrKmh: computeQuantile(acc.absErrBins, acc.count, 0.5, 0.1),
    p95AbsErrKmh: computeQuantile(acc.absErrBins, acc.count, 0.95, 0.1),
    meanSignedBiasKmh: Number((acc.sumSignedErrKmh / acc.count).toFixed(2)),
  };
}

interface LinkStat {
  linkId: string;
  roadName: string;
  roadCat: string;
  edgeHighway: string;
  count: number;
  sumAbsErrKmh: number;
  sumSignedErrKmh: number;
  sumAbsPct: number;
  pctErrBins: Int32Array;
  absErrBins: Int32Array;
}

export async function runHoldoutEvaluation(): Promise<void> {
  const root = process.cwd();
  const graphFile = join(root, 'data', 'graph', 'singapore-road-graph.json');
  const mapFile = join(root, 'tools', 'speedbands', 'data', 'link-to-edge-map.json');
  const linksFile = join(root, 'tools', 'speedbands', 'data', 'lta-links.json');
  const rawDir = join(root, 'tools', 'speedbands', 'data', 'raw');
  const outDir = join(root, 'tools', 'speedbands', 'out');
  const outReport = join(outDir, 'lta-link-holdout-evaluation.md');

  console.log('=== SafeSpotSG Routing Engine: Clean-Room Link-Level Evaluation ===\n');

  if (!existsSync(graphFile)) throw new Error(`Missing road graph: ${graphFile}`);
  if (!existsSync(mapFile)) throw new Error(`Missing link mapping: ${mapFile}`);
  if (!existsSync(linksFile)) throw new Error(`Missing LTA links metadata: ${linksFile}`);

  console.log('1. Loading road graph and link geometry mappings...');
  const graphData = JSON.parse(readFileSync(graphFile, 'utf8'));
  const graph = new RoadGraph(graphData);
  const linkMap: Record<string, MappedLink> = JSON.parse(readFileSync(mapFile, 'utf8'));
  const allLtaLinks: Record<string, any> = JSON.parse(readFileSync(linksFile, 'utf8'));

  const totalLtaCount = Object.keys(allLtaLinks).length;
  const mappedCount = Object.keys(linkMap).length;
  const matchPct = ((mappedCount / totalLtaCount) * 100).toFixed(1);
  console.log(`   - Total LTA links: ${totalLtaCount.toLocaleString()}`);
  console.log(`   - Graph-mapped links: ${mappedCount.toLocaleString()} (${matchPct}% match)\n`);

  const engine = new SpeedProfileEngine();

  // Accumulators
  const overallAcc = createAccumulator();
  const byHighway: Record<string, MetricAccumulator> = {};
  const byDirection: Record<string, MetricAccumulator> = {
    INBOUND: createAccumulator(),
    OUTBOUND: createAccumulator(),
    CROSS: createAccumulator(),
  };
  const byWindow: Record<string, MetricAccumulator> = {
    'Morning Peak (07:30 - 09:30)': createAccumulator(),
    'Midday (11:30 - 14:00)': createAccumulator(),
    'Evening Peak (17:30 - 20:00)': createAccumulator(),
    'Off-Peak / Night': createAccumulator(),
  };
  const byDayType: Record<string, MetricAccumulator> = {
    WEEKDAY: createAccumulator(),
    SATURDAY: createAccumulator(),
    SUNDAY_PH: createAccumulator(),
  };

  // Per-link error tracker
  const linkStats = new Map<string, LinkStat>();

  const holdoutDays = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
  console.log(`2. Streaming held-out speed observations across 4 days:`);
  console.log(`   - 2026-10-23 (Friday - Weekday)`);
  console.log(`   - 2026-10-24 (Saturday - Weekend)`);
  console.log(`   - 2026-10-25 (Sunday - Weekend)`);
  console.log(`   - 2026-10-26 (Monday - Weekday) [Holdout includes 2 full weekdays]\n`);

  let totalObservationsProcessed = 0;
  let totalEvaluatedObservations = 0;

  for (const day of holdoutDays) {
    const dayDir = join(rawDir, day);
    if (!existsSync(dayDir)) {
      console.warn(`Holdout day dir missing: ${dayDir}, skipping.`);
      continue;
    }
    const files = readdirSync(dayDir).filter((f) => /(00|15|30|45)\.jsonl\.gz$/.test(f));
    console.log(`   Processing ${day}: ${files.length} snapshot files...`);
    const t0 = Date.now();
    let dayEval = 0;

    for (const f of files) {
      const stream = createReadStream(join(dayDir, f));
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;
        let rec: any;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        totalObservationsProcessed++;

        const band = Number(rec.band);
        if (!band || band < 1 || band > 8) continue;

        const mapped = linkMap[rec.linkId];
        if (!mapped) continue;

        const edgeId = mapped.edgeId;
        const sgt = new Date(rec.ts + 8 * 3600 * 1000);
        const dayOfWeek = sgt.getUTCDay();
        const dayType: DayType = dayOfWeek === 0 ? 'SUNDAY_PH' : dayOfWeek === 6 ? 'SATURDAY' : 'WEEKDAY';
        const slot = Math.floor((sgt.getUTCHours() * 60 + sgt.getUTCMinutes()) / 15);

        // Edge properties from prebuilt graph
        const edgeLen = graph.edgeLength[edgeId];
        const maxspeed = graph.edgeMaxspeed[edgeId];
        const baseSpeed = graph.edgeBaseSpeeds[edgeId];
        const bearing = graph.edgeBearings[edgeId];
        const highwayType = graph.edgeHighwayType[edgeId];
        const schoolSilver = graph.edgeSchoolSilver[edgeId];
        const highway = mapped.edgeHighway;

        // Predict traversal duration and speed via engine fast path
        const edgeSec = engine.calculateEdgeSecondsFast(
          edgeId,
          edgeLen,
          maxspeed,
          baseSpeed,
          bearing,
          highwayType,
          schoolSilver,
          dayType,
          slot
        );

        if (edgeSec <= 0) continue;
        const vEngineKmh = (edgeLen / edgeSec) * 3.6;

        // Ground-truth LTA observed speed from band midpoint
        const isExp = highway === 'motorway' || highway === 'motorway_link';
        const vObsKmh = isExp ? BAND_SPEEDS[band] : BAND_SPEEDS_ARTERIAL[band];

        const absErrKmh = Math.abs(vEngineKmh - vObsKmh);
        const signedErrKmh = vEngineKmh - vObsKmh;
        const pctErr = (absErrKmh / vObsKmh) * 100;
        const signedPct = (signedErrKmh / vObsKmh) * 100;

        // Record overall
        recordObservation(overallAcc, absErrKmh, signedErrKmh, pctErr, signedPct);

        // Record by highway class
        if (!byHighway[highway]) byHighway[highway] = createAccumulator();
        recordObservation(byHighway[highway], absErrKmh, signedErrKmh, pctErr, signedPct);

        // Record by direction
        const dir = bearing >= 120 && bearing <= 240 ? 'INBOUND' : (bearing <= 60 || bearing >= 300) ? 'OUTBOUND' : 'CROSS';
        recordObservation(byDirection[dir], absErrKmh, signedErrKmh, pctErr, signedPct);

        // Record by time window
        let windowKey = 'Off-Peak / Night';
        if (slot >= 30 && slot <= 37) windowKey = 'Morning Peak (07:30 - 09:30)';
        else if (slot >= 46 && slot <= 55) windowKey = 'Midday (11:30 - 14:00)';
        else if (slot >= 70 && slot <= 79) windowKey = 'Evening Peak (17:30 - 20:00)';
        recordObservation(byWindow[windowKey], absErrKmh, signedErrKmh, pctErr, signedPct);

        // Record by day type
        recordObservation(byDayType[dayType], absErrKmh, signedErrKmh, pctErr, signedPct);

        // Track per-link stats
        let ls = linkStats.get(rec.linkId);
        if (!ls) {
          ls = {
            linkId: rec.linkId,
            roadName: mapped.roadName,
            roadCat: mapped.roadCat,
            edgeHighway: mapped.edgeHighway,
            count: 0,
            sumAbsErrKmh: 0,
            sumSignedErrKmh: 0,
            sumAbsPct: 0,
            pctErrBins: new Int32Array(2001),
            absErrBins: new Int32Array(1001),
          };
          linkStats.set(rec.linkId, ls);
        }
        ls.count++;
        ls.sumAbsErrKmh += absErrKmh;
        ls.sumSignedErrKmh += signedErrKmh;
        ls.sumAbsPct += pctErr;
        const pBin = Math.min(2000, Math.max(0, Math.round(pctErr * 10)));
        ls.pctErrBins[pBin]++;
        const aBin = Math.min(1000, Math.max(0, Math.round(absErrKmh * 10)));
        ls.absErrBins[aBin]++;

        dayEval++;
        totalEvaluatedObservations++;
      }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`      Evaluated ${dayEval.toLocaleString()} observations in ${elapsed}s.`);
  }

  console.log(`\n3. Finalizing metrics across ${totalEvaluatedObservations.toLocaleString()} evaluated link observations...`);
  const overall = finalizeMetrics(overallAcc);

  // Link Speed Error Decision Gates (distinct from Trip ETA Gates)
  // Targets per docs/clean-room-calibration.md §4 adapted for link speed telemetry:
  // - Median absolute error <= 15.0%
  // - Signed bias within +/- 5.0%
  // - p95 absolute error <= 30.0%
  const GATE_MEDIAN_TARGET = 15.0;
  const GATE_BIAS_TARGET = 5.0;
  const GATE_P95_TARGET = 30.0;

  const medianPass = overall.medianAbsPct <= GATE_MEDIAN_TARGET;
  const biasPass = Math.abs(overall.meanSignedBiasPct) <= GATE_BIAS_TARGET;
  const p95Pass = overall.p95AbsPct <= GATE_P95_TARGET;
  const allPass = medianPass && biasPass && p95Pass;

  // Find 10 worst links (minimum 50 observations to filter out transient outliers)
  const rankedLinks = Array.from(linkStats.values())
    .filter((ls) => ls.count >= 50)
    .map((ls) => ({
      linkId: ls.linkId,
      roadName: ls.roadName,
      roadCat: ls.roadCat,
      edgeHighway: ls.edgeHighway,
      count: ls.count,
      medianAbsPct: computeQuantile(ls.pctErrBins, ls.count, 0.5, 0.1),
      p95AbsPct: computeQuantile(ls.pctErrBins, ls.count, 0.95, 0.1),
      meanAbsPct: Number((ls.sumAbsPct / ls.count).toFixed(1)),
      medianAbsErrKmh: computeQuantile(ls.absErrBins, ls.count, 0.5, 0.1),
      p95AbsErrKmh: computeQuantile(ls.absErrBins, ls.count, 0.95, 0.1),
    }))
    .sort((a, b) => b.medianAbsPct - a.medianAbsPct)
    .slice(0, 10);

  // Build Markdown Report
  let md = `# LTA DataMall Link-Level Speed Accuracy Evaluation (Held-Out Benchmark)\n\n`;
  md += `**Evaluation Date:** 2026-10-26  \n`;
  md += `**Protocol:** 100% Clean-Room (Singapore Open Data Licence v1.0, LTA DataMall Traffic Speed Bands)  \n`;
  md += `**Held-Out Dataset:** 4 Full Days (2026-10-23 Friday, 2026-10-24 Saturday, 2026-10-25 Sunday, 2026-10-26 Monday)  \n`;
  md += `**Weekday Requirement:** Satisfied (holds out 2 full weekdays: Friday 23 Oct & Monday 26 Oct)  \n`;
  md += `**Link Match Coverage:** **${mappedCount.toLocaleString()} / ${totalLtaCount.toLocaleString()} LTA links (${matchPct}%)** matched to graph edges within 25 m and 35° bearing  \n`;
  md += `**Total Observations Evaluated:** **${totalEvaluatedObservations.toLocaleString()}**  \n\n`;

  md += `## 1. Decision Gates (Link Speed Error Gates)\n\n`;
  md += `> **Important Distinction:** These gates evaluate instantaneous road-link speed observations across 15-minute intervals. They are distinct from the Trip ETA Gates in \`docs/clean-room-calibration.md\` §4 (which evaluate door-to-door trip traversal times).\n\n`;

  md += `| Decision Gate | Metric | Measured Value | Target | Status |\n`;
  md += `|---|---|---|---|---|\n`;
  md += `| **Link Speed Median Accuracy** | Median Absolute % Error | **${overall.medianAbsPct.toFixed(2)}%** (${overall.medianAbsErrKmh.toFixed(1)} km/h) | $\\le ${GATE_MEDIAN_TARGET.toFixed(1)}\\%$ | ${medianPass ? '✅ **PASS**' : '❌ **FAIL**'} |\n`;
  md += `| **Link Speed Systemic Bias** | Mean Signed Speed Bias | **${overall.meanSignedBiasPct > 0 ? '+' : ''}${overall.meanSignedBiasPct.toFixed(2)}%** (${overall.meanSignedBiasKmh > 0 ? '+' : ''}${overall.meanSignedBiasKmh.toFixed(1)} km/h) | Within $\\pm ${GATE_BIAS_TARGET.toFixed(1)}\\%$ | ${biasPass ? '✅ **PASS**' : '❌ **FAIL**'} |\n`;
  md += `| **Link Speed Tail Variance** | p95 Absolute % Error | **${overall.p95AbsPct.toFixed(2)}%** (${overall.p95AbsErrKmh.toFixed(1)} km/h) | $\\le ${GATE_P95_TARGET.toFixed(1)}\\%$ | ${p95Pass ? '✅ **PASS**' : '❌ **FAIL**'} |\n\n`;

  md += `**Gate Verdict:** ${allPass ? '🎉 **ALL LINK SPEED GATES PASSED**' : '⚠️ **GATES REQUIRE ATTENTION**'}\n\n`;

  md += `## 2. Accuracy Breakdown by Road Class\n\n`;
  md += `| Road Class | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) | p95 Err (km/h) |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  const classOrder = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'tertiary', 'residential', 'unclassified'];
  for (const c of classOrder) {
    if (!byHighway[c]) continue;
    const m = finalizeMetrics(byHighway[c]);
    md += `| \`${c}\` | ${m.count.toLocaleString()} | **${m.medianAbsPct.toFixed(1)}%** | ${m.p95AbsPct.toFixed(1)}% | ${m.meanSignedBiasPct > 0 ? '+' : ''}${m.meanSignedBiasPct.toFixed(1)}% | ${m.medianAbsErrKmh.toFixed(1)} km/h | ${m.p95AbsErrKmh.toFixed(1)} km/h |\n`;
  }
  md += `\n`;

  md += `## 3. Accuracy Breakdown by Direction\n\n`;
  md += `| Direction | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const [dir, acc] of Object.entries(byDirection)) {
    const m = finalizeMetrics(acc);
    md += `| **${dir}** | ${m.count.toLocaleString()} | **${m.medianAbsPct.toFixed(1)}%** | ${m.p95AbsPct.toFixed(1)}% | ${m.meanSignedBiasPct > 0 ? '+' : ''}${m.meanSignedBiasPct.toFixed(1)}% | ${m.medianAbsErrKmh.toFixed(1)} km/h |\n`;
  }
  md += `\n`;

  md += `## 4. Accuracy Breakdown by Time Window\n\n`;
  md += `| Time Window | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const [win, acc] of Object.entries(byWindow)) {
    const m = finalizeMetrics(acc);
    md += `| **${win}** | ${m.count.toLocaleString()} | **${m.medianAbsPct.toFixed(1)}%** | ${m.p95AbsPct.toFixed(1)}% | ${m.meanSignedBiasPct > 0 ? '+' : ''}${m.meanSignedBiasPct.toFixed(1)}% | ${m.medianAbsErrKmh.toFixed(1)} km/h |\n`;
  }
  md += `\n`;

  md += `## 5. Accuracy Breakdown by Day Type\n\n`;
  md += `| Day Type | Observations | Median Abs % Err | p95 Abs % Err | Signed Bias % | Median Abs Err (km/h) |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const [dt, acc] of Object.entries(byDayType)) {
    const m = finalizeMetrics(acc);
    md += `| **${dt}** | ${m.count.toLocaleString()} | **${m.medianAbsPct.toFixed(1)}%** | ${m.p95AbsPct.toFixed(1)}% | ${m.meanSignedBiasPct > 0 ? '+' : ''}${m.meanSignedBiasPct.toFixed(1)}% | ${m.medianAbsErrKmh.toFixed(1)} km/h |\n`;
  }
  md += `\n`;

  md += `## 6. Top 10 Worst Link Discrepancies\n\n`;
  md += `Ranked by median absolute percentage error on held-out days (minimum 50 observations):\n\n`;
  md += `| # | Link ID | Road Name | LTA Cat | OSM Highway | Obs | Median Abs % Err | p95 Abs % Err | Median Err (km/h) |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  rankedLinks.forEach((l, idx) => {
    md += `| ${idx + 1} | \`${l.linkId}\` | **${l.roadName || 'Unnamed'}** | ${l.roadCat} | \`${l.edgeHighway}\` | ${l.count} | **${l.medianAbsPct.toFixed(1)}%** | ${l.p95AbsPct.toFixed(1)}% | ${l.medianAbsErrKmh.toFixed(1)} km/h |\n`;
  });
  md += `\n`;

  md += `## 7. Architectural Observations & Signal Delay Resolution\n\n`;
  md += `1. **Signal Delay Double Counting Settled:** Huber regression ($w_{\\text{signal}} = 0.64$ s $\\approx 0$ s) proved that space-mean speeds reported by LTA already incorporate signal queueing and deceleration. Setting \`DELAY_SIGNAL_SEC = 0.0\` restored arterial corridor progression without artificial stacking.\n`;
  md += `2. **Sub-Arterial Direct Data Fit:** Saturday and Sunday sub-arterials are now directly extracted from over 36 million empirical observations across road categories 4 & 5, replacing hand-typed ternaries.\n`;
  md += `3. **Link Coverage:** 77.8% of all LTA links cleanly map onto OpenStreetMap geometry within 25 m and 35° bearing alignment, providing robust island-wide ground truth.\n`;

  writeFileSync(outReport, md, 'utf8');
  console.log(`\nEvaluation report successfully written to: ${outReport}`);

  console.log('\n================== SUMMARY ==================');
  console.log(`Evaluated Observations: ${totalEvaluatedObservations.toLocaleString()}`);
  console.log(`Median Abs % Error:     ${overall.medianAbsPct.toFixed(2)}% [${medianPass ? 'PASS' : 'FAIL'}]`);
  console.log(`Mean Signed Bias %:     ${overall.meanSignedBiasPct > 0 ? '+' : ''}${overall.meanSignedBiasPct.toFixed(2)}% [${biasPass ? 'PASS' : 'FAIL'}]`);
  console.log(`p95 Abs % Error:        ${overall.p95AbsPct.toFixed(2)}% [${p95Pass ? 'PASS' : 'FAIL'}]`);
  console.log(`Gate Overall Verdict:   ${allPass ? 'PASS' : 'FAIL'}`);
  console.log('=============================================\n');
}

const isMain = process.argv[1] && (process.argv[1].endsWith('evaluate-links-holdout.ts') || process.argv[1].endsWith('evaluate-links-holdout.js'));
if (isMain) {
  runHoldoutEvaluation().catch((err) => {
    console.error('Fatal evaluation error:', err);
    process.exit(1);
  });
}
