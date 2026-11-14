// The page. Repository content is only ever placed with textContent, never parsed as HTML.

import { loadEngine, open, diffLines, blameLines, splitLines } from './engine.js';
import { openStore, getObject, getRepo, getRefs, listRepos, countObjects, stats, corruptObject, setRepo } from './store.js';
import { startShell } from './shell.js';
import { loadKernel, decisions } from './kernel.js';
import { checkLog, deviceKey, grant, revoke, protect, unprotect, approve } from './identity.js';
import { isAncestor } from './ancestry.js';
import { push, setCredentials, hasCredentials } from './replica.js';
import { fetchFrom, updatePull } from './sync.js';
import { clone, resolveCommit, readTree, lookup, history, changedPaths, person, fileVersions, commitFile, bundleOf, proposeFile, mergePull } from './git.js';

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
  status.textContent = `${total} objects stored · ${stats.read} read this session, each re-verified · ${decisions.asked} decisions by the proved kernel` +
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
      el('a', { href: `#/${repo.name}/pulls/${enc(ref)}`, class: tab === 'pulls' ? 'on' : '' }, 'Pull requests'),
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
    el('p', { class: 'muted mono' }, `sha1:${node.id} · ${content.length} bytes · `, link(`#/${repo.name}/blame/${enc(ref)}/${path}`, 'Blame'),
      refs[`refs/heads/${ref}`] ? [' · ', link(`#/${repo.name}/edit/${enc(ref)}/${path}`, 'Edit')] : ''), blobView(content));
}

async function commits(repo, refs, ref) {
  const { id } = await resolveCommit(refs, ref);
  const list = await history(id, 100);
  main.replaceChildren(header(repo, refs, ref, 'commits'), await branchTools(repo, refs, ref),
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

const saved = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

async function editPage(repo, refs, ref, path) {
  if (!refs[`refs/heads/${ref}`]) throw new Error('Only a branch can be edited.');
  const { commit } = await resolveCommit(refs, ref);
  const node = await lookup(commit.tree, path);
  if (node.kind !== 'blob') throw new Error(`${path} is a directory.`);
  const { content } = open(await getObject(node.id));
  if (isBinary(content)) throw new Error(`${path} is a binary file.`);
  const area = el('textarea', { 'aria-label': 'File content', spellcheck: 'false', rows: '24' });
  area.value = text.decode(content);
  const message = el('input', { type: 'text', 'aria-label': 'Commit message', placeholder: `Update ${path.split('/').pop()}` });
  const name = el('input', { type: 'text', 'aria-label': 'Your name', placeholder: 'Your name', value: saved('holo-git-name') });
  const email = el('input', { type: 'email', 'aria-label': 'Your email', placeholder: 'you@example.org', value: saved('holo-git-email') });
  const note = el('p', { class: 'muted' }, 'The commit is made on this device and signed with this device\'s key. Nothing is sent anywhere.');
  const form = el('form', { class: 'edit', onsubmit: async (event) => {
    event.preventDefault();
    try {
      remember('holo-git-name', name.value);
      remember('holo-git-email', email.value);
      const propose = event.submitter && event.submitter.value === 'propose';
      const made = await (propose ? proposeFile : commitFile)({ repo, refs, branch: ref, path, content: new TextEncoder().encode(area.value),
        message: message.value || message.getAttribute('placeholder'), name: name.value, email: email.value });
      location.hash = propose ? `#/${repo.name}/pulls/${enc(ref)}` : `#/${repo.name}/commit/${made.id}`;
    } catch (error) { note.textContent = error.message; note.className = 'error'; }
  } }, area, message, name, email,
  el('p', { class: 'push' }, el('button', { value: 'commit' }, `Commit to ${ref}`), el('button', { value: 'propose' }, 'Propose as a pull request')));
  main.replaceChildren(header(repo, refs, ref, 'code'), crumbs(repo, ref, path, 'blob'), form, note);
}

let pendingMerge = null;

// Conflicts from the last fetch, for a person to settle. Text conflicts are shown as git shows
// them, between markers; the rest are a choice between this device's version and the replica's.
async function resolvePage(repo, refs, ref) {
  if (!pendingMerge || pendingMerge.repo !== repo.name || pendingMerge.ref !== ref) throw new Error('There is no merge waiting. Fetch from the Commits page first.');
  const { result, address } = pendingMerge;
  const note = el('p', { class: 'muted' }, 'Nothing changes until you complete the merge. Leaving this page abandons it.');
  const controls = result.details.map((detail) => {
    if (detail.kind === 'text' && detail.marked) {
      const area = el('textarea', { 'aria-label': `Resolution of ${detail.path}`, spellcheck: 'false', rows: '18' });
      area.value = text.decode(detail.marked);
      return { detail, node: area, read: () => ({ content: new TextEncoder().encode(area.value) }) };
    }
    const choice = el('select', { 'aria-label': `Which version of ${detail.path} to keep` },
      el('option', { value: 'ours' }, `Keep this device's version (${detail.ours})`),
      el('option', { value: 'theirs' }, `Take the replica's version (${detail.theirs})`));
    return { detail, node: choice, read: () => ({ take: choice.value }) };
  });
  const form = el('form', { class: 'edit', onsubmit: async (event) => {
    event.preventDefault();
    try {
      const paths = new Map(controls.map(({ detail, read }) => [detail.path, read()]));
      const outcome = await fetchFrom(repo, ref, address, { name: saved('holo-git-name'), email: saved('holo-git-email') }, () => {}, { against: result.against, paths });
      if (outcome.outcome === 'conflict') { pendingMerge = { ...pendingMerge, result: outcome }; note.textContent = 'There are still conflicts.'; window.dispatchEvent(new HashChangeEvent('hashchange')); return; }
      pendingMerge = null;
      location.hash = `#/${repo.name}/commit/${outcome.head}`;
    } catch (error) { note.textContent = error.message; note.className = 'error'; }
  } },
  controls.map(({ detail, node }) => el('section', { class: 'file' },
    el('h3', {}, detail.path, el('span', { class: 'muted' }, ` · here: ${detail.ours} · on the replica: ${detail.theirs}`)),
    detail.kind === 'text' && detail.marked ? el('p', { class: 'muted' }, 'Edit to the text you want and remove the three marker lines.') : '',
    node)),
  el('button', {}, 'Complete the merge'));
  main.replaceChildren(header(repo, refs, ref, 'commits'),
    el('h2', {}, `${result.details.length} conflict${result.details.length === 1 ? '' : 's'} to resolve`), form, note);
}

const keyName = (key, mine, owner) => `${key.slice(0, 8)}${key === mine ? ' (this device)' : ''}${key === owner ? ' (owner)' : ''}`;

async function pullsPage(repo, refs, ref) {
  const log = await checkLog(repo.name);
  if (!log.valid) throw new Error(`This repository's signed log does not verify: ${log.reason}`);
  const mine = (await deviceKey()).id;
  const rows = [...log.state.pulls].reverse().map((pull) => el('tr', {},
    el('td', {}, link(`#/${repo.name}/pull/${pull.number}`, `#${pull.number} ${pull.title}`)),
    el('td', { class: 'muted' }, keyName(pull.author, mine, log.state.owner)),
    el('td', { class: 'muted' }, pull.ref.slice(11)),
    el('td', {}, pull.merged ? 'merged' : `open · ${pull.counted} of ${pull.needed} approvals`)));
  main.replaceChildren(header(repo, refs, ref, 'pulls'),
    rows.length ? el('table', { class: 'files' }, rows) : el('p', { class: 'muted' }, 'No pull requests. Edit a file and choose "Propose as a pull request".'));
}

async function pullPage(repo, refs, number) {
  const log = await checkLog(repo.name);
  if (!log.valid) throw new Error(`This repository's signed log does not verify: ${log.reason}`);
  const pull = log.state.pulls.find((candidate) => String(candidate.number) === String(number));
  if (!pull) throw new Error(`There is no pull request #${number}.`);
  const branch = pull.ref.slice(11);
  const mine = (await deviceKey()).id;
  const baseHead = refs[pull.ref];
  const upToDate = pull.merged || await isAncestor(baseHead, pull.head) === true;
  // What it changes: from the point where it left the branch to the proposed commit.
  const onBranch = new Set();
  for (const queue = [baseHead]; queue.length;) {
    const id = queue.pop();
    if (onBranch.has(id)) continue;
    onBranch.add(id);
    queue.push(...(await resolveCommit(refs, id)).commit.parents);
  }
  const head = (await resolveCommit(refs, pull.head)).commit;
  let fork = head.parents[0];
  while (fork && !onBranch.has(fork)) fork = (await resolveCommit(refs, fork)).commit.parents[0];
  const forkTree = fork ? (await resolveCommit(refs, fork)).commit.tree : null;
  const changes = await changedPaths(forkTree, head.tree);
  const sections = [];
  for (const change of changes) {
    sections.push(el('section', { class: 'file' },
      el('h3', {}, el('span', { class: `st ${change.status}` }, change.status), ' ', change.path), await fileDiff(change, forkTree, head.tree)));
  }
  const note = el('span', { class: 'muted' });
  const act = (label, work) => el('button', { onclick: async () => {
    try { await work(); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (error) { note.textContent = ` ${error.message}`; }
  } }, label);
  const who = { name: saved('holo-git-name'), email: saved('holo-git-email') };
  const approvers = [...pull.approvals].map((key) => keyName(key, mine, log.state.owner) + (key === pull.author ? ', does not count: the proposer' : ''));
  const actions = pull.merged ? [] : [
    pull.approvals.has(mine) ? '' : act('Approve this commit', () => approve(repo.name, branch, pull.head)),
    upToDate ? act('Merge', async () => { const merged = await mergePull({ repo, refs, branch, head: pull.head }); location.hash = `#/${repo.name}/commit/${merged.id}`; })
      : act(`Bring up to date with ${branch}`, async () => { await updatePull({ repo, refs, branch, head: pull.head, title: pull.title, who }); location.hash = `#/${repo.name}/pulls/${enc(branch)}`; }),
  ];
  main.replaceChildren(header(repo, refs, branch, 'pulls'),
    el('h2', {}, `#${pull.number} ${pull.title}`),
    el('p', {}, pull.merged ? 'Merged' : 'Open', el('span', { class: 'muted' }, ` · into ${branch} · proposed by ${keyName(pull.author, mine, log.state.owner)} on ${when(pull.time)}`)),
    el('p', { class: 'mono muted' }, 'commit ', link(`#/${repo.name}/commit/${pull.head}`, short(pull.head)),
      upToDate ? '' : ` · behind ${branch}: it must be brought up to date before it can merge`),
    el('p', {}, `Approvals that count: ${pull.counted} of ${pull.needed} required.`,
      el('span', { class: 'muted' }, approvers.length ? ` Approved by ${approvers.join('; ')}.` : ' Nobody has approved this commit.')),
    el('p', { class: 'push' }, actions, note),
    el('h2', {}, `${changes.length} changed file${changes.length === 1 ? '' : 's'}`), ...sections);
}

async function accessTools(repo, log, branch) {
  const key = await deviceKey();
  const mine = el('input', { type: 'text', readonly: '', 'aria-label': 'This device\'s key', value: key.id });
  const state = log.valid ? log.state : null;
  const owner = state && state.owner;
  const role = !owner ? 'No signed records yet: the first change made here makes this device the owner.'
    : owner === key.id ? 'This device owns this repository.'
      : state.grants.has(key.id) ? `This device has ${state.grants.get(key.id).revoked ? 'a revoked grant' : `${state.grants.get(key.id).mode} access`}.`
        : 'This device has no access beyond reading.';
  const note = el('span', { class: 'muted' });
  const rerender = () => { window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const rows = state ? [...state.grants].map(([subject, grant]) => el('tr', {},
    el('td', { class: 'mono' }, subject.slice(0, 16), '…'),
    el('td', {}, grant.revoked ? 'revoked' : grant.mode),
    el('td', { class: 'muted' }, grant.notAfter ? `until ${when(grant.notAfter * 1000)}` : 'no expiry'),
    el('td', {}, grant.revoked ? '' : el('button', { onclick: async () => {
      try { await revoke(repo.name, subject); rerender(); } catch (error) { note.textContent = ` ${error.message}`; }
    } }, 'Revoke')))) : [];
  const subject = el('input', { type: 'text', 'aria-label': 'Key to grant access to', placeholder: 'Their device key (64 characters)' });
  const mode = el('select', { 'aria-label': 'Access' }, el('option', { value: 'write' }, 'write'), el('option', { value: 'read' }, 'read'));
  const days = el('input', { type: 'number', min: '0', 'aria-label': 'Days until it expires', placeholder: 'days (0 = no expiry)', value: '30' });
  const form = el('form', { class: 'push', onsubmit: async (event) => {
    event.preventDefault();
    try { await grant(repo.name, subject.value, mode.value, Number(days.value) || 0); rerender(); } catch (error) { note.textContent = ` ${error.message}`; }
  } }, subject, mode, days, el('button', {}, 'Grant'), note);
  const refName = `refs/heads/${branch}`;
  const rule = state && state.protections.get(refName);
  const who = el('select', { 'aria-label': 'Who may change the protected branch' },
    el('option', { value: 'write' }, 'anyone with write access'), el('option', { value: 'admin' }, 'the owner only'));
  if (rule) who.value = rule.minimum;
  const needs = el('input', { type: 'number', min: '0', max: '200', 'aria-label': 'Approvals required to change the branch', value: String(rule ? rule.approvals : 0) });
  const guard = el('p', { class: 'push' },
    el('span', {}, rule ? `${branch} is protected: it only moves forward, for ${rule.minimum === 'admin' ? 'the owner only' : 'anyone with write access'}, with ${rule.approvals} approval${rule.approvals === 1 ? '' : 's'} required.` : `${branch} is not protected: anyone with write access can rewind it.`),
    who, el('span', { class: 'muted' }, 'approvals required:'), needs,
    el('button', { onclick: async () => { try { await protect(repo.name, branch, who.value, Number(needs.value) || 0); rerender(); } catch (error) { note.textContent = ` ${error.message}`; } } }, rule ? 'Change' : 'Protect'),
    rule ? el('button', { onclick: async () => { try { await unprotect(repo.name, branch); rerender(); } catch (error) { note.textContent = ` ${error.message}`; } } }, 'Remove protection') : '');
  return el('details', { class: 'access' }, el('summary', {}, 'Access'),
    el('p', {}, role), guard, el('p', { class: 'push' }, el('span', { class: 'muted' }, 'This device\'s key:'), mine),
    rows.length ? el('table', { class: 'files' }, rows) : '', form,
    el('p', { class: 'muted' }, 'A grant or revocation is a signed record. It takes effect for others once pushed.'));
}

async function branchTools(repo, refs, ref) {
  if (!refs[`refs/heads/${ref}`]) return '';
  const log = await checkLog(repo.name);
  const note = el('span', { class: 'muted' });
  const button = el('button', { onclick: async () => {
    try {
      const bundle = await bundleOf(refs, ref);
      const url = URL.createObjectURL(new Blob([bundle.bytes], { type: 'application/octet-stream' }));
      const anchor = el('a', { href: url, download: `${repo.name}-${ref}.bundle` });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      note.textContent = ` ${bundle.objects} objects, ${bundle.bytes.length} bytes. Fetch it with: git pull ${repo.name}-${ref}.bundle ${ref}`;
    } catch (error) { note.textContent = ` ${error.message}`; }
  } }, 'Download as git bundle');
  const state = log.entries === 0 ? 'No signed records yet.'
    : log.valid ? `${log.entries} record${log.entries === 1 ? '' : 's'} in this repository's signed log; signatures, chain and access all verified.`
      : `This repository's signed log does NOT verify: ${log.reason}`;
  const address = el('input', { type: 'url', 'aria-label': 'Replica address', placeholder: 'https://storage.example.org/project', value: repo.replica || '' });
  const pushNote = el('span', { class: 'muted' });
  const pushButton = el('button', { onclick: async () => {
    try {
      pushNote.textContent = ' pushing…';
      const started = performance.now();
      const result = await push(repo, ref, address.value, (message) => { pushNote.textContent = ` ${message}`; });
      await setRepo({ ...repo, replica: address.value.replace(/\/+$/, '') });
      pushNote.textContent = result.upToDate ? ' The replica is already up to date.'
        : ` Pushed ${result.objects} objects and ${result.records} signed update${result.records === 1 ? '' : 's'} in ${Math.round(performance.now() - started)} ms.`;
    } catch (error) { pushNote.textContent = ` ${error.message}`; }
  } }, 'Push');
  const fetchButton = el('button', { onclick: async () => {
    try {
      pushNote.textContent = ' fetching…';
      const result = await fetchFrom(repo, ref, address.value, { name: saved('holo-git-name'), email: saved('holo-git-email') }, (message) => { pushNote.textContent = ` ${message}`; });
      await setRepo({ ...repo, replica: address.value.replace(/\/+$/, '') });
      if (result.outcome === 'conflict') {
        pendingMerge = { repo: repo.name, ref, address: address.value, result };
        location.hash = `#/${repo.name}/resolve/${enc(ref)}`;
        return;
      }
      sessionStorage.setItem('holo-git-note', { 'up to date': 'Already up to date.', ahead: `Nothing new on the replica; ${result.unpushed} record${result.unpushed === 1 ? '' : 's'} here not pushed yet.`,
        'fast-forward': 'Fetched and moved to the replica\'s head.', merged: 'Fetched and merged with the changes made here. Push to publish the merge.',
        rebased: 'Fetched; the changes made here were signed again on top. Push to publish them.' }[result.outcome]);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (error) { pushNote.textContent = ` ${error.message}`; }
  } }, 'Fetch');
  let carried = '';
  try { carried = sessionStorage.getItem('holo-git-note') || ''; sessionStorage.removeItem('holo-git-note'); } catch { /* storage unavailable */ }
  if (carried) pushNote.textContent = ` ${carried}`;
  const accessKey = el('input', { type: 'text', 'aria-label': 'Access key', placeholder: 'Access key', autocomplete: 'off' });
  const secretKey = el('input', { type: 'password', 'aria-label': 'Secret key', placeholder: 'Secret key', autocomplete: 'off' });
  const region = el('input', { type: 'text', 'aria-label': 'Region', placeholder: 'Region', value: 'us-east-1' });
  const keysNote = el('span', { class: 'muted' }, hasCredentials(address.value || 'x') ? ' Keys are set for this address.' : '');
  const keys = el('details', { class: 'access' }, el('summary', {}, 'Storage keys'),
    el('p', { class: 'muted' }, 'Only needed for a store that requires signed requests. Kept in memory while this page is open; never stored, never sent. Each request carries a signature, not the secret.'),
    el('form', { class: 'push', onsubmit: (event) => {
      event.preventDefault();
      setCredentials(address.value, { accessKey: accessKey.value.trim(), secretKey: secretKey.value, region: region.value.trim() || 'us-east-1' });
      secretKey.value = '';
      keysNote.textContent = hasCredentials(address.value) ? ' Keys are set for this address.' : ' Keys cleared.';
    } }, accessKey, secretKey, region, el('button', {}, 'Use these keys'), keysNote));
  return el('div', { class: 'tools' },
    el('p', { class: log.valid ? '' : 'error' }, state, ' ', button, note),
    el('p', { class: 'push' }, address, fetchButton, pushButton, pushNote),
    keys,
    await accessTools(repo, log, ref));
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
      else if (view === 'edit') await editPage(repo, refs, target, path);
      else if (view === 'resolve') await resolvePage(repo, refs, target);
      else if (view === 'pulls') await pullsPage(repo, refs, target);
      else if (view === 'pull') await pullPage(repo, refs, target);
      else await tree(repo, refs, target, path);
    }
  } catch (error) {
    main.replaceChildren(el('h1', {}, link('#/', 'holo-git')), el('p', { class: 'error' }, error.message));
  }
  await showStatus();
}

await loadEngine();
await loadKernel();
await openStore();
window.holoGit = { corruptObject, stats, decisions, bundleOf, getRefs };
window.addEventListener('hashchange', route);
startShell(document.getElementById('shell'));
await route();
