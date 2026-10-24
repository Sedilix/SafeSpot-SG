/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { SHADOW_PAIRS, ShadowRecord, runShadowProbe } from './shadow-probe';
import { computeStats, resolveTimeOfDay, generateReportMarkdown, isUsable } from './shadow-report';

describe('shadow-probe: Fixed Corridor Configuration', () => {
  it('defines exactly 10 valid Singapore O-D pairs', () => {
    expect(SHADOW_PAIRS.length).toBe(10);
    for (const p of SHADOW_PAIRS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      // Singapore latitude: ~1.2 to 1.48, longitude: ~103.6 to 104.05
      expect(p.origin.lat).toBeGreaterThan(1.2);
      expect(p.origin.lat).toBeLessThan(1.5);
      expect(p.origin.lng).toBeGreaterThan(103.6);
      expect(p.origin.lng).toBeLessThan(104.1);

      expect(p.dest.lat).toBeGreaterThan(1.2);
      expect(p.dest.lat).toBeLessThan(1.5);
      expect(p.dest.lng).toBeGreaterThan(103.6);
      expect(p.dest.lng).toBeLessThan(104.1);
    }
  });
});

describe('shadow-report: Statistics & Time Slots', () => {
  it('correctly maps SGT timestamps to operational time-of-day slots', () => {
    // 08:30 SGT is 00:30 UTC
    expect(resolveTimeOfDay('2026-10-13T00:30:00.000Z')).toBe('Morning Peak (07:00-09:30)');
    // 12:00 SGT is 04:00 UTC
    expect(resolveTimeOfDay('2026-10-13T04:00:00.000Z')).toBe('Midday (11:30-14:00)');
    // 18:30 SGT is 10:30 UTC
    expect(resolveTimeOfDay('2026-10-13T10:30:00.000Z')).toBe('Evening Peak (17:00-20:00)');
    // 22:00 SGT is 14:00 UTC
    expect(resolveTimeOfDay('2026-10-13T14:00:00.000Z')).toBe('Night / Off-Peak');
  });

  it('computes engine ETA, distance and latency statistics', () => {
    const samples: ShadowRecord[] = [
      { at: '2026-10-13T00:30:00.000Z', pairId: 'p1', localSec: 1000, localMs: 120, localMeters: 10000 },
      { at: '2026-10-13T00:30:00.000Z', pairId: 'p1', localSec: 950, localMs: 150, localMeters: 9500 },
      { at: '2026-10-13T00:30:00.000Z', pairId: 'p2', localSec: 800, localMs: 110, localMeters: 8000 },
    ];
    const stats = computeStats(samples);
    expect(stats).toMatchObject({
      count: 3, failures: 0, medianLocalSec: 950, minLocalSec: 800, maxLocalSec: 1000,
      medianLatencyMs: 120, p95LatencyMs: 150, medianLocalMeters: 9500,
    });
  });

  it('generates report markdown with computed statuses and breakdown tables', () => {
    const samples: ShadowRecord[] = [
      { at: '2026-10-13T00:30:00.000Z', pairId: 'toa-payoh-to-raffles-place', localSec: 1200, localMs: 95, localMeters: 10500 },
    ];
    const md = generateReportMarkdown(samples);
    expect(md).toContain('SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report');
    expect(md).toContain('toa-payoh-to-raffles-place');
    expect(md).toContain('Morning Peak (07:00-09:30)');
    expect(md).toContain('| **Median Engine Latency** | $< 200$ ms | **PASS**');
    expect(md).toContain('10.50 km');
    expect(md).not.toMatch(/google/i);
  });
});

import { buildGraphFromElements } from '../../tools/osm/build-graph';
import { RoadGraph } from '../../src/routing/graph';

describe('shadow-probe execution', () => {
  const lineGraph = (pair: (typeof SHADOW_PAIRS)[number]) =>
    new RoadGraph(
      buildGraphFromElements([
        {
          type: 'way',
          id: 101,
          tags: { highway: 'primary', maxspeed: '60' },
          geometry: [
            { lat: pair.origin.lat, lon: pair.origin.lng },
            { lat: (pair.origin.lat + pair.dest.lat) / 2, lon: (pair.origin.lng + pair.dest.lng) / 2 },
            { lat: pair.dest.lat, lon: pair.dest.lng },
          ],
        },
      ]),
    );

  it('records engine-only rows and never calls Google', async () => {
    const pair = SHADOW_PAIRS[0];
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: false, status: 503, json: async () => ({}) } as any;
    }));
    try {
      const records = await runShadowProbe({ pairs: [pair], graph: lineGraph(pair), upload: false, writeLocal: false });
      expect(records).toHaveLength(1);
      expect(records[0].pairId).toBe(pair.id);
      expect(records[0].localSec).toBeGreaterThan(0);
      expect(records[0].localMeters).toBeGreaterThan(0);
      expect(Object.keys(records[0]).some((k) => /google|diff/i.test(k))).toBe(false);
      expect(calls.some((u) => u.includes('googleapis.com'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails the run loudly when the engine routes no pair', async () => {
    const pair = SHADOW_PAIRS[0];
    const far = { ...pair, origin: { lat: 1.45, lng: 103.65 }, dest: { lat: 1.45, lng: 103.651 } }; // nowhere near the test road
    const empty = new RoadGraph(buildGraphFromElements([]));
    await expect(runShadowProbe({ pairs: [far], graph: empty, upload: false, writeLocal: false })).rejects.toThrow(/no route for any pair/);
  });

  it('reports ignore engine failures and never read legacy Google fields', () => {
    const rows: any[] = [
      { at: 'x', pairId: 'a', localSec: 988, googleSec: 1, diffPct: 98700, localMs: 100 }, // legacy row: Google fields ignored
      { at: 'x', pairId: 'a', localSec: 950, googleSec: null, localMs: 100, error: 'Google Routes HTTP 400' }, // Google failed, engine fine
      { at: 'x', pairId: 'a', localSec: 0, localMs: 100, error: 'Engine found no route' },
      { at: 'x', pairId: 'a', localSec: 900, localMs: 100 },
      { at: 'x', pairId: 'a', localSec: 5, localMs: 1, simulated: true }, // test row: skipped entirely
    ];
    expect(computeStats(rows)).toMatchObject({ count: 3, failures: 1, medianLocalSec: 950 });
  });
});
