// The push adapter against a real S3-compatible store (SeaweedFS), which checks every signature.
// Skipped unless S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY and S3_TEST_SECRET_KEY are set:
//   sh scripts/dev-s3.sh start   (with throwaway keys in the environment)

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, makeFixture, newDevice, scratch, serveStatic, use, wasm } from './helpers.mjs';

const endpoint = process.env.S3_TEST_ENDPOINT;
const keys = { accessKey: process.env.S3_TEST_ACCESS_KEY, secretKey: process.env.S3_TEST_SECRET_KEY };
const skip = !endpoint || !keys.accessKey || !keys.secretKey ? 'no S3 test store configured' : false;

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const replicajs = await import('../web/replica.js');
const { signS3 } = await import('../web/s3sign.js');
const { fetchFrom } = await import('../web/sync.js');

const utf8 = new TextEncoder();
const text = new TextDecoder();
const bucket = `holo-git-test-${Date.now()}`;
const url = `${endpoint}/${bucket}/team`;
let fixture;
let origin;
let alice;
let bob;

const signed = async (method, target, headers = {}, body) => fetch(target, { method, headers: await signS3({ method, url: target, headers, body }, keys), body });
const push = async (name = 'team') => replicajs.push(await store.getRepo(name), 'main', url);
const fetchAs = async (name) => fetchFrom(await store.getRepo('team'), 'main', url, { name, email: `${name.toLowerCase()}@example.org` });
async function edit(repoName, name, path, content, message) {
  return gitjs.commitFile({ repo: await store.getRepo(repoName), refs: await store.getRefs(repoName), branch: 'main', path, content: utf8.encode(content), message, name, email: `${name.toLowerCase()}@example.org` });
}
const read = async (path) => {
  const { commit } = await gitjs.resolveCommit(await store.getRefs('team'), 'main');
  return text.decode(engine.open(await store.getObject((await gitjs.lookup(commit.tree, path)).id)).content);
};

before(async () => {
  if (skip) return;
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  fixture = makeFixture();
  origin = await serveStatic(fixture.served);
  alice = newDevice();
  bob = newDevice();
  assert.equal((await signed('PUT', `${endpoint}/${bucket}`)).status, 200, 'the test bucket is created');
});

after(() => {
  if (origin) origin.close();
  cleanup();
});

test('without keys, and with the wrong keys, the store refuses and the page says why', { skip }, async () => {
  await use(alice, store);
  await gitjs.clone(`${origin.url}/fixture.git`);
  await edit('fixture', 'Alice', 'README.md', '# Team\n', 'Alice starts');
  replicajs.setCredentials(url, null);
  await assert.rejects(replicajs.push(await store.getRepo('fixture'), 'main', url), /it needs keys/);
  replicajs.setCredentials(url, { ...keys, secretKey: 'not-the-secret' });
  await assert.rejects(replicajs.push(await store.getRepo('fixture'), 'main', url), /keys are wrong/);
  await assert.rejects(gitjs.clone(url), /keys are wrong/);
});

test('push to the store, then clone it back on another device and hand it to git', { skip }, async () => {
  await use(alice, store);
  replicajs.setCredentials(url, keys);
  const first = await replicajs.push(await store.getRepo('fixture'), 'main', url);
  assert.equal(first.objects, await store.countObjects());
  assert.equal(first.records, 1);
  assert.equal((await replicajs.push(await store.getRepo('fixture'), 'main', url)).upToDate, true);

  // What landed is what was sent: an object fetched straight from the store hashes to its name.
  const head = (await store.getRefs('fixture'))['refs/heads/main'];
  const raw = new Uint8Array(await (await signed('GET', `${url}/objects/sha1/${head.slice(0, 2)}/${head.slice(2)}`)).arrayBuffer());
  assert.equal(engine.labelOf(raw), head);

  await use(newDevice(), store);
  const repo = await gitjs.clone(url);
  assert.equal(repo.name, 'team');
  assert.equal((await store.getRefs('team'))['refs/heads/main'], head);
  assert.equal((await identity.checkLog('team')).valid, true);
  const bundle = await gitjs.bundleOf(await store.getRefs('team'), 'main');
  const file = join(scratch('s3-bundle'), 'main.bundle');
  writeFileSync(file, bundle.bytes);
  const target = scratch('s3-pulled');
  git(target, 'clone', '-q', fixture.work, 'repo');
  git(join(target, 'repo'), 'pull', '-q', '--ff-only', file, 'main');
  assert.equal(git(join(target, 'repo'), 'rev-parse', 'HEAD'), head);
  git(join(target, 'repo'), 'fsck', '--strict');
});

test('two writers racing for the head: the store lets exactly one through', { skip }, async () => {
  await use(alice, store);
  await gitjs.clone(url);
  await edit('team', 'Alice', 'race.txt', 'alice\n', 'Alice races');
  // Just before Alice's head write reaches the store, someone else rewrites the head document.
  const realFetch = globalThis.fetch;
  let interfered = false;
  globalThis.fetch = async (target, init = {}) => {
    if (!interfered && init.method === 'PUT' && String(target).endsWith('/state.json')) {
      interfered = true;
      const current = await (await signed('GET', `${url}/state.json`)).text();
      assert.equal((await signed('PUT', `${url}/state.json`, {}, `${current} `)).status, 200);
    }
    return realFetch(target, init);
  };
  try {
    await assert.rejects(push(), /changed while pushing/);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(interfered, true);
  // Alice's objects and record are in the store but the head never moved to them; a retry succeeds.
  const again = await push();
  assert.equal(again.records, 1);
  assert.equal(again.objects, 3, 'objects are offered again; the store already has them and says so');
});

test('grant, fetch and merge between two devices through the store', { skip }, async () => {
  await use(bob, store);
  const bobKey = (await identity.deviceKey()).id;
  await use(alice, store);
  await identity.grant('team', bobKey, 'write', 0);
  await push();
  await use(bob, store);
  await gitjs.clone(url);
  const bobs = await edit('team', 'Bob', 'bob.txt', 'bob was here\n', 'Bob adds a file');
  await use(alice, store);
  const alices = await edit('team', 'Alice', 'alice.txt', 'alice too\n', 'Alice adds a file');
  await push();
  await use(bob, store);
  await assert.rejects(push(), /has changes this device does not have/);
  const merged = await fetchAs('Bob');
  assert.equal(merged.outcome, 'merged');
  assert.deepEqual(engine.parseCommit(await store.getObject(merged.head)).parents, [alices.id, bobs.id]);
  await push();
  await use(alice, store);
  assert.equal((await fetchAs('Alice')).outcome, 'fast-forward');
  assert.equal(await read('bob.txt'), 'bob was here\n');
  assert.equal(await read('alice.txt'), 'alice too\n');
  assert.equal((await identity.checkLog('team')).valid, true);
});
