// Service worker: caches the app shell only. Never caches desk data (state.json etc. always go to network).
const SHELL = 'desk-shell-v2';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'chart.js', 'manifest.json', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;           // data lives on another origin: never touched
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
