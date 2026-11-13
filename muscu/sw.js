/* Service worker de l'appli muscu : cache pour marcher sans connexion. */
var CACHE = 'muscu-v4';
var FILES = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'img/chest-1.jpg', 'img/incline-1.jpg', 'img/incline-2.jpg', 'img/pulldown-1.jpg', 'img/pulldown-2.jpg', 'img/row-1.jpg', 'img/row-2.jpg', 'img/lateral-1.jpg', 'img/lateral-2.jpg', 'img/triceps-1.jpg', 'img/triceps-2.jpg', 'img/hammer-1.jpg', 'img/hammer-2.jpg', 'img/wrist-1.jpg', 'img/crunch-1.jpg', 'img/reardelt-1.jpg', 'img/goblet-1.jpg', 'img/legcurl-1.jpg', 'img/legcurl-2.jpg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('muscu-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
