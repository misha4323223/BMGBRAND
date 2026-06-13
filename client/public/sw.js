// BOOOMERANGS Service Worker — Web Push Notifications
const CACHE_VERSION = 'booom-sw-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'BOOOMERANGS', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'BOOOMERANGS';
  const options = {
    body: data.body || 'Новое сообщение от BOOOMERANGS',
    icon: data.icon || '/favicon.ico',
    badge: '/favicon.ico',
    image: data.image || undefined,
    data: { url: data.url || 'https://booomerangs.ru' },
    vibrate: [100, 50, 100],
    requireInteraction: false,
    tag: data.tag || 'booom-push',
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://booomerangs.ru';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
