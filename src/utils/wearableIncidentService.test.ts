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
  getDevicePairedProfile,
  getIncidentById,
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
      const sendSpy = vi.spyOn(notifications, 'sendTwilioSms').mockResolvedValue({
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

    it('resolves incident and dispatches cancellation SMS on alert cancel', async () => {
      const sendSpy = vi.spyOn(notifications, 'sendTwilioSms').mockResolvedValue({
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
  });
});
