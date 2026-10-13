/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeHtml,
  formatTelegramAlert,
  generateLinkCode,
  isChatGone,
  parseLinkCommand,
  sendTelegramAlert,
  webhookSecretMatches,
  ensureTelegramWebhook,
  getBotUsername,
  googleMapsUrl,
  _resetTelegramForTest,
} from './telegram';

function mockTelegram(handler: (method: string, body: any) => any) {
  const calls: Array<{ method: string; body: any; url: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      const method = url.split('/').pop()!;
      const body = JSON.parse(init.body);
      calls.push({ method, body, url });
      return { json: async () => handler(method, body), status: 200 } as any;
    }),
  );
  return calls;
}

describe('telegram', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_WEBHOOK_SECRET: 'hook-secret-123' };
    _resetTelegramForTest();
  });
  afterEach(() => {
    process.env = env;
    vi.unstubAllGlobals();
  });

  it('parses link commands from private chats and groups', () => {
    expect(parseLinkCommand('/start AB12CD34')).toBe('AB12CD34');
    expect(parseLinkCommand('/start@SafeSpotBot ab12cd34')).toBe('AB12CD34');
    expect(parseLinkCommand('/link AB12CD34 ')).toBe('AB12CD34');
    expect(parseLinkCommand('/start')).toBeNull();
    expect(parseLinkCommand('/start AB12')).toBeNull();
    expect(parseLinkCommand('hello AB12CD34')).toBeNull();
    expect(parseLinkCommand(undefined)).toBeNull();
  });

  it('generates 8-character codes the parser accepts', () => {
    const codes = new Set(Array.from({ length: 50 }, generateLinkCode));
    expect(codes.size).toBe(50);
    for (const c of codes) expect(parseLinkCommand(`/start ${c}`)).toBe(c);
  });

  it('escapes HTML so names cannot inject markup', () => {
    expect(escapeHtml('<b>Tan & Co</b>')).toBe('&lt;b&gt;Tan &amp; Co&lt;/b&gt;');
    const text = formatTelegramAlert({
      elderName: '<i>Uncle</i>',
      eventType: 'FALL_DETECTED',
      incidentId: 'inc_1',
      serverBaseUrl: 'https://safespot.sg',
      locationText: 'Blk 480 Toa Payoh',
      heartRate: 110,
      battery: 40,
      bloodType: 'O+',
      medicalNotes: 'Diabetic',
    });
    expect(text).toContain('Fall detected: &lt;i&gt;Uncle&lt;/i&gt;');
    expect(text).toContain('Blk 480 Toa Payoh');
    expect(text).toContain('O+');
    expect(text).toContain('https://safespot.sg/track/inc_1');
  });

  it('links to Google Maps and leaves out empty medical notes', () => {
    const text = formatTelegramAlert({
      elderName: 'Benjamin',
      eventType: 'SOS_TRIGGER',
      incidentId: 'inc_2',
      serverBaseUrl: 'https://safespot.sg',
      lat: 1.4241,
      lng: 103.8382,
      medicalNotes: 'None',
    });
    expect(text).toContain('https://www.google.com/maps/search/?api=1&query=1.424100,103.838200');
    expect(text).not.toContain('📝');
    expect(googleMapsUrl(1.4241, 103.8382, true)).toBe('https://www.google.com/maps/dir/?api=1&destination=1.424100,103.838200');
  });

  it('adds a Directions button only when the position is known', async () => {
    const calls = mockTelegram(() => ({ ok: true, result: { message_id: 1 } }));
    await sendTelegramAlert(1, { text: 'x', incidentId: 'i', lat: 1.3, lng: 103.8 });
    const rows = calls[0].body.reply_markup.inline_keyboard;
    expect(rows[1][0]).toMatchObject({ text: expect.stringContaining('Directions'), url: expect.stringContaining('/maps/dir/') });
    calls.length = 0;
    await sendTelegramAlert(1, { text: 'x', incidentId: 'i' });
    expect(calls[0].body.reply_markup.inline_keyboard).toHaveLength(1);
  });

  it('verifies the webhook secret', () => {
    expect(webhookSecretMatches('hook-secret-123')).toBe(true);
    expect(webhookSecretMatches('hook-secret-124')).toBe(false);
    expect(webhookSecretMatches(undefined)).toBe(false);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(webhookSecretMatches('')).toBe(false);
  });

  it('treats kicked/blocked chats as gone', () => {
    expect(isChatGone(403, 'Forbidden: bot was kicked from the group chat')).toBe(true);
    expect(isChatGone(400, 'Bad Request: chat not found')).toBe(true);
    expect(isChatGone(429, 'Too Many Requests')).toBe(false);
  });

  it('sends an alert with a respond button, then a live location pin', async () => {
    const calls = mockTelegram((method) => ({ ok: true, result: { message_id: method === 'sendMessage' ? 11 : 12 } }));
    const res = await sendTelegramAlert(-1001, { text: 'hi', incidentId: 'inc_9', lat: 1.33, lng: 103.85 });
    expect(res).toEqual({ ok: true, textMessageId: 11, locationMessageId: 12 });
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendLocation']);
    expect(calls[0].body.reply_markup.inline_keyboard[0][0].callback_data).toBe('resp:inc_9');
    expect(calls[1].body.live_period).toBeGreaterThanOrEqual(60);
  });

  it('reports a gone chat and skips the pin when the message fails', async () => {
    const calls = mockTelegram(() => ({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked' }));
    const res = await sendTelegramAlert(-1001, { text: 'hi', incidentId: 'inc_9', lat: 1.33, lng: 103.85 });
    expect(res).toEqual({ ok: false, gone: true });
    expect(calls).toHaveLength(1);
  });

  it('registers the webhook with the secret and caches the bot username', async () => {
    const calls = mockTelegram((method) => (method === 'getMe' ? { ok: true, result: { username: 'SafeSpotBot' } } : { ok: true, result: true }));
    expect(await ensureTelegramWebhook('https://app.example/')).toBe(true);
    expect(calls[0].body).toMatchObject({ url: 'https://app.example/api/telegram/webhook', secret_token: 'hook-secret-123' });
    expect(await getBotUsername()).toBe('SafeSpotBot');
    expect(await getBotUsername()).toBe('SafeSpotBot');
    expect(calls.filter((c) => c.method === 'getMe')).toHaveLength(1);
  });

  it('does nothing without a bot token', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const calls = mockTelegram(() => ({ ok: true }));
    expect(await ensureTelegramWebhook('https://app.example')).toBe(false);
    expect((await sendTelegramAlert(1, { text: 'x', incidentId: 'i' })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
