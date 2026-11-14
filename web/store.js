// The device store. Objects are keyed by their kappa label, `sha1:<hex>`, and hold the
// loose-object envelope: the same bytes a kappa peer stores under the same label.
// Every read re-derives the label and refuses bytes that do not match it.

import { labelOf } from './engine.js';
import { sameLabel } from './kernel.js';

let db;
export const stats = { read: 0, refused: 0 };

export function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('holo-git', 2);
    request.onupgradeneeded = () => {
      const have = request.result.objectStoreNames;
      for (const name of ['objects', 'refs', 'repos', 'keys']) if (!have.contains(name)) request.result.createObjectStore(name);
      if (!have.contains('reflog')) request.result.createObjectStore('reflog', { autoIncrement: true });
    };
    request.onsuccess = () => { db = request.result; resolve(); };
    request.onerror = () => reject(request.error);
  });
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(tx.error);
});
const ask = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const label = (id) => `sha1:${id}`;

export async function putObjects(objects) {
  const tx = db.transaction('objects', 'readwrite');
  const store = tx.objectStore('objects');
  for (const { id, envelope } of objects) store.put(envelope.slice(), label(id));
  await done(tx);
}

export async function hasObject(id) {
  return (await ask(db.transaction('objects').objectStore('objects').count(label(id)))) > 0;
}

// Returns the envelope, or throws if it is absent or its bytes no longer match the label.
export async function getObject(id) {
  const envelope = await ask(db.transaction('objects').objectStore('objects').get(label(id)));
  if (!envelope) throw new Error(`object ${id} is not in the store`);
  stats.read += 1;
  // The engine computes the label the bytes have; the proved kernel decides whether it is the one asked for.
  if (!sameLabel(id, labelOf(envelope))) {
    stats.refused += 1;
    throw new Error(`object ${id} refused: stored bytes do not match their label`);
  }
  return envelope;
}

export async function countObjects() {
  return ask(db.transaction('objects').objectStore('objects').count());
}

export async function putRepo(repo, refs) {
  const tx = db.transaction(['repos', 'refs'], 'readwrite');
  tx.objectStore('repos').put(repo, repo.name);
  tx.objectStore('refs').put(refs, repo.name);
  await done(tx);
}

export const getRepo = (name) => ask(db.transaction('repos').objectStore('repos').get(name));
export const getRefs = (name) => ask(db.transaction('refs').objectStore('refs').get(name));
export const listRepos = () => ask(db.transaction('repos').objectStore('repos').getAll());

// Test hook: overwrite one stored object's bytes without changing its key.
export async function corruptObject(id) {
  const tx = db.transaction('objects', 'readwrite');
  const store = tx.objectStore('objects');
  const envelope = await ask(store.get(label(id)));
  const damaged = envelope.slice();
  damaged[damaged.length - 1] ^= 1;
  store.put(damaged, label(id));
  await done(tx);
}

export const loadKey = () => ask(db.transaction('keys').objectStore('keys').get('device'));
export async function saveKey(pair) {
  const tx = db.transaction('keys', 'readwrite');
  tx.objectStore('keys').put(pair, 'device');
  await done(tx);
}

export async function listRefUpdates(repo) {
  const all = await ask(db.transaction('reflog').objectStore('reflog').getAll());
  return all.filter((record) => record.repo === repo);
}

// Compare-and-swap: the ref moves only if it still holds the value the update was signed against.
export async function appendRefUpdate(record) {
  const tx = db.transaction(['refs', 'reflog'], 'readwrite');
  const refs = await ask(tx.objectStore('refs').get(record.repo));
  if (!refs || refs[record.ref] !== record.old) {
    tx.abort();
    throw new Error('refused: the ref changed since this update was prepared');
  }
  refs[record.ref] = record.next;
  tx.objectStore('refs').put(refs, record.repo);
  tx.objectStore('reflog').add(record);
  await done(tx);
}
