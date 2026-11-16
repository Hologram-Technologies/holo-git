// The bridge between an ordinary git checkout and a holo-git replica.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, git, makeFixture, newDevice, replicaToGit, root, scratch, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');

let replica;
let url;
let work;
let keys;
const holo = (dir, who, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'holo.mjs'), ...args, '--replica', url, '--key', join(keys, `${who}.json`)], { cwd: dir, encoding: 'utf8' });
const ok = (result) => { assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout; };
const commit = (dir, path, text, message) => { writeFileSync(join(dir, path), text); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); return git(dir, 'rev-parse', 'HEAD'); };
const viewed = async () => { await use(newDevice(), store); await gitjs.clone(url); return (await identity.checkLog('project')).state; };

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  replica = await startReplica();
  url = `${replica.url}/project`;
  work = makeFixture().work;
  keys = scratch('keys');
});

after(() => {
  replica.close();
  cleanup();
});

test('publish carries a git history to a new replica, and a browser-side clone agrees with git', async () => {
  const out = ok(holo(work, 'alice', 'publish'));
  assert.match(out, /main: new -> [0-9a-f]{7}; \d+ objects prepared, \d+ sent, 1 signed record/);
  const state = await viewed();
  assert.equal(state.heads['refs/heads/main'], git(work, 'rev-parse', 'HEAD'));
  assert.equal(await store.countObjects(), Number(git(work, 'count-objects', '-v').match(/count: (\d+)/)[1]) + Number(git(work, 'count-objects', '-v').match(/in-pack: (\d+)/)[1]));
  const rebuilt = replicaToGit(join(replica.dir, 'project'));
  git(rebuilt.target, 'fsck', '--strict');
  assert.equal(git(rebuilt.target, 'rev-parse', 'main'), git(work, 'rev-parse', 'HEAD'));
  assert.match(ok(holo(work, 'alice', 'publish')), /already at/);
});

test('a further commit sends only what is new; a history that does not descend is refused', async () => {
  const next = commit(work, 'README.md', '# Fixture\n\nMore.\n', 'fourth');
  assert.match(ok(holo(work, 'alice', 'publish')), /\d+ objects prepared, 3 sent, 1 signed record/);
  assert.equal((await viewed()).heads['refs/heads/main'], next);

  const elsewhere = scratch('elsewhere');
  git(elsewhere, 'clone', '-q', work, 'repo');
  const other = join(elsewhere, 'repo');
  git(other, 'reset', '-q', '--hard', 'HEAD~1');
  commit(other, 'README.md', 'diverged\n', 'a different fourth');
  const refused = holo(other, 'alice', 'publish');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /not an ancestor of HEAD; fetch and merge first/);
});

test('someone without access cannot publish; with a grant they can propose and, once approved, merge', async () => {
  const theirs = scratch('bob');
  git(theirs, 'clone', '-q', work, 'repo');
  const bob = join(theirs, 'repo');
  const start = git(bob, 'rev-parse', 'HEAD');
  // Two commits offered at once: what the pull request changed starts at main, not at the last commit's parent.
  const prepared = commit(bob, 'bob-notes.txt', 'notes\n', 'Bob prepares');
  const proposed = commit(bob, 'bob.txt', 'from bob\n', 'Bob adds a file');
  const denied = holo(bob, 'bob', 'publish');
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /refused by the kernel/);

  const bobKey = ok(holo(bob, 'bob', 'key')).trim();
  ok(holo(work, 'alice', 'grant', '--to', bobKey));
  ok(holo(work, 'alice', 'protect', '--approvals', '1'));
  assert.match(ok(holo(bob, 'bob', 'propose')), /pull request #1: Bob adds a file/);
  assert.match(ok(holo(work, 'alice', 'status')), /#1 open: Bob adds a file \([0-9a-f]{7}\), 0 of 1 approvals/);

  const early = holo(bob, 'bob', 'merge', '--pull', '1');
  assert.equal(early.status, 1);
  assert.match(early.stderr, /refused by the kernel/);
  ok(holo(bob, 'bob', 'approve', '--pull', '1'));
  assert.equal(holo(bob, 'bob', 'merge', '--pull', '1').status, 1, 'the proposer\'s own approval does not count');
  ok(holo(work, 'alice', 'approve', '--pull', '1'));
  assert.match(ok(holo(bob, 'bob', 'merge', '--pull', '1')), /merged #1/);
  const state = await viewed();
  assert.equal(state.heads['refs/heads/main'], proposed);
  assert.equal(state.pulls[0].mergedOnto, start, 'the merge remembers where main stood before it');
  assert.equal(git(bob, 'rev-parse', `${proposed}^`), prepared, 'so the last commit\'s parent would have been the wrong starting point');
});

test('fetch brings the replica\'s branch back into git, checked by git', () => {
  assert.match(ok(holo(work, 'alice', 'fetch')), /refs\/holo\/main is now [0-9a-f]{7}/);
  git(work, 'merge', '-q', '--ff-only', 'refs/holo/main');
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'Bob adds a file');
  git(work, 'fsck', '--strict');
});

test('copying a repository says how much has arrived, for a screen to show', async () => {
  await use(newDevice(), store);
  const seen = [];
  await gitjs.clone(url, (_, so) => { if (so) seen.push(so); });
  assert.ok(seen.length >= 1, 'at least the final amount is reported');
  assert.ok(seen.at(-1).objects > 0 && seen.at(-1).bytes > 0);
});
