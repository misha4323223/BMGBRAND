// BOOOMERANGS Service Worker — Web Push Notifications
const CACHE_VERSION = 'booom-sw-v2';

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
