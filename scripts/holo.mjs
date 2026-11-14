// Work on a holo-git replica from an ordinary git checkout.
//
// Commits are made with git, as usual. This command carries them to a replica as signed updates
// and brings others' work back. It uses the page's own modules (see scripts/lib/client.mjs), so
// everything a browser would verify is verified here too.
//
//   node scripts/holo.mjs key                              this machine's key, to be granted access
//   node scripts/holo.mjs publish  --replica URL           move the replica's branch to HEAD (fast-forward only)
//   node scripts/holo.mjs propose  --replica URL [--title T]   offer HEAD as a pull request, moving nothing
//   node scripts/holo.mjs status   --replica URL           the branch, its protection and open pull requests
//   node scripts/holo.mjs approve  --replica URL --pull N
//   node scripts/holo.mjs merge    --replica URL --pull N
//   node scripts/holo.mjs protect  --replica URL [--approvals N] [--checks a,b] [--owner-only]
//   node scripts/holo.mjs grant    --replica URL --to KEY [--read] [--days N]
//   node scripts/holo.mjs fetch    --replica URL           bring the replica's branch into refs/holo/<branch>
//
// Options: --branch NAME (default: the current branch), --key FILE (default .holo/key.json).
// For a store that needs signed requests, set HOLO_S3_ACCESS_KEY and HOLO_S3_SECRET_KEY.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, useStoreKeys, engine, store, gitjs, identity, replica } from './lib/client.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const git = (...list) => execFileSync('git', list, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
const keyFile = option('--key', join('.holo', 'key.json'));

// Copy git objects into the store. Each is rebuilt by the engine and must come out with the
// identifier git gave it; nothing is taken on git's word.
function importObjects(ids) {
  if (!ids.length) return [];
  const out = spawnSync('git', ['cat-file', '--batch'], { input: `${ids.join('\n')}\n`, maxBuffer: 1 << 30 });
  if (out.status !== 0) throw new Error('git cat-file failed');
  const bytes = out.stdout;
  const objects = [];
  let at = 0;
  for (const id of ids) {
    const end = bytes.indexOf(10, at);
    const [got, kind, size] = bytes.subarray(at, end).toString().split(' ');
    if (got !== id || !size) throw new Error(`git does not have object ${id}`);
    const content = bytes.subarray(end + 1, end + 1 + Number(size));
    const made = engine.makeObject(kind, new Uint8Array(content));
    if (made.id !== id) throw new Error(`object ${id} does not hash to its name`);
    objects.push(made);
    at = end + 1 + Number(size) + 1;
  }
  return objects;
}

// Open the replica as a clone in memory. A replica with nothing in it yet gives an empty repository.
async function open(url, branch) {
  useStoreKeys(url);
  const ref = `refs/heads/${branch}`;
  const { state } = await replica.readState(url);
  if (!state) {
    const name = gitjs.repoName(url);
    await store.putRepo({ name, url, head: ref, objects: 0, bytes: 0, cloned: Date.now(), replica: url }, {});
    return { name, ref, head: null, fresh: true };
  }
  const repo = await gitjs.clone(url);
  const log = await identity.checkLog(repo.name);
  if (!log.valid) throw new Error(`the replica's log does not verify: ${log.reason}`);
  return { name: repo.name, ref, head: (await store.getRefs(repo.name))[ref] || null, state: log.state };
}

// Bring a local commit and whatever it needs into the store.
async function bring(commit, have) {
  const range = have ? [`${have}..${commit}`] : [commit];
  const ids = git('rev-list', '--objects', ...range).split('\n').filter(Boolean).map((line) => line.split(' ')[0]);
  const objects = importObjects(ids);
  await store.putObjects(objects);
  return objects.length;
}

async function main() {
  if (command === 'key') { console.log(await boot(keyFile)); return; }
  const url = (option('--replica') || '').replace(/\/+$/, '');
  if (!url) throw new Error('give the replica with --replica URL');
  const branch = option('--branch', command === 'fetch' ? 'main' : git('rev-parse', '--abbrev-ref', 'HEAD'));
  const me = await boot(keyFile);
  const at = await open(url, branch);
  const push = async () => replica.push(await store.getRepo(at.name), branch, url);
  const pullNumbered = () => {
    const pull = at.state && at.state.pulls.find((candidate) => String(candidate.number) === option('--pull'));
    if (!pull) throw new Error(`there is no pull request #${option('--pull')}`);
    return pull;
  };

  if (command === 'publish') {
    const head = git('rev-parse', 'HEAD');
    if (at.head === head) { console.log(`${branch} is already at ${head.slice(0, 7)}`); return; }
    if (at.head) {
      try { git('merge-base', '--is-ancestor', at.head, head); } catch { throw new Error(`refused: ${branch} on the replica (${at.head.slice(0, 7)}) is not an ancestor of HEAD; fetch and merge first`); }
    }
    const count = await bring(head, at.head);
    const old = at.head || head;
    if (!at.head) await store.putRepo(await store.getRepo(at.name), { [at.ref]: old });
    await identity.moveRef({ repo: at.name, ref: at.ref, old, next: head, parents: [old] });
    const result = await push();
    console.log(`${branch}: ${at.head ? at.head.slice(0, 7) : 'new'} -> ${head.slice(0, 7)}; ${count} objects prepared, ${result.objects} sent, ${result.records} signed record${result.records === 1 ? '' : 's'}`);
  } else if (command === 'propose') {
    if (!at.head) throw new Error('the replica has no such branch yet; publish first');
    const head = git('rev-parse', 'HEAD');
    await bring(head, at.head);
    const title = option('--title', git('log', '-1', '--format=%s', head));
    await identity.openPull(at.name, branch, head, title);
    const result = await push();
    const number = (await identity.checkLog(at.name)).state.pulls.find((pull) => pull.head === head && pull.ref === at.ref).number;
    console.log(`pull request #${number}: ${title} (${head.slice(0, 7)} into ${branch}); ${result.objects} objects sent`);
  } else if (command === 'approve') {
    const pull = pullNumbered();
    await identity.approve(at.name, pull.ref.slice(11), pull.head);
    await push();
    console.log(`approved #${pull.number} at ${pull.head.slice(0, 7)} as ${me.slice(0, 8)}`);
  } else if (command === 'merge') {
    const pull = pullNumbered();
    await gitjs.mergePull({ repo: await store.getRepo(at.name), refs: await store.getRefs(at.name), branch: pull.ref.slice(11), head: pull.head });
    await push();
    console.log(`merged #${pull.number}: ${pull.ref.slice(11)} is now ${pull.head.slice(0, 7)}`);
  } else if (command === 'protect') {
    const checks = option('--checks', '').split(',').map((name) => name.trim()).filter(Boolean);
    await identity.protect(at.name, branch, flag('--owner-only') ? 'admin' : 'write', Number(option('--approvals', '0')), checks);
    await push();
    console.log(`${branch} is protected: ${option('--approvals', '0')} approvals, checks: ${checks.join(', ') || 'none'}`);
  } else if (command === 'grant') {
    await identity.grant(at.name, option('--to', ''), flag('--read') ? 'read' : 'write', Number(option('--days', '0')));
    await push();
    console.log(`granted ${flag('--read') ? 'read' : 'write'} to ${option('--to').slice(0, 8)}`);
  } else if (command === 'status') {
    if (!at.head) { console.log('the replica has nothing on this branch'); return; }
    const rule = at.state.protections.get(at.ref);
    console.log(`${branch}: ${at.head.slice(0, 7)}; owner ${at.state.owner.slice(0, 8)}${at.state.owner === me ? ' (this machine)' : ''}; ${at.state.count} signed records`);
    console.log(rule ? `protected: ${rule.approvals} approvals, checks: ${rule.checks.join(', ') || 'none'}, ${rule.minimum === 'admin' ? 'owner only' : 'writers'}` : 'not protected');
    for (const pull of at.state.pulls.filter((candidate) => !candidate.merged)) console.log(`#${pull.number} open: ${pull.title} (${pull.head.slice(0, 7)}), ${pull.counted} of ${pull.needed} approvals`);
  } else if (command === 'fetch') {
    if (!at.head) throw new Error('the replica has nothing on this branch');
    // Hand the history to git as a bundle. Git checks every object itself as it reads it.
    const bundle = await gitjs.bundleOf(await store.getRefs(at.name), branch);
    const dir = mkdtempSync(join(tmpdir(), 'holo-fetch-'));
    writeFileSync(join(dir, 'b.bundle'), bundle.bytes);
    git('fetch', '--quiet', join(dir, 'b.bundle'), `+refs/heads/${branch}:refs/holo/${branch}`);
    rmSync(dir, { recursive: true, force: true });
    console.log(`refs/holo/${branch} is now ${at.head.slice(0, 7)} (${bundle.objects} objects checked by git). To take it: git merge --ff-only refs/holo/${branch}`);
  } else throw new Error('unknown command; see the top of scripts/holo.mjs');
}

try { await main(); } catch (error) {
  console.error(`holo: ${error.message}`);
  process.exitCode = 1;
}
