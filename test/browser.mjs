// Drives a real browser engine for the interface tests, over the browser's own debugging protocol.
// No test framework and no package: a headless Chromium-family browser already on the machine.
//
// Set BROWSER_BIN to choose the binary. Each test gets its own browser context, so storage,
// sign-in state and the service worker start empty every time.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [process.env.BROWSER_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
export const browserPath = () => CANDIDATES.find((path) => path && existsSync(path)) || null;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export async function launch() {
  const binary = browserPath();
  if (!binary) throw new Error('no browser found for the interface tests; set BROWSER_BIN to a Chromium-family binary');
  const profile = mkdtempSync(join(tmpdir(), 'ui-test-profile-'));
  const child = spawn(binary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error(`the browser did not start: ${seen.slice(-300)}`)), 30000);
    child.stderr.on('data', (chunk) => { seen += chunk; const m = seen.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`the browser exited: ${seen.slice(-300)}`)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 1;
  const waiting = new Map();
  const listeners = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id) { const entry = waiting.get(data.id); waiting.delete(data.id); if (entry) (data.error ? entry.reject(new Error(`${entry.method}: ${data.error.message}`)) : entry.resolve(data.result)); return; }
    const handler = listeners.get(data.sessionId);
    if (handler) handler(data);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = next; next += 1; waiting.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params, sessionId })); });

  // A page in a context of its own. width below 500 is treated as a phone.
  async function open(url, { width = 1280, height = 800, scheme = 'light' } = {}) {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    listeners.set(sessionId, (event) => {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception ? event.params.exceptionDetails.exception.description : event.params.exceptionDetails.text);
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map((a) => a.value || a.description).join(' '));
    });
    const cdp = (method, params) => send(method, params, sessionId);
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });

    const page = { errors, cdp };
    // Evaluate an expression in the page and return its value. Promises are awaited.
    page.eval = async (expression) => {
      const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`in the page: ${exceptionDetails.exception ? exceptionDetails.exception.description : exceptionDetails.text}`);
      return result.value;
    };
    page.waitFor = async (expression, what = expression, timeout = 15000) => {
      const started = Date.now();
      for (;;) {
        let value = false;
        try { value = await page.eval(expression); } catch { /* the page is between documents */ }
        if (value) return value;
        if (Date.now() - started > timeout) throw new Error(`timed out waiting for: ${what}`);
        await sleep(50);
      }
    };
    // The app has drawn a screen: it sets data-ready on <html> once, and every screen sets the title.
    page.ready = () => page.waitFor("document.documentElement.dataset.ready === '' && document.getElementById('main').childElementCount > 0", 'the first screen');
    page.goto = async (to) => { await page.eval("delete document.documentElement.dataset.ready").catch(() => {}); await cdp('Page.navigate', { url: to }); await page.ready(); };
    page.reload = async () => { await page.eval("delete document.documentElement.dataset.ready"); await cdp('Page.reload'); await page.ready(); };
    page.path = () => page.eval('location.pathname + location.search');
    // Wait until the screen for this path has been drawn (the router marks it), not merely until the address changed.
    page.arrive = (path) => page.waitFor(`document.documentElement.dataset.screen === ${JSON.stringify(path)} && location.pathname === ${JSON.stringify(path)}`, `the screen at ${path}`);
    page.text = (selector = '#main') => page.eval(`document.querySelector(${JSON.stringify(selector)}).innerText`);
    page.exists = (selector) => page.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
    const find = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => ${text === undefined ? 'true' : `n.textContent.trim() === ${JSON.stringify(text)}`})`;
    // Click the first element matching the selector (and, if given, with exactly this text), as a user would: a real mouse press at its centre.
    page.click = async (selector, text) => {
      const box = await page.waitFor(`(() => { const n = ${find(selector, text)}; if (!n) return null; n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`, `${selector} ${text || ''} to click`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    };
    // Replace a field's contents by typing.
    page.fill = async (selector, value) => {
      await page.waitFor(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.focus(); n.select && n.select(); return true; })()`, `${selector} to fill`);
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
      if (value) await cdp('Input.insertText', { text: value });
    };
    const KEYS = { Enter: 13, Escape: 27, Tab: 9 };
    page.press = async (key, { ctrl = false, shift = false } = {}) => {
      const base = { key, code: KEYS[key] ? key : `Key${key.toUpperCase()}`, windowsVirtualKeyCode: KEYS[key] || key.toUpperCase().charCodeAt(0), modifiers: (ctrl ? 2 : 0) | (shift ? 8 : 0) };
      const printable = key.length === 1 && !ctrl;
      await cdp('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', ...base, text: printable ? key : undefined });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    };
    page.field = (labelText) => page.waitFor(`(() => { const l = [...document.querySelectorAll('label')].find((n) => n.textContent.trim().startsWith(${JSON.stringify(labelText)})); return l ? '#' + l.getAttribute('for') : null; })()`, `a field labelled ${labelText}`);
    page.setViewport = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    page.offline = (offline) => cdp('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    page.close = async () => { listeners.delete(sessionId); await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {}); };
    if (url) await page.goto(url);
    return page;
  }

  async function close() {
    try { socket.close(); } catch { /* already closed */ }
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGKILL');
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the browser still holds a file */ }
  }
  return { open, close };
}
