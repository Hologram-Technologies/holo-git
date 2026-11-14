// What a repository's log means. Every device and every clone runs this same fold over the
// same records, so they reach the same heads, grants and protections, whoever stored the records.
//
// The first signer owns the repository. For each record the kernel is asked whether it counts,
// given the signature check, the issuer's grant as it stood at that point in the log, and, for a
// change to a protected branch, whether the branch only moved forward.

import { decide, refUpdate, MODE } from './kernel.js';
import { verifyRecord, recordDigest } from './records.js';
import { isAncestor } from './ancestry.js';

const KINDS = { ref: 'change', grant: 'grant', revoke: 'revocation', protect: 'protection', unprotect: 'removal of protection' };
export const GRANTABLE = ['read', 'write'];
// Who may move a protected branch: anyone with write access, or only the owner.
export const PUSHERS = ['write', 'admin'];

// With `strict`, a protected branch whose history cannot be checked yet is a refusal. Without it
// (before a clone has fetched any objects) such changes are listed in `unverified`, and the
// caller must fold again, strictly, once the objects are there.
export async function fold(records, { strict = false } = {}) {
  const state = { owner: records.length ? records[0].key : null, heads: {}, grants: new Map(), protections: new Map(), digest: '', count: records.length, unverified: [] };
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
      allowed = refUpdate({ signed, required: rule ? MODE[rule.minimum] : MODE.write, links, now, fastForward, forceAllowed: !rule });
    } else allowed = decide({ signed, required: MODE.admin, links, now });
    if (!allowed) throw new Error(`refused by the kernel: a ${KINDS[type]} by key ${String(record.key).slice(0, 12)} does not count`);

    if (type === 'ref') {
      if (record.ref in state.heads && record.old !== state.heads[record.ref]) throw new Error('refused: the log skips a ref value');
      state.heads[record.ref] = record.next;
    } else if (type === 'grant') {
      if (!GRANTABLE.includes(record.mode) || !/^[0-9a-f]{64}$/.test(record.subject)) throw new Error('refused: a malformed grant in the log');
      state.grants.set(record.subject, { mode: record.mode, notAfter: Number(record.notAfter) || 0, revoked: false, time: record.time });
    } else if (type === 'revoke') {
      const grant = state.grants.get(record.subject);
      if (grant) grant.revoked = true;
    } else if (type === 'protect') {
      if (!PUSHERS.includes(record.minimum) || !/^refs\/heads\/\S+$/.test(record.ref)) throw new Error('refused: a malformed protection in the log');
      state.protections.set(record.ref, { minimum: record.minimum, time: record.time });
    } else state.protections.delete(record.ref);
    state.digest = await recordDigest(record);
  }
  return state;
}
