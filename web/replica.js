// A writable replica is plain object storage: GET and PUT by path, plus a conditional PUT
// (If-Match / If-None-Match) for the one small document that names the current heads.
// The replica is never trusted. Objects are checked against their labels, ref updates are
// signed records chained by digest, and the kernel decides whether each one counts.
//
//   {base}/objects/sha1/<2 hex>/<38 hex>   a git object as its loose-object envelope
//   {base}/log/<sha256>.json               one signed ref update, named by its own digest
//   {base}/state.json                      { protocol, head, refs: { name: { id, record } } }

import { labelOf, parseCommit, parseTree, open } from './engine.js';
import { sameLabel, authorize, MODE } from './kernel.js';
import { verifyRecord, recordDigest } from './identity.js';
import { getObject, putObjects, hasObject, putRepo, listRefUpdates, replaceRefUpdates } from './store.js';

export const PROTOCOL = 'holo-git/replica/1';
const text = new TextDecoder();
const objectUrl = (base, id) => `${base}/objects/sha1/${id.slice(0, 2)}/${id.slice(2)}`;

export async function readState(base) {
  const response = await fetch(`${base}/state.json`, { cache: 'no-store' });
  if (response.status === 404) return { state: null, etag: null };
  if (!response.ok) throw new Error(`replica: ${response.status}`);
  const state = await response.json();
  if (state.protocol !== PROTOCOL) throw new Error('not a holo-git replica');
  return { state, etag: response.headers.get('etag') };
}

// Follow `previous` links back from a record digest. Each record must hash to the name it was fetched by.
async function fetchLog(base, digest) {
  const records = [];
  while (digest) {
    if (!/^[0-9a-f]{64}$/.test(digest) || records.length > 100000) throw new Error('replica log is malformed');
    const response = await fetch(`${base}/log/${digest}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`replica is missing log record ${digest.slice(0, 12)}`);
    const record = await response.json();
    if (await recordDigest(record) !== digest) throw new Error('refused: a log record does not match its digest');
    records.unshift(record);
    digest = record.previous;
  }
  return records;
}

// The rules a log must satisfy, whoever served it. The first signer owns the ref; until grants
// exist, only that key's updates count. Returns the head the log leads to.
export async function verifyChain(records, ref) {
  if (!records.length) throw new Error('empty log');
  const owner = records[0].key;
  let previous = '';
  let head = null;
  for (const record of records) {
    if (record.ref !== ref) throw new Error('refused: the log mixes refs');
    if (record.previous !== previous) throw new Error('refused: the log chain is broken');
    if (head !== null && record.old !== head) throw new Error('refused: the log skips a ref value');
    const signed = await verifyRecord(record);
    const granted = record.key === owner ? MODE.owner : MODE.none;
    if (!authorize({ signed, revoked: false, live: true, granted, required: MODE.write })) {
      throw new Error('refused by the kernel: a ref update in the log does not count');
    }
    head = record.next;
    previous = await recordDigest(record);
  }
  return { owner, head, digest: previous };
}

async function closure(startIds, stop = new Set()) {
  const seen = new Set();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id) || stop.has(id)) continue;
    seen.add(id);
    const envelope = await getObject(id);
    const { kind } = open(envelope);
    if (kind === 'commit') {
      const commit = parseCommit(envelope);
      queue.push(commit.tree, ...commit.parents);
    } else if (kind === 'tree') {
      for (const entry of parseTree(envelope)) if (entry.mode !== '160000') queue.push(entry.id);
    }
  }
  return seen;
}

async function put(url, body, headers) {
  const response = await fetch(url, { method: 'PUT', body, headers });
  return response.status;
}

async function inParallel(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

export async function push(repo, branch, base, report = () => {}) {
  base = base.replace(/\/+$/, '');
  const ref = `refs/heads/${branch}`;
  const all = await listRefUpdates(repo.name);
  if (!all.length) throw new Error('nothing to push: no change has been made on this device');
  if (all.some((record) => record.ref !== ref)) throw new Error('pushing a repository with changes on several branches is not supported yet');
  const local = await verifyChain(all, ref);
  const digests = [];
  for (const record of all) digests.push(await recordDigest(record));

  const { state, etag } = await readState(base);
  const remote = state && state.refs[ref] ? await fetchLog(base, state.refs[ref].record) : [];
  for (let i = 0; i < remote.length; i += 1) {
    if (i >= all.length || await recordDigest(remote[i]) !== digests[i]) {
      throw new Error('refused: the replica has changes this device does not have; clone it again before pushing');
    }
  }
  if (remote.length === all.length) return { objects: 0, records: 0, head: local.head, upToDate: true };

  // Send only what the replica cannot already have: everything new since its head.
  const have = remote.length ? await closure([remote[remote.length - 1].next]) : new Set();
  const send = [...await closure([local.head], have)];
  let bytes = 0;
  let done = 0;
  await inParallel(send, 8, async (id) => {
    const envelope = await getObject(id);
    const status = await put(objectUrl(base, id), envelope, { 'if-none-match': '*' });
    if (status !== 200 && status !== 201 && status !== 204 && status !== 412) throw new Error(`replica refused object ${id.slice(0, 7)}: ${status}`);
    bytes += envelope.length;
    done += 1;
    if (done % 25 === 0) report(`sent ${done} of ${send.length} objects`);
  });
  for (let i = remote.length; i < all.length; i += 1) {
    const status = await put(`${base}/log/${digests[i]}.json`, JSON.stringify(all[i]), { 'content-type': 'application/json', 'if-none-match': '*' });
    if (status >= 300 && status !== 412) throw new Error(`replica refused a log record: ${status}`);
  }
  // The head moves last, and only if nobody moved it meanwhile.
  const next = { protocol: PROTOCOL, head: (state && state.head) || ref, refs: { ...(state ? state.refs : {}), [ref]: { id: local.head, record: local.digest } } };
  const status = await put(`${base}/state.json`, JSON.stringify(next), { 'content-type': 'application/json', ...(etag ? { 'if-match': etag } : { 'if-none-match': '*' }) });
  if (status === 412) throw new Error('refused: the replica changed while pushing; clone it again and retry');
  if (status >= 300) throw new Error(`replica refused the new head: ${status}`);
  return { objects: send.length, bytes, records: all.length - remote.length, head: local.head };
}

export async function cloneReplica(base, name, state, report = () => {}) {
  const refs = {};
  const logs = [];
  for (const [ref, entry] of Object.entries(state.refs)) {
    if (!ref.startsWith('refs/heads/')) continue;
    const records = await fetchLog(base, entry.record);
    const verified = await verifyChain(records, ref);
    if (verified.head !== entry.id) throw new Error('refused: the replica names a head its signed log does not lead to');
    refs[ref] = verified.head;
    logs.push(...records);
  }
  if (!Object.keys(refs).length) throw new Error('the replica has no branches');

  let stored = 0;
  let bytes = 0;
  const queue = Object.values(refs);
  const seen = new Set();
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    if (await hasObject(id)) continue;
    const response = await fetch(objectUrl(base, id));
    if (!response.ok) throw new Error(`replica is missing object ${id}`);
    const envelope = new Uint8Array(await response.arrayBuffer());
    if (!sameLabel(id, labelOf(envelope))) throw new Error(`refused: the replica served different bytes for ${id}`);
    await putObjects([{ id, envelope }]);
    stored += 1;
    bytes += envelope.length;
    if (stored % 25 === 0) report(`fetched ${stored} objects`);
    const { kind, content } = open(envelope);
    if (kind === 'commit') {
      const commit = parseCommit(envelope);
      queue.push(commit.tree, ...commit.parents);
    } else if (kind === 'tree') {
      for (const entry of parseTree(envelope)) if (entry.mode !== '160000') queue.push(entry.id);
    } else if (kind === 'tag') {
      queue.push(text.decode(content).match(/^object ([0-9a-f]{40})/m)[1]);
    }
  }
  const head = refs[state.head] ? state.head : Object.keys(refs)[0];
  const repo = { name, url: base, head, objects: stored, bytes, cloned: Date.now(), replica: base };
  await putRepo(repo, refs);
  await replaceRefUpdates(name, logs);
  return repo;
}
