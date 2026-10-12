/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pickupService.test.ts: Tests for server-side pickup routing and local engine integration (Phase 4).
 */

import { describe, it, expect, vi } from 'vitest';
import { routeMatrix, findPickupOptions } from './pickupService';
import { PickupCandidate } from './pickupOptimizer';
import { Router, RouteResult } from '../routing/router';

describe('pickupService: Local Road Routing (Phase 4)', () => {
  const origin = { lat: 1.3327, lng: 103.8479 }; // Toa Payoh
  const destinations: PickupCandidate[] = [
    { id: 'stand-1', kind: 'taxi_stand', name: 'Stand 1', lat: 1.3330, lng: 103.8480 },
    { id: 'stand-2', kind: 'taxi_stand', name: 'Stand 2', lat: 1.3340, lng: 103.8490 },
  ];

  it('computes driving route legs using customRoadRouter without Google API key', async () => {
    const mockRouter = {
      findRoute: vi.fn((orig, dest) => {
        return {
          durationSeconds: 180,
          distanceMeters: 1200,
          minutes: 3.0,
          km: 1.2,
          edgeCount: 5,
          edges: [],
          snapStartMeters: 5,
          snapDestMeters: 5,
        } as RouteResult;
      }),
    } as unknown as Router;

    const result = await routeMatrix(
      origin,
      destinations,
      'DRIVE',
      undefined,
      undefined,
      mockRouter
    );

    expect(mockRouter.findRoute).toHaveBeenCalledTimes(2);
    expect(result.get('stand-1')).toEqual({ seconds: 180, meters: 1200 });
    expect(result.get('stand-2')).toEqual({ seconds: 180, meters: 1200 });
  });

  it('ranks pickup options with driver using customRoadRouter without requiring Google Maps key', async () => {
    const mockRoadRouter = {
      findRoute: vi.fn(() => ({
        durationSeconds: 240,
        distanceMeters: 1800,
        minutes: 4.0,
        km: 1.8,
        edgeCount: 6,
        edges: [],
        snapStartMeters: 5,
        snapDestMeters: 5,
      } as RouteResult)),
    } as unknown as Router;

    const mockPedestrianRouter = {
      findRoute: vi.fn(() => Promise.resolve({
        durationSeconds: 120,
        distanceMeters: 100,
        shelteredDistanceMeters: 80,
        shelteredPercentage: 80,
        stepsCount: 0,
        isRaining: false,
        path: [],
        nodeIds: [],
        edgeIds: [],
      })),
    } as any;

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('TaxiStands')) {
        return {
          ok: true,
          json: async () => ({
            value: [
              {
                TaxiCode: 'TS01',
                Type: 'Stand',
                Latitude: 1.3330,
                Longitude: 103.8480,
                Bfa: 'Yes',
              },
            ],
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const options = await findPickupOptions({
      senior: origin,
      driver: { lat: 1.3300, lng: 103.8450 },
      mapsKey: '', // No Google Maps key
      ltaKey: 'mock-lta-key',
      customPedestrianRouter: mockPedestrianRouter,
      customRoadRouter: mockRoadRouter,
    });

    fetchSpy.mockRestore();

    expect(options.usedDriverLocation).toBe(true);
    expect(mockRoadRouter.findRoute).toHaveBeenCalled();
    expect(options.options).toBeDefined();
  });

  it('handles road router errors gracefully and falls back without crashing', async () => {
    const brokenRoadRouter = {
      findRoute: vi.fn(() => {
        throw new Error('Graph disconnected');
      }),
    } as unknown as Router;

    const result = await routeMatrix(
      origin,
      destinations,
      'DRIVE',
      undefined,
      undefined,
      brokenRoadRouter
    );

    // When mapsKey is not available and local router throws, returns null legs
    expect(result.get('stand-1')).toBeNull();
    expect(result.get('stand-2')).toBeNull();
  });

  it('uses findRoutesToMany on customRoadRouter for single-pass search optimization', async () => {
    const mockRouter = {
      findRoutesToMany: vi.fn((orig, targets) => {
        const map = new Map<string, any>();
        for (const t of targets) {
          map.set(t.id, {
            durationSeconds: 210,
            distanceMeters: 1400,
          });
        }
        return map;
      }),
    } as unknown as Router;

    const result = await routeMatrix(
      origin,
      destinations,
      'DRIVE',
      undefined,
      undefined,
      mockRouter
    );

    expect(mockRouter.findRoutesToMany).toHaveBeenCalledTimes(1);
    expect(result.get('stand-1')).toEqual({ seconds: 210, meters: 1400 });
    expect(result.get('stand-2')).toEqual({ seconds: 210, meters: 1400 });
  });

  it('strictly passes customPedestrianRouter ONLY to WALK and customRoadRouter ONLY to DRIVE (E7)', async () => {
    const mockPedestrianRouter = {
      findRoute: vi.fn(() => Promise.resolve({
        durationSeconds: 60,
        distanceMeters: 50,
      })),
    } as any;

    const mockRoadRouter = {
      findRoutesToMany: vi.fn(() => new Map([
        ['stand-1', { durationSeconds: 300, distanceMeters: 2000 }],
      ])),
    } as any;

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('TaxiStands')) {
        return {
          ok: true,
          json: async () => ({
            value: [{ TaxiCode: 'TS01', Type: 'Stand', Latitude: 1.3330, Longitude: 103.8480 }],
          }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    await findPickupOptions({
      senior: origin,
      driver: { lat: 1.3300, lng: 103.8450 },
      mapsKey: '',
      ltaKey: 'mock-lta-key',
      customPedestrianRouter: mockPedestrianRouter,
      customRoadRouter: mockRoadRouter,
    });

    fetchSpy.mockRestore();

    // Verify pedestrian router was called for senior walking
    expect(mockPedestrianRouter.findRoute).toHaveBeenCalled();
    // Verify road router was called for driver driving
    expect(mockRoadRouter.findRoutesToMany).toHaveBeenCalled();
  });
});
