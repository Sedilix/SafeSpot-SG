/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { alignCorridors, buildGoogleTrack, decodePolyline, EngineSlice, GoogleRouteRaw } from './gap-alignment-table';

describe('decodePolyline', () => {
  it("decodes Google's reference polyline", () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toEqual([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
  });
});

function encode(pts: Array<{ lat: number; lng: number }>): string {
  let out = '', pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1, s = '';
    while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5; }
    return s + String.fromCharCode(x + 63);
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return out;
}

describe('alignCorridors', () => {
  // Local grid: 1 unit = 100 m. Google goes straight east for 3 km in two 100 s steps.
  const P = (x: number, y = 0) => ({ lat: 1.3 + y * 0.0009, lng: 103.8 + x * 0.0009 });
  const google: GoogleRouteRaw = {
    duration: '200s', distanceMeters: 3000,
    legs: [{ steps: [
      { staticDuration: '100s', polyline: { encodedPolyline: encode([P(0), P(15)]) }, navigationInstruction: { instructions: 'Head east on Expressway' } },
      { staticDuration: '100s', polyline: { encodedPolyline: encode([P(15), P(30)]) }, navigationInstruction: { instructions: 'Continue on Expressway' } },
    ] }],
  };
  const slice = (a: [number, number], b: [number, number], seconds: number, name: string): EngineSlice =>
    ({ from: P(...a), to: P(...b), lengthM: Math.hypot(b[0] - a[0], b[1] - a[1]) * 100, seconds, signals: 0, name });

  it('splits the engine path into shared / divergent / shared and times Google between the rejoin points', () => {
    const engine = [
      slice([0, 0], [10, 0], 40, 'Expressway'),
      slice([10, 0], [10, 3], 30, 'Side Road'), // leaves Google's corridor by 300 m
      slice([10, 3], [20, 3], 100, 'Side Road'),
      slice([20, 3], [20, 0], 30, 'Side Road'),
      slice([20, 0], [30, 0], 40, 'Expressway'),
    ];
    const segs = alignCorridors(engine, buildGoogleTrack(google));
    expect(segs.map((s) => s.kind)).toEqual(['shared', 'divergent', 'shared']);
    const div = segs[1];
    expect(div.engineSec).toBe(160);
    expect(div.engineRoads).toBe('Side Road');
    // Google's stretch between the leave and rejoin points: ~1 km, ~1/3 of its 200 s.
    expect(div.googleM).toBeGreaterThan(950);
    expect(div.googleM).toBeLessThan(1050);
    expect(div.googleSec).toBeGreaterThan(62);
    expect(div.googleSec).toBeLessThan(72);
    expect(Math.abs(segs.reduce((s, x) => s + x.googleSec, 0) - 200)).toBeLessThanOrEqual(1); // per-row rounding
  });

  it('keeps a parallel carriageway within 35 m as shared', () => {
    const segs = alignCorridors([slice([0, 0.2], [30, 0.2], 200, 'Expressway')], buildGoogleTrack(google)); // 20 m off
    expect(segs.map((s) => s.kind)).toEqual(['shared']);
  });
});
