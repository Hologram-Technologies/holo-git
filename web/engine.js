// Loads the engine and passes bytes across the WebAssembly boundary.
// The engine has no imports: it can compute, and nothing else.

const ERRORS = ['', 'truncated', 'not a packfile', 'unsupported pack version', 'pack checksum mismatch',
  'unknown entry type', 'bad compressed data', 'bad delta', 'missing delta base', 'malformed object'];

let wasm;

// `source` is an address to fetch, or the module's bytes (used by the tests).
export async function loadEngine(source = 'engine.wasm') {
  const bytes = typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source;
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasm = instance.exports;
}

function call(name, bytes) {
  const input = wasm.eng_alloc(bytes.length);
  new Uint8Array(wasm.memory.buffer, input, bytes.length).set(bytes);
  const reply = wasm[name](input, bytes.length);
  wasm.eng_free(input, bytes.length);
  const view = new DataView(wasm.memory.buffer);
  const status = view.getUint32(reply, true);
  const length = view.getUint32(reply + 4, true);
  const out = new Uint8Array(wasm.memory.buffer, reply + 8, length).slice();
  wasm.eng_free(reply, 8 + length);
  if (status !== 0) throw new Error(ERRORS[status] || `engine error ${status}`);
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
export const hex = (bytes) => Array.from(bytes, (b) => HEX[b]).join('');
const text = new TextDecoder();

// Packfile -> [{ id, envelope }]. Identifiers are computed by the engine from the bytes.
export function readPack(pack) {
  const out = call('eng_pack', pack);
  const view = new DataView(out.buffer);
  const objects = [];
  for (let at = 0; at < out.length;) {
    const id = hex(out.subarray(at, at + 20));
    const length = view.getUint32(at + 20, true);
    objects.push({ id, envelope: out.subarray(at + 24, at + 24 + length) });
    at += 24 + length;
  }
  return objects;
}

export function readLoose(compressed) {
  const out = call('eng_loose', compressed);
  return { id: hex(out.subarray(0, 20)), envelope: out.subarray(20) };
}

// The identifier an envelope's bytes actually have.
export const labelOf = (envelope) => hex(call('eng_label', envelope));
export const parseCommit = (envelope) => JSON.parse(text.decode(call('eng_commit', envelope)));
export const parseTree = (envelope) => JSON.parse(text.decode(call('eng_tree', envelope)));

function pack(buffers) {
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(4 + 4 * buffers.length + total);
  const view = new DataView(out.buffer);
  view.setUint32(0, buffers.length, true);
  let at = 4 + 4 * buffers.length;
  buffers.forEach((buffer, i) => {
    view.setUint32(4 + 4 * i, buffer.length, true);
    out.set(buffer, at);
    at += buffer.length;
  });
  return out;
}

// Runs of lines that turn `before` into `after`: [{ op: 'equal' | 'delete' | 'insert', count }].
export function diffLines(before, after) {
  const out = call('eng_diff', pack([before, after]));
  const view = new DataView(out.buffer);
  const runs = [];
  for (let at = 0; at < out.length; at += 5) runs.push({ op: ['equal', 'delete', 'insert'][out[at]], count: view.getUint32(at + 1, true) });
  return runs;
}

// Versions newest first -> for each line of the newest, the index of the oldest version that had it.
export function blameLines(versions) {
  const out = call('eng_blame', pack(versions));
  const view = new DataView(out.buffer);
  return Array.from({ length: out.length / 4 }, (_, i) => view.getUint32(4 * i, true));
}

// Lines keep the engine's meaning: split after each newline.
export function splitLines(bytes) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] === 10) { lines.push(bytes.subarray(start, i + 1)); start = i + 1; }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  return lines;
}

export function open(envelope) {
  const nul = envelope.indexOf(0);
  const kind = text.decode(envelope.subarray(0, nul)).split(' ')[0];
  return { kind, content: envelope.subarray(nul + 1) };
}

const utf8 = new TextEncoder();
const unhex = (id) => Uint8Array.from(id.match(/../g), (b) => parseInt(b, 16));
const withId = (out) => ({ id: hex(out.subarray(0, 20)), envelope: out.subarray(20) });

// New objects. The engine serialises them and computes the identifier git would give them.
export const makeObject = (kind, content) => withId(call('eng_envelope', pack([utf8.encode(kind), content])));

export function makeTree(entries) {
  const parts = [];
  for (const entry of entries) parts.push(utf8.encode(entry.mode), utf8.encode(entry.name), unhex(entry.id));
  return makeObject('tree', call('eng_tree_build', pack(parts)));
}

export function makeCommit({ tree, parents, author, committer, message }) {
  return makeObject('commit', call('eng_commit_build', pack([tree, author, committer, message, ...parents].map((s) => utf8.encode(s)))));
}

// A git bundle: one ref and every object it needs. `git clone file.bundle` reads it.
export const makeBundle = (ref, id, envelopes) => call('eng_bundle', pack([utf8.encode(ref), unhex(id), ...envelopes]));

// Three-way merge of text. `clean` is false when both sides changed the same lines differently.
export function mergeLines(base, ours, theirs) {
  const out = call('eng_merge', pack([base, ours, theirs]));
  return out[0] === 1 ? { clean: true, bytes: out.subarray(1) } : { clean: false, marked: out.subarray(1) };
}
