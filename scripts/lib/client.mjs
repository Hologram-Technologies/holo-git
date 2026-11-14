// The page's own modules, loaded in Node, with a key kept in a file.
//
// The commands in scripts/ are not a second implementation. They run the code the browser runs:
// the same engine, the same kernel, the same fold over the signed log. Only two things differ.
// Storage is in memory, filled by cloning the replica at the start of each command. And the
// signing key is a file, because a command has no browser to keep a non-extractable key in.
// Keep that file out of version control: whoever has it can sign as this machine.

import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
export const engine = await import('../../web/engine.js');
export const kernel = await import('../../web/kernel.js');
export const store = await import('../../web/store.js');
export const gitjs = await import('../../web/git.js');
export const identity = await import('../../web/identity.js');
export const replica = await import('../../web/replica.js');
export const sync = await import('../../web/sync.js');
export const { expectedActions } = await import('../../web/evidence.js');
export const { parseChecks, CHECKS_PATH } = await import('../../web/checks.js');
export const { isAncestor } = await import('../../web/ancestry.js');

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };

// Load the engine, the kernel and this machine's key. Returns the key's identifier.
export async function boot(keyFile) {
  await engine.loadEngine(readFileSync(join(web, 'engine.wasm')));
  await kernel.loadKernel(readFileSync(join(web, 'kernel.wasm')));
  await store.openStore();
  let saved;
  if (existsSync(keyFile)) saved = JSON.parse(readFileSync(keyFile, 'utf8'));
  else {
    const fresh = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
    saved = { privateKey: await crypto.subtle.exportKey('jwk', fresh.privateKey), publicKey: await crypto.subtle.exportKey('jwk', fresh.publicKey) };
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, JSON.stringify(saved), { mode: 0o600 });
  }
  await store.saveKey({
    privateKey: await crypto.subtle.importKey('jwk', saved.privateKey, ECDSA, false, ['sign']),
    publicKey: await crypto.subtle.importKey('jwk', saved.publicKey, ECDSA, true, ['verify']),
  });
  return (await identity.deviceKey()).id;
}

// Keys for a store that needs signed requests come from the environment, never from a file here.
export function useStoreKeys(url) {
  if (process.env.HOLO_S3_ACCESS_KEY && process.env.HOLO_S3_SECRET_KEY) {
    replica.setCredentials(url, { accessKey: process.env.HOLO_S3_ACCESS_KEY, secretKey: process.env.HOLO_S3_SECRET_KEY, region: process.env.HOLO_S3_REGION || 'us-east-1' });
  }
}
