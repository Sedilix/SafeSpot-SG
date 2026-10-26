/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * fit-caps-and-signals.ts: Jointly fits free-flow speed caps and traffic-signal wait
 * on empirical LTA speed-band data via robust least squares (Huber loss).
 *
 * Resolves the double-counting identified in PR #46 and ROUTING_PLAN.md §10 / docs/clean-room-calibration.md §3.4:
 *   trip time ≈ Σ edge length / (cap[class] × factor) + n_signals × w_signal
 */

import { existsSync, createReadStream, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { createGunzip } from 'zlib';
import { join } from 'path';
import { RoadGraph } from '../../src/routing/graph';
import { BAND_SPEEDS_ARTERIAL } from './fit-profiles';

const MAP_FILE = join(process.cwd(), 'tools', 'speedbands', 'data', 'link-to-edge-map.json');
const TRAINING_DATA_FILE = join(process.cwd(), 'tools', 'speedbands', 'data', 'speedbands-2026-10-13.jsonl.gz');
const OUTPUT_CAPS_FILE = join(process.cwd(), 'tools', 'speedbands', 'data', 'fitted-caps-signals.json');

export interface FittedParams {
  caps: Record<string, number>;
  signalWaitSec: number;
  sampleCount: number;
  objectiveMaeSec: number;
}

export async function fitCapsAndSignals(maxSamples = 200000): Promise<FittedParams> {
  if (!existsSync(MAP_FILE)) {
    throw new Error(`Link-to-edge map missing: ${MAP_FILE}. Run map-links-to-graph.ts first.`);
  }
  const linkMap: Record<string, any> = JSON.parse(readFileSync(MAP_FILE, 'utf8'));

  console.log('Loading default road graph...');
  const graph = RoadGraph.loadDefault();

  const CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified'];
  const samples: Array<{ classIdx: number; lengthM: number; hasSignal: number; observedSec: number }> = [];

  console.log(`Sampling observations from ${TRAINING_DATA_FILE}...`);
  const stream = createReadStream(TRAINING_DATA_FILE).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

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

    const m = linkMap[rec.linkId];
    if (!m) continue;

    const classIdx = CLASSES.indexOf(m.edgeHighway);
    if (classIdx === -1) continue;

    const e = graph.edges[m.edgeId];
    if (!e || e.length < 5.0) continue;

    const speedKmh = BAND_SPEEDS_ARTERIAL[band];
    const observedSec = e.length / (speedKmh / 3.6);
    const hasSignal = graph.hasTrafficSignal[e.to] ? 1 : 0;

    samples.push({ classIdx, lengthM: e.length, hasSignal, observedSec });
    if (samples.length >= maxSamples) break;
  }

  console.log(`Collected ${samples.length} link observations across ${CLASSES.length} surface highway classes.`);

  // Model: T = L * beta[class] + S * w_signal
  // Let K = CLASSES.length (6 classes), parameters = [beta_0..beta_5, w_signal] (length K + 1)
  const K = CLASSES.length;
  const numParams = K + 1;

  // Initial values: beta based on nominal ~35 km/h (beta = 3.6 / 35 = 0.103), w = 5.0 s
  let params = new Float64Array(numParams);
  for (let i = 0; i < K; i++) params[i] = 3.6 / 35.0;
  params[K] = 5.0; // Initial signal wait

  const HUBER_DELTA = 3.0; // seconds threshold for robust Huber weighting
  const MAX_ITERS = 15;

  console.log('Starting Huber robust least squares regression (IRLS)...');

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    // Normal equations: (X^T W X) theta = X^T W y
    // Matrix size (K+1) x (K+1)
    const A = Array.from({ length: numParams }, () => new Float64Array(numParams));
    const b = new Float64Array(numParams);

    for (const s of samples) {
      const predT = s.lengthM * params[s.classIdx] + s.hasSignal * params[K];
      const residual = s.observedSec - predT;
      const absRes = Math.abs(residual);
      const weight = absRes <= HUBER_DELTA ? 1.0 : HUBER_DELTA / absRes;

      const L = s.lengthM;
      const S = s.hasSignal;
      const T = s.observedSec;
      const c = s.classIdx;

      A[c][c] += weight * L * L;
      A[c][K] += weight * L * S;
      A[K][c] += weight * S * L;
      A[K][K] += weight * S * S;

      b[c] += weight * L * T;
      b[K] += weight * S * T;
    }

    // Solve for each beta_c analytically given w: beta_c = (b[c] - A[c][K] * w) / A[c][c]
    // Then substitute into equation for w:
    // A[K][K] * w + sum_c (A[K][c] * beta_c) = b[K]
    // A[K][K] * w + sum_c (A[K][c] * (b[c] - A[c][K] * w) / A[c][c]) = b[K]
    let coeffW = A[K][K];
    let rhsW = b[K];

    for (let c = 0; c < K; c++) {
      if (A[c][c] > 0) {
        coeffW -= (A[K][c] * A[c][K]) / A[c][c];
        rhsW -= (A[K][c] * b[c]) / A[c][c];
      }
    }

    const nextW = Math.max(0.0, rhsW / coeffW);
    params[K] = nextW;

    for (let c = 0; c < K; c++) {
      if (A[c][c] > 0) {
        params[c] = (b[c] - A[c][K] * nextW) / A[c][c];
      }
    }
  }

  // Calculate MAE of fitted model
  let totalAbsErrSec = 0;
  for (const s of samples) {
    const predT = s.lengthM * params[s.classIdx] + s.hasSignal * params[K];
    totalAbsErrSec += Math.abs(s.observedSec - predT);
  }
  const maeSec = totalAbsErrSec / samples.length;

  const fittedCaps: Record<string, number> = {};
  for (let c = 0; c < K; c++) {
    fittedCaps[CLASSES[c]] = Number((3.6 / params[c]).toFixed(1));
  }

  const result: FittedParams = {
    caps: fittedCaps,
    signalWaitSec: Number(params[K].toFixed(2)),
    sampleCount: samples.length,
    objectiveMaeSec: Number(maeSec.toFixed(2)),
  };

  console.log('\n=== JOINT FIT OUTCOMES (HUBER ROBUST REGRESSION) ===');
  console.log(`Evaluated Samples: ${result.sampleCount}`);
  console.log(`Fitted Signal Delay (w_signal): ${result.signalWaitSec} seconds`);
  console.log('Fitted Free-Flow Progression Speed Caps:');
  for (const [cls, speed] of Object.entries(result.caps)) {
    console.log(`  - ${cls.padEnd(14)}: ${speed} km/h`);
  }
  console.log(`Residual MAE: ${result.objectiveMaeSec} seconds per link traversal`);

  writeFileSync(OUTPUT_CAPS_FILE, JSON.stringify(result, null, 2), 'utf8');
  console.log(`Saved fitted parameters to: ${OUTPUT_CAPS_FILE}`);
  return result;
}

const isMain = process.argv[1] && (process.argv[1].endsWith('fit-caps-and-signals.ts') || process.argv[1].endsWith('fit-caps-and-signals.js'));
if (isMain) {
  fitCapsAndSignals().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
