// The device store. Objects are keyed by their kappa label, `sha1:<hex>`, and hold the
// loose-object envelope: the same bytes a kappa peer stores under the same label.
// Every read re-derives the label and refuses bytes that do not match it.

import { labelOf } from './engine.js';

let db;
export const stats = { read: 0, refused: 0 };

export function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('holo-git', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('objects');
      request.result.createObjectStore('refs');
      request.result.createObjectStore('repos');
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
  if (labelOf(envelope) !== id) {
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
