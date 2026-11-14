// Results that travel: a check run on one machine is the result another machine reads, and a
// result nobody trusted, or that was altered, is worth nothing.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, root, scratch, startReplica } from './helpers.mjs';

const TICK = 'node -e "require(\'fs\').appendFileSync(process.env.COUNT,\'x\')"';
const FLAG = 'node -e "process.exit(require(\'fs\').readFileSync(\'flag.txt\',\'utf8\').trim()===\'ok\'?0:1)"';
let store;
let dir;
let count;
const machines = {};

// A machine is its own key, its own results and its own working directories. They share nothing
// but the repository and, when told, the store.
function machine(name) {
  const side = scratch(`machine-${name}`);
  const env = { ...process.env, COUNT: count, HOLO_RESULTS: join(side, 'results'), HOLO_WORK: join(side, 'work'), HOLO_KEY: join(side, 'key.json'), HOLO_STORE: '', HOLO_SIGNERS_REF: '' };
  const run = (args) => spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
  const key = run(['key']).stdout.trim();
  assert.match(key, /^[0-9a-f]{64}$/);
  return { name, key, run, side };
}
const runs = () => (existsSync(count) ? readFileSync(count, 'utf8').length : 0);
const signers = (...list) => {
  const file = join(scratch('signers'), 'signers.json');
  writeFileSync(file, JSON.stringify({ signers: list.map((m) => ({ name: m.name, key: m.key })) }));
  return file;
};
const write = (path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
const commit = (message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };
const keyOf = (m, name) => m.run(['keys']).stdout.split('\n').find((row) => row.includes(`  ${name}  `)).slice(0, 64);
const shared = (action) => (existsSync(join(store.dir, 'results', action)) ? readdirSync(join(store.dir, 'results', action)) : []);

before(async () => {
  store = await startReplica();
  dir = scratch('shared-repo');
  count = join(scratch('count'), 'count.txt');
  git(dir, 'init', '-q', '-b', 'main');
  write('.holo/checks.json', JSON.stringify({ checks: [
    { name: 'lib', run: TICK, inputs: ['lib'], env: ['COUNT'] },
    { name: 'flag', run: FLAG, inputs: ['flag.txt'] },
  ] }));
  write('lib/a.txt', 'one\n');
  write('flag.txt', 'broken\n');
  commit('first');
  for (const name of ['alice', 'bob', 'carol', 'mallory']) machines[name] = machine(name);
});
after(() => { store.close(); cleanup(); });

test('a check run on one machine is not run again on a machine that trusts it', () => {
  const { alice, bob } = machines;
  let out = alice.run(['run', '--store', store.url]);
  assert.equal(runs(), 1);
  assert.match(out.stdout, /lib: pass in/);
  const action = keyOf(alice, 'lib');
  assert.deepEqual(shared(action), [`${alice.key}.json`], 'the signed result is in the store, under its action key and signer');

  out = bob.run(['run', '--store', store.url, '--signers', signers(alice), 'lib']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(runs(), 1, 'nothing ran on the second machine');
  assert.match(out.stdout, /lib: pass, reused, signed by alice/);

  // Once read, it is kept: the store is not asked again.
  out = bob.run(['run', 'lib']);
  assert.equal(runs(), 1);
  assert.match(out.stdout, /lib: pass, reused \(/);
});

test('a shared failure is a failure everywhere, without running', () => {
  const { alice, bob } = machines;
  const out = bob.run(['run', '--store', store.url, '--signers', signers(alice), 'flag']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /flag: fail, reused, signed by alice/);
});

test('a result from a machine that is not on the list is ignored, and that machine adds nothing to the store', () => {
  const { alice, bob, carol } = machines;
  // Carol trusts only Bob, who has published nothing. She runs the check herself.
  let out = carol.run(['run', '--store', store.url, '--signers', signers(bob), 'lib']);
  assert.equal(runs(), 2, 'it ran: the only result there was signed by someone she does not trust');
  assert.match(out.stdout, /lib: pass in/);
  assert.deepEqual(shared(keyOf(alice, 'lib')), [`${alice.key}.json`], 'not being on the list, she published nothing');
  // With no list at all she trusts only herself, and shares what she made.
  out = carol.run(['run', '--store', store.url, 'lib']);
  assert.equal(runs(), 2);
  assert.equal(shared(keyOf(alice, 'lib')).length, 2, 'a result made before the store was named is shared when it is');
});

test('a result altered in the store is not believed', () => {
  const { alice, mallory } = machines;
  const action = keyOf(alice, 'flag');
  const file = join(store.dir, 'results', action, `${alice.key}.json`);
  const honest = readFileSync(file, 'utf8');
  assert.equal(JSON.parse(honest).result, 'fail');
  // Whoever can write to the store turns Alice's failure into a pass.
  writeFileSync(file, JSON.stringify({ ...JSON.parse(honest), result: 'pass' }));
  let out = machine('reader-one').run(['run', '--store', store.url, '--signers', signers(alice), '--no-publish', 'flag']);
  assert.equal(out.status, 1, 'the altered pass is not accepted');
  assert.match(out.stdout, /flag: fail in/, 'the check ran here instead, and failed as it should');

  // Or puts a pass signed by another key where Alice's result belongs.
  writeFileSync(join(dir, 'flag.txt'), 'ok\n');
  commit('make the flag pass, so that a real signed pass exists');
  mallory.run(['run', '--store', store.url, 'flag']);
  const forged = readFileSync(join(store.dir, 'results', keyOf(mallory, 'flag'), `${mallory.key}.json`), 'utf8');
  git(dir, 'revert', '--no-edit', 'HEAD');
  // A signed pass for other content, moved under the failing content's key.
  writeFileSync(file, forged);
  out = machine('reader-two').run(['run', '--store', store.url, '--signers', signers(alice), '--no-publish', 'flag']);
  assert.equal(out.status, 1, 'a pass for other content, by an untrusted key, is not accepted');
  // And the same record renamed to claim this action.
  writeFileSync(file, JSON.stringify({ ...JSON.parse(forged), action }));
  out = machine('reader-three').run(['run', '--store', store.url, '--signers', signers(alice, mallory), '--no-publish', 'flag']);
  assert.equal(out.status, 1, 'even from a trusted key, a result cannot be moved to another action: the action is signed');
  writeFileSync(file, honest);
});

test('the list of signers is read from a ref the change cannot move', () => {
  const { alice, mallory } = machines;
  write('.holo/signers.json', JSON.stringify({ signers: [{ name: 'alice', key: alice.key }] }));
  commit('name the trusted signers');
  git(dir, 'checkout', '-q', '-b', 'change');
  // The change adds its author to the list and touches what the check reads.
  write('.holo/signers.json', JSON.stringify({ signers: [{ name: 'alice', key: alice.key }, { name: 'mallory', key: mallory.key }] }));
  write('lib/a.txt', 'two\n');
  commit('a change that trusts its own author');
  const before = runs();
  mallory.run(['run', '--store', store.url, '--signers-ref', 'HEAD', 'lib']);
  assert.equal(runs(), before + 1, 'the author ran the check and published a result');

  let out = machine('gate').run(['run', '--store', store.url, '--signers-ref', 'main', 'lib']);
  assert.equal(runs(), before + 2, 'read from main, the list does not name the author, so the check runs');
  assert.match(out.stdout, /lib: pass in/);
  // Read from the change itself, the author's word would have been taken. That is the mistake the option exists to avoid.
  out = machine('careless').run(['run', '--store', store.url, '--signers-ref', 'HEAD', 'lib']);
  assert.equal(runs(), before + 2);
  assert.match(out.stdout, /signed by mallory/);
  git(dir, 'checkout', '-q', 'main');
});

test('the listing of keys counts a shared result, and a store that cannot be reached only costs the run', () => {
  const { alice } = machines;
  const reader = machine('lister');
  assert.match(reader.run(['keys']).stdout, /  lib  no result/);
  assert.match(reader.run(['keys', '--store', store.url, '--signers', signers(alice)]).stdout, /  lib  pass/);

  const before = runs();
  const out = machine('offline').run(['run', '--store', 'http://127.0.0.1:9', 'lib']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(runs(), before + 1);
  assert.match(out.stdout, /lib: note, the result was not shared/);
});

test('a signers file that cannot be read is an error, never an empty list', () => {
  const bad = join(scratch('bad'), 'signers.json');
  writeFileSync(bad, JSON.stringify({ signers: [{ name: 'x', key: 'short' }] }));
  const out = machines.bob.run(['run', '--store', store.url, '--signers', bad]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /signers file/);
});
