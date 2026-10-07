/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * router-phase2.test.ts: Unit tests for Phase 2 features:
 *  - Time-dependent arrival speeds (SpeedProfileEngine)
 *  - Road closures / incidents (IncidentLayer)
 *  - ERP gantry tariff bucket matching at 08:29 vs 08:31 & directional charging
 *  - Bus lane kerbside stopping rules
 */

import { describe, it, expect } from 'vitest';
import { RoadGraph, CompactEdge } from './graph';
import { Router } from './router';
import { ErpEngine, ACTIVE_ERP_GANTRIES, ErpGantry } from './erp';
import { IncidentLayer, TrafficIncident } from './incidents';
import { SpeedProfileEngine } from './speedProfiles';
import { buildGraphFromElements } from '../../tools/osm/build-graph';

const LAT0 = 1.3, LNG0 = 103.8, U = 0.0009;
const pt = (x: number, y: number) => ({ lat: LAT0 + y * U, lon: LNG0 + x * U });
const at = (x: number, y: number) => ({ lat: LAT0 + y * U, lng: LNG0 + x * U });
const way = (id: number, pts: Array<[number, number]>, tags: Record<string, string> = {}) => ({
  type: 'way', id, tags: { highway: 'residential', maxspeed: '50', ...tags }, geometry: pts.map(([x, y]) => pt(x, y)),
});

describe('Phase 2: ERP Gantry Tariff Evaluation', () => {
  const erp = new ErpEngine();
  const cteGantry = ACTIVE_ERP_GANTRIES.find((g) => g.id === 'CTE-1')!;

  it('charges the correct tariff bucket at 08:29 vs 08:31 on a weekday', () => {
    // 2026-10-08 is a Thursday (SGT is UTC+8, so 08:29 SGT is 00:29 UTC)
    const time0829 = new Date('2026-10-08T08:29:00+08:00');
    const time0831 = new Date('2026-10-08T08:31:00+08:00');

    // Driving Southbound (bearing 190 deg, aligned with CTE-1)
    const charge0829 = erp.evaluateGantryCharge(cteGantry, time0829, 190);
    const charge0831 = erp.evaluateGantryCharge(cteGantry, time0831, 190);

    // Rate schedule for CTE-1:
    // 08:00-08:30 => $3.00
    // 08:30-09:00 => $4.00
    expect(charge0829).toBe(3.0);
    expect(charge0831).toBe(4.0);
  });

  it('does not charge when driving in the opposing direction (northbound through southbound gantry)', () => {
    const time0830 = new Date('2026-10-08T08:30:00+08:00');
    // Driving Northbound (bearing 10 deg) through a Southbound gantry (bearing 190 deg)
    const chargeOpposing = erp.evaluateGantryCharge(cteGantry, time0830, 10);
    expect(chargeOpposing).toBe(0.0);
  });

  it('does not charge on Sundays (free-flow)', () => {
    const sunday0830 = new Date('2026-10-11T08:30:00+08:00'); // Sunday
    const chargeSunday = erp.evaluateGantryCharge(cteGantry, sunday0830, 190);
    expect(chargeSunday).toBe(0.0);
  });
});

describe('Phase 2: Live Incident Layer & Road Closures', () => {
  // Simple diamond graph:
  // Way 1: (0,0) -> (1,0) (direct path)
  // Way 2: (0,0) -> (0,1) -> (1,1) -> (1,0) (detour path)
  const diamondElements = [
    way(1, [[0, 0], [1, 0]], { highway: 'primary' }),
    way(2, [[0, 0], [0, 1], [1, 1], [1, 0]], { highway: 'primary' }),
  ];

  it('uses the direct route when there are no closures', () => {
    const g = new RoadGraph(buildGraphFromElements(diamondElements));
    const r = new Router(g);
    const res = r.findRoute(at(0, 0), at(1, 0));
    expect(res).not.toBeNull();
    expect(res!.edges.some((e) => e.wayId === 1)).toBe(true);
  });

  it('strictly avoids a closed edge when a Road Block / Closure incident is present', () => {
    const g = new RoadGraph(buildGraphFromElements(diamondElements));
    const r = new Router(g);

    // Place a Road Block incident right on the direct path way 1 (at midpoint x=0.5, y=0)
    const incidentLayer = new IncidentLayer([
      {
        type: 'Road Block',
        lat: LAT0,
        lng: LNG0 + 0.5 * U,
        message: 'Road closed for emergency repairs',
        timestamp: Date.now(),
      },
    ]);

    const res = r.findRoute(at(0, 0), at(1, 0), { incidents: incidentLayer });
    expect(res).not.toBeNull();
    // The closed direct way 1 must NEVER be used
    expect(res!.edges.some((e) => e.wayId === 1)).toBe(false);
    // The detour way 2 must be taken instead
    expect(res!.edges.some((e) => e.wayId === 2)).toBe(true);
  });

  it('adds decaying delay for an accident', () => {
    const incidents = new IncidentLayer([
      {
        type: 'Accident',
        lat: LAT0,
        lng: LNG0 + 0.5 * U,
        message: 'Accident on lane 1',
        timestamp: Date.now() - 30 * 60 * 1000, // 30 min old
      },
    ]);

    const impact = incidents.evaluateEdgeImpact(LAT0, LNG0, LAT0, LNG0 + U, new Date());
    expect(impact.impassable).toBe(false);
    // 30 min old accident decay factor is ~0.5, base 180s => ~90s delay
    expect(impact.delaySec).toBeGreaterThan(50);
    expect(impact.delaySec).toBeLessThan(150);
  });

  it('correctly identifies bus lane active hours for kerbside stopping', () => {
    const normalTag = 'bus:lanes:conditional = designated @ (Mo-Fr 07:30-09:30, 17:00-20:00)';
    const weekdayPeak = new Date('2026-10-08T08:30:00+08:00'); // Thursday 08:30
    const weekdayOffpeak = new Date('2026-10-08T12:00:00+08:00'); // Thursday 12:00
    const sundayPeakTime = new Date('2026-10-11T08:30:00+08:00'); // Sunday 08:30

    expect(IncidentLayer.isKerbsideStoppingProhibited(normalTag, weekdayPeak)).toBe(true);
    expect(IncidentLayer.isKerbsideStoppingProhibited(normalTag, weekdayOffpeak)).toBe(false);
    expect(IncidentLayer.isKerbsideStoppingProhibited(normalTag, sundayPeakTime)).toBe(false);
  });
});

describe('Phase 2: Speed Profiles and Regulatory Overlays', () => {
  const profileEngine = new SpeedProfileEngine();

  it('applies Enhanced School Zone 40 km/h all-day cap', () => {
    const schoolEdge: CompactEdge = {
      id: 101,
      from: 0,
      to: 1,
      length: 500,
      maxspeed: 50,
      seconds: 36,
      wayId: 10,
      name: 'Primary School Zone Link',
      highway: 'residential',
      oneway: false,
    };

    const speed = profileEngine.getEffectiveSpeed(schoolEdge, new Date('2026-10-08T14:00:00+08:00'));
    expect(speed).toBeLessThanOrEqual(40);
  });

  it('applies time-dependent morning peak congestion on expressways', () => {
    const expresswayEdge: CompactEdge = {
      id: 202,
      from: 0,
      to: 1,
      length: 1000,
      maxspeed: 90,
      seconds: 52.9, // calibrated base 68 km/h
      wayId: 20,
      name: 'Central Expressway',
      highway: 'motorway',
      oneway: true,
    };

    const morningPeak = new Date('2026-10-08T08:30:00+08:00'); // Thu 08:30
    const nightOffpeak = new Date('2026-10-08T23:00:00+08:00'); // Thu 23:00

    // Southbound inbound toward city (bearing 190)
    const peakSpeed = profileEngine.getEffectiveSpeed(expresswayEdge, morningPeak, 190);
    const offpeakSpeed = profileEngine.getEffectiveSpeed(expresswayEdge, nightOffpeak, 190);

    expect(peakSpeed).toBeLessThan(offpeakSpeed);
    expect(peakSpeed).toBeLessThan(50); // Congested in morning peak
  });
});
