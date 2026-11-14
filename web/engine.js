// Loads the engine and passes bytes across the WebAssembly boundary.
// The engine has no imports: it can compute, and nothing else.

const ERRORS = ['', 'truncated', 'not a packfile', 'unsupported pack version', 'pack checksum mismatch',
  'unknown entry type', 'bad compressed data', 'bad delta', 'missing delta base', 'malformed object'];

let wasm;

export async function loadEngine(url = 'engine.wasm') {
  const bytes = await (await fetch(url)).arrayBuffer();
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

export function open(envelope) {
  const nul = envelope.indexOf(0);
  const kind = text.decode(envelope.subarray(0, nul)).split(' ')[0];
  return { kind, content: envelope.subarray(nul + 1) };
}
