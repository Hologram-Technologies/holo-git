// Run a repository's checks, but only those whose result is not already known.
//
// Works in any git checkout. Each check in .holo/checks.json gets an action key from its
// definition and the git identifiers of the paths it reads (see web/checks.js). A result is
// stored under that key. If a result is there, the check does not run.
//
//   node scripts/check.mjs run [--all] [--retry] [--strict] [--fail-fast] [--commit REV] [name...]
//   node scripts/check.mjs keys                    print each check's key for the current commit
//   node scripts/check.mjs history [--last N] [--ref REF] [--definitions FILE]
//                                                  how much of the last N commits' checking was repeat work.
//                                                  --definitions tries a checks file that is not committed,
//                                                  so a repository can be measured without changing it.
//
// A check runs on the committed content, in a directory holding only its declared inputs (see
// scripts/lib/execute.mjs). Uncommitted edits are not checked. A check this machine cannot run
// (a declared tool or environment variable is missing) is skipped; with --strict, or when the
// check is named on the command line, that is a failure.
//
// Sharing results. With --store URL (or HOLO_STORE), a result made here is signed with this
// machine's key and written to the store, and a result already there is reused instead of
// running the check, if it was signed by this machine or by a key on the signers list (see
// scripts/lib/results.mjs). So a check run before a push is the result everyone else reads.
//   --key FILE          this machine's signing key (HOLO_KEY; default ~/.holo-git/key.json)
//   --signers FILE      the list of trusted signers, or
//   --signers-ref REF   read .holo/signers.json from that ref (HOLO_SIGNERS_REF). Name a ref the
//                       change being checked cannot move, such as the protected branch: a list
//                       read from the change itself would let its author trust themselves.
//   --no-publish        read the store, write nothing to it
//   node scripts/check.mjs key                     print this machine's key, to be put on a signers list
//
// Order. Results that are already known are reported first, since they cost nothing. The checks
// that must run go cheapest and likeliest to fail first, judged by the results kept on this
// machine: the aim is to hear about a failure as early as possible. With --fail-fast the first
// failure ends the run and the rest are listed as not run.
//
// Before a push. `hook install` writes a pre-push hook that checks each commit being pushed, with
// --fail-fast, and refuses the push if a check fails. It is a courtesy to the author, not a gate:
// `git push --no-verify` skips it. --commit REV checks any commit, not only the one checked out.
//   node scripts/check.mjs hook install | remove
// The store and the signers ref may also be set once per checkout:
//   git config holo.store URL ; git config holo.signersRef origin/main
//
// Results live in .holo/results/<key>.json (override with HOLO_RESULTS). Working directories live
// under the system's temporary directory (override with HOLO_WORK).
//
// A stored failure is reused like a stored pass. If a failure came from the machine and not from
// the content (a full disk, a network outage), run again with --retry to replace stored failures.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { actionKey, parseChecks, CHECKS_PATH } from '../web/checks.js';
import { environmentFor, toolsFor, execute } from './lib/execute.mjs';
import { SIGNERS_PATH, machineKey, openStore, parseSigners, sign } from './lib/results.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim();
const top = git('rev-parse', '--show-toplevel');
const results = resolve(process.env.HOLO_RESULTS || join(top, '.holo', 'results'));
// Working directories go under the system's temporary directory, by a short name derived from
// the checkout's path: build tools nest deeply, and some systems limit how long a path may be.
const work = resolve(process.env.HOLO_WORK || join(tmpdir(), 'holo-work', createHash('sha256').update(top).digest('hex').slice(0, 10)));

// The git identifier of a path in a commit: a tree's for a directory, a blob's for a file.
function lookupIn(commit) {
  return (path) => {
    const line = git('ls-tree', commit, '--', path);
    if (!line) return null;
    const [mode, , id] = line.split(/\s+/);
    return { mode: mode.replace(/^0+/, ''), id };
  };
}

// The same, for many paths with one call to git: replaying history asks about every input of
// every check at every commit.
function lookupAllIn(commit, paths) {
  const found = new Map();
  for (const entry of git('ls-tree', '-z', commit, '--', ...paths).split('\0')) {
    if (!entry) continue;
    const [meta, path] = entry.split('\t');
    const [mode, , id] = meta.split(/\s+/);
    found.set(path, { mode: mode.replace(/^0+/, ''), id });
  }
  return (path) => found.get(path.replace(/\/+$/, '')) || null;
}

function definitionsAt(commit) {
  try { return parseChecks(git('show', `${commit}:${CHECKS_PATH}`)); } catch (error) {
    if (/exists on disk, but not in|does not exist|invalid object name|path .* does not exist/i.test(String(error.stderr || error.message))) return new Map();
    throw error;
  }
}

const stored = (key) => (existsSync(join(results, `${key}.json`)) ? JSON.parse(readFileSync(join(results, `${key}.json`), 'utf8')) : null);

// A directory holding exactly the check's inputs as committed, plus whatever it was allowed to keep.
function prepare(definition, commit) {
  const directory = join(work, definition.name);
  mkdirSync(directory, { recursive: true });
  const kept = new Set(definition.keep);
  const clear = (relative) => {
    for (const name of readdirSync(join(directory, relative))) {
      const path = relative ? `${relative}/${name}` : name;
      if (kept.has(path)) continue;
      if ([...kept].some((keep) => keep.startsWith(`${path}/`))) clear(path);
      else rmSync(join(directory, path), { recursive: true, force: true });
    }
  };
  clear('');
  const present = definition.inputs.filter((path) => git('ls-tree', commit, '--', path));
  if (present.length) {
    // The archive is named by a relative path: some tar programs read a drive letter as a host name.
    const archive = `${definition.name}.tar`;
    execFileSync('git', ['archive', '--format=tar', '-o', join(work, archive), commit, '--', ...present], { cwd: top });
    execFileSync('tar', ['-xf', `../${archive}`], { cwd: directory });
    rmSync(join(work, archive), { force: true });
  }
  return directory;
}

// Who is trusted, where results are shared, and whether this machine adds to them.
async function sharing(options) {
  const store = openStore(options.store);
  if (!store) return null;
  const me = await machineKey(options.key);
  let listed = new Map();
  if (options.signers) listed = parseSigners(readFileSync(options.signers, 'utf8'));
  else if (options.signersRef) {
    let text = null;
    try { text = git('show', `${options.signersRef}:${SIGNERS_PATH}`); } catch (error) {
      if (!/exists on disk, but not in|does not exist|invalid object name/i.test(String(error.stderr || error.message))) throw error;
    }
    if (text !== null) listed = parseSigners(text);
  }
  const trusted = new Map([...listed, [me.id, listed.get(me.id) || 'this machine']]);
  // With a list, a machine that is not on it has nothing to add that anyone would accept.
  const publishes = !options.noPublish && (!listed.size || listed.has(me.id));
  return { store, me, trusted, publishes };
}

// A result from the store, in the shape results are kept in here, or null.
async function shared(share, key, name) {
  if (!share) return null;
  const record = await share.store.find(key, name, share.trusted);
  if (!record) return null;
  return { name, key, result: record.result, seconds: record.seconds, at: new Date(record.time).toISOString(), commit: record.commit, tools: JSON.parse(record.tools), signed: record };
}

const save = (key, value) => { mkdirSync(results, { recursive: true }); writeFileSync(join(results, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`); };

async function publish(share, name, record) {
  if (!share || !share.publishes || !record || record.key !== share.me.id) return;
  const problem = await share.store.publish(record);
  if (problem) console.log(`${name}: note, the result was not shared: ${problem}`);
}

// What the results kept here say about each check: how long it takes and how often it fails.
function experience() {
  const by = new Map();
  if (!existsSync(results)) return by;
  for (const file of readdirSync(results)) {
    if (!file.endsWith('.json')) continue;
    let record;
    try { record = JSON.parse(readFileSync(join(results, file), 'utf8')); } catch { continue; }
    if (!record || typeof record.name !== 'string') continue;
    const seen = by.get(record.name) || { runs: 0, fails: 0, seconds: 0 };
    seen.runs += 1;
    seen.fails += record.result === 'pass' ? 0 : 1;
    seen.seconds += Number(record.seconds) || 0;
    by.set(record.name, seen);
  }
  return by;
}

// Seconds spent per unit of chance to find a failure. Running in rising order of this is what
// reaches the first failure soonest on average. A check never seen is assumed typical.
function ordered(pending) {
  const seen = experience();
  const all = [...seen.values()];
  const typical = all.length ? all.reduce((sum, e) => sum + e.seconds, 0) / all.reduce((sum, e) => sum + e.runs, 0) : 60;
  const cost = ({ name }) => {
    const e = seen.get(name);
    const seconds = e ? e.seconds / e.runs : typical;
    const chance = ((e ? e.fails : 0) + 1) / ((e ? e.runs : 0) + 2);
    return Math.max(seconds, 0.1) / chance;
  };
  return pending.map((entry, index) => ({ entry, index, cost: cost(entry) })).sort((a, b) => a.cost - b.cost || a.index - b.index).map(({ entry }) => entry);
}

async function run(names, { all = false, strict = false, retry = false, failFast = false, commit = 'HEAD' }, options) {
  const share = await sharing(options);
  const definitions = definitionsAt(commit);
  if (!definitions.size) { console.log(`no checks: ${CHECKS_PATH} is not in this commit`); return 0; }
  const wanted = names.length ? names : [...definitions.keys()];
  let failed = 0;
  let ran = 0;
  let reused = 0;
  let skipped = 0;
  const started = Date.now();
  const cannot = (name, why) => {
    console.log(`${name}: cannot run here: ${why}`);
    skipped += 1;
    if (strict || names.length) failed += 1;
  };

  // First, everything that needs no run: results already known here or in the store.
  const pending = [];
  for (const name of wanted) {
    const definition = definitions.get(name);
    if (!definition) { console.log(`${name}: not defined`); failed += 1; continue; }
    // A result that is already known needs nothing from this machine but its tools' versions.
    // Only running the check needs the environment it named.
    const { env, missing } = environmentFor(definition);
    const { observed, problem } = toolsFor(definition, env || environmentFor({ ...definition, env: [] }).env);
    if (problem) { cannot(name, problem); continue; }
    const key = await actionKey(definition, lookupIn(commit));
    let known = all ? null : stored(key);
    if (known && retry && known.result !== 'pass') known = null;
    let from = '';
    if (!known && !all) {
      known = await shared(share, key, name);
      if (known && retry && known.result !== 'pass') known = null;
      if (known) from = `, signed by ${share.trusted.get(known.signed.key)}`;
    }
    // A stored result is reused only if it was made with tools that print what these print now.
    if (known && JSON.stringify(known.tools || []) === JSON.stringify(observed)) {
      console.log(`${name}: ${known.result}, reused${from} (${key.slice(0, 12)}, first run ${known.at}, took ${known.seconds}s then)`);
      if (from) save(key, known);
      // A result made here before the store was named is shared now.
      else if (share && known.signed && known.signed.key === share.me.id && !(await share.store.has(key, share.me.id))) await publish(share, name, known.signed);
      reused += 1;
      if (known.result !== 'pass') failed += 1;
      continue;
    }
    pending.push({ name, definition, env, missing, observed, key });
  }

  // Then the checks that must run, soonest-to-fail first.
  const queue = ordered(pending);
  const head = commit === 'HEAD';
  while (queue.length && !(failFast && failed)) {
    const { name, definition, env, missing, observed, key } = queue.shift();
    if (missing) { cannot(name, `it needs ${missing.join(', ')} in the environment`); continue; }
    if (head && git('status', '--porcelain', '--', ...definition.inputs)) console.log(`${name}: note, uncommitted changes under its inputs are not part of what is checked`);
    console.log(`${name}: running (${key.slice(0, 12)}): ${definition.run}`);
    const directory = prepare(definition, commit);
    const { result, seconds } = execute(definition, join(directory, definition.cwd), env);
    const id = git('rev-parse', commit);
    const signed = share ? await sign(share.me, { action: key, name, result, tools: observed, seconds, commit: id }) : undefined;
    save(key, { name, key, result, seconds, at: new Date().toISOString(), commit: id, tools: observed, signed });
    await publish(share, name, signed);
    console.log(`${name}: ${result} in ${seconds}s`);
    ran += 1;
    if (result !== 'pass') failed += 1;
  }
  if (queue.length) console.log(`not run after the first failure: ${queue.map(({ name }) => name).join(', ')}`);
  console.log(`${wanted.length} check${wanted.length === 1 ? '' : 's'}: ${ran} ran, ${reused} reused, ${skipped} skipped, ${failed} failing${queue.length ? `, ${queue.length} not run` : ''}, ${Math.round((Date.now() - started) / 100) / 10}s`);
  return failed ? 1 : 0;
}

// The pre-push hook's work: git writes one line per ref being pushed. Check each commit named,
// stopping at the first failure. A non-zero exit refuses the push.
async function prepush(options) {
  let lines = [];
  try { lines = readFileSync(0, 'utf8').split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 4); } catch { /* nothing was piped in */ }
  const done = new Set();
  for (const [ref, id] of lines) {
    if (/^0+$/.test(id) || done.has(id)) continue; // a deleted ref has nothing to check
    done.add(id);
    console.log(`checking ${ref} at ${id.slice(0, 12)}`);
    if (await run([], { failFast: true, commit: id }, options)) {
      console.log(`push refused: a check fails for ${ref}. Fix it and push again; \`git push --no-verify\` skips this hook.`);
      return 1;
    }
  }
  return 0;
}

const MARK = '# holo-git pre-push';
function hook(action) {
  const file = resolve(git('rev-parse', '--git-path', 'hooks/pre-push'));
  const ours = existsSync(file) && readFileSync(file, 'utf8').includes(MARK);
  if (existsSync(file) && !ours) { console.log(`${file} exists and is not this one. Nothing changed; call \`check.mjs prepush "$@"\` from it yourself.`); return 1; }
  if (action === 'remove') { if (ours) rmSync(file); console.log(ours ? `removed ${file}` : 'no hook to remove'); return 0; }
  if (action !== 'install') { console.log('usage: node scripts/check.mjs hook install | remove'); return 64; }
  mkdirSync(resolve(file, '..'), { recursive: true });
  const script = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  writeFileSync(file, `#!/bin/sh\n${MARK}: checks what is being pushed and refuses the push if a check fails.\n# Installed by \`check.mjs hook install\`. Remove this file, or run \`check.mjs hook remove\`, to stop it.\nexec node "${script}" prepush "$@"\n`);
  chmodSync(file, 0o755);
  console.log(`installed ${file}`);
  return 0;
}

async function keys(options) {
  const share = await sharing(options);
  for (const definition of definitionsAt('HEAD').values()) {
    const key = await actionKey(definition, lookupIn('HEAD'));
    const known = stored(key) || await shared(share, key, definition.name);
    console.log(`${key}  ${definition.name}  ${known ? known.result : 'no result'}`);
  }
  return 0;
}

// Replay history: with today's definitions, how many check runs would the last N commits have
// needed if every result were reused, against one run of every check per commit?
async function history(last, ref, file) {
  const definitions = file ? parseChecks(readFileSync(file)) : definitionsAt('HEAD');
  if (!definitions.size) { console.log('no checks defined'); return 0; }
  const commits = git('rev-list', '--first-parent', `--max-count=${last}`, ref).split('\n').reverse();
  const seen = new Map([...definitions.keys()].map((name) => [name, new Set()]));
  const perCommit = [];
  const paths = [...new Set([...definitions.values()].flatMap((definition) => definition.inputs))];
  for (const commit of commits) {
    let needed = 0;
    const lookup = lookupAllIn(commit, paths);
    for (const definition of definitions.values()) {
      const key = await actionKey(definition, lookup);
      if (!seen.get(definition.name).has(key)) { seen.get(definition.name).add(key); needed += 1; }
    }
    perCommit.push(needed);
  }
  const everyTime = commits.length * definitions.size;
  const withReuse = perCommit.reduce((sum, n) => sum + n, 0);
  console.log(`${commits.length} commits, ${definitions.size} checks (today's definitions applied to each commit)`);
  for (const [name, set] of seen) console.log(`  ${name.padEnd(14)} ${String(set.size).padStart(4)} distinct inputs in ${commits.length} commits (${Math.round(100 * (commits.length - set.size) / commits.length)}% reusable)`);
  console.log(`  commits needing no check at all: ${perCommit.filter((n) => n === 0).length}`);
  console.log(`  check runs, every check on every commit: ${everyTime}`);
  console.log(`  check runs, reusing results:             ${withReuse}`);
  console.log(`  runs avoided: ${everyTime - withReuse} of ${everyTime} (${Math.round(100 * (everyTime - withReuse) / everyTime)}%)`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const VALUED = ['--last', '--ref', '--definitions', '--store', '--key', '--signers', '--signers-ref', '--commit'];
const flag = (name) => rest.includes(name);
const option = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
const positional = rest.filter((arg, i) => !arg.startsWith('--') && !VALUED.includes(rest[i - 1]));
// Set once per checkout with `git config`. It is this checkout's own setting, not part of any change.
const config = (name) => { try { return git('config', '--get', name); } catch { return ''; } };
const options = {
  store: option('--store', process.env.HOLO_STORE || config('holo.store')),
  key: resolve(option('--key', process.env.HOLO_KEY || join(homedir(), '.holo-git', 'key.json'))),
  signers: option('--signers', ''),
  signersRef: option('--signers-ref', process.env.HOLO_SIGNERS_REF || config('holo.signersRef')),
  noPublish: flag('--no-publish'),
};
let code;
if (command === 'run') code = await run(positional, { all: flag('--all'), strict: flag('--strict'), retry: flag('--retry'), failFast: flag('--fail-fast'), commit: option('--commit', 'HEAD') }, options);
else if (command === 'prepush') code = await prepush(options);
else if (command === 'hook') code = hook(positional[0]);
else if (command === 'keys') code = await keys(options);
else if (command === 'key') { console.log((await machineKey(options.key)).id); code = 0; }
else if (command === 'history') code = await history(Number(option('--last', '50')), option('--ref', 'HEAD'), option('--definitions', null));
else { console.log('usage: node scripts/check.mjs run [--all] [--retry] [--strict] [--fail-fast] [--commit REV] [--store URL] [name...] | keys | key | hook install|remove | history [--last N] [--ref REF] [--definitions FILE]'); code = 64; }
process.exit(code);
