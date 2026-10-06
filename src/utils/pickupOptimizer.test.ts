/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  rankPickups,
  dedupeCandidates,
  nearbyCandidates,
  PickupCandidate,
  RouteLeg,
  SENIOR_WALK_FACTOR,
  KERBSIDE_PENALTY_SECONDS,
} from './pickupOptimizer';

const origin = { lat: 1.3327, lng: 103.8479 };
const stand = (id: string, lat: number, lng: number, extra: Partial<PickupCandidate> = {}): PickupCandidate => ({
  id, kind: 'taxi_stand', name: id, lat, lng, barrierFree: true, ...extra,
});
const legs = (entries: Array<[string, RouteLeg | null]>) => new Map(entries);

describe('rankPickups', () => {
  it('ranks by real walking time, not straight-line distance', () => {
    const near = stand('near-but-long-walk', 1.3329, 103.8481); // ~30 m away
    const far = stand('far-but-direct', 1.3340, 103.8479); // ~145 m away
    const ranked = rankPickups({
      origin,
      candidates: [near, far],
      walk: legs([['near-but-long-walk', { seconds: 400, meters: 520 }], ['far-but-direct', { seconds: 120, meters: 150 }]]),
    });
    expect(ranked.map((r) => r.id)).toEqual(['far-but-direct', 'near-but-long-walk']);
    expect(ranked[1].straightLineMeters).toBeLessThan(ranked[0].straightLineMeters);
  });

  it('uses the slower of walking and driving, since both travel at once', () => {
    const a = stand('a', 1.333, 103.848);
    const ranked = rankPickups({
      origin,
      candidates: [a],
      walk: legs([['a', { seconds: 100, meters: 120 }]]),
      drive: legs([['a', { seconds: 400, meters: 2000 }]]),
    });
    expect(ranked[0].seniorWalkSeconds).toBe(100 * SENIOR_WALK_FACTOR);
    expect(ranked[0].meetSeconds).toBe(400);
  });

  it('prefers a stand the driver reaches sooner when walks are similar', () => {
    const a = stand('a', 1.333, 103.848);
    const b = stand('b', 1.3332, 103.8482);
    const ranked = rankPickups({
      origin,
      candidates: [a, b],
      walk: legs([['a', { seconds: 120, meters: 150 }], ['b', { seconds: 130, meters: 160 }]]),
      drive: legs([['a', { seconds: 900, meters: 6000 }], ['b', { seconds: 300, meters: 2000 }]]), // a needs a long U-turn
    });
    expect(ranked[0].id).toBe('b');
  });

  it('penalises kerbside points and stands without barrier-free access', () => {
    const kerb: PickupCandidate = { id: 'kerb', kind: 'kerbside', name: 'kerb', lat: 1.333, lng: 103.848 };
    const steps = stand('steps', 1.3331, 103.8481, { barrierFree: false });
    const ok = stand('ok', 1.3332, 103.8482);
    const ranked = rankPickups({
      origin,
      candidates: [kerb, steps, ok],
      walk: legs([['kerb', { seconds: 100, meters: 120 }], ['steps', { seconds: 100, meters: 120 }], ['ok', { seconds: 100, meters: 120 }]]),
    });
    expect(ranked.map((r) => r.id)).toEqual(['ok', 'steps', 'kerb']);
    expect(ranked[2].score - ranked[0].score).toBe(KERBSIDE_PENALTY_SECONDS);
    expect(ranked[2].reasons).toContain('Not a designated taxi stop');
  });

  it('drops unreachable points and walks too long for a senior', () => {
    const ranked = rankPickups({
      origin,
      candidates: [stand('no-route', 1.333, 103.848), stand('too-far', 1.34, 103.85), stand('ok', 1.3331, 103.8481)],
      walk: legs([['no-route', null], ['too-far', { seconds: 500, meters: 650 }], ['ok', { seconds: 90, meters: 100 }]]), // 500 s x 1.5 > 10 min
    });
    expect(ranked.map((r) => r.id)).toEqual(['ok']);
  });

  it('never counts a walk shorter than the straight line (routing snaps the start)', () => {
    const kerb: PickupCandidate = { id: 'kerb', kind: 'kerbside', name: 'kerb', lat: 1.33328, lng: 103.84790 }; // ~64 m north
    const [r] = rankPickups({ origin, candidates: [kerb], walk: legs([['kerb', { seconds: 5, meters: 7 }]]) });
    expect(r.walkMeters).toBe(r.straightLineMeters);
    expect(r.walkMeters).toBeGreaterThanOrEqual(60);
    expect(r.seniorWalkSeconds).toBe(Math.round((r.straightLineMeters / 1.34) * SENIOR_WALK_FACTOR));
  });

  it('drops points the driver cannot reach when driving legs are given', () => {
    const ranked = rankPickups({
      origin,
      candidates: [stand('a', 1.333, 103.848)],
      walk: legs([['a', { seconds: 90, meters: 100 }]]),
      drive: legs([['a', null]]),
    });
    expect(ranked).toHaveLength(0);
  });
});

describe('candidate helpers', () => {
  it('keeps the stand when a kerbside point is within 25 m', () => {
    const kept = dedupeCandidates([
      { id: 'kerb', kind: 'kerbside', name: 'kerb', lat: 1.33300, lng: 103.84800 },
      stand('stand', 1.33310, 103.84800), // ~11 m away
      { id: 'kerb2', kind: 'kerbside', name: 'kerb2', lat: 1.33400, lng: 103.84800 }, // ~110 m away
    ]);
    expect(kept.map((k) => k.id).sort()).toEqual(['kerb2', 'stand']);
  });

  it('selects stands within the radius, nearest first', () => {
    const picked = nearbyCandidates(
      [stand('far', 1.345, 103.86), stand('mid', 1.3345, 103.8479), stand('close', 1.3330, 103.8479)],
      origin,
      400,
      5,
    );
    expect(picked.map((p) => p.id)).toEqual(['close', 'mid']);
  });
});
