// A signing key that never leaves this device, and the signed log of every ref it moved.
// The key is ECDSA P-256, generated in the browser as non-extractable.

import { authorize, MODE } from './kernel.js';
import { loadKey, saveKey, appendRefUpdate, listRefUpdates } from './store.js';

const utf8 = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export async function deviceKey() {
  let pair = await loadKey();
  if (!pair) {
    pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
    await saveKey(pair);
  }
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { pair, publicKey: b64(spki), id: await sha256(spki) };
}

// The exact bytes that are signed. One field per line; no field may contain a newline.
function statement(r) {
  const fields = ['holo-git/ref-update/1', r.repo, r.ref, r.old, r.next, String(r.time), r.key, r.previous];
  if (fields.some((field) => /[\n\r]/.test(field))) throw new Error('a ref update field contains a line break');
  return utf8.encode(fields.join('\n'));
}

export const recordDigest = (record) => sha256(utf8.encode(`${new TextDecoder().decode(statement(record))}\n${record.signature}`));

export async function verifyRecord(record) {
  try {
    const spki = unb64(record.publicKey);
    if (await sha256(spki) !== record.key) return false;
    const key = await crypto.subtle.importKey('spki', spki, ECDSA, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, unb64(record.signature), statement(record));
  } catch { return false; }
}

// Move a ref. The update is signed, the signature is checked, the kernel is asked,
// and only then is the ref changed, together with its log entry, in one transaction.
export async function moveRef({ repo, ref, old, next, parents }) {
  if (!parents.includes(old)) throw new Error('refused: not a fast-forward of the current ref');
  const key = await deviceKey();
  const log = await listRefUpdates(repo);
  const record = { repo, ref, old, next, time: Date.now(), key: key.id, publicKey: key.publicKey,
    previous: log.length ? await recordDigest(log[log.length - 1]) : '' };
  record.signature = b64(await crypto.subtle.sign(SIGN, key.pair.privateKey, statement(record)));
  const signed = await verifyRecord(record);
  // The first signer of a repository's log owns it. A fresh clone with no log belongs to this device.
  // Grants from other people arrive in a later phase; until then nobody else's updates count.
  const owner = log.length ? log[0].key : key.id;
  const granted = owner === key.id ? MODE.owner : MODE.none;
  if (!authorize({ signed, revoked: false, live: true, granted, required: MODE.write })) {
    throw new Error(granted === MODE.none ? 'refused by the kernel: this device has no write access to this repository' : 'refused by the kernel: this ref update does not count');
  }
  await appendRefUpdate(record);
  return record;
}

// Every entry must verify and must name the digest of the entry before it.
export async function checkLog(repo) {
  const log = await listRefUpdates(repo);
  let previous = '';
  for (const record of log) {
    if (record.previous !== previous || !(await verifyRecord(record))) return { entries: log.length, valid: false };
    previous = await recordDigest(record);
  }
  return { entries: log.length, valid: true, log };
}
