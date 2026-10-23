/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isNativeApp } from './native';

// Browser side of web push: permission, service worker, subscription.
// Inside the Android app there is no service worker or PushManager, so the
// app registers with Firebase Cloud Messaging instead and sends the server an
// FCM token. Callers get either kind back and post it as-is.

export type PushSupport = 'supported' | 'needs-install' | 'unsupported';

/** What the server stores for this device (POST it with a label). */
export type PushRegistration = { subscription: PushSubscriptionJSON } | { fcmToken: string };

/** Must match FCM_CHANNEL_ID in src/utils/fcmPush.ts. */
export const ANDROID_CHANNEL_ID = 'safespot-alerts';
const TOKEN_KEY = 'safespot.fcmToken';
const NATIVE_NOT_READY =
  'Notifications could not be set up in this version of the app. Please update SafeSpot, or use the website for now.';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

/** iPhones only allow notifications for apps added to the home screen. */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (isNativeApp()) return 'supported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'supported';
}

/** A friendly default name for this device, e.g. "Android phone". */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || isIos()) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Mac OS X/.test(ua)) return 'Mac';
  return 'Browser';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** Asks permission and subscribes this device. Throws a readable error if refused. */
export async function subscribeThisDevice(vapidPublicKey: string | null): Promise<PushRegistration> {
  if (isNativeApp()) return { fcmToken: await registerNative() };
  if (!vapidPublicKey) throw new Error('Phone notifications are not set up yet.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for this site in your browser settings, then try again.');
  }
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  return { subscription: sub.toJSON() as PushSubscriptionJSON };
}

/** This device's key as the server lists it (endpoint, or "fcm:<token>" in the app), if any. */
export async function currentEndpoint(): Promise<string | null> {
  if (isNativeApp()) {
    const token = readToken();
    if (!token) return null;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    return (await PushNotifications.checkPermissions()).receive === 'granted' ? `fcm:${token}` : null;
  }
  if (pushSupport() !== 'supported') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

export async function unsubscribeThisDevice(): Promise<void> {
  if (isNativeApp()) {
    const token = readToken();
    if (!token) return;
    await fetch('/api/alerts/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fcmToken: token }),
    }).catch(() => {});
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.unregister().catch(() => {});
    writeToken(null);
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/alerts/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

// ── Android app (FCM) ────────────────────────────────────────────────────────

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* the token is only a hint for "this phone" in the device list */
  }
}

/** Only paths inside the app (e.g. /track/abc), never another site. */
export function isInAppPath(url: unknown): url is string {
  return typeof url === 'string' && /^\/(?![/\\])/.test(url);
}

/**
 * Asks permission and gets this phone's FCM token. If getting the token fails
 * (no network, Play services missing) or never answers, give up after a while
 * with a readable error instead of spinning forever. Note: a build without
 * android/app/google-services.json crashes natively inside register() (the
 * plugin calls FirebaseMessaging.getInstance() unguarded), which JS can't
 * catch, so every app build must include that file.
 */
async function registerNative(): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted' && perm.receive !== 'denied') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for SafeSpot in your phone settings, then try again.');
  }
  await initNativePush();

  let settle: (token: string | null) => void = () => {};
  const result = new Promise<string | null>((resolve) => (settle = resolve));
  const handles = await Promise.all([
    PushNotifications.addListener('registration', (t) => settle(t.value)),
    PushNotifications.addListener('registrationError', (e) => {
      console.warn('[PUSH] FCM registration failed:', e?.error);
      settle(null);
    }),
  ]);
  const timer = setTimeout(() => settle(null), 15_000);
  try {
    PushNotifications.register().catch((e) => {
      console.warn('[PUSH] FCM register() failed:', e?.message || e);
      settle(null);
    });
    const token = await result;
    if (!token) throw new Error(NATIVE_NOT_READY);
    writeToken(token);
    return token;
  } finally {
    clearTimeout(timer);
    await Promise.all(handles.map((h) => h.remove().catch(() => {})));
  }
}

let nativeInit: Promise<void> | null = null;

/**
 * App only: creates the high-importance channel alerts are posted to, and
 * opens the alert's page (data.url) when a notification is tapped. Runs when
 * this module loads, so a tap that cold-starts the app is handled too.
 */
export function initNativePush(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  nativeInit ??= (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = action.notification?.data?.url;
      if (isInAppPath(url) && url !== window.location.pathname) window.location.assign(url);
    });
    await PushNotifications.createChannel({
      id: ANDROID_CHANNEL_ID,
      name: 'SafeSpot alerts',
      description: 'Emergency alerts from SafeSpot',
      importance: 5,
      visibility: 1,
      vibration: true,
    }).catch((e) => console.warn('[PUSH] Could not create the notification channel:', e?.message || e));
  })().catch((e) => {
    nativeInit = null;
    console.warn('[PUSH] Native push setup failed:', e?.message || e);
  });
  return nativeInit;
}

if (typeof window !== 'undefined') void initNativePush();
