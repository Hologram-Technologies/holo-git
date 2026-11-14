// Signed records: the exact bytes that are signed, how a record is named, how it is verified.
// The kinds share one chain per repository: a ref update, a grant, a revocation, the protection of a
// branch or its removal, pull requests and approvals, check results, and issues with their comments,
// labels and milestones.

const utf8 = new TextEncoder();
const text = new TextDecoder();
export const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
export const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
export const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
export const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// Free text (an issue's body, a comment) may hold line breaks. It is signed in its JSON string form, which has none.
const J = (value) => JSON.stringify(String(value));

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
  // The second form of a pull request adds a description, the proposer's name, and `follows`: the commit this one replaces when a pull request is updated.
  else if (type === 'pr' && r.follows !== undefined) fields = ['holo-git/pull/2', r.repo, r.ref, r.head, r.title, r.follows, J(r.body), r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'pr') fields = ['holo-git/pull/1', r.repo, r.ref, r.head, r.title, String(r.time), r.key, r.previous];
  else if (type === 'review') fields = ['holo-git/review/1', r.repo, r.pull, r.head, r.verdict, J(r.body), r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'line-comment') fields = ['holo-git/line-comment/1', r.repo, r.id, r.pull, r.head, J(r.path), r.side, String(r.line), r.reply, J(r.body), r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'resolve') fields = ['holo-git/resolve/1', r.repo, r.thread, r.resolved, r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'approve') fields = ['holo-git/approve/1', r.repo, r.ref, r.head, String(r.time), r.key, r.previous];
  else if (type === 'check') fields = ['holo-git/check/1', r.repo, r.name, r.action, r.result, String(r.time), r.key, r.previous];
  // An issue is named by an identifier chosen when it is written, not by its number: the number is its place
  // in the log, which can change until the issue is published. `at` is when it was first written; `time` is when it was last signed.
  else if (type === 'issue') fields = ['holo-git/issue/1', r.repo, r.id, r.title, J(r.body), r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'comment') fields = ['holo-git/comment/1', r.repo, r.issue, J(r.body), r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'issue-set') fields = ['holo-git/issue-set/1', r.repo, r.issue, r.field, J(r.value), r.name, String(r.at), String(r.time), r.key, r.previous];
  else if (type === 'label') fields = ['holo-git/label/1', r.repo, r.name, r.color, J(r.description), String(r.time), r.key, r.previous];
  else if (type === 'label-remove') fields = ['holo-git/label-remove/1', r.repo, r.name, String(r.time), r.key, r.previous];
  else if (type === 'milestone') fields = ['holo-git/milestone/1', r.repo, r.id, r.title, J(r.description), r.due, r.state, String(r.time), r.key, r.previous];
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
