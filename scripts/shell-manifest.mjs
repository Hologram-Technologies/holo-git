// Writes web/sw.js from web/sw.template.js with the SHA-256 of every file the page is made of.
// The closure digest is the SHA-256 of the canonical manifest: one value that names the whole page.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', wasm: 'application/wasm' };
const PATHS = ['ancestry.js', 'checks.js', 'engine.js', 'engine.wasm', 'evidence.js', 'git.js', 'identity.js', 'index.html', 'kernel.js', 'kernel.wasm', 'log.js', 'records.js', 'replica.js', 's3sign.js', 'shell.js', 'store.js', 'sync.js',
  'ui/actions.js', 'ui/activity.js', 'ui/around.js', 'ui/chrome.js', 'ui/code.js', 'ui/components.js', 'ui/gallery.js', 'ui/history.js', 'ui/home.js', 'ui/icons.js', 'ui/issues.js', 'ui/main.js', 'ui/markdown.js', 'ui/pages.js', 'ui/pulls.js', 'ui/reposettings.js', 'ui/repo.js', 'ui/router.js', 'ui/session.js', 'ui/strings.js', 'ui/theme-init.js', 'ui/tokens.css', 'ui/ui.css', 'ui/zip.js'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = PATHS.map((path) => {
  const bytes = readFileSync(join(web, path));
  return { path, sha256: sha256(bytes), bytes: bytes.length, type: TYPES[path.split('.').pop()] };
});
const closure = sha256(JSON.stringify(files));
const template = readFileSync(join(web, 'sw.template.js'), 'utf8');
if (!template.includes('/*MANIFEST*/null')) throw new Error('sw.template.js has no manifest placeholder');
writeFileSync(join(web, 'sw.js'), template.replace('/*MANIFEST*/null', JSON.stringify({ closure, files })));
console.log(`shell: sha256:${closure} (${files.length} files, ${files.reduce((n, f) => n + f.bytes, 0)} bytes)`);
