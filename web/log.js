// What a repository's log means. Every device and every clone runs this same fold over the
// same records, so they reach the same heads, grants, protections and pull requests, whoever
// stored the records.
//
// The first signer owns the repository. For each record the kernel is asked whether it counts,
// given the signature check and the issuer's grant as it stood at that point in the log. For a
// change to a branch the kernel is also given: whether the branch only moved forward, and how
// many approvals this exact commit has against how many the branch requires.

import { decide, gate, MODE } from './kernel.js';
import { verifyRecord, recordDigest, sha256 } from './records.js';
import { isAncestor } from './ancestry.js';
import { expectedActions } from './evidence.js';
import { isCheckName } from './checks.js';

const KINDS = { ref: 'change', grant: 'grant', revoke: 'revocation', protect: 'protection', unprotect: 'removal of protection', pr: 'pull request', approve: 'approval', check: 'check result',
  review: 'review', 'line-comment': 'comment on a line', resolve: 'resolution of a conversation',
  issue: 'issue', comment: 'comment', 'issue-set': 'change to an issue', label: 'label', 'label-remove': 'removal of a label', milestone: 'milestone' };
const REQUIRED = { grant: MODE.admin, revoke: MODE.admin, protect: MODE.admin, unprotect: MODE.admin, pr: MODE.read, approve: MODE.write, check: MODE.write,
  // Anyone who can read can open an issue and comment. Triage (labels, milestones, assignees, other people's issues) needs write access.
  review: MODE.read, 'line-comment': MODE.read, resolve: MODE.write,
  issue: MODE.read, comment: MODE.read, 'issue-set': MODE.write, label: MODE.write, 'label-remove': MODE.write, milestone: MODE.write };
const ID = /^[0-9a-f]{32}$/;
const TEXT_LIMIT = 65536;
export const ISSUE_FIELDS = ['title', 'body', 'state', 'labels', 'milestone', 'assignees'];
export const GRANTABLE = ['read', 'write'];
// Who may move a protected branch: anyone with write access, or only the owner.
export const PUSHERS = ['write', 'admin'];
const pullKey = (ref, head) => `${ref}\n${head}`;

// With `strict`, a protected branch whose history cannot be checked yet is a refusal. Without it
// (before a clone has fetched any objects) such changes are listed in `unverified`, and the
// caller must fold again, strictly, once the objects are there.
export async function fold(records, { strict = false } = {}) {
  const state = { owner: records.length ? records[0].key : null, heads: {}, grants: new Map(), protections: new Map(), pulls: [], checks: new Map(), digest: '', count: records.length, unverified: [],
    issues: [], labels: new Map(), milestones: [] };
  const pulls = new Map();
  const issues = new Map();
  const milestones = new Map();
  const threads = new Map();
  // Issues and pull requests are both things one can comment on, label and close.
  const discussed = (id) => issues.get(id) || state.pulls.find((pull) => pull.id === id);
  const utf8 = new TextEncoder();
  // A key's standing at a moment: what it could do if it signed something then.
  const standing = (key, now) => {
    if (key === state.owner) return MODE.owner;
    const grant = state.grants.get(key);
    if (!grant || grant.revoked || (grant.notAfter && now > grant.notAfter)) return MODE.none;
    return MODE[grant.mode];
  };
  for (const record of records) {
    const type = record.type || 'ref';
    if (!(type in KINDS)) throw new Error('refused: unknown record type in the log');
    if (record.repo !== records[0].repo) throw new Error('refused: a record signed for another repository is in the log');
    if (record.previous !== state.digest) throw new Error('refused: the log chain is broken');
    const signed = await verifyRecord(record);
    // The issuer's standing: the owner needs no link; anyone else stands on their grant, or on nothing.
    const links = [];
    if (record.key !== state.owner) {
      const grant = state.grants.get(record.key);
      links.push(grant
        ? { scope: MODE[grant.mode], signed: true, revoked: grant.revoked, notAfter: grant.notAfter || null }
        : { scope: MODE.none, signed: true, revoked: false, notAfter: null });
    }
    const now = Math.floor(record.time / 1000);
    let allowed;
    if (type === 'ref') {
      const rule = state.protections.get(record.ref);
      let fastForward = true;
      if (rule) {
        const known = await isAncestor(record.old, record.next);
        if (known === null) {
          if (strict) throw new Error('refused: cannot check that a protected branch only moved forward');
          state.unverified.push(record.next);
        } else fastForward = known;
      }
      // Approvals count only for this exact commit, from keys that can write now, other than the proposer's.
      const pull = pulls.get(pullKey(record.ref, record.next));
      const approvalsHave = pull ? [...pull.approvals].filter((key) => key !== pull.author && standing(key, now) >= MODE.write).length : 0;
      // A required check is satisfied by a passing result under the exact key this change needs,
      // from someone who can write now. The key comes from what the check reads, so a result
      // made for other content with the same inputs counts, and nothing has to run again.
      const required = rule ? rule.checks : [];
      let checksHave = 0;
      if (required.length) {
        const expected = await expectedActions(record.old, record.next, required);
        if (expected === null) {
          if (strict) throw new Error('refused: cannot work out which checks a protected branch needed');
          state.unverified.push(record.next);
          checksHave = required.length;
        } else {
          checksHave = expected.filter((action) => {
            const result = action && state.checks.get(action);
            return result && result.result === 'pass' && standing(result.by, now) >= MODE.write;
          }).length;
        }
      }
      allowed = gate({ signed, required: rule ? MODE[rule.minimum] : MODE.write, links, now, fastForward, forceAllowed: !rule,
        approvalsHave, approvalsNeeded: rule ? rule.approvals : 0, checksHave, checksNeeded: required.length });
    } else {
      let required = REQUIRED[type];
      // The author of an issue may retitle, rewrite, close and reopen it with the access that let them open it.
      if (type === 'issue-set') { const issue = discussed(record.issue); if (issue && issue.author === record.key && ['title', 'body', 'state'].includes(record.field)) required = MODE.read; }
      // An approval is a writer's to give; any other review needs only reading.
      if (type === 'review' && record.verdict === 'approve') required = MODE.write;
      // A conversation may be settled by whoever started it or by the pull request's author, as well as by a writer.
      if (type === 'resolve') { const thread = threads.get(record.thread); if (thread && (thread.key === record.key || thread.pull.author === record.key)) required = MODE.read; }
      allowed = decide({ signed, required, links, now });
    }
    if (!allowed) throw new Error(`refused by the kernel: a ${KINDS[type]} by key ${String(record.key).slice(0, 12)} does not count`);

    if (type === 'ref') {
      if (record.ref in state.heads && record.old !== state.heads[record.ref]) throw new Error('refused: the log skips a ref value');
      state.heads[record.ref] = record.next;
      const pull = pulls.get(pullKey(record.ref, record.next));
      if (pull) pull.merged = true;
    } else if (type === 'grant') {
      if (!GRANTABLE.includes(record.mode) || !/^[0-9a-f]{64}$/.test(record.subject)) throw new Error('refused: a malformed grant in the log');
      state.grants.set(record.subject, { mode: record.mode, notAfter: Number(record.notAfter) || 0, revoked: false, time: record.time });
    } else if (type === 'revoke') {
      const grant = state.grants.get(record.subject);
      if (grant) grant.revoked = true;
    } else if (type === 'protect') {
      const approvals = Number(record.approvals || 0);
      if (!PUSHERS.includes(record.minimum) || !/^refs\/heads\/\S+$/.test(record.ref) || !Number.isInteger(approvals) || approvals < 0 || approvals > 200) throw new Error('refused: a malformed protection in the log');
      const checks = record.checks ? String(record.checks).split(',') : [];
      if (checks.length > 50 || !checks.every(isCheckName) || new Set(checks).size !== checks.length) throw new Error('refused: a malformed protection in the log');
      state.protections.set(record.ref, { minimum: record.minimum, approvals, checks, time: record.time });
    } else if (type === 'unprotect') state.protections.delete(record.ref);
    else if (type === 'pr') {
      if (!/^refs\/heads\/\S+$/.test(record.ref) || !/^[0-9a-f]{40}$/.test(record.head) || !record.title || record.title.length > 200) throw new Error('refused: a malformed pull request in the log');
      const at = Number(record.at) || record.time;
      const earlier = record.follows ? pulls.get(pullKey(record.ref, record.follows)) : null;
      if (earlier && !earlier.merged && earlier.author === record.key && !pulls.has(pullKey(record.ref, record.head))) {
        // The same pull request, moved to a new commit by its author. It keeps its number and its discussion; approvals were for the old commit and do not carry over.
        pulls.delete(pullKey(record.ref, record.follows));
        earlier.events.push({ kind: 'head', key: record.key, name: record.name || '', time: at, from: earlier.head, to: record.head });
        earlier.head = record.head;
        earlier.approvals = new Set();
        earlier.updated = at;
        pulls.set(pullKey(record.ref, record.head), earlier);
      } else if (!pulls.has(pullKey(record.ref, record.head))) {
        if (String(record.body || '').length > TEXT_LIMIT) throw new Error('refused: a malformed pull request in the log');
        // Issues and pull requests share one run of numbers, as on any git host.
        // A pull request is named, for its discussion, by where it started: the branch and the first commit proposed.
        const pull = { id: (await sha256(utf8.encode(`${record.ref}\n${record.head}`))).slice(0, 32), number: state.pulls.length + state.issues.length + 1, ref: record.ref, head: record.head, first: record.head, title: record.title, body: String(record.body || ''), author: record.key, name: record.name || '', time: at, updated: at,
          approvals: new Set(), changes: new Set(), merged: false, state: 'open', labels: [], milestone: '', assignees: [], events: [], threads: [], comments: 0 };
        pulls.set(pullKey(record.ref, record.head), pull);
        state.pulls.push(pull);
      }
    } else if (type === 'approve') {
      const pull = pulls.get(pullKey(record.ref, record.head));
      if (!pull) throw new Error('refused: an approval of no pull request is in the log');
      pull.approvals.add(record.key);
      pull.changes.delete(record.key);
      pull.events.push({ kind: 'review', verdict: 'approve', key: record.key, name: '', time: record.time, body: '', head: record.head });
    } else if (type === 'review') {
      const pull = discussed(record.pull);
      if (!pull || !pull.threads || !/^[0-9a-f]{40}$/.test(record.head) || !['comment', 'approve', 'changes'].includes(record.verdict) || String(record.body).length > TEXT_LIMIT) throw new Error('refused: a malformed review in the log');
      const at = Number(record.at) || record.time;
      // An approval is for exactly the commit it names. One given for an earlier commit is kept in the history and does not count.
      if (record.verdict === 'approve' && record.head === pull.head) { pull.approvals.add(record.key); pull.changes.delete(record.key); }
      if (record.verdict === 'changes' && record.head === pull.head) { pull.changes.add(record.key); pull.approvals.delete(record.key); }
      pull.events.push({ kind: 'review', verdict: record.verdict, key: record.key, name: record.name, time: at, body: String(record.body), head: record.head });
      pull.updated = at;
    } else if (type === 'line-comment') {
      const pull = discussed(record.pull);
      const line = Number(record.line);
      const parent = record.reply ? threads.get(record.reply) : null;
      if (!pull || !pull.threads || !ID.test(record.id) || threads.has(record.id) || !String(record.body).trim() || String(record.body).length > TEXT_LIMIT || (record.reply && (!parent || parent.pull !== pull))
        || (!record.reply && (!record.path || String(record.path).length > 4096 || !['old', 'new'].includes(record.side) || !Number.isInteger(line) || line < 1 || !/^[0-9a-f]{40}$/.test(record.head)))) throw new Error('refused: a malformed comment on a line in the log');
      const at = Number(record.at) || record.time;
      const entry = { id: record.id, key: record.key, name: record.name, time: at, body: String(record.body) };
      if (parent) parent.replies.push(entry);
      else { const thread = { ...entry, pull, head: record.head, path: String(record.path), side: record.side, line, resolved: false, replies: [] }; threads.set(record.id, thread); pull.threads.push(thread); }
      pull.comments += 1;
      pull.updated = at;
    } else if (type === 'resolve') {
      const thread = threads.get(record.thread);
      if (!thread || !['1', '0'].includes(record.resolved)) throw new Error('refused: a malformed resolution in the log');
      thread.resolved = record.resolved === '1';
      thread.resolvedBy = { key: record.key, name: record.name };
    } else if (type === 'issue') {
      if (!ID.test(record.id) || issues.has(record.id) || !record.title || record.title.length > 200 || String(record.body).length > TEXT_LIMIT || String(record.name).length > 100) throw new Error('refused: a malformed issue in the log');
      const at = Number(record.at) || record.time;
      const issue = { id: record.id, number: state.pulls.length + state.issues.length + 1, title: record.title, body: String(record.body), author: record.key, name: record.name, time: at, updated: at, state: 'open', labels: [], milestone: '', assignees: [], events: [], comments: 0 };
      issues.set(record.id, issue);
      state.issues.push(issue);
    } else if (type === 'comment') {
      const issue = discussed(record.issue);
      if (!issue || !String(record.body).trim() || String(record.body).length > TEXT_LIMIT) throw new Error('refused: a malformed comment in the log');
      const at = Number(record.at) || record.time;
      issue.events.push({ kind: 'comment', key: record.key, name: record.name, time: at, body: String(record.body) });
      issue.comments += 1;
      issue.updated = at;
    } else if (type === 'issue-set') {
      const issue = discussed(record.issue);
      const value = String(record.value);
      if (!issue || !ISSUE_FIELDS.includes(record.field)) throw new Error('refused: a malformed change to an issue in the log');
      const at = Number(record.at) || record.time;
      const event = { kind: record.field, key: record.key, name: record.name, time: at };
      if (record.field === 'title') { if (!value || value.length > 200) throw new Error('refused: a malformed change to an issue in the log'); event.from = issue.title; event.to = value; issue.title = value; }
      else if (record.field === 'body') { if (value.length > TEXT_LIMIT) throw new Error('refused: a malformed change to an issue in the log'); issue.body = value; issue.edited = at; }
      else if (record.field === 'state') { if (!['open', 'closed'].includes(value)) throw new Error('refused: a malformed change to an issue in the log'); event.to = value; issue.state = value; }
      else if (record.field === 'labels') { const next = value ? value.split(',').filter((name) => state.labels.has(name)) : []; event.added = next.filter((n) => !issue.labels.includes(n)); event.removed = issue.labels.filter((n) => !next.includes(n)); issue.labels = next; }
      else if (record.field === 'milestone') { if (value && !milestones.has(value)) throw new Error('refused: a malformed change to an issue in the log'); event.from = issue.milestone; event.to = value; issue.milestone = value; }
      else { const next = value ? value.split(',') : []; if (next.length > 10 || !next.every((key) => /^[0-9a-f]{64}$/.test(key))) throw new Error('refused: a malformed change to an issue in the log'); event.added = next.filter((k) => !issue.assignees.includes(k)); event.removed = issue.assignees.filter((k) => !next.includes(k)); issue.assignees = next; }
      if (record.field !== 'body') issue.events.push(event);
      issue.updated = at;
    } else if (type === 'label') {
      if (!record.name || record.name.length > 50 || /[,\n\r]/.test(record.name) || !/^[0-9a-f]{6}$/.test(record.color) || String(record.description).length > 200) throw new Error('refused: a malformed label in the log');
      state.labels.set(record.name, { color: record.color, description: String(record.description) });
    } else if (type === 'label-remove') {
      state.labels.delete(record.name);
      for (const issue of state.issues) issue.labels = issue.labels.filter((name) => name !== record.name);
    } else if (type === 'milestone') {
      if (!ID.test(record.id) || !record.title || record.title.length > 100 || String(record.description).length > 2000 || !/^(\d{4}-\d{2}-\d{2})?$/.test(record.due) || !['open', 'closed'].includes(record.state)) throw new Error('refused: a malformed milestone in the log');
      const known = milestones.get(record.id);
      const next = { id: record.id, title: record.title, description: String(record.description), due: record.due, state: record.state, time: known ? known.time : record.time };
      if (known) Object.assign(known, next); else { milestones.set(record.id, next); state.milestones.push(next); }
    } else {
      if (!isCheckName(record.name) || !/^[0-9a-f]{64}$/.test(record.action) || !['pass', 'fail'].includes(record.result)) throw new Error('refused: a malformed check result in the log');
      // The latest result under a key stands. An earlier one is still in the log for anyone to see.
      const earlier = state.checks.get(record.action);
      state.checks.set(record.action, { name: record.name, result: record.result, by: record.key, time: record.time, changed: Boolean(earlier && earlier.result !== record.result) || Boolean(earlier && earlier.changed) });
    }
    state.digest = await recordDigest(record);
  }
  // For each pull request, how many of its approvals would count if it were merged now.
  const present = Math.floor(Date.now() / 1000);
  for (const pull of state.pulls) {
    pull.counted = [...pull.approvals].filter((key) => key !== pull.author && standing(key, present) >= MODE.write).length;
    pull.needed = (state.protections.get(pull.ref) || { approvals: 0 }).approvals;
  }
  return state;
}
