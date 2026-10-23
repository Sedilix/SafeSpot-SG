/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFirebaseAdminDb } from './wearableIncidentService';
import {
  generateLinkCode,
  sendTelegramAlert,
  sendTelegramLocation,
  sendTelegramText,
  stopTelegramLiveLocation,
  telegramConfigured,
  updateTelegramLiveLocation,
  escapeHtml,
} from './telegram';
import { pushConfigured, sendWebPush, type PushPayload, type PushSubscriptionJSON } from './webPush';
import { fcmAvailable, sendFcm } from './fcmPush';

// Where a SafeSpot account's alerts go besides SMS. Telegram chats are linked
// to the account (uid), so both watch alerts and alerts sent from the phone
// app reach them. All collections here are server-only (see firestore.rules).
//
//   AlertChannels/{uid}            { telegramChats: TelegramChatLink[], telegramChatIds: string[] }
//   TelegramLinkCodes/{code}       { uid, expiresAt }
//   IncidentTelegram/{incidentId}  { uid, posts: TelegramPost[], lastLocationAt, responders }

export interface TelegramChatLink {
  chatId: string;
  title: string;
  type: 'private' | 'group' | 'supergroup' | 'channel' | string;
  linkedAt: number;
}

interface TelegramPost {
  chatId: string;
  textMessageId?: number;
  locationMessageId?: number;
}

interface IncidentTelegramDoc {
  uid: string;
  elderName: string;
  posts: TelegramPost[];
  lastLocationAt: number;
  responders: Array<{ name: string; chatId: string; at: number }>;
}

export const LINK_CODE_TTL_MS = 15 * 60 * 1000;
/** Live pins are moved at most this often per incident. */
export const LOCATION_UPDATE_MIN_MS = 30 * 1000;
export const MAX_TELEGRAM_CHATS = 10;

const memChannels = new Map<string, TelegramChatLink[]>();
const memCodes = new Map<string, { uid: string; expiresAt: number }>();
const memIncidents = new Map<string, IncidentTelegramDoc>();

export function _resetAlertChannelsForTest(): void {
  memChannels.clear();
  memCodes.clear();
  memIncidents.clear();
}

export async function getTelegramChats(uid: string): Promise<TelegramChatLink[]> {
  const db = getFirebaseAdminDb();
  if (!db) return memChannels.get(uid) || [];
  const snap = await db.collection('AlertChannels').doc(uid).get();
  const chats = snap.exists ? (snap.data() as any).telegramChats : null;
  return Array.isArray(chats) ? chats : [];
}

async function saveTelegramChats(uid: string, chats: TelegramChatLink[]): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) {
    memChannels.set(uid, chats);
    return;
  }
  await db.collection('AlertChannels').doc(uid).set(
    { telegramChats: chats, telegramChatIds: chats.map((c) => c.chatId), updatedAt: Date.now() },
    { merge: true },
  );
}

/** A one-time code the caregiver sends to the bot from the chat they want linked. */
export async function createTelegramLinkCode(uid: string, now = Date.now()): Promise<{ code: string; expiresAt: number }> {
  const code = generateLinkCode();
  const entry = { uid, expiresAt: now + LINK_CODE_TTL_MS };
  const db = getFirebaseAdminDb();
  if (db) await db.collection('TelegramLinkCodes').doc(code).set(entry);
  else memCodes.set(code, entry);
  return { code, expiresAt: entry.expiresAt };
}

/** Consumes a link code and links the chat to its account. Returns the uid, or null if the code is invalid/expired. */
export async function redeemTelegramLinkCode(
  code: string,
  chat: { id: number | string; title?: string; first_name?: string; type: string },
  now = Date.now(),
): Promise<{ uid: string; alreadyLinked: boolean } | null> {
  const db = getFirebaseAdminDb();
  let entry: { uid: string; expiresAt: number } | null = null;
  if (db) {
    const ref = db.collection('TelegramLinkCodes').doc(code);
    // Read-and-delete in a transaction so a code can only be used once.
    entry = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref);
      return snap.data() as { uid: string; expiresAt: number };
    });
  } else {
    entry = memCodes.get(code) || null;
    memCodes.delete(code);
  }
  if (!entry || entry.expiresAt < now) return null;

  const chatId = String(chat.id);
  const chats = await getTelegramChats(entry.uid);
  const alreadyLinked = chats.some((c) => c.chatId === chatId);
  if (!alreadyLinked) {
    if (chats.length >= MAX_TELEGRAM_CHATS) return null;
    chats.push({
      chatId,
      title: (chat.title || chat.first_name || 'Telegram chat').slice(0, 80),
      type: chat.type,
      linkedAt: now,
    });
    await saveTelegramChats(entry.uid, chats);
  }
  return { uid: entry.uid, alreadyLinked };
}

export async function removeTelegramChat(uid: string, chatId: string): Promise<boolean> {
  const chats = await getTelegramChats(uid);
  const next = chats.filter((c) => c.chatId !== chatId);
  if (next.length === chats.length) return false;
  await saveTelegramChats(uid, next);
  return true;
}

/** Unlinks a chat from every account (the bot was removed from it). */
export async function removeTelegramChatEverywhere(chatId: string): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) {
    for (const [uid, chats] of memChannels) memChannels.set(uid, chats.filter((c) => c.chatId !== chatId));
    return;
  }
  const snap = await db.collection('AlertChannels').where('telegramChatIds', 'array-contains', chatId).get();
  await Promise.all(snap.docs.map((d) => removeTelegramChat(d.id, chatId)));
}

/** A group became a supergroup and got a new chat ID: keep it linked under the new ID. */
export async function migrateTelegramChat(oldChatId: string, newChatId: string): Promise<void> {
  const db = getFirebaseAdminDb();
  const owners: string[] = [];
  if (!db) {
    for (const [uid, chats] of memChannels) if (chats.some((c) => c.chatId === oldChatId)) owners.push(uid);
  } else {
    const snap = await db.collection('AlertChannels').where('telegramChatIds', 'array-contains', oldChatId).get();
    owners.push(...snap.docs.map((d) => d.id));
  }
  for (const uid of owners) {
    const chats = await getTelegramChats(uid);
    await saveTelegramChats(
      uid,
      chats.map((c) => (c.chatId === oldChatId ? { ...c, chatId: newChatId, type: 'supergroup' } : c)),
    );
  }
}

async function getIncidentTelegram(incidentId: string): Promise<IncidentTelegramDoc | null> {
  const mem = memIncidents.get(incidentId);
  if (mem) return mem;
  const db = getFirebaseAdminDb();
  if (!db) return null;
  const snap = await db.collection('IncidentTelegram').doc(incidentId).get();
  if (!snap.exists) return null;
  const doc = snap.data() as IncidentTelegramDoc;
  memIncidents.set(incidentId, doc);
  return doc;
}

async function saveIncidentTelegram(incidentId: string, doc: IncidentTelegramDoc): Promise<void> {
  memIncidents.set(incidentId, doc);
  const db = getFirebaseAdminDb();
  if (!db) return;
  try {
    await db.collection('IncidentTelegram').doc(incidentId).set(doc);
  } catch (e: any) {
    console.warn(`[TELEGRAM] Failed to save IncidentTelegram/${incidentId}:`, e.message);
  }
}

/** Posts an alert to every Telegram chat linked to the account. Returns how many chats got it. */
export async function notifyTelegramAlert(params: {
  uid: string | null;
  elderName: string;
  incidentId: string;
  text: string;
  lat?: number;
  lng?: number;
  now?: number;
}): Promise<number> {
  if (!params.uid || !telegramConfigured()) return 0;
  const chats = await getTelegramChats(params.uid).catch(() => [] as TelegramChatLink[]);
  if (chats.length === 0) return 0;

  const results = await Promise.all(
    chats.map(async (c) => ({
      chat: c,
      res: await sendTelegramAlert(c.chatId, { text: params.text, incidentId: params.incidentId, lat: params.lat, lng: params.lng }),
    })),
  );

  const posts: TelegramPost[] = [];
  for (const { chat, res } of results) {
    if (res.ok) posts.push({ chatId: chat.chatId, textMessageId: res.textMessageId, locationMessageId: res.locationMessageId });
    else if (res.gone) await removeTelegramChat(params.uid, chat.chatId).catch(() => {});
    else console.warn(`[TELEGRAM] Alert to chat ${chat.chatId} failed`);
  }
  await saveIncidentTelegram(params.incidentId, {
    uid: params.uid,
    elderName: params.elderName,
    posts,
    lastLocationAt: params.now ?? Date.now(),
    responders: [],
  });
  return posts.length;
}

/** Moves the live pins for an ongoing incident (throttled). */
export async function updateTelegramIncidentLocation(incidentId: string, lat: number, lng: number, now = Date.now()): Promise<void> {
  if (!telegramConfigured()) return;
  const doc = await getIncidentTelegram(incidentId).catch(() => null);
  if (!doc || now - doc.lastLocationAt < LOCATION_UPDATE_MIN_MS) return;
  doc.lastLocationAt = now;
  memIncidents.set(incidentId, doc);
  await Promise.all(
    doc.posts.filter((p) => p.locationMessageId).map((p) => updateTelegramLiveLocation(p.chatId, p.locationMessageId!, lat, lng)),
  );
}

/** Stops the live pins and posts the all-clear. */
export async function resolveTelegramIncident(incidentId: string, text: string): Promise<void> {
  if (!telegramConfigured()) return;
  const doc = await getIncidentTelegram(incidentId).catch(() => null);
  if (!doc) return;
  await Promise.all(
    doc.posts.map(async (p) => {
      if (p.locationMessageId) await stopTelegramLiveLocation(p.chatId, p.locationMessageId);
      await sendTelegramText(p.chatId, text);
    }),
  );
  memIncidents.delete(incidentId);
}

/**
 * Records that someone in a linked chat tapped "I'm responding" and tells the
 * chat. Returns false if the incident was never posted to that chat.
 */
export async function recordTelegramResponder(incidentId: string, chatId: string, name: string, now = Date.now()): Promise<boolean> {
  const doc = await getIncidentTelegram(incidentId).catch(() => null);
  if (!doc || !doc.posts.some((p) => p.chatId === chatId)) return false;
  const already = doc.responders.some((r) => r.chatId === chatId && r.name === name);
  if (!already) {
    doc.responders.push({ name: name.slice(0, 60), chatId, at: now });
    await saveIncidentTelegram(incidentId, doc);
    await Promise.all(
      doc.posts.map((p) =>
        sendTelegramText(p.chatId, `🙋 <b>${escapeHtml(name)}</b> is responding to the alert for ${escapeHtml(doc.elderName)}.`),
      ),
    );
  }
  return true;
}

/** Sends a pickup/location message from the phone app to every linked chat. */
export async function sendTelegramPin(uid: string, params: { text: string; lat?: number; lng?: number }): Promise<number> {
  if (!telegramConfigured()) return 0;
  const chats = await getTelegramChats(uid);
  let sent = 0;
  await Promise.all(
    chats.map(async (c) => {
      const res = await sendTelegramText(c.chatId, params.text);
      if (!res.ok) {
        if (res.gone) await removeTelegramChat(uid, c.chatId).catch(() => {});
        return;
      }
      sent++;
      if (params.lat !== undefined && params.lng !== undefined) await sendTelegramLocation(c.chatId, params.lat, params.lng);
    }),
  );
  return sent;
}

// ── Web push devices ─────────────────────────────────────────────────────────
//   AlertChannels/{uid}.pushSubs      PushDevice[] (server-only: endpoints and tokens are capabilities)
//   AlertChannels/{uid}.pushEndpoints string[] (device keys, for lookup when a device unsubscribes)
//   PushInvites/{code}                { uid, expiresAt, uses }
//
// A device is either a browser (web push subscription) or the Android app
// (FCM token). Both share the list, the limit, invites and removal.

/** The Android app's registration. */
export interface FcmTarget {
  fcmToken: string;
}
export type PushTarget = PushSubscriptionJSON | FcmTarget;

export interface PushDevice {
  id: string;
  label: string;
  createdAt: number;
  /** Set for browsers. */
  subscription?: PushSubscriptionJSON;
  /** Set for the Android app. */
  fcmToken?: string;
}

const isFcm = (t: PushTarget): t is FcmTarget => typeof (t as FcmTarget).fcmToken === 'string';

/** One string per device: the web push endpoint, or "fcm:<token>" for the app. */
export function pushDeviceKey(d: { subscription?: PushSubscriptionJSON; fcmToken?: string }): string {
  return d.fcmToken ? `fcm:${d.fcmToken}` : d.subscription?.endpoint || '';
}

const targetKey = (t: PushTarget) => (isFcm(t) ? `fcm:${t.fcmToken}` : t.endpoint);

/** Sends to one device, by web push or FCM. */
export function sendToPushTarget(t: PushTarget, payload: PushPayload): Promise<{ ok: boolean; gone?: boolean }> {
  return isFcm(t) ? sendFcm(t.fcmToken, payload) : sendWebPush(t, payload);
}

function deviceTarget(d: PushDevice): PushTarget | null {
  if (d.fcmToken) return { fcmToken: d.fcmToken };
  return d.subscription || null;
}

/** Family invite links last a week and can be opened by a few people (shared in a group chat). */
export const PUSH_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PUSH_INVITE_MAX_USES = 10;
export const MAX_PUSH_DEVICES = 20;

const memPush = new Map<string, PushDevice[]>();
const memInvites = new Map<string, { uid: string; expiresAt: number; uses: number }>();

export function _resetPushForTest(): void {
  memPush.clear();
  memInvites.clear();
}

export async function getPushDevices(uid: string): Promise<PushDevice[]> {
  const db = getFirebaseAdminDb();
  if (!db) return memPush.get(uid) || [];
  const snap = await db.collection('AlertChannels').doc(uid).get();
  const subs = snap.exists ? (snap.data() as any).pushSubs : null;
  return Array.isArray(subs) ? subs : [];
}

async function savePushDevices(uid: string, devices: PushDevice[]): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) {
    memPush.set(uid, devices);
    return;
  }
  await db.collection('AlertChannels').doc(uid).set(
    { pushSubs: devices, pushEndpoints: devices.map(pushDeviceKey), updatedAt: Date.now() },
    { merge: true },
  );
}

/** Adds (or refreshes) a device. Returns false when the account already has too many. */
export async function addPushDevice(uid: string, target: PushTarget, label: string, now = Date.now()): Promise<boolean> {
  const devices = await getPushDevices(uid);
  const key = targetKey(target);
  const existing = devices.find((d) => pushDeviceKey(d) === key);
  const fields = isFcm(target) ? { fcmToken: target.fcmToken } : { subscription: target };
  if (existing) {
    Object.assign(existing, fields);
    existing.label = label.slice(0, 60) || existing.label;
  } else {
    if (devices.length >= MAX_PUSH_DEVICES) return false;
    devices.push({ id: generateLinkCode().toLowerCase(), label: label.slice(0, 60) || 'Phone', createdAt: now, ...fields });
  }
  await savePushDevices(uid, devices);
  return true;
}

export async function removePushDevice(uid: string, id: string): Promise<boolean> {
  const devices = await getPushDevices(uid);
  const next = devices.filter((d) => d.id !== id);
  if (next.length === devices.length) return false;
  await savePushDevices(uid, next);
  return true;
}

/**
 * A device turning alerts off for itself: knowing the endpoint (or, for the
 * app, "fcm:<token>") proves it's that device.
 */
export async function removePushEndpointEverywhere(endpoint: string): Promise<void> {
  const db = getFirebaseAdminDb();
  const owners: string[] = [];
  if (!db) {
    for (const [uid, list] of memPush) if (list.some((d) => pushDeviceKey(d) === endpoint)) owners.push(uid);
  } else {
    const snap = await db.collection('AlertChannels').where('pushEndpoints', 'array-contains', endpoint).get();
    owners.push(...snap.docs.map((d) => d.id));
  }
  for (const uid of owners) {
    const devices = await getPushDevices(uid);
    await savePushDevices(uid, devices.filter((d) => pushDeviceKey(d) !== endpoint));
  }
}

export async function createPushInvite(uid: string, now = Date.now()): Promise<{ code: string; expiresAt: number }> {
  const code = generateLinkCode();
  const entry = { uid, expiresAt: now + PUSH_INVITE_TTL_MS, uses: 0 };
  const db = getFirebaseAdminDb();
  if (db) await db.collection('PushInvites').doc(code).set(entry);
  else memInvites.set(code, entry);
  return { code, expiresAt: entry.expiresAt };
}

/** The account an invite belongs to, if it's still usable. Doesn't use it up. */
export async function getPushInviteOwner(code: string, now = Date.now()): Promise<string | null> {
  const db = getFirebaseAdminDb();
  const entry = db
    ? ((await db.collection('PushInvites').doc(code).get()).data() as { uid: string; expiresAt: number; uses: number } | undefined)
    : memInvites.get(code);
  if (!entry || entry.expiresAt < now || entry.uses >= PUSH_INVITE_MAX_USES) return null;
  return entry.uid;
}

/** Uses an invite to subscribe a family member's device. Returns the account uid, or null. */
export async function joinPushInvite(
  code: string,
  target: PushTarget,
  label: string,
  now = Date.now(),
): Promise<string | null> {
  const db = getFirebaseAdminDb();
  let uid: string | null = null;
  if (db) {
    const ref = db.collection('PushInvites').doc(code);
    uid = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const e = snap.data() as { uid: string; expiresAt: number; uses: number } | undefined;
      if (!e || e.expiresAt < now || e.uses >= PUSH_INVITE_MAX_USES) return null;
      tx.update(ref, { uses: e.uses + 1 });
      return e.uid;
    });
  } else {
    const e = memInvites.get(code);
    if (e && e.expiresAt >= now && e.uses < PUSH_INVITE_MAX_USES) {
      e.uses++;
      uid = e.uid;
    }
  }
  if (!uid) return null;
  return (await addPushDevice(uid, target, label, now)) ? uid : null;
}

/** Sends a notification to every device on the account; drops unsubscribed ones. Returns how many got it. */
export async function notifyPushDevices(uid: string | null, payload: PushPayload): Promise<number> {
  if (!uid || (!pushConfigured() && !fcmAvailable())) return 0;
  const devices = await getPushDevices(uid).catch(() => [] as PushDevice[]);
  if (devices.length === 0) return 0;
  const results = await Promise.all(
    devices.map((d) => {
      const t = deviceTarget(d);
      return t ? sendToPushTarget(t, payload) : Promise.resolve({ ok: false, gone: true });
    }),
  );
  const gone = devices.filter((_, i) => results[i].gone);
  if (gone.length) {
    await savePushDevices(uid, devices.filter((d) => !gone.includes(d))).catch(() => {});
  }
  return results.filter((r) => r.ok).length;
}
