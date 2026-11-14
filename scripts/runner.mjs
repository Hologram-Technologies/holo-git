// A runner: for each open pull request on a replica, run the required checks that have no
// result yet, and publish the results as signed records. Anyone with write access can run one,
// on any machine. There is no queue and no pool; a result is valid wherever it was made.
//
//   node scripts/runner.mjs key [--key FILE]                 print this runner's key, to be granted write access
//   node scripts/runner.mjs run --replica URL [--pull N] [--key FILE]
//
// It uses the page's own modules, so it verifies the replica exactly as a browser does. The
// proposed tree is written to a temporary directory and each check runs there. A check whose
// key already has a result in the log is not run: that is the point.
//
// The runner's key is a file (default .holo/runner-key.json). Keep it out of version control.
// For a store that needs signed requests, set HOLO_S3_ACCESS_KEY and HOLO_S3_SECRET_KEY.

import 'fake-indexeddb/auto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const engine = await import('../web/engine.js');
const kernel = await import('../web/kernel.js');
const store = await import('../web/store.js');
const gitjs = await import('../web/git.js');
const identity = await import('../web/identity.js');
const replica = await import('../web/replica.js');
const { expectedActions } = await import('../web/evidence.js');
const { parseChecks, CHECKS_PATH } = await import('../web/checks.js');
const { environmentFor, toolsFor, execute } = await import('./lib/execute.mjs');

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const keyFile = option('--key', join('.holo', 'runner-key.json'));
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };

async function loadKey() {
  await engine.loadEngine(readFileSync(join(web, 'engine.wasm')));
  await kernel.loadKernel(readFileSync(join(web, 'kernel.wasm')));
  await store.openStore();
  let saved;
  if (existsSync(keyFile)) saved = JSON.parse(readFileSync(keyFile, 'utf8'));
  else {
    const fresh = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
    saved = { privateKey: await crypto.subtle.exportKey('jwk', fresh.privateKey), publicKey: await crypto.subtle.exportKey('jwk', fresh.publicKey) };
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, JSON.stringify(saved), { mode: 0o600 });
  }
  await store.saveKey({
    privateKey: await crypto.subtle.importKey('jwk', saved.privateKey, ECDSA, false, ['sign']),
    publicKey: await crypto.subtle.importKey('jwk', saved.publicKey, ECDSA, true, ['verify']),
  });
  return (await identity.deviceKey()).id;
}

// Write one path of a tree to a directory: a file, or a directory and everything under it.
async function materialise(entry, path) {
  if (entry.mode === '40000') {
    mkdirSync(path, { recursive: true });
    for (const child of await gitjs.readTree(entry.id)) await materialise(child, join(path, child.name));
  } else if (entry.mode !== '160000') { // a submodule has nothing to write
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, engine.open(await store.getObject(entry.id)).content);
    if (entry.mode === '100755') chmodSync(path, 0o755);
  }
}

// A directory holding exactly the inputs a check declared, from the proposed tree.
async function prepare(definition, treeId) {
  const dir = mkdtempSync(join(tmpdir(), 'holo-git-run-'));
  for (const path of definition.inputs) {
    let entry = null;
    try { entry = await gitjs.lookup(treeId, path); } catch { /* absent in this tree */ }
    if (entry) await materialise({ mode: entry.mode, id: entry.id }, join(dir, path));
  }
  return dir;
}

async function run() {
  const url = option('--replica');
  if (!url) throw new Error('give the replica with --replica URL');
  const me = await loadKey();
  if (process.env.HOLO_S3_ACCESS_KEY) replica.setCredentials(url, { accessKey: process.env.HOLO_S3_ACCESS_KEY, secretKey: process.env.HOLO_S3_SECRET_KEY, region: process.env.HOLO_S3_REGION || 'us-east-1' });
  const repo = await gitjs.clone(url);
  const refs = await store.getRefs(repo.name);
  const log = await identity.checkLog(repo.name);
  if (!log.valid) throw new Error(`the replica's log does not verify: ${log.reason}`);
  const only = option('--pull');
  const pulls = log.state.pulls.filter((pull) => !pull.merged && (!only || String(pull.number) === only));
  let ran = 0;
  let reused = 0;
  let published = 0;
  const known = new Map(log.state.checks);
  for (const pull of pulls) {
    const rule = log.state.protections.get(pull.ref);
    const required = rule ? rule.checks : [];
    if (!required.length) { console.log(`#${pull.number}: no checks required`); continue; }
    const base = refs[pull.ref];
    const expected = await expectedActions(base, pull.head, required);
    const baseTree = engine.parseCommit(await store.getObject(base)).tree;
    let definitions = new Map();
    try { definitions = parseChecks(engine.open(await store.getObject((await gitjs.lookup(baseTree, CHECKS_PATH)).id)).content); } catch { /* none defined */ }
    const headTree = engine.parseCommit(await store.getObject(pull.head)).tree;
    for (const [i, name] of required.entries()) {
      const action = expected[i];
      if (!action) { console.log(`#${pull.number} ${name}: not defined on the branch; nothing can satisfy it`); continue; }
      const have = known.get(action);
      if (have) { console.log(`#${pull.number} ${name}: ${have.result}, reused (${action.slice(0, 12)})`); reused += 1; continue; }
      const definition = definitions.get(name);
      const { env, missing } = environmentFor(definition);
      if (missing) { console.log(`#${pull.number} ${name}: cannot run here: it needs ${missing.join(', ')} in the environment`); continue; }
      const { problem } = toolsFor(definition, env);
      if (problem) { console.log(`#${pull.number} ${name}: cannot run here: ${problem}`); continue; }
      const dir = await prepare(definition, headTree);
      console.log(`#${pull.number} ${name}: running (${action.slice(0, 12)}): ${definition.run}`);
      const { result, seconds } = execute(definition, join(dir, definition.cwd), env);
      rmSync(dir, { recursive: true, force: true });
      console.log(`#${pull.number} ${name}: ${result} in ${seconds}s`);
      await identity.recordCheck(repo.name, name, action, result);
      known.set(action, { name, result, by: me });
      ran += 1;
      published += 1;
    }
  }
  if (published) await replica.push(await store.getRepo(repo.name), repo.head.replace('refs/heads/', ''), url);
  console.log(`${pulls.length} open pull request${pulls.length === 1 ? '' : 's'}: ${ran} check${ran === 1 ? '' : 's'} ran, ${reused} reused, ${published} result${published === 1 ? '' : 's'} published`);
}

try {
  if (args[0] === 'key') console.log(await loadKey());
  else if (args[0] === 'run') await run();
  else { console.log('usage: node scripts/runner.mjs key | run --replica URL [--pull N] [--key FILE]'); process.exitCode = 64; }
} catch (error) {
  console.error(`runner: ${error.message}`);
  process.exitCode = 1;
}
