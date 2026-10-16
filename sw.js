// Service worker : Piaf fonctionne hors ligne après la première visite.
// - modèle et bibliothèques (gros, immuables) : cache d'abord ;
// - pages, scripts, styles (légers) : réseau d'abord, cache si hors ligne ;
// - photos iNaturalist et polices : cache d'abord, remplies au fil de l'eau.
// Changer VERSION à chaque modification du modèle ou de vendor/ pour forcer le renouvellement.
const VERSION = 'v1';
const APP = `piaf-app-${VERSION}`;
const HEAVY = `piaf-heavy-${VERSION}`;
const EXTERNAL = 'piaf-external';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/audio.js', 'js/birdnet-core.js',
  'js/capture-worklet.js', 'js/engine-worker.js', 'js/lifelist.js', 'js/species-info.js', 'js/spectrogram.js',
  'manifest.webmanifest', 'icons/icon.svg', 'model/species.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = [APP, HEAVY, EXTERNAL];
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    const heavy = /\/(model|vendor)\//.test(url.pathname) && !url.pathname.endsWith('species.json');
    event.respondWith(heavy ? cacheFirst(request, HEAVY) : networkFirst(request));
  } else if (/inaturalist|fonts\.(googleapis|gstatic)\.com/.test(url.hostname) && request.destination !== '') {
    // Images et polices uniquement : les réponses de l'API iNaturalist passent par le réseau.
    event.respondWith(cacheFirst(request, EXTERNAL));
  }
});
