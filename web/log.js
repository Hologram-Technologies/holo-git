// What a repository's log means. Every device and every clone runs this same fold over the
// same records, so they reach the same heads and the same grants, whoever stored the records.
//
// The first signer owns the repository. For each record the kernel is asked whether it counts,
// given the signature check and the issuer's grant as it stood at that point in the log.

import { decide, MODE } from './kernel.js';
import { verifyRecord, recordDigest } from './records.js';

const REQUIRED = { ref: MODE.write, grant: MODE.admin, revoke: MODE.admin };
export const GRANTABLE = ['read', 'write'];

export async function fold(records) {
  const state = { owner: records.length ? records[0].key : null, heads: {}, grants: new Map(), digest: '', count: records.length };
  for (const record of records) {
    const type = record.type || 'ref';
    if (!(type in REQUIRED)) throw new Error('refused: unknown record type in the log');
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
    if (!decide({ signed, required: REQUIRED[type], links, now: Math.floor(record.time / 1000) })) {
      const what = { ref: 'change', grant: 'grant', revoke: 'revocation' }[type];
      throw new Error(`refused by the kernel: a ${what} by key ${String(record.key).slice(0, 12)} does not count`);
    }
    if (type === 'ref') {
      if (record.ref in state.heads && record.old !== state.heads[record.ref]) throw new Error('refused: the log skips a ref value');
      state.heads[record.ref] = record.next;
    } else if (type === 'grant') {
      if (!GRANTABLE.includes(record.mode) || !/^[0-9a-f]{64}$/.test(record.subject)) throw new Error('refused: a malformed grant in the log');
      state.grants.set(record.subject, { mode: record.mode, notAfter: Number(record.notAfter) || 0, revoked: false, time: record.time });
    } else {
      const grant = state.grants.get(record.subject);
      if (grant) grant.revoked = true;
    }
    state.digest = await recordDigest(record);
  }
  return state;
}
