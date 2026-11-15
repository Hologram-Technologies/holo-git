// The Code tab: the file table with its README and sidebar, a directory, a file, blame, and the editor.

import { S } from './strings.js';
import { afterPaint, el, icon, button, menu, box, blankslate, flash, fileTable, avatar, relativeTime, textInput, textArea, field, validate, segmented } from './components.js';
import { navigate } from './router.js';
import { profile } from './session.js';
import { repoHeader, refSwitcher, pathCrumbs, repoHref, repoPath, show, short, decode, isBinary, size, saveFile } from './repo.js';
import { renderMarkdown } from './markdown.js';
import { zip } from './zip.js';
import { getObject } from '../store.js';
import { open, blameLines, splitLines, parseCommit } from '../engine.js';
import { resolveCommit, readTree, lookup, history as walk, person, fileVersions, commitFile, proposeFile, bundleOf } from '../git.js';

const subject = (message) => message.split('\n')[0];
const isDir = (entry) => entry.mode === '40000';
const MARKDOWN = /\.(md|markdown)$/i;
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
const extension = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

export function missing(context, tab, text) {
  show('', repoHeader(context, tab), el('div', { class: 'page' }, blankslate({ icon: 'alert', title: text, action: button({ label: S.code.backToCode, href: repoHref(context.repo) }) })));
  return { title: S.notFound.title, repo: context.repo };
}
// The commit an address means, or null after saying it does not exist.
export async function commitAt(context, at, tab = 'code') {
  try { return await resolveCommit(context.refs, at.ref); } catch { missing(context, tab, S.code.noRef(at.ref)); return null; }
}

// Every file under a tree, as paths. Stops at `limit`.
async function listFiles(treeId, prefix = '', out = [], limit = 5000, alive = () => true) {
  for (const entry of await readTree(treeId)) {
    if (out.length >= limit || !alive()) break;
    if (isDir(entry)) await listFiles(entry.id, `${prefix}${entry.name}/`, out, limit, alive);
    else if (entry.mode !== '160000') out.push({ path: prefix + entry.name, id: entry.id });
  }
  return out;
}

// Results that depend only on content are kept for the session, keyed by the identifier of that content.
// A result cut short because the visitor moved on is not kept.
const fileCache = new Map(); const languageCache = new Map(); const changeCache = new Map();
async function remembered(cache, key, alive, make) {
  if (cache.has(key)) return cache.get(key);
  const value = await make();
  if (alive() && value) cache.set(key, value);
  return value;
}

// For each entry of a directory, the newest commit on the first-parent line that changed it.
async function lastChanges(startId, path, names, alive, limit = 300) {
  const found = new Map();
  const entriesAt = async (commit) => { try { const node = path ? await lookup(commit.tree, path) : { kind: 'tree', id: commit.tree }; return node.kind === 'tree' ? new Map((await readTree(node.id)).map((e) => [e.name, e.id])) : new Map(); } catch { return new Map(); } };
  let id = startId;
  let commit = parseCommit(await getObject(id));
  let here = await entriesAt(commit);
  for (let walked = 0; id && found.size < names.length && walked < limit && alive(); walked += 1) {
    const parentId = commit.parents[0];
    const parent = parentId ? parseCommit(await getObject(parentId)) : null;
    const before = parent ? await entriesAt(parent) : new Map();
    for (const name of names) if (!found.has(name) && here.has(name) && here.get(name) !== before.get(name)) found.set(name, { id, commit });
    id = parentId; commit = parent; here = before;
  }
  return found;
}

const LANGUAGES = { js: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript', rs: 'Rust', py: 'Python', go: 'Go', html: 'HTML', css: 'CSS', sh: 'Shell', lean: 'Lean', java: 'Java', c: 'C', h: 'C', cpp: 'C++', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin', cs: 'C#', vue: 'Vue', lua: 'Lua' };
async function languages(files, alive) {
  if (files.length > 400) return null;
  const bytes = new Map();
  for (const file of files) {
    if (!alive()) return null;
    const name = LANGUAGES[extension(file.path)];
    if (name) bytes.set(name, (bytes.get(name) || 0) + open(await getObject(file.id)).content.length);
  }
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  return total ? [...bytes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, share: n / total })) : null;
}

function finder(context, at, files) {
  const input = textInput({ type: 'search', placeholder: S.code.goToFile, 'aria-label': S.code.goToFile, 'data-finder': '' });
  const results = el('ul', { class: 'menu-list finder-results', hidden: true });
  let all = null;
  const draw = async () => {
    const wanted = input.value.trim().toLowerCase();
    if (!wanted) { results.hidden = true; return; }
    if (!all) all = await files();
    // Every typed character must appear in order; a match in the file name ranks before one in its folders.
    const matches = all.filter(({ path }) => { let from = 0; const lower = path.toLowerCase(); for (const ch of wanted) { from = lower.indexOf(ch, from) + 1; if (!from) return false; } return true; })
      .sort((a, b) => Number(b.path.split('/').pop().toLowerCase().includes(wanted)) - Number(a.path.split('/').pop().toLowerCase().includes(wanted)) || a.path.length - b.path.length).slice(0, 20);
    results.replaceChildren(...(matches.length ? matches.map(({ path }) => el('li', {}, el('a', { href: repoHref(context.repo, 'blob', at.ref, path) }, icon('file'), path))) : [el('li', { class: 'heading' }, S.code.noFiles)]));
    results.hidden = false;
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', (event) => {
    const first = results.querySelector('a');
    if (event.key === 'Enter' && first) { event.preventDefault(); first.click(); }
    if (event.key === 'ArrowDown' && first) { event.preventDefault(); first.focus(); }
    if (event.key === 'Escape') { input.value = ''; results.hidden = true; input.blur(); }
  });
  results.addEventListener('keydown', (event) => {
    const links = [...results.querySelectorAll('a')];
    const index = links.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' && links[index + 1]) { event.preventDefault(); links[index + 1].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (links[index - 1] || input).focus(); }
  });
  return el('div', { class: 'finder' }, input, el('kbd', { 'aria-hidden': 'true' }, 't'), results);
}

function codeButton(context, at, commit) {
  const { repo } = context;
  const address = repo.replica || repo.url;
  return menu({ label: S.repo.code, icon: 'code', kind: 'primary', align: 'end', items: [
    ...(address ? [{ heading: S.code.cloneTitle }, { label: address, icon: 'copy', onclick: () => navigator.clipboard.writeText(address) }, 'divider'] : []),
    { label: S.code.downloadZip, icon: 'download', onclick: async () => {
      const files = await listFiles(commit.tree, '', [], 20000);
      const entries = [];
      for (const file of files) entries.push({ name: `${repo.name}-${at.ref.replace(/\//g, '-')}/${file.path}`, bytes: open(await getObject(file.id)).content });
      saveFile(`${repo.name}-${at.ref.replace(/\//g, '-')}.zip`, zip(entries), 'application/zip');
    } },
    ...(at.kind === 'branch' ? [{ label: S.code.downloadBundle, icon: 'package', onclick: async () => saveFile(`${repo.name}-${at.ref.replace(/\//g, '-')}.bundle`, (await bundleOf(context.refs, at.ref)).bytes) }] : [])] });
}

function latestCommit(context, at, id, commit) {
  const author = person(commit.author);
  const count = el('span', {}, S.code.commits);
  walk(id, 1001).then((list) => { count.textContent = list.length > 1000 ? S.code.commitsMany : S.code.commitCount(list.length); });
  return [avatar(author.name), el('strong', {}, author.name), el('a', { class: 'muted latest-subject', href: repoHref(context.repo, 'commit', id) }, subject(commit.message)), el('span', { class: 'spacer' }),
    el('a', { class: 'muted mono', href: repoHref(context.repo, 'commit', id) }, short(id)), el('span', { class: 'muted' }, '·'), el('span', { class: 'muted' }, relativeTime(author.time)),
    el('a', { class: 'btn btn-invisible btn-sm', href: repoHref(context.repo, 'commits', at.ref), 'data-commits': '' }, icon('history'), count)];
}

// A relative link or image in a document points at a file in the same repository and ref.
function documentLinks(context, at, dir) {
  const resolve = (target) => { const parts = (target.startsWith('/') ? [] : dir.split('/').filter(Boolean)); for (const part of target.split('#')[0].split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); } return parts.join('/'); };
  return {
    link: (target) => (/^(https?:|mailto:)/i.test(target) ? target : target.startsWith('#') ? target : /^[a-z][a-z0-9+.-]*:/i.test(target) ? null : repoHref(context.repo, 'blob', at.ref, resolve(target)) + (target.includes('#') ? `#${target.split('#')[1]}` : '')),
    // Only images kept in the repository are shown. One at another address would be a request to someone else's server.
    image: async (target) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
      const type = IMAGE[extension(target)];
      if (!type) return null;
      try { const commit = await resolveCommit(context.refs, at.ref); const node = await lookup(commit.commit.tree, resolve(target)); return URL.createObjectURL(new Blob([open(await getObject(node.id)).content], { type })); } catch { return null; }
    },
  };
}

export async function tree(context, at) {
  const resolved = await commitAt(context, at);
  if (!resolved) return {};
  const { id, commit } = resolved;
  let node;
  try { node = at.path ? await lookup(commit.tree, at.path) : { kind: 'tree', id: commit.tree }; } catch { return missing(context, 'code', S.code.noPath(at.ref)); }
  if (node.kind !== 'tree') return blob(context, at);
  const entries = (await readTree(node.id)).sort((a, b) => isDir(b) - isDir(a) || (a.name < b.name ? -1 : 1));
  const prefix = at.path ? `${at.path}/` : '';
  const cells = new Map();
  const rows = entries.map((entry) => {
    const message = el('span', {}); const when = el('span', {});
    cells.set(entry.name, { message, when });
    return { name: entry.name, dir: isDir(entry), href: repoHref(context.repo, isDir(entry) ? 'tree' : 'blob', at.ref, prefix + entry.name), message, when };
  });
  const table = fileTable(rows);
  if (at.path) table.tBodies[0].prepend(el('tr', {}, el('td', { class: 'name', colspan: '3' }, el('a', { href: repoHref(context.repo, 'tree', at.ref, at.path.split('/').slice(0, -1).join('/')), 'aria-label': S.code.parent }, '..'))));
  // The screen is drawn first. Everything slow is listed here and started once it is on screen.
  const later = [];
  later.push(() => remembered(changeCache, `${id}:${at.path}`, context.alive, () => lastChanges(id, at.path, entries.map((entry) => entry.name), context.alive)).then((found) => {
    for (const [name, change] of found) { const cell = cells.get(name); cell.message.replaceChildren(el('a', { href: repoHref(context.repo, 'commit', change.id) }, subject(change.commit.message))); cell.when.replaceChildren(relativeTime(person(change.commit.author).time)); }
  }));

  const files = () => remembered(fileCache, commit.tree, context.alive, () => listFiles(commit.tree, '', [], 5000, context.alive));
  const canWrite = at.kind === 'branch';
  const toolbar = el('div', { class: 'row code-bar' }, refSwitcher(context, at, 'tree'), at.path ? pathCrumbs(context, at) : el('a', { class: 'btn btn-invisible', href: repoHref(context.repo, 'branches') }, icon('git-branch'), S.code.branchCount(context.branches.length)),
    !at.path && context.tags.length ? el('a', { class: 'btn btn-invisible', href: repoHref(context.repo, 'tags') }, icon('tag'), S.code.tagCount(context.tags.length)) : '',
    el('span', { class: 'spacer' }), finder(context, at, files),
    canWrite ? button({ label: S.code.addFile, icon: 'plus', href: repoHref(context.repo, 'new', at.ref, at.path) }) : '', codeButton(context, at, commit));

  const parts = [toolbar, box({ head: latestCommit(context, at, id, commit), rows: table })];
  const readme = entries.find((entry) => !isDir(entry) && /^readme(\.(md|markdown|txt))?$/i.test(entry.name));
  if (readme) {
    const holder = el('div', { class: 'readme-body' });
    later.push(async () => { const content = decode(open(await getObject(readme.id)).content); holder.replaceChildren(MARKDOWN.test(readme.name) ? renderMarkdown(content, documentLinks(context, at, at.path)) : el('pre', { class: 'plain' }, content)); });
    parts.push(box({ class: 'readme', head: [icon('book'), el('strong', {}, readme.name), el('span', { class: 'spacer' }), canWrite ? button({ label: S.code.editFile, icon: 'pencil', iconOnly: true, kind: 'invisible', size: 'small', href: repoHref(context.repo, 'edit', at.ref, prefix + readme.name) }) : ''],
      body: holder }));
  }
  let body = el('div', { class: 'stack' }, parts);
  if (!at.path) {
    const search = el('form', { role: 'search', onsubmit: (event) => { event.preventDefault(); const q = event.currentTarget.elements.q.value.trim(); if (q) navigate(`${repoPath(context.repo, 'search')}?q=${encodeURIComponent(q)}`); } }, textInput({ type: 'search', name: 'q', placeholder: S.code.searchCode, 'aria-label': S.code.searchCode }));
    const langs = el('div', {});
    later.push(() => files().then((all) => remembered(languageCache, commit.tree, context.alive, () => languages(all, context.alive))).then((list) => {
      if (!list) return;
      langs.replaceChildren(el('h2', {}, S.code.languages), el('div', { class: 'lang-bar', role: 'img', 'aria-label': list.map((l) => `${l.name} ${(l.share * 100).toFixed(1)}%`).join(', ') }, list.map((l, i) => { const part = el('i', { class: `c${i}` }); part.style.setProperty('flex-grow', String(l.share)); return part; })),
        el('ul', { class: 'lang-list' }, list.map((l, i) => el('li', {}, el('i', { class: `c${i}` }), el('strong', {}, l.name), el('span', { class: 'muted' }, `${(l.share * 100).toFixed(1)}%`)))));
    }));
    body = el('div', { class: 'columns' }, body, el('aside', { class: 'stack side' }, search, el('div', {}, el('h2', {}, S.code.about), el('p', { class: context.repo.description ? '' : 'muted' }, context.repo.description || S.code.noDescription)), langs));
  }
  show('wide', repoHeader(context, 'code'), el('div', { class: 'page' }, body));
  afterPaint(() => later.forEach((run) => run().catch(() => {})));
  return { title: at.path ? `${at.path} ${S.code.at} ${at.ref} · ${context.repo.name}` : context.repo.name, repo: context.repo,
    keys: [{ keys: 't', label: S.code.goToFile, run: () => document.querySelector('[data-finder]').focus() }, { keys: 'w', label: S.code.switchTitle, run: () => { const d = document.querySelector('#main details.menu'); d.open = true; d.querySelector('a').focus(); } }] };
}

function fileBar(context, at, mode, info, actions) {
  const part = (key, text) => el('a', { class: 'btn', href: repoHref(context.repo, key, at.ref, at.path), 'aria-current': mode === key ? 'page' : undefined }, text);
  return [el('span', { class: 'btn-group' }, part('blob', S.repo.code), part('blame', S.code.blame)), el('span', { class: 'muted small' }, info), el('span', { class: 'spacer' }), actions];
}

export async function blob(context, at) {
  const resolved = await commitAt(context, at);
  if (!resolved) return {};
  const { id, commit } = resolved;
  let node;
  try { node = await lookup(commit.tree, at.path); } catch { return missing(context, 'code', S.code.noFile(at.ref)); }
  if (node.kind === 'tree') return tree(context, at);
  const content = open(await getObject(node.id)).content;
  const name = at.path.split('/').pop();
  const binary = isBinary(content);
  const lines = binary ? [] : decode(content).replace(/\n$/, '').split('\n');
  const markdown = !binary && MARKDOWN.test(name);
  const plain = new URLSearchParams(location.search).get('plain') === '1';
  const canWrite = at.kind === 'branch' && !binary;
  const raw = () => window.open(URL.createObjectURL(new Blob([content], { type: binary ? 'application/octet-stream' : 'text/plain;charset=utf-8' })), '_blank', 'noopener');
  const actions = [markdown ? segmented([{ value: 'preview', label: S.parts.preview }, { value: 'code', label: S.repo.code }], plain ? 'code' : 'preview', (value) => navigate(`${repoPath(context.repo, 'blob', at.ref, at.path)}${value === 'code' ? '?plain=1' : ''}`, { replace: true })) : '',
    el('span', { class: 'btn-group' }, button({ label: S.code.raw, size: 'small', onclick: raw }), button({ label: S.code.copyFile, icon: 'copy', iconOnly: true, size: 'small', disabled: binary, onclick: () => navigator.clipboard.writeText(decode(content)) }),
      button({ label: S.code.download, icon: 'download', iconOnly: true, size: 'small', onclick: () => saveFile(name, content) })),
    canWrite ? button({ label: S.code.editFile, icon: 'pencil', iconOnly: true, size: 'small', href: repoHref(context.repo, 'edit', at.ref, at.path) }) : '',
    button({ label: S.code.history, icon: 'history', size: 'small', kind: 'invisible', href: repoHref(context.repo, 'commits', at.ref, at.path) })];

  let view;
  if (binary) {
    const type = IMAGE[extension(name)];
    view = type ? el('div', { class: 'box-body image' }, el('img', { src: URL.createObjectURL(new Blob([content], { type })), alt: name })) : blankslate({ icon: 'file', title: S.code.binary, action: button({ label: S.code.download, icon: 'download', onclick: () => saveFile(name, content) }) });
  } else if (markdown && !plain) view = el('div', { class: 'box-body' }, renderMarkdown(decode(content), documentLinks(context, at, at.path.split('/').slice(0, -1).join('/'))));
  else view = codeTable(lines);

  show('wide', repoHeader(context, 'code'), el('div', { class: 'page stack' }, el('div', { class: 'row code-bar' }, refSwitcher(context, at, 'blob'), pathCrumbs(context, at, { last: 'blob' })),
    box({ head: fileBar(context, at, 'blob', binary ? size(content.length) : `${S.code.lineCount(lines.length)} · ${size(content.length)}`, actions), rows: view })));
  if (view.selectFromAddress) view.selectFromAddress();
  return { title: `${at.path} ${S.code.at} ${at.ref} · ${context.repo.name}`, repo: context.repo, keys: [
    // The permanent link: the same file at the commit being shown, so the address keeps meaning what it means now.
    { keys: 'y', label: S.code.permalink, run: () => window.history.replaceState(window.history.state, '', repoHref(context.repo, 'blob', id, at.path) + location.search + location.hash) },
    { keys: 'b', label: S.code.blame, run: () => navigate(repoPath(context.repo, 'blame', at.ref, at.path)) },
    ...(canWrite ? [{ keys: 'e', label: S.code.editFile, run: () => navigate(repoPath(context.repo, 'edit', at.ref, at.path)) }] : [])] };
}

// Numbered lines. A click on a number selects that line, Shift-click extends to a range, and the
// selection lives in the address as #L3 or #L3-L9, so it can be shared and survives a reload.
const MAX_LINES = 5000;
const FIRST_LINES = 120;
function codeTable(lines) {
  const shown = lines.slice(0, MAX_LINES);
  const row = (line, i) => el('tr', { id: `L${i + 1}` }, el('td', { class: 'num' }, el('a', { href: `#L${i + 1}`, 'aria-label': S.code.line(i + 1) }, i + 1)), el('td', { class: 'text' }, line));
  // The first screenful is drawn at once and the rest once it is on screen. An address that names a line needs every line there to scroll to.
  const early = /^#L\d+/.test(location.hash) ? shown.length : FIRST_LINES;
  const body = el('tbody', {}, shown.slice(0, early).map(row));
  const table = el('table', { class: 'code-lines' }, body);
  if (shown.length > early) afterPaint(() => body.append(...shown.slice(early).map((line, i) => row(line, i + early))));
  const node = lines.length > MAX_LINES ? el('div', {}, table, el('p', { class: 'box-body muted' }, S.code.truncated(MAX_LINES))) : table;
  let anchor = null;
  const apply = (from, to, scroll) => {
    for (const row of table.querySelectorAll('tr.selected')) row.classList.remove('selected');
    for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) { const row = table.rows[n - 1]; if (row) row.classList.add('selected'); }
    if (scroll && table.rows[Math.min(from, to) - 1]) table.rows[Math.min(from, to) - 1].scrollIntoView({ block: 'center' });
  };
  table.addEventListener('click', (event) => {
    const link = event.target.closest('td.num a');
    if (!link) return;
    event.preventDefault(); event.stopPropagation();
    const n = Number(link.textContent);
    const from = event.shiftKey && anchor ? anchor : n;
    if (!event.shiftKey) anchor = n;
    apply(from, n, false);
    window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}#L${Math.min(from, n)}${from === n ? '' : `-L${Math.max(from, n)}`}`);
  });
  node.selectFromAddress = () => { const m = /^#L(\d+)(?:-L(\d+))?$/.exec(location.hash); if (m) { anchor = Number(m[1]); apply(Number(m[1]), Number(m[2] || m[1]), true); } };
  return node;
}

export async function blame(context, at) {
  const resolved = await commitAt(context, at);
  if (!resolved) return {};
  const { versions, complete } = await fileVersions(resolved.id, at.path);
  if (!versions.length) return missing(context, 'code', S.code.noFile(at.ref));
  const contents = [];
  for (const version of versions) contents.push(open(await getObject(version.blob)).content);
  const bar = (info) => fileBar(context, at, 'blame', info, button({ label: S.code.history, icon: 'history', size: 'small', kind: 'invisible', href: repoHref(context.repo, 'commits', at.ref, at.path) }));
  let view;
  if (isBinary(contents[0])) view = blankslate({ icon: 'file', title: S.code.noBlameBinary });
  else {
    const owners = blameLines(contents);
    view = el('table', { class: 'code-lines blame' }, el('tbody', {}, splitLines(contents[0]).map((line, i) => {
      const version = versions[owners[i]];
      const first = i === 0 || owners[i - 1] !== owners[i];
      const author = person(version.commit.author);
      return el('tr', { class: first ? 'first' : '' }, el('td', { class: 'who' }, first ? [el('span', { class: 'muted' }, relativeTime(author.time)), avatar(author.name, { size: 16 }), el('a', { href: repoHref(context.repo, 'commit', version.id), title: author.name }, subject(version.commit.message))] : ''),
        el('td', { class: 'num' }, i + 1), el('td', { class: 'text' }, decode(line).replace(/\r?\n$/, '')));
    })));
  }
  show('wide', repoHeader(context, 'code'), el('div', { class: 'page stack' }, el('div', { class: 'row code-bar' }, refSwitcher(context, at, 'blame'), pathCrumbs(context, at, { last: 'blob' })),
    complete ? '' : flash('info', S.code.blamePartial), box({ head: bar(S.code.lineCount(splitLines(contents[0]).length)), rows: view })));
  return { title: `${S.code.blame} · ${at.path} · ${context.repo.name}`, repo: context.repo };
}

// One screen for editing a file and for adding one. Committing is local; the branch then shows as not published.
export async function editor(context, at, { create }) {
  if (at.kind !== 'branch') return missing(context, 'code', S.code.editNeedsBranch);
  const resolved = await commitAt(context, at);
  if (!resolved) return {};
  let before = '';
  if (!create) {
    let node;
    try { node = await lookup(resolved.commit.tree, at.path); } catch { return missing(context, 'code', S.code.noFile(at.ref)); }
    const content = node.kind === 'blob' ? open(await getObject(node.id)).content : null;
    if (!content || isBinary(content)) return missing(context, 'code', node.kind === 'tree' ? S.code.editFolder : S.code.editBinary);
    before = decode(content);
  }
  const who = profile();
  const dir = create && at.path ? `${at.path}/` : '';
  const name = field({ label: S.code.fileName, hint: S.code.fileNameHint, control: textInput({ value: dir, autofocus: create }) });
  const area = textArea({ code: true, rows: 22, 'aria-label': S.code.fileContents, spellcheck: 'false' });
  area.value = before;
  const fallback = () => (create ? S.code.createMessage(name.control.value.split('/').pop() || S.code.newFile) : S.code.updateMessage(at.path.split('/').pop()));
  const message = field({ label: S.code.commitMessage, control: textInput({ placeholder: fallback() }) });
  if (create) name.control.addEventListener('input', () => { message.control.placeholder = fallback(); });
  const direct = el('input', { type: 'radio', name: 'how', id: 'how-direct', value: 'direct', checked: true });
  const propose = el('input', { type: 'radio', name: 'how', id: 'how-propose', value: 'propose' });
  const note = el('div', {});
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const path = create ? name.control.value.trim().replace(/^\/+|\/+$/g, '') : at.path;
    const bad = create && (!path ? S.code.fileNameBlank : path.split('/').some((part) => !part || part === '.' || part === '..') ? S.code.fileNameInvalid : '');
    if (create && !validate([[name, bad]])) return;
    if (!who.name || !who.email) { note.replaceChildren(flash('error', S.code.needProfile)); return; }
    if (!create && area.value === before) { note.replaceChildren(flash('warning', S.code.noChanges)); return; }
    try {
      const made = await (propose.checked ? proposeFile : commitFile)({ repo: context.repo, refs: context.refs, branch: at.ref, path, content: new TextEncoder().encode(area.value), message: message.control.value.trim() || fallback(), name: who.name, email: who.email });
      navigate(propose.checked ? repoPath(context.repo, 'pulls') : repoPath(context.repo, 'commit', made.id));
    } catch (error) {
      // The plain reason. A protected branch is the one refusal a writer meets in ordinary use.
      note.replaceChildren(flash('error', /does not count|fast-forward/.test(error.message) ? S.code.protectedBranch : /is a (file|directory)/.test(error.message) ? S.code.nameTaken : S.code.commitFailed));
    }
  } }, note, create ? name : '', el('div', { class: 'box' }, el('div', { class: 'box-head' }, el('strong', {}, create ? S.code.newFile : at.path)), area), message,
  el('div', { class: 'stack condensed', role: 'radiogroup', 'aria-label': S.code.commitChoice }, el('div', { class: 'choice' }, direct, el('label', { for: 'how-direct' }, icon('git-commit'), ' ', S.code.commitDirect(at.ref))),
    create ? '' : el('div', { class: 'choice' }, propose, el('label', { for: 'how-propose' }, icon('git-pull-request'), ' ', S.code.commitPropose))),
  el('div', { class: 'row' }, button({ label: S.code.commitChanges, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: repoHref(context.repo, create ? 'tree' : 'blob', at.ref, at.path) })));
  show('wide', repoHeader(context, 'code'), el('div', { class: 'page stack' }, el('div', { class: 'row code-bar' }, pathCrumbs(context, at, { last: create ? 'tree' : 'blob' })), form));
  if (create) name.control.focus();
  return { title: `${create ? S.code.newFile : S.code.editing(at.path)} · ${context.repo.name}`, repo: context.repo };
}
