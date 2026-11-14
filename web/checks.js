// A check is named by what it reads, not by when it ran.
//
// A check's definition says what to run and which paths it reads. Its action key is a digest of
// the definition and the content labels of those paths in one tree. Two commits whose trees
// agree on those paths have the same key, so a result for one is a result for the other:
// a rebase, a merge of tested content, or a change to an unrelated file needs no new run.
//
// The key is derived, never written by hand. A path the definition does not list is not part
// of the key, so a check that reads something it did not declare can be wrongly reused. That is
// the one way this goes wrong, and why definitions should list directories, not single files.

const utf8 = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const CHECKS_PATH = '.holo/checks.json';
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isCheckName = (name) => typeof name === 'string' && NAME.test(name);

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
    const inputs = check.inputs.map((path) => {
      if (typeof path !== 'string') throw new Error(`checks file: ${check.name} has a bad input`);
      const clean = path.replace(/^\.\//, '').replace(/\/+$/, '');
      if (!clean || clean.startsWith('/') || clean.split('/').some((part) => part === '..' || part === '')) throw new Error(`checks file: ${check.name} has a bad input ${JSON.stringify(path)}`);
      return clean;
    });
    checks.set(check.name, { name: check.name, run: check.run, cwd: typeof check.cwd === 'string' ? check.cwd : '', inputs: [...new Set(inputs)].sort() });
  }
  return checks;
}

// `lookup(path)` returns { mode, id } for that path in the tree being checked, or null if absent.
export async function actionKey(definition, lookup) {
  const labels = [];
  for (const path of definition.inputs) {
    const entry = await lookup(path);
    labels.push(entry ? [path, entry.mode, entry.id] : [path, 'absent', '']);
  }
  const preimage = JSON.stringify(['holo-git/check-key/1', definition.name, definition.run, definition.cwd, labels]);
  return hex(await crypto.subtle.digest('SHA-256', utf8.encode(preimage)));
}
