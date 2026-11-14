// Registers the service worker and tells the visitor what the page is pinned to.

const ask = (worker, message) => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => resolve(event.data);
  worker.postMessage(message, [channel.port2]);
  setTimeout(() => resolve(null), 2000);
});

export async function startShell(note) {
  if (!('serviceWorker' in navigator)) {
    note.textContent = 'This browser has no service worker, so the page is not pinned.';
    return;
  }
  let registration;
  try {
    registration = await navigator.serviceWorker.register('sw.js');
  } catch (error) {
    note.textContent = `Page not pinned: ${error.message}`;
    return;
  }

  let accepting = false;
  const show = async () => {
    if (!navigator.serviceWorker.controller) { note.textContent = 'Pinning this page…'; return; }
    try {
      const manifest = await (await fetch('shell.json')).json();
      note.textContent = `page pinned to sha256:${manifest.closure.slice(0, 16)}… · ${manifest.files.length} files, each checked against its digest on every load`;
    } catch { note.textContent = 'Page not pinned.'; }
  };

  const offer = async (worker) => {
    const closure = await ask(worker, 'closure');
    const button = document.createElement('button');
    button.textContent = 'Accept and reload';
    button.addEventListener('click', () => { accepting = true; worker.postMessage('accept'); });
    note.replaceChildren(`A new version of this page is waiting${closure ? `: sha256:${closure.slice(0, 16)}…` : ''}. Nothing changes until you accept it. `, button);
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => { if (accepting) location.reload(); else show(); });
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
  await show();
  if (registration.waiting && navigator.serviceWorker.controller) await offer(registration.waiting);
  // Ask the host for a newer version on every load; offline, this simply fails.
  registration.update().catch(() => {});
}
