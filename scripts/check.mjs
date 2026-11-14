// Run a repository's checks, but only those whose result is not already known.
//
// Works in any git checkout. Each check in .holo/checks.json gets an action key from its
// definition and the git identifiers of the paths it reads (see web/checks.js). A result is
// stored under that key. If a result is there, the check does not run.
//
//   node scripts/check.mjs run [--all] [--retry] [--strict] [name...]
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
// Results live in .holo/results/<key>.json (override with HOLO_RESULTS). Working directories live
// under the system's temporary directory (override with HOLO_WORK).
//
// A stored failure is reused like a stored pass. If a failure came from the machine and not from
// the content (a full disk, a network outage), run again with --retry to replace stored failures.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { actionKey, parseChecks, CHECKS_PATH } from '../web/checks.js';
import { environmentFor, toolsFor, execute } from './lib/execute.mjs';

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
function prepare(definition) {
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
  const present = definition.inputs.filter((path) => git('ls-tree', 'HEAD', '--', path));
  if (present.length) {
    // The archive is named by a relative path: some tar programs read a drive letter as a host name.
    const archive = `${definition.name}.tar`;
    execFileSync('git', ['archive', '--format=tar', '-o', join(work, archive), 'HEAD', '--', ...present], { cwd: top });
    execFileSync('tar', ['-xf', `../${archive}`], { cwd: directory });
    rmSync(join(work, archive), { force: true });
  }
  return directory;
}

async function run(names, all, strict, retry) {
  const definitions = definitionsAt('HEAD');
  if (!definitions.size) { console.log(`no checks: ${CHECKS_PATH} is not in this commit`); return 0; }
  const wanted = names.length ? names : [...definitions.keys()];
  let failed = 0;
  let ran = 0;
  let skipped = 0;
  const started = Date.now();
  for (const name of wanted) {
    const definition = definitions.get(name);
    if (!definition) { console.log(`${name}: not defined`); failed += 1; continue; }
    const cannot = (why) => {
      console.log(`${name}: cannot run here: ${why}`);
      skipped += 1;
      if (strict || names.length) failed += 1;
    };
    // A result that is already known needs nothing from this machine but its tools' versions.
    // Only running the check needs the environment it named.
    const { env, missing } = environmentFor(definition);
    const { observed, problem } = toolsFor(definition, env || environmentFor({ ...definition, env: [] }).env);
    if (problem) { cannot(problem); continue; }
    const key = await actionKey(definition, lookupIn('HEAD'));
    let known = all ? null : stored(key);
    if (known && retry && known.result !== 'pass') known = null;
    // A stored result is reused only if it was made with tools that print what these print now.
    if (known && JSON.stringify(known.tools || []) === JSON.stringify(observed)) {
      console.log(`${name}: ${known.result}, reused (${key.slice(0, 12)}, first run ${known.at}, took ${known.seconds}s then)`);
      if (known.result !== 'pass') failed += 1;
      continue;
    }
    if (missing) { cannot(`it needs ${missing.join(', ')} in the environment`); continue; }
    if (git('status', '--porcelain', '--', ...definition.inputs)) console.log(`${name}: note, uncommitted changes under its inputs are not part of what is checked`);
    console.log(`${name}: running (${key.slice(0, 12)}): ${definition.run}`);
    const directory = prepare(definition);
    const { result, seconds } = execute(definition, join(directory, definition.cwd), env);
    mkdirSync(results, { recursive: true });
    writeFileSync(join(results, `${key}.json`), `${JSON.stringify({ name, key, result, seconds, at: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), tools: observed }, null, 2)}\n`);
    console.log(`${name}: ${result} in ${seconds}s`);
    ran += 1;
    if (result !== 'pass') failed += 1;
  }
  console.log(`${wanted.length} check${wanted.length === 1 ? '' : 's'}: ${ran} ran, ${wanted.length - ran - skipped} reused, ${skipped} skipped, ${failed} failing, ${Math.round((Date.now() - started) / 100) / 10}s`);
  return failed ? 1 : 0;
}

async function keys() {
  for (const definition of definitionsAt('HEAD').values()) {
    const key = await actionKey(definition, lookupIn('HEAD'));
    const known = stored(key);
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
const flag = (name) => rest.includes(name);
const option = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
const positional = rest.filter((arg, i) => !arg.startsWith('--') && !['--last', '--ref', '--definitions'].includes(rest[i - 1]));
let code;
if (command === 'run') code = await run(positional, flag('--all'), flag('--strict'), flag('--retry'));
else if (command === 'keys') code = await keys();
else if (command === 'history') code = await history(Number(option('--last', '50')), option('--ref', 'HEAD'), option('--definitions', null));
else { console.log('usage: node scripts/check.mjs run [--all] [--retry] [--strict] [name...] | keys | history [--last N] [--ref REF] [--definitions FILE]'); code = 64; }
process.exit(code);
