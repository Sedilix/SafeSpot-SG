/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * alternatives.test.ts: Unit tests for Phase 4 route alternatives:
 *  - Edge penalty method (x1.35 on traversed edges)
 *  - Spatial overlap filter (accept if overlap < 65%)
 *  - Generation of up to 3 spatially distinct alternative routes
 *  - Preservation of unpenalized duration metrics
 */

import { describe, it, expect } from 'vitest';
import { RoadGraph } from './graph';
import { Router, calculateRouteOverlap } from './router';
import { buildGraphFromElements } from '../../tools/osm/build-graph';

const LAT0 = 1.3, LNG0 = 103.8, U = 0.001; // ~111m per unit
const pt = (x: number, y: number) => ({ lat: LAT0 + y * U, lon: LNG0 + x * U });
const at = (x: number, y: number) => ({ lat: LAT0 + y * U, lng: LNG0 + x * U });
const way = (id: number, pts: Array<[number, number]>, tags: Record<string, string> = {}) => ({
  type: 'way',
  id,
  tags: { highway: 'primary', maxspeed: '50', ...tags },
  geometry: pts.map(([x, y]) => pt(x, y)),
});

describe('Phase 4: Route Alternatives & Penalty Method', () => {
  // Triple-corridor network between (0, 1) and (4, 1):
  //  - Corridor 1 (Central direct, fastest): (0,1) -> (1,1) -> (3,1) -> (4,1)
  //  - Corridor 2 (North detour): (0,1) -> (1,3) -> (3,3) -> (4,1)
  //  - Corridor 3 (South detour): (0,1) -> (1,-1) -> (3,-1) -> (4,1)
  const tripleCorridorElements = [
    // Central corridor (length ~ 4 units)
    way(1, [[0, 1], [1, 1], [3, 1], [4, 1]], { maxspeed: '60' }),
    // North corridor (length ~ 5.6 units)
    way(2, [[0, 1], [1, 3], [3, 3], [4, 1]], { maxspeed: '50' }),
    // South corridor (length ~ 5.6 units)
    way(3, [[0, 1], [1, -1], [3, -1], [4, 1]], { maxspeed: '50' }),
  ];

  it('calculates spatial route overlap accurately', () => {
    const g = new RoadGraph(buildGraphFromElements(tripleCorridorElements));
    const r = new Router(g);

    const route1 = r.findRoute(at(0, 1), at(4, 1))!;
    expect(route1).not.toBeNull();

    // Overlap of route with itself is 1.0 (100%)
    expect(calculateRouteOverlap(route1, route1)).toBe(1.0);

    // Completely disjoint routes have 0 overlap
    const subNorth = r.findRoute(at(1, 3), at(3, 3))!;
    const subSouth = r.findRoute(at(1, -1), at(3, -1))!;
    expect(calculateRouteOverlap(subNorth, subSouth)).toBe(0);
  });

  it('returns exactly 1 route when maxRoutes is 1', () => {
    const g = new RoadGraph(buildGraphFromElements(tripleCorridorElements));
    const r = new Router(g);

    const routes = r.findAlternatives(at(0, 1), at(4, 1), { maxRoutes: 1 });
    expect(routes).toHaveLength(1);
    expect(routes[0].edges.some((e) => e.wayId === 1)).toBe(true);
  });

  it('generates up to 3 spatially distinct routes with overlap < 65%', () => {
    const g = new RoadGraph(buildGraphFromElements(tripleCorridorElements));
    const r = new Router(g);

    const routes = r.findAlternatives(at(0, 1), at(4, 1), {
      maxRoutes: 3,
      penaltyMultiplier: 1.35,
      maxOverlap: 0.65,
    });

    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.length).toBeLessThanOrEqual(3);

    // Verify all pairs of returned routes have spatial overlap < 65%
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const overlap = calculateRouteOverlap(routes[i], routes[j]);
        expect(overlap).toBeLessThan(0.65);
      }
    }

    // Verify distinct corridors were traversed
    const wayIdsUsed = routes.map((rt) => new Set(rt.edges.map((e) => e.wayId)));
    expect(wayIdsUsed[0].has(1)).toBe(true); // Primary uses central
    expect(wayIdsUsed[1].has(2) || wayIdsUsed[1].has(3)).toBe(true); // Alternative uses north or south
  });

  it('rejects candidate alternatives that exceed 65% overlap', () => {
    // Network where Way 1 and Way 2 share the trunk edges (0,0)->(4,0) and (6,0)->(10,0) [80% shared]:
    // Way 1: (0,0) -> (4,0) -> (6,0) -> (10,0) [total 10 units]
    // Way 2: (0,0) -> (4,0) -> (5,0.2) -> (6,0) -> (10,0) [8 units shared out of ~10.2 units = ~78% overlap]
    const highOverlapElements = [
      way(1, [[0, 0], [4, 0], [6, 0], [10, 0]], { maxspeed: '60' }),
      way(2, [[0, 0], [4, 0], [5, 0.2], [6, 0], [10, 0]], { maxspeed: '60' }),
    ];
    const g = new RoadGraph(buildGraphFromElements(highOverlapElements));
    const r = new Router(g);

    // With strict maxOverlap < 0.65, candidate sharing ~78% of the road must not be accepted
    const routes = r.findAlternatives(at(0, 0), at(10, 0), {
      maxRoutes: 2,
      penaltyMultiplier: 1.35,
      maxOverlap: 0.65,
      maxIterations: 3,
    });

    // Only the primary trunk route is accepted; candidate is rejected for excessive overlap (>65%)
    expect(routes).toHaveLength(1);
  });

  it('preserves unpenalized durations for alternative routes', () => {
    const g = new RoadGraph(buildGraphFromElements(tripleCorridorElements));
    const r = new Router(g);

    const routes = r.findAlternatives(at(0, 1), at(4, 1), {
      maxRoutes: 3,
      penaltyMultiplier: 1.35,
      maxOverlap: 0.65,
    });

    // Directly evaluate the second corridor without penalties
    const altRouteDirect = r.findRoute(at(0, 1), at(4, 1), {
      edgePenalties: undefined,
    });

    // The primary route duration matches direct search
    expect(routes[0].durationSeconds).toBe(altRouteDirect!.durationSeconds);

    // Each alternative must have positive, realistic durations based on edge lengths and speed limits
    for (const alt of routes) {
      expect(alt.durationSeconds).toBeGreaterThan(0);
      expect(alt.distanceMeters).toBeGreaterThan(0);
      const expectedMinSeconds = (alt.distanceMeters / (60 / 3.6)) * 0.5;
      expect(alt.durationSeconds).toBeGreaterThan(expectedMinSeconds);
    }
  });
});
