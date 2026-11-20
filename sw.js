// Madi Work Tracker — service worker (merged: your original + full offline support)
// Pages/app shell: network-first (a new deployment shows up on the next open); the cache is only the offline fallback.
// data.json: network-first too — online it is always fresh; the last copy is kept ONLY as an offline fallback
//            (so a device with no local data can still read its data without internet).
// api.github.com (sync) is NEVER touched. Fonts / html2canvas CDN are cached at runtime so the app looks the same offline.
const CACHE = 'madi-shell-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './data.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
const NAV_TIMEOUT_MS = 5000; // slow/"fake" connection: after 5s show the cached page instead of hanging

self.addEventListener('install', e => {
  // add files one by one so a single missing file can't break the whole install
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // cross-origin: GitHub API & everything else untouched; only fonts/CDN cached at runtime (stale-while-revalidate)
  if (url.origin !== self.location.origin) {
    if (RUNTIME_HOSTS.includes(url.hostname)) {
      e.respondWith(
        caches.open(CACHE).then(c => c.match(req).then(hit => {
          const net = fetch(req).then(res => {
            if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
            return res;
          }).catch(() => null);
          return hit || net.then(r => r || Response.error());
        }))
      );
    }
    return;
  }

  // database: network first (always fresh online), last copy only when offline
  if (url.pathname.endsWith('/data.json')) {
    const key = new URL('./data.json', self.registration.scope).href;
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
          return res;
        })
        .catch(() => caches.match(key).then(r => r || Response.error()))
    );
    return;
  }

  if (req.mode === 'navigate') {
    const fallback = () => caches.match('./index.html').then(r => r || caches.match('./'));
    e.respondWith(
      Promise.race([fetch(req), timeout(NAV_TIMEOUT_MS)])
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
          return res;
        })
        .catch(() => fallback().then(r => r || fetch(req)))
    );
    return;
  }

  // static files (icons, manifest): cache first, refresh in the background
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
