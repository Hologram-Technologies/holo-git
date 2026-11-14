// Entry point: load the two WebAssembly modules, open storage, draw the frame, and start routing.

import { loadEngine } from '../engine.js';
import { loadKernel } from '../kernel.js';
import { openStore } from '../store.js';
import { startShell } from '../shell.js';
import * as old from '../app.js';
import { load, splitRef } from './repo.js';
import * as code from './code.js';
import * as past from './history.js';
import { PRODUCT } from './strings.js';
import { route, notFound, onError, afterEach, start } from './router.js';
import { drawFrame, drawUpdateNotice, setRepoContext, setScreenKeys, startChrome } from './chrome.js';
import { profile, signedIn, applyTheme, watchTheme } from './session.js';
import { home, welcome, newRepository, openRepository, settings, notFoundPage, errorPage } from './pages.js';
import { gallery } from './gallery.js';

applyTheme();
watchTheme();

const frame = async (path) => drawFrame({ user: (await signedIn()) ? { name: profile().name } : null, ...(path === undefined ? {} : { firstRun: path === '/welcome' }) });

route('/', home);
route('/welcome', welcome);
route('/new', newRepository);
route('/open', openRepository);
route('/settings', (context) => settings({ ...context, params: { tab: 'profile' } }));
route('/settings/:tab', settings);
route('/-/gallery', gallery);
// Repository screens: /{owner}/{repo}, then a view and what it needs.
async function repository({ params }) {
  const context = await load(params);
  if (!context) return {};
  const [view = '', ...more] = (params.rest || '').split('/');
  const rest = more.join('/');
  const at = () => splitRef(context, rest);
  switch (view) {
    case '': case 'tree': return code.tree(context, at());
    case 'blob': return code.blob(context, at());
    case 'blame': return code.blame(context, at());
    case 'edit': return code.editor(context, at(), { create: false });
    case 'new': return code.editor(context, at(), { create: true });
    case 'commits': return past.commits(context, at());
    case 'commit': return past.commit(context, { ref: more[0] || '' });
    case 'compare': return past.compare(context, rest);
    case 'branches': return past.branches(context);
    case 'tags': return past.tags(context);
    case 'search': return past.search(context);
    case 'pulls': return old.pulls(context);
    case 'pull': return old.pull(context, more[0]);
    case 'resolve': return old.resolve(context, decodeURIComponent(rest));
    case 'settings': return old.settings(context);
    default: return notFoundPage();
  }
}
route('/:owner/:repo/*rest', repository);
route('/:owner/:repo', repository);
route('/:owner', (context) => repository({ ...context, params: { owner: context.params.owner, repo: '' } }));
notFound(notFoundPage);
onError(errorPage);

let first = true;
afterEach(async ({ path, result }) => {
  document.title = result.title ? `${result.title} · ${PRODUCT}` : PRODUCT;
  setRepoContext(result.repo || null);
  setScreenKeys(result.keys || []);
  await frame(path);
  // After a navigation, a keyboard or screen-reader user starts at the new screen, not at the old link.
  if (!first && !document.activeElement.closest('#main')) document.getElementById('main').focus({ preventScroll: true });
  first = false;
});
document.addEventListener('profilechange', () => frame());

await Promise.all([loadEngine(new URL('../engine.wasm', import.meta.url).href), loadKernel(new URL('../kernel.wasm', import.meta.url).href)]);
await openStore();
startChrome();
await frame();
await start();
document.documentElement.dataset.ready = '';
startShell(drawUpdateNotice);
