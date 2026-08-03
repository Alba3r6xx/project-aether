// Project Aether — Service Worker
//
// Caches the app shell for offline use (Phase D4). Strategy:
//   - App shell (HTML, JS, CSS, fonts): stale-while-revalidate.
//   - Supabase API + Edge Functions: network-first, fall back to cache.
//   - Everything else: cache-first.
//
// SECURITY (AUDIT M6/M7):
//   - User-specific routes (/settings, /dashboard) are NOT cached as shell
//     assets — only fetched via SWR on demand so stale user data doesn't
//     leak on shared devices.
//   - API responses are only cached if response.ok (no caching errors).
//   - API cache entries are evicted after 60 seconds to limit staleness.

const CACHE_VERSION = 'aether-v2';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;
const API_CACHE_MAX_AGE = 60 * 1000; // 60 seconds

// Track when each API response was cached (Request objects don't have a
// 'date' header, so we can't read the timestamp from cache.keys()).
const apiCacheTimestamps = new Map();

// Only cache the public landing page and static assets as shell.
// User-specific routes (/dashboard, /settings, etc.) are fetched on demand
// and go through the SWR/network-first path so they don't leak between
// users on shared devices (AUDIT M7).
const SHELL_ASSETS = [
  '/',
  '/manifest.json',
];

const SHELL_PATTERN = /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|ico)$/i;
const API_PATTERN = /supabase\.co|functions\/v1/;
// Routes that should never be cached (user-specific, auth-sensitive).
const NO_CACHE_ROUTES = ['/settings', '/login', '/signup', '/forgot-password'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !API_PATTERN.test(url.href)) return;

  // Never cache auth-sensitive routes (AUDIT M7).
  if (NO_CACHE_ROUTES.some((route) => url.pathname.startsWith(route))) {
    event.respondWith(fetch(request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  // Supabase API: network-first with cache fallback (AUDIT M6: only cache
  // successful responses, evict stale entries).
  if (API_PATTERN.test(url.href)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(async (cache) => {
              cache.put(request, clone);
              // Track timestamp for eviction (Request objects don't have
              // a 'date' header — BUG FIX: use a Map for timestamps).
              apiCacheTimestamps.set(request.url, Date.now());
              // Evict entries older than API_CACHE_MAX_AGE.
              // BUG FIX: use cache.keys() to find the actual cached Request
              // instead of creating a new Request (which may not match due
              // to different headers/mode/credentials).
              const keys = await cache.keys();
              apiCacheTimestamps.forEach((timestamp, urlKey) => {
                if (Date.now() - timestamp > API_CACHE_MAX_AGE) {
                  const matchKey = keys.find((k) => k.url === urlKey);
                  if (matchKey) cache.delete(matchKey);
                  apiCacheTimestamps.delete(urlKey);
                }
              });
            });
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 }))
        )
    );
    return;
  }

  // App shell assets + landing page: stale-while-revalidate.
  if (SHELL_PATTERN.test(url.pathname) || url.pathname === '/') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: cache-first.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
