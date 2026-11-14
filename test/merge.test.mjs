// Fetch and merge between two devices, checked against git's own merge.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, makeFixture, newDevice, replicaToGit, scratch, serveStatic, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const replicajs = await import('../web/replica.js');
const { fetchFrom } = await import('../web/sync.js');

let origin;
let replica;
let url;
let alice;
let bob;
let bobKey;
const text = new TextDecoder();
const utf8 = new TextEncoder();
const HEAD = 'refs/heads/main';

const head = async () => (await store.getRefs('team'))[HEAD];
const push = async () => replicajs.push(await store.getRepo('team'), 'main', url);
const fetchAs = async (name) => fetchFrom(await store.getRepo('team'), 'main', url, { name, email: `${name.toLowerCase()}@example.org` });
const read = async (path) => {
  const { commit } = await gitjs.resolveCommit(await store.getRefs('team'), 'main');
  return text.decode(engine.open(await store.getObject((await gitjs.lookup(commit.tree, path)).id)).content);
};
async function edit(name, path, change, message) {
  const repo = await store.getRepo('team');
  const refs = await store.getRefs('team');
  let before = '';
  try { before = await read(path); } catch { /* a new file */ }
  return gitjs.commitFile({ repo, refs, branch: 'main', path, content: utf8.encode(change(before)), message, name, email: `${name.toLowerCase()}@example.org` });
}
const line = (number, replacement) => (content) => content.split('\n').map((value, i) => (i === number - 1 ? replacement : value)).join('\n');
const on = async (device) => use(device, store);

// What git itself makes of merging two commits, using the objects the replica holds.
function gitMerge(ours, theirs) {
  const { target } = replicaToGit(join(replica.dir, 'team'));
  try {
    return { clean: true, tree: execFileSync('git', ['merge-tree', '--write-tree', ours, theirs], { cwd: target, encoding: 'utf8' }).trim().split('\n')[0] };
  } catch (error) {
    if (error.status === 1) return { clean: false };
    throw error;
  }
}

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  origin = await serveStatic(makeFixture().served);
  replica = await startReplica();
  url = `${replica.url}/team`;
  alice = newDevice();
  bob = newDevice();
  await on(bob);
  bobKey = (await identity.deviceKey()).id;

  await on(alice);
  await gitjs.clone(`${origin.url}/fixture.git`);
  const repo = await store.getRepo('fixture');
  const refs = await store.getRefs('fixture');
  await gitjs.commitFile({ repo, refs, branch: 'main', path: 'README.md', content: utf8.encode('# Team\n'), message: 'Alice starts', name: 'Alice', email: 'alice@example.org' });
  await identity.grant('fixture', bobKey, 'write', 0);
  await replicajs.push(repo, 'main', url);
  await gitjs.clone(url); // from here on Alice works in the clone named after the replica
  await on(bob);
  await gitjs.clone(url);
});

after(() => {
  origin.close();
  replica.close();
  cleanup();
});

test('nothing to fetch, and unpushed work, are reported as such', async () => {
  await on(bob);
  assert.equal((await fetchAs('Bob')).outcome, 'up to date');
  await edit('Bob', 'bob.txt', () => 'bob was here\n', 'Bob adds a file');
  const result = await fetchAs('Bob');
  assert.equal(result.outcome, 'ahead');
  assert.equal(result.unpushed, 1);
  await push();
});

test('a clone with no changes of its own fast-forwards', async () => {
  await on(alice);
  const before = await head();
  const result = await fetchAs('Alice');
  assert.equal(result.outcome, 'fast-forward');
  assert.notEqual(await head(), before);
  assert.equal(await read('bob.txt'), 'bob was here\n');
  assert.equal((await identity.checkLog('team')).valid, true);
});

test('changes to different files merge, and the tree is the one git would write', async () => {
  await on(alice);
  const alices = await edit('Alice', 'README.md', (content) => `${content}\nAlice's line.\n`, 'Alice edits the README');
  await push();

  await on(bob);
  const bobs = await edit('Bob', 'docs/notes.txt', line(28, 'Bob changed line 28'), 'Bob edits the notes');
  await assert.rejects(push(), /has changes this device does not have/);
  const result = await fetchAs('Bob');
  assert.equal(result.outcome, 'merged');
  const merge = engine.parseCommit(await store.getObject(result.head));
  assert.deepEqual(merge.parents, [alices.id, bobs.id]);
  assert.match(await read('README.md'), /Alice's line\./);
  assert.match(await read('docs/notes.txt'), /Bob changed line 28/);
  assert.equal((await identity.checkLog('team')).valid, true);
  await push();

  const theirs = gitMerge(alices.id, bobs.id);
  assert.equal(theirs.clean, true);
  assert.equal(merge.tree, theirs.tree, 'our merged tree is the tree git writes');
  const rebuilt = replicaToGit(join(replica.dir, 'team'));
  git(rebuilt.target, 'fsck', '--strict');
  assert.equal(git(rebuilt.target, 'log', '-1', '--format=%P'), `${alices.id} ${bobs.id}`);

  await on(alice);
  assert.equal((await fetchAs('Alice')).outcome, 'fast-forward');
  assert.equal(await head(), result.head);
});

test('changes to different parts of one file merge as git merges them', async () => {
  await on(alice);
  const alices = await edit('Alice', 'docs/notes.txt', line(2, 'Alice changed line 2'), 'Alice edits near the top');
  await push();
  await on(bob);
  const bobs = await edit('Bob', 'docs/notes.txt', line(20, 'Bob changed line 20'), 'Bob edits further down');
  const result = await fetchAs('Bob');
  assert.equal(result.outcome, 'merged');
  const notes = await read('docs/notes.txt');
  assert.match(notes, /Alice changed line 2/);
  assert.match(notes, /Bob changed line 20/);
  await push();
  assert.equal(engine.parseCommit(await store.getObject(result.head)).tree, gitMerge(alices.id, bobs.id).tree);
  await on(alice);
  await fetchAs('Alice');
});

test('changes to the same line conflict, as in git, and leave this clone untouched', async () => {
  await on(alice);
  const base = await read('docs/notes.txt');
  const alices = await edit('Alice', 'docs/notes.txt', line(10, 'Alice wants this'), 'Alice edits line 10');
  await push();
  await on(bob);
  const bobs = await edit('Bob', 'docs/notes.txt', line(10, 'Bob wants that'), 'Bob edits line 10');
  const logBefore = (await identity.checkLog('team')).entries;
  const result = await fetchAs('Bob');
  assert.equal(result.outcome, 'conflict');
  assert.deepEqual(result.conflicts, ['docs/notes.txt']);
  assert.equal(await head(), bobs.id, 'the branch did not move');
  assert.equal((await identity.checkLog('team')).entries, logBefore, 'the log did not change');
  await assert.rejects(push(), /has changes this device does not have/);

  // Git must see the same conflict in the same three texts.
  const dir = scratch('conflict');
  writeFileSync(join(dir, 'base'), base);
  writeFileSync(join(dir, 'ours'), line(10, 'Bob wants that')(base));
  writeFileSync(join(dir, 'theirs'), line(10, 'Alice wants this')(base));
  assert.throws(() => execFileSync('git', ['merge-file', '-p', 'ours', 'base', 'theirs'], { cwd: dir, stdio: 'pipe' }), (error) => error.status === 1, 'git reports one conflict');
  assert.ok(alices.id);
  await gitjs.clone(url); // the only way out for now: take the replica's state and redo the change
  assert.match(await read('docs/notes.txt'), /Alice wants this/);
});

test('the same new file added identically merges; added differently conflicts', async () => {
  await on(alice);
  await edit('Alice', 'shared.txt', () => 'same content\n', 'Alice adds shared.txt');
  await push();
  await on(bob);
  await edit('Bob', 'shared.txt', () => 'same content\n', 'Bob adds the same file');
  assert.equal((await fetchAs('Bob')).outcome, 'merged');
  await push();
  await on(alice);
  await fetchAs('Alice');

  await edit('Alice', 'clash.txt', () => 'from Alice\n', 'Alice adds clash.txt');
  await push();
  await on(bob);
  await edit('Bob', 'clash.txt', () => 'from Bob\n', 'Bob adds a different clash.txt');
  const result = await fetchAs('Bob');
  assert.equal(result.outcome, 'conflict');
  assert.deepEqual(result.conflicts, ['clash.txt']);
  await gitjs.clone(url);
});

test('an unpushed grant is issued again on top of what was fetched', async () => {
  const carol = 'c'.repeat(64);
  await on(alice);
  await fetchAs('Alice');
  await identity.grant('team', carol, 'read', 0);
  await on(bob);
  const bobs = await edit('Bob', 'bob.txt', (content) => `${content}again\n`, 'Bob adds a line');
  await push();
  await on(alice);
  await assert.rejects(push(), /has changes this device does not have/);
  const result = await fetchAs('Alice');
  assert.equal(result.outcome, 'fast-forward');
  assert.equal(result.reissued, 1);
  assert.equal(await head(), bobs.id);
  const log = await identity.checkLog('team');
  assert.equal(log.valid, true);
  assert.equal(log.state.grants.get(carol).mode, 'read');
  const pushed = await push();
  assert.equal(pushed.records, 1);
  assert.equal(pushed.objects, 0);
});

test('a device whose access was withdrawn meanwhile cannot merge its work in', async () => {
  await on(bob);
  await fetchAs('Bob');
  const bobs = await edit('Bob', 'bob.txt', (content) => `${content}too late\n`, 'Bob works while being revoked');
  await on(alice);
  await identity.revoke('team', bobKey);
  await edit('Alice', 'README.md', (content) => `${content}After the revocation.\n`, 'Alice continues');
  await push();
  await on(bob);
  const entries = (await identity.checkLog('team')).entries;
  await assert.rejects(fetchAs('Bob'), /refused by the kernel/);
  assert.equal(await head(), bobs.id, 'Bob\'s clone is as it was');
  assert.equal((await identity.checkLog('team')).entries, entries);
  await assert.rejects(push(), /has changes this device does not have/);
  const rebuilt = replicaToGit(join(replica.dir, 'team'));
  git(rebuilt.target, 'fsck', '--strict');
  assert.equal(git(rebuilt.target, 'log', '-1', '--format=%s'), 'Alice continues');
});
