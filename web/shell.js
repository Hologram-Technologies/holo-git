// Registers the service worker that pins the page's files, and reports what it knows:
// the one value that names the whole page, and whether a newer version is waiting.
// What is shown, and where, is the interface's business (web/ui/chrome.js: the About dialog).

const ask = (worker, message) => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => resolve(event.data);
  worker.postMessage(message, [channel.port2]);
  setTimeout(() => resolve(null), 2000);
});

export const shell = { supported: 'serviceWorker' in navigator, integrity: null, files: 0, waiting: null, waitingIntegrity: null };

let accepting = false;
export function acceptUpdate() {
  if (!shell.waiting) return;
  accepting = true;
  shell.waiting.postMessage('accept');
}

export async function startShell(onchange = () => {}) {
  if (!shell.supported) { onchange(shell); return; }
  let registration;
  try {
    registration = await navigator.serviceWorker.register(new URL('sw.js', import.meta.url));
  } catch {
    shell.supported = false;
    onchange(shell);
    return;
  }
  const read = async () => {
    if (navigator.serviceWorker.controller) {
      try {
        const manifest = await (await fetch(new URL('shell.json', import.meta.url))).json();
        shell.integrity = manifest.closure;
        shell.files = manifest.files.length;
      } catch { /* not controlled yet */ }
    }
    onchange(shell);
  };
  const offer = async (worker) => {
    shell.waiting = worker;
    shell.waitingIntegrity = await ask(worker, 'closure');
    onchange(shell);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (accepting) location.reload(); else read(); });
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker); });
  });
  await read();
  if (registration.waiting && navigator.serviceWorker.controller) await offer(registration.waiting);
  // Ask the host for a newer version on every load; offline, this simply fails.
  registration.update().catch(() => {});
}
