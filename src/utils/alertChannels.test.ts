/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTelegramLinkCode,
  redeemTelegramLinkCode,
  getTelegramChats,
  removeTelegramChat,
  removeTelegramChatEverywhere,
  migrateTelegramChat,
  notifyTelegramAlert,
  updateTelegramIncidentLocation,
  resolveTelegramIncident,
  recordTelegramResponder,
  LINK_CODE_TTL_MS,
  _resetAlertChannelsForTest,
} from './alertChannels';
import { handleWatchAlertTrigger, pairWearableDevice, _setAdminDbForTest } from './wearableIncidentService';
import { _resetTelegramForTest } from './telegram';

let messageId = 100;
function mockTelegram(fail?: (method: string, body: any) => any) {
  const calls: Array<{ method: string; body: any }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      const method = String(url).split('/').pop()!;
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ method, body });
      const failure = fail?.(method, body);
      return { json: async () => failure ?? { ok: true, result: { message_id: ++messageId } }, status: 200 } as any;
    }),
  );
  return calls;
}

const group = { id: -100123, title: 'Tan Family', type: 'supergroup' };

describe('alertChannels', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, TELEGRAM_BOT_TOKEN: 'test-token' };
    delete process.env.TWILIO_ACCOUNT_SID;
    _setAdminDbForTest(null);
    _resetAlertChannelsForTest();
    _resetTelegramForTest();
  });
  afterEach(() => {
    process.env = env;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('links a chat with a one-time code', async () => {
    const { code } = await createTelegramLinkCode('uid-1', 1000);
    expect(await redeemTelegramLinkCode(code, group, 2000)).toEqual({ uid: 'uid-1', alreadyLinked: false });
    expect(await getTelegramChats('uid-1')).toEqual([{ chatId: '-100123', title: 'Tan Family', type: 'supergroup', linkedAt: 2000 }]);
    // Single use.
    expect(await redeemTelegramLinkCode(code, group, 2000)).toBeNull();
  });

  it('rejects expired and unknown codes', async () => {
    const { code } = await createTelegramLinkCode('uid-1', 0);
    expect(await redeemTelegramLinkCode(code, group, LINK_CODE_TTL_MS + 1)).toBeNull();
    expect(await redeemTelegramLinkCode('ZZZZZZZZ', group)).toBeNull();
    expect(await getTelegramChats('uid-1')).toEqual([]);
  });

  it('unlinks, removes kicked chats, and follows group migrations', async () => {
    for (const uid of ['a', 'b']) {
      const { code } = await createTelegramLinkCode(uid);
      await redeemTelegramLinkCode(code, group);
    }
    await migrateTelegramChat('-100123', '-100999');
    expect((await getTelegramChats('a'))[0].chatId).toBe('-100999');
    expect(await removeTelegramChat('a', '-100999')).toBe(true);
    expect(await removeTelegramChat('a', '-100999')).toBe(false);
    await removeTelegramChatEverywhere('-100999');
    expect(await getTelegramChats('b')).toEqual([]);
  });

  it('posts alerts, moves live pins (throttled), records responders, and resolves', async () => {
    const { code } = await createTelegramLinkCode('uid-1');
    await redeemTelegramLinkCode(code, group);
    const calls = mockTelegram();

    const n = await notifyTelegramAlert({ uid: 'uid-1', elderName: 'Uncle Tan', incidentId: 'inc_1', text: 'SOS', lat: 1.3, lng: 103.8, now: 0 });
    expect(n).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendLocation']);

    calls.length = 0;
    await updateTelegramIncidentLocation('inc_1', 1.31, 103.81, 10_000); // too soon
    expect(calls).toHaveLength(0);
    await updateTelegramIncidentLocation('inc_1', 1.31, 103.81, 31_000);
    expect(calls.map((c) => c.method)).toEqual(['editMessageLiveLocation']);

    calls.length = 0;
    expect(await recordTelegramResponder('inc_1', '-100123', 'Mei Ling')).toBe(true);
    expect(calls[0].body.text).toContain('Mei Ling');
    expect(await recordTelegramResponder('inc_1', '-555', 'Stranger')).toBe(false);

    calls.length = 0;
    await resolveTelegramIncident('inc_1', 'OK now');
    expect(calls.map((c) => c.method)).toEqual(['stopMessageLiveLocation', 'sendMessage']);
    expect(await recordTelegramResponder('inc_1', '-100123', 'Late')).toBe(false);
  });

  it('drops a chat the bot was removed from', async () => {
    const { code } = await createTelegramLinkCode('uid-1');
    await redeemTelegramLinkCode(code, group);
    mockTelegram(() => ({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked' }));
    expect(await notifyTelegramAlert({ uid: 'uid-1', elderName: 'X', incidentId: 'inc_2', text: 'SOS' })).toBe(0);
    expect(await getTelegramChats('uid-1')).toEqual([]);
  });

  it('watch SOS reaches the linked Telegram group of the paired account', async () => {
    const { code } = await createTelegramLinkCode('uid-1');
    await redeemTelegramLinkCode(code, group);
    await pairWearableDevice({ deviceId: 'SS-TEST-0000-0001', uid: 'uid-1', elderName: 'Uncle Tan', emergencyContacts: [] });
    const calls = mockTelegram();

    const result = await handleWatchAlertTrigger({
      event: { deviceId: 'SS-TEST-0000-0001', eventType: 'SOS_TRIGGER', lat: 1.33, lng: 103.85, timestamp: 1 } as any,
      formattedAddress: 'Blk 480 Toa Payoh',
      serverBaseUrl: 'https://safespot.sg',
    });
    expect(result.telegramChatsNotified).toBe(1);
    const alert = calls.find((c) => c.method === 'sendMessage');
    expect(alert?.body.text).toContain('SOS from Uncle Tan');
    expect(alert?.body.text).toContain('Blk 480 Toa Payoh');
  });
});
