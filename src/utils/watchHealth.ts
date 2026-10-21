/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDevicePairedProfile, getFirebaseAdminDb } from './wearableIncidentService';
import { notifyPushDevices, sendTelegramPin } from './alertChannels';
import { escapeHtml } from './telegram';
import { maskPhone, sendSms, smsAlertRecipients } from './notifications';

// Warnings to family about the watch itself, so a flat or disconnected
// watch doesn't fail silently. In power-saving mode watches switch off
// Bluetooth and GPS, and then SOS and fall alerts can't be sent at all.
//
//   WatchHealth/{deviceId} (server-only): lastSeenAt, lastBattery,
//     lowBatteryNotifiedAt (cleared when the battery recovers),
//     offlineNotifiedAt (cleared when the watch reports again)

export const LOW_BATTERY_PCT = 15;
/** The low-battery warning re-arms once the battery is back above this. */
export const BATTERY_RECOVERED_PCT = 30;
/** The watch checks in every 5 min in the background; 4 missed check-ins = offline. */
export const OFFLINE_AFTER_MS = 20 * 60_000;
/** Ignore watches silent for longer than this (put away, not in use). */
export const OFFLINE_LOOKBACK_MS = 3 * 24 * 60 * 60_000;
/** Don't write lastSeenAt to Firestore more often than this per watch. */
const SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

interface HealthState {
  lastSeenAt?: number;
  lastBattery?: number | null;
  lowBatteryNotifiedAt?: number | null;
  offlineNotifiedAt?: number | null;
  lastWriteAt?: number;
}

const cache = new Map<string, HealthState>();

export function _resetWatchHealthForTest(): void {
  cache.clear();
}

/** 23:00–07:00 Singapore time: non-emergency warnings wait until morning. */
export function isQuietHours(now: number): boolean {
  const h = new Date(now + 8 * 3600_000).getUTCHours();
  return h >= 23 || h < 7;
}

function sgtTime(ms: number): string {
  const d = new Date(ms + 8 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function loadState(deviceId: string): Promise<HealthState> {
  const cached = cache.get(deviceId);
  if (cached) return cached;
  const state: HealthState = {};
  const db = getFirebaseAdminDb();
  if (db) {
    try {
      const d = (await db.collection('WatchHealth').doc(deviceId).get()).data() as any;
      if (d) {
        state.lastSeenAt = d.lastSeenAt;
        state.lastBattery = d.lastBattery ?? null;
        state.lowBatteryNotifiedAt = d.lowBatteryNotifiedAt ?? null;
        state.offlineNotifiedAt = d.offlineNotifiedAt ?? null;
      }
    } catch (e: any) {
      console.warn(`[WATCH_HEALTH] Could not read ${deviceId}:`, e.message);
    }
  }
  cache.set(deviceId, state);
  return state;
}

async function saveState(deviceId: string, patch: Partial<HealthState>, now: number): Promise<void> {
  const state = { ...(await loadState(deviceId)), ...patch, lastWriteAt: now };
  cache.set(deviceId, state);
  const db = getFirebaseAdminDb();
  if (!db) return;
  const { lastWriteAt, ...doc } = state;
  try {
    // Separate from WearableDevices: writing there would create documents for
    // unpaired watches and change how their alerts are routed.
    await db.collection('WatchHealth').doc(deviceId).set(doc, { merge: true });
  } catch (e: any) {
    console.warn(`[WATCH_HEALTH] Could not save ${deviceId}:`, e.message);
  }
}

/** Sends a non-emergency notice to the family on every channel. Returns how many deliveries succeeded. */
export async function notifyFamily(
  deviceId: string,
  notice: { title: string; text: string; sms: boolean; tag: string },
): Promise<number> {
  const profile = await getDevicePairedProfile(deviceId);
  if (!profile.uid) return 0; // Unpaired watch: no family to tell.
  const html = `<b>${escapeHtml(notice.title)}</b>\n${escapeHtml(notice.text)}`;
  const tasks: Promise<number>[] = [
    sendTelegramPin(profile.uid, { text: html }).catch(() => 0),
    notifyPushDevices(profile.uid, { title: notice.title, body: notice.text, url: '/', tag: notice.tag }).catch(() => 0),
  ];
  if (notice.sms) {
    for (const c of smsAlertRecipients(profile.emergencyContacts)) {
      tasks.push(
        sendSms({ to: c.phone, body: `SafeSpot.SG: ${notice.title}. ${notice.text}` })
          .then((r) => {
            if (!r.success) console.warn(`[WATCH_HEALTH] SMS to ${maskPhone(r.recipient)} not sent: ${r.carrierStatus}`);
            return r.success ? 1 : 0;
          })
          .catch(() => 0),
      );
    }
  }
  const sent = (await Promise.all(tasks)).reduce((a, b) => a + b, 0);
  console.log(`[WATCH_HEALTH] ${notice.tag} for ${deviceId}: ${sent} deliveries`);
  return sent;
}

/**
 * Called for every event from a watch. Records when it was last seen and its
 * battery, warns the family once per discharge when the battery is low, and
 * tells them when a watch that was reported offline is back.
 */
export async function recordWatchSeen(deviceId: string, battery: number | undefined, now = Date.now()): Promise<void> {
  const state = await loadState(deviceId);
  const patch: Partial<HealthState> = { lastSeenAt: now };
  if (typeof battery === 'number') patch.lastBattery = battery;
  let mustWrite = !state.lastWriteAt || now - state.lastWriteAt >= SEEN_WRITE_INTERVAL_MS;

  if (state.offlineNotifiedAt) {
    patch.offlineNotifiedAt = null;
    mustWrite = true;
    const name = (await getDevicePairedProfile(deviceId)).elderName;
    await notifyFamily(deviceId, {
      title: `✅ ${name}'s watch is reporting again`,
      text: typeof battery === 'number' ? `Battery ${battery}%.` : 'SOS and fall alerts work again.',
      sms: false,
      tag: 'watch-online',
    });
  }

  if (typeof battery === 'number') {
    if (battery >= BATTERY_RECOVERED_PCT && state.lowBatteryNotifiedAt) {
      patch.lowBatteryNotifiedAt = null;
      mustWrite = true;
    } else if (battery <= LOW_BATTERY_PCT && !state.lowBatteryNotifiedAt && !isQuietHours(now)) {
      patch.lowBatteryNotifiedAt = now;
      mustWrite = true;
      const name = (await getDevicePairedProfile(deviceId)).elderName;
      await notifyFamily(deviceId, {
        title: `🔋 ${name}'s watch battery is at ${battery}%`,
        text:
          'Please remind them to charge it. When the battery is low the watch may switch off Bluetooth and GPS, ' +
          "and then SOS and fall alerts can't be sent.",
        sms: true,
        tag: 'watch-battery',
      });
    }
  }

  if (mustWrite) await saveState(deviceId, patch, now);
  else cache.set(deviceId, { ...state, ...patch });
}

/**
 * Run every few minutes (Cloud Scheduler). Warns the family about paired
 * watches that stopped reporting, once per silence.
 */
export async function checkOfflineWatches(now = Date.now()): Promise<{ checked: number; notified: number }> {
  if (isQuietHours(now)) return { checked: 0, notified: 0 };
  const db = getFirebaseAdminDb();
  const candidates: Array<{ deviceId: string; lastSeenAt: number; lastBattery?: number | null; offlineNotifiedAt?: number | null }> = [];
  if (db) {
    const snap = await db
      .collection('WatchHealth')
      .where('lastSeenAt', '<', now - OFFLINE_AFTER_MS)
      .where('lastSeenAt', '>', now - OFFLINE_LOOKBACK_MS)
      .get();
    for (const d of snap.docs) candidates.push({ deviceId: d.id, ...(d.data() as any) });
  } else {
    for (const [deviceId, s] of cache) {
      if (s.lastSeenAt && s.lastSeenAt < now - OFFLINE_AFTER_MS && s.lastSeenAt > now - OFFLINE_LOOKBACK_MS) {
        candidates.push({ deviceId, lastSeenAt: s.lastSeenAt, lastBattery: s.lastBattery, offlineNotifiedAt: s.offlineNotifiedAt });
      }
    }
  }

  let notified = 0;
  for (const c of candidates) {
    if (c.offlineNotifiedAt) continue;
    const profile = await getDevicePairedProfile(c.deviceId);
    if (!profile.uid) continue;
    const battery = typeof c.lastBattery === 'number' ? ` Its battery was ${c.lastBattery}%.` : '';
    await notifyFamily(c.deviceId, {
      title: `⚠️ ${profile.elderName}'s watch has stopped reporting`,
      text:
        `Last heard from at ${sgtTime(c.lastSeenAt)}.${battery} It may be switched off, flat, in power-saving mode, ` +
        "or away from their phone. SOS and fall alerts won't work until it reconnects.",
      sms: true,
      tag: 'watch-offline',
    });
    await saveState(c.deviceId, { offlineNotifiedAt: now }, now);
    notified++;
  }
  return { checked: candidates.length, notified };
}
