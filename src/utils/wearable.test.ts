/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseWearableEvent,
  applyWearableEvent,
  isWearableOnline,
  nearestLandmark,
  WEARABLE_STALE_MS,
  WearableEvent,
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
