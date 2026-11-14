// Evidence for the kernel: did a branch only move forward?
//
// Returns true when `old` is `next` or one of its ancestors, false when the whole history of
// `next` is known and does not contain `old`, and null when that cannot be told because some
// commit is not in the store yet. The caller decides what an unknown means; it is never a yes.

import { parseCommit } from './engine.js';
import { getObject } from './store.js';

export async function isAncestor(old, next) {
  if (old === next) return true;
  const seen = new Set();
  const queue = [next];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    let commit;
    try { commit = parseCommit(await getObject(id)); } catch { return null; }
    if (commit.parents.includes(old)) return true;
    queue.push(...commit.parents);
  }
  return false;
}
