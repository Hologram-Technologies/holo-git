// Cloning from a static replica and reading history. No server-side git is involved:
// the replica only has to serve files (git's "dumb" HTTP layout).

import { readPack, readLoose, parseCommit, parseTree, open, makeObject, makeTree, makeCommit, makeBundle } from './engine.js';
import { moveRef } from './identity.js';
import { putObjects, hasObject, getObject, putRepo } from './store.js';

const text = new TextDecoder();

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

export function repoName(url) {
  return url.replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '') || 'repository';
}

export async function clone(url, report = () => {}) {
  const base = url.replace(/\/+$/, '');
  const refs = {};
  for (const line of (await fetchText(`${base}/info/refs`)).split('\n')) {
    const [id, name] = line.split('\t');
    if (id && name && !name.endsWith('^{}')) refs[name] = id;
  }
  const headText = (await fetchText(`${base}/HEAD`)).trim();
  const head = headText.startsWith('ref: ') ? headText.slice(5) : headText;

  let packs = [];
  try {
    packs = (await fetchText(`${base}/objects/info/packs`)).split('\n')
      .filter((line) => line.startsWith('P ')).map((line) => line.slice(2).trim());
  } catch { /* a replica with only loose objects */ }

  let stored = 0;
  let bytes = 0;
  for (const pack of packs) {
    report(`fetching ${pack}`);
    const data = new Uint8Array(await (await fetch(`${base}/objects/pack/${pack}`)).arrayBuffer());
    bytes += data.length;
    report(`verifying ${pack}`);
    const objects = readPack(data);
    await putObjects(objects);
    stored += objects.length;
  }

  // Anything a ref needs that no pack held is fetched as a loose object, and must hash to its name.
  const queue = Object.values(refs);
  const seen = new Set();
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if (await hasObject(id)) continue;
    const response = await fetch(`${base}/objects/${id.slice(0, 2)}/${id.slice(2)}`);
    if (!response.ok) throw new Error(`replica is missing object ${id}`);
    const data = new Uint8Array(await response.arrayBuffer());
    bytes += data.length;
    const object = readLoose(data);
    if (object.id !== id) throw new Error(`replica served different bytes for ${id}`);
    await putObjects([object]);
    stored += 1;
    const { kind, content } = open(object.envelope);
    if (kind === 'commit') {
      const commit = parseCommit(object.envelope);
      queue.push(commit.tree, ...commit.parents);
    } else if (kind === 'tree') {
      for (const entry of parseTree(object.envelope)) if (entry.mode !== '160000') queue.push(entry.id);
    } else if (kind === 'tag') {
      queue.push(text.decode(content).match(/^object ([0-9a-f]{40})/m)[1]);
    }
  }

  const repo = { name: repoName(base), url: base, head, objects: stored, bytes, cloned: Date.now() };
  await putRepo(repo, refs);
  return repo;
}

// A ref name or a full identifier -> the commit it means, peeling annotated tags.
export async function resolveCommit(refs, ref) {
  let id = refs[ref] || refs[`refs/heads/${ref}`] || refs[`refs/tags/${ref}`] || (/^[0-9a-f]{40}$/.test(ref) ? ref : null);
  if (!id) throw new Error(`unknown ref ${ref}`);
  for (;;) {
    const envelope = await getObject(id);
    const { kind, content } = open(envelope);
    if (kind === 'commit') return { id, commit: parseCommit(envelope) };
    if (kind !== 'tag') throw new Error(`${ref} does not name a commit`);
    id = text.decode(content).match(/^object ([0-9a-f]{40})/m)[1];
  }
}

export async function readTree(id) {
  return parseTree(await getObject(id));
}

// Walk a path from a root tree. Returns { kind: 'tree' | 'blob', id, mode }.
export async function lookup(treeId, path) {
  let node = { kind: 'tree', id: treeId, mode: '40000' };
  for (const part of path.split('/').filter(Boolean)) {
    if (node.kind !== 'tree') throw new Error(`${path}: not a directory`);
    const entry = (await readTree(node.id)).find((e) => e.name === part);
    if (!entry) throw new Error(`${path}: no such file`);
    node = { kind: entry.mode === '40000' ? 'tree' : 'blob', id: entry.id, mode: entry.mode };
  }
  return node;
}

export function person(line) {
  const match = line.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
  return match ? { name: match[1], email: match[2], time: Number(match[3]) * 1000 } : { name: line, email: '', time: 0 };
}

// Newest first, across all parents.
export async function history(startId, limit = 50) {
  const out = [];
  const seen = new Set([startId]);
  const frontier = [{ id: startId, commit: parseCommit(await getObject(startId)) }];
  while (frontier.length && out.length < limit) {
    frontier.sort((a, b) => person(b.commit.committer).time - person(a.commit.committer).time);
    const next = frontier.shift();
    out.push(next);
    for (const parent of next.commit.parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      frontier.push({ id: parent, commit: parseCommit(await getObject(parent)) });
    }
  }
  return out;
}

// Paths that differ between two trees. Identical subtrees are skipped by identifier, unread.
export async function changedPaths(oldTree, newTree, prefix = '', out = []) {
  if (oldTree === newTree) return out;
  const before = new Map((oldTree ? await readTree(oldTree) : []).map((e) => [e.name, e]));
  const after = new Map((newTree ? await readTree(newTree) : []).map((e) => [e.name, e]));
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(name);
    const b = after.get(name);
    if (a && b && a.id === b.id && a.mode === b.mode) continue;
    const aTree = a && a.mode === '40000';
    const bTree = b && b.mode === '40000';
    if (aTree || bTree) await changedPaths(aTree ? a.id : null, bTree ? b.id : null, `${prefix}${name}/`, out);
    if (a && !aTree && b && !bTree) out.push({ status: 'modified', path: prefix + name });
    else {
      if (a && !aTree) out.push({ status: 'removed', path: prefix + name });
      if (b && !bTree) out.push({ status: 'added', path: prefix + name });
    }
  }
  return out;
}

// The versions of one path along the first-parent line, newest first. Commits that left the
// file's identifier unchanged are skipped without reading the file: equal labels, equal bytes.
// Each entry names the oldest commit that had that version, which is the one that wrote it.
export async function fileVersions(startId, path, limit = 200) {
  const versions = [];
  let id = startId;
  let walked = 0;
  while (id && versions.length < limit) {
    const commit = parseCommit(await getObject(id));
    let blob = null;
    try {
      const node = await lookup(commit.tree, path);
      if (node.kind === 'blob') blob = node.id;
    } catch { /* the path does not exist in this commit */ }
    if (!blob) break;
    const last = versions[versions.length - 1];
    if (last && last.blob === blob) { last.id = id; last.commit = commit; } else versions.push({ id, commit, blob });
    id = commit.parents[0];
    walked += 1;
  }
  return { versions, walked, complete: !id || versions.length < limit };
}

const clean = (value) => value.replace(/[<>\n\r\0]/g, '').trim();

function identityLine(name, email, time) {
  const offset = -new Date(time).getTimezoneOffset();
  const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return `${clean(name)} <${clean(email)}> ${Math.floor(time / 1000)} ${zone}`;
}

// Replace or add one file under a tree, rebuilding only the trees on its path.
// Every other subtree is reused by its identifier, unread.
async function rewrite(treeId, parts, blobId, made) {
  const entries = treeId ? await readTree(treeId) : [];
  if (entries.some((entry) => entry.name.includes('�'))) throw new Error('this directory has a file name that is not UTF-8; editing it is not supported yet');
  const [name, ...rest] = parts;
  const existing = entries.find((entry) => entry.name === name);
  let entry;
  if (rest.length === 0) {
    if (existing && existing.mode === '40000') throw new Error(`${name} is a directory`);
    entry = { mode: existing ? existing.mode : '100644', name, id: blobId };
  } else {
    if (existing && existing.mode !== '40000') throw new Error(`${name} is a file`);
    entry = { mode: '40000', name, id: await rewrite(existing ? existing.id : null, rest, blobId, made) };
  }
  const tree = makeTree([...entries.filter((e) => e.name !== name), entry]);
  made.push(tree);
  return tree.id;
}

// Commit one file change to a branch on this device.
export async function commitFile({ repo, refs, branch, path, content, message, name, email }) {
  const ref = `refs/heads/${branch}`;
  const old = refs[ref];
  if (!old) throw new Error(`${branch} is not a branch`);
  if (!clean(name) || !clean(email)) throw new Error('a name and an email are needed to commit');
  if (!message.trim()) throw new Error('a commit message is needed');
  const parent = parseCommit(await getObject(old));
  const blob = makeObject('blob', content);
  const made = [blob];
  const tree = await rewrite(parent.tree, path.split('/').filter(Boolean), blob.id, made);
  if (tree === parent.tree) throw new Error('nothing changed');
  const who = identityLine(name, email, Date.now());
  const commit = makeCommit({ tree, parents: [old], author: who, committer: who, message: `${message.trim()}\n` });
  made.push(commit);
  await putObjects(made);
  await moveRef({ repo: repo.name, ref, old, next: commit.id, parents: [old] });
  return { id: commit.id, objects: made.length };
}

// Every object a commit needs, each read through the store and so re-verified.
export async function reachable(startId) {
  const envelopes = [];
  const seen = new Set();
  const queue = [startId];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const envelope = await getObject(id);
    envelopes.push(envelope);
    const { kind } = open(envelope);
    if (kind === 'commit') {
      const commit = parseCommit(envelope);
      queue.push(commit.tree, ...commit.parents);
    } else if (kind === 'tree') {
      for (const entry of parseTree(envelope)) if (entry.mode !== '160000') queue.push(entry.id);
    }
  }
  return envelopes;
}

export async function bundleOf(refs, branch) {
  const id = refs[`refs/heads/${branch}`];
  if (!id) throw new Error(`${branch} is not a branch`);
  const envelopes = await reachable(id);
  return { bytes: makeBundle(`refs/heads/${branch}`, id, envelopes), objects: envelopes.length, id };
}
