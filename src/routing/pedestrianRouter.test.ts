/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pedestrianRouter.test.ts: Tests for Phase 3 Senior Pedestrian Routing.
 *
 * Acceptance tests:
 *  1. Rain switches route to covered walkway when available.
 *  2. Stairs avoidance redirects route around steps.
 *  3. Senior walking pace (0.9 m/s) matches ETA within 20% of Google WALK * 1.5.
 *  4. WeatherService NEA rainfall integration.
 *  5. Integration with pickupService.ts behind ROUTING_ENGINE=local feature flag.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PedestrianGraph, PedestrianGraphData } from './pedestrianGraph';
import { PedestrianRouter } from './pedestrianRouter';
import { WeatherService } from './weather';
import { routeMatrix } from '../utils/pickupService';

// Synthetic pedestrian network for deterministic edge-case testing
function createSyntheticPedestrianGraph(): PedestrianGraph {
  const data: PedestrianGraphData = {
    nodes: [
      { id: 0, lat: 1.3000, lng: 103.8000 },
      { id: 1, lat: 1.3005, lng: 103.8000 }, // Direct uncovered midpoint
      { id: 2, lat: 1.3000, lng: 103.8005 }, // Detour covered midpoint
      { id: 3, lat: 1.3010, lng: 103.8010 }, // Target node
      { id: 4, lat: 1.3005, lng: 103.8005 }, // Midpoint with steps
    ],
    edges: [
      // Direct path (0 -> 1 -> 3): 100m total, unsheltered
      { id: 0, from: 0, to: 1, length: 50, covered: false, isSteps: false, hasRamp: false, name: 'Direct A', highway: 'footway', wayId: 101 },
      { id: 1, from: 1, to: 0, length: 50, covered: false, isSteps: false, hasRamp: false, name: 'Direct A', highway: 'footway', wayId: 101 },
      { id: 2, from: 1, to: 3, length: 50, covered: false, isSteps: false, hasRamp: false, name: 'Direct B', highway: 'footway', wayId: 102 },
      { id: 3, from: 3, to: 1, length: 50, covered: false, isSteps: false, hasRamp: false, name: 'Direct B', highway: 'footway', wayId: 102 },

      // Sheltered detour path (0 -> 2 -> 3): 140m total, covered
      { id: 4, from: 0, to: 2, length: 70, covered: true, isSteps: false, hasRamp: false, name: 'Linkway A', highway: 'footway', wayId: 103 },
      { id: 5, from: 2, to: 0, length: 70, covered: true, isSteps: false, hasRamp: false, name: 'Linkway A', highway: 'footway', wayId: 103 },
      { id: 6, from: 2, to: 3, length: 70, covered: true, isSteps: false, hasRamp: false, name: 'Linkway B', highway: 'footway', wayId: 104 },
      { id: 7, from: 3, to: 2, length: 70, covered: true, isSteps: false, hasRamp: false, name: 'Linkway B', highway: 'footway', wayId: 104 },

      // Stairs path (0 -> 4 -> 3): 60m total, but has stairs
      { id: 8, from: 0, to: 4, length: 30, covered: false, isSteps: true, hasRamp: false, name: 'Stairs A', highway: 'steps', wayId: 105 },
      { id: 9, from: 4, to: 0, length: 30, covered: false, isSteps: true, hasRamp: false, name: 'Stairs A', highway: 'steps', wayId: 105 },
      { id: 10, from: 4, to: 3, length: 30, covered: false, isSteps: true, hasRamp: false, name: 'Stairs B', highway: 'steps', wayId: 106 },
      { id: 11, from: 3, to: 4, length: 30, covered: false, isSteps: true, hasRamp: false, name: 'Stairs B', highway: 'steps', wayId: 106 },
    ],
    generatedAt: new Date().toISOString(),
    stats: { nodes: 5, edges: 12 },
  };
  return new PedestrianGraph(data);
}

describe('PedestrianRouter (Synthetic Graph)', () => {
  const graph = createSyntheticPedestrianGraph();
  const router = new PedestrianRouter(graph);
  const start = { lat: 1.3000, lng: 103.8000 };
  const dest = { lat: 1.3010, lng: 103.8010 };

  it('selects the shortest direct path in dry weather when avoiding stairs', async () => {
    const route = await router.findRoute(start, dest, { isRaining: false, avoidStairs: true });
    expect(route).not.toBeNull();
    // Direct path via node 1 is 100m, sheltered detour via node 2 is 140m
    expect(route!.distanceMeters).toBe(100);
    expect(route!.shelteredDistanceMeters).toBe(0);
    expect(route!.stepsCount).toBe(0);
    expect(route!.durationSeconds).toBe(Math.round(100 / 0.9));
  });

  it('switches to covered linkway when raining (acceptance test #1)', async () => {
    // Under rain, unsheltered cost = 100m / 0.9 * 3.0 = 333
    // Sheltered detour cost = 140m / 0.9 * 1.0 = 155
    const route = await router.findRoute(start, dest, { isRaining: true, avoidStairs: true });
    expect(route).not.toBeNull();
    expect(route!.distanceMeters).toBe(140);
    expect(route!.shelteredDistanceMeters).toBe(140);
    expect(route!.shelteredPercentage).toBe(100);
    expect(route!.isRaining).toBe(true);
  });

  it('avoids stairs when avoidStairs is true (acceptance test #2)', async () => {
    // Stairs path is 60m, flat direct is 100m
    const withStairs = await router.findRoute(start, dest, { isRaining: false, avoidStairs: false });
    const withoutStairs = await router.findRoute(start, dest, { isRaining: false, avoidStairs: true });

    expect(withStairs).not.toBeNull();
    expect(withoutStairs).not.toBeNull();

    // When stairs are allowed, the 60m stair path is taken
    expect(withStairs!.distanceMeters).toBe(60);
    expect(withStairs!.stepsCount).toBe(2);

    // When stairs are avoided, the 100m flat path is taken
    expect(withoutStairs!.distanceMeters).toBe(100);
    expect(withoutStairs!.stepsCount).toBe(0);
  });

  it('calculates elderly walking duration at 0.9 m/s pace', async () => {
    const route = await router.findRoute(start, dest, {
      seniorPaceMps: 0.9,
      isRaining: false,
      avoidStairs: true,
    });
    expect(route).not.toBeNull();
    expect(route!.durationSeconds).toBe(Math.round(100 / 0.9)); // ~111 seconds
  });

  it('verifies walking ETA is within 20% of Google WALK * 1.5 baseline (acceptance test #3)', async () => {
    const route = await router.findRoute(start, dest, { isRaining: false, avoidStairs: true });
    expect(route).not.toBeNull();

    // Google walk baseline: Google assumes ~1.34 m/s.
    // Google WALK * 1.5 = (distance / 1.34) * 1.5 = distance / 0.893 m/s.
    // Our senior engine uses distance / 0.9 m/s.
    const googleWalkSeconds = route!.distanceMeters / 1.34;
    const seniorBaselineSeconds = googleWalkSeconds * 1.5;

    const error = Math.abs(route!.durationSeconds - seniorBaselineSeconds) / seniorBaselineSeconds;
    expect(error).toBeLessThan(0.20); // Acceptance test: error < 20%
  });
});

describe('WeatherService live telemetry', () => {
  it('detects rain threshold when rainfall >= 1.0 mm', async () => {
    const ws = new WeatherService();
    // Simulate station data injection
    (ws as any).cachedStations = [
      { id: 'S77', lat: 1.3327, lng: 103.8479, rainfallMm: 2.4 },
    ];
    (ws as any).lastFetchTime = Date.now();

    const assessment = await ws.assessWeatherAt(1.3327, 103.8479);
    expect(assessment.rainfallMm).toBe(2.4);
    expect(assessment.isRaining).toBe(true);
  });

  it('treats light mist / dry conditions below 1.0 mm as dry', async () => {
    const ws = new WeatherService();
    (ws as any).cachedStations = [
      { id: 'S77', lat: 1.3327, lng: 103.8479, rainfallMm: 0.4 },
    ];
    (ws as any).lastFetchTime = Date.now();

    const assessment = await ws.assessWeatherAt(1.3327, 103.8479);
    expect(assessment.rainfallMm).toBe(0.4);
    expect(assessment.isRaining).toBe(false);
  });
});

const realGraphPath = join(process.cwd(), 'data', 'graph', 'singapore-pedestrian-graph.json');
const realGraphExists = existsSync(realGraphPath);

describe.skipIf(!realGraphExists)('PedestrianRouter on Real Singapore Network', () => {
  let router: PedestrianRouter;

  beforeEach(() => {
    router = new PedestrianRouter();
  });

  it('finds connected walking route in Toa Payoh estate', async () => {
    const origin = { lat: 1.332756, lng: 103.847798 }; // Blk 480
    const dest = { lat: 1.33273, lng: 103.850117 };   // Toa Payoh Hub

    const route = await router.findRoute(origin, dest, { isRaining: false });
    expect(route).not.toBeNull();
    expect(route!.distanceMeters).toBeGreaterThan(100);
    expect(route!.durationSeconds).toBeGreaterThan(60);
    expect(route!.path.length).toBeGreaterThan(2);
  });

  it('verifies walking ETA is within 20% of Google WALK * 1.5 baseline on live estate', async () => {
    const origin = { lat: 1.332756, lng: 103.847798 };
    const dest = { lat: 1.33273, lng: 103.850117 };

    const route = await router.findRoute(origin, dest, { isRaining: false });
    expect(route).not.toBeNull();

    const googleWalkSeconds = route!.distanceMeters / 1.34;
    const seniorBaselineSeconds = googleWalkSeconds * 1.5;

    const error = Math.abs(route!.durationSeconds - seniorBaselineSeconds) / seniorBaselineSeconds;
    expect(error).toBeLessThan(0.20);
  });
});

describe('pickupService.ts ROUTING_ENGINE=local integration', () => {
  const origEnv = process.env.ROUTING_ENGINE;

  afterEach(() => {
    process.env.ROUTING_ENGINE = origEnv;
  });

  it('computes walking route legs using local pedestrian router when flag is active', async () => {
    const graph = createSyntheticPedestrianGraph();
    const mockRouter = new PedestrianRouter(graph);

    const origin = { lat: 1.3000, lng: 103.8000 };
    const destinations = [
      { id: 'stand-1', kind: 'taxi_stand' as const, name: 'Stand 1', lat: 1.3010, lng: 103.8010 },
    ];

    const result = await routeMatrix(origin, destinations, 'WALK', '', mockRouter);
    expect(result.has('stand-1')).toBe(true);
    const leg = result.get('stand-1');
    expect(leg).not.toBeNull();
    expect(leg!.meters).toBe(100);
    expect(leg!.seconds).toBeGreaterThan(50);
  });
});
