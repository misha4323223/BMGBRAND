// BOOOMERANGS Service Worker — Web Push Notifications
const CACHE_VERSION = 'booom-sw-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// App-shell caching for repeat visits.
// - /assets/* (hashed, immutable build output): cache-first, refresh in
//   background — never stale because the filename changes on every deploy.
// - Page navigations: network-first, cache only as an offline fallback so
//   users always get the latest HTML when online.
// - Everything else (API, auth, images on other origins): pass through.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        });
        return cached || network;
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((c) => c || Response.error())
      )
    );
  }
});

self.addEventListener('push', function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'BOOOMERANGS', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'BOOOMERANGS';
  const body  = data.body  || 'Новое сообщение от BOOOMERANGS';
  const url   = data.url   || 'https://booomerangs.ru';

  const options = {
    body,
    icon:  data.icon  || 'https://booomerangs.ru/icon-192.png',
    badge: data.badge || 'https://booomerangs.ru/notification-badge.png',
    ...(data.image ? { image: data.image } : {}),
    data:  { url },
    vibrate: [200, 100, 200],
    requireInteraction: false,
    silent: false,
    tag: data.tag || 'booom-push',
    renotify: true,
    actions: [
      { action: 'open',    title: '👀 Смотреть' },
      { action: 'dismiss', title: '✕ Закрыть'  },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://booomerangs.ru';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Если вкладка с нужным URL уже открыта — фокусируемся на ней
      for (const client of clients) {
        if (client.url.startsWith(url.replace(/\/$/, '')) && 'focus' in client) {
          return client.focus();
        }
      }
      // Иначе открываем новую вкладку
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
