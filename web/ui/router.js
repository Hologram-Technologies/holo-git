// Addresses are paths, as on any git host. Back, forward, reload and deep links work on every screen,
// and the scroll position comes back with the screen.
//
// The page may live under a prefix (a project site serves it at /name/). `base` is that prefix, found
// from where this module was loaded, so no address is written with it in mind.

export const base = new URL('..', import.meta.url).pathname;
export const href = (path) => base + String(path).replace(/^\/+/, '');
export const currentPath = () => {
  const path = decodeURI(location.pathname);
  return `/${path.startsWith(base) ? path.slice(base.length) : path.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
};

const routes = [];
let fallback = null;
let failed = null;
let after = () => {};
let token = 0;

// pattern: '/settings/:tab' or '/:repo/*rest'. A handler returns { title } and draws into the page itself.
export function route(pattern, handler) {
  const names = [];
  const source = pattern.split('/').filter(Boolean).map((part) => {
    if (part.startsWith(':')) { names.push(part.slice(1)); return '([^/]+)'; }
    if (part.startsWith('*')) { names.push(part.slice(1)); return '(.*)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  routes.push({ test: new RegExp(`^/${source}/?$`), names, handler });
}
export const notFound = (handler) => { fallback = handler; };
export const onError = (handler) => { failed = handler; };
export const afterEach = (handler) => { after = handler; };

// Screens draw as they go, so two must never draw at once: each waits for the one before, and a request
// that has been overtaken by a newer one is dropped before it starts.
let drawing = Promise.resolve();
function render(options = {}) {
  token += 1;
  const mine = token;
  drawing = drawing.then(() => (mine === token ? draw(options, mine) : undefined)).catch((error) => { console.error(error); });
  return drawing;
}

async function draw({ restore }, mine) {
  const path = currentPath();
  const query = new URLSearchParams(location.search);
  let handler = fallback;
  let params = {};
  for (const candidate of routes) {
    const match = candidate.test.exec(path);
    if (match) { handler = candidate.handler; params = Object.fromEntries(candidate.names.map((name, i) => [name, match[i + 1] || ''])); break; }
  }
  let result;
  try { result = await handler({ path, params, query }); } catch (error) { if (mine !== token) return; result = await failed(error, { path, params, query }); }
  if (mine !== token) return;
  await after({ path, params, result: result || {}, restore });
  if (mine !== token) return;
  // The screen for this address is fully drawn. Tests wait on this instead of guessing.
  document.documentElement.dataset.screen = location.pathname;
  const y = restore && history.state && typeof history.state.y === 'number' ? history.state.y : 0;
  if (location.hash.length > 1 && !restore) { const target = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (target) { target.scrollIntoView(); return; } }
  window.scrollTo(0, y);
}

const remember = () => { try { history.replaceState({ ...(history.state || {}), y: window.scrollY }, ''); } catch { /* detached document */ } };

// Go to a full address on this origin.
function go(url, replace) {
  clearTimeout(remember.timer);
  if (!replace) remember();
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', url);
  return render();
}
// Go to a screen by its path inside the app ('/settings/profile'), whatever prefix the page is served under.
export function navigate(to, { replace = false } = {}) {
  return go(new URL(href(to), location.href), replace);
}
// Draw the current screen again after something changed underneath it.
export const refresh = () => render({ restore: true });

// Addresses the old screens still write: '#/name/tree/main' means '/name/tree/main'.
const legacy = (hash) => (hash.startsWith('#/') ? hash.slice(1) : null);

export function start() {
  history.scrollRestoration = 'manual';
  // A deep link opened before the service worker was in place arrives as ?p=/the/path (see web/404.html).
  const carried = new URLSearchParams(location.search).get('p');
  if (carried && carried.startsWith('/')) history.replaceState({ y: 0 }, '', href(carried));
  else if (legacy(location.hash)) history.replaceState({ y: 0 }, '', href(legacy(location.hash)));

  // A scroll position still waiting to be saved belongs to the screen being left; drop it.
  window.addEventListener('popstate', () => { clearTimeout(remember.timer); if (legacy(location.hash) === null) render({ restore: true }); });
  window.addEventListener('hashchange', () => {
    const path = legacy(location.hash);
    if (path !== null) { history.replaceState({ y: 0 }, '', href(path)); render(); } else if (!location.hash) render({ restore: true });
  });
  window.addEventListener('scroll', () => { clearTimeout(remember.timer); remember.timer = setTimeout(remember, 150); }, { passive: true });
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.getAttribute('aria-disabled') === 'true') return;
    const raw = anchor.getAttribute('href');
    if (raw === '#') return;
    // A link to a place on this screen ("Skip to content"). With a <base> in the page it would otherwise lead to the root.
    if (raw.startsWith('#') && !raw.startsWith('#/')) {
      event.preventDefault();
      const target = document.getElementById(decodeURIComponent(raw.slice(1)));
      if (target) { target.scrollIntoView(); target.focus({ preventScroll: true }); }
      return;
    }
    const old = legacy(raw);
    const url = new URL(old !== null ? href(old) : anchor.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return;
    if (/\/fixtures\//.test(url.pathname)) return;
    event.preventDefault();
    if (url.pathname === location.pathname && url.search === location.search && url.hash) { location.hash = url.hash; return; }
    go(url, false);
  });
  return render({ restore: true });
}
