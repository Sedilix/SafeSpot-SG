/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TripsService, GPSTracePoint } from './tripsService';
import { RoadGraph, RoadGraphData } from '../routing/graph';

function createMockRoadGraph(): RoadGraph {
  const data: RoadGraphData = {
    nodes: [
      { id: 0, lat: 1.3000, lng: 103.8000 },
      { id: 1, lat: 1.3010, lng: 103.8010 },
      { id: 2, lat: 1.3020, lng: 103.8020 },
    ],
    edges: [
      { id: 0, from: 0, to: 1, length: 150, maxspeed: 50, seconds: 10.8, wayId: 1001, name: 'Orchard Rd', highway: 'primary', oneway: true },
      { id: 1, from: 1, to: 2, length: 150, maxspeed: 50, seconds: 10.8, wayId: 1002, name: 'Bras Basah Rd', highway: 'primary', oneway: true },
    ],
    turnRestrictions: [],
    trafficSignalNodes: [],
  };
  return new RoadGraph(data);
}

describe('TripsService (Clean-Room Measured Trips)', () => {
  let service: TripsService;
  let mockGraph: RoadGraph;

  beforeEach(() => {
    mockGraph = createMockRoadGraph();
    service = new TripsService(mockGraph);
  });

  it('records trip start and calculates arrival duration and error upon completion', () => {
    const dep = new Date('2026-10-27T10:00:00.000Z');
    service.startTrip({
      tripId: 'trip-1',
      departureTime: dep,
      predictedSec: 300,
      pickupCandidateId: 'stand-123',
    });

    const arr = new Date('2026-10-27T10:05:15.000Z'); // 315 seconds later (+5% error)
    const record = service.completeTrip('trip-1', arr, undefined, false);

    expect(record.tripId).toBe('trip-1');
    expect(record.predictedSec).toBe(300);
    expect(record.actualSec).toBe(315);
    expect(record.diffSec).toBe(15);
    expect(record.diffPct).toBeCloseTo(4.76, 1);
    expect(record.userConsented).toBe(false);
    expect(record.edgeTimes).toEqual([]);
  });

  it('map-matches consented GPS trace to road edges and drops raw coordinates', () => {
    const dep = new Date('2026-10-27T10:00:00.000Z');
    service.startTrip({
      tripId: 'trip-2',
      departureTime: dep,
      predictedSec: 20,
      pickupCandidateId: 'stand-456',
    });

    const trace: GPSTracePoint[] = [
      { lat: 1.3001, lng: 103.8001, timestampMs: dep.getTime() },
      { lat: 1.3005, lng: 103.8005, timestampMs: dep.getTime() + 5000 },
      { lat: 1.3012, lng: 103.8012, timestampMs: dep.getTime() + 11000 },
      { lat: 1.3018, lng: 103.8018, timestampMs: dep.getTime() + 21000 },
    ];

    const arr = new Date(dep.getTime() + 22000);
    const record = service.completeTrip('trip-2', arr, trace, true);

    expect(record.userConsented).toBe(true);
    expect(record.edgeTimes.length).toBeGreaterThan(0);
    expect(record.edgeTimes[0].edgeId).toBeDefined();
    expect(record.edgeTimes[0].traversalSeconds).toBeGreaterThan(0);
    expect(record.edgeTimes[0].speedKmh).toBeGreaterThan(0);

    // Verify privacy: no raw lat/lng in the output record
    expect((record as any).lat).toBeUndefined();
    expect((record as any).gpsTrace).toBeUndefined();
  });

  it('computes calibration summary and checks decision gates', () => {
    // Simulate 4 trips with small errors (within target: median <= 10%, bias +/-5%, p95 <= 25%)
    const t0 = new Date('2026-10-27T12:00:00.000Z');

    service.startTrip({ tripId: 't1', departureTime: t0, predictedSec: 100, pickupCandidateId: 'c1' });
    service.completeTrip('t1', new Date(t0.getTime() + 104000)); // 104s, +3.85%

    service.startTrip({ tripId: 't2', departureTime: t0, predictedSec: 200, pickupCandidateId: 'c2' });
    service.completeTrip('t2', new Date(t0.getTime() + 208000)); // 208s, +3.85%

    service.startTrip({ tripId: 't3', departureTime: t0, predictedSec: 300, pickupCandidateId: 'c3' });
    service.completeTrip('t3', new Date(t0.getTime() + 294000)); // 294s, -2.04%

    service.startTrip({ tripId: 't4', departureTime: t0, predictedSec: 400, pickupCandidateId: 'c4' });
    service.completeTrip('t4', new Date(t0.getTime() + 412000)); // 412s, +2.91%

    const summary = service.computeCalibrationSummary();
    expect(summary.totalTrips).toBe(4);
    expect(summary.medianAbsErrorPct).toBeLessThanOrEqual(10.0);
    expect(Math.abs(summary.meanSignedBiasPct)).toBeLessThanOrEqual(5.0);
    expect(summary.p95AbsErrorPct).toBeLessThanOrEqual(25.0);
    expect(summary.gates.overallVerdict).toBe('PASS');
  });
});
