/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapEventToIncidentType,
  formatEmergencySms,
  formatResolvedSms,
  handleWatchAlertTrigger,
  handleWatchIncidentUpdate,
  handleWatchAlertCancel,
  pairWearableDevice,
  unpairWearableDevice,
  getDevicePairedProfile,
  getIncidentById,
  getActiveIncidentForDevice,
  _setAdminDbForTest,
} from './wearableIncidentService';
import * as notifications from './notifications';

describe('wearableIncidentService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    _setAdminDbForTest(null);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('mapEventToIncidentType', () => {
    it('maps SOS_TRIGGER to manual_sos', () => {
      expect(mapEventToIncidentType('SOS_TRIGGER')).toBe('manual_sos');
    });

    it('maps FALL_DETECTED to fall', () => {
      expect(mapEventToIncidentType('FALL_DETECTED')).toBe('fall');
    });

    it('maps HR_ALERT to heart_rate', () => {
      expect(mapEventToIncidentType('HR_ALERT')).toBe('heart_rate');
    });

    it('defaults unknown/heartbeat to manual_sos', () => {
      expect(mapEventToIncidentType('HEARTBEAT')).toBe('manual_sos');
    });
  });

  describe('formatEmergencySms', () => {
    it('includes senior name, emergency header, landmark, maps link, live tracking, and vitals', () => {
      const sms = formatEmergencySms({
        elderName: 'Uncle Tan',
        eventType: 'SOS_TRIGGER',
        incidentId: 'inc_test123',
        serverBaseUrl: 'https://safespot.sg',
        landmark: 'Toa Payoh Hub',
        lat: 1.3329,
        lng: 103.8485,
        heartRate: 88,
        battery: 75,
      });

      expect(sms).toContain('EMERGENCY SOS: Senior Uncle Tan');
      expect(sms).toContain('Toa Payoh Hub');
      expect(sms).toContain('https://maps.google.com/?q=1.3329,103.8485');
      expect(sms).toContain('https://safespot.sg/track/inc_test123');
      expect(sms).toContain('88 bpm');
      expect(sms).toContain('75%');
    });

    it('labels a last-known position with its age, and says so when there is none', () => {
      const old = formatEmergencySms({
        elderName: 'Uncle Tan',
        eventType: 'SOS_TRIGGER',
        incidentId: 'inc_x',
        serverBaseUrl: 'https://safespot.sg',
        formattedAddress: '90 Yishun Central',
        lat: 1.42,
        lng: 103.83,
        positionAge: 25 * 60,
      });
      expect(old).toContain('90 Yishun Central (last known location, 25 min ago)');

      const none = formatEmergencySms({ elderName: 'Uncle Tan', eventType: 'SOS_TRIGGER', incidentId: 'inc_y', serverBaseUrl: 'https://safespot.sg' });
      expect(none).toContain('Location unknown (no GPS fix)');
    });

    it('formats fall alert header specifically', () => {
      const sms = formatEmergencySms({
        elderName: 'Auntie Mei',
        eventType: 'FALL_DETECTED',
        incidentId: 'inc_fall456',
        serverBaseUrl: 'https://safespot.sg',
        formattedAddress: 'Blk 123 Ang Mo Kio Ave 4',
      });

      expect(sms).toContain('FALL ALERT: Fall & impact detected for Senior Auntie Mei');
      expect(sms).toContain('Blk 123 Ang Mo Kio Ave 4');
    });

    it('formats heart rate alert header specifically', () => {
      const sms = formatEmergencySms({
        elderName: 'Uncle Tan',
        eventType: 'HR_ALERT',
        incidentId: 'inc_hr789',
        serverBaseUrl: 'https://safespot.sg',
        heartRate: 155,
      });

      expect(sms).toContain('HEALTH ALERT: Abnormal heart rate detected (155 bpm)');
    });
  });

  describe('formatResolvedSms', () => {
    it('formats resolution message correctly', () => {
      const sms = formatResolvedSms({
        elderName: 'Uncle Tan',
        incidentId: 'inc_test123',
        serverBaseUrl: 'https://safespot.sg',
      });

      expect(sms).toContain('Senior Uncle Tan confirmed they are OK');
      expect(sms).toContain('Incident Resolved');
      expect(sms).toContain('https://safespot.sg/track/inc_test123');
    });
  });

  describe('pairing & alert flow', () => {
    it('pairs a device and retrieves profile', async () => {
      await pairWearableDevice({
        deviceId: 'fenix-test-device',
        elderName: 'Ah Kow',
        bloodType: 'O+',
        medicalNotes: 'Diabetic',
        emergencyContacts: [
          {
            id: 'c1',
            name: 'Son Benny',
            relationship: 'Son',
            phone: '98765432',
            emoji: '👦',
            bgColor: '#333',
            isPrimary: true,
          },
        ],
      });

      const profile = await getDevicePairedProfile('fenix-test-device');
      expect(profile.elderName).toBe('Ah Kow');
      expect(profile.bloodType).toBe('O+');
      expect(profile.medicalNotes).toBe('Diabetic');
      expect(profile.emergencyContacts.length).toBe(1);
      expect(profile.emergencyContacts[0].name).toBe('Son Benny');
    });

    it('creates an incident and dispatches SMS alerts on watch trigger', async () => {
      const sendSpy = vi.spyOn(notifications, 'sendSms').mockResolvedValue({
        success: true,
        messageId: 'SMmock',
        carrierStatus: 'SENT_CARRIER_SMS',
        recipient: '+6598765432',
      });

      const res = await handleWatchAlertTrigger({
        event: {
          deviceId: 'fenix-test-device',
          eventType: 'SOS_TRIGGER',
          lat: 1.35,
          lng: 103.85,
          heartRate: 110,
          battery: 82,
          timestamp: 1700000000,
        },
        landmark: 'Bishan Junction 8',
        serverBaseUrl: 'https://safespot.sg',
      });

      expect(res.incidentId).toMatch(/^inc_w_/);
      expect(res.smsDispatched).toBe(true);
      expect(res.contactsNotified).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Verify incident document
      const doc = await getIncidentById(res.incidentId);
      expect(doc).not.toBeNull();
      expect(doc?.elderName).toBe('Ah Kow');
      expect(doc?.status).toBe('active');
      expect(doc?.incidentType).toBe('manual_sos');
      expect(doc?.currentGps?.lat).toBe(1.35);
      expect(doc?.nearestLandmarks).toEqual(['Bishan Junction 8']);
      expect(doc?.batteryLevel).toBe(82);
      expect(doc?.locationSource).toBe('watch_gps');
    });

    it('unpairs a device cleanly', async () => {
      await pairWearableDevice({
        deviceId: 'fenix-to-unpair',
        elderName: 'Grandma Mary',
        bloodType: 'A+',
      });
      let profile = await getDevicePairedProfile('fenix-to-unpair');
      expect(profile.elderName).toBe('Grandma Mary');

      await unpairWearableDevice('fenix-to-unpair');
      profile = await getDevicePairedProfile('fenix-to-unpair');
      // Should revert to fallback profile
      expect(profile.elderName).toBe('Senior');
      expect(profile.uid).toBeNull();
    });

    it('updates ongoing incident with fresh telemetry', async () => {
      const res = await handleWatchAlertTrigger({
        event: {
          deviceId: 'fenix-test-device',
          eventType: 'FALL_DETECTED',
          lat: 1.35,
          lng: 103.85,
          timestamp: 1700000000,
        },
      });

      await handleWatchIncidentUpdate(
        res.incidentId,
        {
          deviceId: 'fenix-test-device',
          eventType: 'HEARTBEAT',
          lat: 1.352,
          lng: 103.852,
          battery: 80,
          timestamp: 1700000060,
        },
        'New Landmark Near Bishan',
      );

      const doc = await getIncidentById(res.incidentId);
      expect(doc?.currentGps?.lat).toBe(1.352);
      expect(doc?.batteryLevel).toBe(80);
      expect(doc?.nearestLandmarks).toEqual(['New Landmark Near Bishan']);
    });

    it("keeps the watch's reported accuracy and fix time (not 10 m and send time)", async () => {
      const t = Math.floor(Date.now() / 1000);
      const res = await handleWatchAlertTrigger({
        event: { deviceId: 'fenix-acc', eventType: 'SOS_TRIGGER', lat: 1.35, lng: 103.85, accuracy: 18, positionAge: 30, timestamp: t },
      });
      await handleWatchIncidentUpdate(res.incidentId, {
        deviceId: 'fenix-acc', eventType: 'HEARTBEAT', lat: 1.3501, lng: 103.85, accuracy: 42, positionAge: 20, timestamp: t + 60,
      });
      const doc = await getIncidentById(res.incidentId);
      expect(doc?.watchFix).toMatchObject({ accuracy: 42, timestamp: (t + 60) * 1000 - 20_000 });
      expect(doc?.currentGps?.accuracy).toBe(42);
      expect(doc?.currentGps?.timestamp).toBe((t + 60) * 1000 - 20_000);
    });

    it('records an unreported watch accuracy as null, never an invented value', async () => {
      const res = await handleWatchAlertTrigger({
        event: { deviceId: 'fenix-noacc', eventType: 'SOS_TRIGGER', lat: 1.35, lng: 103.85, timestamp: Math.floor(Date.now() / 1000) },
      });
      const doc = await getIncidentById(res.incidentId);
      expect(doc?.currentGps?.accuracy).toBeNull();
      expect(doc?.locationSource).toBe('watch_gps');
    });

    it("a watch tick fuses with the phone's fix in a transaction instead of overwriting it", async () => {
      // Minimal Firestore fake: documents by path, merge sets, transactions run inline.
      const store = new Map<string, any>();
      const ref = (path: string) => ({
        get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
        set: async (data: any, opts?: { merge?: boolean }) => {
          store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : data);
        },
        _path: path,
      });
      const db: any = {
        collection: (c: string) => ({ doc: (id: string) => ref(`${c}/${id}`) }),
        runTransaction: async (fn: any) =>
          fn({ get: (r: any) => r.get(), set: (r: any, data: any, opts: any) => { void r.set(data, opts); } }),
      };
      _setAdminDbForTest(db);

      const now = Date.now();
      // The phone (client) already wrote a tight, fresh fix ~78 m away from where the watch will report.
      store.set('Incidents/inc_tx', {
        incidentId: 'inc_tx',
        status: 'active',
        phoneFix: { lat: 1.297, lng: 103.787, accuracy: 5, timestamp: now - 2_000, source: 'phone_gps' },
      });

      await handleWatchIncidentUpdate('inc_tx', {
        deviceId: 'fenix-tx', eventType: 'HEARTBEAT', lat: 1.2965, lng: 103.7865, accuracy: 60, timestamp: Math.floor(now / 1000),
      });

      const saved = store.get('Incidents/inc_tx');
      expect(saved.watchFix).toMatchObject({ lat: 1.2965, accuracy: 60 });
      expect(saved.phoneFix).toMatchObject({ lat: 1.297, accuracy: 5 }); // untouched
      expect(saved.locationSource).toBe('phone_gps'); // 5 m phone beats 60 m watch
      expect(saved.currentGps).toMatchObject({ lat: 1.297, lng: 103.787, accuracy: 5 });
    });

    it('resolves incident and dispatches cancellation SMS on alert cancel', async () => {
      const sendSpy = vi.spyOn(notifications, 'sendSms').mockResolvedValue({
        success: true,
        messageId: 'SMmock_cancel',
        carrierStatus: 'SENT_CARRIER_SMS',
        recipient: '+6598765432',
      });

      const res = await handleWatchAlertTrigger({
        event: {
          deviceId: 'fenix-test-device',
          eventType: 'SOS_TRIGGER',
          lat: 1.35,
          lng: 103.85,
          timestamp: 1700000000,
        },
      });

      await handleWatchAlertCancel(res.incidentId, 'fenix-test-device', 'https://safespot.sg');

      const doc = await getIncidentById(res.incidentId);
      expect(doc?.status).toBe('resolved');
      expect(sendSpy).toHaveBeenCalled();
    });

    it('answers within waitForDeliveryMs while a slow SMS keeps sending in the background', async () => {
      await pairWearableDevice({
        deviceId: 'SS-SLOW-0000-0001',
        elderName: 'Uncle Tan',
        emergencyContacts: [
          { id: 'mei', name: 'Mei', relationship: 'Daughter', phone: '91234567', emoji: '', bgColor: '', isPrimary: true },
        ],
      });
      let finishSms!: () => void;
      const sendSpy = vi.spyOn(notifications, 'sendSms').mockImplementation(
        () =>
          new Promise((resolve) => {
            finishSms = () => resolve({ success: true, carrierStatus: 'SENT_TEXTBEE', recipient: '+6591234567' });
          }),
      );

      const t0 = Date.now();
      const res = await handleWatchAlertTrigger({
        event: { deviceId: 'SS-SLOW-0000-0001', eventType: 'SOS_TRIGGER', lat: 1.35, lng: 103.85, timestamp: 1700000000 },
        waitForDeliveryMs: 30,
      });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(res.deliveryPending).toBe(true);
      expect(res.incidentId).toMatch(/^inc_w_/);
      expect(sendSpy).toHaveBeenCalledTimes(1); // started, not abandoned
      expect((await getIncidentById(res.incidentId))?.status).toBe('active');

      const log = vi.spyOn(console, 'log');
      finishSms();
      await new Promise((r) => setTimeout(r, 10));
      expect(log.mock.calls.some((c) => String(c[0]).includes(`${res.incidentId} delivered: SMS 1`))).toBe(true);
    });

    it('reports delivery normally when everything finishes within the wait', async () => {
      vi.spyOn(notifications, 'sendSms').mockResolvedValue({ success: true, carrierStatus: 'SENT_TEXTBEE', recipient: '+6591234567' });
      await pairWearableDevice({
        deviceId: 'SS-FAST-0000-0001',
        elderName: 'Uncle Tan',
        emergencyContacts: [
          { id: 'mei', name: 'Mei', relationship: 'Daughter', phone: '91234567', emoji: '', bgColor: '', isPrimary: true },
        ],
      });
      const res = await handleWatchAlertTrigger({
        event: { deviceId: 'SS-FAST-0000-0001', eventType: 'SOS_TRIGGER', lat: 1.35, lng: 103.85, timestamp: 1700000000 },
        waitForDeliveryMs: 5000,
      });
      expect(res.deliveryPending).toBeUndefined();
      expect(res.contactsNotified).toBe(1);
    });

    it('retrieves active incident for device when an alert is live', async () => {
      const res = await handleWatchAlertTrigger({
        event: {
          deviceId: 'fenix-coldstart-device',
          eventType: 'SOS_TRIGGER',
          lat: 1.35,
          lng: 103.85,
          timestamp: 1700000000,
        },
      });

      const active = await getActiveIncidentForDevice('fenix-coldstart-device');
      expect(active).not.toBeNull();
      expect(active?.incidentId).toBe(res.incidentId);
      expect(active?.deviceId).toBe('fenix-coldstart-device');

      await handleWatchAlertCancel(res.incidentId, 'fenix-coldstart-device');
      const afterCancel = await getActiveIncidentForDevice('fenix-coldstart-device');
      expect(afterCancel).toBeNull();
    });
  });
});
