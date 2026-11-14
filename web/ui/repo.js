// What every repository screen shares: finding the repository an address names, reading a ref and a
// path out of the rest of it, the header with its tabs, and the branch and tag switcher.

import { S } from './strings.js';
import { el, icon, label, tabs, menu, crumbs, blankslate, button } from './components.js';
import { href, navigate } from './router.js';
import { profile } from './session.js';
import { getRepo, getRefs } from '../store.js';

export const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'you';
// Repositories are stored by name alone. The owner shown in an address is where the repository came
// from: for one opened by address, the path segment before its name; for one made here, its maker.
export function ownerOf(repo) {
  if (repo.owner) return repo.owner;
  if (repo.url) {
    try {
      const url = new URL(repo.url);
      const parts = url.pathname.split('/').filter(Boolean);
      return slug(parts.length > 1 ? parts[parts.length - 2] : url.hostname);
    } catch { /* not an address; fall through */ }
  }
  return slug(profile().name);
}
const enc = (path) => String(path).split('/').map(encodeURIComponent).join('/');
export const repoPath = (repo, ...rest) => `/${[ownerOf(repo), repo.name, ...rest.filter((part) => part !== '' && part !== undefined).map(enc)].join('/')}`;
export const repoHref = (repo, ...rest) => href(repoPath(repo, ...rest));
export const short = (id) => id.slice(0, 7);
export const defaultBranch = (repo) => repo.head.replace('refs/heads/', '');

const main = () => document.getElementById('main');
export function show(kind, ...children) {
  const node = main();
  node.className = `page${kind ? ` ${kind}` : ''}`;
  node.replaceChildren(...children.flat(Infinity).filter(Boolean));
}

// The repository an address names, or null after drawing the reason there is none.
// An address from before owners existed ('/name/tree/main') is sent on to its new form.
export async function load(params) {
  const repo = await getRepo(params.repo);
  if (repo && ownerOf(repo) === params.owner) {
    const refs = await getRefs(repo.name);
    const names = (prefix) => Object.keys(refs).filter((ref) => ref.startsWith(prefix)).map((ref) => ref.slice(prefix.length)).sort();
    return { repo, refs, branches: names('refs/heads/'), tags: names('refs/tags/'), head: defaultBranch(repo) };
  }
  // Not awaited: the router draws one screen at a time, and this one is still being drawn.
  if (repo) { navigate(`${repoPath(repo)}${params.rest ? `/${params.rest}` : ''}`, { replace: true }); return null; }
  const old = await getRepo(params.owner);
  if (old) { navigate(`${repoPath(old)}/${[params.repo, params.rest].filter(Boolean).join('/')}`, { replace: true }); return null; }
  show('', blankslate({ icon: 'repo', title: S.repo.notHere, action: button({ label: S.repo.openByAddress, kind: 'primary', href: href('/open') }) }));
  return null;
}

// 'feature/x/src/app.js' -> the ref it starts with and the path that follows. Branch and tag names may
// contain slashes, so the longest name that matches wins; otherwise the first segment is a commit.
export function splitRef(context, rest) {
  const text = decodeURIComponent(rest || '');
  if (!text) return { ref: context.head, path: '', kind: 'branch' };
  for (const [kind, names] of [['branch', context.branches], ['tag', context.tags]]) {
    const match = names.filter((name) => text === name || text.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0];
    if (match) return { ref: match, path: text.slice(match.length + 1), kind };
  }
  const [first, ...more] = text.split('/');
  return { ref: first, path: more.join('/'), kind: 'commit' };
}

export function repoHeader(context, tab) {
  const { repo } = context;
  return el('div', { class: 'repo-head' },
    el('div', { class: 'title' }, icon('repo', { class: 'fg-muted' }), el('a', { href: href('/') }, ownerOf(repo)), el('span', { class: 'muted' }, '/'), el('a', { class: 'name', href: repoHref(repo) }, repo.name),
      repo.url ? '' : label(S.repo.local)),
    tabs([{ label: S.repo.code, icon: 'code', href: repoHref(repo), current: tab === 'code' }, { label: S.repo.pulls, icon: 'git-pull-request', href: repoHref(repo, 'pulls'), current: tab === 'pulls' },
      { label: S.repo.settings, icon: 'gear', href: repoHref(repo, 'settings'), current: tab === 'settings' }], { label: S.repo.navigation }));
}

// The switcher keeps the visitor on the same kind of screen and path when they change branch.
export function refSwitcher(context, at, view) {
  const item = (name) => ({ label: name, icon: name === at.ref ? 'check' : undefined, href: repoHref(context.repo, view, name, at.path) });
  return menu({ label: at.kind === 'commit' ? short(at.ref) : at.ref, icon: at.kind === 'tag' ? 'tag' : 'git-branch', attrs: { 'data-switcher': '' },
    items: [{ heading: S.code.switchTitle }, ...context.branches.map(item), ...(context.tags.length ? ['divider', { heading: S.code.tags }, ...context.tags.map(item)] : []),
      'divider', { label: S.code.allBranches, href: repoHref(context.repo, 'branches') }, ...(context.tags.length ? [{ label: S.code.allTags, href: repoHref(context.repo, 'tags') }] : [])] });
}

// repository / dir / dir / file, each part a link to its tree.
export function pathCrumbs(context, at, { last = 'tree' } = {}) {
  const parts = at.path.split('/').filter(Boolean);
  return crumbs([{ label: context.repo.name, href: repoHref(context.repo, 'tree', at.ref) }, ...parts.map((part, i) => ({ label: part, href: repoHref(context.repo, i === parts.length - 1 ? last : 'tree', at.ref, parts.slice(0, i + 1).join('/')) }))]);
}

const text = new TextDecoder('utf-8', { fatal: false });
export const decode = (bytes) => text.decode(bytes);
export const isBinary = (bytes) => bytes.subarray(0, 8000).includes(0);
export function size(bytes) {
  if (bytes < 1024) return `${bytes} ${S.code.bytes}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < 2) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
export function saveFile(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = el('a', { href: url, download: name });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
