const CACHE_NAME = 'openresume-v3';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './templates/templates.json'
];

// Pre-cache all 60 template files so PWA works 100% offline
const TEMPLATE_FILES = [];
for (let i = 1; i <= 50; i++) {
  const num = String(i).padStart(2, '0');
  TEMPLATE_FILES.push(`./templates/tpl-${num}.html`);
}
for (let i = 1; i <= 10; i++) {
  const num = String(i).padStart(2, '0');
  TEMPLATE_FILES.push(`./templates/tpl-ats-${num}.html`);
}

const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/lucide@0.344.0/dist/umd/lucide.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

const ALL_INITIAL_CACHE = [...APP_SHELL_ASSETS, ...TEMPLATE_FILES, ...CDN_ASSETS];

// Helper to determine request classification
function isCdnRequest(url) {
  return (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    CDN_ASSETS.includes(url.href)
  );
}

function isAppShellRequest(url) {
  const path = url.pathname;
  return (
    path === '/' ||
    path.endsWith('/index.html') ||
    path.endsWith('/manifest.json') ||
    APP_SHELL_ASSETS.includes(path) ||
    APP_SHELL_ASSETS.includes('.' + path)
  );
}

function isTemplateRequest(url) {
  return url.pathname.includes('/templates/');
}

// Install Event: cache app shell & assets, skipWaiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching app shell, templates, and CDN assets');
        return cache.addAll(ALL_INITIAL_CACHE);
      })
      .catch((err) => {
        console.warn('[ServiceWorker] Pre-caching warning:', err);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event: delete old caches, clients.claim
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[ServiceWorker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  // Pass non-GET requests through gracefully
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // 1. Cache-first strategy for template files
  if (isTemplateRequest(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (e) {
          return new Response('{"error": "Offline template unavailable"}', {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    );
    return;
  }

  // 2. Stale-while-revalidate for CDN assets (Google Fonts, Lucide, cdnjs, gstatic)
  if (isCdnRequest(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => null);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 3. Cache-first strategy for app shell assets
  if (isAppShellRequest(url)) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 4. Network fallback to cache for everything else
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
