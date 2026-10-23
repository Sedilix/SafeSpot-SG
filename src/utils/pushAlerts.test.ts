/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...args: any[]) => sendNotification(...args) },
}));

import {
  addPushDevice,
  createPushInvite,
  getPushDevices,
  getPushInviteOwner,
  joinPushInvite,
  notifyPushDevices,
  removePushDevice,
  removePushEndpointEverywhere,
  pushDeviceKey,
  PUSH_INVITE_MAX_USES,
  PUSH_INVITE_TTL_MS,
  _resetPushForTest,
} from './alertChannels';
import { isValidSubscription } from './webPush';
import { buildFcmMessage, isValidFcmToken, sendFcm, FCM_CHANNEL_ID, _setFcmSendForTest } from './fcmPush';
import { isInAppPath } from '../lib/push';
import { handleWatchAlertTrigger, pairWearableDevice, _setAdminDbForTest } from './wearableIncidentService';

const fcmSend = vi.fn();
const app = (n: number) => ({ fcmToken: `fcm-token-${n}-${'x'.repeat(40)}` });
const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });

describe('web push alerts', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
    delete process.env.TELEGRAM_BOT_TOKEN;
    _setAdminDbForTest(null);
    _resetPushForTest();
    sendNotification.mockReset().mockResolvedValue({});
    fcmSend.mockReset().mockResolvedValue('projects/x/messages/1');
    _setFcmSendForTest(null);
  });
  afterEach(() => {
    process.env = env;
    _setFcmSendForTest(null);
  });

  it('validates browser subscriptions', () => {
    expect(isValidSubscription(sub(1))).toBe(true);
    expect(isValidSubscription({ endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } })).toBe(false);
    expect(isValidSubscription({ endpoint: 'https://ok.example/abcdefghij' })).toBe(false);
  });

  it('family join with an invite link: reusable up to the limit, then refused; expires after a week', async () => {
    const { code } = await createPushInvite('uid-1', 0);
    expect(await getPushInviteOwner(code, 1)).toBe('uid-1');
    for (let i = 0; i < PUSH_INVITE_MAX_USES; i++) expect(await joinPushInvite(code, sub(i), 'Phone', 1)).toBe('uid-1');
    expect(await joinPushInvite(code, sub(99), 'Phone', 1)).toBeNull();
    expect(await getPushDevices('uid-1')).toHaveLength(PUSH_INVITE_MAX_USES);

    const { code: old } = await createPushInvite('uid-2', 0);
    expect(await getPushInviteOwner(old, PUSH_INVITE_TTL_MS + 1)).toBeNull();
    expect(await joinPushInvite(old, sub(1), 'Phone', PUSH_INVITE_TTL_MS + 1)).toBeNull();
  });

  it('re-subscribing the same browser updates it instead of duplicating', async () => {
    await addPushDevice('uid-1', sub(1), 'Phone');
    await addPushDevice('uid-1', sub(1), 'Mum’s phone');
    const devices = await getPushDevices('uid-1');
    expect(devices).toHaveLength(1);
    expect(devices[0].label).toBe('Mum’s phone');
    expect(await removePushDevice('uid-1', devices[0].id)).toBe(true);
    await addPushDevice('uid-1', sub(2), 'Phone');
    await removePushEndpointEverywhere(sub(2).endpoint);
    expect(await getPushDevices('uid-1')).toEqual([]);
  });

  it('notifies every device and drops ones the browser unsubscribed', async () => {
    await addPushDevice('uid-1', sub(1), 'A');
    await addPushDevice('uid-1', sub(2), 'B');
    sendNotification.mockImplementation(async (s: any) => {
      if (s.endpoint.endsWith('device-2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return {};
    });
    const n = await notifyPushDevices('uid-1', { title: 'T', body: 'B', url: '/', tag: 'x', urgent: true });
    expect(n).toBe(1);
    expect((await getPushDevices('uid-1')).map((d) => d.label)).toEqual(['A']);
    const [, payload, opts] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toMatchObject({ title: 'T', url: '/', urgent: true });
    expect(opts.urgency).toBe('high');
  });

  it('a watch SOS notifies the account’s phones with a link to the tracking page', async () => {
    await pairWearableDevice({ deviceId: 'SS-PUSH-0000-0001', uid: 'uid-9', elderName: 'Benjamin', emergencyContacts: [] });
    await addPushDevice('uid-9', sub(5), 'Phone');
    const result = await handleWatchAlertTrigger({
      event: { deviceId: 'SS-PUSH-0000-0001', eventType: 'FALL_DETECTED', lat: 1.42, lng: 103.83, timestamp: 1 } as any,
      formattedAddress: '90 Yishun Central',
      serverBaseUrl: 'https://safespot.sg',
    });
    expect(result.pushDevicesNotified).toBe(1);
    const payload = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(payload.title).toBe('🚨 Fall detected: Benjamin');
    expect(payload.body).toContain('90 Yishun Central');
    expect(payload.url).toBe(`/track/${result.incidentId}`);
  });

  it('does nothing without VAPID keys', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    await addPushDevice('uid-1', sub(1), 'A');
    expect(await notifyPushDevices('uid-1', { title: 'T', body: 'B', url: '/', tag: 'x' })).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  describe('Android app (FCM)', () => {
    beforeEach(() => _setFcmSendForTest(fcmSend));

    it('validates app tokens', () => {
      expect(isValidFcmToken(app(1).fcmToken)).toBe(true);
      expect(isValidFcmToken('short')).toBe(false);
      expect(isValidFcmToken('has spaces in it, which tokens never do')).toBe(false);
      expect(isValidFcmToken(42)).toBe(false);
    });

    it('stores app devices next to browsers: listed, refreshed, removed by token, joined by invite', async () => {
      await addPushDevice('uid-1', sub(1), 'Browser');
      await addPushDevice('uid-1', app(1), 'Android phone');
      await addPushDevice('uid-1', app(1), 'Dad’s phone');
      const devices = await getPushDevices('uid-1');
      expect(devices.map((d) => d.label)).toEqual(['Browser', 'Dad’s phone']);
      expect(pushDeviceKey(devices[1])).toBe(`fcm:${app(1).fcmToken}`);

      const { code } = await createPushInvite('uid-1', 0);
      expect(await joinPushInvite(code, app(2), 'Family phone', 1)).toBe('uid-1');
      expect(await getPushDevices('uid-1')).toHaveLength(3);

      await removePushEndpointEverywhere(`fcm:${app(1).fcmToken}`);
      expect((await getPushDevices('uid-1')).map((d) => d.label)).toEqual(['Browser', 'Family phone']);
    });

    it('fans out to both kinds and drops tokens FCM says are gone', async () => {
      await addPushDevice('uid-1', sub(1), 'Browser');
      await addPushDevice('uid-1', app(1), 'App A');
      await addPushDevice('uid-1', app(2), 'App B');
      fcmSend.mockImplementation(async (m: any) => {
        if (m.token === app(2).fcmToken) throw Object.assign(new Error('gone'), { code: 'messaging/registration-token-not-registered' });
        return 'ok';
      });
      const n = await notifyPushDevices('uid-1', { title: 'T', body: 'B', url: '/track/abc', tag: 'abc', urgent: true });
      expect(n).toBe(2);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      expect((await getPushDevices('uid-1')).map((d) => d.label)).toEqual(['Browser', 'App A']);
    });

    it('works without VAPID keys (web devices are skipped, app devices still get it)', async () => {
      delete process.env.VAPID_PRIVATE_KEY;
      await addPushDevice('uid-1', sub(1), 'Browser');
      await addPushDevice('uid-1', app(1), 'App');
      expect(await notifyPushDevices('uid-1', { title: 'T', body: 'B', url: '/', tag: 'x' })).toBe(1);
      expect(sendNotification).not.toHaveBeenCalled();
      expect(await getPushDevices('uid-1')).toHaveLength(2);
    });

    it('builds a high-priority Android notification on the alerts channel, with url/tag in data', () => {
      const m: any = buildFcmMessage('tok', { title: 'T', body: 'B', url: '/track/abc', tag: 'abc', urgent: true });
      expect(m.token).toBe('tok');
      expect(m.notification).toEqual({ title: 'T', body: 'B' });
      expect(m.data).toEqual({ url: '/track/abc', tag: 'abc' });
      expect(m.android.priority).toBe('high');
      expect(m.android.notification).toMatchObject({ channelId: FCM_CHANNEL_ID, tag: 'abc', priority: 'max' });
    });

    it('treats a bad token as gone, other failures as retryable', async () => {
      fcmSend.mockRejectedValueOnce(Object.assign(new Error('The registration token is not a valid FCM registration token'), { code: 'messaging/invalid-argument' }));
      expect(await sendFcm('tok', { title: 'T', body: 'B', url: '/', tag: 'x' })).toEqual({ ok: false, gone: true });
      fcmSend.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'messaging/internal-error' }));
      expect(await sendFcm('tok', { title: 'T', body: 'B', url: '/', tag: 'x' })).toEqual({ ok: false });
    });

    it('nothing is sent when neither VAPID nor FCM is available', async () => {
      _setFcmSendForTest(null);
      delete process.env.VAPID_PRIVATE_KEY;
      await addPushDevice('uid-1', app(1), 'App');
      expect(await notifyPushDevices('uid-1', { title: 'T', body: 'B', url: '/', tag: 'x' })).toBe(0);
      expect(fcmSend).not.toHaveBeenCalled();
    });

    it('a tapped notification only opens pages inside the app', () => {
      expect(isInAppPath('/track/abc')).toBe(true);
      expect(isInAppPath('/')).toBe(true);
      expect(isInAppPath('//evil.example/x')).toBe(false);
      expect(isInAppPath('/\\evil.example')).toBe(false);
      expect(isInAppPath('https://evil.example')).toBe(false);
      expect(isInAppPath(undefined)).toBe(false);
    });
  });
});
