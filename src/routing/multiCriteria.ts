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
// UNVERIFIED: Speed-dependent polynomial consumption formula (L/100 km = A + B/v + C * v^2)
// calibrated heuristically from probe observations:
//   ~13.2 L at 15 km/h stop-go traffic
//   ~6.5 L at 60 km/h cruising speed
//   ~8.9 L at 90 km/h expressway speed
export const FUEL_A = 3.2;
export const FUEL_B = 150;
export const FUEL_C = 0.0005;
// UNVERIFIED: Reference pump price of 95-octane petrol in Singapore ($2.95/L, approx. prevailing Oct 2026 pump price).
export const FUEL_PRICE_SGD_PER_L = 2.95;

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
 * Ranks candidate route alternatives using multi-criteria objectives.
 * Per ROUTING_PLAN.md §8 E5 & E6:
 *  - Drops candidates > 1.5x the fastest route's duration (excessive detours).
 *  - Strictly drops all Pareto-dominated candidates on (time, money, risk).
 *  - Returns up to 3 non-dominated survivors (returns 1 if only 1 survives).
 *  - Labels archetypes strictly from survivors; never labels "balanced" simply because it's not first.
 *  - Displays money honestly as "fuel $X + ERP unknown" when ERP is unconfigured.
 *  - Does NOT label any route "cheapest" when ERP is unknown and fuel difference is < $0.50.
 */
export function rankRouteAlternatives(
  routes: RouteResult[],
  options?: {
    weather?: WeatherAssessment;
    rainMm?: number;
  }
): MultiCriteriaRoute[] {
  if (routes.length === 0) return [];

  // 1. Filter out useless detours > 1.5x fastest route's duration
  const fastestDuration = routes[0].durationSeconds;
  const viable = routes.filter((r) => r.durationSeconds <= fastestDuration * 1.5);
  if (viable.length === 0) return [];

  // 2. Evaluate objectives for all viable candidate routes
  const candidates = viable.map((route) => ({
    route,
    objectives: evaluateObjectives(route, options),
    compositeScore: 0,
    isDominated: false,
  }));

  for (const c of candidates) {
    c.compositeScore = calculateCompositeScore(c.objectives);
  }

  // 3. Drop all Pareto-dominated candidates on (time, money, risk)
  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const { bDominatesA } = checkParetoDominance(candidates[i].objectives, candidates[j].objectives);
      if (bDominatesA) {
        candidates[i].isDominated = true;
        break;
      }
    }
  }

  // Retain only non-dominated survivors (up to 3)
  const survivors = candidates.filter((c) => !c.isDominated).slice(0, 3);
  if (survivors.length === 0) {
    // Safety fallback: if all were somehow filtered, retain the fastest primary route
    survivors.push(candidates[0]);
  }

  // 4. Label archetypes ONLY from non-dominated survivors
  const archetypes: RouteArchetype[] = new Array(survivors.length).fill('balanced');

  // Identify index of fastest survivor
  let fastestIdx = 0;
  for (let i = 1; i < survivors.length; i++) {
    if (survivors[i].objectives.durationSeconds < survivors[fastestIdx].objectives.durationSeconds) {
      fastestIdx = i;
    }
  }
  archetypes[fastestIdx] = 'fastest';

  // Check for genuine "cheapest" route per E6
  let cheapestIdx = -1;
  let minMoney = survivors[fastestIdx].objectives.totalMoneySgd;
  for (let i = 0; i < survivors.length; i++) {
    if (i === fastestIdx) continue;
    const o = survivors[i].objectives;
    if (o.totalMoneySgd < minMoney) {
      // If ERP is unknown, only label cheapest if fuel difference is >= $0.50
      const moneyDiff = minMoney - o.totalMoneySgd;
      if (o.tollStatus === 'known' || moneyDiff >= 0.50) {
        cheapestIdx = i;
        minMoney = o.totalMoneySgd;
      }
    }
  }
  if (cheapestIdx >= 0) {
    archetypes[cheapestIdx] = 'cheapest';
  }

  // Check for genuine "safest" route
  let safestIdx = -1;
  let minRisk = survivors[fastestIdx].objectives.riskScore;
  for (let i = 0; i < survivors.length; i++) {
    if (i === fastestIdx || i === cheapestIdx) continue;
    const o = survivors[i].objectives;
    if (o.riskScore < minRisk) {
      safestIdx = i;
      minRisk = o.riskScore;
    }
  }
  if (safestIdx >= 0) {
    archetypes[safestIdx] = 'safest';
  }

  // For any remaining survivor: only label 'balanced' if there are multiple routes and it provides
  // an intermediate trade-off. If there is only 1 survivor, it is strictly 'fastest'.
  if (survivors.length === 1) {
    archetypes[0] = 'fastest';
  }

  // 5. Construct results and sort by composite utility
  const ranked = survivors.map((item, index) => {
    const o = item.objectives;
    const arch = archetypes[index];

    let tradeoffSummary = `${o.minutes} min`;
    if (o.tollStatus === 'unknown') {
      tradeoffSummary += ` • fuel $${o.fuelSgd.toFixed(2)} + ERP unknown`;
    } else {
      tradeoffSummary += ` • $${o.totalMoneySgd.toFixed(2)}`;
      if (o.tollSgd > 0) tradeoffSummary += ` (incl. $${o.tollSgd.toFixed(2)} ERP)`;
    }
    if (o.riskScore > 0) tradeoffSummary += ` • Risk ${o.riskScore}`;

    return {
      route: item.route,
      rank: 0, // Will be set after sorting
      objectives: o,
      isNonDominated: true,
      archetype: arch,
      compositeScore: item.compositeScore,
      tradeoffSummary,
    };
  });

  ranked.sort((a, b) => a.compositeScore - b.compositeScore);
  for (let i = 0; i < ranked.length; i++) {
    ranked[i].rank = i + 1;
  }

  return ranked;
}
