/* 247Bet speed helper (service worker). The home page is always re-checked with the server so updates show at once;
   the page (one single index.html file) and pictures and fonts are kept on the phone so repeat visits open quickly. Odds and account calls are never touched.
   Other pages (such as the admin page) are never saved on a phone. */
var V = "247bet-v62", IMG_MAX = 150;
self.addEventListener("install", function (e) {
  /* keep a copy of the home page and logo so the site still opens when the phone has no signal (failures here never block the install) */
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(["index.html", "Assets/logo.png", "manifest.webmanifest", "Assets/icon-192.png", "Assets/apple-touch-icon.png"].map(function (u) { return c.add(new Request(u, { cache: "reload" })).catch(function () {}); })); }).catch(function () {}).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V && k !== "q247-id"; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
function put(req, res) { if (res && res.ok) { var c = res.clone(); caches.open(V).then(function (ca) { ca.put(req, c); }).catch(function () {}); } return res; }
/* keeps the picture cache small: when more than IMG_MAX pictures are saved, the oldest ones are dropped (the pages, logo and icons from install are never dropped) */
function trimImages() {
  return caches.open(V).then(function (ca) {
    return ca.keys().then(function (ks) {
      var imgs = ks.filter(function (k) { var p = new URL(k.url).pathname; return /\.(webp|png|jpe?g|svg|gif|ico)$/i.test(p) && !/\/(logo|icon-192|apple-touch-icon)\./i.test(p); });
      return Promise.all(imgs.slice(0, Math.max(0, imgs.length - IMG_MAX)).map(function (k) { return ca.delete(k); }));
    });
  }).catch(function () {});
}
self.addEventListener("fetch", function (e) {
  var r = e.request; if (r.method !== "GET") return;
  var u = new URL(r.url), same = u.origin === self.location.origin;
  var font = u.hostname === "fonts.gstatic.com" || u.hostname === "fonts.googleapis.com";
  if (!same && !font) return;                                   // Apps Script, M-Pesa and everything else: untouched
  if (r.mode === "navigate") {
    if (/admin/i.test(u.pathname)) return;                      // the admin page is never saved on a phone and never replaced by the player page
    e.respondWith(new Promise(function (resolve) {              // the page: ask the server first; on a slow network show the saved copy after 1.5 s (the fresh one is saved for next time)
      var done = false, saved = function () { return caches.match(r).then(function (m) { return m || caches.match("index.html"); }); };
      var net = fetch(r, { cache: "no-cache" }).then(function (res) { return put(r, res); });
      e.waitUntil(net.catch(function () {}));                 // lets the fresh copy finish saving even after the saved one was shown
      var tm = setTimeout(function () { saved().then(function (m) { if (m && !done) { done = true; resolve(m); } }); }, 1500);
      net.then(function (res) { clearTimeout(tm); if (!done) { done = true; resolve(res); } }, function () { clearTimeout(tm); if (!done) { done = true; saved().then(function (m) { resolve(m || Response.error()); }); } });
    }));
    return;
  }
  if (font) {                                                   // fonts: saved copy first
    e.respondWith(caches.match(r).then(function (m) { return m || fetch(r).then(function (res) { return put(r, res); }); }));
    return;
  }
  if (/\.(webp|png|jpe?g|svg|gif|ico|woff2?)$/i.test(u.pathname)) {   // pictures: show the saved copy now, refresh it quietly
    e.respondWith(caches.match(r).then(function (m) {
      var net = fetch(r).then(function (res) { return put(r, res); }).catch(function () { return m; });
      e.waitUntil(net.then(function () { return trimImages(); }));
      return m || net;
    }));
  }
});
