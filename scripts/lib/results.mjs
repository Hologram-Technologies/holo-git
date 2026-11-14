// Check results that travel: signed by the machine that ran the check, kept in a shared store,
// and accepted only from signers the reader was told to trust.
//
// A result is bound to content by its action key, so it cannot be passed off as a result for
// anything else. What a signature adds is who vouches for it. A reader accepts a result from the
// store when all of these hold:
//   - the signature verifies, and the signing key is this machine's own or on the signers list;
//   - the record names the action key and the check it was asked about;
//   - it was made with tools that print what the reader's tools print.
// Anything else is ignored and the check runs here. A store that is unreachable, or that someone
// filled with rubbish, costs time, never a wrong pass.
//
// What this does not do: stop a trusted signer from signing a pass for content that fails. The
// signers list is a statement of trust in those machines, and should be short.
//
// Store layout, over plain GET and PUT (the stand-in store, or any S3-compatible one):
//   results/<action key>/<signer key>.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ECDSA, SIGN, b64, sha256, statement, unb64, verifyRecord } from '../../web/records.js';
import { signS3 } from '../../web/s3sign.js';

export const SIGNERS_PATH = '.holo/signers.json';
const KEY = /^[0-9a-f]{64}$/;

// This machine's signing key, made on first use. Whoever has the file can sign as this machine.
export async function machineKey(file) {
  let saved;
  if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8'));
  else {
    const fresh = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
    saved = { privateKey: await crypto.subtle.exportKey('jwk', fresh.privateKey), publicKey: await crypto.subtle.exportKey('jwk', fresh.publicKey) };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  }
  const privateKey = await crypto.subtle.importKey('jwk', saved.privateKey, ECDSA, false, ['sign']);
  const spki = await crypto.subtle.exportKey('spki', await crypto.subtle.importKey('jwk', saved.publicKey, ECDSA, true, ['verify']));
  return { id: await sha256(spki), publicKey: b64(spki), privateKey };
}

// Read a signers list. Anything malformed is an error: a list that cannot be read trusts no one.
export function parseSigners(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.signers)) throw new Error('signers file: expected { "signers": [...] }');
  const signers = new Map();
  for (const signer of data.signers) {
    if (!signer || !KEY.test(signer.key)) throw new Error('signers file: a signer needs a key of 64 hex digits');
    if (typeof signer.name !== 'string' || !signer.name.trim() || /[\n\r]/.test(signer.name)) throw new Error('signers file: a signer needs a name');
    signers.set(signer.key, signer.name.trim());
  }
  return signers;
}

export async function sign(key, { action, name, result, tools, seconds, commit }) {
  const record = { type: 'result', action, name, result, tools: JSON.stringify(tools), time: Date.now(), key: key.id, publicKey: key.publicKey, seconds, commit };
  record.signature = b64(await crypto.subtle.sign(SIGN, key.privateKey, statement(record)));
  return record;
}

// Is this a result for that action and check, signed by a key in `trusted`?
export async function acceptable(record, action, name, trusted) {
  if (!record || record.type !== 'result' || record.action !== action || record.name !== name) return false;
  if (record.result !== 'pass' && record.result !== 'fail') return false;
  if (typeof record.tools !== 'string' || !trusted.has(record.key)) return false;
  try { unb64(record.signature); JSON.parse(record.tools); } catch { return false; }
  return verifyRecord(record);
}

// A store, or null when none was named. Requests are signed when keys are in the environment.
export function openStore(url, env = process.env) {
  if (!url) return null;
  const base = url.replace(/\/+$/, '');
  const keys = env.HOLO_S3_ACCESS_KEY && env.HOLO_S3_SECRET_KEY ? { accessKey: env.HOLO_S3_ACCESS_KEY, secretKey: env.HOLO_S3_SECRET_KEY, region: env.HOLO_S3_REGION || 'us-east-1' } : null;
  const request = async (method, path, body) => {
    const target = `${base}/${path}`;
    let headers = body ? { 'content-type': 'application/json' } : {};
    if (keys) headers = await signS3({ method, url: target, headers, body }, keys);
    return fetch(target, { method, headers, body, signal: AbortSignal.timeout(15000) });
  };
  const path = (action, signer) => `results/${action}/${signer}.json`;
  return {
    base,
    // The first acceptable result from any trusted signer, or null. Never throws: a store that
    // cannot be reached means the check runs here.
    async find(action, name, trusted) {
      const found = await Promise.all([...trusted.keys()].map(async (signer) => {
        try {
          const response = await request('GET', path(action, signer));
          if (!response.ok) return null;
          const record = JSON.parse(await response.text());
          return record.key === signer && await acceptable(record, action, name, trusted) ? record : null;
        } catch { return null; }
      }));
      return found.find(Boolean) || null;
    },
    // Returns null on success, or why it could not be written.
    async publish(record) {
      try {
        const response = await request('PUT', path(record.action, record.key), JSON.stringify(record));
        return response.ok ? null : `the store answered ${response.status}`;
      } catch (error) { return error.message; }
    },
    async has(action, signer) {
      try { return (await request('GET', path(action, signer))).ok; } catch { return true; }
    },
  };
}
