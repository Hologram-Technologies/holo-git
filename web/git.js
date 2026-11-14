// Cloning from a static replica and reading history. No server-side git is involved:
// the replica only has to serve files (git's "dumb" HTTP layout).

import { readPack, readLoose, parseCommit, parseTree, open } from './engine.js';
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
