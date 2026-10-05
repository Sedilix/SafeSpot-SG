/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  fuseLocations,
  MAX_FRESH_AGE_MS,
  WatchLocationInput,
  PhoneLocationInput,
} from './locationFusion';
import { BLEBeaconScan } from '../types';

describe('locationFusion', () => {
  const BASE_TIME = 1_700_000_000_000;

  const validWatch: WatchLocationInput = {
    lat: 1.2965,
    lng: 103.7865,
    timestamp: BASE_TIME - 30_000, // 30s ago
    positionAge: 0,
    accuracy: 12,
  };

  const validPhone: PhoneLocationInput = {
    latitude: 1.297,
    longitude: 103.787,
    accuracy: 25,
    timestamp: BASE_TIME - 10_000, // 10s ago
  };

  const indoorBeacon: BLEBeaconScan = {
    id: 'beacon-block71',
    name: 'BLOCK71-Beacon',
    uuid: '0000feaa-0000-1000-8000-00805f9b34fb',
    major: 1,
    minor: 101,
    rssi: -58,
    proximity: 'near',
    estimatedDistanceMeters: 2.5,
    isKnownVenue: true,
    isPairedTag: false,
    locationName: 'BLOCK71 LaunchPad Main Lobby Porch',
    floorLevel: 'Level 1 (Ground)',
    zoneType: 'building_entrance',
    format: 'eddystone',
    lat: 1.29685,
    lng: 103.78654,
    lastSeen: BASE_TIME - 5_000,
  };

  describe('Indoor BLE Beacon Prioritization', () => {
    it('prioritizes nearby known venue beacon over fresh watch and phone GPS', () => {
      const result = fuseLocations({
        watchLocation: validWatch,
        phoneLocation: validPhone,
        beacons: [indoorBeacon],
        now: BASE_TIME,
      });

      expect(result).not.toBeNull();
      expect(result?.source).toBe('phone_ble_assisted');
      expect(result?.lat).toBe(1.29685);
      expect(result?.lng).toBe(103.78654);
      expect(result?.accuracy).toBe(3); // capped at min 3m
      expect(result?.isIndoorAssisted).toBe(true);
      expect(result?.floorLevel).toBe('Level 1 (Ground)');
      expect(result?.venueName).toBe('BLOCK71 LaunchPad Main Lobby Porch');
      expect(result?.isStale).toBe(false);
    });

    it('ignores venue beacons that are further than 5m away when GNSS is available', () => {
      const farBeacon: BLEBeaconScan = {
        ...indoorBeacon,
        estimatedDistanceMeters: 18,
      };

      const result = fuseLocations({
        watchLocation: validWatch,
        phoneLocation: validPhone,
        beacons: [farBeacon],
        now: BASE_TIME,
      });

      // Falls back to watch outdoor GPS
      expect(result?.source).toBe('watch_gps');
      expect(result?.lat).toBe(validWatch.lat);
      expect(result?.lng).toBe(validWatch.lng);
    });

    it('ignores stale venue beacons seen more than 60s ago', () => {
      const staleBeacon: BLEBeaconScan = {
        ...indoorBeacon,
        lastSeen: BASE_TIME - 75_000,
      };

      const result = fuseLocations({
        watchLocation: validWatch,
        phoneLocation: validPhone,
        beacons: [staleBeacon],
        now: BASE_TIME,
      });

      expect(result?.source).toBe('watch_gps');
    });
  });

  describe('Outdoor Watch GPS vs Phone GPS', () => {
    it('prefers watch GPS outdoors when fix is fresh (<3 min)', () => {
      const result = fuseLocations({
        watchLocation: validWatch,
        phoneLocation: validPhone,
        now: BASE_TIME,
      });

      expect(result?.source).toBe('watch_gps');
      expect(result?.lat).toBe(validWatch.lat);
      expect(result?.lng).toBe(validWatch.lng);
      expect(result?.accuracy).toBe(12);
      expect(result?.isStale).toBe(false);
    });

    it('falls back to phone GPS if watch GPS is stale (>3 min) but phone is fresh', () => {
      const staleWatch: WatchLocationInput = {
        ...validWatch,
        timestamp: BASE_TIME - (MAX_FRESH_AGE_MS + 20_000), // 200s ago
      };

      const result = fuseLocations({
        watchLocation: staleWatch,
        phoneLocation: validPhone,
        now: BASE_TIME,
      });

      expect(result?.source).toBe('phone_gps');
      expect(result?.lat).toBe(validPhone.latitude);
      expect(result?.lng).toBe(validPhone.longitude);
      expect(result?.accuracy).toBe(validPhone.accuracy);
      expect(result?.isStale).toBe(false);
    });

    it('factors in positionAge reported by Garmin background service', () => {
      // Watch reported 30s ago, but position was acquired 160s before that -> total age 190s (>180s)
      const cachedBackgroundWatch: WatchLocationInput = {
        ...validWatch,
        timestamp: BASE_TIME - 30_000,
        positionAge: 160,
      };

      const result = fuseLocations({
        watchLocation: cachedBackgroundWatch,
        phoneLocation: validPhone,
        now: BASE_TIME,
      });

      expect(result?.source).toBe('phone_gps');
      expect(result?.isStale).toBe(false);
    });

    it('picks the newer fix when both watch and phone GPS are stale', () => {
      const staleWatch: WatchLocationInput = {
        ...validWatch,
        timestamp: BASE_TIME - 300_000, // 5 min ago
      };
      const olderPhone: PhoneLocationInput = {
        ...validPhone,
        timestamp: BASE_TIME - 600_000, // 10 min ago
      };

      const result = fuseLocations({
        watchLocation: staleWatch,
        phoneLocation: olderPhone,
        now: BASE_TIME,
      });

      expect(result?.source).toBe('watch_gps');
      expect(result?.isStale).toBe(true);
    });
  });

  describe('Single-Source Fallbacks', () => {
    it('uses watch GPS when phone has no GPS fix', () => {
      const result = fuseLocations({
        watchLocation: validWatch,
        phoneLocation: null,
        now: BASE_TIME,
      });

      expect(result?.source).toBe('watch_gps');
      expect(result?.lat).toBe(validWatch.lat);
      expect(result?.isStale).toBe(false);
    });

    it('uses phone GPS when watch has no GPS fix', () => {
      const result = fuseLocations({
        watchLocation: { lat: null, lng: null, timestamp: BASE_TIME },
        phoneLocation: validPhone,
        now: BASE_TIME,
      });

      expect(result?.source).toBe('phone_gps');
      expect(result?.lat).toBe(validPhone.latitude);
      expect(result?.isStale).toBe(false);
    });

    it('returns null when neither watch nor phone have valid coordinates', () => {
      const result = fuseLocations({
        watchLocation: { lat: null, lng: null, timestamp: BASE_TIME },
        phoneLocation: null,
        now: BASE_TIME,
      });

      expect(result).toBeNull();
    });
  });
});
