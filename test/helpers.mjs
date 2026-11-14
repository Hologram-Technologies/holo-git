// Test support: a real git repository to clone, a static file server (a read-only replica),
// the stand-in object store (a writable replica), and separate "devices".
//
// The page's own modules run here unchanged. Only the browser's storage is replaced:
// IndexedDB by fake-indexeddb, one fresh database per device.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNet } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = [];
export function scratch(name) {
  const dir = mkdtempSync(join(tmpdir(), `holo-git-${name}-`));
  temporary.push(dir);
  return dir;
}
export function cleanup() {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
export function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Seed', '-c', 'user.email=seed@example.org', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    { cwd: dir, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A small repository with history worth testing: a subdirectory, edits, an added and a removed file.
export function makeFixture() {
  const work = scratch('work');
  git(work, 'init', '-q', '-b', 'main');
  const write = (path, text) => { mkdirSync(dirname(join(work, path)), { recursive: true }); writeFileSync(join(work, path), text); };
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  write('README.md', '# Fixture\n\nA repository for tests.\n');
  write('docs/notes.txt', `${lines.join('\n')}\n`);
  write('src/old.txt', 'to be removed\n');
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'first');
  lines[4] = 'line five, changed'; lines.splice(10, 0, 'an inserted line');
  write('docs/notes.txt', `${lines.join('\n')}\n`);
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'second');
  lines.splice(20, 2); lines.push('a line at the end');
  write('docs/notes.txt', `${lines.join('\n')}\n`);
  write('src/new.txt', 'added later\n');
  rmSync(join(work, 'src/old.txt'));
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'third');
  const served = scratch('served');
  const bare = join(served, 'fixture.git');
  git(served, 'clone', '-q', '--bare', work, bare);
  git(bare, 'repack', '-a', '-d', '-q');
  git(bare, 'update-server-info');
  return { work, served, bare };
}

// A read-only replica: files over HTTP, nothing else.
export function serveStatic(dir) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const file = join(dir, decodeURIComponent(new URL(request.url, 'http://x').pathname));
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
      response.writeHead(200); response.end(readFileSync(file));
    }).listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

const freePort = () => new Promise((resolve) => {
  const probe = createNet().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// The writable replica: the stand-in object store, run as its own process, exactly as in development.
export async function startReplica() {
  const dir = scratch('replica');
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'scripts', 'dev-replica.mjs'), String(port), dir], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', () => reject(new Error('replica did not start'))); });
  return { url: `http://127.0.0.1:${port}`, dir, close: () => child.kill() };
}

// Git stores the same loose-object bytes a replica holds, compressed. Rebuild a repository so git can judge it.
export function replicaToGit(replicaDir) {
  const target = scratch('rebuilt');
  git(target, 'init', '-q', '-b', 'main');
  const source = join(replicaDir, 'objects', 'sha1');
  let count = 0;
  for (const shard of readdirSync(source)) {
    for (const name of readdirSync(join(source, shard))) {
      mkdirSync(join(target, '.git', 'objects', shard), { recursive: true });
      writeFileSync(join(target, '.git', 'objects', shard, name), deflateSync(readFileSync(join(source, shard, name))));
      count += 1;
    }
  }
  const state = JSON.parse(readFileSync(join(replicaDir, 'state.json'), 'utf8'));
  for (const [ref, entry] of Object.entries(state.refs)) git(target, 'update-ref', ref, entry.id);
  return { target, count };
}

// A device is its own empty browser storage. Switching device swaps storage and reopens it.
export const newDevice = () => new IDBFactory();
export async function use(device, store) {
  globalThis.indexedDB = device;
  await store.openStore();
}

export const wasm = (name) => readFileSync(join(root, 'web', name));
