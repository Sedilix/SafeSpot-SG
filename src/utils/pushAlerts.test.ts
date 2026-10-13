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
  PUSH_INVITE_MAX_USES,
  PUSH_INVITE_TTL_MS,
  _resetPushForTest,
} from './alertChannels';
import { isValidSubscription } from './webPush';
import { handleWatchAlertTrigger, pairWearableDevice, _setAdminDbForTest } from './wearableIncidentService';

const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } });

describe('web push alerts', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
    delete process.env.TELEGRAM_BOT_TOKEN;
    _setAdminDbForTest(null);
    _resetPushForTest();
    sendNotification.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    process.env = env;
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
});
