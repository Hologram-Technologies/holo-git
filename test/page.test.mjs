// Tests for the page's own code, checked against git wherever git has an opinion.
// Run with: npm test   (after `sh scripts/build-web.sh`, which builds web/engine.wasm)

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, makeFixture, newDevice, replicaToGit, scratch, serveStatic, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const records = await import('../web/records.js');
const replicajs = await import('../web/replica.js');
const { fold } = await import('../web/log.js');

let fixture;
let origin;
let replica;
let alice;
let bob;

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  fixture = makeFixture();
  origin = await serveStatic(fixture.served);
  replica = await startReplica();
  alice = newDevice();
  bob = newDevice();
});

after(() => {
  origin.close();
  replica.close();
  cleanup();
});

const text = new TextDecoder();
const utf8 = new TextEncoder();
const commitAs = (name, repoName, message, extra) => (async () => {
  const repo = await store.getRepo(repoName);
  const refs = await store.getRefs(repoName);
  const { commit } = await gitjs.resolveCommit(refs, 'main');
  const node = await gitjs.lookup(commit.tree, 'README.md');
  const before = text.decode(engine.open(await store.getObject(node.id)).content);
  return gitjs.commitFile({ repo, refs, branch: 'main', path: 'README.md', content: utf8.encode(`${before}\n${extra || message}\n`), message, name, email: `${name.toLowerCase()}@example.org` });
})();
const pushTo = async (repoName, url) => replicajs.push(await store.getRepo(repoName), 'main', url);
const cloneFresh = async (device, url) => { await use(device, store); return gitjs.clone(url); };

test('clone from a static replica matches git, object for object', async () => {
  await use(alice, store);
  const repo = await gitjs.clone(`${origin.url}/fixture.git`);
  assert.equal(repo.name, 'fixture');
  const expected = Number(git(fixture.bare, 'count-objects', '-v').match(/in-pack: (\d+)/)[1]);
  assert.equal(repo.objects, expected);
  assert.equal(await store.countObjects(), expected);
  const refs = await store.getRefs('fixture');
  assert.equal(refs['refs/heads/main'], git(fixture.work, 'rev-parse', 'HEAD'));
  const { commit } = await gitjs.resolveCommit(refs, 'main');
  const names = (await gitjs.readTree(commit.tree)).map((entry) => entry.name);
  assert.deepEqual(names, git(fixture.work, 'ls-tree', '--name-only', 'HEAD').split('\n'));
  const blob = await gitjs.lookup(commit.tree, 'docs/notes.txt');
  assert.equal(text.decode(engine.open(await store.getObject(blob.id)).content), readFileSync(join(fixture.work, 'docs/notes.txt'), 'utf8'));
});

test('history, changed paths and line counts match git', async () => {
  await use(alice, store);
  const refs = await store.getRefs('fixture');
  const head = refs['refs/heads/main'];
  const list = await gitjs.history(head, 50);
  assert.deepEqual(list.map((entry) => entry.id), git(fixture.work, 'rev-list', 'HEAD').split('\n'));
  for (const { id, commit } of list) {
    const parentTree = commit.parents.length ? (await gitjs.resolveCommit(refs, commit.parents[0])).commit.tree : null;
    const ours = {};
    for (const change of await gitjs.changedPaths(parentTree, commit.tree)) {
      const read = async (tree) => { try { return engine.open(await store.getObject((await gitjs.lookup(tree, change.path)).id)).content; } catch { return new Uint8Array(); } };
      const before = change.status === 'added' || !parentTree ? new Uint8Array() : await read(parentTree);
      const after = change.status === 'removed' ? new Uint8Array() : await read(commit.tree);
      let added = 0; let removed = 0;
      for (const run of engine.diffLines(before, after)) { if (run.op === 'insert') added += run.count; if (run.op === 'delete') removed += run.count; }
      ours[change.path] = `${added}\t${removed}`;
    }
    const theirs = {};
    for (const line of git(fixture.work, 'show', '--numstat', '--format=', '--no-renames', '--root', '--minimal', id).split('\n').filter(Boolean)) {
      const [added, removed, path] = line.split('\t');
      theirs[path] = `${added}\t${removed}`;
    }
    assert.deepEqual(ours, theirs, `commit ${id.slice(0, 7)}`);
  }
});

test('blame matches git blame line for line', async () => {
  await use(alice, store);
  const refs = await store.getRefs('fixture');
  const { versions } = await gitjs.fileVersions(refs['refs/heads/main'], 'docs/notes.txt');
  const contents = [];
  for (const version of versions) contents.push(engine.open(await store.getObject(version.blob)).content);
  const ours = engine.blameLines(contents).map((index) => versions[index].id);
  const theirs = git(fixture.work, 'blame', '-l', '-s', '--root', '--minimal', 'docs/notes.txt').split('\n').map((line) => line.slice(0, 40));
  assert.deepEqual(ours, theirs);
  assert.ok(new Set(theirs).size >= 3, 'the fixture spreads lines over several commits');
});

test('a stored object whose bytes changed is refused on read', async () => {
  await use(alice, store);
  const refs = await store.getRefs('fixture');
  const { commit } = await gitjs.resolveCommit(refs, 'main');
  const victim = (await gitjs.lookup(commit.tree, 'src/new.txt')).id;
  await store.getObject(victim);
  await store.corruptObject(victim);
  await assert.rejects(store.getObject(victim), /refused/);
  await gitjs.clone(`${origin.url}/fixture.git`); // a fresh copy from the replica repairs it
  await store.getObject(victim);
});

test('a commit made here is one real git accepts: bundle, pull, fsck', async () => {
  await use(alice, store);
  const made = await commitAs('Alice', 'fixture', 'Alice edits the README');
  const refs = await store.getRefs('fixture');
  assert.equal(refs['refs/heads/main'], made.id);
  const bundle = await gitjs.bundleOf(refs, 'main');
  const file = join(scratch('bundle'), 'main.bundle');
  writeFileSync(file, bundle.bytes);
  const target = scratch('pulled');
  git(target, 'clone', '-q', fixture.work, 'repo');
  const repo = join(target, 'repo');
  git(repo, 'pull', '-q', '--ff-only', file, 'main');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), made.id);
  assert.equal(git(repo, 'log', '-1', '--format=%an <%ae> %s'), 'Alice <alice@example.org> Alice edits the README');
  assert.match(readFileSync(join(repo, 'README.md'), 'utf8'), /Alice edits the README\n$/);
  git(repo, 'fsck', '--strict');
});

test('commits that would be malformed or pointless are refused', async () => {
  await use(alice, store);
  const repo = await store.getRepo('fixture');
  const refs = await store.getRefs('fixture');
  const same = engine.open(await store.getObject((await gitjs.lookup((await gitjs.resolveCommit(refs, 'main')).commit.tree, 'README.md')).id)).content;
  const base = { repo, refs, branch: 'main', path: 'README.md', content: same, message: 'm', name: 'A', email: 'a@example.org' };
  await assert.rejects(gitjs.commitFile(base), /nothing changed/);
  await assert.rejects(gitjs.commitFile({ ...base, content: utf8.encode('x'), name: '' }), /name and an email/);
  await assert.rejects(gitjs.commitFile({ ...base, content: utf8.encode('x'), branch: 'nope' }), /not a branch/);
  await assert.rejects(gitjs.commitFile({ ...base, content: utf8.encode('x'), path: 'docs' }), /directory/);
});

test('push sends only what is missing, and git accepts what the replica holds', async () => {
  await use(alice, store);
  const url = `${replica.url}/shared`;
  const first = await pushTo('fixture', url);
  assert.equal(first.records, 1);
  assert.equal(first.objects, await store.countObjects());
  assert.equal((await pushTo('fixture', url)).upToDate, true);
  await commitAs('Alice', 'fixture', 'Alice again');
  const second = await pushTo('fixture', url);
  assert.equal(second.objects, 3, 'a new blob, one tree and one commit');
  assert.equal(second.records, 1);
  const rebuilt = replicaToGit(join(replica.dir, 'shared'));
  git(rebuilt.target, 'fsck', '--strict');
  assert.equal(git(rebuilt.target, 'log', '-1', '--format=%s'), 'Alice again');
});

test('clone from a writable replica verifies the log; tampering is refused', async () => {
  const url = `${replica.url}/shared`;
  const repo = await cloneFresh(newDevice(), url);
  assert.equal(repo.name, 'shared');
  const log = await identity.checkLog('shared');
  assert.equal(log.valid, true);
  assert.equal(log.entries, 2);

  const dir = join(replica.dir, 'shared');
  const statePath = join(dir, 'state.json');
  const good = readFileSync(statePath);
  const state = JSON.parse(good);
  const entry = state.refs['refs/heads/main'];

  const objectPath = join(dir, 'objects', 'sha1', entry.id.slice(0, 2), entry.id.slice(2));
  const object = readFileSync(objectPath);
  const damaged = Buffer.from(object); damaged[damaged.length - 2] ^= 1;
  writeFileSync(objectPath, damaged);
  await assert.rejects(cloneFresh(newDevice(), url), /different bytes/);
  writeFileSync(objectPath, object);

  const recordPath = join(dir, 'log', `${entry.record}.json`);
  const record = readFileSync(recordPath);
  writeFileSync(recordPath, JSON.stringify({ ...JSON.parse(record), next: 'f'.repeat(40) }));
  await assert.rejects(cloneFresh(newDevice(), url), /does not match its digest/);
  writeFileSync(recordPath, record);

  writeFileSync(statePath, JSON.stringify({ ...state, refs: { 'refs/heads/main': { ...entry, id: '0'.repeat(40) } } }));
  await assert.rejects(cloneFresh(newDevice(), url), /does not lead to/);
  writeFileSync(statePath, good);
  await cloneFresh(newDevice(), url);
});

test('known limit: a replica rolled back to an older signed state is accepted by a fresh clone', async () => {
  const url = `${replica.url}/shared`;
  const statePath = join(replica.dir, 'shared', 'state.json');
  const good = readFileSync(statePath);
  const state = JSON.parse(good);
  const entry = state.refs['refs/heads/main'];
  const latest = JSON.parse(readFileSync(join(replica.dir, 'shared', 'log', `${entry.record}.json`)));
  writeFileSync(statePath, JSON.stringify({ ...state, refs: { 'refs/heads/main': { id: latest.old, record: latest.previous } } }));
  await cloneFresh(newDevice(), url);
  assert.equal((await store.getRefs('shared'))['refs/heads/main'], latest.old, 'if this starts failing, rollback is being detected: update the docs');
  writeFileSync(statePath, good);
});

test('a device without a grant cannot change a repository it cloned', async () => {
  await cloneFresh(bob, `${replica.url}/shared`);
  await assert.rejects(commitAs('Bob', 'shared', 'Bob without a grant'), /refused by the kernel/);
  assert.equal((await identity.checkLog('shared')).entries, 2, 'nothing was added to the log');
});

test('grant, use, escalate, revoke: the whole flow between two devices', async () => {
  const url = `${replica.url}/shared`;
  await use(bob, store);
  const bobKey = (await identity.deviceKey()).id;

  await cloneFresh(alice, url);
  await identity.grant('shared', bobKey, 'write', 30);
  assert.equal((await pushTo('shared', url)).objects, 0, 'a grant is a record, not an object');

  await cloneFresh(bob, url);
  const bobs = await commitAs('Bob', 'shared', 'Bob under his grant');
  await assert.rejects(identity.grant('shared', 'c'.repeat(64), 'write', 30), /refused by the kernel: a grant/);
  assert.equal((await pushTo('shared', url)).objects, 3);

  await cloneFresh(alice, url);
  assert.equal((await store.getRefs('shared'))['refs/heads/main'], bobs.id, 'Alice sees Bob\'s change');
  const state = (await identity.checkLog('shared')).state;
  assert.equal(state.grants.get(bobKey).mode, 'write');
  await identity.revoke('shared', bobKey);
  await pushTo('shared', url);

  await cloneFresh(bob, url);
  await assert.rejects(commitAs('Bob', 'shared', 'Bob after revocation'), /refused by the kernel/);
});

test('a grant expires', async () => {
  const url = `${replica.url}/shared`;
  await use(bob, store);
  const bobKey = (await identity.deviceKey()).id;
  await cloneFresh(alice, url);
  await identity.grant('shared', bobKey, 'write', 1);
  await pushTo('shared', url);
  await cloneFresh(bob, url);
  await commitAs('Bob', 'shared', 'Bob within the day');
  await pushTo('shared', url);
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 86400 * 1000;
  try {
    await assert.rejects(commitAs('Bob', 'shared', 'Bob two days later'), /refused by the kernel/);
  } finally { Date.now = realNow; }
});

test('a forged record written straight to the replica makes every clone refuse the log', async () => {
  const url = `${replica.url}/shared`;
  await use(bob, store);
  const key = await identity.deviceKey();
  await cloneFresh(alice, url);
  await identity.revoke('shared', key.id);
  await pushTo('shared', url);

  const statePath = join(replica.dir, 'shared', 'state.json');
  const good = readFileSync(statePath);
  const state = JSON.parse(good);
  const entry = state.refs['refs/heads/main'];
  const first = (await store.listRefUpdates('shared'))[0];
  const forged = { repo: first.repo, ref: 'refs/heads/main', old: entry.id, next: entry.id, time: Date.now(), key: key.id, publicKey: key.publicKey, previous: entry.record };
  forged.signature = records.b64(await crypto.subtle.sign(records.SIGN, key.pair.privateKey, records.statement(forged)));
  assert.equal(await records.verifyRecord(forged), true, 'the forgery is validly signed by a real key');
  const digest = await records.recordDigest(forged);
  writeFileSync(join(replica.dir, 'shared', 'log', `${digest}.json`), JSON.stringify(forged));
  writeFileSync(statePath, JSON.stringify({ ...state, refs: { 'refs/heads/main': { id: entry.id, record: digest } } }));
  await assert.rejects(cloneFresh(newDevice(), url), /refused by the kernel/);
  writeFileSync(statePath, good);
  await cloneFresh(newDevice(), url);
});

test('the log refuses a broken chain, a foreign record, and an unsigned one', async () => {
  await cloneFresh(alice, `${replica.url}/shared`);
  const log = await store.listRefUpdates('shared');
  await fold(log);
  await assert.rejects(fold(log.slice(1)), /chain is broken/);
  await assert.rejects(fold([log[0], { ...log[1], repo: 'elsewhere' }]), /another repository/);
  await assert.rejects(fold([{ ...log[0], signature: log[1].signature }]), /refused by the kernel/);
  await assert.rejects(fold([log[0], { ...log[1], type: 'mystery' }]), /unknown record type/);
});

test('the kernel answers as its acceptance vectors say, and imports nothing', async () => {
  assert.equal(kernel.sameLabel('a'.repeat(40), 'a'.repeat(40)), true);
  assert.equal(kernel.sameLabel('a'.repeat(40), `${'a'.repeat(39)}b`), false);
  assert.equal(kernel.sameLabel('not a label', 'a'.repeat(40)), false);
  const owner = { signed: true, required: kernel.MODE.write, links: [], now: 1000 };
  assert.equal(kernel.decide(owner), true);
  assert.equal(kernel.decide({ ...owner, signed: false }), false);
  const link = (extra) => [{ scope: kernel.MODE.write, signed: true, revoked: false, notAfter: 2000, ...extra }];
  assert.equal(kernel.decide({ ...owner, links: link() }), true);
  assert.equal(kernel.decide({ ...owner, links: link({ notAfter: 999 }) }), false);
  assert.equal(kernel.decide({ ...owner, links: link({ revoked: true }) }), false);
  assert.equal(kernel.decide({ ...owner, links: link({ signed: false }) }), false);
  assert.equal(kernel.decide({ ...owner, links: link(), required: kernel.MODE.admin }), false);
  assert.equal(kernel.decide({ ...owner, links: link({ scope: kernel.MODE.read }) }), false);
  assert.equal(kernel.decide({ ...owner, links: Array(6).fill(link()[0]) }), false, 'more links than the kernel takes');
  assert.equal(WebAssembly.Module.imports(await WebAssembly.compile(wasm('kernel.wasm'))).length, 0);
  assert.equal(WebAssembly.Module.imports(await WebAssembly.compile(wasm('engine.wasm'))).length, 0);
});
