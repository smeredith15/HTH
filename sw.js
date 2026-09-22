/* Service worker (SPEC §10).
 *
 * Network-first, deliberately.
 *
 * The usual advice for an app shell is cache-first, and it is wrong here. This
 * app is deployed several times a day and the update ritual is "merge, then
 * refresh". A cache-first worker silently serves yesterday's code to a refresh
 * that looks like it worked, so a fix that shipped appears not to have — the
 * worst failure this app could have, because it is invisible and it makes
 * every other diagnosis wrong.
 *
 * So: the network wins whenever it answers, the cache is what happens when it
 * does not, and every successful response refreshes the cache on its way past.
 * Being offline costs one short timeout; being online costs nothing.
 *
 * Nothing here touches IndexedDB. Photographs, records and the sync token are
 * not in this cache and cannot be affected by it.
 */

const VERSION = 'v1';
const CACHE = `hightide-shell-${VERSION}`;

/** How long to wait for the network before falling back to the cache. */
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await fetch('sw-shell.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    // One bad URL must not fail the whole install, so they go in one at a time.
    await Promise.all(shell.map((url) => cache.add(url).catch(() => {})));
    // Take over immediately: a worker waiting for every tab to close is a
    // worker that never updates on a phone.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('hightide-shell-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // The escape hatch behind Settings → Offline. If anything about this worker
  // goes wrong, it has to be recoverable from a phone with no developer tools.
  if (event.data?.type === 'clear') {
    event.waitUntil((async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll()) client.navigate(client.url);
    })());
  }
  if (event.data?.type === 'version') {
    event.source?.postMessage({ type: 'version', version: VERSION, cache: CACHE });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Same origin only. GitHub's API and anything else stays untouched — a
  // cached sync response would be a stale catalog, or worse, a stale write.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    // `cache: 'no-store'` is load-bearing. `fetch(request)` consults the
    // browser's own HTTP cache first, and this site is served without
    // Cache-Control headers, so the browser applies heuristic freshness and
    // hands back the copy it already had — network-first in name only. That
    // failure is invisible: the refresh looks like it worked and the deploy
    // is simply absent. Measured: a changed stylesheet did not arrive until
    // this was added.
    //
    // A new Request rather than an override, because a navigation request's
    // mode cannot be carried into a constructed one.
    const fresh = new Request(request.url, { cache: 'no-store', credentials: 'same-origin' });
    const response = await withTimeout(fetch(fresh), NETWORK_TIMEOUT_MS);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
      return response;
    }
    // A 404 from the network is the truth; do not paper over it with a cache
    // hit, or a deleted file lives forever on one device.
    if (response) return response;
  } catch {
    // Offline, or the network took longer than anyone will wait for.
  }

  const cached = await cache.match(request);
  if (cached) return cached;

  // A deep link with no cached entry still has to render: the app is a single
  // page and the router reads the hash, so index.html is always the right
  // answer for a navigation.
  if (request.mode === 'navigate') {
    const shell = await cache.match('index.html') ?? await cache.match('./');
    if (shell) return shell;
  }

  return new Response('Offline, and this has not been cached yet.', {
    status: 504, headers: { 'Content-Type': 'text/plain' },
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), ms)),
  ]);
}
