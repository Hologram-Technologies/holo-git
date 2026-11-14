// Issues, comments, labels and milestones as signed operations on a repository's log:
// what they mean when the log is read, who may write which, and that they survive publishing and fetching.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { cleanup, newDevice, startReplica, use, wasm } from './helpers.mjs';

const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const replicajs = await import('../web/replica.js');
const { fold } = await import('../web/log.js');
const { fetchFrom } = await import('../web/sync.js');

const REPO = 'tracker';
const utf8 = new TextEncoder();
let replica; let url; let alice; let bob; let bobKey;
const on = (device) => use(device, store);
const state = async () => { const log = await identity.checkLog(REPO); assert.equal(log.valid, true, log.reason); return log.state; };
const push = async () => replicajs.push(await store.getRepo(REPO), 'main', url);
const fetchAs = async (name) => fetchFrom(await store.getRepo(REPO), 'main', url, { name, email: `${name.toLowerCase()}@example.org` });
const commit = async (name, text) => gitjs.commitFile({ repo: await store.getRepo(REPO), refs: await store.getRefs(REPO), branch: 'main', path: 'notes.txt', content: utf8.encode(text), message: `Notes by ${name}`, name, email: `${name.toLowerCase()}@example.org` });

before(async () => {
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
  replica = await startReplica();
  url = `${replica.url}/${REPO}`;
  alice = newDevice();
  bob = newDevice();
  await on(bob);
  bobKey = (await identity.deviceKey()).id;
  await on(alice);
  await gitjs.createRepo({ name: REPO, who: { name: 'Alice', email: 'alice@example.org' } });
});
after(() => { replica.close(); cleanup(); });

test('an issue is opened, discussed, labelled, put in a milestone and closed; the log says the same to every reader', async () => {
  await on(alice);
  const body = 'Steps:\n\n1. Call `format3(7)`\n2. Compare\n';
  const id = await identity.openIssue(REPO, { title: 'Formatting drops leading zeros', body, name: 'Alice' });
  let s = await state();
  assert.equal(s.issues.length, 1);
  assert.deepEqual([s.issues[0].number, s.issues[0].title, s.issues[0].body, s.issues[0].state, s.issues[0].name], [1, 'Formatting drops leading zeros', body, 'open', 'Alice']);

  await identity.addComment(REPO, id, { body: 'Confirmed.\nThe padding is a space.', name: 'Alice' });
  await identity.saveLabel(REPO, { name: 'bug', color: '#D73A4A', description: 'Something is not working' });
  await identity.saveLabel(REPO, { name: 'question', color: 'd876e3' });
  await identity.setIssue(REPO, id, 'labels', ['bug', 'no-such-label'], 'Alice');
  const milestone = await identity.saveMilestone(REPO, { title: 'v1.0', description: 'First stable release', due: '2027-01-31' });
  await identity.setIssue(REPO, id, 'milestone', milestone, 'Alice');
  await identity.setIssue(REPO, id, 'assignees', [bobKey], 'Alice');
  await identity.setIssue(REPO, id, 'title', 'Formatting drops zeros', 'Alice');
  await identity.setIssue(REPO, id, 'state', 'closed', 'Alice');
  s = await state();
  const issue = s.issues[0];
  assert.deepEqual([issue.title, issue.state, issue.labels, issue.milestone, issue.assignees, issue.comments], ['Formatting drops zeros', 'closed', ['bug'], milestone, [bobKey], 1]);
  assert.deepEqual(issue.events.map((event) => event.kind), ['comment', 'labels', 'milestone', 'assignees', 'title', 'state']);
  assert.equal(issue.events[0].body, 'Confirmed.\nThe padding is a space.');
  assert.deepEqual(s.labels.get('bug'), { color: 'd73a4a', description: 'Something is not working' });
  assert.deepEqual(s.milestones.map((m) => [m.title, m.due, m.state]), [['v1.0', '2027-01-31', 'open']]);

  // A label that is removed leaves every issue; a milestone is edited in place.
  await identity.removeLabel(REPO, 'bug');
  await identity.saveMilestone(REPO, { id: milestone, title: 'v1.0', due: '', state: 'closed' });
  s = await state();
  assert.deepEqual(s.issues[0].labels, []);
  assert.equal(s.labels.has('bug'), false);
  assert.deepEqual(s.milestones.map((m) => [m.id, m.state]), [[milestone, 'closed']]);
});

test('issues and pull requests share one run of numbers', async () => {
  await on(alice);
  await gitjs.proposeFile({ repo: await store.getRepo(REPO), refs: await store.getRefs(REPO), branch: 'main', path: 'README.md', content: utf8.encode('# tracker\n\nMore.\n'), message: 'Say more', name: 'Alice', email: 'alice@example.org' });
  await identity.openIssue(REPO, { title: 'A second issue', name: 'Alice' });
  const s = await state();
  assert.deepEqual(s.issues.map((issue) => issue.number), [1, 3]);
  assert.deepEqual(s.pulls.map((pull) => pull.number), [2]);
});

test('malformed and misplaced operations are refused when written, and a tampered log does not verify', async () => {
  await on(alice);
  await assert.rejects(identity.openIssue(REPO, { title: '   ', name: 'Alice' }), /needs a title/);
  await assert.rejects(identity.addComment(REPO, '0'.repeat(32), { body: 'To nothing', name: 'Alice' }), /malformed comment/);
  await assert.rejects(identity.setIssue(REPO, '0'.repeat(32), 'state', 'closed', 'Alice'), /malformed change/);
  const { issues } = await state();
  await assert.rejects(identity.setIssue(REPO, issues[0].id, 'state', 'done', 'Alice'), /malformed change/);
  await assert.rejects(identity.setIssue(REPO, issues[0].id, 'milestone', 'f'.repeat(32), 'Alice'), /malformed change/);
  await assert.rejects(identity.saveLabel(REPO, { name: 'a,b', color: '000000' }), /without commas/);
  await assert.rejects(identity.saveLabel(REPO, { name: 'ok', color: 'red' }), /six hexadecimal/);
  // Change one letter of a signed body: the signature no longer holds.
  const log = await store.listRefUpdates(REPO);
  const at = log.findIndex((record) => record.type === 'comment');
  const forged = log.map((record, i) => (i === at ? { ...record, body: record.body.replace('space', 'zero') } : record));
  await assert.rejects(fold(forged), /does not count|chain is broken/);
});

test('someone with read access can open, comment on and close their own issue, and nothing else', async () => {
  await on(alice);
  await commit('Alice', 'first\n');
  await identity.grant(REPO, bobKey, 'read', 0);
  await push();

  await on(bob);
  await gitjs.clone(url);
  const mine = await identity.openIssue(REPO, { title: 'How do I run the tests?', body: 'The guide does not say.', name: 'Bob' });
  await identity.addComment(REPO, mine, { body: 'Found it.', name: 'Bob' });
  await identity.setIssue(REPO, mine, 'state', 'closed', 'Bob');
  let s = await state();
  const theirs = s.issues[0];
  // Triage, and other people's issues, are not his.
  await identity.saveLabel(REPO, { name: 'question', color: 'd876e3' }).then(() => assert.fail('a reader defined a label'), (error) => assert.match(error.message, /does not count/));
  await assert.rejects(identity.setIssue(REPO, mine, 'labels', ['question'], 'Bob'), /does not count/);
  await assert.rejects(identity.setIssue(REPO, theirs.id, 'state', 'open', 'Bob'), /does not count/);
  await assert.rejects(identity.setIssue(REPO, theirs.id, 'title', 'Renamed by Bob', 'Bob'), /does not count/);
  await assert.rejects(identity.saveMilestone(REPO, { title: 'Mine' }), /does not count/);
  await identity.addComment(REPO, theirs.id, { body: 'I see this too.', name: 'Bob' });
  await commit('Bob', 'first\nsecond\n').then(() => assert.fail('a reader changed a branch'), () => {});
  // Publishing needs a change to a branch, which a reader cannot make; his operations travel when the owner fetches them from his copy.
  // Here they are carried the direct way: the owner reads the same log.
  const carried = await store.listRefUpdates(REPO);
  s = await fold(carried, { strict: true });
  assert.deepEqual(s.issues.map((issue) => [issue.number, issue.title, issue.state, issue.name]), [[1, 'Formatting drops zeros', 'closed', 'Alice'], [3, 'A second issue', 'open', 'Alice'], [4, 'How do I run the tests?', 'closed', 'Bob']]);
  assert.equal(s.issues[0].events.at(-1).body, 'I see this too.');
});

test('an issue written before a fetch keeps its identity and its comments when its number changes', async () => {
  // Alice writes an issue and a comment without publishing. Meanwhile the published log gains an issue from a second writer.
  await on(alice);
  const carol = newDevice();
  await on(carol);
  const carolKey = (await identity.deviceKey()).id;
  await on(alice);
  await identity.grant(REPO, carolKey, 'write', 0);
  await commit('Alice', 'first\nthird\n');
  await push();
  await on(carol);
  await gitjs.clone(url);
  await identity.openIssue(REPO, { title: 'From Carol', name: 'Carol' });
  await gitjs.commitFile({ repo: await store.getRepo(REPO), refs: await store.getRefs(REPO), branch: 'main', path: 'carol.txt', content: utf8.encode('hello\n'), message: 'Carol was here', name: 'Carol', email: 'carol@example.org' });
  await push();

  await on(alice);
  const offline = await identity.openIssue(REPO, { title: 'Written offline', body: 'Before fetching.', name: 'Alice' });
  await identity.addComment(REPO, offline, { body: 'Still offline.', name: 'Alice' });
  const before = (await state()).issues.find((issue) => issue.id === offline);
  const outcome = await fetchAs('Alice');
  assert.ok(['rebased', 'fast-forward', 'merged'].includes(outcome.outcome), outcome.outcome);
  const s = await state();
  const after = s.issues.find((issue) => issue.id === offline);
  assert.ok(s.issues.some((issue) => issue.title === 'From Carol'));
  assert.equal(after.number, before.number + 1, 'the number moved past the issue that was published first');
  assert.deepEqual([after.title, after.body, after.comments, after.events[0].body, after.time], ['Written offline', 'Before fetching.', 1, 'Still offline.', before.time]);
});

test('a repository can be renamed and removed in this browser; its signed history still verifies under the new name', async () => {
  await on(alice);
  const before = await state();
  await store.renameRepo(REPO, 'renamed');
  assert.equal(await store.getRepo(REPO), undefined);
  assert.equal((await store.getRepo('renamed')).name, 'renamed');
  const log = await identity.checkLog('renamed');
  assert.equal(log.valid, true, log.reason);
  assert.deepEqual([log.entries, log.state.issues.length], [before.count, before.issues.length]);
  await identity.addComment('renamed', log.state.issues[0].id, { body: 'Still here.', name: 'Alice' });
  assert.equal((await identity.checkLog('renamed')).valid, true, 'new changes sign onto the same history');
  // Failures: a name that is taken, and one that is not there.
  await gitjs.createRepo({ name: 'taken', who: { name: 'Alice', email: 'alice@example.org' } });
  await assert.rejects(store.renameRepo('renamed', 'taken'), /already exists/);
  await assert.rejects(store.renameRepo('nowhere', 'somewhere'), /no repository named/);
  await store.deleteRepo('taken');
  assert.equal(await store.getRepo('taken'), undefined);
  assert.equal((await store.listRefUpdates('taken')).length, 0);
  await store.renameRepo('renamed', REPO);
  assert.equal((await identity.checkLog(REPO)).valid, true);
});
