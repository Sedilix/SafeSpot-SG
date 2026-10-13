/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Service Worker — SafeSpot.SG PWA
 *
 * Strategy:
 *  - App shell (HTML, manifest, icons): Cache-first with network fallback.
 *  - JS/CSS/font assets (immutable, hashed): Cache-first.
 *  - API calls, Google Maps, Speechmatics, Firebase: Always network (bypassed).
 *  - Navigation requests: Network-first, fallback to cached /index.html.
 */

const CACHE_NAME = 'onthedot-safespot-v3';

// Static app shell — everything needed to render the initial frame offline.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Take control immediately — don't wait for tabs to reload.
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  // Claim all open clients so they use this SW immediately.
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Always bypass: non-GET, API calls, external services ──
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('speechmatics.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('maps.googleapis.com') ||
    url.hostname.includes('maps.gstatic.com')
  ) {
    return; // Let the browser handle it normally.
  }

  // ── Navigation requests (HTML pages): Network-first, fallback to shell ──
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a fresh copy of the HTML on every successful navigation.
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // ── Vite hashed assets (JS/CSS/fonts/images): Cache-first ──
  // These URLs contain a content hash and are immutable once cached.
  const isHashedAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.match(/\.(woff2?|ttf|otf)$/);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // ── Everything else (icons, manifest, root): Cache-first ──
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
    )
  );
});

// ─── Push notifications (emergency alerts) ──────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SafeSpot alert', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'SafeSpot alert';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'safespot',
      renotify: true,
      requireInteraction: Boolean(data.urgent),
      vibrate: data.urgent ? [400, 200, 400, 200, 400] : [200],
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url === target && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
