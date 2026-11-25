// desk2 service worker: no caching (data and shell always from network); clears the old desk app's caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Grok Bot · now', { body: d.body || '', icon: 'icons/icon-192.png', data: { url: d.url } }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); const u = e.notification.data && e.notification.data.url; if (u) e.waitUntil(clients.openWindow(u)); });
