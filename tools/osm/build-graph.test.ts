/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildGraphFromElements } from './build-graph';

describe('build-graph: Expressway Corridor Link Normalization', () => {
  it('normalizes primary_link with expressway destination to motorway_link', () => {
    // Simulates OSM way 633588308 (CTE Exit 1 flyover connector to TPE)
    const elements = [
      {
        type: 'way',
        id: 633588308,
        tags: {
          highway: 'primary_link',
          'destination:ref': 'TPE;KPE',
          maxspeed: '50',
          oneway: 'yes',
        },
        geometry: [
          { lat: 1.3932, lon: 103.8575 },
          { lat: 1.3942, lon: 103.8576 },
        ],
      },
    ];

    const graphData = buildGraphFromElements(elements);
    expect(graphData.edges.length).toBe(1);

    const edge = graphData.edges[0];
    expect(edge.highway).toBe('motorway_link');
    expect(edge.oneway).toBe(true);

    // At 50 km/h (motorway_link with maxspeed 50 and 55 cap), speed is 50 / 3.6 = 13.89 m/s
    // At 25 km/h (primary_link cap), speed would have been 25 / 3.6 = 6.94 m/s
    const effectiveKmh = (edge.length / edge.seconds) * 3.6;
    expect(effectiveKmh).toBeCloseTo(50, 0);
  });

  it('keeps standard primary_link without expressway destination as primary_link', () => {
    const elements = [
      {
        type: 'way',
        id: 999123,
        tags: {
          highway: 'primary_link',
          destination: 'Ang Mo Kio Avenue 1',
          maxspeed: '50',
          oneway: 'yes',
        },
        geometry: [
          { lat: 1.3650, lon: 103.8450 },
          { lat: 1.3660, lon: 103.8455 },
        ],
      },
    ];

    const graphData = buildGraphFromElements(elements);
    expect(graphData.edges.length).toBe(1);

    const edge = graphData.edges[0];
    expect(edge.highway).toBe('primary_link');

    // Capped at primary_link free flow assumption (35 km/h)
    const effectiveKmh = (edge.length / edge.seconds) * 3.6;
    expect(effectiveKmh).toBeCloseTo(35, 0);
  });

  it('normalizes secondary_link or trunk_link with expressway ref to motorway_link', () => {
    const elements = [
      {
        type: 'way',
        id: 888123,
        tags: {
          highway: 'secondary_link',
          destination: 'AYE',
          maxspeed: '50',
          oneway: 'yes',
        },
        geometry: [
          { lat: 1.3150, lon: 103.7650 },
          { lat: 1.3160, lon: 103.7660 },
        ],
      },
    ];

    const graphData = buildGraphFromElements(elements);
    expect(graphData.edges[0].highway).toBe('motorway_link');
  });

  it('parses and retains via-way turn restrictions where all 3 ways are in the graph', () => {
    const elements = [
      {
        type: 'way',
        id: 101,
        tags: { highway: 'primary', oneway: 'yes' },
        geometry: [{ lat: 1.3000, lon: 103.8000 }, { lat: 1.3010, lon: 103.8010 }],
      },
      {
        type: 'way',
        id: 102,
        tags: { highway: 'residential', oneway: 'yes' },
        geometry: [{ lat: 1.3010, lon: 103.8010 }, { lat: 1.3010, lon: 103.8020 }],
      },
      {
        type: 'way',
        id: 103,
        tags: { highway: 'primary', oneway: 'yes' },
        geometry: [{ lat: 1.3010, lon: 103.8020 }, { lat: 1.3000, lon: 103.8020 }],
      },
      {
        type: 'relation',
        id: 99901,
        tags: { type: 'restriction', restriction: 'no_u_turn' },
        members: [
          { type: 'way', ref: 101, role: 'from' },
          { type: 'way', ref: 102, role: 'via' },
          { type: 'way', ref: 103, role: 'to' },
        ],
      },
    ];

    const graphData = buildGraphFromElements(elements);
    expect(graphData.viaWayRestrictions?.length).toBe(1);
    expect(graphData.viaWayRestrictions?.[0]).toEqual({
      type: 'no_u_turn',
      fromWayId: 101,
      viaWayId: 102,
      toWayId: 103,
    });
    expect(graphData.stats.restrictionsViaWayKept).toBe(1);
  });
});

describe('build-graph: traffic signals', () => {
  it('maps highway=traffic_signals nodes onto graph nodes by coordinate and counts the rest', () => {
    const data = buildGraphFromElements([
      { type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [{ lat: 1.3, lon: 103.8 }, { lat: 1.301, lon: 103.8 }, { lat: 1.302, lon: 103.8 }] },
      { type: 'node', id: 10, lat: 1.301, lon: 103.8, tags: { highway: 'traffic_signals' } },
      { type: 'node', id: 11, lat: 1.35, lon: 103.9, tags: { highway: 'traffic_signals' } }, // on a road not in the graph
      { type: 'node', id: 12, lat: 1.302, lon: 103.8, tags: { highway: 'crossing' } },
    ]);
    const mid = data.nodes.find((n) => n.lat === 1.301)!.id;
    expect(data.trafficSignalNodes).toEqual([mid]);
    expect(data.stats.trafficSignalsKept).toBe(1);
    expect(data.stats.trafficSignalsNotOnGraph).toBe(1);
  });
});
