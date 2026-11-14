// What a repository's log means. Every device and every clone runs this same fold over the
// same records, so they reach the same heads, grants, protections and pull requests, whoever
// stored the records.
//
// The first signer owns the repository. For each record the kernel is asked whether it counts,
// given the signature check and the issuer's grant as it stood at that point in the log. For a
// change to a branch the kernel is also given: whether the branch only moved forward, and how
// many approvals this exact commit has against how many the branch requires.

import { decide, gate, MODE } from './kernel.js';
import { verifyRecord, recordDigest } from './records.js';
import { isAncestor } from './ancestry.js';
import { expectedActions } from './evidence.js';
import { isCheckName } from './checks.js';

const KINDS = { ref: 'change', grant: 'grant', revoke: 'revocation', protect: 'protection', unprotect: 'removal of protection', pr: 'pull request', approve: 'approval', check: 'check result' };
const REQUIRED = { grant: MODE.admin, revoke: MODE.admin, protect: MODE.admin, unprotect: MODE.admin, pr: MODE.read, approve: MODE.write, check: MODE.write };
export const GRANTABLE = ['read', 'write'];
// Who may move a protected branch: anyone with write access, or only the owner.
export const PUSHERS = ['write', 'admin'];
const pullKey = (ref, head) => `${ref}\n${head}`;

// With `strict`, a protected branch whose history cannot be checked yet is a refusal. Without it
// (before a clone has fetched any objects) such changes are listed in `unverified`, and the
// caller must fold again, strictly, once the objects are there.
export async function fold(records, { strict = false } = {}) {
  const state = { owner: records.length ? records[0].key : null, heads: {}, grants: new Map(), protections: new Map(), pulls: [], checks: new Map(), digest: '', count: records.length, unverified: [] };
  const pulls = new Map();
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
    } else allowed = decide({ signed, required: REQUIRED[type], links, now });
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
      if (!pulls.has(pullKey(record.ref, record.head))) {
        // A pull request's number is its place among pull requests in the log, the same for everyone.
        const pull = { number: state.pulls.length + 1, ref: record.ref, head: record.head, title: record.title, author: record.key, time: record.time, approvals: new Set(), merged: false };
        pulls.set(pullKey(record.ref, record.head), pull);
        state.pulls.push(pull);
      }
    } else if (type === 'approve') {
      const pull = pulls.get(pullKey(record.ref, record.head));
      if (!pull) throw new Error('refused: an approval of no pull request is in the log');
      pull.approvals.add(record.key);
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
