// Ask an S3-compatible store the questions the push adapter depends on, and print the answers.
// Needs S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY and S3_TEST_SECRET_KEY (throwaway test keys).
//
//   node scripts/probe-s3.mjs

import { signS3 } from '../web/s3sign.js';

const creds = { accessKey: process.env.S3_TEST_ACCESS_KEY, secretKey: process.env.S3_TEST_SECRET_KEY };
const base = process.env.S3_TEST_ENDPOINT;
const bucket = `/probe-${Date.now()}`;

async function call(method, path, headers = {}, body, using = creds) {
  const url = base + path;
  const response = await fetch(url, { method, headers: await signS3({ method, url, headers, body }, using), body });
  return { status: response.status, etag: response.headers.get('etag'), text: (await response.text()).slice(0, 100).replace(/\s+/g, ' ') };
}
const show = (label, r, want) => console.log(`${r.status === want ? 'ok  ' : 'NO  '}${label.padEnd(40)} ${r.status} (want ${want}) ${r.status >= 300 ? r.text : r.etag || ''}`);

show('create a bucket', await call('PUT', bucket), 200);
show('put a new object', await call('PUT', `${bucket}/a/b.txt`, {}, 'one'), 200);
const got = await call('GET', `${bucket}/a/b.txt`);
show('get it, with an ETag', got, 200);
show('get a missing object', await call('GET', `${bucket}/a/missing`), 404);
show('If-None-Match:* on an existing object', await call('PUT', `${bucket}/a/b.txt`, { 'if-none-match': '*' }, 'two'), 412);
show('If-None-Match:* on a new object', await call('PUT', `${bucket}/a/c.txt`, { 'if-none-match': '*' }, 'new'), 200);
show('If-Match with a stale ETag', await call('PUT', `${bucket}/a/b.txt`, { 'if-match': '"00000000000000000000000000000000"' }, 'three'), 412);
show('If-Match with the current ETag', await call('PUT', `${bucket}/a/b.txt`, { 'if-match': got.etag }, 'four'), 200);
const after = await call('GET', `${bucket}/a/b.txt`);
console.log(`${after.text === 'four' || after.status === 200 ? 'ok  ' : 'NO  '}${'the object now holds the last allowed write'.padEnd(40)} ${after.status}`);
show('a request signed with the wrong secret', await call('GET', `${bucket}/a/b.txt`, {}, undefined, { ...creds, secretKey: 'wrong' }), 403);
const unsigned = await fetch(`${base}${bucket}/a/b.txt`);
console.log(`${unsigned.status === 403 ? 'ok  ' : 'NO  '}${'an unsigned request'.padEnd(40)} ${unsigned.status} (want 403)`);
const preflight = await fetch(`${base}${bucket}/a/b.txt`, { method: 'OPTIONS', headers: { origin: 'http://localhost:8731', 'access-control-request-method': 'PUT',
  'access-control-request-headers': 'authorization,x-amz-date,x-amz-content-sha256,if-match,if-none-match,content-type' } });
console.log(`    cross-origin preflight: ${preflight.status}; allow-origin=${preflight.headers.get('access-control-allow-origin')}; allow-headers=${preflight.headers.get('access-control-allow-headers')}; expose=${preflight.headers.get('access-control-expose-headers')}`);
