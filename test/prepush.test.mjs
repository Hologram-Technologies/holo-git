// Hearing about a failure early: the cheap check that tends to fail goes first, the run stops at
// the first failure, and a push whose content fails a check does not leave the machine.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, root, scratch } from './helpers.mjs';

const SLOW = 'node -e "require(\'fs\').appendFileSync(process.env.COUNT,\'x\');setTimeout(()=>{},1200)"';
const QUICK = 'node -e "process.exit(require(\'fs\').readFileSync(\'lib/flag.txt\',\'utf8\').trim()===\'ok\'?0:1)"';
let dir;
let remote;
let count;
let env;
const check = (args, input) => spawnSync(process.execPath, [join(root, 'scripts', 'check.mjs'), ...args], { cwd: dir, env, encoding: 'utf8', input });
const push = (...args) => spawnSync('git', ['push', ...args], { cwd: dir, env, encoding: 'utf8' });
const runs = () => (existsSync(count) ? readFileSync(count, 'utf8').length : 0);
const write = (path, text) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text); };
const commit = (message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); return git(dir, 'rev-parse', 'HEAD'); };
const remoteHas = (ref) => spawnSync('git', ['rev-parse', '--verify', '-q', ref], { cwd: remote, encoding: 'utf8' }).stdout.trim();

before(() => {
  dir = scratch('prepush');
  remote = scratch('prepush-remote');
  const side = scratch('prepush-side');
  count = join(side, 'count.txt');
  env = { ...process.env, COUNT: count, HOLO_RESULTS: join(side, 'results'), HOLO_WORK: join(side, 'work'), HOLO_KEY: join(side, 'key.json'), HOLO_STORE: '', HOLO_SIGNERS_REF: '' };
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', remote);
  // The slow check is defined first, so only what was learnt from earlier runs can put it second.
  write('.holo/checks.json', JSON.stringify({ checks: [
    { name: 'slow', run: SLOW, inputs: ['lib'], env: ['COUNT'] },
    { name: 'quick', run: QUICK, inputs: ['lib'] },
    { name: 'other', run: SLOW, inputs: ['other'], env: ['COUNT'] },
  ] }));
  write('lib/flag.txt', 'broken\n');
  write('lib/a.txt', 'one\n');
  write('other/b.txt', 'one\n');
  commit('first');
});
after(cleanup);

test('with nothing learnt yet, checks run as defined, and all of them run', () => {
  const out = check(['run']);
  assert.equal(out.status, 1);
  assert.equal(runs(), 2);
  assert.ok(out.stdout.indexOf('slow: running') < out.stdout.indexOf('quick: running'), out.stdout);
  assert.match(out.stdout, /3 checks: 3 ran, 0 reused, 0 skipped, 1 failing/);
});

test('the quick check that failed before runs first, and its failure ends the run', () => {
  write('lib/a.txt', 'two\n');
  commit('change what both checks read, leaving the flag broken');
  const out = check(['run', '--fail-fast']);
  assert.equal(out.status, 1);
  assert.equal(runs(), 2, 'the slow check did not run');
  assert.ok(out.stdout.indexOf('other: pass, reused') < out.stdout.indexOf('quick: running'), 'known results are reported before anything runs');
  assert.match(out.stdout, /quick: fail in/);
  assert.match(out.stdout, /not run after the first failure: slow/);
  assert.match(out.stdout, /3 checks: 1 ran, 1 reused, 0 skipped, 1 failing, 1 not run/);
});

test('a failure that is already known ends the run before anything starts', () => {
  write('other/b.txt', 'two\n');
  commit('change only what the third check reads');
  const out = check(['run', '--fail-fast']);
  assert.equal(out.status, 1);
  assert.equal(runs(), 2, 'nothing ran: the known failure was enough');
  assert.match(out.stdout, /quick: fail, reused/);
  assert.match(out.stdout, /not run after the first failure: (slow, other|other, slow)/);
});

test('a push whose content fails a check is refused, and goes through once it passes', () => {
  assert.match(check(['hook', 'install']).stdout, /installed .*pre-push/);
  let out = push('origin', 'main');
  assert.notEqual(out.status, 0, 'git did not push');
  assert.match(out.stdout + out.stderr, /push refused: a check fails for refs\/heads\/main/);
  assert.equal(remoteHas('refs/heads/main'), '', 'nothing reached the remote');

  write('lib/flag.txt', 'ok\n');
  const good = commit('mend the flag');
  out = push('origin', 'main');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(remoteHas('refs/heads/main'), good);

  // Already checked, already pushed: pushing again runs nothing.
  const before = runs();
  git(dir, 'tag', 'v1');
  out = push('origin', 'v1');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.equal(runs(), before);
});

test('what is checked is the commit being pushed, not the one checked out', () => {
  git(dir, 'checkout', '-q', '-b', 'bad');
  write('lib/flag.txt', 'broken again\n');
  commit('break the flag on a branch');
  git(dir, 'checkout', '-q', 'main');
  // main is checked out and passes; the branch being pushed does not.
  let out = push('origin', 'bad');
  assert.notEqual(out.status, 0);
  assert.match(out.stdout + out.stderr, /push refused: a check fails for refs\/heads\/bad/);
  assert.equal(remoteHas('refs/heads/bad'), '');
  // Deleting a remote branch has nothing to check.
  out = push('origin', ':refs/heads/nothing-there');
  assert.doesNotMatch(out.stdout + out.stderr, /push refused/);
  // The hook is a courtesy: git lets its author skip it.
  out = push('--no-verify', 'origin', 'bad');
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.notEqual(remoteHas('refs/heads/bad'), '');
});

test('installing never replaces a hook that is someone else\'s, and removing takes away only this one', () => {
  const file = join(dir, '.git', 'hooks', 'pre-push');
  assert.match(check(['hook', 'remove']).stdout, /removed/);
  assert.equal(existsSync(file), false);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  let out = check(['hook', 'install']);
  assert.equal(out.status, 1);
  assert.equal(readFileSync(file, 'utf8'), '#!/bin/sh\nexit 0\n');
  out = check(['hook', 'remove']);
  assert.equal(out.status, 1);
  assert.equal(existsSync(file), true, 'a hook that is not this one is left alone');
});

test('the store may be set once in the checkout\'s own configuration', () => {
  git(dir, 'config', 'holo.store', 'http://127.0.0.1:9');
  write('other/b.txt', 'three\n');
  commit('something new to check');
  const out = check(['run', 'other']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /other: note, the result was not shared/);
  git(dir, 'config', '--unset', 'holo.store');
});
