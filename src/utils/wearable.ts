/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { haversineMeters, GeoPoint } from './geo';

export const WEARABLE_EVENT_TYPES = ['SOS_TRIGGER', 'SOS_CANCEL', 'HEARTBEAT', 'FALL_DETECTED'] as const;
export type WearableEventType = (typeof WEARABLE_EVENT_TYPES)[number];

export interface WearableEvent {
  deviceId: string;
  eventType: WearableEventType;
  lat?: number;
  lng?: number;
  heartRate?: number;
  battery?: number;
  timestamp: number; // unix seconds, as reported by the watch
}

export interface WearableState {
  deviceId: string;
  lastEventType: WearableEventType;
  lastSeen: number; // server ms
  sosActive: boolean;
  sosSince: number | null; // server ms
  lat: number | null;
  lng: number | null;
  heartRate: number | null;
  battery: number | null;
  landmark: string | null;
}

// A watch heartbeats every ~60s; treat it as offline after a few missed beats.
export const WEARABLE_STALE_MS = 3 * 60 * 1000;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates an untrusted request body. Returns the parsed event or an error string. */
export function parseWearableEvent(body: unknown): WearableEvent | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object.';
  const b = body as Record<string, unknown>;

  if (typeof b.deviceId !== 'string' || !b.deviceId.trim() || b.deviceId.length > 64) {
    return 'deviceId must be a non-empty string (max 64 chars).';
  }
  if (!WEARABLE_EVENT_TYPES.includes(b.eventType as WearableEventType)) {
    return `eventType must be one of ${WEARABLE_EVENT_TYPES.join(', ')}.`;
  }

  const hasLat = b.lat !== undefined && b.lat !== null;
  const hasLng = b.lng !== undefined && b.lng !== null;
  if (hasLat !== hasLng) return 'lat and lng must be supplied together.';
  if (hasLat && (!isFiniteNumber(b.lat) || Math.abs(b.lat) > 90 || !isFiniteNumber(b.lng) || Math.abs(b.lng as number) > 180)) {
    return 'lat/lng out of range.';
  }
  if (b.heartRate != null && (!isFiniteNumber(b.heartRate) || b.heartRate < 0 || b.heartRate > 300)) {
    return 'heartRate out of range.';
  }
  if (b.battery != null && (!isFiniteNumber(b.battery) || b.battery < 0 || b.battery > 100)) {
    return 'battery must be 0-100.';
  }

  return {
    deviceId: b.deviceId.trim(),
    eventType: b.eventType as WearableEventType,
    lat: hasLat ? (b.lat as number) : undefined,
    lng: hasLng ? (b.lng as number) : undefined,
    heartRate: isFiniteNumber(b.heartRate) ? Math.round(b.heartRate) : undefined,
    battery: isFiniteNumber(b.battery) ? Math.round(b.battery) : undefined,
    timestamp: isFiniteNumber(b.timestamp) ? b.timestamp : Math.floor(Date.now() / 1000),
  };
}

/**
 * Folds a new event into the previous state for that device. Readings the
 * watch omitted (e.g. no GPS fix yet) keep their last known value.
 */
export function applyWearableEvent(
  prev: WearableState | undefined,
  event: WearableEvent,
  now: number,
  landmark: string | null,
): WearableState {
  const triggersSos = event.eventType === 'SOS_TRIGGER' || event.eventType === 'FALL_DETECTED';
  const sosActive = triggersSos ? true : event.eventType === 'SOS_CANCEL' ? false : prev?.sosActive ?? false;

  return {
    deviceId: event.deviceId,
    lastEventType: event.eventType,
    lastSeen: now,
    sosActive,
    sosSince: sosActive ? (prev?.sosActive ? prev.sosSince : now) : null,
    lat: event.lat ?? prev?.lat ?? null,
    lng: event.lng ?? prev?.lng ?? null,
    heartRate: event.heartRate ?? prev?.heartRate ?? null,
    battery: event.battery ?? prev?.battery ?? null,
    landmark: landmark ?? prev?.landmark ?? null,
  };
}

export function isWearableOnline(state: Pick<WearableState, 'lastSeen'>, now: number): boolean {
  return now - state.lastSeen <= WEARABLE_STALE_MS;
}

/** Nearest named place within maxMeters, or null. */
export function nearestLandmark(
  point: GeoPoint,
  places: ReadonlyArray<{ title: string; lat: number; lng: number }>,
  maxMeters = 1500,
): string | null {
  let best: string | null = null;
  let bestDist = maxMeters;
  for (const p of places) {
    const d = haversineMeters(point, { lat: p.lat, lng: p.lng });
    if (d <= bestDist) {
      bestDist = d;
      best = p.title;
    }
  }
  return best;
}
