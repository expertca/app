const CACHE_NAME = 'ledger-cache-v1';

// Add your core files here. If you use a separate style.css, add it to this list.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js'
];

// 1. INSTALL EVENT - Caches your core files when the user first opens the app
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. ACTIVATE EVENT - Cleans up old caches if you update the CACHE_NAME version
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// 3. FETCH EVENT - Intercepts network requests
self.addEventListener('fetch', (event) => {
  // CRITICAL: Do NOT cache Google Apps Script API calls or WhatsApp links
  if (event.request.url.includes('script.google.com') || event.request.url.includes('wa.me')) {
    return; 
  }

  // Network-First Strategy for everything else
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // If network works, save a fresh copy to cache, then return the response
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // If offline, serve the app from the cache
        return caches.match(event.request);
      })
  );
});
