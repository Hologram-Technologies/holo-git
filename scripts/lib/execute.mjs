// Running one check so that it can depend only on what its key covers.
//
// - The directory it runs in holds the inputs it declared and nothing else from the repository.
//   A check that reads a file it did not declare fails here, instead of passing and being
//   wrongly reused later.
// - It gets a small fixed set of environment variables, plus those it named. Anything else in
//   the caller's environment is withheld.
// - The tools it declared are asked for their versions first. If one is missing or prints
//   something else, the check is not run on this machine at all.
//
// It is not a sandbox. A check can still read outside its directory, use the network and read
// the clock. This closes the accidental cases, not the deliberate ones.

import { spawnSync } from 'node:child_process';

// What a process needs in order to start and find its tools, on any platform. Nothing project-specific.
const BASELINE = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'ComSpec', 'COMSPEC', 'PATHEXT', 'windir', 'WINDIR',
  'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM',
  'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'npm_config_cache', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'MSYSTEM'];

export function environmentFor(definition, source = process.env) {
  const missing = definition.env.filter((name) => !source[name]);
  if (missing.length) return { missing };
  const env = {};
  for (const name of [...BASELINE, ...definition.env]) if (source[name] !== undefined) env[name] = source[name];
  return { env };
}

// Returns { observed } with what each declared tool printed, or { problem } saying which one is not as declared.
export function toolsFor(definition, env) {
  const observed = [];
  for (const [run, expect] of definition.tools) {
    const out = spawnSync(run, { shell: true, env, encoding: 'utf8' });
    const line = out.status === 0 ? String(out.stdout).trim().split('\n')[0].trim() : null;
    if (line === null) return { problem: `\`${run}\` did not run here` };
    if (!line.startsWith(expect)) return { problem: `\`${run}\` prints "${line}" here; the check expects it to start with "${expect}"` };
    observed.push([run, line]);
  }
  return { observed };
}

export function execute(definition, directory, env) {
  const begun = Date.now();
  const outcome = spawnSync(definition.run, { cwd: directory, shell: true, stdio: 'inherit', env });
  return { result: outcome.status === 0 ? 'pass' : 'fail', seconds: Math.round((Date.now() - begun) / 100) / 10 };
}
