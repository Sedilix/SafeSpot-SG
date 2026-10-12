/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * multiCriteria.ts: Multi-criteria ranking and Pareto evaluation (Phase 4).
 *
 * Evaluates alternative driving routes on THREE distinct objectives:
 *  1. Time: Duration in seconds and minutes (time-dependent speed profiles & delays).
 *  2. Money: Fuel consumption model + ERP tolls in SGD.
 *  3. Risk: Live traffic incident penalties + NEA tropical rainfall hazards.
 *
 * Provides Pareto non-dominated frontier evaluation and trade-off archetypes:
 *  - 'fastest': Minimum travel time.
 *  - 'cheapest': Minimum total monetary cost (fuel + tolls).
 *  - 'safest': Minimum hazard risk (incidents + tropical downpours).
 *  - 'balanced': Best composite utility compromise.
 */

import { RouteResult } from './router';
import { WeatherAssessment } from './weather';

// ── Fuel Consumption Model (Speed-Dependent Curve) ──────────────────────────
// Calibrated from Singapore probe observations:
// L/100 km = A + B/v + C * v^2 where v is speed in km/h:
//   ~13.2 L at 15 km/h stop-go traffic
//   ~6.5 L at 60 km/h cruising speed
//   ~8.9 L at 90 km/h expressway speed
export const FUEL_A = 3.2;
export const FUEL_B = 150;
export const FUEL_C = 0.0005;
export const FUEL_PRICE_SGD_PER_L = 2.95; // Singapore 95-octane petrol reference price

export function calculateFuelLitres(distanceKm: number, averageSpeedKmh: number): number {
  const v = Math.max(10, Math.min(110, averageSpeedKmh));
  const l100 = FUEL_A + FUEL_B / v + FUEL_C * v * v;
  return Number(((distanceKm / 100) * l100).toFixed(3));
}

export function calculateFuelCostSgd(distanceKm: number, averageSpeedKmh: number): number {
  const litres = calculateFuelLitres(distanceKm, averageSpeedKmh);
  return Number((litres * FUEL_PRICE_SGD_PER_L).toFixed(2));
}

// ── Risk & Hazard Model ─────────────────────────────────────────────────────
export const INCIDENT_RISK_WEIGHTS: Record<string, number> = {
  'Accident': 3.0,
  'Road Block': 4.0,
  'Road Closure': 4.0,
  'Vehicle breakdown': 1.5,
  'Road Works': 1.0,
  'Heavy Traffic': 0.5,
};

export const RAIN_RISK_PER_MM = 0.5; // Tropical downpour hazard factor per mm of 5-min rainfall

export interface MultiCriteriaObjectives {
  // Objective 1: Time
  durationSeconds: number;
  minutes: number;
  distanceMeters: number;
  km: number;

  // Objective 2: Money (Fuel + ERP)
  fuelLitres: number;
  fuelSgd: number;
  tollSgd: number;
  tollStatus: 'known' | 'unknown';
  totalMoneySgd: number;

  // Objective 3: Risk (Incidents + Rain)
  incidentPenalty: number;
  incidentsEncountered: string[];
  rainMm: number;
  riskScore: number;
}

export type RouteArchetype = 'fastest' | 'cheapest' | 'safest' | 'balanced';

export interface MultiCriteriaRoute {
  route: RouteResult;
  rank: number;
  objectives: MultiCriteriaObjectives;
  isNonDominated: boolean;
  archetype: RouteArchetype;
  compositeScore: number; // Lower is better
  tradeoffSummary: string;
}

/**
 * Evaluates the three objectives for a single route.
 */
export function evaluateObjectives(
  route: RouteResult,
  options?: {
    weather?: WeatherAssessment;
    rainMm?: number;
  }
): MultiCriteriaObjectives {
  const km = route.km;
  const minutes = route.minutes;
  const avgSpeedKmh = minutes > 0 ? (km / (minutes / 60)) : 50;

  const fuelLitres = calculateFuelLitres(km, avgSpeedKmh);
  const fuelSgd = calculateFuelCostSgd(km, avgSpeedKmh);
  const tollSgd = route.totalTollSgd ?? 0;
  const tollStatus = route.tollStatus ?? 'unknown';
  const totalMoneySgd = Number((fuelSgd + tollSgd).toFixed(2));

  // Incident penalty
  let incidentPenalty = 0;
  const incidents = route.incidentsEncountered ?? [];
  for (const inc of incidents) {
    let matchedWeight = 1.0;
    for (const [type, weight] of Object.entries(INCIDENT_RISK_WEIGHTS)) {
      if (inc.toLowerCase().includes(type.toLowerCase())) {
        matchedWeight = weight;
        break;
      }
    }
    incidentPenalty += matchedWeight;
  }

  // Weather risk
  const rainMm = options?.rainMm ?? options?.weather?.rainfallMm ?? 0;
  const rainRisk = rainMm * RAIN_RISK_PER_MM;
  const riskScore = Number((incidentPenalty + rainRisk).toFixed(2));

  return {
    durationSeconds: route.durationSeconds,
    minutes,
    distanceMeters: route.distanceMeters,
    km,
    fuelLitres,
    fuelSgd,
    tollSgd,
    tollStatus,
    totalMoneySgd,
    incidentPenalty,
    incidentsEncountered: incidents,
    rainMm,
    riskScore,
  };
}

/**
 * Evaluates Pareto dominance between two routes across the 3 objectives:
 *  - Time (durationSeconds)
 *  - Money (totalMoneySgd)
 *  - Risk (riskScore)
 */
export function checkParetoDominance(
  a: MultiCriteriaObjectives,
  b: MultiCriteriaObjectives
): { aDominatesB: boolean; bDominatesA: boolean } {
  const aNoWorseThanB =
    a.durationSeconds <= b.durationSeconds &&
    a.totalMoneySgd <= b.totalMoneySgd &&
    a.riskScore <= b.riskScore;

  const aStrictlyBetterInAny =
    a.durationSeconds < b.durationSeconds ||
    a.totalMoneySgd < b.totalMoneySgd ||
    a.riskScore < b.riskScore;

  const aDominatesB = aNoWorseThanB && aStrictlyBetterInAny;

  const bNoWorseThanA =
    b.durationSeconds <= a.durationSeconds &&
    b.totalMoneySgd <= a.totalMoneySgd &&
    b.riskScore <= a.riskScore;

  const bStrictlyBetterInAny =
    b.durationSeconds < a.durationSeconds ||
    b.totalMoneySgd < a.totalMoneySgd ||
    b.riskScore < a.riskScore;

  const bDominatesA = bNoWorseThanA && bStrictlyBetterInAny;

  return { aDominatesB, bDominatesA };
}

/**
 * Calculates a composite utility score using Singapore value of travel time ($18/hr = $0.30/min).
 * Score = Minutes + (Money / 0.30) + Risk * 2.0.
 * Lower score is better.
 */
export function calculateCompositeScore(obj: MultiCriteriaObjectives): number {
  const timeComponent = obj.minutes;
  const moneyComponent = obj.totalMoneySgd / 0.30;
  const riskComponent = obj.riskScore * 2.0;
  return Number((timeComponent + moneyComponent + riskComponent).toFixed(2));
}

/**
 * Ranks a set of candidate route alternatives (up to 3 routes) using multi-criteria objectives.
 * Marks Pareto non-dominated routes, assigns archetypes, and sorts by overall utility.
 */
export function rankRouteAlternatives(
  routes: RouteResult[],
  options?: {
    weather?: WeatherAssessment;
    rainMm?: number;
  }
): MultiCriteriaRoute[] {
  if (routes.length === 0) return [];

  // 1. Evaluate objectives for each route
  const evaluated = routes.map((route) => ({
    route,
    objectives: evaluateObjectives(route, options),
    compositeScore: 0,
    isNonDominated: true,
    archetype: 'balanced' as RouteArchetype,
  }));

  for (const item of evaluated) {
    item.compositeScore = calculateCompositeScore(item.objectives);
  }

  // 2. Identify Pareto dominance across all pairs
  for (let i = 0; i < evaluated.length; i++) {
    for (let j = 0; j < evaluated.length; j++) {
      if (i === j) continue;
      const { bDominatesA } = checkParetoDominance(evaluated[i].objectives, evaluated[j].objectives);
      if (bDominatesA) {
        evaluated[i].isNonDominated = false;
        break;
      }
    }
  }

  // 3. Find extreme objective performers for archetype labeling
  let minTimeIdx = 0;
  let minMoneyIdx = 0;
  let minRiskIdx = 0;

  for (let i = 1; i < evaluated.length; i++) {
    if (evaluated[i].objectives.durationSeconds < evaluated[minTimeIdx].objectives.durationSeconds) {
      minTimeIdx = i;
    }
    if (evaluated[i].objectives.totalMoneySgd < evaluated[minMoneyIdx].objectives.totalMoneySgd) {
      minMoneyIdx = i;
    }
    if (evaluated[i].objectives.riskScore < evaluated[minRiskIdx].objectives.riskScore) {
      minRiskIdx = i;
    }
  }

  evaluated[minTimeIdx].archetype = 'fastest';
  if (minMoneyIdx !== minTimeIdx) {
    evaluated[minMoneyIdx].archetype = 'cheapest';
  }
  if (minRiskIdx !== minTimeIdx && minRiskIdx !== minMoneyIdx) {
    evaluated[minRiskIdx].archetype = 'safest';
  }

  // 4. Sort by composite score (rank 1, 2, 3)
  evaluated.sort((a, b) => a.compositeScore - b.compositeScore);

  return evaluated.map((item, index) => {
    const o = item.objectives;
    let tradeoffSummary = `${o.minutes} min • $${o.totalMoneySgd.toFixed(2)}`;
    if (o.tollSgd > 0) tradeoffSummary += ` (incl. $${o.tollSgd.toFixed(2)} ERP)`;
    if (o.riskScore > 0) tradeoffSummary += ` • Risk ${o.riskScore}`;

    return {
      route: item.route,
      rank: index + 1,
      objectives: o,
      isNonDominated: item.isNonDominated,
      archetype: item.archetype,
      compositeScore: item.compositeScore,
      tradeoffSummary,
    };
  });
}
