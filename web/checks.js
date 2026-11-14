// A check is named by what it reads, not by when it ran.
//
// A check's definition says what to run, which paths it reads, which tools it expects and which
// environment variables it needs. Its action key is a digest of the definition and the content
// labels of those paths in one tree. Two commits whose trees agree on those paths have the same
// key, so a result for one is a result for the other: a rebase, a merge of tested content, or a
// change to an unrelated file needs no new run.
//
// The key is derived, never written by hand, and anyone can derive it without running anything.
// That is why the tools and the environment are declared in the definition instead of observed:
// a runner refuses to run a check whose declared tools it does not have, and gives the check no
// environment variable it did not name. What a check may depend on is then exactly what is in
// its key.
//
// A check may also produce files (`outputs`) and another may consume them (`uses`). The consumer's
// key then carries a digest of the files produced, not the labels of the sources they were made
// from. A change to the sources that leaves the product byte for byte the same leaves the
// consumer's key the same, so its result is reused. That key cannot be derived from a tree alone:
// it needs the producer's result, which states the digest.

const utf8 = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const CHECKS_PATH = '.holo/checks.json';
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
export const isCheckName = (name) => typeof name === 'string' && NAME.test(name);

function paths(list, check, what) {
  return [...new Set(list.map((path) => {
    if (typeof path !== 'string') throw new Error(`checks file: ${check} has a bad ${what}`);
    const clean = path.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!clean || clean.startsWith('/') || clean.includes('\\') || clean.split('/').some((part) => part === '..' || part === '')) throw new Error(`checks file: ${check} has a bad ${what} ${JSON.stringify(path)}`);
    return clean;
  }))].sort();
}

// Read a definitions file. Anything malformed is an error: a check that cannot be read cannot pass.
export function parseChecks(bytes) {
  const data = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  if (!data || !Array.isArray(data.checks)) throw new Error('checks file: expected { "checks": [...] }');
  const checks = new Map();
  for (const check of data.checks) {
    if (!isCheckName(check.name)) throw new Error(`checks file: bad name ${JSON.stringify(check.name)}`);
    if (checks.has(check.name)) throw new Error(`checks file: ${check.name} is defined twice`);
    if (typeof check.run !== 'string' || !check.run.trim()) throw new Error(`checks file: ${check.name} has nothing to run`);
    if (!Array.isArray(check.inputs) || !check.inputs.length) throw new Error(`checks file: ${check.name} lists no inputs`);
    // Each tool is a command and the start of the output it must print, such as a version.
    const tools = (check.tools || []).map((tool) => {
      if (!tool || typeof tool.run !== 'string' || !tool.run.trim() || typeof tool.expect !== 'string' || !tool.expect) throw new Error(`checks file: ${check.name} has a bad tool`);
      return [tool.run, tool.expect];
    });
    const env = [...new Set(check.env || [])].sort();
    if (!env.every((name) => typeof name === 'string' && ENV.test(name))) throw new Error(`checks file: ${check.name} names a bad environment variable`);
    checks.set(check.name, {
      name: check.name, run: check.run, cwd: typeof check.cwd === 'string' ? paths([check.cwd], check.name, 'directory')[0] : '',
      inputs: paths(check.inputs, check.name, 'input'), tools, env,
      // Directories kept between runs to save time (build output, downloaded packages). They are
      // not part of the key, so they must never change what a check concludes.
      keep: paths(check.keep || [], check.name, 'kept directory'),
      // Paths the check writes, for other checks to consume, and the checks whose outputs it consumes.
      outputs: paths(check.outputs || [], check.name, 'output'),
      uses: [...new Set(check.uses || [])],
    });
  }
  for (const check of checks.values()) {
    for (const used of check.uses) {
      if (!checks.has(used) || used === check.name) throw new Error(`checks file: ${check.name} uses ${JSON.stringify(used)}, which is not another check here`);
      if (!checks.get(used).outputs.length) throw new Error(`checks file: ${check.name} uses ${used}, which declares no outputs`);
    }
  }
  // Nothing may consume its own product, however indirectly.
  const state = new Map();
  const visit = (name) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'open') throw new Error(`checks file: ${name} uses itself through other checks`);
    state.set(name, 'open');
    for (const used of checks.get(name).uses) visit(used);
    state.set(name, 'done');
  };
  for (const name of checks.keys()) visit(name);
  return checks;
}

// `lookup(path)` returns { mode, id } for that path in the tree being checked, or null if absent.
// `produced` maps each check this one uses to the digest of what that check produced. Without it
// the key of a check that uses another is not known, and asking for it is an error.
export async function actionKey(definition, lookup, produced) {
  const labels = [];
  for (const path of definition.inputs) {
    const entry = await lookup(path);
    labels.push(entry ? [path, entry.mode, entry.id] : [path, 'absent', '']);
  }
  const base = [definition.name, definition.run, definition.cwd, definition.tools, definition.env, labels];
  // Checks with no outputs and no uses keep the key they always had.
  let preimage = JSON.stringify(['holo-git/check-key/2', ...base]);
  if (definition.outputs.length || definition.uses.length) {
    const used = definition.uses.map((name) => {
      const digest = produced && produced.get(name);
      if (typeof digest !== 'string' || !digest) throw new Error(`the key of ${definition.name} needs what ${name} produced`);
      return [name, digest];
    });
    preimage = JSON.stringify(['holo-git/check-key/3', ...base, definition.outputs, used]);
  }
  return hex(await crypto.subtle.digest('SHA-256', utf8.encode(preimage)));
}
