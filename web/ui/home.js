// Home: the dashboard, a profile, explore, notifications, search across repositories, and the command palette.
// Everything here is worked out in this browser from the repositories it holds. Nothing is asked of anyone else.

import { S } from './strings.js';
import { el, icon, button, box, boxRow, blankslate, textInput, avatar, relativeTime, heatmap, label, tabs, sideNav, dialog, counter } from './components.js';
import { href, navigate, refresh } from './router.js';
import { profile, signedIn, setTheme } from './session.js';
import { repoHref, repoPath, ownerOf, slug, short } from './repo.js';
import { readLog } from './issues.js';
import { listRepos, listRefUpdates, getRefs, getObject } from '../store.js';
import { parseCommit } from '../engine.js';
import { deviceKey } from '../identity.js';
import { history as walk, person } from '../git.js';

const main = () => document.getElementById('main');
function show(kind, ...children) { const node = main(); node.className = `page${kind ? ` ${kind}` : ''}`; node.replaceChildren(...children.flat(Infinity).filter(Boolean)); }
const subject = (message) => message.split('\n')[0];
const DAY = 86400000;
const me = async () => (await deviceKey()).id;

// Each repository with what its log says. A log that does not verify is left out here; its own screens say why.
async function library() {
  const out = [];
  for (const repo of await listRepos()) {
    let state = null;
    try { state = await readLog(repo.name); } catch { /* shown on the repository's own screens */ }
    out.push({ repo, state });
  }
  return out;
}
const nameIn = (state, key, fallback) => (state && state.names.get(key)) || fallback || key.slice(0, 7);

// What happened, newest first: pushes, issues, pull requests, comments and reviews.
async function activity(items, limit = 40) {
  const feed = [];
  for (const { repo, state } of items) {
    if (!state) continue;
    const at = `${ownerOf(repo)}/${repo.name}`;
    const merged = new Map(state.pulls.filter((pull) => pull.merged).map((pull) => [pull.head, pull]));
    for (const record of await listRefUpdates(repo.name)) {
      if ((record.type || 'ref') !== 'ref') continue;
      const pull = merged.get(record.next);
      let text = '';
      try { text = subject(parseCommit(await getObject(record.next)).message); } catch { /* the commit is not here yet */ }
      feed.push({ time: record.time, key: record.key, state, repo, at, icon: pull ? 'git-merge' : 'git-commit', verb: pull ? S.home.merged(pull.number) : S.home.pushed(record.ref.replace('refs/heads/', '')), detail: pull ? pull.title : text, href: pull ? repoHref(repo, 'pull', pull.number) : repoHref(repo, 'commit', record.next) });
    }
    for (const [kind, list] of [['issue', state.issues], ['pull', state.pulls]]) for (const item of list) {
      const to = repoHref(repo, kind === 'issue' ? 'issues' : 'pull', item.number);
      feed.push({ time: item.time, key: item.author, name: item.name, state, repo, at, icon: kind === 'issue' ? 'issue-opened' : 'git-pull-request', verb: kind === 'issue' ? S.home.openedIssue(item.number) : S.home.openedPull(item.number), detail: item.title, href: to });
      for (const event of item.events) {
        const verb = event.kind === 'comment' ? S.home.commented(item.number) : event.kind === 'state' ? (event.to === 'closed' ? S.home.closed(item.number) : S.home.reopened(item.number)) : event.kind === 'review' ? (event.verdict === 'approve' ? S.home.approved(item.number) : event.verdict === 'changes' ? S.home.requestedChanges(item.number) : S.home.reviewed(item.number)) : null;
        if (verb) feed.push({ time: event.time, key: event.key, name: event.name, state, repo, at, icon: event.kind === 'comment' ? 'comment' : event.kind === 'review' ? 'eye' : event.to === 'closed' ? 'issue-closed' : 'issue-reopened', verb, detail: item.title, href: to });
      }
    }
  }
  return feed.sort((a, b) => b.time - a.time).slice(0, limit);
}
const feedRow = (item, mine) => { const name = item.key === mine ? profile().name : nameIn(item.state, item.key, item.name); return el('div', { class: 'box-row feed-row' }, avatar(name, { size: 32 }), el('div', { class: 'main' }, el('div', {}, el('strong', {}, name), ' ', item.verb, ' ', S.home.in, ' ', el('a', { href: repoHref(item.repo) }, item.at), ' ', el('span', { class: 'muted small' }, relativeTime(item.time))), el('a', { class: 'feed-detail', href: item.href }, icon(item.icon), ' ', item.detail))); };

// One count per day for the last 53 weeks, starting on a Sunday so the rows of the heatmap are weekdays.
async function contributions(items, mine, who) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = today.getTime() - (52 * 7 + today.getDay()) * DAY;
  const counts = new Array(52 * 7 + today.getDay() + 1).fill(0);
  const add = (time) => { const at = Math.floor((time - start) / DAY); if (at >= 0 && at < counts.length) counts[at] += 1; };
  for (const { repo, state } of items) {
    try { const refs = await getRefs(repo.name); for (const { commit } of await walk(refs[repo.head], 500)) { const author = person(commit.author); if (who.email && author.email === who.email) add(author.time); } } catch { /* a repository without its history here */ }
    if (state) for (const item of [...state.issues, ...state.pulls]) { if (item.author === mine) add(item.time); for (const event of item.events) if (event.key === mine && ['comment', 'review'].includes(event.kind)) add(event.time); }
  }
  return counts;
}
function heatBox(counts) {
  return box({ head: el('strong', {}, S.home.contributions(counts.reduce((a, b) => a + b, 0))), body: el('div', { class: 'heat-scroll' }, heatmap(counts, { label: S.parts.contributions })) });
}

const repoRow = (repo) => boxRow({ lead: icon('repo', { class: 'fg-muted' }), title: `${ownerOf(repo)} / ${repo.name}`, href: repoHref(repo), meta: [repo.description && el('div', {}, repo.description), el('span', {}, S.home.updated(''), relativeTime(repo.cloned || Date.now()))], aside: repo.url ? '' : label(S.home.local) });

export async function dashboard() {
  const items = await library();
  const mine = await me();
  const feedBox = el('div', {}, box({ body: el('p', { class: 'muted' }, S.common.loading) }));
  const heat = el('div', {});
  let tab = 'all';
  const filter = textInput({ type: 'search', placeholder: S.home.filter, 'aria-label': S.home.filter });
  const list = el('div', { class: 'repo-list' });
  const kind = ({ repo, state }) => (state && state.owner && state.owner !== mine ? 'collaborative' : 'sources');
  const tabBar = el('div', {});
  const draw = () => {
    const wanted = filter.value.trim().toLowerCase();
    const shown = items.filter((item) => (tab === 'all' || kind(item) === tab) && `${ownerOf(item.repo)}/${item.repo.name}`.toLowerCase().includes(wanted)).sort((a, b) => (b.repo.cloned || 0) - (a.repo.cloned || 0));
    tabBar.replaceChildren(el('div', { class: 'segmented', role: 'group' }, ['all', 'sources', 'collaborative'].map((key) => el('button', { type: 'button', 'aria-pressed': String(tab === key), onclick: () => { tab = key; draw(); } }, S.home.tabs[key], ' ', counter(items.filter((item) => key === 'all' || kind(item) === key).length)))));
    list.replaceChildren(!items.length ? blankslate({ icon: 'repo', title: S.home.empty, action: button({ label: S.home.emptyAction, kind: 'primary', href: href('/new') }) }) : shown.length ? el('div', {}, shown.map((item) => repoRow(item.repo))) : blankslate({ icon: 'search', title: S.home.noMatch }));
  };
  filter.addEventListener('input', draw);
  draw();
  show('', el('div', { class: 'columns dashboard' }, el('div', { class: 'stack' }, el('h1', { class: 'page-title' }, S.home.dashboard), heat, feedBox),
    el('aside', { class: 'stack' }, box({ head: [el('strong', {}, S.home.title), el('span', { class: 'spacer' }), button({ label: S.home.open, icon: 'download', size: 'small', href: href('/open') }), button({ label: S.home.new, icon: 'repo', kind: 'primary', size: 'small', href: href('/new') })],
      body: el('div', { class: 'stack condensed' }, items.length ? [filter, tabBar] : '', list) }))));
  // The frame first; the reading after.
  setTimeout(async () => {
    const feed = await activity(items);
    feedBox.replaceChildren(box({ head: el('strong', {}, S.home.activity), rows: feed.length ? feed.map((item) => feedRow(item, mine)) : blankslate({ icon: 'clock', title: S.home.noActivity }) }));
    heat.replaceChildren(heatBox(await contributions(items, mine, profile())));
  }, 0);
  return { title: S.home.dashboard };
}

// /{owner}: a profile, made of what this browser knows about that owner.
export async function profilePage({ params, query }) {
  const items = (await library()).filter(({ repo }) => ownerOf(repo) === params.owner);
  const mine = await me();
  const self = (await signedIn()) && slug(profile().name) === params.owner;
  if (!items.length && !self) { show('', blankslate({ icon: 'person', title: S.profile.unknown, text: S.explore.scope, action: button({ label: S.notFound.action, href: href('/') }) })); return { title: S.notFound.title }; }
  const name = self ? profile().name : params.owner;
  const tab = query.get('tab') === 'repositories' ? 'repositories' : 'overview';
  const heat = el('div', {});
  const feedBox = el('div', {});
  const repos = box({ rows: items.length ? items.map((item) => repoRow(item.repo)) : blankslate({ icon: 'repo', title: S.profile.noRepos }) });
  show('', el('div', { class: 'profile' }, el('aside', { class: 'stack' }, avatar(name, { size: 96 }), el('h1', { class: 'page-title' }, name), el('div', { class: 'muted' }, params.owner), self ? button({ label: S.profile.edit, href: href('/settings/profile'), block: true }) : ''),
    el('div', { class: 'stack' }, tabs([{ label: S.profile.overview, icon: 'book', href: href(`/${params.owner}`), current: tab === 'overview' }, { label: S.home.title, icon: 'repo', href: `${href(`/${params.owner}`)}?tab=repositories`, current: tab === 'repositories', count: items.length }], { label: S.profile.tabs, flush: true }),
      tab === 'overview' ? [self ? heat : '', items.length ? [el('h2', { class: 'small muted' }, S.home.title), box({ rows: items.slice(0, 6).map((item) => repoRow(item.repo)) })] : repos, feedBox] : repos)));
  if (tab === 'overview') setTimeout(async () => {
    if (self) heat.replaceChildren(heatBox(await contributions(await library(), mine, profile())));
    const feed = (await activity(items, 15));
    if (feed.length) feedBox.replaceChildren(box({ head: el('strong', {}, S.home.activity), rows: feed.map((item) => feedRow(item, mine)) }));
  }, 0);
  return { title: name };
}

export async function explore({ params, query }) {
  const what = params.what === 'users' ? 'users' : 'repos';
  const items = await library();
  const q = (query.get('q') || '').trim().toLowerCase();
  const form = el('form', { role: 'search', onsubmit: (event) => { event.preventDefault(); navigate(`/explore/${what}?q=${encodeURIComponent(event.currentTarget.elements.q.value.trim())}`); } }, textInput({ type: 'search', name: 'q', value: query.get('q') || '', placeholder: S.header.search, 'aria-label': S.header.search }));
  let rows;
  if (what === 'repos') rows = items.filter(({ repo }) => `${ownerOf(repo)}/${repo.name} ${repo.description || ''}`.toLowerCase().includes(q)).map((item) => repoRow(item.repo));
  else { const owners = new Map(); for (const { repo } of items) owners.set(ownerOf(repo), (owners.get(ownerOf(repo)) || 0) + 1); rows = [...owners].filter(([owner]) => owner.includes(q)).sort().map(([owner, n]) => boxRow({ lead: avatar(owner, { size: 32 }), title: owner, href: href(`/${owner}`), meta: S.explore.repoCount(n) })); }
  show('', el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.header.explore)), tabs([{ label: S.home.title, icon: 'repo', href: href('/explore/repos'), current: what === 'repos' }, { label: S.explore.users, icon: 'people', href: href('/explore/users'), current: what === 'users' }], { label: S.header.explore, flush: true }),
    el('div', { class: 'stack explore' }, form, box({ rows: rows.length ? rows : blankslate({ icon: 'globe', title: q ? S.explore.noMatch : S.explore.empty, text: S.explore.scope, action: button({ label: S.home.open, href: href('/open') }) }) }), rows.length ? el('p', { class: 'muted small' }, S.explore.scope) : ''));
  return { title: S.header.explore };
}

// Notifications: what others did on the issues and pull requests you take part in. Read marks are kept in this browser.
const readMarks = () => { try { return JSON.parse(localStorage.getItem('read-marks') || '{}'); } catch { return {}; } };
const saveMarks = (marks) => { try { localStorage.setItem('read-marks', JSON.stringify(marks)); } catch { /* storage unavailable */ } };
export function markRead(id) { const marks = readMarks(); marks[id] = Date.now(); saveMarks(marks); }
export async function notificationsList() {
  const mine = await me();
  const marks = readMarks();
  const out = [];
  for (const { repo, state } of await library()) {
    if (!state) continue;
    for (const [kind, list] of [['issue', state.issues], ['pull', state.pulls]]) for (const item of list) {
      const takesPart = item.author === mine || item.assignees.includes(mine) || item.events.some((event) => event.key === mine) || (item.threads || []).some((thread) => thread.key === mine);
      if (!takesPart) continue;
      const others = [...item.events.filter((event) => event.key !== mine), ...(item.threads || []).flatMap((thread) => [thread, ...thread.replies]).filter((entry) => entry.key !== mine).map((entry) => ({ ...entry, kind: 'line' }))].sort((a, b) => b.time - a.time);
      if (!others.length) continue;
      const last = others[0];
      const reason = last.kind === 'comment' || last.kind === 'line' ? S.notifications.commented : last.kind === 'review' ? (last.verdict === 'approve' ? S.notifications.approved : last.verdict === 'changes' ? S.notifications.requestedChanges : S.notifications.reviewed) : last.kind === 'state' ? (last.to === 'closed' ? S.notifications.closed : S.notifications.reopened) : last.kind === 'assignees' && last.added.includes(mine) ? S.notifications.assigned : S.notifications.updated;
      out.push({ id: item.id, repo, kind, item, time: last.time, unread: last.time > (marks[item.id] || 0), who: nameIn(state, last.key, last.name), reason });
    }
  }
  return out.sort((a, b) => b.time - a.time);
}
export const unreadCount = async () => { try { return (await notificationsList()).filter((n) => n.unread).length; } catch { return 0; } };
export async function notifications({ query }) {
  const all = await notificationsList();
  const only = query.get('filter') === 'all' ? 'all' : 'unread';
  const shown = all.filter((n) => only === 'all' || n.unread);
  const rows = shown.map((n) => el('div', { class: `box-row notification${n.unread ? ' unread' : ''}`, 'data-notification': n.id }, icon(n.kind === 'issue' ? 'issue-opened' : 'git-pull-request', { class: n.unread ? 'fg-accent' : 'fg-muted' }),
    el('div', { class: 'main' }, el('div', { class: 'meta' }, `${ownerOf(n.repo)}/${n.repo.name} #${n.item.number}`), el('a', { class: 'title', href: repoHref(n.repo, n.kind === 'issue' ? 'issues' : 'pull', n.item.number) }, n.item.title), el('div', { class: 'meta' }, el('strong', {}, n.who), ' ', n.reason, ' ', relativeTime(n.time))),
    n.unread ? button({ label: S.notifications.done, icon: 'check', iconOnly: true, kind: 'invisible', size: 'small', onclick: () => { markRead(n.id); refresh(); } }) : ''));
  show('', el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.header.notifications), el('span', { class: 'spacer' }), all.some((n) => n.unread) ? button({ label: S.notifications.markAll, onclick: () => { const marks = readMarks(); for (const n of all) marks[n.id] = Date.now(); saveMarks(marks); refresh(); }, attrs: { 'data-mark-all': '' } }) : ''),
    el('div', { class: 'settings' }, sideNav([{ label: S.notifications.unread, icon: 'inbox', href: href('/notifications'), current: only === 'unread' }, { label: S.notifications.all, icon: 'bell', href: `${href('/notifications')}?filter=all`, current: only === 'all' }], { label: S.header.notifications }),
      box({ rows: rows.length ? rows : blankslate({ icon: 'bell', title: only === 'unread' ? S.notifications.caughtUp : S.notifications.none }) })));
  return { title: S.header.notifications };
}

// Search across the repositories in this browser: their names, and the titles and text of issues and pull requests.
export async function search({ query }) {
  const q = (query.get('q') || '').trim();
  const needle = q.toLowerCase();
  const type = ['repositories', 'issues', 'pulls'].includes(query.get('type')) ? query.get('type') : 'repositories';
  const items = await library();
  const found = { repositories: [], issues: [], pulls: [] };
  if (needle) for (const { repo, state } of items) {
    if (`${ownerOf(repo)}/${repo.name} ${repo.description || ''}`.toLowerCase().includes(needle)) found.repositories.push(repoRow(repo));
    if (!state) continue;
    const row = (kind, item) => boxRow({ lead: icon(kind === 'issues' ? 'issue-opened' : 'git-pull-request', { class: 'fg-muted' }), title: item.title, href: repoHref(repo, kind === 'issues' ? 'issues' : 'pull', item.number), meta: [`${ownerOf(repo)}/${repo.name} #${item.number} `, relativeTime(item.time)] });
    for (const issue of state.issues) if (`${issue.title}\n${issue.body}`.toLowerCase().includes(needle)) found.issues.push(row('issues', issue));
    for (const pull of state.pulls) if (`${pull.title}\n${pull.body}`.toLowerCase().includes(needle)) found.pulls.push(row('pulls', pull));
  }
  const to = (t) => `${href('/search')}?q=${encodeURIComponent(q)}&type=${t}`;
  const form = el('form', { role: 'search', class: 'row', onsubmit: (event) => { event.preventDefault(); navigate(`/search?q=${encodeURIComponent(event.currentTarget.elements.q.value.trim())}&type=${type}`); } }, el('div', { class: 'main' }, textInput({ type: 'search', name: 'q', value: q, placeholder: S.header.search, 'aria-label': S.header.search, autofocus: !q })), button({ label: S.header.search, type: 'submit' }));
  show('', el('div', { class: 'settings' }, el('nav', { class: 'sidenav', 'aria-label': S.search.kinds }, [['repositories', S.home.title, 'repo'], ['issues', S.repo.issues, 'issue-opened'], ['pulls', S.repo.pulls, 'git-pull-request']].map(([key, text, glyph]) => el('a', { href: to(key), 'aria-current': key === type ? 'page' : undefined, 'data-kind': key }, icon(glyph), el('span', { class: 'main' }, text), counter(found[key].length)))),
    el('div', { class: 'stack' }, form, !q ? box({ body: blankslate({ icon: 'search', title: S.search.prompt, text: S.search.scope }) }) : found[type].length ? [el('p', { class: 'muted' }, S.search.results(found[type].length)), box({ rows: found[type] })] : box({ body: blankslate({ icon: 'search', title: S.search.none(q), text: S.search.scope }) }))));
  return { title: q ? `${q} · ${S.header.search}` : S.header.search };
}

// The command palette: go anywhere, or do something, by typing a few letters.
export async function openPalette(current) {
  if (document.querySelector('dialog.palette')) return;
  const user = await signedIn();
  const go = (path) => () => navigate(path);
  const commands = [{ text: S.header.home, icon: 'home', run: go('/') }];
  if (user) {
    if (current.repo) for (const [text, glyph, part] of [[S.repo.code, 'code', ''], [S.repo.issues, 'issue-opened', 'issues'], [S.repo.pulls, 'git-pull-request', 'pulls'], [S.issues.new, 'plus', 'issues/new'], [S.code.branches, 'git-branch', 'branches'], [S.repo.settings, 'gear', 'settings']]) commands.push({ text: `${current.repo.name}: ${text}`, icon: glyph, run: go(`${repoPath(current.repo)}${part ? `/${part}` : ''}`) });
    for (const repo of await listRepos()) commands.push({ text: `${ownerOf(repo)}/${repo.name}`, icon: 'repo', run: go(repoPath(repo)) });
    commands.push({ text: S.header.newRepository, icon: 'plus', run: go('/new') }, { text: S.header.openRepository, icon: 'download', run: go('/open') }, { text: S.header.issues, icon: 'issue-opened', run: go('/issues') }, { text: S.header.pulls, icon: 'git-pull-request', run: go('/pulls') },
      { text: S.header.notifications, icon: 'bell', run: go('/notifications') }, { text: S.header.explore, icon: 'globe', run: go('/explore/repos') }, { text: S.header.settings, icon: 'gear', run: go('/settings/profile') });
  } else commands.push({ text: S.header.getStarted, icon: 'arrow-right', run: go('/welcome') });
  for (const [key, glyph] of [['light', 'sun'], ['dark', 'moon'], ['auto', 'device-desktop']]) commands.push({ text: S.palette.theme(S.settings.themes[key]), icon: glyph, run: () => setTheme(key) });
  const input = textInput({ placeholder: S.palette.placeholder, 'aria-label': S.palette.title, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const listNode = el('ul', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  let shown = []; let at = 0;
  const node = dialog({ title: S.palette.title, body: el('div', { class: 'stack condensed' }, input, listNode) });
  node.classList.add('palette');
  const pick = (index) => { const command = shown[index]; if (!command) return; node.close(); command.run(); };
  const drawList = () => {
    const wanted = input.value.trim().toLowerCase();
    // Letters in order, spaces ignored: 'ada demo' finds ada-example/demo.
    shown = commands.filter(({ text }) => { let from = 0; const lower = text.toLowerCase(); for (const ch of wanted.replace(/\s+/g, '')) { from = lower.indexOf(ch, from) + 1; if (!from) return false; } return true; }).sort((a, b) => Number(b.text.toLowerCase().includes(wanted)) - Number(a.text.toLowerCase().includes(wanted))).slice(0, 12);
    at = Math.min(at, Math.max(0, shown.length - 1));
    listNode.replaceChildren(...(shown.length ? shown.map((command, index) => el('li', { role: 'option', 'aria-selected': String(index === at), onclick: () => pick(index) }, icon(command.icon), command.text)) : [el('li', { class: 'muted' }, S.palette.none)]));
  };
  input.addEventListener('input', () => { at = 0; drawList(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); at = Math.min(shown.length - 1, at + 1); drawList(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); at = Math.max(0, at - 1); drawList(); }
    if (event.key === 'Enter') { event.preventDefault(); pick(at); }
  });
  drawList();
  node.showModal();
  input.focus();
}
void short;
