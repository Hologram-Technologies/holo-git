// The decision kernel: the WebAssembly guest built from the LexLean model in src/.
// It has no imports and keeps no state; a fresh instance answers each request.
// The host computes and moves bytes. Whether something counts is asked here.

const text = new TextDecoder();
let module;
export const decisions = { asked: 0 };

export async function loadKernel(source = 'kernel.wasm') {
  module = await WebAssembly.compile(typeof source === 'string' ? await (await fetch(source)).arrayBuffer() : source);
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

// Operation 6, decide: does a signed operation count, given the issuer's chain of grants?
// The chain starts from the owner. Each link carries its scope, whether its own signature held,
// whether it was revoked, and when it expires (seconds; null for never). Unused links are neutral.
export function decide({ signed, required, links, now }) {
  if (links.length > 5) return false;
  const request = new Uint8Array(67);
  const view = new DataView(request.buffer);
  request[0] = 6;
  request[1] = signed ? 1 : 0;
  request[2] = required;
  request[3] = MODE.owner;
  for (let i = 0; i < 5; i += 1) {
    const link = links[i] || { scope: MODE.owner, signed: true, revoked: false, notAfter: null };
    const at = 4 + 11 * i;
    request[at] = link.scope;
    request[at + 1] = link.signed ? 1 : 0;
    request[at + 2] = link.revoked ? 1 : 0;
    view.setBigUint64(at + 3, link.notAfter == null ? 0xffffffffffffffffn : BigInt(link.notAfter));
  }
  view.setBigUint64(59, BigInt(now));
  return ask(request) === 'allow';
}

// Operation 7, ref update: operation 6, and also whether the branch may move this way.
// `fastForward` is the host's evidence that the branch only moved forward; `forceAllowed` is
// false for a protected branch. The kernel proves: not forward and not allowed is a refusal,
// whoever asks.
export function refUpdate({ signed, required, links, now, fastForward, forceAllowed }) {
  if (links.length > 5) return false;
  const request = new Uint8Array(69);
  const view = new DataView(request.buffer);
  request[0] = 7;
  request[1] = signed ? 1 : 0;
  request[2] = required;
  request[3] = MODE.owner;
  for (let i = 0; i < 5; i += 1) {
    const link = links[i] || { scope: MODE.owner, signed: true, revoked: false, notAfter: null };
    const at = 4 + 11 * i;
    request[at] = link.scope;
    request[at + 1] = link.signed ? 1 : 0;
    request[at + 2] = link.revoked ? 1 : 0;
    view.setBigUint64(at + 3, link.notAfter == null ? 0xffffffffffffffffn : BigInt(link.notAfter));
  }
  view.setBigUint64(59, BigInt(now));
  request[67] = fastForward === true ? 1 : 0;
  request[68] = forceAllowed === true ? 1 : 0;
  return ask(request) === 'allow';
}

// Operation 8, the merge gate: operation 7, and also enough approvals and every required check.
// The counts are the host's evidence. The kernel proves: fewer approvals than needed, or fewer
// checks than needed, is a refusal, whoever asks.
export function gate({ signed, required, links, now, fastForward, forceAllowed, approvalsHave, approvalsNeeded, checksHave, checksNeeded }) {
  if (links.length > 5) return false;
  const counts = [approvalsHave, approvalsNeeded, checksHave, checksNeeded];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) return false;
  const request = new Uint8Array(73);
  const view = new DataView(request.buffer);
  request[0] = 8;
  request[1] = signed ? 1 : 0;
  request[2] = required;
  request[3] = MODE.owner;
  for (let i = 0; i < 5; i += 1) {
    const link = links[i] || { scope: MODE.owner, signed: true, revoked: false, notAfter: null };
    const at = 4 + 11 * i;
    request[at] = link.scope;
    request[at + 1] = link.signed ? 1 : 0;
    request[at + 2] = link.revoked ? 1 : 0;
    view.setBigUint64(at + 3, link.notAfter == null ? 0xffffffffffffffffn : BigInt(link.notAfter));
  }
  view.setBigUint64(59, BigInt(now));
  request[67] = fastForward === true ? 1 : 0;
  request[68] = forceAllowed === true ? 1 : 0;
  // One byte each. More than 255 given is still "enough"; more than 255 needed cannot be asked for.
  request[69] = Math.min(approvalsHave, 255);
  request[70] = approvalsNeeded > 255 ? 255 : approvalsNeeded;
  request[71] = Math.min(checksHave, 255);
  request[72] = checksNeeded > 255 ? 255 : checksNeeded;
  if (approvalsNeeded > 255 || checksNeeded > 255) return false;
  return ask(request) === 'allow';
}
