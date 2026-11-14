// A signing key that never leaves this device, and the records it signs.
// The key is ECDSA P-256, generated in the browser as non-extractable.

import { fold, GRANTABLE, PUSHERS } from './log.js';
import { isCheckName } from './checks.js';
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
  await fold([...log, record], { strict: true });
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

// Protect a branch: it can then only move forward, and only for those `minimum` names
// ('write': anyone with write access; 'admin': the owner alone).
export async function protect(repo, branch, minimum, approvals = 0, checks = []) {
  if (!PUSHERS.includes(minimum)) throw new Error('a protected branch is open to writers or to the owner only');
  if (!Number.isInteger(approvals) || approvals < 0 || approvals > 200) throw new Error('required approvals must be a whole number from 0 to 200');
  if (!checks.every(isCheckName)) throw new Error('a check name is lower-case letters, digits and hyphens');
  const record = await sign(repo, { type: 'protect', ref: `refs/heads/${branch}`, minimum, approvals, checks: [...new Set(checks)].sort().join(',') });
  await appendRecord(repo, record);
  return record;
}

export async function unprotect(repo, branch) {
  const record = await sign(repo, { type: 'unprotect', ref: `refs/heads/${branch}` });
  await appendRecord(repo, record);
  return record;
}

// Propose a commit for a branch. Anyone with read access can; it changes nothing by itself.
export async function openPull(repo, branch, head, title) {
  title = title.replace(/[\n\r]/g, ' ').trim().slice(0, 200);
  if (!title) throw new Error('a pull request needs a title');
  const record = await sign(repo, { type: 'pr', ref: `refs/heads/${branch}`, head, title });
  await appendRecord(repo, record);
  return record;
}

// Approve exactly this commit for this branch. An approval says nothing about any other commit.
export async function approve(repo, branch, head) {
  const record = await sign(repo, { type: 'approve', ref: `refs/heads/${branch}`, head });
  await appendRecord(repo, record);
  return record;
}

// Publish the result of a check. `action` is the key of what was checked (see checks.js).
export async function recordCheck(repo, name, action, result) {
  const record = await sign(repo, { type: 'check', name, action, result });
  await appendRecord(repo, record);
  return record;
}

// Issues. Each is a signed record on the repository's log, judged by the kernel like every other:
// reading is enough to open an issue or comment; triage needs write access.
const freshId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const add = async (repo, fields) => { const record = await sign(repo, fields); await appendRecord(repo, record); return record; };

export async function openIssue(repo, { title, body = '', name }) {
  title = String(title).replace(/[\n\r]/g, ' ').trim().slice(0, 200);
  if (!title) throw new Error('an issue needs a title');
  const id = freshId();
  await add(repo, { type: 'issue', id, title, body: String(body), name: String(name || ''), at: Date.now() });
  return id;
}
export async function addComment(repo, issue, { body, name }) {
  if (!String(body).trim()) throw new Error('a comment needs some text');
  return add(repo, { type: 'comment', issue, body: String(body), name: String(name || ''), at: Date.now() });
}
// field: title, body, state, labels, milestone or assignees. Lists are given as arrays.
export async function setIssue(repo, issue, field, value, name) {
  return add(repo, { type: 'issue-set', issue, field, value: Array.isArray(value) ? value.join(',') : String(value), name: String(name || ''), at: Date.now() });
}
export async function saveLabel(repo, { name, color, description = '' }) {
  name = String(name).trim();
  if (!name || name.length > 50 || /[,\n\r]/.test(name)) throw new Error('a label name is 1 to 50 characters without commas');
  if (!/^#?[0-9a-fA-F]{6}$/.test(color)) throw new Error('a label colour is six hexadecimal digits');
  return add(repo, { type: 'label', name, color: color.replace('#', '').toLowerCase(), description: String(description).slice(0, 200) });
}
export const removeLabel = (repo, name) => add(repo, { type: 'label-remove', name });
export async function saveMilestone(repo, { id, title, description = '', due = '', state = 'open' }) {
  title = String(title).replace(/[\n\r]/g, ' ').trim().slice(0, 100);
  if (!title) throw new Error('a milestone needs a title');
  const milestone = id || freshId();
  await add(repo, { type: 'milestone', id: milestone, title, description: String(description).slice(0, 2000), due, state });
  return milestone;
}
