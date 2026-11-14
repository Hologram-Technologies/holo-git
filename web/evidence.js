// Evidence for the merge gate: which check results a change needs.
//
// The definitions are read from the branch as it stands (the base), never from the proposed
// change, so a change cannot weaken the checks it must pass. The labels are read from the
// proposed commit's tree. The result is one action key per required name.

import { parseCommit, parseTree, open } from './engine.js';
import { getObject } from './store.js';
import { parseChecks, actionKey, CHECKS_PATH } from './checks.js';

async function entryAt(treeId, path) {
  let entry = { mode: '40000', id: treeId };
  for (const part of path.split('/')) {
    if (entry.mode !== '40000') return null;
    const found = parseTree(await getObject(entry.id)).find((candidate) => candidate.name === part);
    if (!found) return null;
    entry = found;
  }
  return { mode: entry.mode, id: entry.id };
}

// For each required name: the action key a passing result must carry, or null when the base
// defines no such check (which nothing can satisfy). Returns null overall when the commits are
// not in the store yet, so the caller can tell "unknown" from "no".
export async function expectedActions(base, next, names) {
  let baseTree;
  let nextTree;
  let file;
  try {
    baseTree = parseCommit(await getObject(base)).tree;
    nextTree = parseCommit(await getObject(next)).tree;
    file = await entryAt(baseTree, CHECKS_PATH);
  } catch { return null; }
  let definitions = new Map();
  if (file) {
    let content;
    try { content = open(await getObject(file.id)).content; } catch { return null; }
    try { definitions = parseChecks(content); } catch { definitions = new Map(); } // an unreadable file defines nothing
  }
  const out = [];
  for (const name of names) {
    const definition = definitions.get(name);
    if (!definition) { out.push(null); continue; }
    try { out.push(await actionKey(definition, (path) => entryAt(nextTree, path))); } catch { return null; }
  }
  return out;
}
