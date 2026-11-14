// The repository screens that have not been rebuilt yet: pull requests, conflict resolution, and the panels for
// fetching, pushing, access and branch protection. They draw inside the new repository frame (web/ui/repo.js)
// and are replaced in later phases. Their wording is the old one; docs/UI-STRINGS.md maps each string to what replaces it.
// Repository content is only ever placed with textContent, never parsed as HTML.

import { open, diffLines, splitLines } from './engine.js';
import { getObject, getRefs, stats, corruptObject, setRepo } from './store.js';
import { decisions } from './kernel.js';
import { S } from './ui/strings.js';
import * as ui from './ui/components.js';
import { repoHeader, ownerOf } from './ui/repo.js';
import { checkLog, deviceKey, grant, revoke, protect, unprotect, approve } from './identity.js';
import { isAncestor } from './ancestry.js';
import { expectedActions } from './evidence.js';
import { push, setCredentials, hasCredentials } from './replica.js';
import { fetchFrom, updatePull } from './sync.js';
import { resolveCommit, lookup, changedPaths, bundleOf, mergePull } from './git.js';

const main = document.getElementById('main');
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

// The frame draws the repository header now; the screens below still call this where it used to be.
const header = () => '';

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

const saved = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };

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
      location.hash = `#/${ownerOf(repo)}/${repo.name}/commit/${outcome.head}`;
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
    el('td', {}, link(`#/${ownerOf(repo)}/${repo.name}/pull/${pull.number}`, `#${pull.number} ${pull.title}`)),
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
  // Required checks: what this exact change needs, and whether a result for it already exists.
  const rule = log.state.protections.get(pull.ref);
  const required = rule ? rule.checks : [];
  const expected = required.length && !pull.merged ? await expectedActions(baseHead, pull.head, required) : null;
  const checkRows = expected ? required.map((name, i) => {
    const result = expected[i] && log.state.checks.get(expected[i]);
    const state = !expected[i] ? 'not defined on the branch, so it cannot pass'
      : !result ? 'no result yet for this content'
        : `${result.result}${result.changed ? ' (results under this key have differed: flaky)' : ''}, published by ${keyName(result.by, mine, log.state.owner)} on ${when(result.time)}`;
    return el('tr', {}, el('td', {}, name), el('td', { class: result && result.result === 'pass' ? 'st added' : 'st removed' }, state), el('td', { class: 'mono muted' }, expected[i] ? expected[i].slice(0, 12) : ''));
  }) : [];
  const note = el('span', { class: 'muted' });
  const act = (label, work) => el('button', { onclick: async () => {
    try { await work(); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (error) { note.textContent = ` ${error.message}`; }
  } }, label);
  const who = { name: saved('holo-git-name'), email: saved('holo-git-email') };
  const approvers = [...pull.approvals].map((key) => keyName(key, mine, log.state.owner) + (key === pull.author ? ', does not count: the proposer' : ''));
  const actions = pull.merged ? [] : [
    pull.approvals.has(mine) ? '' : act('Approve this commit', () => approve(repo.name, branch, pull.head)),
    upToDate ? act('Merge', async () => { const merged = await mergePull({ repo, refs, branch, head: pull.head }); location.hash = `#/${ownerOf(repo)}/${repo.name}/commit/${merged.id}`; })
      : act(`Bring up to date with ${branch}`, async () => { await updatePull({ repo, refs, branch, head: pull.head, title: pull.title, who }); location.hash = `#/${ownerOf(repo)}/${repo.name}/pulls`; }),
  ];
  main.replaceChildren(header(repo, refs, branch, 'pulls'),
    el('h2', {}, `#${pull.number} ${pull.title}`),
    el('p', {}, pull.merged ? 'Merged' : 'Open', el('span', { class: 'muted' }, ` · into ${branch} · proposed by ${keyName(pull.author, mine, log.state.owner)} on ${when(pull.time)}`)),
    el('p', { class: 'mono muted' }, 'commit ', link(`#/${ownerOf(repo)}/${repo.name}/commit/${pull.head}`, short(pull.head)),
      upToDate ? '' : ` · behind ${branch}: it must be brought up to date before it can merge`),
    el('p', {}, `Approvals that count: ${pull.counted} of ${pull.needed} required.`,
      el('span', { class: 'muted' }, approvers.length ? ` Approved by ${approvers.join('; ')}.` : ' Nobody has approved this commit.')),
    checkRows.length ? el('table', { class: 'files' }, checkRows) : '',
    checkRows.length ? el('p', { class: 'muted' }, 'A check is keyed by the content it reads. A result for the same content counts, whichever commit it was made for.') : '',
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
  const wants = el('input', { type: 'text', 'aria-label': 'Checks required to change the branch', placeholder: 'required checks, e.g. engine,page', value: rule ? rule.checks.join(',') : '' });
  const needs = el('input', { type: 'number', min: '0', max: '200', 'aria-label': 'Approvals required to change the branch', value: String(rule ? rule.approvals : 0) });
  const guard = el('p', { class: 'push' },
    el('span', {}, rule ? `${branch} is protected: it only moves forward, for ${rule.minimum === 'admin' ? 'the owner only' : 'anyone with write access'}, with ${rule.approvals} approval${rule.approvals === 1 ? '' : 's'}${rule.checks.length ? ` and the checks ${rule.checks.join(', ')}` : ''} required.` : `${branch} is not protected: anyone with write access can rewind it.`),
    who, el('span', { class: 'muted' }, 'approvals required:'), needs, wants,
    el('button', { onclick: async () => { try { await protect(repo.name, branch, who.value, Number(needs.value) || 0, wants.value.split(',').map((name) => name.trim()).filter(Boolean)); rerender(); } catch (error) { note.textContent = ` ${error.message}`; } } }, rule ? 'Change' : 'Protect'),
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
        location.hash = `#/${ownerOf(repo)}/${repo.name}/resolve/${enc(ref)}`;
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

// Called by the router (web/ui/main.js) with the repository already found. Each draws an old screen under the new header.
async function framed(context, tab, draw) {
  main.className = 'page';
  try { await draw(); } catch (error) { main.replaceChildren(ui.flash('error', error.message)); }
  const body = el('div', { class: 'page legacy' }, ...main.childNodes);
  main.className = 'page wide';
  main.replaceChildren(repoHeader(context, tab), body);
  return { title: `${tab === 'pulls' ? S.repo.pulls : S.repo.settings} \u00b7 ${context.repo.name}`, repo: context.repo };
}
export const pulls = (context) => framed(context, 'pulls', () => pullsPage(context.repo, context.refs, context.head));
export const pull = (context, number) => framed(context, 'pulls', () => pullPage(context.repo, context.refs, number));
export const resolve = (context, ref) => framed(context, 'settings', () => resolvePage(context.repo, context.refs, ref || context.head));
export const settings = (context) => framed(context, 'settings', async () => main.replaceChildren(await branchTools(context.repo, context.refs, context.head)));

// For the tests and for debugging by hand.
window.holoGit = { corruptObject, stats, decisions, bundleOf, getRefs };
