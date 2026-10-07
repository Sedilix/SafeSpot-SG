import { describe, it, expect } from 'vitest';
import { RoadGraph, CompactEdge } from './graph';
import { Router } from './router';
import { buildGraphFromElements } from '../../tools/osm/build-graph';

// Local grid: 1 unit = 100 m. x east, y north. Overpass-style elements feed the real graph builder.
const LAT0 = 1.3, LNG0 = 103.8, U = 0.0009;
const pt = (x: number, y: number) => ({ lat: LAT0 + y * U, lon: LNG0 + x * U });
const at = (x: number, y: number) => ({ lat: LAT0 + y * U, lng: LNG0 + x * U });
const way = (id: number, pts: Array<[number, number]>, tags: Record<string, string> = {}) => ({
  type: 'way', id, tags: { highway: 'residential', maxspeed: '50', ...tags }, geometry: pts.map(([x, y]) => pt(x, y)),
});
const restriction = (type: string, from: number, to: number, via: [number, number]) => ({
  type: 'relation', tags: { type: 'restriction', restriction: type },
  members: [{ type: 'way', ref: from, role: 'from' }, { type: 'way', ref: to, role: 'to' }, { type: 'node', ref: 1, role: 'via', ...pt(via[0], via[1]) }],
});
const make = (els: any[]) => { const g = new RoadGraph(buildGraphFromElements(els)); return { g, r: new Router(g) }; };
const nodeAt = (g: RoadGraph, x: number, y: number) =>
  g.nodes.find((n) => Math.abs(n.lat - (LAT0 + y * U)) < 2e-6 && Math.abs(n.lng - (LNG0 + x * U)) < 2e-6)!.id;
const edge = (g: RoadGraph, wayId: number, a: [number, number], b: [number, number]): CompactEdge =>
  g.edges.find((e) => e.wayId === wayId && e.from === nodeAt(g, ...a) && e.to === nodeAt(g, ...b))!;
const wayIds = (edges: CompactEdge[]) => edges.map((e) => e.wayId);

// Four-way junction at (1,0), ways split at the junction like OSM does.
const cross = () => [
  way(11, [[0, 0], [1, 0]]), way(12, [[1, 0], [2, 0]]),
  way(21, [[1, 0], [1, 1]]), way(22, [[1, 0], [1, -1]]),
];

describe('turn delays', () => {
  const { g, r } = make(cross());
  const inbound = () => edge(g, 11, [0, 0], [1, 0]);

  it('left-hand traffic: left 5s, straight 2s, right 18s at a junction', () => {
    expect(r.evaluateTurn(inbound(), edge(g, 21, [1, 0], [1, 1]))).toEqual({ allowed: true, delaySec: Router.DELAY_LEFT_SEC });
    expect(r.evaluateTurn(inbound(), edge(g, 12, [1, 0], [2, 0]))).toEqual({ allowed: true, delaySec: Router.DELAY_STRAIGHT_SEC });
    expect(r.evaluateTurn(inbound(), edge(g, 22, [1, 0], [1, -1]))).toEqual({ allowed: true, delaySec: Router.DELAY_RIGHT_SEC });
  });

  it('adds no delay along a bend (a non-junction node)', () => {
    const bend = make([way(1, [[0, 0], [1, 0], [1.6, 0.6], [2.2, 0.6], [3, 0]])]);
    const res = bend.r.findRoute(at(0.2, 0), at(2.8, 0.1))!;
    const sum = res.edges.reduce((s, e) => s + e.seconds, 0) - 0.5 * res.edges[0].seconds - 0.5 * res.edges[res.edges.length - 1].seconds;
    expect(Math.abs(res.durationSeconds - sum)).toBeLessThan(1);
  });
});

describe('turn restrictions (matched on from-way, via-node, to-way)', () => {
  const extra = [way(3, [[0, 0], [0, -2], [1, -2], [1, -1]])]; // bypass round to the south arm
  const origin = at(0.5, 0), dest = at(1, -0.5);

  it('control: without the restriction the router turns right at the junction', () => {
    const { r } = make([...cross(), ...extra]);
    const res = r.findRoute(origin, dest)!;
    expect(res).not.toBeNull();
    const ids = wayIds(res.edges);
    expect(ids.some((id, i) => id === 11 && ids[i + 1] === 22)).toBe(true);
  });

  it('no_right_turn forces a longer legal detour (and the route still exists)', () => {
    const control = make([...cross(), ...extra]).r.findRoute(origin, dest)!;
    const { r } = make([...cross(), ...extra, restriction('no_right_turn', 11, 22, [1, 0])]);
    const res = r.findRoute(origin, dest)!;
    expect(res).not.toBeNull();
    const ids = wayIds(res.edges);
    expect(ids.some((id, i) => id === 11 && ids[i + 1] === 22)).toBe(false);
    expect(res.durationSeconds).toBeGreaterThan(control.durationSeconds);
  });

  it('only_straight_on bans every other exit from the from-way', () => {
    const { g, r } = make([...cross(), restriction('only_straight_on', 11, 12, [1, 0])]);
    const inbound = edge(g, 11, [0, 0], [1, 0]);
    expect(r.evaluateTurn(inbound, edge(g, 12, [1, 0], [2, 0])).allowed).toBe(true);
    expect(r.evaluateTurn(inbound, edge(g, 21, [1, 0], [1, 1])).allowed).toBe(false);
    expect(r.evaluateTurn(inbound, edge(g, 22, [1, 0], [1, -1])).allowed).toBe(false);
  });

  it('does not apply a restriction at a different via node', () => {
    const { g, r } = make([...cross(), restriction('no_right_turn', 11, 22, [5, 5])]);
    // via (5,5) is not in the graph: dropped, so the turn stays legal
    expect(r.evaluateTurn(edge(g, 11, [0, 0], [1, 0]), edge(g, 22, [1, 0], [1, -1])).allowed).toBe(true);
  });
});

describe('one-way streets and U-turns', () => {
  it('never drives against a one-way street and takes the detour instead', () => {
    const { g, r } = make([
      way(1, [[0, 0], [1, 0], [2, 0]], { oneway: 'yes' }), // eastbound only
      way(2, [[2, 0], [2, 1], [0, 1], [0, 0]]),            // two-way ring road
    ]);
    const res = r.findRoute(at(2, 0.05), at(0, 0.05))!; // westbound
    expect(res).not.toBeNull();
    for (const e of res.edges.filter((x) => x.wayId === 1)) {
      expect(g.nodes[e.to].lng).toBeGreaterThan(g.nodes[e.from].lng); // only ever eastbound
    }
    expect(res.distanceMeters).toBeGreaterThan(250); // direct would be ~200 m
  });

  it('offers a U-turn only at a dead end', () => {
    const { g, r } = make([way(1, [[0, 0], [1, 0], [2, 0]]), way(2, [[1, 0], [1, 1]])]);
    const toJunction = edge(g, 1, [0, 0], [1, 0]);
    expect(r.evaluateTurn(toJunction, edge(g, 1, [1, 0], [0, 0])).allowed).toBe(false); // exits exist
    const toDeadEnd = edge(g, 1, [1, 0], [2, 0]);
    expect(r.evaluateTurn(toDeadEnd, edge(g, 1, [2, 0], [1, 0]))).toEqual({ allowed: true, delaySec: Router.DELAY_UTURN_SEC });
  });

  it('can start in either direction on a two-way segment', () => {
    const { r } = make([way(1, [[0, 0], [1, 0], [2, 0]]), way(2, [[0, 0], [0, 1]])]);
    expect(r.findRoute(at(1.5, 0.02), at(0, 0.5))).not.toBeNull();
    expect(r.findRoute(at(0.5, 0.02), at(1.9, 0))).not.toBeNull();
  });
});

describe('regressions found in the Phase 1 audit', () => {
  it('routes along a long chain of short segments (Float32 rounding used to drop labels)', () => {
    const pts: Array<[number, number]> = Array.from({ length: 400 }, (_, i) => [i * 0.2, 0] as [number, number]);
    const { r } = make([way(1, pts)]);
    const res = r.findRoute(at(0.05, 0), at(79, 0))!;
    expect(res).not.toBeNull();
    expect(res.km).toBeGreaterThan(7.5);
  });

  it('keeps sub-metre segments so the way stays connected', () => {
    const els = [{ type: 'way', id: 1, tags: { highway: 'residential', maxspeed: '50' }, geometry: [
      { lat: 1.3, lon: 103.8 }, { lat: 1.3, lon: 103.8009 }, { lat: 1.3, lon: 103.800903 }, { lat: 1.3, lon: 103.8018 },
    ] }];
    const { g, r } = make(els);
    expect(g.edges.length).toBe(6); // 3 segments x 2 directions, none dropped
    expect(r.findRoute({ lat: 1.3, lng: 103.8 }, { lat: 1.3, lng: 103.8018 })).not.toBeNull();
  });

  it('never snaps a pickup point onto a motorway', () => {
    const { g } = make([way(1, [[0, 0], [2, 0]], { highway: 'motorway', oneway: 'yes' }), way(2, [[0, 0.3], [2, 0.3]])]);
    const snap = g.findNearestSegment(LAT0 + 0.1 * U, LNG0 + 1 * U)!;
    expect(snap.edges.every((e) => e.highway === 'residential')).toBe(true);
  });
});
