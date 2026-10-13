/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import webpush from 'web-push';

// Standard Web Push (VAPID). Works in Chrome/Edge/Firefox on Android and
// desktop, and in Safari on iPhone when SafeSpot is added to the home screen.
// Free: messages go through the browser vendor's push service.

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other (one per incident). */
  tag: string;
  /** Keep the notification on screen until the user acts on it. */
  urgent?: boolean;
}

let configured: string | null = null;

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY as string) : null;
}

function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  const key = `${process.env.VAPID_PUBLIC_KEY}|${process.env.VAPID_PRIVATE_KEY}`;
  if (configured !== key) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'https://github.com/Sedilix/SafeSpot-SG',
      process.env.VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    configured = key;
  }
  return true;
}

/** Shape check for a subscription sent by a browser. */
export function isValidSubscription(sub: any): sub is PushSubscriptionJSON {
  return (
    sub &&
    typeof sub.endpoint === 'string' &&
    /^https:\/\/[^\s]{10,500}$/.test(sub.endpoint) &&
    typeof sub.keys?.p256dh === 'string' &&
    typeof sub.keys?.auth === 'string' &&
    sub.keys.p256dh.length < 200 &&
    sub.keys.auth.length < 100
  );
}

/** Sends one notification. `gone` means the browser unsubscribed; drop it. */
export async function sendWebPush(sub: PushSubscriptionJSON, payload: PushPayload): Promise<{ ok: boolean; gone?: boolean }> {
  if (!ensureVapid()) return { ok: false };
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: payload.urgent ? 'high' : 'normal',
      timeout: 8000,
    });
    return { ok: true };
  } catch (err: any) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) return { ok: false, gone: true };
    console.warn(`[PUSH] Send failed: ${status ?? ''} ${String(err?.body || err?.message || '').slice(0, 120)}`);
    return { ok: false };
  }
}
