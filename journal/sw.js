// Reset Journal offline shell. Scope: /journal/ only.
// Same-origin files: network first (so updates show at once), cache as the offline fallback.
// Firebase SDK files from gstatic: cache first (they are versioned URLs). Firestore/Auth traffic is never touched.
const CACHE = "reset-journal-v1.1.1";
const SHELL = [
  "./", "index.html", "journal.css", "journal.js", "calc.js", "manifest.webmanifest",
  "img/emblem-128.webp", "img/emblem-360.webp", "img/icon-64.png", "img/icon-192.png",
  "img/avatar-rusher.webp", "img/avatar-performer.webp", "img/avatar-competitor.webp", "img/avatar-intellectualizer.webp"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("reset-journal-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (!url.pathname.includes("/journal/")) return; // rest of the site is not ours to cache
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))));
    return;
  }
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
