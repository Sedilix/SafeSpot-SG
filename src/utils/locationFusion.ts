/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BLEBeaconScan, Incident, LocationSource, SourceFix } from '../types';
import { hasVenueGradePrecision } from './ble';
import { haversineMeters } from './geo';

export interface WatchLocationInput {
  lat: number | null | undefined;
  lng: number | null | undefined;
  timestamp: number;
  positionAge?: number | null; // Age in seconds reported by watch (e.g. background fix)
  accuracy?: number | null; // Estimated accuracy in meters; null/undefined = not reported
}

export interface PhoneLocationInput {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  accuracy: number | null; // null = the device didn't report one
  timestamp: number;
}

export interface FusedLocationResult {
  lat: number;
  lng: number;
  /** Metres; null when the chosen source didn't report an accuracy (never invented). */
  accuracy: number | null;
  timestamp: number;
  source: LocationSource;
  sourceLabelKey: 'fusion.watchGps' | 'fusion.phoneBle' | 'fusion.phoneGps' | 'fusion.combined';
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
/** Roughly how far an elderly person walks per second; widens an older fix's uncertainty. */
export const WALKING_SPEED_MPS = 1.0;

/** A reported accuracy radius, or null when it is missing or not a positive finite number. */
export function reportedAccuracy(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** A fix's uncertainty grows with its age, because the person may have moved since. */
export function ageAdjustedAccuracy(accuracyM: number, ageMs: number): number {
  return accuracyM + Math.max(0, ageMs / 1000 - 10) * WALKING_SPEED_MPS;
}

/**
 * Combines two fixes that agree, weighting each by 1/accuracy^2 (inverse
 * variance), which gives a tighter estimate than either alone. Returns null
 * when they are further apart than their combined uncertainty: then one of
 * them is wrong (e.g. a reflected signal between towers) and averaging would
 * just move the pin toward the error.
 */
export function combineAgreeingFixes(
  a: { lat: number; lng: number; accuracy: number },
  b: { lat: number; lng: number; accuracy: number },
): { lat: number; lng: number; accuracy: number } | null {
  const distance = haversineMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  if (distance > a.accuracy + b.accuracy) return null;
  const wa = 1 / (a.accuracy * a.accuracy);
  const wb = 1 / (b.accuracy * b.accuracy);
  return {
    lat: (a.lat * wa + b.lat * wb) / (wa + wb),
    lng: (a.lng * wa + b.lng * wb) / (wa + wb),
    accuracy: Math.max(3, Math.round(1 / Math.sqrt(wa + wb))),
  };
}

/**
 * Multi-source location fusion engine for SafeSpot.SG.
 *
 * Priority order:
 * 1. Phone BLE Beacon Micro-Location: In Singapore HDB void decks, lift lobbies,
 *    and MRT stations where satellite GNSS signals drop or reflect, a nearby
 *    surveyed venue beacon (<5m) provides verified sub-3m/floor-level precision.
 * 2. Watch + phone GNSS: fresh (<3 min) fixes that agree are combined by inverse
 *    variance; otherwise the fresh fix with the tighter age-adjusted accuracy wins
 *    (the watch on a tie or when neither reports accuracy: wrist-worn hardware has a
 *    clearer sky view than a phone in a pocket or bag).
 * 3. Neither fresh: the newer stale fix, flagged isStale.
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

  // ── 2. Watch and phone GNSS candidates ────────────────────────────────────
  const validCoords = (lat: number | null | undefined, lng: number | null | undefined): boolean =>
    lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);

  type Candidate = {
    lat: number;
    lng: number;
    accuracy: number | null;
    timestamp: number;
    ageMs: number;
    fresh: boolean;
    source: 'watch_gps' | 'phone_gps';
  };
  const candidates: Candidate[] = [];

  if (watchLocation && validCoords(watchLocation.lat, watchLocation.lng)) {
    const ageMs = Math.max(0, now - watchLocation.timestamp) + Math.max(0, (watchLocation.positionAge || 0) * 1000);
    candidates.push({
      lat: watchLocation.lat!,
      lng: watchLocation.lng!,
      accuracy: reportedAccuracy(watchLocation.accuracy),
      timestamp: watchLocation.timestamp,
      ageMs,
      fresh: ageMs <= MAX_FRESH_AGE_MS,
      source: 'watch_gps',
    });
  }
  if (phoneLocation && validCoords(phoneLocation.latitude, phoneLocation.longitude)) {
    const ageMs = Math.max(0, now - phoneLocation.timestamp);
    candidates.push({
      lat: phoneLocation.latitude!,
      lng: phoneLocation.longitude!,
      accuracy: reportedAccuracy(phoneLocation.accuracy),
      timestamp: phoneLocation.timestamp,
      ageMs,
      fresh: ageMs <= MAX_FRESH_AGE_MS,
      source: 'phone_gps',
    });
  }
  if (candidates.length === 0) return null;

  const single = (c: Candidate): FusedLocationResult => ({
    lat: c.lat,
    lng: c.lng,
    accuracy: c.accuracy,
    timestamp: c.timestamp,
    source: c.source,
    sourceLabelKey: c.source === 'watch_gps' ? 'fusion.watchGps' : 'fusion.phoneGps',
    isIndoorAssisted: false,
    isStale: !c.fresh,
    effectiveAgeSeconds: Math.round(c.ageMs / 1000),
  });

  const fresh = candidates.filter((c) => c.fresh);

  // ── 3. Both fresh and both with a reported accuracy: combine if they agree ──
  if (fresh.length === 2 && fresh[0].accuracy !== null && fresh[1].accuracy !== null) {
    const [a, b] = fresh;
    const combined = combineAgreeingFixes(
      { lat: a.lat, lng: a.lng, accuracy: ageAdjustedAccuracy(a.accuracy!, a.ageMs) },
      { lat: b.lat, lng: b.lng, accuracy: ageAdjustedAccuracy(b.accuracy!, b.ageMs) },
    );
    if (combined) {
      return {
        ...combined,
        timestamp: Math.max(a.timestamp, b.timestamp),
        source: 'fused_gps',
        sourceLabelKey: 'fusion.combined',
        isIndoorAssisted: false,
        isStale: false,
        effectiveAgeSeconds: Math.round(Math.min(a.ageMs, b.ageMs) / 1000),
      };
    }
  }

  // ── 4. Otherwise pick one ──────────────────────────────────────────────────
  // Among fresh fixes, the tighter age-adjusted accuracy wins (a 60 m watch fix
  // loses to a 5 m phone fix). A fix with no reported accuracy ranks after any
  // that has one; between two of those the watch wins (clearer view of the sky
  // than a phone in a pocket). With nothing fresh, the newer stale fix wins.
  if (fresh.length > 0) {
    const rank = (c: Candidate) => (c.accuracy === null ? Number.POSITIVE_INFINITY : ageAdjustedAccuracy(c.accuracy, c.ageMs));
    const best = [...fresh].sort((x, y) => rank(x) - rank(y) || (x.source === 'watch_gps' ? -1 : 1))[0];
    return single(best);
  }
  return single([...candidates].sort((x, y) => x.ageMs - y.ageMs || (x.source === 'watch_gps' ? -1 : 1))[0]);
}

/** The location fields of an incident, recomputed from its per-source fixes. */
export type IncidentLocation = Pick<Incident, 'currentGps' | 'locationSource' | 'floorLevel' | 'venueName'>;

/**
 * Fuses an incident's latest watch and phone fixes. The watch (server) and the
 * phone (client) each write only their own fix, then call this with the other
 * side's latest one, so neither blindly overwrites a better fix from the other.
 * A fresh venue-beacon placement on the phone side wins, as in fuseLocations.
 */
export function fuseIncidentFixes(
  watchFix: SourceFix | null | undefined,
  phoneFix: SourceFix | null | undefined,
  now: number = Date.now(),
): IncidentLocation | null {
  if (phoneFix?.source === 'phone_ble_assisted' && now - phoneFix.timestamp <= MAX_BEACON_AGE_MS) {
    return {
      currentGps: { lat: phoneFix.lat, lng: phoneFix.lng, accuracy: phoneFix.accuracy, timestamp: phoneFix.timestamp },
      locationSource: 'phone_ble_assisted',
      floorLevel: phoneFix.floorLevel,
      venueName: phoneFix.venueName,
    };
  }
  const fused = fuseLocations({
    watchLocation: watchFix ? { lat: watchFix.lat, lng: watchFix.lng, timestamp: watchFix.timestamp, accuracy: watchFix.accuracy } : null,
    phoneLocation: phoneFix ? { latitude: phoneFix.lat, longitude: phoneFix.lng, timestamp: phoneFix.timestamp, accuracy: phoneFix.accuracy } : null,
    now,
  });
  if (!fused) return null;
  return {
    currentGps: { lat: fused.lat, lng: fused.lng, accuracy: fused.accuracy, timestamp: fused.timestamp },
    locationSource: fused.source,
    floorLevel: undefined,
    venueName: undefined,
  };
}

/** The phone side's own fix: a fresh venue-beacon placement if one is in range, else its GNSS fix. */
export function phoneSideFix(
  phone: { latitude: number; longitude: number; accuracy: number | null; timestamp: number } | null | undefined,
  beacons: BLEBeaconScan[],
  now: number = Date.now(),
): SourceFix | null {
  const f = fuseLocations({ phoneLocation: phone ?? null, beacons, now });
  if (!f) return null;
  return {
    lat: f.lat,
    lng: f.lng,
    accuracy: f.accuracy,
    timestamp: f.timestamp,
    source: f.source,
    floorLevel: f.floorLevel,
    venueName: f.venueName,
  };
}
