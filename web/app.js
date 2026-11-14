// The page. Repository content is only ever placed with textContent, never parsed as HTML.

import { loadEngine, open, diffLines, blameLines, splitLines } from './engine.js';
import { openStore, getObject, getRepo, getRefs, listRepos, countObjects, stats, corruptObject } from './store.js';
import { clone, resolveCommit, readTree, lookup, history, changedPaths, person, fileVersions } from './git.js';

const main = document.getElementById('main');
const status = document.getElementById('status');
const text = new TextDecoder('utf-8', { fatal: false });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

const enc = (ref) => encodeURIComponent(ref);
const link = (href, ...children) => el('a', { href }, ...children);
const short = (id) => id.slice(0, 7);
const when = (ms) => new Date(ms).toISOString().slice(0, 10);
const subject = (message) => message.split('\n')[0];

async function showStatus() {
  const total = await countObjects();
  status.textContent = `${total} objects stored · ${stats.read} read this session, each re-verified` +
    (stats.refused ? ` · ${stats.refused} REFUSED` : '');
  status.className = stats.refused ? 'status refused' : 'status';
}

function header(repo, refs, ref, tab) {
  const branches = Object.keys(refs).filter((r) => r.startsWith('refs/heads/')).map((r) => r.slice(11));
  const tags = Object.keys(refs).filter((r) => r.startsWith('refs/tags/')).map((r) => r.slice(10));
  const select = el('select', { 'aria-label': 'Branch or tag', onchange: (e) => { location.hash = `#/${repo.name}/tree/${enc(e.target.value)}`; } },
    [...branches, ...tags].map((name) => { const o = el('option', { value: name }, name); o.selected = name === ref; return o; }));
  if (![...branches, ...tags].includes(ref)) select.prepend(Object.assign(el('option', { value: ref }, short(ref)), { selected: true }));
  return el('div', {},
    el('h1', {}, link('#/', 'holo-git'), ' / ', link(`#/${repo.name}/tree/${enc(ref)}`, repo.name)),
    el('nav', { class: 'tabs' },
      el('a', { href: `#/${repo.name}/tree/${enc(ref)}`, class: tab === 'code' ? 'on' : '' }, 'Code'),
      el('a', { href: `#/${repo.name}/commits/${enc(ref)}`, class: tab === 'commits' ? 'on' : '' }, 'Commits'),
      select));
}

function crumbs(repo, ref, path, kind) {
  const parts = path.split('/').filter(Boolean);
  const out = [link(`#/${repo.name}/tree/${enc(ref)}`, repo.name)];
  parts.forEach((part, i) => {
    const sub = parts.slice(0, i + 1).join('/');
    const last = i === parts.length - 1;
    out.push(' / ', last ? el('strong', {}, part) : link(`#/${repo.name}/${last ? kind : 'tree'}/${enc(ref)}/${sub}`, part));
  });
  return el('p', { class: 'crumbs' }, out);
}

function blobView(content) {
  if (content.subarray(0, 8000).includes(0)) return el('p', { class: 'muted' }, `Binary file, ${content.length} bytes.`);
  const lines = text.decode(content).replace(/\n$/, '').split('\n');
  return el('table', { class: 'code' }, lines.map((line, i) =>
    el('tr', {}, el('td', { class: 'n' }, i + 1), el('td', {}, el('pre', {}, line)))));
}

async function home() {
  const input = el('input', { type: 'url', placeholder: 'https://example.org/project.git', 'aria-label': 'Replica address', value: new URL('fixtures/holo-git.git', location.href.split('#')[0]).href });
  const note = el('p', { class: 'muted' });
  const form = el('form', { onsubmit: async (event) => {
    event.preventDefault();
    try {
      const started = performance.now();
      const repo = await clone(input.value, (message) => { note.textContent = message; });
      note.textContent = `Cloned ${repo.objects} objects, ${repo.bytes} bytes, in ${Math.round(performance.now() - started)} ms.`;
      location.hash = `#/${repo.name}/tree/${enc(repo.head.replace('refs/heads/', ''))}`;
    } catch (error) { note.textContent = `Clone failed: ${error.message}`; }
  } }, input, el('button', {}, 'Clone'));
  const repos = await listRepos();
  main.replaceChildren(
    el('h1', {}, 'holo-git'),
    el('p', {}, 'Clone a repository from any static replica. Every object is checked against its address before it is stored, and again every time it is read.'),
    form, note,
    repos.length ? el('h2', {}, 'On this device') : '',
    el('ul', {}, repos.map((repo) => el('li', {},
      link(`#/${repo.name}/tree/${enc(repo.head.replace('refs/heads/', ''))}`, repo.name),
      el('span', { class: 'muted' }, ` · ${repo.objects} objects · from ${repo.url}`)))));
}

async function tree(repo, refs, ref, path) {
  const { id, commit } = await resolveCommit(refs, ref);
  const node = await lookup(commit.tree, path);
  if (node.kind !== 'tree') return blob(repo, refs, ref, path);
  const entries = (await readTree(node.id)).sort((a, b) => (b.mode === '40000') - (a.mode === '40000') || (a.name < b.name ? -1 : 1));
  const prefix = path ? `${path}/` : '';
  const rows = entries.map((entry) => {
    const dir = entry.mode === '40000';
    return el('tr', {},
      el('td', {}, dir ? '▸ ' : '', link(`#/${repo.name}/${dir ? 'tree' : 'blob'}/${enc(ref)}/${prefix}${entry.name}`, entry.name)),
      el('td', { class: 'muted mono' }, short(entry.id)));
  });
  const author = person(commit.author);
  const parts = [header(repo, refs, ref, 'code'), crumbs(repo, ref, path, 'tree'),
    el('p', { class: 'latest' }, el('strong', {}, author.name), ' ', link(`#/${repo.name}/commit/${id}`, subject(commit.message)),
      el('span', { class: 'muted' }, ` · ${short(id)} · ${when(author.time)}`)),
    el('table', { class: 'files' }, rows)];
  const readme = entries.find((entry) => /^readme(\.md|\.txt)?$/i.test(entry.name));
  if (readme) {
    const { content } = open(await getObject(readme.id));
    parts.push(el('h2', {}, readme.name), el('pre', { class: 'readme' }, text.decode(content)));
  }
  main.replaceChildren(...parts);
}

async function blob(repo, refs, ref, path) {
  const { commit } = await resolveCommit(refs, ref);
  const node = await lookup(commit.tree, path);
  if (node.kind === 'tree') return tree(repo, refs, ref, path);
  const { content } = open(await getObject(node.id));
  main.replaceChildren(header(repo, refs, ref, 'code'), crumbs(repo, ref, path, 'blob'),
    el('p', { class: 'muted mono' }, `sha1:${node.id} · ${content.length} bytes · `, link(`#/${repo.name}/blame/${enc(ref)}/${path}`, 'Blame')), blobView(content));
}

async function commits(repo, refs, ref) {
  const { id } = await resolveCommit(refs, ref);
  const list = await history(id, 100);
  main.replaceChildren(header(repo, refs, ref, 'commits'),
    el('table', { class: 'files' }, list.map(({ id: commitId, commit }) => {
      const author = person(commit.author);
      return el('tr', {},
        el('td', {}, link(`#/${repo.name}/commit/${commitId}`, subject(commit.message))),
        el('td', { class: 'muted' }, author.name),
        el('td', { class: 'muted' }, when(author.time)),
        el('td', { class: 'mono' }, link(`#/${repo.name}/tree/${commitId}`, short(commitId))));
    })));
}

const isBinary = (bytes) => bytes.subarray(0, 8000).includes(0);
const shown = (line) => text.decode(line).replace(/\r?\n$/, '');
const MAX_DIFF_LINES = 3000;

// A unified view of one file's change, with three lines of context around each change.
async function fileDiff(change, oldTree, newTree) {
  const read = async (tree) => {
    if (!tree) return new Uint8Array();
    try { return open(await getObject((await lookup(tree, change.path)).id)).content; } catch { return new Uint8Array(); }
  };
  const before = change.status === 'added' ? new Uint8Array() : await read(oldTree);
  const after = change.status === 'removed' ? new Uint8Array() : await read(newTree);
  if (isBinary(before) || isBinary(after)) return el('p', { class: 'muted' }, 'Binary file.');
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) return el('p', { class: 'muted' }, `Large change (${oldLines.length} lines before, ${newLines.length} after) not shown.`);
  const rows = [];
  let i = 0;
  let j = 0;
  for (const run of diffLines(before, after)) {
    for (let n = 0; n < run.count; n += 1) {
      if (run.op === 'equal') { rows.push({ op: ' ', a: i + 1, b: j + 1, line: newLines[j] }); i += 1; j += 1; }
      else if (run.op === 'delete') { rows.push({ op: '-', a: i + 1, b: '', line: oldLines[i] }); i += 1; }
      else { rows.push({ op: '+', a: '', b: j + 1, line: newLines[j] }); j += 1; }
    }
  }
  const keep = new Uint8Array(rows.length);
  rows.forEach((row, at) => { if (row.op !== ' ') for (let k = Math.max(0, at - 3); k <= Math.min(rows.length - 1, at + 3); k += 1) keep[k] = 1; });
  const out = [];
  let gap = false;
  rows.forEach((row, at) => {
    if (!keep[at]) { gap = true; return; }
    if (gap && out.length) out.push(el('tr', { class: 'gap' }, el('td', { colspan: '4' }, '⋯')));
    gap = false;
    out.push(el('tr', { class: row.op === '+' ? 'add' : row.op === '-' ? 'del' : '' },
      el('td', { class: 'n' }, row.a), el('td', { class: 'n' }, row.b), el('td', { class: 'sign' }, row.op), el('td', {}, el('pre', {}, shown(row.line)))));
  });
  const added = rows.filter((row) => row.op === '+').length;
  const removed = rows.filter((row) => row.op === '-').length;
  return el('div', {}, el('p', { class: 'muted mono counts' }, el('span', { class: 'st added' }, `+${added}`), ' ', el('span', { class: 'st removed' }, `-${removed}`)),
    el('table', { class: 'code diff' }, out));
}

async function blamePage(repo, refs, ref, path) {
  const { id } = await resolveCommit(refs, ref);
  const { versions, walked, complete } = await fileVersions(id, path);
  if (!versions.length) throw new Error(`${path}: no such file`);
  const contents = [];
  for (const version of versions) contents.push(open(await getObject(version.blob)).content);
  if (isBinary(contents[0])) throw new Error(`${path} is a binary file.`);
  const owners = blameLines(contents);
  const lines = splitLines(contents[0]);
  const rows = lines.map((line, at) => {
    const version = versions[owners[at]];
    const first = at === 0 || owners[at - 1] !== owners[at];
    const author = person(version.commit.author);
    return el('tr', { class: first ? 'first' : '' },
      el('td', { class: 'who' }, first ? [link(`#/${repo.name}/commit/${version.id}`, short(version.id)), ` ${author.name} · ${when(author.time)}`] : ''),
      el('td', { class: 'n' }, at + 1), el('td', {}, el('pre', {}, shown(line))));
  });
  main.replaceChildren(header(repo, refs, ref, 'code'), crumbs(repo, ref, path, 'blob'),
    el('p', { class: 'muted' }, `${versions.length} version${versions.length === 1 ? '' : 's'} across ${walked} commits on the first-parent line`,
      complete ? '' : ' (older history not examined)', ' · ', link(`#/${repo.name}/blob/${enc(ref)}/${path}`, 'Normal view')),
    el('table', { class: 'code blame' }, rows));
}

async function commitPage(repo, refs, id) {
  const { commit } = await resolveCommit(refs, id);
  const author = person(commit.author);
  const parentTree = commit.parents.length ? (await resolveCommit(refs, commit.parents[0])).commit.tree : null;
  const changes = await changedPaths(parentTree, commit.tree);
  const ref = repo.head.replace('refs/heads/', '');
  const sections = [];
  for (const change of changes) {
    sections.push(el('section', { class: 'file' },
      el('h3', {}, el('span', { class: `st ${change.status}` }, change.status), ' ',
        change.status === 'removed' ? change.path : link(`#/${repo.name}/blob/${id}/${change.path}`, change.path)),
      await fileDiff(change, parentTree, commit.tree)));
  }
  main.replaceChildren(header(repo, refs, ref, 'commits'),
    el('h2', {}, subject(commit.message)),
    el('pre', { class: 'readme' }, commit.message.split('\n').slice(1).join('\n').trim()),
    el('p', {}, el('strong', {}, author.name), el('span', { class: 'muted' }, ` committed on ${when(author.time)}`)),
    el('p', { class: 'mono muted' }, `commit sha1:${id}`, el('br'), 'tree ', link(`#/${repo.name}/tree/${id}`, short(commit.tree)),
      commit.parents.map((parent) => [' · parent ', link(`#/${repo.name}/commit/${parent}`, short(parent))])),
    el('h2', {}, `${changes.length} changed file${changes.length === 1 ? '' : 's'}`),
    ...sections);
}

async function route() {
  const [name, view, ref, ...rest] = decodeURI(location.hash.replace(/^#\/?/, '')).split('/');
  try {
    if (!name) await home();
    else {
      const repo = await getRepo(name);
      if (!repo) throw new Error(`No repository named ${name} on this device.`);
      const refs = await getRefs(name);
      const target = decodeURIComponent(ref || repo.head.replace('refs/heads/', ''));
      const path = rest.join('/');
      if (view === 'blob') await blob(repo, refs, target, path);
      else if (view === 'commits') await commits(repo, refs, target);
      else if (view === 'commit') await commitPage(repo, refs, target);
      else if (view === 'blame') await blamePage(repo, refs, target, path);
      else await tree(repo, refs, target, path);
    }
  } catch (error) {
    main.replaceChildren(el('h1', {}, link('#/', 'holo-git')), el('p', { class: 'error' }, error.message));
  }
  await showStatus();
}

await loadEngine();
await openStore();
window.holoGit = { corruptObject, stats };
window.addEventListener('hashchange', route);
await route();
