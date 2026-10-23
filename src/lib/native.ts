/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor } from '@capacitor/core';

// Inside the Android app the page is served from https://localhost, so
// relative /api calls and window.location.origin would point at the phone,
// not at the server. These helpers fill in the Cloud Run address instead.

const DEFAULT_SERVER = 'https://safespot-sg-258662267000.asia-southeast1.run.app';

/** True inside the Android (Capacitor) app, false on the website. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** Where /api lives: '' on the website (same origin), the server in the app. */
export const apiBase = (): string =>
  isNativeApp() ? ((import.meta as any).env?.VITE_API_BASE_URL || DEFAULT_SERVER).replace(/\/$/, '') : '';

/** Base for links other people open (tracking pages, invites). */
export const publicBaseUrl = (): string => (isNativeApp() ? apiBase() : window.location.origin);

/**
 * True when the app was built with android/app/google-services.json. Without
 * it the Firebase Authentication plugin fails to load at start-up, and FCM's
 * register() would crash the app natively, so sign-in and push check this
 * first and show a readable error instead.
 */
export const firebaseNativeReady = (): boolean => Capacitor.isPluginAvailable('FirebaseAuthentication');

/**
 * In the app, sends fetch('/api/...') to the server. Called once at start-up,
 * so the existing fetch and authFetch calls need no changes.
 */
export function installApiFetch(): void {
  if (!isNativeApp()) return;
  const base = apiBase();
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) return original(base + input, init);
    if (input instanceof Request && new URL(input.url).origin === window.location.origin && new URL(input.url).pathname.startsWith('/api/')) {
      const u = new URL(input.url);
      return original(new Request(base + u.pathname + u.search, input), init);
    }
    return original(input, init);
  };
}
