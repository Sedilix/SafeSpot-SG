/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BLEBeaconScan, LocationSource } from '../types';
import { hasVenueGradePrecision } from './ble';

export interface WatchLocationInput {
  lat: number | null | undefined;
  lng: number | null | undefined;
  timestamp: number;
  positionAge?: number | null; // Age in seconds reported by watch (e.g. background fix)
  accuracy?: number; // Estimated accuracy in meters
}

export interface PhoneLocationInput {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  accuracy: number;
  timestamp: number;
}

export interface FusedLocationResult {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  source: LocationSource;
  sourceLabelKey: 'fusion.watchGps' | 'fusion.phoneBle' | 'fusion.phoneGps';
  isIndoorAssisted: boolean;
  isStale: boolean;
  effectiveAgeSeconds: number;
  floorLevel?: string;
  venueName?: string;
  beaconDistanceMeters?: number;
}

/** 3 minutes threshold: position is considered fresh if <= 180 seconds old */
export const MAX_FRESH_AGE_MS = 180_000;
/** 60 seconds threshold for live BLE beacon scanning */
export const MAX_BEACON_AGE_MS = 60_000;
/** Sub-5m beacon proximity for indoor floor precision */
export const VENUE_PRECISION_DISTANCE_M = 5;
/** Default baseline accuracy for Garmin multi-GNSS outdoor fix */
export const DEFAULT_WATCH_ACCURACY_M = 15;

/**
 * Multi-source location fusion engine for SafeSpot.SG.
 *
 * Priority order:
 * 1. Phone BLE Beacon Micro-Location: In Singapore HDB void decks, lift lobbies,
 *    and MRT stations where satellite GNSS signals drop or reflect, a nearby
 *    surveyed venue beacon (<5m) provides verified sub-3m/floor-level precision.
 * 2. Garmin Watch Multi-GNSS: Outdoors, the watch GPS fix is preferred when fresh
 *    (<3 min) because wrist-worn hardware has unobstructed sky view, unlike a phone
 *    carried in a pocket or bag.
 * 3. Phone GPS: Used when the watch fix is absent, stale (>3 min), or when the watch
 *    is offline.
 */
export function fuseLocations(params: {
  watchLocation?: WatchLocationInput | null;
  phoneLocation?: PhoneLocationInput | null;
  beacons?: BLEBeaconScan[];
  now?: number;
}): FusedLocationResult | null {
  const now = params.now ?? Date.now();
  const { watchLocation, phoneLocation, beacons = [] } = params;

  // ── 1. Indoor / Surveyed Venue Micro-Location Override ─────────────────────
  // Look for a verified venue beacon in range (< 5m) seen within the last 60s
  const cutoff = now - MAX_BEACON_AGE_MS;
  const validVenueBeacons = beacons.filter(
    (b) =>
      b.isKnownVenue &&
      b.lat !== undefined &&
      b.lng !== undefined &&
      b.lastSeen >= cutoff &&
      b.estimatedDistanceMeters <= VENUE_PRECISION_DISTANCE_M
  );

  if (validVenueBeacons.length > 0 || hasVenueGradePrecision(beacons)) {
    // Pick the closest venue beacon
    const bestBeacon = validVenueBeacons.sort(
      (a, b) => a.estimatedDistanceMeters - b.estimatedDistanceMeters
    )[0];

    if (bestBeacon && bestBeacon.lat !== undefined && bestBeacon.lng !== undefined) {
      const ageSec = Math.max(0, Math.round((now - bestBeacon.lastSeen) / 1000));
      return {
        lat: bestBeacon.lat,
        lng: bestBeacon.lng,
        accuracy: Math.max(3, Math.round(bestBeacon.estimatedDistanceMeters)),
        timestamp: bestBeacon.lastSeen,
        source: 'phone_ble_assisted',
        sourceLabelKey: 'fusion.phoneBle',
        isIndoorAssisted: true,
        isStale: false,
        effectiveAgeSeconds: ageSec,
        floorLevel: bestBeacon.floorLevel,
        venueName: bestBeacon.locationName,
        beaconDistanceMeters: bestBeacon.estimatedDistanceMeters,
      };
    }
  }

  // ── 2. Evaluate Watch GPS Coordinates ─────────────────────────────────────
  const hasWatchCoords =
    watchLocation != null &&
    watchLocation.lat != null &&
    watchLocation.lng != null &&
    !isNaN(watchLocation.lat) &&
    !isNaN(watchLocation.lng) &&
    (watchLocation.lat !== 0 || watchLocation.lng !== 0);

  const watchAgeMs = hasWatchCoords
    ? Math.max(0, now - watchLocation!.timestamp) +
      Math.max(0, (watchLocation!.positionAge || 0) * 1000)
    : Number.POSITIVE_INFINITY;
  const isWatchFresh = hasWatchCoords && watchAgeMs <= MAX_FRESH_AGE_MS;

  // ── 3. Evaluate Phone GPS Coordinates ─────────────────────────────────────
  const hasPhoneCoords =
    phoneLocation != null &&
    phoneLocation.latitude != null &&
    phoneLocation.longitude != null &&
    !isNaN(phoneLocation.latitude) &&
    !isNaN(phoneLocation.longitude) &&
    (phoneLocation.latitude !== 0 || phoneLocation.longitude !== 0);

  const phoneAgeMs = hasPhoneCoords
    ? Math.max(0, now - phoneLocation!.timestamp)
    : Number.POSITIVE_INFINITY;
  const isPhoneFresh = hasPhoneCoords && phoneAgeMs <= MAX_FRESH_AGE_MS;

  // ── 4. Decision Matrix: Watch vs Phone ─────────────────────────────────────
  if (hasWatchCoords && hasPhoneCoords) {
    // Both available: prefer watch outdoors when fresh (<3 min)
    if (isWatchFresh) {
      return {
        lat: watchLocation!.lat!,
        lng: watchLocation!.lng!,
        accuracy: watchLocation!.accuracy ?? DEFAULT_WATCH_ACCURACY_M,
        timestamp: watchLocation!.timestamp,
        source: 'watch_gps',
        sourceLabelKey: 'fusion.watchGps',
        isIndoorAssisted: false,
        isStale: false,
        effectiveAgeSeconds: Math.round(watchAgeMs / 1000),
      };
    }

    // Watch fix is stale (>3 min). If phone fix is fresh, fallback to phone!
    if (isPhoneFresh) {
      return {
        lat: phoneLocation!.latitude!,
        lng: phoneLocation!.longitude!,
        accuracy: phoneLocation!.accuracy,
        timestamp: phoneLocation!.timestamp,
        source: 'phone_gps',
        sourceLabelKey: 'fusion.phoneGps',
        isIndoorAssisted: false,
        isStale: false,
        effectiveAgeSeconds: Math.round(phoneAgeMs / 1000),
      };
    }

    // Neither is fresh: select the fresher of the two stale fixes
    if (watchAgeMs <= phoneAgeMs) {
      return {
        lat: watchLocation!.lat!,
        lng: watchLocation!.lng!,
        accuracy: watchLocation!.accuracy ?? DEFAULT_WATCH_ACCURACY_M,
        timestamp: watchLocation!.timestamp,
        source: 'watch_gps',
        sourceLabelKey: 'fusion.watchGps',
        isIndoorAssisted: false,
        isStale: true,
        effectiveAgeSeconds: Math.round(watchAgeMs / 1000),
      };
    } else {
      return {
        lat: phoneLocation!.latitude!,
        lng: phoneLocation!.longitude!,
        accuracy: phoneLocation!.accuracy,
        timestamp: phoneLocation!.timestamp,
        source: 'phone_gps',
        sourceLabelKey: 'fusion.phoneGps',
        isIndoorAssisted: false,
        isStale: true,
        effectiveAgeSeconds: Math.round(phoneAgeMs / 1000),
      };
    }
  }

  // ── 5. Single Source Availability ──────────────────────────────────────────
  if (hasWatchCoords) {
    return {
      lat: watchLocation!.lat!,
      lng: watchLocation!.lng!,
      accuracy: watchLocation!.accuracy ?? DEFAULT_WATCH_ACCURACY_M,
      timestamp: watchLocation!.timestamp,
      source: 'watch_gps',
      sourceLabelKey: 'fusion.watchGps',
      isIndoorAssisted: false,
      isStale: !isWatchFresh,
      effectiveAgeSeconds: Math.round(watchAgeMs / 1000),
    };
  }

  if (hasPhoneCoords) {
    return {
      lat: phoneLocation!.latitude!,
      lng: phoneLocation!.longitude!,
      accuracy: phoneLocation!.accuracy,
      timestamp: phoneLocation!.timestamp,
      source: 'phone_gps',
      sourceLabelKey: 'fusion.phoneGps',
      isIndoorAssisted: false,
      isStale: !isPhoneFresh,
      effectiveAgeSeconds: Math.round(phoneAgeMs / 1000),
    };
  }

  // ── 6. Neither Source Available ────────────────────────────────────────────
  return null;
}
