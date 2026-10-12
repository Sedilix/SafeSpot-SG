/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * multiCriteria.test.ts: Unit tests for Phase 4 multi-criteria ranking:
 *  - Vehicle fuel model & Singapore speed consumption curve
 *  - Pareto dominance across Time, Money, and Risk
 *  - Objective evaluation and composite utility scoring
 *  - Archetype assignment ('fastest', 'cheapest', 'safest', 'balanced')
 */

import { describe, it, expect } from 'vitest';
import {
  calculateFuelLitres,
  calculateFuelCostSgd,
  evaluateObjectives,
  checkParetoDominance,
  rankRouteAlternatives,
  MultiCriteriaObjectives,
  calculateCompositeScore,
} from './multiCriteria';
import { RouteResult } from './router';

describe('Phase 4: Multi-Criteria Fuel Model', () => {
  it('models higher fuel consumption in stop-and-go traffic than cruising speed', () => {
    // 10 km trip
    const fuel15kmh = calculateFuelLitres(10, 15);
    const fuel60kmh = calculateFuelLitres(10, 60);
    const fuel90kmh = calculateFuelLitres(10, 90);

    // Stop-and-go (15 km/h) burns ~1.3 L per 10 km
    expect(fuel15kmh).toBeGreaterThan(1.0);
    // Cruising (60 km/h) is most efficient, burning ~0.65 L per 10 km
    expect(fuel60kmh).toBeLessThan(fuel15kmh);
    // Expressway (90 km/h) has wind resistance, slightly higher than 60 km/h
    expect(fuel90kmh).toBeGreaterThan(fuel60kmh);
    expect(fuel90kmh).toBeLessThan(fuel15kmh);
  });

  it('computes fuel cost in SGD at reference price $2.95/L', () => {
    const cost = calculateFuelCostSgd(20, 60); // ~1.3 L * $2.95
    expect(cost).toBeGreaterThan(3.5);
    expect(cost).toBeLessThan(4.5);
  });
});

describe('Phase 4: Pareto Dominance Evaluation', () => {
  const makeObj = (
    durationSeconds: number,
    totalMoneySgd: number,
    riskScore: number
  ): MultiCriteriaObjectives => ({
    durationSeconds,
    minutes: durationSeconds / 60,
    distanceMeters: 10000,
    km: 10.0,
    fuelLitres: 0.8,
    fuelSgd: 2.36,
    tollSgd: 0,
    tollStatus: 'known',
    totalMoneySgd,
    incidentPenalty: riskScore,
    incidentsEncountered: [],
    rainMm: 0,
    riskScore,
  });

  it('identifies strict dominance when route A is superior on all criteria', () => {
    // Route A: 600s, $2.00, Risk 0
    // Route B: 900s, $3.00, Risk 2.0
    const a = makeObj(600, 2.0, 0);
    const b = makeObj(900, 3.0, 2.0);

    const { aDominatesB, bDominatesA } = checkParetoDominance(a, b);
    expect(aDominatesB).toBe(true);
    expect(bDominatesA).toBe(false);
  });

  it('identifies mutually non-dominated trade-offs', () => {
    // Route A (Fast expressway): 600s, $5.00 (with ERP), Risk 0
    // Route B (Slower arterial): 900s, $2.50 (no toll), Risk 0
    const a = makeObj(600, 5.0, 0);
    const b = makeObj(900, 2.5, 0);

    const { aDominatesB, bDominatesA } = checkParetoDominance(a, b);
    expect(aDominatesB).toBe(false);
    expect(bDominatesA).toBe(false);
  });

  it('recognizes safety trade-offs (lower risk vs lower time)', () => {
    // Route A: 700s, $3.00, Risk 3.0 (accident on route)
    // Route B: 800s, $3.00, Risk 0.0 (clean route)
    const a = makeObj(700, 3.0, 3.0);
    const b = makeObj(800, 3.0, 0.0);

    const { aDominatesB, bDominatesA } = checkParetoDominance(a, b);
    expect(aDominatesB).toBe(false);
    expect(bDominatesA).toBe(false);
  });
});

describe('Phase 4: Objective Evaluation & Multi-Criteria Ranking', () => {
  const dummyRoute = (
    durationSec: number,
    distanceM: number,
    tollSgd: number = 0,
    incidents: string[] = []
  ): RouteResult => ({
    durationSeconds: durationSec,
    minutes: Number((durationSec / 60).toFixed(1)),
    distanceMeters: distanceM,
    km: Number((distanceM / 1000).toFixed(2)),
    edgeCount: 10,
    edges: [],
    snapStartMeters: 5,
    snapDestMeters: 5,
    totalTollSgd: tollSgd,
    tollStatus: tollSgd > 0 ? 'known' : 'known',
    incidentsEncountered: incidents,
  });

  it('evaluates objectives with live rain and incidents', () => {
    const route = dummyRoute(1200, 15000, 2.0, ['Accident on lane 2']);
    const obj = evaluateObjectives(route, { rainMm: 3.0 });

    expect(obj.durationSeconds).toBe(1200);
    expect(obj.minutes).toBe(20.0);
    expect(obj.tollSgd).toBe(2.0);
    expect(obj.totalMoneySgd).toBeGreaterThan(5.0); // Fuel (~$3.50) + ERP ($2.00)
    expect(obj.incidentPenalty).toBe(3.0); // Accident weight = 3.0
    expect(obj.rainMm).toBe(3.0);
    expect(obj.riskScore).toBe(4.5); // 3.0 + 3.0 * 0.5
  });

  it('assigns archetypes and orders routes sensibly', () => {
    // Route 1 (Fastest via expressway): 12 min, $6.00 (with ERP toll), Risk 0
    const r1 = dummyRoute(720, 14000, 3.0);
    // Route 2 (Cheapest via arterial): 18 min, $2.50 (no toll), Risk 0
    const r2 = dummyRoute(1080, 10000, 0);
    // Route 3 (Detour avoiding heavy rain): 16 min, $3.20, Risk 0 vs Risk on others
    const r3 = dummyRoute(960, 12000, 0);

    const ranked = rankRouteAlternatives([r1, r2, r3], { rainMm: 0 });

    expect(ranked).toHaveLength(3);
    const archetypes = ranked.map((r) => r.archetype);
    expect(archetypes).toContain('fastest');
    expect(archetypes).toContain('cheapest');

    // All routes are non-dominated Pareto trade-offs
    expect(ranked.every((r) => r.isNonDominated)).toBe(true);

    // Verify ranking sequence 1, 2, 3
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    // Composite score increases (best first)
    expect(ranked[0].compositeScore).toBeLessThanOrEqual(ranked[1].compositeScore);
    expect(ranked[1].compositeScore).toBeLessThanOrEqual(ranked[2].compositeScore);
  });
});
