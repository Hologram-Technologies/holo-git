// Fetch what a replica has and bring this clone up to it.
//
// A repository's log is one chain. When this device and the replica have both added to it, the
// replica's chain stands, and this device's unpushed records are signed again on top of it: its
// commits become one merge, its grants and revocations are issued again. Nothing already
// published is rewritten. Every re-signed record goes through the same fold and the same kernel
// decision as any other, so a device whose access was withdrawn meanwhile cannot merge.
//
// When both sides changed the same lines, nothing here changes. The conflicts are returned for a
// person to resolve, and the same call is made again with their resolutions.

import { parseCommit, open, makeObject, makeTree, makeCommit, mergeLines } from './engine.js';
import { fold } from './log.js';
import { recordDigest } from './records.js';
import { extend, deviceKey, openPull } from './identity.js';
import { readState, fetchLog, fetchMissing } from './replica.js';
import { getObject, putObjects, listRefUpdates, getRefs, adoptLog } from './store.js';
import { readTree, person } from './git.js';

const text = new TextDecoder();

async function ancestors(start) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...parseCommit(await getObject(id)).parents);
  }
  return seen;
}

// The newest commit both histories contain. With criss-cross history there can be several
// candidates; the newest by committer time is used.
async function mergeBase(ours, theirs) {
  const mine = await ancestors(ours);
  let best = null;
  for (const id of await ancestors(theirs)) {
    if (!mine.has(id)) continue;
    const time = person(parseCommit(await getObject(id)).committer).time;
    if (!best || time > best.time) best = { id, time };
  }
  return best ? best.id : null;
}

const isTree = (entry) => entry && entry.mode === '40000';
const same = (a, b) => (!a && !b) || (a && b && a.id === b.id && a.mode === b.mode);
const binary = (bytes) => bytes.subarray(0, 8000).includes(0);
const became = (entry, base) => (!entry ? 'deleted' : isTree(entry) ? 'a directory' : !base ? 'added' : 'changed');

// A resolution may not still contain the markers a conflict was shown with.
export function hasMarkers(bytes) {
  return /^(<<<<<<< ours|=======|>>>>>>> theirs)\r?$/m.test(text.decode(bytes));
}

// Merge three trees. Identical subtrees are recognised by identifier and never opened.
// Returns the merged tree's identifier, or null when the directory ends up empty.
async function mergeTrees(base, ours, theirs, prefix, context, top = false) {
  if (ours === theirs) return ours;
  if (base === ours) return theirs;
  if (base === theirs) return ours;
  const { conflicts, made, resolutions } = context;
  const list = async (id) => new Map((id ? await readTree(id) : []).map((entry) => [entry.name, entry]));
  const [b, o, t] = [await list(base), await list(ours), await list(theirs)];
  const entries = [];
  for (const name of [...new Set([...b.keys(), ...o.keys(), ...t.keys()])].sort()) {
    const [be, oe, te] = [b.get(name), o.get(name), t.get(name)];
    const path = prefix + name;
    let pick;
    if (same(oe, te)) pick = oe;
    else if (same(be, oe)) pick = te;
    else if (same(be, te)) pick = oe;
    else if (isTree(oe) && isTree(te)) {
      const id = await mergeTrees(isTree(be) ? be.id : null, oe.id, te.id, `${path}/`, context);
      pick = id ? { mode: '40000', name, id } : undefined;
    } else {
      // Both sides changed this path differently. Try the text merge; otherwise a person decides.
      const bothFiles = oe && te && !isTree(oe) && !isTree(te) && oe.mode === te.mode && (!be || !isTree(be));
      let detail = { path, kind: 'choice', ours: became(oe, be), theirs: became(te, be) };
      if (bothFiles) {
        const content = async (entry) => (entry ? open(await getObject(entry.id)).content : new Uint8Array());
        const [bc, oc, tc] = [await content(be), await content(oe), await content(te)];
        if (!binary(bc) && !binary(oc) && !binary(tc)) {
          const merged = mergeLines(bc, oc, tc);
          if (merged.clean && be) {
            const blob = makeObject('blob', merged.bytes);
            made.push(blob);
            pick = { mode: oe.mode, name, id: blob.id };
            detail = null;
          } else detail = { path, kind: 'text', ours: became(oe, be), theirs: became(te, be), marked: merged.clean ? null : merged.marked, oursText: oc, theirsText: tc };
        }
      }
      if (detail) {
        const decided = resolutions.get(path);
        if (decided && decided.content) {
          if (hasMarkers(decided.content)) throw new Error(`conflict markers are still in ${path}`);
          const blob = makeObject('blob', decided.content);
          made.push(blob);
          pick = { mode: (oe && !isTree(oe) ? oe : te && !isTree(te) ? te : { mode: '100644' }).mode, name, id: blob.id };
        } else if (decided && decided.take === 'ours') pick = oe;
        else if (decided && decided.take === 'theirs') pick = te;
        else { conflicts.push(detail); pick = oe; }
      }
    }
    if (pick) entries.push({ mode: pick.mode, name, id: pick.id });
  }
  if (!entries.length && !top) return null;
  const tree = makeTree(entries);
  made.push(tree);
  return tree.id;
}

function identityLine(name, email, time) {
  const clean = (value) => value.replace(/[<>\n\r\0]/g, '').trim();
  if (!clean(name) || !clean(email)) throw new Error('a name and an email are needed for the merge commit');
  const offset = -new Date(time).getTimezoneOffset();
  const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return `${clean(name)} <${clean(email)}> ${Math.floor(time / 1000)} ${zone}`;
}

// `resolution` is { against, paths }: the replica head the conflicts were shown for, and for each
// conflicting path either { content } or { take: 'ours' | 'theirs' }.
export async function fetchFrom(repo, branch, base, who = {}, report = () => {}, resolution = null) {
  base = base.replace(/\/+$/, '');
  const ref = `refs/heads/${branch}`;
  const { state } = await readState(base);
  if (!state || !state.refs[ref]) throw new Error('the replica has nothing on this branch');
  const remote = await fetchLog(base, state.refs[ref].record);
  const remoteState = await fold(remote);
  const remoteHead = remoteState.heads[ref];
  if (state.refs[ref].record !== remoteState.digest || state.refs[ref].id !== remoteHead) throw new Error('refused: the replica names a head its signed log does not lead to');
  if (resolution && resolution.against !== remoteHead) throw new Error('the replica changed again since these conflicts were shown; fetch and resolve again');

  const local = await listRefUpdates(repo.name);
  let shared = 0;
  while (shared < local.length && shared < remote.length && await recordDigest(local[shared]) === await recordDigest(remote[shared])) shared += 1;
  if (local.length && shared === 0) throw new Error('refused: the replica holds a different repository');
  if (shared === remote.length && shared === local.length) return { outcome: 'up to date', head: remoteHead };
  if (shared === remote.length) return { outcome: 'ahead', head: (await getRefs(repo.name))[ref], unpushed: local.length - shared };

  // The head's history, and any commit a protected branch passed through that is no longer reachable from it.
  const fetched = await fetchMissing(base, [remoteHead, ...remoteState.unverified, ...remoteState.pulls.map((pull) => pull.head)], report);
  await fold(remote, { strict: true }); // with the history here, nothing about a protected branch is left unchecked
  const localHead = (await getRefs(repo.name))[ref];
  const extra = local.slice(shared);
  if (!local.length && localHead !== remoteHead && !(await ancestors(remoteHead)).has(localHead)) {
    throw new Error('refused: this clone has changes that are not in the replica\'s history');
  }
  if (!extra.length) {
    await adoptLog(repo.name, remote, { [ref]: remoteHead });
    return { outcome: 'fast-forward', head: remoteHead, fetched };
  }

  // Both sides moved. Re-issue this device's unpushed records on top of the replica's log.
  const key = await deviceKey();
  if (extra.some((record) => record.key !== key.id)) throw new Error('refused: unpushed records here were signed by another device');
  // Everything this device signed that is not a change to a branch is issued again as it was.
  const steps = extra.filter((record) => (record.type || 'ref') !== 'ref')
    .map(({ repo: _repo, time: _time, key: _key, publicKey: _publicKey, previous: _previous, signature: _signature, ...fields }) => fields);
  const changed = extra.some((record) => (record.type || 'ref') === 'ref');
  let head = remoteHead;
  let outcome = 'fast-forward';
  if (changed && localHead !== remoteHead && !(await ancestors(remoteHead)).has(localHead)) {
    if ((await ancestors(localHead)).has(remoteHead)) {
      head = localHead; // the replica's head is already in our history
      outcome = 'rebased';
    } else {
      const baseCommit = await mergeBase(localHead, remoteHead);
      const tree = (id) => getObject(id).then((envelope) => parseCommit(envelope).tree);
      const context = { conflicts: [], made: [], resolutions: (resolution && resolution.paths) || new Map() };
      const merged = await mergeTrees(baseCommit ? await tree(baseCommit) : null, await tree(localHead), await tree(remoteHead), '', context, true);
      if (context.conflicts.length) {
        return { outcome: 'conflict', conflicts: context.conflicts.map((detail) => detail.path), details: context.conflicts, against: remoteHead, head: localHead, fetched };
      }
      const line = identityLine(who.name || '', who.email || '', Date.now());
      const resolved = context.resolutions.size ? `\n\nConflicts resolved in:\n${[...context.resolutions.keys()].sort().map((path) => `  ${path}`).join('\n')}\n` : '\n';
      const commit = makeCommit({ tree: merged, parents: [remoteHead, localHead], author: line, committer: line, message: `Merge changes made on this device${resolved}` });
      context.made.push(commit);
      await putObjects(context.made);
      head = commit.id;
      outcome = 'merged';
    }
    steps.push({ ref, old: remoteHead, next: head });
  }
  const records = await extend(repo.name, remote, steps);
  await adoptLog(repo.name, records, { [ref]: head });
  return { outcome, head, fetched, reissued: steps.length };
}

// Bring a pull request up to date: merge the branch into the proposed commit and propose the
// result. It is a new commit, so approvals of the old one do not carry over to it.
export async function updatePull({ repo, refs, branch, head, title, who = {} }) {
  const ref = `refs/heads/${branch}`;
  const baseHead = refs[ref];
  if ((await ancestors(head)).has(baseHead)) throw new Error('this pull request is already up to date');
  const baseCommit = await mergeBase(head, baseHead);
  const tree = (id) => getObject(id).then((envelope) => parseCommit(envelope).tree);
  const context = { conflicts: [], made: [], resolutions: new Map() };
  const merged = await mergeTrees(baseCommit ? await tree(baseCommit) : null, await tree(head), await tree(baseHead), '', context, true);
  if (context.conflicts.length) throw new Error(`it conflicts with the branch in: ${context.conflicts.map((detail) => detail.path).join(', ')}`);
  const line = identityLine(who.name || '', who.email || '', Date.now());
  const commit = makeCommit({ tree: merged, parents: [head, baseHead], author: line, committer: line, message: `Bring up to date with ${branch}\n` });
  context.made.push(commit);
  await putObjects(context.made);
  // The same pull request, moved to the new commit: it keeps its number and its discussion.
  await openPull(repo.name, branch, commit.id, title, { follows: head, name: who.name || '' });
  return { id: commit.id };
}
