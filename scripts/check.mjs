// Run a repository's checks, but only those whose result is not already known.
//
// Works in any git checkout. Each check in .holo/checks.json gets an action key from its
// definition and the git identifiers of the paths it reads (see web/checks.js). A result is
// stored under that key. If a result is there, the check does not run.
//
//   node scripts/check.mjs run [--all] [name...]   run what has no result; exit 1 if any check fails
//   node scripts/check.mjs keys                    print each check's key for the current commit
//   node scripts/check.mjs history [--last N]      how much of the last N commits' checking was repeat work
//
// Results live in .holo/results/<key>.json (override with HOLO_RESULTS). The checkout must be
// clean under a check's inputs, because the key describes committed content, not edits in progress.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { actionKey, parseChecks, CHECKS_PATH } from '../web/checks.js';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim();
const top = git('rev-parse', '--show-toplevel');
const results = resolve(process.env.HOLO_RESULTS || join(top, '.holo', 'results'));

// The git identifier of a path in a commit: a tree's for a directory, a blob's for a file.
function lookupIn(commit) {
  return (path) => {
    const line = git('ls-tree', commit, '--', path);
    if (!line) return null;
    const [mode, , id] = line.split(/\s+/);
    return { mode: mode.replace(/^0+/, ''), id };
  };
}

function definitionsAt(commit) {
  try { return parseChecks(git('show', `${commit}:${CHECKS_PATH}`)); } catch (error) {
    if (/exists on disk, but not in|does not exist|invalid object name|path .* does not exist/i.test(String(error.stderr || error.message))) return new Map();
    throw error;
  }
}

const stored = (key) => (existsSync(join(results, `${key}.json`)) ? JSON.parse(readFileSync(join(results, `${key}.json`), 'utf8')) : null);

async function run(names, all) {
  const definitions = definitionsAt('HEAD');
  if (!definitions.size) { console.log(`no checks: ${CHECKS_PATH} is not in this commit`); return 0; }
  const wanted = names.length ? names : [...definitions.keys()];
  let failed = 0;
  let ran = 0;
  const started = Date.now();
  for (const name of wanted) {
    const definition = definitions.get(name);
    if (!definition) { console.log(`${name}: not defined`); failed += 1; continue; }
    const dirty = git('status', '--porcelain', '--', ...definition.inputs);
    if (dirty) { console.log(`${name}: refused, uncommitted changes under its inputs:\n${dirty}`); failed += 1; continue; }
    const key = await actionKey(definition, lookupIn('HEAD'));
    const known = all ? null : stored(key);
    if (known) {
      console.log(`${name}: ${known.result}, reused (${key.slice(0, 12)}, first run ${known.at}, took ${known.seconds}s then)`);
      if (known.result !== 'pass') failed += 1;
      continue;
    }
    console.log(`${name}: running (${key.slice(0, 12)}): ${definition.run}`);
    const begun = Date.now();
    const outcome = spawnSync(definition.run, { cwd: join(top, definition.cwd), shell: true, stdio: 'inherit' });
    const seconds = Math.round((Date.now() - begun) / 100) / 10;
    const result = outcome.status === 0 ? 'pass' : 'fail';
    mkdirSync(results, { recursive: true });
    writeFileSync(join(results, `${key}.json`), `${JSON.stringify({ name, key, result, seconds, at: new Date().toISOString(), commit: git('rev-parse', 'HEAD') }, null, 2)}\n`);
    console.log(`${name}: ${result} in ${seconds}s`);
    ran += 1;
    if (result !== 'pass') failed += 1;
  }
  console.log(`${wanted.length} check${wanted.length === 1 ? '' : 's'}: ${ran} ran, ${wanted.length - ran} reused or refused, ${failed} failing, ${Math.round((Date.now() - started) / 100) / 10}s`);
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
async function history(last) {
  const definitions = definitionsAt('HEAD');
  if (!definitions.size) { console.log('no checks defined'); return 0; }
  const commits = git('rev-list', '--first-parent', `--max-count=${last}`, 'HEAD').split('\n').reverse();
  const seen = new Map([...definitions.keys()].map((name) => [name, new Set()]));
  const perCommit = [];
  for (const commit of commits) {
    let needed = 0;
    for (const definition of definitions.values()) {
      const key = await actionKey(definition, lookupIn(commit));
      if (!seen.get(definition.name).has(key)) { seen.get(definition.name).add(key); needed += 1; }
    }
    perCommit.push(needed);
  }
  const everyTime = commits.length * definitions.size;
  const withReuse = perCommit.reduce((sum, n) => sum + n, 0);
  console.log(`${commits.length} commits, ${definitions.size} checks (today's definitions applied to each commit)`);
  for (const [name, set] of seen) console.log(`  ${name.padEnd(12)} ${String(set.size).padStart(3)} distinct inputs in ${commits.length} commits`);
  console.log(`  commits needing no check at all: ${perCommit.filter((n) => n === 0).length}`);
  console.log(`  check runs, every check on every commit: ${everyTime}`);
  console.log(`  check runs, reusing results:             ${withReuse}`);
  console.log(`  runs avoided: ${everyTime - withReuse} of ${everyTime} (${Math.round(100 * (everyTime - withReuse) / everyTime)}%)`);
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);
const positional = rest.filter((arg, i) => !arg.startsWith('--') && rest[i - 1] !== '--last');
let code;
if (command === 'run') code = await run(positional, flag('--all'));
else if (command === 'keys') code = await keys();
else if (command === 'history') code = await history(Number(option('--last', '50')));
else { console.log('usage: node scripts/check.mjs run [--all] [name...] | keys | history [--last N]'); code = 64; }
process.exit(code);
