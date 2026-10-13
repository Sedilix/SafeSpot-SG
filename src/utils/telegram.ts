/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, timingSafeEqual } from 'crypto';

// Telegram Bot API client for SafeSpot alerts. A caregiver links a Telegram
// chat (a family group or a private chat with the bot) to their SafeSpot
// account with a one-time code; alerts are then posted there with a live
// location pin and an "I'm responding" button.

export interface TelegramSendResult {
  ok: boolean;
  /** The bot was removed from the chat or blocked; the link should be dropped. */
  gone?: boolean;
  messageId?: number;
  error?: string;
}

export interface TelegramAlertResult {
  ok: boolean;
  gone?: boolean;
  textMessageId?: number;
  locationMessageId?: number;
}

/** Live location pins stay updatable for this long (Telegram allows up to 24 h). */
export const LIVE_LOCATION_SECONDS = 2 * 60 * 60;

/** Callback data prefix for the "I'm responding" button. */
export const RESPOND_CALLBACK_PREFIX = 'resp:';

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

let cachedBotUsername: string | null = null;

/** The bot's @username (without @), from getMe; null if unconfigured or unreachable. */
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  if (!telegramConfigured()) return null;
  const res = await telegramApi('getMe', {});
  if (res.ok && typeof res.result?.username === 'string') cachedBotUsername = res.result.username;
  return cachedBotUsername;
}

export function _resetTelegramForTest(): void {
  cachedBotUsername = null;
}

/** Calls a Bot API method. Never throws; never logs the token. */
export async function telegramApi(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: any; errorCode?: number; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: 'Telegram is not configured.' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (data.ok) return { ok: true, result: data.result };
    return { ok: false, errorCode: data.error_code ?? res.status, description: data.description };
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

/** True when an error means the bot can no longer post to the chat. */
export function isChatGone(errorCode?: number, description?: string): boolean {
  if (errorCode === 403) return true;
  return errorCode === 400 && /chat not found|group chat was (deleted|upgraded)/i.test(description || '');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Crockford base32 without ambiguous letters; 8 chars = 40 bits. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateLinkCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] & 31];
  return code;
}

/**
 * Extracts a link code from "/start CODE", "/start@SafeSpotBot CODE" or
 * "/link CODE" (case-insensitive code). Returns null for anything else.
 */
export function parseLinkCommand(text: string | undefined): string | null {
  const m = /^\/(?:start|link)(?:@\w+)?\s+([0-9A-Za-z]{8})\s*$/.exec((text || '').trim());
  return m ? m[1].toUpperCase() : null;
}

/** Constant-time comparison of the webhook secret header. */
export function webhookSecretMatches(provided: string | undefined): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Google Maps link that opens the pin (or directions) in the Maps app on any phone. */
export function googleMapsUrl(lat: number, lng: number, directions = false): string {
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return directions
    ? `https://www.google.com/maps/dir/?api=1&destination=${ll}`
    : `https://www.google.com/maps/search/?api=1&query=${ll}`;
}

/** Medical notes like "None" or "-" carry no information; leave them out. */
function isEmptyNote(s: string): boolean {
  return /^\s*(none|nil|na|n\/a|no|-+|nothing)?\s*\.?\s*$/i.test(s);
}

export function formatTelegramAlert(params: {
  elderName: string;
  eventType: 'SOS_TRIGGER' | 'FALL_DETECTED' | 'HR_ALERT' | 'HEARTBEAT' | 'SOS_CANCEL' | string;
  incidentId: string;
  serverBaseUrl: string;
  locationText?: string | null;
  lat?: number;
  lng?: number;
  heartRate?: number;
  battery?: number;
  bloodType?: string;
  medicalNotes?: string;
}): string {
  const name = escapeHtml(params.elderName);
  let header = `🚨 <b>SOS from ${name}</b>\nThey pressed the emergency button on their watch.`;
  if (params.eventType === 'FALL_DETECTED') {
    header = `🚨 <b>Fall detected: ${name}</b>\nTheir watch detected a fall and they did not cancel it.`;
  } else if (params.eventType === 'HR_ALERT') {
    header = `🚨 <b>Heart rate alert: ${name}</b>\nAbnormal heart rate: ${params.heartRate ?? '—'} bpm.`;
  }
  const lines = [header, ''];
  if (params.locationText) lines.push(`📍 ${escapeHtml(params.locationText)}`);
  if (params.lat !== undefined && params.lng !== undefined) {
    lines.push(`🗺️ <a href="${googleMapsUrl(params.lat, params.lng)}">Open in Google Maps</a> (where they were when the alert started)`);
  }
  const vitals = [
    params.heartRate ? `❤️ ${params.heartRate} bpm` : '',
    params.battery != null ? `🔋 ${params.battery}%` : '',
  ].filter(Boolean);
  if (vitals.length) lines.push(vitals.join('  '));
  if (params.bloodType && params.bloodType !== 'Unknown') lines.push(`🩸 Blood type: ${escapeHtml(params.bloodType)}`);
  if (params.medicalNotes && !isEmptyNote(params.medicalNotes)) lines.push(`📝 ${escapeHtml(params.medicalNotes.slice(0, 300))}`);
  lines.push('', `⚡ Live tracking: ${params.serverBaseUrl}/track/${encodeURIComponent(params.incidentId)}`);
  lines.push('The map pin below moves with them until the alert ends.');
  return lines.join('\n');
}

export function formatTelegramResolved(elderName: string): string {
  return `✅ <b>${escapeHtml(elderName)} is OK</b>\nThey cancelled the alert on their watch ("I'm OK"). Live location sharing has stopped.`;
}

/** Posts an alert message with an "I'm responding" button, then a live location pin. */
export async function sendTelegramAlert(
  chatId: number | string,
  params: { text: string; incidentId: string; lat?: number; lng?: number },
): Promise<TelegramAlertResult> {
  const msg = await telegramApi('sendMessage', {
    chat_id: chatId,
    text: params.text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🙋 I'm responding", callback_data: `${RESPOND_CALLBACK_PREFIX}${params.incidentId}` }],
        ...(params.lat !== undefined && params.lng !== undefined
          ? [[{ text: '🧭 Directions (Google Maps)', url: googleMapsUrl(params.lat, params.lng, true) }]]
          : []),
      ],
    },
  });
  if (!msg.ok) return { ok: false, gone: isChatGone(msg.errorCode, msg.description) };

  const result: TelegramAlertResult = { ok: true, textMessageId: msg.result?.message_id };
  if (params.lat !== undefined && params.lng !== undefined) {
    const loc = await telegramApi('sendLocation', {
      chat_id: chatId,
      latitude: params.lat,
      longitude: params.lng,
      live_period: LIVE_LOCATION_SECONDS,
    });
    if (loc.ok) result.locationMessageId = loc.result?.message_id;
  }
  return result;
}

export async function sendTelegramText(chatId: number | string, text: string): Promise<TelegramSendResult> {
  const res = await telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  if (res.ok) return { ok: true, messageId: res.result?.message_id };
  return { ok: false, gone: isChatGone(res.errorCode, res.description), error: res.description };
}

/** Sends a one-off (non-live) location pin. */
export async function sendTelegramLocation(chatId: number | string, lat: number, lng: number): Promise<TelegramSendResult> {
  const res = await telegramApi('sendLocation', { chat_id: chatId, latitude: lat, longitude: lng });
  if (res.ok) return { ok: true, messageId: res.result?.message_id };
  return { ok: false, gone: isChatGone(res.errorCode, res.description), error: res.description };
}

export async function updateTelegramLiveLocation(chatId: number | string, messageId: number, lat: number, lng: number): Promise<boolean> {
  const res = await telegramApi('editMessageLiveLocation', {
    chat_id: chatId,
    message_id: messageId,
    latitude: lat,
    longitude: lng,
  });
  // "message is not modified" just means the position didn't change.
  return res.ok || /not modified/i.test(res.description || '');
}

export async function stopTelegramLiveLocation(chatId: number | string, messageId: number): Promise<void> {
  await telegramApi('stopMessageLiveLocation', { chat_id: chatId, message_id: messageId });
}

export async function answerTelegramCallback(callbackQueryId: string, text: string): Promise<void> {
  await telegramApi('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

/** Points the bot's webhook at this server. Safe to call on every start. */
export async function ensureTelegramWebhook(baseUrl: string): Promise<boolean> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!telegramConfigured() || !secret) return false;
  const res = await telegramApi('setWebhook', {
    url: `${baseUrl.replace(/\/$/, '')}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  });
  if (!res.ok) console.warn('[TELEGRAM] setWebhook failed:', res.description);
  return res.ok;
}
