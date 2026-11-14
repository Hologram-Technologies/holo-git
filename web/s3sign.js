// Request signing for S3-compatible stores (AWS Signature Version 4), with the browser's own
// cryptography. A store that requires it rejects anything unsigned or signed with the wrong key.
// The secret never leaves this function: only the signature goes on the wire.

const utf8 = new TextEncoder();
const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));

async function hmac(key, message) {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, utf8.encode(message)));
}

// RFC 3986 encoding, as the signature requires: everything but unreserved characters.
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Returns the headers to send: the caller's own, plus the date, the body hash and the signature.
export async function signS3({ method, url, headers = {}, body }, { accessKey, secretKey, region = 'us-east-1' }, now = new Date()) {
  const target = new URL(url);
  const stamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const payload = body == null ? new Uint8Array() : typeof body === 'string' ? utf8.encode(body) : body;
  const payloadHash = await sha256(payload);

  const signed = { host: target.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  for (const [name, value] of Object.entries(headers)) signed[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ');
  const names = Object.keys(signed).sort();
  const path = target.pathname.split('/').map((segment) => encode(decodeURIComponent(segment))).join('/');
  const query = [...target.searchParams].map(([k, v]) => `${encode(k)}=${encode(v)}`).sort().join('&');
  const canonical = [method, path, query, names.map((name) => `${name}:${signed[name]}\n`).join(''), names.join(';'), payloadHash].join('\n');

  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256(utf8.encode(canonical))].join('\n');
  let key = utf8.encode(`AWS4${secretKey}`);
  for (const part of [day, region, 's3', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));

  return { ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}
