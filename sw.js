/* 247Bet speed helper (service worker). Pages are always re-checked with the server so updates show at once;
   pictures and fonts are kept on the phone so repeat visits open quickly. Odds and account calls are never touched. */
var V = "247bet-v10";
self.addEventListener("install", function (e) {
  /* keep a copy of the home page and logo so the site still opens when the phone has no signal (failures here never block the install) */
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(["index.html", "Assets/logo.png", "manifest.webmanifest", "Assets/icon-192.png"].map(function (u) { return c.add(new Request(u, { cache: "reload" })).catch(function () {}); })); }).catch(function () {}).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V && k !== "q247-id"; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
function put(req, res) { if (res && res.ok) { var c = res.clone(); caches.open(V).then(function (ca) { ca.put(req, c); }).catch(function () {}); } return res; }
self.addEventListener("fetch", function (e) {
  var r = e.request; if (r.method !== "GET") return;
  var u = new URL(r.url), same = u.origin === self.location.origin;
  var font = u.hostname === "fonts.gstatic.com" || u.hostname === "fonts.googleapis.com";
  if (!same && !font) return;                                   // Apps Script, M-Pesa and everything else: untouched
  if (r.mode === "navigate") {                                  // the page: ask the server first (a quick "unchanged" answer), fall back to the saved copy
    e.respondWith(fetch(r, { cache: "no-cache" }).then(function (res) { return put(r, res); }).catch(function () { return caches.match(r).then(function (m) { return m || caches.match("index.html"); }); }));
    return;
  }
  if (font) {                                                   // fonts: saved copy first
    e.respondWith(caches.match(r).then(function (m) { return m || fetch(r).then(function (res) { return put(r, res); }); }));
    return;
  }
  if (/\.(webp|png|jpe?g|svg|gif|ico|woff2?)$/i.test(u.pathname)) {   // pictures: show the saved copy now, refresh it quietly
    e.respondWith(caches.match(r).then(function (m) {
      var net = fetch(r).then(function (res) { return put(r, res); }).catch(function () { return m; });
      return m || net;
    }));
  }
});
