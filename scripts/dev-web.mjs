// Serves web/ the way a static host does: files as they are, and 404.html (with status 404) for any
// address that is not a file. Used for development and by test/ui.test.mjs.
//
//   node scripts/dev-web.mjs [port] [prefix]      prefix, e.g. /holo-git/, serves the page under a path

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', wasm: 'application/wasm', json: 'application/json', svg: 'image/svg+xml' };

export function serveWeb({ port = 0, prefix = '/', dir = web } = {}) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      const inside = path.startsWith(prefix) ? path.slice(prefix.length) : null;
      let file = inside === null ? null : normalize(join(dir, inside || 'index.html'));
      if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      const found = file && file.startsWith(dir) && existsSync(file);
      const stub = join(dir, '404.html');
      const body = found ? readFileSync(file) : existsSync(stub) ? readFileSync(stub) : '';
      const type = TYPES[(found ? file : '404.html').split('.').pop()] || 'application/octet-stream';
      // Any origin may read, as from a public static host: the page opens repositories served this way.
      response.writeHead(found ? 200 : 404, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      response.end(body);
    }).listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}${prefix}`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await serveWeb({ port: Number(process.argv[2]) || 8731, prefix: process.argv[3] || '/' });
  console.log(url);
}
