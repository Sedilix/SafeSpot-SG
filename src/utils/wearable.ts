/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { haversineMeters, GeoPoint } from './geo';

export const WEARABLE_EVENT_TYPES = [
  'SOS_TRIGGER',
  'SOS_CANCEL',
  'HEARTBEAT',
  'FALL_DETECTED',
  'HR_ALERT',
  'CHECK_IN_OK',
] as const;
export type WearableEventType = (typeof WEARABLE_EVENT_TYPES)[number];

/** Why the current alert was raised: button press, watch fall detector, or abnormal heart rate. */
export type WearableAlertReason = 'manual' | 'fall' | 'heartRate';

const ALERT_REASONS: Partial<Record<WearableEventType, WearableAlertReason>> = {
  SOS_TRIGGER: 'manual',
  FALL_DETECTED: 'fall',
  HR_ALERT: 'heartRate',
};

export interface WearableEvent {
  deviceId: string;
  eventType: WearableEventType;
  lat?: number;
  lng?: number;
  heartRate?: number;
  battery?: number;
  timestamp: number; // unix seconds, as reported by the watch
  positionAge?: number; // seconds since GPS fix was captured on device
  accuracy?: number; // estimated radius of the position, metres (watch GPS quality + averaging)
  isBackground?: boolean; // true if dispatched by Connect IQ background temporal event
  sosActive?: boolean; // true if watch app is currently in active SOS countdown or confirmed state
}

export interface WearableState {
  deviceId: string;
  lastEventType: WearableEventType;
  lastSeen: number; // server ms
  sosActive: boolean;
  sosSince: number | null; // server ms
  alertReason: WearableAlertReason | null;
  lat: number | null;
  lng: number | null;
  heartRate: number | null;
  battery: number | null;
  landmark: string | null;
  activeIncidentId?: string | null;
  checkInRequested?: boolean;
  checkInRequestedAt?: number | null;
  lastCheckInOkAt?: number | null;
  isBackground?: boolean;
  positionAge?: number | null;
  accuracy?: number | null;
}

// Foreground heartbeat is ~60s but the background service only beats every 5 min
// (Connect IQ minimum), so the offline window must outlast one background gap.
export const WEARABLE_STALE_MS = 7 * 60 * 1000;

/** A caregiver check-in request lapses if the senior never answers. */
export const CHECK_IN_TTL_MS = 15 * 60 * 1000;
/** Minimum gap between check-in requests for one device (anti-spam). */
export const CHECK_IN_MIN_INTERVAL_MS = 30 * 1000;
/** Hard cap on tracked devices: the intake endpoints are unauthenticated. */
export const MAX_WEARABLE_DEVICES = 50;

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
  if (b.positionAge != null && (!isFiniteNumber(b.positionAge) || b.positionAge < 0)) {
    return 'positionAge must be non-negative.';
  }
  if (b.accuracy != null && (!isFiniteNumber(b.accuracy) || b.accuracy <= 0 || b.accuracy > 10_000)) {
    return 'accuracy must be 0-10000 metres.';
  }
  if (b.isBackground != null && typeof b.isBackground !== 'boolean') {
    return 'isBackground must be a boolean.';
  }
  if (b.sosActive != null && typeof b.sosActive !== 'boolean') {
    return 'sosActive must be a boolean.';
  }

  return {
    deviceId: b.deviceId.trim(),
    eventType: b.eventType as WearableEventType,
    lat: hasLat ? (b.lat as number) : undefined,
    lng: hasLng ? (b.lng as number) : undefined,
    heartRate: isFiniteNumber(b.heartRate) ? Math.round(b.heartRate) : undefined,
    battery: isFiniteNumber(b.battery) ? Math.round(b.battery) : undefined,
    timestamp: isFiniteNumber(b.timestamp) ? b.timestamp : Math.floor(Date.now() / 1000),
    positionAge: isFiniteNumber(b.positionAge) ? Math.round(b.positionAge) : undefined,
    accuracy: isFiniteNumber(b.accuracy) ? Math.round(b.accuracy) : undefined,
    isBackground: typeof b.isBackground === 'boolean' ? b.isBackground : undefined,
    sosActive: typeof b.sosActive === 'boolean' ? b.sosActive : undefined,
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
  const reason = ALERT_REASONS[event.eventType];
  const sosActive = reason
    ? true
    : event.eventType === 'SOS_CANCEL'
      ? false
      : typeof event.sosActive === 'boolean'
        ? event.sosActive
        : prev?.sosActive ?? false;
  // An alert that is already active keeps its original reason and start time.
  const continuing = sosActive && prev?.sosActive;

  const isCheckInOk = event.eventType === 'CHECK_IN_OK';
  const checkInRequested = isCheckInOk || event.eventType === 'SOS_CANCEL'
    ? false
    : prev?.checkInRequested ?? false;

  return {
    deviceId: event.deviceId,
    lastEventType: event.eventType,
    lastSeen: now,
    sosActive,
    sosSince: sosActive ? (continuing ? prev!.sosSince : now) : null,
    alertReason: sosActive ? (continuing ? prev!.alertReason : reason ?? null) : null,
    lat: event.lat ?? prev?.lat ?? null,
    lng: event.lng ?? prev?.lng ?? null,
    heartRate: event.heartRate ?? prev?.heartRate ?? null,
    battery: event.battery ?? prev?.battery ?? null,
    landmark: landmark ?? prev?.landmark ?? null,
    activeIncidentId: sosActive ? (continuing ? prev?.activeIncidentId ?? null : null) : null,
    checkInRequested,
    checkInRequestedAt: checkInRequested ? prev?.checkInRequestedAt ?? null : null,
    lastCheckInOkAt: isCheckInOk ? now : prev?.lastCheckInOkAt ?? null,
    isBackground: event.isBackground !== undefined ? event.isBackground : prev?.isBackground ?? false,
    // Age describes the coordinates in this event; if new coordinates arrive
    // without an age (older watch build) it is unknown, never the previous one.
    positionAge: event.positionAge ?? (event.lat !== undefined ? null : prev?.positionAge ?? null),
    // Same rule as positionAge: it describes this event's coordinates.
    accuracy: event.accuracy ?? (event.lat !== undefined ? null : prev?.accuracy ?? null),
  };
}

export function isWearableOnline(state: Pick<WearableState, 'lastSeen'>, now: number): boolean {
  return now - state.lastSeen <= WEARABLE_STALE_MS;
}

/** True while a caregiver check-in request is outstanding and not yet expired. */
export function isCheckInActive(
  state: Pick<WearableState, 'checkInRequested' | 'checkInRequestedAt'> | undefined,
  now: number,
): boolean {
  if (!state?.checkInRequested) return false;
  const at = state.checkInRequestedAt;
  return typeof at === 'number' && now - at <= CHECK_IN_TTL_MS;
}

export type CheckInResult =
  | { ok: true; state: WearableState }
  | { ok: false; reason: 'unknown_device' | 'rate_limited' };

/**
 * Flags a check-in for a device that has already reported in. Unknown devices
 * are rejected so the unauthenticated endpoint can't mint phantom watches.
 */
export function requestCheckIn(prev: WearableState | undefined, now: number): CheckInResult {
  if (!prev) return { ok: false, reason: 'unknown_device' };
  if (isCheckInActive(prev, now) && now - (prev.checkInRequestedAt ?? 0) < CHECK_IN_MIN_INTERVAL_MS) {
    return { ok: false, reason: 'rate_limited' };
  }
  return { ok: true, state: { ...prev, checkInRequested: true, checkInRequestedAt: now } };
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
