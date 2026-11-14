// Pull request discussion as signed operations: a description, comments, reviews, comments on lines,
// settled conversations, and an update that keeps the pull request what it was.
//
// Alice owns the repository and proposes; Bob can write and reviews; Carol can only read.
// A log is carried between them by hand here; publishing and fetching have their own tests.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cleanup, newDevice, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const replicajs = await import('../web/replica.js');

const REPO = 'reviewed';
const utf8 = new TextEncoder();
let replica; let url; let alice; let bob; let carol; let bobKey;
const on = (device) => use(device, store);
const state = async () => { const log = await identity.checkLog(REPO); assert.equal(log.valid, true, log.reason); return log.state; };
const repo = () => store.getRepo(REPO);
const refs = () => store.getRefs(REPO);
// Hand the log as it stands on one device to another.
// Every object a commit needs, with its identifier.
async function objectsOf(start, seen = new Map()) {
  const queue = [start];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    const envelope = await store.getObject(id);
    seen.set(id, envelope);
    const { kind } = engine.open(envelope);
    if (kind === 'commit') { const commit = engine.parseCommit(envelope); queue.push(commit.tree, ...commit.parents); } else if (kind === 'tree') for (const entry of engine.parseTree(envelope)) queue.push(entry.id);
  }
  return seen;
}
// Hand the log as it stands on one device to another, with the commits it speaks of, as a fetch would.
async function carry(from, to) {
  await on(from);
  const log = await store.listRefUpdates(REPO);
  const seen = new Map();
  for (const id of new Set(log.flatMap((record) => [record.next, record.head]).filter((id) => /^[0-9a-f]{40}$/.test(id || '')))) await objectsOf(id, seen);
  await on(to);
  await store.putObjects([...seen].map(([id, envelope]) => ({ id, envelope })));
  await store.replaceRefUpdates(REPO, log);
}
const propose = async (path, text, message) => gitjs.proposeFile({ repo: await repo(), refs: await refs(), branch: 'main', path, content: utf8.encode(text), message, name: 'Alice', email: 'alice@example.org' });

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  replica = await startReplica();
  url = `${replica.url}/${REPO}`;
  alice = newDevice(); bob = newDevice(); carol = newDevice();
  await on(bob); bobKey = (await identity.deviceKey()).id;
  await on(carol); const carolKey = (await identity.deviceKey()).id;
  await on(alice);
  await gitjs.createRepo({ name: REPO, who: { name: 'Alice', email: 'alice@example.org' } });
  await gitjs.commitFile({ repo: await repo(), refs: await refs(), branch: 'main', path: 'notes.txt', content: utf8.encode('one\ntwo\nthree\n'), message: 'Add notes', name: 'Alice', email: 'alice@example.org' });
  await identity.grant(REPO, bobKey, 'write', 0);
  await identity.grant(REPO, carolKey, 'read', 0);
  await identity.protect(REPO, 'main', 'write', 1, []);
  await replicajs.push(await repo(), 'main', url);
  for (const device of [bob, carol]) { await on(device); await gitjs.clone(url); }
});
after(() => { replica.close(); cleanup(); });

test('a pull request carries a description, is discussed and reviewed, and an approval given by review opens the merge gate', async () => {
  await on(alice);
  const proposed = await propose('notes.txt', 'one\ntwo, changed\nthree\nfour\n', 'Change the second line\n\nAnd add a fourth.\nSee the notes.');
  let pull = (await state()).pulls[0];
  assert.deepEqual([pull.number, pull.title, pull.body, pull.name, pull.state, pull.head], [1, 'Change the second line', 'And add a fourth.\nSee the notes.', 'Alice', 'open', proposed.id]);
  assert.match(pull.id, /^[0-9a-f]{32}$/);
  await identity.addComment(REPO, pull.id, { body: 'Ready for a look.', name: 'Alice' });
  // Her own approval is recorded and does not count; the gate stays shut.
  await identity.review(REPO, pull.id, proposed.id, 'approve', { name: 'Alice' });
  await assert.rejects(gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: proposed.id }), /refused by the kernel/);

  await carry(alice, bob);
  const thread = await identity.commentOnLine(REPO, pull.id, { head: proposed.id, path: 'notes.txt', side: 'new', line: 2, body: 'Why the comma?', name: 'Bob' });
  await identity.review(REPO, pull.id, proposed.id, 'changes', { body: 'Please explain the comma.', name: 'Bob' });
  pull = (await state()).pulls[0];
  assert.deepEqual([[...pull.changes], pull.counted], [[bobKey], 0]);

  await carry(bob, alice);
  await identity.commentOnLine(REPO, pull.id, { reply: thread, body: 'It reads better.', name: 'Alice' });
  await identity.resolveThread(REPO, thread, true, 'Alice'); // the author of the pull request may settle a conversation on it
  await carry(alice, bob);
  await identity.review(REPO, pull.id, proposed.id, 'approve', { body: 'Fine.', name: 'Bob' });
  pull = (await state()).pulls[0];
  assert.deepEqual([[...pull.changes], pull.counted, pull.needed], [[], 1, 1]);
  assert.deepEqual([pull.threads.length, pull.threads[0].path, pull.threads[0].line, pull.threads[0].side, pull.threads[0].resolved, pull.threads[0].replies.map((r) => r.body), pull.comments], [1, 'notes.txt', 2, 'new', true, ['It reads better.'], 3]);
  assert.deepEqual(pull.events.map((event) => (event.kind === 'review' ? `review:${event.verdict}` : event.kind)), ['comment', 'review:approve', 'review:changes', 'review:approve']);

  await carry(bob, alice);
  await gitjs.mergePull({ repo: await repo(), refs: await refs(), branch: 'main', head: proposed.id });
  pull = (await state()).pulls[0];
  assert.equal(pull.merged, true);
  assert.equal((await refs())['refs/heads/main'], proposed.id);
});

test('malformed reviews and line comments are refused when written; a reader may review and comment but not approve, settle others\' conversations or close', async () => {
  await on(alice);
  const second = await propose('notes.txt', 'one\ntwo, changed\nthree\nfour\nfive\n', 'Add a fifth line');
  const pull = (await state()).pulls.find((p) => p.head === second.id);
  const mine = await identity.commentOnLine(REPO, pull.id, { head: second.id, path: 'notes.txt', side: 'new', line: 5, body: 'New here.', name: 'Alice' });
  await assert.rejects(identity.review(REPO, pull.id, pull.head, 'maybe', { name: 'Alice' }), /malformed review/);
  await assert.rejects(identity.review(REPO, '0'.repeat(32), pull.head, 'comment', { name: 'Alice' }), /malformed review/);
  await assert.rejects(identity.commentOnLine(REPO, pull.id, { head: pull.head, path: 'notes.txt', side: 'middle', line: 2, body: 'x' }), /malformed comment on a line/);
  await assert.rejects(identity.commentOnLine(REPO, pull.id, { head: pull.head, path: 'notes.txt', side: 'new', line: 0, body: 'x' }), /malformed comment on a line/);
  await assert.rejects(identity.commentOnLine(REPO, pull.id, { reply: 'f'.repeat(32), body: 'to nothing' }), /malformed comment on a line/);
  await assert.rejects(identity.resolveThread(REPO, 'f'.repeat(32), true), /malformed resolution/);

  await carry(alice, carol);
  await identity.review(REPO, pull.id, pull.head, 'comment', { body: 'Looks reasonable.', name: 'Carol' });
  const hers = await identity.commentOnLine(REPO, pull.id, { head: pull.head, path: 'notes.txt', side: 'new', line: 4, body: 'A fourth line?', name: 'Carol' });
  await identity.resolveThread(REPO, hers, true, 'Carol'); // her own conversation
  await assert.rejects(identity.review(REPO, pull.id, pull.head, 'approve', { name: 'Carol' }), /does not count/);
  await assert.rejects(identity.resolveThread(REPO, mine, true, 'Carol'), /does not count/);
  await assert.rejects(identity.setIssue(REPO, pull.id, 'state', 'closed', 'Carol'), /does not count/);
  const after = (await state()).pulls.find((p) => p.id === pull.id);
  assert.deepEqual(after.threads.map((thread) => thread.resolved), [false, true]);
  await carry(carol, alice);
});

test('an update by its author keeps the pull request: same number, same discussion, approvals start again; anyone else\'s is a new one', async () => {
  await on(alice);
  let s = await state();
  const before = s.pulls.find((p) => !p.merged);
  await carry(alice, bob);
  await identity.review(REPO, before.id, before.head, 'approve', { name: 'Bob' });
  await carry(bob, alice);
  assert.equal((await state()).pulls.find((p) => p.id === before.id).counted, 1);

  // A further commit on top of the proposed one.
  const line = 'Alice <alice@example.org> 1700000000 +0000';
  const next = engine.makeCommit({ tree: engine.parseCommit(await store.getObject(before.head)).tree, parents: [before.head], author: line, committer: line, message: 'A follow-up\n' });
  await store.putObjects([next]);
  await identity.openPull(REPO, 'main', next.id, 'ignored for an update', { follows: before.head, name: 'Alice' });
  s = await state();
  const after = s.pulls.find((p) => p.id === before.id);
  assert.deepEqual([after.number, after.head, after.first, after.title, after.comments, after.counted, s.pulls.length], [before.number, next.id, before.first, before.title, before.comments, 0, 2]);
  assert.equal(after.events.at(-1).kind, 'head');
  assert.deepEqual([after.events.at(-1).from, after.events.at(-1).to], [before.head, next.id]);

  // Bob proposing a commit that "follows" hers does not take her pull request over.
  await carry(alice, bob);
  const other = engine.makeCommit({ tree: engine.parseCommit(next.envelope).tree, parents: [next.id], author: line, committer: line, message: 'By someone else\n' });
  await store.putObjects([next, other]);
  await identity.openPull(REPO, 'main', other.id, 'Bob builds on it', { follows: next.id, name: 'Bob' });
  s = await state();
  assert.equal(s.pulls.length, 3);
  assert.equal(s.pulls.find((p) => p.id === before.id).head, next.id);
  assert.deepEqual([s.pulls[2].number, s.pulls[2].title, s.pulls[2].name], [3, 'Bob builds on it', 'Bob']);
});
