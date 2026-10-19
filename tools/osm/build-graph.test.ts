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

    // At 40 km/h (motorway_link free flow speed), speed is 40 / 3.6 = 11.11 m/s
    // At 25 km/h (primary_link cap), speed would have been 25 / 3.6 = 6.94 m/s
    const effectiveKmh = (edge.length / edge.seconds) * 3.6;
    expect(effectiveKmh).toBeCloseTo(40, 0);
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

    // Capped at primary_link free flow assumption (25 km/h)
    const effectiveKmh = (edge.length / edge.seconds) * 3.6;
    expect(effectiveKmh).toBeCloseTo(25, 0);
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
});
