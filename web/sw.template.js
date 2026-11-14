// The kernel of this origin. It pins the page's files by SHA-256 and serves only bytes that
// still match their pin. `scripts/shell-manifest.mjs` writes the manifest into this file, so
// any change to the page changes this file and arrives as a new version the visitor must accept.

const MANIFEST = /*MANIFEST*/null;
const CACHE = `shell-${MANIFEST.closure}`;
const scope = self.registration.scope;
const pinned = new Map(MANIFEST.files.map((file) => [new URL(file.path, scope).href, file]));

async function digest(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Fetch one pinned file from the host and keep it only if it matches its pin.
async function admit(url, file) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${file.path}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (await digest(bytes) !== file.sha256) throw new Error(`${file.path} does not match its pinned digest`);
  await (await caches.open(CACHE)).put(url, new Response(bytes, { headers: { 'content-type': file.type } }));
  return bytes;
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all(Array.from(pinned, ([url, file]) => admit(url, file))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('shell-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

// A new version never takes over by itself. The page asks the visitor first.
self.addEventListener('message', (event) => {
  if (event.data === 'accept') self.skipWaiting();
  if (event.data === 'closure' && event.ports[0]) event.ports[0].postMessage(MANIFEST.closure);
});

async function serve(url, file) {
  try {
    const cached = await (await caches.open(CACHE)).match(url);
    let bytes = cached ? await cached.arrayBuffer() : await admit(url, file);
    if (await digest(bytes) !== file.sha256) {
      // The stored copy was altered. Try the host once; it must still match the pin.
      bytes = await admit(url, file);
    }
    return new Response(bytes, { headers: { 'content-type': file.type, 'x-pinned-sha256': file.sha256 } });
  } catch (error) {
    return new Response(`Refused: ${error.message}`, { status: 500, headers: { 'content-type': 'text/plain' } });
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.hash = '';
  url.search = '';
  let key = url.href;
  if (key === scope) key = `${scope}index.html`;
  if (key === `${scope}shell.json`) {
    event.respondWith(new Response(JSON.stringify(MANIFEST), { headers: { 'content-type': 'application/json' } }));
    return;
  }
  const file = pinned.get(key);
  if (file) event.respondWith(serve(key, file));
  // Everything else (replicas, other origins) goes to the network untouched:
  // repository bytes are verified by their own labels, not by this pin.
});
