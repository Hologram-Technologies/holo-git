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

// A git checkout with the command wired to private result and work directories.
function checkout(name, checks, files) {
  const dir = scratch(name);
  const side = scratch(`${name}-side`);
  const count = join(side, 'count.txt');
  const env = { ...process.env, COUNT: count, HOLO_RESULTS: join(side, 'results'), HOLO_WORK: join(side, 'work') };
  const commit = (message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };
  const write = (path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
  git(dir, 'init', '-q', '-b', 'main');
  write('.holo/checks.json', JSON.stringify({ checks }));
  for (const [path, text] of Object.entries(files)) write(path, text);
  commit('first');
  return {
    dir, write, commit,
    run: (args = [], extra = {}) => spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs'), ...args], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' }),
    runs: () => (existsSync(count) ? readFileSync(count, 'utf8').length : 0),
  };
}
const TICK = 'node -e "require(\'fs\').appendFileSync(process.env.COUNT,\'x\')"';
const exits = (expression) => `node -e "process.exit(${expression}?0:1)"`;
const fileIs = (path, value) => exits(`require('fs').readFileSync('${path}','utf8').trim()==='${value}'`);

test('the command runs a check once per content, in any git checkout', () => {
  const repo = checkout('cli', [
    { name: 'lib', run: TICK, inputs: ['lib'], env: ['COUNT'] },
    { name: 'flag', run: fileIs('flag.txt', 'ok'), inputs: ['flag.txt'] },
  ], { 'lib/a.txt': 'one\n', 'README.md': 'readme\n', 'flag.txt': 'ok\n' });

  let out = repo.run(['run']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(repo.runs(), 1);
  assert.match(out.stdout, /2 checks: 2 ran/);

  out = repo.run(['run']);
  assert.equal(repo.runs(), 1, 'nothing ran the second time');
  assert.match(out.stdout, /2 checks: 0 ran, 2 reused/);

  repo.write('README.md', 'readme, edited\n');
  repo.commit('edit something no check reads');
  repo.run(['run']);
  assert.equal(repo.runs(), 1, 'an unrelated commit runs nothing');

  repo.write('lib/a.txt', 'two\n');
  out = repo.run(['run']);
  assert.equal(repo.runs(), 1, 'an uncommitted edit is not what is checked: the committed content already has a result');
  repo.commit('edit what the check reads');
  out = repo.run(['run']);
  assert.equal(repo.runs(), 2, 'a change to the inputs runs the check again');
  assert.match(out.stdout, /2 checks: 1 ran, 1 reused/);

  repo.write('flag.txt', 'broken\n');
  repo.commit('break the flag');
  assert.equal(repo.run(['run']).status, 1);
  out = repo.run(['run']);
  assert.equal(out.status, 1, 'a reused failure is still a failure');
  assert.match(out.stdout, /flag: fail, reused/);

  git(repo.dir, 'revert', '--no-edit', 'HEAD');
  out = repo.run(['run']);
  assert.equal(out.status, 0, 'reverting to content that passed needs no run');
  assert.match(out.stdout, /2 checks: 0 ran/);
  assert.match(repo.run(['history', '--last', '10']).stdout, /runs avoided: \d+ of 10/);
});

test('a check that reads a file it did not declare fails, instead of passing and being reused wrongly', () => {
  const repo = checkout('undeclared', [
    { name: 'honest', run: fileIs('other/b.txt', 'b'), inputs: ['lib', 'other'] },
    { name: 'sneaky', run: fileIs('other/b.txt', 'b'), inputs: ['lib'] },
  ], { 'lib/a.txt': 'a\n', 'other/b.txt': 'b\n' });
  const out = repo.run(['run']);
  assert.match(out.stdout, /honest: pass/);
  assert.match(out.stdout, /sneaky: fail/, 'the file it reads is not there, because it did not declare it');
  assert.equal(out.status, 1);
});

test('a check sees only the environment it named, and is skipped where a named variable is missing', () => {
  const repo = checkout('environment', [
    { name: 'blind', run: exits('!process.env.SECRET_SETTING'), inputs: ['lib'] },
    { name: 'needs', run: exits("process.env.SECRET_SETTING==='yes'"), inputs: ['lib'], env: ['SECRET_SETTING'] },
  ], { 'lib/a.txt': 'a\n' });

  let out = repo.run(['run'], { SECRET_SETTING: 'yes' });
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /blind: pass/, 'a variable the check did not name is withheld from it');
  assert.match(out.stdout, /needs: pass/);

  const elsewhere = checkout('environment-2', [
    { name: 'needs', run: exits("process.env.SECRET_SETTING==='yes'"), inputs: ['lib'], env: ['SECRET_SETTING'] },
  ], { 'lib/a.txt': 'a\n' });
  out = elsewhere.run(['run'], { SECRET_SETTING: '' });
  assert.match(out.stdout, /needs: cannot run here: it needs SECRET_SETTING/);
  assert.match(out.stdout, /1 check: 0 ran, 0 reused, 1 skipped/);
  assert.equal(out.status, 0, 'a check this machine cannot run is skipped');
  assert.equal(elsewhere.run(['run', '--strict'], { SECRET_SETTING: '' }).status, 1, 'unless every check is demanded');
  assert.equal(elsewhere.run(['run', 'needs'], { SECRET_SETTING: '' }).status, 1, 'or that check was asked for by name');

  // Once a result exists, a machine without the variable reuses it: nothing has to run there.
  assert.equal(elsewhere.run(['run'], { SECRET_SETTING: 'yes' }).status, 0);
  out = elsewhere.run(['run', '--strict'], { SECRET_SETTING: '' });
  assert.match(out.stdout, /needs: pass, reused/);
  assert.equal(out.status, 0, 'a known result is not a failure for want of a variable');
});

test('the declared tools are part of the key, and a machine without them does not run the check', async () => {
  const { actionKey } = await import('../web/checks.js');
  const one = { name: 'c', run: 'x', inputs: ['lib'], tools: [{ run: 'node --version', expect: 'v22.' }] };
  const two = { ...one, tools: [{ run: 'node --version', expect: 'v23.' }] };
  const key = async (definition) => actionKey(parseChecks(JSON.stringify({ checks: [definition] })).get('c'), async () => ({ mode: '40000', id: 'a'.repeat(40) }));
  assert.notEqual(await key(one), await key(two), 'naming another version names another check');
  assert.notEqual(await key(one), await key({ ...one, env: ['X'] }), 'so does naming an environment variable');
  assert.equal(await key(one), await key({ ...one, keep: ['target'] }), 'what is kept between runs is not part of the key');

  const repo = checkout('tools', [
    { name: 'wrong', run: TICK, inputs: ['lib'], env: ['COUNT'], tools: [{ run: 'node --version', expect: 'v0.0.' }] },
    { name: 'absent', run: TICK, inputs: ['lib'], env: ['COUNT'], tools: [{ run: 'no-such-tool-anywhere --version', expect: '1' }] },
  ], { 'lib/a.txt': 'a\n' });
  const out = repo.run(['run']);
  assert.match(out.stdout, /wrong: cannot run here: `node --version` prints "v\d+/);
  assert.match(out.stdout, /absent: cannot run here: `no-such-tool-anywhere --version` did not run here/);
  assert.equal(repo.runs(), 0, 'neither check ran');
});

test('a stored result is not reused once a tool prints something else', () => {
  // The "tool" is a command whose output the test controls through a variable the check names.
  const repo = checkout('drift', [
    { name: 'built', run: TICK, inputs: ['lib'], env: ['COUNT', 'TOOL_VERSION'], tools: [{ run: 'node -e "console.log(process.env.TOOL_VERSION)"', expect: 'tool ' }] },
  ], { 'lib/a.txt': 'a\n' });
  repo.run(['run'], { TOOL_VERSION: 'tool 1.0' });
  repo.run(['run'], { TOOL_VERSION: 'tool 1.0' });
  assert.equal(repo.runs(), 1, 'the same tool: reused');
  const out = repo.run(['run'], { TOOL_VERSION: 'tool 1.1' });
  assert.equal(repo.runs(), 2, 'a different tool: run again');
  assert.match(out.stdout, /built: pass in/);
});

test('the keys listing keeps the shape the GitHub action reads', () => {
  // .github/actions/checks takes the second column as the name and the line ending as the state.
  const repo = checkout('listing', [
    { name: 'first', run: exits('true'), inputs: ['lib'] },
    { name: 'second-one', run: exits('false'), inputs: ['lib'] },
  ], { 'lib/a.txt': 'a\n' });
  const line = /^[0-9a-f]{64} {2}([a-z0-9-]+) {2}(no result|pass|fail)$/;
  let rows = repo.run(['keys']).stdout.trim().split('\n').map((row) => row.match(line));
  assert.deepEqual(rows.map((row) => row && [row[1], row[2]]), [['first', 'no result'], ['second-one', 'no result']]);
  repo.run(['run']);
  rows = repo.run(['keys']).stdout.trim().split('\n').map((row) => row.match(line));
  assert.deepEqual(rows.map((row) => row && [row[1], row[2]]), [['first', 'pass'], ['second-one', 'fail']]);
});
