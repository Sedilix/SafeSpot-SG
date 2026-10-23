/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getMessaging, type Message } from 'firebase-admin/messaging';
import { getFirebaseAdminDb } from './wearableIncidentService';
import type { PushPayload } from './webPush';

// Push to the Android app through Firebase Cloud Messaging. The app has no
// service worker, so it registers an FCM token instead of a web subscription.
// Uses the same firebase-admin app as Firestore (Cloud Run's default
// credentials), so it needs no VAPID keys or extra secrets.

/** Must match the channel the app creates (src/lib/push.ts). */
export const FCM_CHANNEL_ID = 'safespot-alerts';

type FcmSend = (message: Message) => Promise<string>;
let sendOverride: FcmSend | null = null;

export function _setFcmSendForTest(fn: FcmSend | null): void {
  sendOverride = fn;
}

/** True when firebase-admin is up, so FCM messages can be sent. */
export function fcmAvailable(): boolean {
  return Boolean(sendOverride) || getFirebaseAdminDb() !== null;
}

/** Shape check for a token sent by the app (FCM tokens are ~150-250 URL-safe chars). */
export function isValidFcmToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_:-]{20,1000}$/.test(token);
}

export function buildFcmMessage(token: string, payload: PushPayload): Message {
  return {
    token,
    notification: { title: payload.title, body: payload.body },
    // Read by the app's pushNotificationActionPerformed handler.
    data: { url: payload.url, tag: payload.tag },
    android: {
      priority: 'high',
      ttl: 60 * 60 * 1000,
      collapseKey: payload.tag,
      notification: {
        channelId: FCM_CHANNEL_ID,
        tag: payload.tag,
        priority: payload.urgent ? 'max' : 'high',
        visibility: 'public',
        defaultSound: true,
      },
    },
  };
}

/** Sends one notification. `gone` means the app was uninstalled or the token rotated; drop it. */
export async function sendFcm(token: string, payload: PushPayload): Promise<{ ok: boolean; gone?: boolean }> {
  if (!fcmAvailable()) return { ok: false };
  try {
    const send: FcmSend = sendOverride || ((m) => getMessaging().send(m));
    await send(buildFcmMessage(token, payload));
    return { ok: true };
  } catch (err: any) {
    const code = String(err?.code || err?.errorInfo?.code || '');
    const message = String(err?.message || '');
    if (
      code === 'messaging/registration-token-not-registered' ||
      code === 'messaging/invalid-registration-token' ||
      (code === 'messaging/invalid-argument' && /token/i.test(message))
    ) {
      return { ok: false, gone: true };
    }
    console.warn(`[FCM] Send failed: ${code} ${message.slice(0, 120)}`);
    return { ok: false };
  }
}
