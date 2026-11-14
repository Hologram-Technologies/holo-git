// Entry point: load the two WebAssembly modules, open storage, draw the frame, and start routing.

import { loadEngine } from '../engine.js';
import { loadKernel } from '../kernel.js';
import { openStore } from '../store.js';
import { startShell } from '../shell.js';
import { renderLegacy } from '../app.js';
import { PRODUCT } from './strings.js';
import { route, notFound, onError, afterEach, start } from './router.js';
import { drawFrame, drawUpdateNotice, setRepoContext, startChrome } from './chrome.js';
import { profile, signedIn, applyTheme, watchTheme } from './session.js';
import { home, welcome, newRepository, openRepository, settings, notFoundPage, errorPage } from './pages.js';
import { gallery } from './gallery.js';

applyTheme();
watchTheme();

const frame = async () => drawFrame({ user: (await signedIn()) ? { name: profile().name } : null });

route('/', home);
route('/welcome', welcome);
route('/new', newRepository);
route('/open', openRepository);
route('/settings', (context) => settings({ ...context, params: { tab: 'profile' } }));
route('/settings/:tab', settings);
route('/-/gallery', gallery);
// Repository screens, still the older ones: /{name}/{view}/{ref}/{path}.
route('/:repo/*rest', renderLegacy);
route('/:repo', renderLegacy);
notFound(notFoundPage);
onError(errorPage);

let first = true;
afterEach(async ({ params, result }) => {
  document.title = result.title ? `${result.title} · ${PRODUCT}` : PRODUCT;
  setRepoContext(result.repo || null);
  await frame();
  // After a navigation, a keyboard or screen-reader user starts at the new screen, not at the old link.
  if (!first && !document.activeElement.closest('#main')) document.getElementById('main').focus({ preventScroll: true });
  first = false;
  void params;
});
document.addEventListener('profilechange', frame);

await Promise.all([loadEngine(new URL('../engine.wasm', import.meta.url).href), loadKernel(new URL('../kernel.wasm', import.meta.url).href)]);
await openStore();
startChrome();
await frame();
await start();
document.documentElement.dataset.ready = '';
startShell(drawUpdateNotice);
