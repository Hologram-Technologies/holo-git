// Pull requests and the merge gate: a branch that requires approvals moves only to a commit that
// has them, from people other than its proposer, who can still write when it merges.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, makeFixture, newDevice, replicaToGit, serveStatic, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const records = await import('../web/records.js');
const replicajs = await import('../web/replica.js');
const { fold } = await import('../web/log.js');
const { fetchFrom, updatePull } = await import('../web/sync.js');

const HEAD = 'refs/heads/main';
const utf8 = new TextEncoder();
let origin;
let replica;
let url;
const people = {};

const repo = () => store.getRepo('review');
const refs = () => store.getRefs('review');
const head = async () => (await refs())[HEAD];
const state = async () => (await identity.checkLog('review')).state;
const pull = async (number) => (await state()).pulls.find((p) => p.number === number);
const who = (name) => ({ name, email: `${name.toLowerCase()}@example.org` });

// Act as one person: switch device, fetch what others published, do the thing, publish it.
async function as(name, work) {
  await use(people[name], store);
  await fetchFrom(await repo(), 'main', url, who(name));
  const result = await work();
  await replicajs.push(await repo(), 'main', url);
  return result;
}
const change = async (name, path, content, message) => ({ repo: await repo(), refs: await refs(), branch: 'main', path, content: utf8.encode(content), message, ...who(name) });
const propose = async (name, path, content, message) => as(name, async () => gitjs.proposeFile(await change(name, path, content, message)));
const merge = async (name, id) => as(name, async () => gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: id }));
const approve = async (name, id) => as(name, () => identity.approve('review', 'main', id));

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  origin = await serveStatic(makeFixture().served);
  replica = await startReplica();
  url = `${replica.url}/review`;
  const keys = {};
  for (const name of ['Alice', 'Bob', 'Carol']) {
    people[name] = newDevice();
    await use(people[name], store);
    keys[name] = (await identity.deviceKey()).id;
  }
  people.keys = keys;
  await use(people.Alice, store);
  await gitjs.clone(`${origin.url}/fixture.git`);
  const first = await store.getRepo('fixture');
  await gitjs.commitFile({ repo: first, refs: await store.getRefs('fixture'), branch: 'main', path: 'README.md', content: utf8.encode('# Review\n'), message: 'Alice starts', ...who('Alice') });
  await identity.grant('fixture', keys.Bob, 'write', 0);
  await identity.grant('fixture', keys.Carol, 'write', 0);
  await replicajs.push(first, 'main', url);
  for (const name of ['Alice', 'Bob', 'Carol']) { await use(people[name], store); await gitjs.clone(url); }
});

after(() => {
  origin.close();
  replica.close();
  cleanup();
});

test('a pull request proposes a commit without moving the branch, and travels to others', async () => {
  const before = await as('Bob', head);
  const proposed = await propose('Bob', 'bob.txt', 'from bob\n', 'Bob proposes a file');
  assert.equal(await as('Bob', head), before, 'the branch did not move');
  await use(people.Alice, store);
  await fetchFrom(await repo(), 'main', url, who('Alice'));
  const seen = await pull(1);
  assert.equal(seen.title, 'Bob proposes a file');
  assert.equal(seen.head, proposed.id);
  assert.equal(seen.author, people.keys.Bob);
  assert.equal(seen.merged, false);
  assert.equal(engine.parseCommit(await store.getObject(proposed.id)).parents[0], before, 'the proposed commit was fetched');
  await merge('Alice', proposed.id);
  assert.equal(await as('Carol', head), proposed.id);
  assert.equal((await pull(1)).merged, true);
});

test('on a branch that requires an approval, nobody commits directly, the owner included', async () => {
  await as('Alice', () => identity.protect('review', 'main', 'write', 1));
  await use(people.Bob, store);
  await fetchFrom(await repo(), 'main', url, who('Bob'));
  await assert.rejects(gitjs.commitFile(await change('Bob', 'bob.txt', 'direct\n', 'Bob commits directly')), /refused by the kernel: a change/);
  await use(people.Alice, store);
  await assert.rejects(gitjs.commitFile(await change('Alice', 'README.md', 'direct\n', 'Alice commits directly')), /refused by the kernel: a change/);
});

test('the proposer cannot approve their own change; someone else can, and then it merges', async () => {
  const proposed = await propose('Bob', 'bob.txt', 'reviewed\n', 'Bob proposes an edit');
  await approve('Bob', proposed.id);
  assert.equal((await as('Bob', () => pull(2))).counted, 0, 'a self-approval is recorded but does not count');
  await use(people.Bob, store);
  await assert.rejects(gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: proposed.id }), /refused by the kernel: a change/);
  await approve('Alice', proposed.id);
  assert.equal((await as('Bob', () => pull(2))).counted, 1);
  await merge('Bob', proposed.id);
  assert.equal(await as('Carol', head), proposed.id);
});

test('an approval is for one commit: bringing a pull request up to date needs a new approval', async () => {
  const bobs = await propose('Bob', 'bob.txt', 'reviewed\nmore\n', 'Bob proposes more');
  await approve('Alice', bobs.id);
  // Meanwhile the branch moves: Carol's change is proposed, approved and merged.
  const carols = await propose('Carol', 'carol.txt', 'carol\n', 'Carol proposes a file');
  await approve('Alice', carols.id);
  await merge('Carol', carols.id);

  await use(people.Bob, store);
  await fetchFrom(await repo(), 'main', url, who('Bob'));
  await assert.rejects(gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: bobs.id }), /behind the branch/);
  const updated = await as('Bob', async () => updatePull({ repo: await repo(), refs: await refs(), branch: 'main', head: bobs.id, title: 'Bob proposes more', who: who('Bob') }));
  assert.deepEqual(engine.parseCommit(await store.getObject(updated.id)).parents, [bobs.id, carols.id]);
  const fresh = (await state()).pulls.find((p) => p.head === updated.id);
  assert.equal(fresh.counted, 0, 'the approval of the old commit does not carry over');
  await assert.rejects(gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: updated.id }), /refused by the kernel: a change/);
  await approve('Alice', updated.id);
  await merge('Bob', updated.id);
  assert.equal(await as('Alice', head), updated.id);
});

test('an approval from someone whose access was withdrawn stops counting', async () => {
  const proposed = await propose('Bob', 'bob.txt', 'again\n', 'Bob proposes again');
  await approve('Carol', proposed.id);
  assert.equal((await as('Bob', () => (state()))).pulls.find((p) => p.head === proposed.id).counted, 1);
  await as('Alice', () => identity.revoke('review', people.keys.Carol));
  await use(people.Bob, store);
  await fetchFrom(await repo(), 'main', url, who('Bob'));
  assert.equal((await state()).pulls.find((p) => p.head === proposed.id).counted, 0);
  await assert.rejects(gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: proposed.id }), /refused by the kernel: a change/);
  await approve('Alice', proposed.id);
  await merge('Bob', proposed.id);
});

test('a merge without approvals, signed by a writer and written straight to the store, is refused by every clone', async () => {
  const proposed = await propose('Bob', 'bob.txt', 'unreviewed\n', 'Bob proposes something unreviewed');
  await use(people.Bob, store);
  const key = await identity.deviceKey();
  const log = await store.listRefUpdates('review');
  const folded = await fold(log);
  const forged = { ref: HEAD, old: folded.heads[HEAD], next: proposed.id, repo: log[0].repo, time: Date.now(), key: key.id, publicKey: key.publicKey, previous: folded.digest };
  forged.signature = records.b64(await crypto.subtle.sign(records.SIGN, key.pair.privateKey, records.statement(forged)));
  assert.equal(await records.verifyRecord(forged), true);
  const statePath = join(replica.dir, 'review', 'state.json');
  const good = readFileSync(statePath);
  const digest = await records.recordDigest(forged);
  writeFileSync(join(replica.dir, 'review', 'log', `${digest}.json`), JSON.stringify(forged));
  writeFileSync(statePath, JSON.stringify({ ...JSON.parse(good), refs: { [HEAD]: { id: proposed.id, record: digest } } }));
  await use(newDevice(), store);
  await assert.rejects(gitjs.clone(url), /refused by the kernel: a change/);
  writeFileSync(statePath, good);
});

test('a fresh clone reaches the same numbers and states, and git accepts the repository', async () => {
  await use(newDevice(), store);
  await gitjs.clone(url);
  const all = (await state()).pulls;
  assert.deepEqual(all.map((p) => p.number), all.map((_, i) => i + 1));
  // Six, not seven: bringing Bob's pull request up to date moved it to a new commit, and it stayed the same pull request, which was then merged.
  assert.deepEqual(all.map((p) => p.merged), [true, true, true, true, true, false]);
  assert.equal(all[2].title, 'Bob proposes more');
  assert.equal(all[2].events.filter((event) => event.kind === 'head').length, 1, 'its one update is in its history');
  const rebuilt = replicaToGit(join(replica.dir, 'review'));
  git(rebuilt.target, 'fsck', '--strict');
  assert.equal(git(rebuilt.target, 'rev-parse', 'main'), await head());
});

test('the kernel refuses when approvals or checks fall short, whatever else is true', async () => {
  const base = { signed: true, required: kernel.MODE.write, links: [], now: 1000, fastForward: true, forceAllowed: false, approvalsHave: 1, approvalsNeeded: 1, checksHave: 0, checksNeeded: 0 };
  assert.equal(kernel.gate(base), true);
  assert.equal(kernel.gate({ ...base, approvalsHave: 0 }), false);
  assert.equal(kernel.gate({ ...base, approvalsHave: 300, approvalsNeeded: 2 }), true);
  assert.equal(kernel.gate({ ...base, checksNeeded: 1 }), false);
  assert.equal(kernel.gate({ ...base, checksHave: 2, checksNeeded: 2 }), true);
  assert.equal(kernel.gate({ ...base, fastForward: false }), false);
  assert.equal(kernel.gate({ ...base, signed: false }), false);
  assert.equal(kernel.gate({ ...base, approvalsNeeded: 300, approvalsHave: 300 }), false, 'more than the kernel can be asked for is a refusal');
  assert.equal(kernel.gate({ ...base, approvalsHave: -1 }), false);
});
