// A stand-in for object storage, for development and tests only.
//
// It does what a bucket does and nothing more: GET and PUT files under one directory, with
// ETags and conditional writes (If-Match, If-None-Match: *), and open cross-origin access.
// It knows nothing about git, signatures or holo-git. It has no authentication: anyone who
// can reach it can write to it. Do not expose it beyond this machine.
//
//   node scripts/dev-replica.mjs [port] [directory]

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const port = Number(process.argv[2] || 8732);
const root = resolve(process.argv[3] || '.replica');
const LIMIT = 64 * 1024 * 1024;
mkdirSync(root, { recursive: true });

const etagOf = (bytes) => `"${createHash('sha256').update(bytes).digest('hex')}"`;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type, if-match, if-none-match',
  'access-control-expose-headers': 'etag',
  'access-control-max-age': '600',
};

createServer((request, response) => {
  const end = (status, headers = {}, body) => { response.writeHead(status, { ...CORS, ...headers }); response.end(body); };
  if (request.method === 'OPTIONS') return end(204);
  let path;
  try { path = decodeURIComponent(new URL(request.url, 'http://x').pathname); } catch { return end(400); }
  if (!/^\/[A-Za-z0-9._\/-]+$/.test(path) || path.includes('..') || path.endsWith('/')) return end(400);
  const file = join(root, ...path.split('/').filter(Boolean));
  if (!file.startsWith(root + sep)) return end(400);
  const current = existsSync(file) ? readFileSync(file) : null;

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (!current) return end(404);
    return end(200, { etag: etagOf(current), 'content-length': current.length, 'cache-control': 'no-store' }, request.method === 'GET' ? current : undefined);
  }
  if (request.method !== 'PUT') return end(405);

  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => { size += chunk.length; if (size > LIMIT) request.destroy(); else chunks.push(chunk); });
  request.on('end', () => {
    // Re-read at write time: the condition is checked against what is there now.
    const now = existsSync(file) ? readFileSync(file) : null;
    if (request.headers['if-none-match'] === '*' && now) return end(412);
    if (request.headers['if-match'] && (!now || request.headers['if-match'] !== etagOf(now))) return end(412);
    const body = Buffer.concat(chunks);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.part`, body);
    renameSync(`${file}.part`, file);
    end(now ? 200 : 201, { etag: etagOf(body) });
  });
}).listen(port, '127.0.0.1', () => console.log(`dev replica on http://127.0.0.1:${port} storing in ${root}`));
