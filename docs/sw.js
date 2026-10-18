// Offline support. Pages, scripts and data are fetched network-first so a new
// deploy or data refresh shows up immediately, falling back to the cache when
// offline. Fonts and the vendored Chart.js never change, so they are served
// cache-first.
const VERSION = 'v4';
const SHELL = `covidgreece-shell-${VERSION}`;
const DATA = `covidgreece-data-${VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'assets/css/style.css',
  'assets/js/app.js',
  'assets/js/charts.js',
  'assets/js/i18n.js',
  'assets/js/lib/format.js',
  'assets/js/lib/state.js',
  'assets/vendor/chart.umd.min.js',
  'assets/img/favicon.svg',
  'assets/img/virus.svg',
  'assets/img/arrow.svg',
  'assets/img/logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![SHELL, DATA].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(DATA);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) || (await caches.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(SHELL);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const immutable =
    url.pathname.includes('/vendor/') || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (immutable) {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});
