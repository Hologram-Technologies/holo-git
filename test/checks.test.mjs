// Checks keyed by content: a result is for what a check reads, so it is reused wherever that
// content appears again, and the merge gate counts it without anything running twice.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, makeFixture, newDevice, root, scratch, serveStatic, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const records = await import('../web/records.js');
const replicajs = await import('../web/replica.js');
const { fold } = await import('../web/log.js');
const { fetchFrom } = await import('../web/sync.js');
const { expectedActions } = await import('../web/evidence.js');
const { parseChecks } = await import('../web/checks.js');

const HEAD = 'refs/heads/main';
const utf8 = new TextEncoder();
let origin;
let replica;
let url;
const people = {};

const repo = () => store.getRepo('checked');
const refs = () => store.getRefs('checked');
const head = async () => (await refs())[HEAD];
const state = async () => (await identity.checkLog('checked')).state;
const who = (name) => ({ name, email: `${name.toLowerCase()}@example.org` });
async function as(name, work) {
  await use(people[name], store);
  await fetchFrom(await repo(), 'main', url, who(name));
  const result = await work();
  await replicajs.push(await repo(), 'main', url);
  return result;
}
const propose = async (name, path, content, message) => as(name, async () => gitjs.proposeFile({ repo: await repo(), refs: await refs(), branch: 'main', path, content: utf8.encode(content), message, ...who(name) }));
const tryMerge = async (name, id) => { await use(people[name], store); await fetchFrom(await repo(), 'main', url, who(name)); return gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: id }); };
const merge = async (name, id) => { await tryMerge(name, id); await replicajs.push(await repo(), 'main', url); };
const keyFor = async (id, names = ['unit']) => (await expectedActions(await head(), id, names));
const publish = async (name, id, result = 'pass') => as(name, async () => identity.recordCheck('checked', 'unit', (await keyFor(id))[0], result));
const checkRecords = async () => (await store.listRefUpdates('checked')).filter((record) => record.type === 'check').length;
// The command must work in any shell, so it is a Node one-liner. It fails if docs/notes.txt says so.
const RUN = 'node -e "process.exit(require(\'fs\').readFileSync(\'docs/notes.txt\',\'utf8\').includes(\'BROKEN\')?1:0)"';
const definitions = (inputs) => JSON.stringify({ checks: [{ name: 'unit', run: RUN, inputs }] });

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  origin = await serveStatic(makeFixture().served);
  replica = await startReplica();
  url = `${replica.url}/checked`;
  const keys = {};
  for (const name of ['Alice', 'Bob', 'Runner']) {
    people[name] = newDevice();
    await use(people[name], store);
    keys[name] = (await identity.deviceKey()).id;
  }
  people.keys = keys;
  await use(people.Alice, store);
  await gitjs.clone(`${origin.url}/fixture.git`);
  const first = await store.getRepo('fixture');
  await gitjs.commitFile({ repo: first, refs: await store.getRefs('fixture'), branch: 'main', path: '.holo/checks.json', content: utf8.encode(definitions(['docs'])), message: 'Define the unit check', ...who('Alice') });
  await identity.grant('fixture', keys.Bob, 'write', 0);
  await identity.grant('fixture', keys.Runner, 'write', 0);
  await identity.protect('fixture', 'main', 'write', 0, ['unit']);
  await replicajs.push(first, 'main', url);
  for (const name of ['Alice', 'Bob', 'Runner']) { await use(people[name], store); await gitjs.clone(url); }
});

after(() => {
  origin.close();
  replica.close();
  cleanup();
});

test('a check\'s key follows what it reads and nothing else', async () => {
  const docs = await propose('Bob', 'docs/notes.txt', 'changed notes\n', 'Bob changes the docs');
  const readme = await propose('Bob', 'README.md', '# Changed\n', 'Bob changes the README');
  await use(people.Bob, store);
  const base = await head();
  const [atBase] = await expectedActions(base, base, ['unit']);
  assert.equal((await keyFor(readme.id))[0], atBase, 'a change outside the inputs leaves the key alone');
  assert.notEqual((await keyFor(docs.id))[0], atBase, 'a change inside the inputs gives a new key');
  assert.match(atBase, /^[0-9a-f]{64}$/);
  people.docs = docs.id;
  people.readme = readme.id;
});

test('a required check blocks the merge until its result exists', async () => {
  await assert.rejects(tryMerge('Bob', people.docs), /refused by the kernel: a change/);
  await publish('Runner', people.docs);
  await merge('Bob', people.docs);
  assert.equal(await as('Alice', head), people.docs);
});

test('a change that touches nothing the check reads merges on the earlier result, with nothing run', async () => {
  // The README proposal was made before the docs change merged; bring it up to date first.
  const { updatePull } = await import('../web/sync.js');
  const updated = await as('Bob', async () => updatePull({ repo: await repo(), refs: await refs(), branch: 'main', head: people.readme, title: 'Bob changes the README', who: who('Bob') }));
  const before = await checkRecords();
  await merge('Bob', updated.id);
  assert.equal(await as('Alice', head), updated.id);
  assert.equal(await checkRecords(), before, 'no check result was published for this change');
});

test('a failing result does not count; a later pass does, and the key is marked as having differed', async () => {
  const proposed = await propose('Bob', 'docs/notes.txt', 'second notes\n', 'Bob changes the docs again');
  await publish('Runner', proposed.id, 'fail');
  await assert.rejects(tryMerge('Bob', proposed.id), /refused by the kernel: a change/);
  await publish('Runner', proposed.id, 'pass');
  await use(people.Bob, store);
  await fetchFrom(await repo(), 'main', url, who('Bob'));
  const action = (await keyFor(proposed.id))[0];
  assert.equal((await state()).checks.get(action).changed, true);
  await merge('Bob', proposed.id);
});

test('a change cannot weaken the check it must pass: definitions are read from the branch', async () => {
  // Bob proposes pointing the check at a path he leaves alone. Then he changes docs on top of that.
  const weaker = await propose('Bob', '.holo/checks.json', definitions(['src']), 'Bob points the check elsewhere');
  await use(people.Bob, store);
  const base = await head();
  const [onBranch] = await expectedActions(base, weaker.id, ['unit']);
  const [byItsOwnRules] = await expectedActions(weaker.id, weaker.id, ['unit']);
  assert.notEqual(onBranch, byItsOwnRules, 'the two readings differ, and the gate uses the branch\'s');
  assert.equal((await state()).checks.get(onBranch).result, 'pass', 'docs are untouched, so the branch\'s check is already satisfied');
  await merge('Bob', weaker.id);
  // Now the branch itself says the check reads src. A docs change needs a result under that reading.
  const after = await propose('Bob', 'docs/notes.txt', 'third notes\n', 'Bob changes the docs under the new rules');
  await assert.rejects(tryMerge('Bob', after.id), /refused by the kernel: a change/);
  await publish('Runner', after.id);
  await merge('Bob', after.id);
});

test('a result from someone who can no longer write stops counting', async () => {
  const proposed = await propose('Bob', 'src/new.txt', 'touched\n', 'Bob changes src');
  await publish('Runner', proposed.id);
  await as('Alice', () => identity.revoke('checked', people.keys.Runner));
  await assert.rejects(tryMerge('Bob', proposed.id), /refused by the kernel: a change/);
  await as('Alice', async () => identity.recordCheck('checked', 'unit', (await keyFor(proposed.id))[0], 'pass'));
  await merge('Bob', proposed.id);
});

test('a required check the branch does not define can never be satisfied', async () => {
  await as('Alice', () => identity.protect('checked', 'main', 'write', 0, ['unit', 'ghost']));
  const proposed = await propose('Bob', 'README.md', '# Again\n', 'Bob changes the README again');
  await use(people.Bob, store);
  await fetchFrom(await repo(), 'main', url, who('Bob'));
  assert.deepEqual((await keyFor(proposed.id, ['unit', 'ghost'])).map(Boolean), [true, false]);
  await assert.rejects(tryMerge('Bob', proposed.id), /refused by the kernel: a change/);
  await as('Alice', () => identity.protect('checked', 'main', 'write', 0, ['unit']));
  await merge('Bob', proposed.id);
});

test('a merge without the check, signed by a writer and written straight to the store, is refused by every clone', async () => {
  const proposed = await propose('Bob', 'src/new.txt', 'unchecked\n', 'Bob changes src without a check');
  await use(people.Bob, store);
  const key = await identity.deviceKey();
  const log = await store.listRefUpdates('checked');
  const folded = await fold(log);
  const forged = { ref: HEAD, old: folded.heads[HEAD], next: proposed.id, repo: log[0].repo, time: Date.now(), key: key.id, publicKey: key.publicKey, previous: folded.digest };
  forged.signature = records.b64(await crypto.subtle.sign(records.SIGN, key.pair.privateKey, records.statement(forged)));
  const statePath = join(replica.dir, 'checked', 'state.json');
  const good = readFileSync(statePath);
  const digest = await records.recordDigest(forged);
  writeFileSync(join(replica.dir, 'checked', 'log', `${digest}.json`), JSON.stringify(forged));
  writeFileSync(statePath, JSON.stringify({ ...JSON.parse(good), refs: { [HEAD]: { id: proposed.id, record: digest } } }));
  await use(newDevice(), store);
  await assert.rejects(gitjs.clone(url), /refused by the kernel: a change/);
  writeFileSync(statePath, good);
  await gitjs.clone(url);
  assert.equal((await identity.checkLog('checked')).valid, true);
});

test('the runner fetches a proposal, runs only what has no result, and publishes it', async () => {
  const keyFile = join(scratch('runner'), 'key.json');
  const runner = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'runner.mjs'), ...args, '--key', keyFile], { encoding: 'utf8' });
  const key = runner('key').stdout.trim();
  assert.match(key, /^[0-9a-f]{64}$/);
  // Put the check back on docs, so that a docs change needs a fresh result.
  const back = await propose('Bob', '.holo/checks.json', definitions(['docs']), 'Bob points the check back at docs');
  await publish('Alice', back.id);
  await merge('Bob', back.id);
  await as('Alice', () => identity.grant('checked', key, 'write', 0));

  const good = await propose('Bob', 'docs/notes.txt', 'fine notes\n', 'Bob writes fine notes');
  const bad = await propose('Bob', 'docs/notes.txt', 'BROKEN notes\n', 'Bob writes broken notes');
  const first = runner('run', '--replica', url);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  // Every open pull request is checked, including ones superseded earlier in this file.
  assert.match(first.stdout, /(\d+) checks ran, 0 reused, \1 results published/);
  assert.match(first.stdout, /unit: pass/);
  assert.match(first.stdout, /unit: fail/);

  const second = runner('run', '--replica', url);
  assert.match(second.stdout, /0 checks ran, \d+ reused, 0 results published/, 'a second run finds every result already there');

  await assert.rejects(tryMerge('Bob', bad.id), /refused by the kernel: a change/);
  await merge('Bob', good.id);
  assert.equal(await as('Alice', head), good.id);
});

test('a definitions file that cannot be read is an error, never an empty set of checks', () => {
  assert.throws(() => parseChecks('{"checks":[{"name":"Bad Name","run":"x","inputs":["a"]}]}'), /bad name/);
  assert.throws(() => parseChecks('{"checks":[{"name":"a","run":"x","inputs":["../etc"]}]}'), /bad input/);
  assert.throws(() => parseChecks('{"checks":[{"name":"a","run":"x","inputs":[]}]}'), /lists no inputs/);
  assert.throws(() => parseChecks('{"checks":[{"name":"a","run":"x","inputs":["a"]},{"name":"a","run":"y","inputs":["b"]}]}'), /defined twice/);
  assert.throws(() => parseChecks('{}'), /expected/);
});

test('the command runs a check once per content, in any git checkout', () => {
  const dir = scratch('cli');
  const count = join(dir, '..', `count-${process.pid}.txt`);
  const results = join(dir, '..', `results-${process.pid}`);
  const env = { ...process.env, COUNT: count, HOLO_RESULTS: results };
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
  const runs = () => (existsSync(count) ? readFileSync(count, 'utf8').length : 0);
  const commit = (message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, '.holo'));
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'README.md'), 'readme\n');
  writeFileSync(join(dir, 'flag.txt'), 'ok\n');
  const tick = 'node -e "require(\'fs\').appendFileSync(process.env.COUNT,\'x\')"';
  writeFileSync(join(dir, '.holo', 'checks.json'), JSON.stringify({ checks: [
    { name: 'lib', run: tick, inputs: ['lib'] },
    { name: 'flag', run: 'node -e "process.exit(require(\'fs\').readFileSync(\'flag.txt\',\'utf8\').trim()===\'ok\'?0:1)"', inputs: ['flag.txt'] },
  ] }));
  commit('first');

  let out = run('run');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(runs(), 1);
  assert.match(out.stdout, /2 checks: 2 ran/);

  out = run('run');
  assert.equal(runs(), 1, 'nothing ran the second time');
  assert.match(out.stdout, /2 checks: 0 ran/);

  writeFileSync(join(dir, 'README.md'), 'readme, edited\n');
  commit('edit something no check reads');
  out = run('run');
  assert.equal(runs(), 1, 'an unrelated commit runs nothing');

  writeFileSync(join(dir, 'lib', 'a.txt'), 'two\n');
  out = run('run', 'lib');
  assert.equal(out.status, 1, 'uncommitted changes under the inputs are refused');
  assert.match(out.stdout, /refused, uncommitted changes/);
  commit('edit what the check reads');
  out = run('run');
  assert.equal(runs(), 2, 'a change to the inputs runs the check again');
  assert.match(out.stdout, /2 checks: 1 ran/);

  writeFileSync(join(dir, 'flag.txt'), 'broken\n');
  commit('break the flag');
  assert.equal(run('run').status, 1);
  out = run('run');
  assert.equal(out.status, 1, 'a reused failure is still a failure');
  assert.match(out.stdout, /flag: fail, reused/);

  git(dir, 'revert', '--no-edit', 'HEAD');
  out = run('run');
  assert.equal(out.status, 0, 'reverting to content that passed needs no run');
  assert.match(out.stdout, /2 checks: 0 ran/);
  assert.match(run('history', '--last', '10').stdout, /runs avoided: \d+ of 10/);
  assert.ok(execFileSync);
});
