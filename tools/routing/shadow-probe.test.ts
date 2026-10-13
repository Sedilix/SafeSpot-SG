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

  it('computes median absolute error, mean signed error, and latency quantiles', () => {
    const samples: ShadowRecord[] = [
      { at: '2026-10-13T00:30:00.000Z', pairId: 'p1', localSec: 1000, googleSec: 900, diffPct: 11.1, localMs: 120, googleOk: true },
      { at: '2026-10-13T00:30:00.000Z', pairId: 'p1', localSec: 950, googleSec: 1000, diffPct: -5.0, localMs: 150, googleOk: true },
      { at: '2026-10-13T00:30:00.000Z', pairId: 'p2', localSec: 800, googleSec: 800, diffPct: 0.0, localMs: 110, googleOk: true },
    ];

    const stats = computeStats(samples);
    expect(stats.count).toBe(3);
    // Absolute diffs: [0.0, 5.0, 11.1], median is 5.0
    expect(stats.medianAbsErrorPct).toBe(5.0);
    // Signed diffs: (11.1 - 5.0 + 0) / 3 = 2.03
    expect(stats.meanSignedErrorPct).toBeCloseTo(2.03, 1);
    expect(stats.medianLatencyMs).toBe(120);
    expect(stats.p95LatencyMs).toBe(150);
  });

  it('generates report markdown containing computed status and breakdown tables', () => {
    const samples: ShadowRecord[] = [
      { at: '2026-10-13T00:30:00.000Z', pairId: 'toa-payoh-to-raffles-place', localSec: 1200, googleSec: 1150, diffPct: 4.3, localMs: 95, googleOk: true },
    ];

    const md = generateReportMarkdown(samples);
    expect(md).toContain('SafeSpot Routing Engine — Scheduled Drive Shadow Probe Report');
    expect(md).toContain('toa-payoh-to-raffles-place');
    expect(md).toContain('Morning Peak (07:00-09:30)');
    expect(md).toContain('PASS');
  });
});

import { buildGraphFromElements } from '../../tools/osm/build-graph';
import { RoadGraph } from '../../src/routing/graph';

describe('shadow-probe execution', () => {
  it('runs probe cycle for single corridor in simulation mode', async () => {
    const pair = SHADOW_PAIRS[0];
    const midLat = (pair.origin.lat + pair.dest.lat) / 2;
    const midLng = (pair.origin.lng + pair.dest.lng) / 2;
    const mockGraph = new RoadGraph(
      buildGraphFromElements([
        {
          type: 'way',
          id: 101,
          tags: { highway: 'primary', maxspeed: '60' },
          geometry: [
            { lat: pair.origin.lat, lon: pair.origin.lng },
            { lat: midLat, lon: midLng },
            { lat: pair.dest.lat, lon: pair.dest.lng },
          ],
        },
      ])
    );

    const records = await runShadowProbe({
      simulateGoogle: true,
      pairs: [pair],
      graph: mockGraph,
    });

    expect(records.length).toBe(1);
    expect(records[0].pairId).toBe(pair.id);
    expect(records[0].localSec).toBeGreaterThan(0);
    expect(records[0].googleSec).toBeGreaterThan(0);
    expect(records[0].simulated).toBe(true);
    expect(records[0].googleOk).toBe(false);
  });

  it('records a Google failure as a failure, never as a 0% match, and fails the run', async () => {
    const pair = SHADOW_PAIRS[0];
    const midLat = (pair.origin.lat + pair.dest.lat) / 2;
    const midLng = (pair.origin.lng + pair.dest.lng) / 2;
    const graph = new RoadGraph(
      buildGraphFromElements([
        {
          type: 'way',
          id: 202,
          tags: { highway: 'primary', maxspeed: '60' },
          geometry: [
            { lat: pair.origin.lat, lon: pair.origin.lng },
            { lat: midLat, lon: midLng },
            { lat: pair.dest.lat, lon: pair.dest.lng },
          ],
        },
      ]),
    );
    const prevKey = process.env.MAPS_SERVER_KEY;
    process.env.MAPS_SERVER_KEY = 'test-key';
    const calls: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
        return { ok: false, status: 400, text: async () => '{"error":{"message":"Timestamp must be set to a future time."}}' } as any;
      }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(runShadowProbe({ pairs: [pair], graph, upload: false })).rejects.toThrow(/Every Google query failed/);
      const google = calls.find((c) => String(c.url).includes('computeRoutes'));
      expect(google.body.departureTime).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
      if (prevKey === undefined) delete process.env.MAPS_SERVER_KEY;
      else process.env.MAPS_SERVER_KEY = prevKey;
    }
  });

  it('reports ignore failed, simulated and pre-fix rows', () => {
    const rows: any[] = [
      { at: 'x', pairId: 'a', localSec: 988, googleSec: 988, diffPct: 0, localMs: 100 },
      { at: 'x', pairId: 'a', localSec: 900, googleSec: null, diffPct: null, localMs: 100, googleOk: false, error: 'HTTP 400' },
      { at: 'x', pairId: 'a', localSec: 900, googleSec: 1000, diffPct: -10, localMs: 100, googleOk: true },
    ];
    expect(rows.filter(isUsable)).toHaveLength(1);
    expect(computeStats(rows).count).toBe(1);
    expect(computeStats(rows).medianAbsErrorPct).toBe(10);
  });
});
