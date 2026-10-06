/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseWearableEvent,
  applyWearableEvent,
  isWearableOnline,
  isCheckInActive,
  requestCheckIn,
  nearestLandmark,
  WEARABLE_STALE_MS,
  CHECK_IN_TTL_MS,
  CHECK_IN_MIN_INTERVAL_MS,
  WearableEvent,
  WearableState,
} from './wearable';

const base = { deviceId: 'fenix-6s-solar', eventType: 'HEARTBEAT', timestamp: 1728135000 };

describe('parseWearableEvent', () => {
  it('accepts the payload the watch sends', () => {
    const parsed = parseWearableEvent({ ...base, eventType: 'SOS_TRIGGER', lat: 1.29027, lng: 103.851959, heartRate: 78, battery: 84 });
    expect(parsed).toEqual({ ...base, eventType: 'SOS_TRIGGER', lat: 1.29027, lng: 103.851959, heartRate: 78, battery: 84 });
  });

  it('allows a heartbeat with no GPS fix', () => {
    const parsed = parseWearableEvent(base) as WearableEvent;
    expect(parsed.lat).toBeUndefined();
    expect(parsed.lng).toBeUndefined();
  });

  it('rejects bad input', () => {
    expect(typeof parseWearableEvent(null)).toBe('string');
    expect(typeof parseWearableEvent({ ...base, deviceId: '' })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, eventType: 'PARTY' })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, lat: 1.3 })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, lat: 91, lng: 103 })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, battery: 140 })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, heartRate: '80' })).toBe('string');
  });
});

describe('applyWearableEvent', () => {
  const ev = (over: Partial<WearableEvent>): WearableEvent => ({ ...(base as WearableEvent), ...over });

  it('activates SOS and keeps the original start time across repeats', () => {
    const s1 = applyWearableEvent(undefined, ev({ eventType: 'SOS_TRIGGER' }), 1000, null);
    expect(s1.sosActive).toBe(true);
    expect(s1.sosSince).toBe(1000);
    const s2 = applyWearableEvent(s1, ev({ eventType: 'HEARTBEAT' }), 2000, null);
    expect(s2.sosActive).toBe(true);
    expect(s2.sosSince).toBe(1000);
  });

  it('treats a fall as an SOS and clears on cancel', () => {
    const s1 = applyWearableEvent(undefined, ev({ eventType: 'FALL_DETECTED' }), 1000, null);
    expect(s1.sosActive).toBe(true);
    const s2 = applyWearableEvent(s1, ev({ eventType: 'SOS_CANCEL' }), 2000, null);
    expect(s2.sosActive).toBe(false);
    expect(s2.sosSince).toBeNull();
  });

  it('records why the alert was raised and keeps the first reason', () => {
    const fall = applyWearableEvent(undefined, ev({ eventType: 'FALL_DETECTED' }), 1000, null);
    expect(fall.alertReason).toBe('fall');
    const pressed = applyWearableEvent(fall, ev({ eventType: 'SOS_TRIGGER' }), 2000, null);
    expect(pressed.alertReason).toBe('fall');
    const cleared = applyWearableEvent(pressed, ev({ eventType: 'SOS_CANCEL' }), 3000, null);
    expect(cleared.alertReason).toBeNull();
    const hr = applyWearableEvent(cleared, ev({ eventType: 'HR_ALERT', heartRate: 165 }), 4000, null);
    expect(hr).toMatchObject({ sosActive: true, alertReason: 'heartRate', heartRate: 165, sosSince: 4000 });
  });

  it('handles background check-in requests and CHECK_IN_OK clears them', () => {
    const s1 = applyWearableEvent(
      {
        deviceId: 'fenix-6s-solar',
        lastEventType: 'HEARTBEAT',
        lastSeen: 1000,
        sosActive: false,
        sosSince: null,
        alertReason: null,
        lat: null,
        lng: null,
        heartRate: 70,
        battery: 80,
        landmark: null,
        checkInRequested: true,
        checkInRequestedAt: 1000,
      },
      ev({ eventType: 'HEARTBEAT', isBackground: true, positionAge: 120 }),
      2000,
      null,
    );
    expect(s1.checkInRequested).toBe(true);
    expect(s1.isBackground).toBe(true);
    expect(s1.positionAge).toBe(120);

    const s2 = applyWearableEvent(s1, ev({ eventType: 'CHECK_IN_OK', lat: 1.29, lng: 103.85 }), 3000, 'Suntec');
    expect(s2.checkInRequested).toBe(false);
    expect(s2.lastCheckInOkAt).toBe(3000);
    expect(s2.landmark).toBe('Suntec');
  });

  it('keeps last known readings when the watch omits them', () => {
    const s1 = applyWearableEvent(undefined, ev({ lat: 1.3, lng: 103.8, heartRate: 70, battery: 90 }), 1000, 'Suntec');
    const s2 = applyWearableEvent(s1, ev({ battery: 89 }), 2000, null);
    expect(s2).toMatchObject({ lat: 1.3, lng: 103.8, heartRate: 70, battery: 89, landmark: 'Suntec', lastSeen: 2000 });
  });
});

describe('isWearableOnline', () => {
  it('goes offline after the stale window', () => {
    expect(isWearableOnline({ lastSeen: 0 }, WEARABLE_STALE_MS)).toBe(true);
    expect(isWearableOnline({ lastSeen: 0 }, WEARABLE_STALE_MS + 1)).toBe(false);
  });
});

describe('nearestLandmark', () => {
  const places = [
    { title: 'Far', lat: 1.35, lng: 103.9 },
    { title: 'Near', lat: 1.2905, lng: 103.852 },
  ];
  it('picks the closest place within range', () => {
    expect(nearestLandmark({ lat: 1.29027, lng: 103.851959 }, places)).toBe('Near');
  });
  it('returns null when nothing is close', () => {
    expect(nearestLandmark({ lat: 1.45, lng: 103.6 }, places)).toBeNull();
  });
});

describe('check-in rules', () => {
  const seen = (): WearableState =>
    applyWearableEvent(undefined, { ...(base as WearableEvent), heartRate: 70 }, 1000, null);

  it('rejects unknown devices so no phantom watch can be created', () => {
    expect(requestCheckIn(undefined, 1000)).toEqual({ ok: false, reason: 'unknown_device' });
  });

  it('flags a known device and rate-limits repeat requests', () => {
    const first = requestCheckIn(seen(), 5000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.checkInRequested).toBe(true);
    expect(requestCheckIn(first.state, 5000 + CHECK_IN_MIN_INTERVAL_MS - 1)).toEqual({ ok: false, reason: 'rate_limited' });
    expect(requestCheckIn(first.state, 5000 + CHECK_IN_MIN_INTERVAL_MS).ok).toBe(true);
  });

  it('expires an unanswered request after the TTL', () => {
    const r = requestCheckIn(seen(), 5000);
    if (!r.ok) throw new Error('expected ok');
    expect(isCheckInActive(r.state, 5000 + CHECK_IN_TTL_MS)).toBe(true);
    expect(isCheckInActive(r.state, 5000 + CHECK_IN_TTL_MS + 1)).toBe(false);
    expect(isCheckInActive(undefined, 1)).toBe(false);
  });

  it('CHECK_IN_OK and SOS_CANCEL clear the request and record the confirmation', () => {
    const r = requestCheckIn(seen(), 5000);
    if (!r.ok) throw new Error('expected ok');
    const ok = applyWearableEvent(r.state, { ...(base as WearableEvent), eventType: 'CHECK_IN_OK' }, 6000, null);
    expect(ok.checkInRequested).toBe(false);
    expect(ok.lastCheckInOkAt).toBe(6000);
    const next = applyWearableEvent(ok, { ...(base as WearableEvent), eventType: 'HEARTBEAT' }, 7000, null);
    expect(next.lastCheckInOkAt).toBe(6000); // survives later heartbeats
  });

  it('stays online across one 5-minute background gap', () => {
    expect(isWearableOnline({ lastSeen: 0 }, 5 * 60 * 1000 + 30_000)).toBe(true);
  });
});

describe('positionAge', () => {
  const ev = (over: Partial<WearableEvent>): WearableEvent => ({ ...(base as WearableEvent), ...over });

  it('describes the latest coordinates, not an older background beat', () => {
    const bg = applyWearableEvent(undefined, ev({ lat: 1.3, lng: 103.8, positionAge: 240, isBackground: true }), 1000, null);
    expect(bg.positionAge).toBe(240);
    const fresh = applyWearableEvent(bg, ev({ lat: 1.31, lng: 103.81, positionAge: 2 }), 2000, null);
    expect(fresh.positionAge).toBe(2);
    const unknown = applyWearableEvent(fresh, ev({ lat: 1.32, lng: 103.82 }), 3000, null);
    expect(unknown.positionAge).toBeNull();
    const noCoords = applyWearableEvent(fresh, ev({}), 3000, null);
    expect(noCoords.positionAge).toBe(2);
  });

  it('records watch accuracy with the coordinates it describes', () => {
    const s1 = applyWearableEvent(undefined, ev({ lat: 1.3, lng: 103.8, accuracy: 13 }), 1000, null);
    expect(s1.accuracy).toBe(13);
    expect(applyWearableEvent(s1, ev({}), 2000, null).accuracy).toBe(13); // no new coords: keep
    expect(applyWearableEvent(s1, ev({ lat: 1.31, lng: 103.81 }), 3000, null).accuracy).toBeNull(); // new coords, unknown accuracy
    expect(typeof parseWearableEvent({ ...base, accuracy: 0 })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, accuracy: 'good' })).toBe('string');
    expect(parseWearableEvent({ ...base, accuracy: 12.6 })).toMatchObject({ accuracy: 13 });
  });

  it('validates the new fields', () => {
    expect(typeof parseWearableEvent({ ...base, positionAge: -1 })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, isBackground: 'yes' })).toBe('string');
    expect(typeof parseWearableEvent({ ...base, sosActive: 'true' })).toBe('string');
    expect(parseWearableEvent({ ...base, positionAge: 12.4, isBackground: true, sosActive: true })).toMatchObject({
      positionAge: 12,
      isBackground: true,
      sosActive: true,
    });
  });

  it('recovers sosActive on cold start if watch indicates sosActive in heartbeat', () => {
    const recovered = applyWearableEvent(
      undefined,
      ev({ eventType: 'HEARTBEAT', sosActive: true }),
      5000,
      null,
    );
    expect(recovered.sosActive).toBe(true);
  });

  it('preserves activeIncidentId while alert continues and clears it on SOS_CANCEL', () => {
    const start = applyWearableEvent(
      undefined,
      ev({ eventType: 'SOS_TRIGGER' }),
      1000,
      null,
    );
    start.activeIncidentId = 'inc_w_test123';

    const ongoing = applyWearableEvent(
      start,
      ev({ eventType: 'HEARTBEAT' }),
      2000,
      null,
    );
    expect(ongoing.sosActive).toBe(true);
    expect(ongoing.activeIncidentId).toBe('inc_w_test123');

    const cancelled = applyWearableEvent(
      ongoing,
      ev({ eventType: 'SOS_CANCEL' }),
      3000,
      null,
    );
    expect(cancelled.sosActive).toBe(false);
    expect(cancelled.activeIncidentId).toBeNull();
  });
});
