// Signed records: the exact bytes that are signed, how a record is named, how it is verified.
// The kinds share one chain per repository: a ref update, a grant, a revocation, and the
// protection of a branch or its removal.

const utf8 = new TextEncoder();
const text = new TextDecoder();
export const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
export const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
export const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// One field per line. No field may contain a line break, so no field can pose as another.
export function statement(r) {
  const type = r.type || 'ref';
  let fields;
  if (type === 'ref') fields = ['holo-git/ref-update/1', r.repo, r.ref, r.old, r.next, String(r.time), r.key, r.previous];
  else if (type === 'grant') fields = ['holo-git/grant/1', r.repo, r.subject, r.mode, String(r.notAfter), String(r.time), r.key, r.previous];
  else if (type === 'revoke') fields = ['holo-git/revoke/1', r.repo, r.subject, String(r.time), r.key, r.previous];
  else if (type === 'protect') {
    // The first form had no approvals count; records signed in it must still verify.
    // Earlier forms had no approvals count, then no checks; records signed in them must still verify.
    if (r.approvals === undefined) fields = ['holo-git/protect/1', r.repo, r.ref, r.minimum, String(r.time), r.key, r.previous];
    else if (r.checks === undefined) fields = ['holo-git/protect/2', r.repo, r.ref, r.minimum, String(r.approvals), String(r.time), r.key, r.previous];
    else fields = ['holo-git/protect/3', r.repo, r.ref, r.minimum, String(r.approvals), r.checks, String(r.time), r.key, r.previous];
  } else if (type === 'unprotect') fields = ['holo-git/unprotect/1', r.repo, r.ref, String(r.time), r.key, r.previous];
  else if (type === 'pr') fields = ['holo-git/pull/1', r.repo, r.ref, r.head, r.title, String(r.time), r.key, r.previous];
  else if (type === 'approve') fields = ['holo-git/approve/1', r.repo, r.ref, r.head, String(r.time), r.key, r.previous];
  else if (type === 'check') fields = ['holo-git/check/1', r.repo, r.name, r.action, r.result, String(r.time), r.key, r.previous];
  // A check result that stands on its own, outside any repository's chain: it is bound to the
  // content by its action key, so it means the same wherever it is read.
  // The second form adds the digest of the files the check produced, which other checks' keys rest on.
  else if (type === 'result' && r.output !== undefined) fields = ['holo-git/result/2', r.action, r.name, r.result, r.tools, r.output, String(r.time), r.key];
  else if (type === 'result') fields = ['holo-git/result/1', r.action, r.name, r.result, r.tools, String(r.time), r.key];
  else throw new Error('unknown record type');
  if (fields.some((field) => typeof field !== 'string' || /[\n\r]/.test(field))) throw new Error('a record field is missing or contains a line break');
  return utf8.encode(fields.join('\n'));
}

// A record's name: the SHA-256 of what was signed together with the signature.
export const recordDigest = (record) => sha256(utf8.encode(`${text.decode(statement(record))}\n${record.signature}`));

export async function verifyRecord(record) {
  try {
    const spki = unb64(record.publicKey);
    if (await sha256(spki) !== record.key) return false;
    const key = await crypto.subtle.importKey('spki', spki, ECDSA, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, unb64(record.signature), statement(record));
  } catch { return false; }
}
