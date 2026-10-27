/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * tripsService.edge-cases.test.ts: Dynamic behavioral validation & edge-case suite
 * for Clean-Room Measured Trips Logging and Calibration Engine.
 *
 * Validates:
 * 1. Identical timestamps on consecutive GPS trace points (zero span, no division by zero or NaN).
 * 2. Fewer than 2 points snapping to road network (empty array return).
 * 3. Out-of-order timestamps and zero elapsed seconds in trip start / completion.
 * 4. Calibration summary math with 0, 1, 2 (even median), and 3 (odd median) trips against decision gates.
 * 5. Strict PDPA privacy compliance: zero coordinate or PII leakage in records or edge times.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TripsService, GPSTracePoint, TripCompletionRecord } from './tripsService';
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

describe('TripsService Dynamic Behavioral Validation & Edge Cases', () => {
  let service: TripsService;
  let mockGraph: RoadGraph;

  beforeEach(() => {
    mockGraph = createMockRoadGraph();
    service = new TripsService(mockGraph);
  });

  describe('1. mapMatchTraceToEdges - Identical Timestamps & Zero Durations', () => {
    it('prevents division by zero and NaN speed when consecutive points have identical timestamps', () => {
      const fixedTimestamp = 1700000000000;
      // Trace with identical timestamps on consecutive points that snap to edge 0
      const traceWithIdenticalTimestamps: GPSTracePoint[] = [
        { lat: 1.3001, lng: 103.8001, timestampMs: fixedTimestamp },
        { lat: 1.3003, lng: 103.8003, timestampMs: fixedTimestamp }, // identical timestamp
        { lat: 1.3006, lng: 103.8006, timestampMs: fixedTimestamp }, // identical timestamp
      ];

      const edgeTimes = service.mapMatchTraceToEdges(traceWithIdenticalTimestamps);

      expect(edgeTimes.length).toBeGreaterThan(0);
      for (const item of edgeTimes) {
        expect(Number.isFinite(item.traversalSeconds)).toBe(true);
        expect(Number.isNaN(item.traversalSeconds)).toBe(false);
        expect(item.traversalSeconds).toBeGreaterThanOrEqual(1); // Math.max(1, 0) safeguard

        expect(Number.isFinite(item.speedKmh)).toBe(true);
        expect(Number.isNaN(item.speedKmh)).toBe(false);
        expect(item.speedKmh).toBeGreaterThan(0);
      }
    });

    it('handles identical timestamps when snapping across multiple road edges', () => {
      const fixedTimestamp = 1700000000000;
      // Point 1 & 2 snap to edge 0, point 3 snaps to edge 1, all with identical timestamps
      const trace: GPSTracePoint[] = [
        { lat: 1.3001, lng: 103.8001, timestampMs: fixedTimestamp },
        { lat: 1.3005, lng: 103.8005, timestampMs: fixedTimestamp },
        { lat: 1.3015, lng: 103.8015, timestampMs: fixedTimestamp },
      ];

      const edgeTimes = service.mapMatchTraceToEdges(trace);
      expect(edgeTimes.length).toBeGreaterThan(0);

      for (const item of edgeTimes) {
        expect(Number.isFinite(item.speedKmh)).toBe(true);
        expect(Number.isNaN(item.speedKmh)).toBe(false);
        expect(item.traversalSeconds).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('2. mapMatchTraceToEdges - Insufficient Snapped Points', () => {
    it('returns empty array when trace has fewer than 2 points', () => {
      expect(service.mapMatchTraceToEdges([])).toEqual([]);
      expect(
        service.mapMatchTraceToEdges([
          { lat: 1.3001, lng: 103.8001, timestampMs: 1000 },
        ])
      ).toEqual([]);
    });

    it('returns empty array when fewer than 2 points snap to the road network', () => {
      // Point 1 is near Orchard Rd (snaps), points 2 & 3 are far offshore (do not snap within 35m)
      const trace: GPSTracePoint[] = [
        { lat: 1.3001, lng: 103.8001, timestampMs: 1000 }, // snaps to edge 0
        { lat: 1.9500, lng: 104.5000, timestampMs: 2000 }, // far outside network
        { lat: 2.1000, lng: 105.0000, timestampMs: 3000 }, // far outside network
      ];

      const result = service.mapMatchTraceToEdges(trace);
      expect(result).toEqual([]);
    });

    it('returns empty array when all points fail to snap to any road edge', () => {
      const trace: GPSTracePoint[] = [
        { lat: 0.0000, lng: 0.0000, timestampMs: 1000 },
        { lat: 0.0010, lng: 0.0010, timestampMs: 2000 },
      ];

      const result = service.mapMatchTraceToEdges(trace);
      expect(result).toEqual([]);
    });
  });

  describe('3. startTrip and completeTrip - Out-of-Order & Zero Durations', () => {
    it('handles arrival timestamp occurring before departure timestamp without crashing or NaN', () => {
      const dep = new Date('2026-10-27T10:05:00.000Z');
      const arr = new Date('2026-10-27T10:00:00.000Z'); // 5 minutes BEFORE departure (clock drift / user error)

      service.startTrip({
        tripId: 'retrograde-trip',
        departureTime: dep,
        predictedSec: 300,
        pickupCandidateId: 'stand-1',
      });

      const record = service.completeTrip('retrograde-trip', arr);

      expect(record.tripId).toBe('retrograde-trip');
      // Actual seconds is clamped to Math.max(1, negative)
      expect(record.actualSec).toBe(1);
      expect(Number.isFinite(record.diffSec)).toBe(true);
      expect(Number.isNaN(record.diffSec)).toBe(false);
      expect(record.diffSec).toBe(1 - 300); // -299
      expect(Number.isFinite(record.diffPct)).toBe(true);
      expect(Number.isNaN(record.diffPct)).toBe(false);
    });

    it('handles identical departure and arrival timestamps (zero elapsed seconds)', () => {
      const time = new Date('2026-10-27T10:00:00.000Z');

      service.startTrip({
        tripId: 'zero-duration-trip',
        departureTime: time,
        predictedSec: 120,
        pickupCandidateId: 'stand-2',
      });

      const record = service.completeTrip('zero-duration-trip', time);

      expect(record.actualSec).toBe(1); // Clamped to 1s to prevent division by zero
      expect(record.diffSec).toBe(1 - 120); // -119
      expect(Number.isFinite(record.diffPct)).toBe(true);
      expect(Number.isNaN(record.diffPct)).toBe(false);
    });

    it('gracefully handles completeTrip called for an unregistered trip ID', () => {
      const arr = new Date('2026-10-27T10:10:00.000Z');
      // When trip was never started, uses 10-minute fallback
      const record = service.completeTrip('unknown-trip-id', arr);

      expect(record.tripId).toBe('unknown-trip-id');
      expect(record.predictedSec).toBe(600);
      expect(record.actualSec).toBe(600);
      expect(record.diffSec).toBe(0);
      expect(record.diffPct).toBe(0);
    });
  });

  describe('4. computeCalibrationSummary - Exact Trip Count Gates (0, 1, 2, 3)', () => {
    it('evaluates exactly 0 trips returning failing decision gates and zeroed metrics', () => {
      const summary = service.computeCalibrationSummary();

      expect(summary.totalTrips).toBe(0);
      expect(summary.medianAbsErrorPct).toBe(0);
      expect(summary.meanSignedBiasPct).toBe(0);
      expect(summary.p95AbsErrorPct).toBe(0);
      expect(summary.medianAbsErrorSec).toBe(0);
      expect(summary.gates.medianPass).toBe(false);
      expect(summary.gates.biasPass).toBe(false);
      expect(summary.gates.p95Pass).toBe(false);
      expect(summary.gates.overallVerdict).toBe('FAIL');
    });

    it('evaluates exactly 1 trip correctly against decision gates', () => {
      const t0 = new Date('2026-10-27T08:00:00.000Z');
      // 1 trip: predicted 100s, actual 104s (+3.85% error)
      service.startTrip({ tripId: 'single-trip', departureTime: t0, predictedSec: 100, pickupCandidateId: 'c1' });
      service.completeTrip('single-trip', new Date(t0.getTime() + 104000));

      const summary = service.computeCalibrationSummary();

      expect(summary.totalTrips).toBe(1);
      expect(summary.medianAbsErrorPct).toBe(3.85);
      expect(summary.meanSignedBiasPct).toBe(3.85);
      expect(summary.p95AbsErrorPct).toBe(3.85);
      expect(summary.medianAbsErrorSec).toBe(4);
      expect(summary.gates.medianPass).toBe(true);  // 3.85% <= 10.0%
      expect(summary.gates.biasPass).toBe(true);    // |3.85%| <= 5.0%
      expect(summary.gates.p95Pass).toBe(true);     // 3.85% <= 25.0%
      expect(summary.gates.overallVerdict).toBe('PASS');
    });

    it('evaluates exactly 2 trips (even count median indexing)', () => {
      const t0 = new Date('2026-10-27T08:00:00.000Z');
      // Trip 1: predicted 100s, actual 102s (diff +2s, diffPct = (2/102)*100 = 1.96%)
      service.startTrip({ tripId: 'even-1', departureTime: t0, predictedSec: 100, pickupCandidateId: 'c1' });
      service.completeTrip('even-1', new Date(t0.getTime() + 102000));

      // Trip 2: predicted 200s, actual 216s (diff +16s, diffPct = (16/216)*100 = 7.41%)
      service.startTrip({ tripId: 'even-2', departureTime: t0, predictedSec: 200, pickupCandidateId: 'c2' });
      service.completeTrip('even-2', new Date(t0.getTime() + 216000));

      const summary = service.computeCalibrationSummary();

      expect(summary.totalTrips).toBe(2);
      // For n=2: medianIdx = floor(2 * 0.5) = 1.
      // Sorted absPcts: [1.96, 7.41]. median item is index 1 -> 7.41%
      expect(summary.medianAbsErrorPct).toBe(7.41);
      // Mean signed bias: (1.96 + 7.41) / 2 = 4.685 -> 4.69%
      expect(summary.meanSignedBiasPct).toBeCloseTo(4.69, 1);
      // p95Idx = min(1, floor(2 * 0.95)) = min(1, 1) = 1 -> 7.41%
      expect(summary.p95AbsErrorPct).toBe(7.41);
      expect(summary.gates.medianPass).toBe(true); // 7.41% <= 10%
      expect(summary.gates.biasPass).toBe(true);   // 4.69% <= 5%
      expect(summary.gates.p95Pass).toBe(true);    // 7.41% <= 25%
      expect(summary.gates.overallVerdict).toBe('PASS');
    });

    it('evaluates exactly 3 trips (odd count median indexing)', () => {
      const t0 = new Date('2026-10-27T08:00:00.000Z');
      // Trip 1: diffPct = 2.0%
      service.startTrip({ tripId: 'odd-1', departureTime: t0, predictedSec: 98, pickupCandidateId: 'c1' });
      service.completeTrip('odd-1', new Date(t0.getTime() + 100000)); // actual 100s, diff 2s -> 2.00%

      // Trip 2: diffPct = 4.0%
      service.startTrip({ tripId: 'odd-2', departureTime: t0, predictedSec: 96, pickupCandidateId: 'c2' });
      service.completeTrip('odd-2', new Date(t0.getTime() + 100000)); // actual 100s, diff 4s -> 4.00%

      // Trip 3: diffPct = 8.0%
      service.startTrip({ tripId: 'odd-3', departureTime: t0, predictedSec: 92, pickupCandidateId: 'c3' });
      service.completeTrip('odd-3', new Date(t0.getTime() + 100000)); // actual 100s, diff 8s -> 8.00%

      const summary = service.computeCalibrationSummary();

      expect(summary.totalTrips).toBe(3);
      // For n=3: medianIdx = floor(3 * 0.5) = 1.
      // Sorted absPcts: [2.00, 4.00, 8.00]. middle item is 4.00%
      expect(summary.medianAbsErrorPct).toBe(4.00);
      // Mean bias: (2.0 + 4.0 + 8.0)/3 = 4.67%
      expect(summary.meanSignedBiasPct).toBe(4.67);
      // p95Idx = min(2, floor(3 * 0.95)) = min(2, 2) = 2 -> 8.00%
      expect(summary.p95AbsErrorPct).toBe(8.00);
      expect(summary.gates.overallVerdict).toBe('PASS');
    });

    it('fails overallVerdict if any decision gate threshold is breached', () => {
      const t0 = new Date('2026-10-27T08:00:00.000Z');
      // Create a trip with large error (+30%)
      service.startTrip({ tripId: 'outlier-trip', departureTime: t0, predictedSec: 70, pickupCandidateId: 'c1' });
      service.completeTrip('outlier-trip', new Date(t0.getTime() + 100000)); // actual 100s, diff 30s -> 30.00%

      const summary = service.computeCalibrationSummary();
      expect(summary.medianAbsErrorPct).toBe(30.00);
      expect(summary.gates.medianPass).toBe(false); // 30% > 10%
      expect(summary.gates.biasPass).toBe(false);   // 30% > 5%
      expect(summary.gates.p95Pass).toBe(false);    // 30% > 25%
      expect(summary.gates.overallVerdict).toBe('FAIL');
    });
  });

  describe('5. Strict PDPA Privacy Compliance', () => {
    it('asserts that completed trip records contain NO raw coordinates or PII fields', () => {
      const dep = new Date('2026-10-27T10:00:00.000Z');
      const startPayload = {
        tripId: 'pdpa-audit-trip',
        departureTime: dep,
        predictedSec: 25,
        pickupCandidateId: 'stand-999',
        driverStart: { lat: 1.3000, lng: 103.8000 }, // Sensitive coordinate
      };

      service.startTrip(startPayload);

      const sensitiveTrace: GPSTracePoint[] = [
        { lat: 1.3001, lng: 103.8001, timestampMs: dep.getTime() },
        { lat: 1.3006, lng: 103.8006, timestampMs: dep.getTime() + 5000 },
        { lat: 1.3012, lng: 103.8012, timestampMs: dep.getTime() + 10000 },
        { lat: 1.3018, lng: 103.8018, timestampMs: dep.getTime() + 25000 },
      ];

      const arr = new Date(dep.getTime() + 25000);
      const record = service.completeTrip('pdpa-audit-trip', arr, sensitiveTrace, true);

      // Verify exact allowable top-level keys in TripCompletionRecord
      const allowedTopLevelKeys = new Set([
        'tripId',
        'departureTime',
        'arrivalTime',
        'predictedSec',
        'actualSec',
        'diffSec',
        'diffPct',
        'edgeTimes',
        'userConsented',
        'recordedAt',
      ]);

      const recordKeys = Object.keys(record);
      for (const k of recordKeys) {
        expect(allowedTopLevelKeys.has(k)).toBe(true);
      }

      // Explicit check for forbidden PII & geospatial tracking keys
      const forbiddenKeys = [
        'lat',
        'lng',
        'latitude',
        'longitude',
        'deviceId',
        'phone',
        'phoneNumber',
        'name',
        'nric',
        'driverStart',
        'gpsTrace',
        'trace',
        'rawTrace',
        'points',
        'coordinates',
        'locations',
      ];

      for (const forbidden of forbiddenKeys) {
        expect((record as any)[forbidden]).toBeUndefined();
      }

      // Assert edgeTimes entries only contain anonymous graph metadata
      expect(record.edgeTimes.length).toBeGreaterThan(0);
      const allowedEdgeKeys = new Set(['edgeId', 'wayId', 'traversalSeconds', 'speedKmh']);

      for (const edgeTime of record.edgeTimes) {
        const edgeKeys = Object.keys(edgeTime);
        for (const k of edgeKeys) {
          expect(allowedEdgeKeys.has(k)).toBe(true);
        }

        for (const forbidden of forbiddenKeys) {
          expect((edgeTime as any)[forbidden]).toBeUndefined();
        }
      }

      // Check stored records in service
      const stored = service.getCompletedTrips();
      expect(stored.length).toBe(1);
      for (const forbidden of forbiddenKeys) {
        expect((stored[0] as any)[forbidden]).toBeUndefined();
      }
    });
  });
});
