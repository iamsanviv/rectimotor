// Service worker mínimo: permite instalar la app y carga rápido la interfaz.
// Los datos siempre se piden en línea (no hay modo sin conexión).
const CACHE = 'rectingenieria-v2';
const SHELL = ['/', '/index.html', '/css/app.css?v=2', '/js/app.js?v=2', '/manifest.webmanifest', '/img/logo-emblem.jpg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Red primero; si no hay conexión, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
