// Protected branches: they only move forward, and only for those the rule names.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, makeFixture, newDevice, serveStatic, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const records = await import('../web/records.js');
const replicajs = await import('../web/replica.js');
const { fold } = await import('../web/log.js');
const { fetchFrom } = await import('../web/sync.js');

const HEAD = 'refs/heads/main';
const utf8 = new TextEncoder();
let origin;
let replica;
let url;
let alice;
let bob;
let bobKey;

const on = async (device) => use(device, store);
const head = async () => (await store.getRefs('guarded'))[HEAD];
const push = async () => replicajs.push(await store.getRepo('guarded'), 'main', url);
const fetchAs = async (name) => fetchFrom(await store.getRepo('guarded'), 'main', url, { name, email: `${name.toLowerCase()}@example.org` });
async function edit(name, path, content, message) {
  return gitjs.commitFile({ repo: await store.getRepo('guarded'), refs: await store.getRefs('guarded'), branch: 'main', path, content: utf8.encode(content), message, name, email: `${name.toLowerCase()}@example.org` });
}

// A change signed by the current device's real key, written without going through the page's checks.
async function signRaw(fields) {
  const key = await identity.deviceKey();
  const log = await store.listRefUpdates('guarded');
  const state = await fold(log);
  const record = { ...fields, repo: log[0].repo, time: Date.now(), key: key.id, publicKey: key.publicKey, previous: state.digest };
  record.signature = records.b64(await crypto.subtle.sign(records.SIGN, key.pair.privateKey, records.statement(record)));
  return { record, log };
}

// Put a record straight into the replica and point the head document at it.
async function plant(record, id) {
  const statePath = join(replica.dir, 'guarded', 'state.json');
  const good = readFileSync(statePath);
  const digest = await records.recordDigest(record);
  writeFileSync(join(replica.dir, 'guarded', 'log', `${digest}.json`), JSON.stringify(record));
  writeFileSync(statePath, JSON.stringify({ ...JSON.parse(good), refs: { [HEAD]: { id, record: digest } } }));
  return () => writeFileSync(statePath, good);
}

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  origin = await serveStatic(makeFixture().served);
  replica = await startReplica();
  url = `${replica.url}/guarded`;
  alice = newDevice();
  bob = newDevice();
  await on(bob);
  bobKey = (await identity.deviceKey()).id;
  await on(alice);
  await gitjs.clone(`${origin.url}/fixture.git`);
  const repo = await store.getRepo('fixture');
  await gitjs.commitFile({ repo, refs: await store.getRefs('fixture'), branch: 'main', path: 'README.md', content: utf8.encode('# Guarded\n'), message: 'Alice starts', name: 'Alice', email: 'alice@example.org' });
  await identity.grant('fixture', bobKey, 'write', 0);
  await replicajs.push(repo, 'main', url);
  await gitjs.clone(url);
  await edit('Alice', 'README.md', '# Guarded\n\nSecond.\n', 'Alice continues');
  await push();
});

after(() => {
  origin.close();
  replica.close();
  cleanup();
});

test('an unprotected branch can be rewound by anyone with write access', async () => {
  await on(bob);
  await gitjs.clone(url);
  const tip = await head();
  const parent = engine.parseCommit(await store.getObject(tip)).parents[0];
  const { record } = await signRaw({ ref: HEAD, old: tip, next: parent });
  const restore = await plant(record, parent);
  await use(newDevice(), store);
  await gitjs.clone(url);
  assert.equal(await head(), parent, 'the rewind was accepted: this is what protection is for');
  restore();
});

test('only the owner can protect a branch or remove its protection', async () => {
  await on(bob);
  await gitjs.clone(url);
  await assert.rejects(identity.protect('guarded', 'main', 'write'), /refused by the kernel: a protection/);
  await on(alice);
  await identity.protect('guarded', 'main', 'write');
  const pushed = await push();
  assert.equal(pushed.records, 1);
  assert.equal(pushed.objects, 0);
  assert.equal((await identity.checkLog('guarded')).state.protections.get(HEAD).minimum, 'write');
  await on(bob);
  await gitjs.clone(url);
  await assert.rejects(identity.unprotect('guarded', 'main'), /refused by the kernel: a removal of protection/);
});

test('a protected branch still moves forward for a writer', async () => {
  await on(bob);
  await gitjs.clone(url);
  await edit('Bob', 'bob.txt', 'bob\n', 'Bob adds a file to the protected branch');
  await push();
  await on(alice);
  assert.equal((await fetchAs('Alice')).outcome, 'fast-forward');
});

test('a rewind of a protected branch is refused, even validly signed and written straight to the store', async () => {
  await on(bob);
  await gitjs.clone(url);
  const tip = await head();
  const parent = engine.parseCommit(await store.getObject(tip)).parents[0];
  const { record, log } = await signRaw({ ref: HEAD, old: tip, next: parent });
  assert.equal(await records.verifyRecord(record), true, 'the rewind is signed by a key that has write access');
  await assert.rejects(fold([...log, record], { strict: true }), /refused by the kernel: a change/);
  const restore = await plant(record, parent);
  await use(newDevice(), store);
  await assert.rejects(gitjs.clone(url), /refused by the kernel: a change/);
  restore();
  await gitjs.clone(url);
  assert.equal(await head(), tip);
});

test('the owner cannot rewind a protected branch either', async () => {
  await on(alice);
  await fetchAs('Alice');
  const tip = await head();
  const parent = engine.parseCommit(await store.getObject(tip)).parents[0];
  const { record, log } = await signRaw({ ref: HEAD, old: tip, next: parent });
  await assert.rejects(fold([...log, record], { strict: true }), /refused by the kernel: a change/);
});

test('before the history is fetched a protected change is marked unchecked; strictly, that is a refusal', async () => {
  await on(alice);
  const log = await store.listRefUpdates('guarded');
  await use(newDevice(), store); // a device with no objects at all
  const loose = await fold(log);
  assert.ok(loose.unverified.length >= 1);
  await assert.rejects(fold(log, { strict: true }), /cannot check that a protected branch only moved forward/);
});

test('a merge on a protected branch counts as moving forward', async () => {
  await on(alice);
  await fetchAs('Alice');
  const alices = await edit('Alice', 'alice.txt', 'alice\n', 'Alice adds a file');
  await push();
  await on(bob);
  await gitjs.clone(url);
  // Bob's clone is current; rewind his view by working from before Alice's push is not possible,
  // so make the divergence the other way round: Bob commits, Alice commits again and pushes first.
  const bobs = await edit('Bob', 'bob.txt', 'bob\nagain\n', 'Bob edits his file');
  await on(alice);
  const alices2 = await edit('Alice', 'alice.txt', 'alice\nagain\n', 'Alice edits her file');
  await push();
  await on(bob);
  const merged = await fetchAs('Bob');
  assert.equal(merged.outcome, 'merged');
  assert.deepEqual(engine.parseCommit(await store.getObject(merged.head)).parents, [alices2.id, bobs.id]);
  await push();
  await use(newDevice(), store);
  await gitjs.clone(url);
  assert.equal(await head(), merged.head);
  assert.ok(alices.id);
});

test('an owner-only branch refuses a writer and accepts the owner', async () => {
  await on(alice);
  await fetchAs('Alice');
  await identity.protect('guarded', 'main', 'admin');
  await push();
  await on(bob);
  await gitjs.clone(url);
  await assert.rejects(edit('Bob', 'bob.txt', 'not allowed\n', 'Bob tries the owner-only branch'), /refused by the kernel: a change/);
  await on(alice);
  await edit('Alice', 'alice.txt', 'owner\n', 'Alice changes the owner-only branch');
  await push();
});

test('once protection is removed a writer can change the branch again', async () => {
  await on(alice);
  await identity.unprotect('guarded', 'main');
  await push();
  assert.equal((await identity.checkLog('guarded')).state.protections.has(HEAD), false);
  await on(bob);
  await gitjs.clone(url);
  await edit('Bob', 'bob.txt', 'allowed again\n', 'Bob after the protection was removed');
  await push();
});

test('the kernel refuses a rewind when force is not allowed, whatever else is true', async () => {
  const owner = { signed: true, required: kernel.MODE.write, links: [], now: 1000 };
  assert.equal(kernel.refUpdate({ ...owner, fastForward: true, forceAllowed: false }), true);
  assert.equal(kernel.refUpdate({ ...owner, fastForward: false, forceAllowed: false }), false);
  assert.equal(kernel.refUpdate({ ...owner, fastForward: false, forceAllowed: true }), true);
  assert.equal(kernel.refUpdate({ ...owner, fastForward: null, forceAllowed: false }), false, 'unknown is not yes');
  assert.equal(kernel.refUpdate({ ...owner, signed: false, fastForward: true, forceAllowed: true }), false);
});
