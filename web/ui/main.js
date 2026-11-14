// Entry point: load the two WebAssembly modules, open storage, draw the frame, and start routing.

import { loadEngine } from '../engine.js';
import { loadKernel } from '../kernel.js';
import { openStore } from '../store.js';
import { startShell } from '../shell.js';
import * as repoSettings from './reposettings.js';
import { listRefUpdates } from '../store.js';
import { load, splitRef } from './repo.js';
import * as code from './code.js';
import * as past from './history.js';
import * as issues from './issues.js';
import * as pulls from './pulls.js';
import * as house from './home.js';
import { counter, unsynced } from './components.js';
import { PRODUCT } from './strings.js';
import { route, notFound, onError, afterEach, start } from './router.js';
import { drawFrame, drawUpdateNotice, setRepoContext, setScreenKeys, startChrome } from './chrome.js';
import { profile, signedIn, applyTheme, watchTheme } from './session.js';
import { home, welcome, newRepository, openRepository, settings, notFoundPage, errorPage } from './pages.js';
import { gallery } from './gallery.js';

applyTheme();
watchTheme();

const frame = async (path) => drawFrame({ user: (await signedIn()) ? { name: profile().name } : null, ...(path === undefined ? {} : { firstRun: path === '/welcome' }) });

const member = (screen) => async (context) => ((await signedIn()) ? screen(context) : home(context));
route('/', member(house.dashboard));
route('/explore', member((context) => house.explore({ ...context, params: { what: 'repos' } })));
route('/explore/:what', member(house.explore));
route('/notifications', member(house.notifications));
route('/search', member(house.search));
route('/welcome', welcome);
route('/new', newRepository);
route('/open', openRepository);
route('/settings', (context) => settings({ ...context, params: { tab: 'profile' } }));
route('/settings/:tab', settings);
route('/-/gallery', gallery);
route('/issues', async (context) => ((await signedIn()) ? issues.everywhere(context) : home(context)));
route('/pulls', async (context) => ((await signedIn()) ? pulls.everywhere(context) : home(context)));
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
    case 'issues': return more[0] === 'new' ? issues.create(context) : more[0] ? issues.view(context, more[0]) : issues.list(context);
    case 'labels': return issues.labels(context);
    case 'milestones': return more[0] === 'new' ? issues.milestoneForm(context, null) : more[1] === 'edit' ? issues.milestoneForm(context, more[0]) : issues.milestones(context);
    case 'milestone': return issues.milestone(context, more[0]);
    case 'pulls': return pulls.list(context);
    case 'pull': return ({ commits: pulls.commits, checks: pulls.checksTab, files: pulls.files }[more[1]] || pulls.conversation)(context, more[0]);
    case 'resolve': return repoSettings.resolve(context);
    case 'settings': return more[0] === 'collaborators' ? repoSettings.collaborators(context) : more[0] === 'branches' ? repoSettings.branchRules(context, more.slice(1)) : more[0] === 'remote' ? repoSettings.remote(context) : more[0] ? notFoundPage() : repoSettings.general(context);
    default: return notFoundPage();
  }
}
route('/:owner/:repo/*rest', repository);
route('/:owner/:repo', repository);
route('/:owner', house.profilePage);
notFound(notFoundPage);
onError(errorPage);

let first = true;
afterEach(async ({ path, result }) => {
  document.title = result.title ? `${result.title} · ${PRODUCT}` : PRODUCT;
  setRepoContext(result.repo || null);
  setScreenKeys(result.keys || []);
  // The Issues tab shows how many are open. It is filled in after the screen, because reading the log takes a moment.
  const tab = result.repo && document.querySelector('#main nav.tabs a[data-key="issues"]');
  if (tab) issues.openIssueCount(result.repo.name).then((n) => { if (n && tab.isConnected && !tab.querySelector('.counter')) tab.append(counter(n)); });
  // Changes made here and not yet sent to the remote are marked, quietly, beside the repository's name.
  if (result.repo && result.repo.published !== undefined) listRefUpdates(result.repo.name).then((log) => { const title = document.querySelector('#main .repo-head .title'); if (title && log.length > result.repo.published && !title.querySelector('.unsynced')) title.append(unsynced()); });
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
