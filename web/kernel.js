// The decision kernel: the WebAssembly guest built from the LexLean model in src/.
// It has no imports and keeps no state; a fresh instance answers each request.
// The host computes and moves bytes. Whether something counts is asked here.

const text = new TextDecoder();
let module;
export const decisions = { asked: 0 };

export async function loadKernel(url = 'kernel.wasm') {
  module = await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error('the kernel must import nothing');
}

function ask(request) {
  const { exports: guest } = new WebAssembly.Instance(module, {});
  const at = guest.holo_alloc(request.length);
  new Uint8Array(guest.memory.buffer, at, request.length).set(request);
  const reply = guest.holo_run(at, request.length);
  decisions.asked += 1;
  return text.decode(new Uint8Array(guest.memory.buffer, Number(reply >> 32n), Number(reply & 0xffffffffn)));
}

const unhex = (id) => Uint8Array.from(id.match(/../g), (b) => parseInt(b, 16));

// Operation 5, restore: are these two labels the same? A label is an axis byte and 64 digest bytes.
export function sameLabel(claimed, observed) {
  if (!/^[0-9a-f]{40}$/.test(claimed) || !/^[0-9a-f]{40}$/.test(observed)) return false;
  const request = new Uint8Array(131);
  request[0] = 5;
  request[1] = 1; // axis: sha1
  request.set(unhex(claimed), 2);
  request[66] = 1;
  request.set(unhex(observed), 67);
  return ask(request) === 'match';
}

export const MODE = { none: 0, read: 1, write: 2, admin: 3, owner: 4 };

// Operation 1, authorize: does this operation count? Anything but an explicit allow is a refusal.
export function authorize({ signed, revoked, live, granted, required }) {
  return ask(Uint8Array.of(1, signed ? 1 : 0, revoked ? 1 : 0, live ? 1 : 0, granted, required)) === 'allow';
}
