// A signing key that never leaves this device, and the records it signs.
// The key is ECDSA P-256, generated in the browser as non-extractable.

import { fold, GRANTABLE } from './log.js';
import { statement, sha256, b64, ECDSA, SIGN } from './records.js';
import { loadKey, saveKey, appendRefUpdate, appendRecord, listRefUpdates } from './store.js';

export async function deviceKey() {
  let pair = await loadKey();
  if (!pair) {
    pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
    await saveKey(pair);
  }
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { pair, publicKey: b64(spki), id: await sha256(spki) };
}

// Sign a new record on top of this repository's log. Nothing is stored unless the whole log,
// with the new record at its end, still folds: signatures hold and the kernel allows every record.
async function signOn(log, repo, fields) {
  const key = await deviceKey();
  const before = await fold(log);
  // The log keeps the name it was started under, whatever this clone is called locally.
  const record = { ...fields, repo: log.length ? log[0].repo : repo, time: Date.now(), key: key.id, publicKey: key.publicKey, previous: before.digest };
  record.signature = b64(await crypto.subtle.sign(SIGN, key.pair.privateKey, statement(record)));
  await fold([...log, record]);
  return record;
}

const sign = async (repo, fields) => signOn(await listRefUpdates(repo), repo, fields);

// Sign a series of records on top of a given log, each on the one before. Used when this
// device's unpushed records are issued again after fetching. Returns the whole new log.
export async function extend(repo, log, steps) {
  const out = [...log];
  for (const fields of steps) out.push(await signOn(out, repo, fields));
  return out;
}

export async function moveRef({ repo, ref, old, next, parents }) {
  if (!parents.includes(old)) throw new Error('refused: not a fast-forward of the current ref');
  const record = await sign(repo, { ref, old, next });
  await appendRefUpdate(repo, record);
  return record;
}

// Give another key access. `days` of 0 means no expiry.
export async function grant(repo, subject, mode, days) {
  subject = subject.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(subject)) throw new Error('a key is 64 hexadecimal characters');
  if (!GRANTABLE.includes(mode)) throw new Error('access can be read or write');
  if ((await deviceKey()).id === subject) throw new Error('that is this device\'s own key');
  const notAfter = days > 0 ? Math.floor(Date.now() / 1000) + Math.round(days * 86400) : 0;
  const record = await sign(repo, { type: 'grant', subject, mode, notAfter });
  await appendRecord(repo, record);
  return record;
}

export async function revoke(repo, subject) {
  const record = await sign(repo, { type: 'revoke', subject });
  await appendRecord(repo, record);
  return record;
}

export async function checkLog(repo) {
  const log = await listRefUpdates(repo);
  try {
    return { entries: log.length, valid: true, state: await fold(log) };
  } catch (error) {
    return { entries: log.length, valid: false, reason: error.message };
  }
}
