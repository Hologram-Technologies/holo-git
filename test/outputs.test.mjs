// Keys from what a step consumes: a check that uses another's product is keyed by the product,
// so a change to the sources that leaves the product the same runs nothing after the producer.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, root, scratch, startReplica } from './helpers.mjs';

const { parseChecks, actionKey } = await import('../web/checks.js');

// The producer drops comment lines, so a comment can change without the product changing.
const BUILD = `const fs = require('fs');
fs.appendFileSync(process.env.COUNT, 'b');
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/built.txt', fs.readFileSync('src/a.txt', 'utf8').split('\\n').filter((line) => !line.startsWith('#')).join('\\n'));
`;
const TEST = `const fs = require('fs');
fs.appendFileSync(process.env.COUNT, 't');
process.exit(fs.readFileSync('out/built.txt', 'utf8') === fs.readFileSync('tests/expected.txt', 'utf8') ? 0 : 1);
`;
let store;
let dir;
let count;
const write = (path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
const commit = (message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };
const ran = () => (existsSync(count) ? readFileSync(count, 'utf8') : '');

function machine(name) {
  const side = scratch(`out-${name}`);
  const env = { ...process.env, COUNT: count, HOLO_RESULTS: join(side, 'results'), HOLO_OUTPUTS: join(side, 'outputs'), HOLO_WORK: join(side, 'work'), HOLO_KEY: join(side, 'key.json'), HOLO_STORE: '', HOLO_SIGNERS_REF: '' };
  const run = (args) => spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
  const result = (check) => readdirSync(join(side, 'results')).map((file) => JSON.parse(readFileSync(join(side, 'results', file), 'utf8'))).filter((r) => r.name === check).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  return { name, key: run(['key']).stdout.trim(), run, side, result };
}
const signers = (...list) => {
  const file = join(scratch('signers'), 'signers.json');
  writeFileSync(file, JSON.stringify({ signers: list.map((m) => ({ name: m.name, key: m.key })) }));
  return file;
};
let alice;

before(async () => {
  store = await startReplica();
  dir = scratch('outputs-repo');
  count = join(scratch('outputs-count'), 'count.txt');
  git(dir, 'init', '-q', '-b', 'main');
  write('.holo/checks.json', JSON.stringify({ checks: [
    // The consumer is defined first: the order to run in comes from `uses`, not from the file.
    { name: 'test', run: 'node tools/test.js', inputs: ['tests', 'tools/test.js'], uses: ['build'], env: ['COUNT'] },
    { name: 'build', run: 'node tools/build.js', inputs: ['src', 'tools/build.js'], outputs: ['out'], env: ['COUNT'] },
  ] }));
  write('tools/build.js', BUILD);
  write('tools/test.js', TEST);
  write('src/a.txt', '# a comment\none\n');
  write('tests/expected.txt', 'one\n');
  commit('first');
  alice = machine('alice');
});
after(() => { store.close(); cleanup(); });

test('the producer runs first and the consumer sees what it produced', () => {
  const out = alice.run(['run']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), 'bt');
  assert.match(alice.result('build').output, /^[0-9a-f]{64}$/);
  const listing = alice.run(['keys']).stdout;
  assert.match(listing, /^[0-9a-f]{64} {2}test {2}pass$/m);
  assert.match(listing, /^[0-9a-f]{64} {2}build {2}pass$/m);
  assert.equal(alice.run(['run']).status, 0);
  assert.equal(ran(), 'bt', 'nothing ran the second time');
});

test('a source change that leaves the product the same runs the producer and nothing after it', () => {
  const key = alice.result('test').key;
  write('src/a.txt', '# a different comment\none\n');
  commit('change a comment');
  const out = alice.run(['run']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), 'btb', 'the producer ran; the consumer did not');
  assert.match(out.stdout, /build: pass in/);
  assert.match(out.stdout, /test: pass, reused/);
  assert.equal(alice.result('test').key, key, 'the consumer has the key it had');
});

test('a source change that changes the product runs the consumer, which is judged on the new product', () => {
  write('src/a.txt', '# a different comment\ntwo\n');
  commit('change what is produced, without changing what is expected');
  let out = alice.run(['run']);
  assert.equal(out.status, 1);
  assert.equal(ran(), 'btbbt');
  assert.match(out.stdout, /test: fail in/);
  write('tests/expected.txt', 'two\n');
  commit('expect the new product');
  out = alice.run(['run']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), 'btbbtt', 'only the consumer ran: the product was already made');
});

test('asking for the consumer alone brings its producer, and a check with a failed producer does not run', () => {
  write('tools/build.js', `${BUILD}process.exit(1);\n`);
  commit('break the producer');
  const before = ran();
  const out = alice.run(['run', 'test']);
  assert.equal(out.status, 1);
  assert.equal(ran(), `${before}b`);
  assert.match(out.stdout, /build: fail in/);
  assert.match(out.stdout, /test: cannot run here: it uses build, which has no passing result/);
  assert.match(alice.run(['keys']).stdout, /^-{64} {2}test {2}no result$/m, 'its key is not known while its producer has no product');
  git(dir, 'revert', '--no-edit', 'HEAD');
  assert.equal(alice.run(['run']).status, 0, 'back to content that passed: nothing to do');
  assert.equal(ran(), `${before}b`);
});

test('a producer that passes without producing what it declared fails', () => {
  write('.holo/checks.json', JSON.stringify({ checks: [{ name: 'empty', run: 'node -e "0"', inputs: ['src'], outputs: ['nothing-here'] }] }));
  commit('a producer that produces nothing');
  const out = alice.run(['run']);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /empty: it did not produce nothing-here/);
  git(dir, 'revert', '--no-edit', 'HEAD');
});

test('on another machine both results are reused, and the product is fetched only when something must run', () => {
  // Results and products are shared when they are made, so make them again with the store named.
  alice.run(['run', '--all', '--store', store.url]);
  const digest = alice.result('build').output;
  assert.ok(existsSync(join(store.dir, 'outputs', `${digest}.tar`)), 'the product is in the store under its digest');
  const before = ran();

  const bob = machine('bob');
  const trust = ['--store', store.url, '--signers', signers(alice)];
  let out = bob.run(['run', ...trust]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), before, 'nothing ran, and nothing was fetched');
  assert.match(out.stdout, /build: pass, reused, signed by alice/);
  assert.match(out.stdout, /test: pass, reused, signed by alice/);
  assert.equal(existsSync(join(bob.side, 'outputs')), false);

  write('tests/note.txt', 'a new file the consumer reads\n');
  commit('change only what the consumer reads');
  out = bob.run(['run', ...trust]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), `${before}t`, 'the consumer ran on the fetched product; the producer did not run');
});

test('a product that is missing or altered in the store is made again here, never used', () => {
  const digest = alice.result('build').output;
  const file = join(store.dir, 'outputs', `${digest}.tar`);
  const honest = readFileSync(file);
  const trust = ['--store', store.url, '--signers', signers(alice), '--no-publish'];
  write('tests/note.txt', 'changed again, so the consumer must run\n');
  commit('change what the consumer reads again');

  // Someone who can write to the store swaps the product for one that would make the test fail.
  const fake = scratch('fake');
  mkdirSync(join(fake, 'out'));
  writeFileSync(join(fake, 'out', 'built.txt'), 'not what was built\n');
  spawnSync('tar', ['-cf', 'fake.tar', 'out'], { cwd: fake });
  writeFileSync(file, readFileSync(join(fake, 'fake.tar')));
  let before = ran();
  let out = machine('carol').run(['run', ...trust]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /build: what it produced is not on this machine/);
  assert.equal(ran(), `${before}bt`, 'the producer ran here, then the consumer on the real product');

  // Or an archive that reaches outside the declared paths.
  mkdirSync(join(fake, 'elsewhere'));
  writeFileSync(join(fake, 'elsewhere', 'planted.txt'), 'planted\n');
  spawnSync('tar', ['-cf', 'wide.tar', 'out', 'elsewhere'], { cwd: fake });
  writeFileSync(file, readFileSync(join(fake, 'wide.tar')));
  const dave = machine('dave');
  before = ran();
  out = dave.run(['run', ...trust]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), `${before}bt`);
  assert.equal(existsSync(join(dave.side, 'work', 'test', 'elsewhere')), false, 'nothing outside the declared paths was unpacked');

  // Or it is simply gone.
  rmSync(file);
  before = ran();
  out = machine('erin').run(['run', ...trust]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), `${before}bt`);
  writeFileSync(file, honest);
});

test('the digest a consumer\'s key rests on is signed', () => {
  const build = alice.result('build');
  const file = join(store.dir, 'results', build.key, `${alice.key}.json`);
  const honest = readFileSync(file, 'utf8');
  // Point the producer's result at another product, to steer the consumer to another key.
  writeFileSync(file, JSON.stringify({ ...JSON.parse(honest), output: 'f'.repeat(64) }));
  const before = ran();
  const out = machine('frank').run(['run', '--store', store.url, '--signers', signers(alice), '--no-publish', 'build']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(ran(), `${before}b`, 'the altered result is not believed, so the producer runs');
  writeFileSync(file, honest);
});

test('definitions that cannot work are errors, and a consumer has no key without its producer\'s product', async () => {
  const parse = (checks) => parseChecks(JSON.stringify({ checks }));
  const a = { name: 'a', run: 'x', inputs: ['p'] };
  assert.throws(() => parse([{ ...a, uses: ['ghost'] }]), /not another check here/);
  assert.throws(() => parse([{ ...a, uses: ['a'], outputs: ['o'] }]), /not another check here/);
  assert.throws(() => parse([{ ...a, uses: ['b'] }, { name: 'b', run: 'x', inputs: ['p'] }]), /declares no outputs/);
  assert.throws(() => parse([{ ...a, uses: ['b'], outputs: ['o'] }, { name: 'b', run: 'x', inputs: ['p'], uses: ['a'], outputs: ['q'] }]), /uses itself through other checks/);
  const checks = parse([{ ...a, uses: ['b'] }, { name: 'b', run: 'x', inputs: ['p'], outputs: ['o'] }]);
  const lookup = async () => ({ mode: '40000', id: 'a'.repeat(40) });
  await assert.rejects(actionKey(checks.get('a'), lookup), /needs what b produced/);
  const one = await actionKey(checks.get('a'), lookup, new Map([['b', '1'.repeat(64)]]));
  const two = await actionKey(checks.get('a'), lookup, new Map([['b', '2'.repeat(64)]]));
  assert.notEqual(one, two, 'another product is another key');
  // A check with neither outputs nor uses keeps the key it had before these existed.
  const plain = await actionKey(parse([a]).get('a'), lookup);
  assert.equal(plain, await actionKey({ ...parse([a]).get('a'), outputs: [], uses: [] }, lookup, new Map()));
});

test('replaying history leaves out a check whose key needs a run to know', () => {
  const out = alice.run(['history', '--last', '5']);
  assert.match(out.stdout, /test: left out, its key depends on what build produced/);
  assert.match(out.stdout, /build\s+\d+ distinct inputs/);
});
