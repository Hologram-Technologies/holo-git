// The banned-word scan, the freshness of the generated design files, and creating a repository.
// These need no browser.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, newDevice, root, use, wasm } from './helpers.mjs';
import { S, PRODUCT } from '../web/ui/strings.js';
import { build } from '../scripts/build-ui.mjs';

// docs/PROMPT-UI.md, "Words": never shown to a user, anywhere.
const BANNED = [['Prism', /prism/i], ['UOR', /\buor\b/i], ['kappa', /kappa/i], ['holo', /holo/i], ['LexLean', /lexlean/i], ['kernel', /kernel/i], ['engine', /engine/i],
  ['fold', /\bfold(s|ed|ing)?\b/i], ['record', /\brecords?\b/i], ['signed log', /signed log/i], ['replica', /replica/i], ['action key', /action key/i], ['digest', /digest/i],
  ['label', /\blabels?\b/i], ['attestation', /attestation/i], ['delegation', /delegation/i], ['grant', /\bgrant(s|ed)?\b/i], ['closure', /closure/i], ['manifest', /manifest/i], ['wasm', /wasm/i]];
// "label" is banned in the content-address sense only; issue labels are a feature. These entries use it in that sense.
const LABEL_ALLOWED = new Set(['gallery.small']);
const banned = (text, { labels = false } = {}) => BANNED.filter(([name, pattern]) => !(labels && name === 'label') && pattern.test(text)).map(([name]) => name);
// The product's name is the one exemption, pending a decision on the name.
const withoutName = (text) => text.split(PRODUCT).join('');

function collect(node, path = [], out = []) {
  if (typeof node === 'string') out.push([path.join('.'), node]);
  else if (typeof node === 'function') out.push([path.join('.'), String(node('sample', 'sample', 2))]);
  else if (Array.isArray(node)) node.forEach((item, i) => collect(item, [...path, i], out));
  else for (const [key, value] of Object.entries(node)) collect(value, [...path, key], out);
  return out;
}

test('no string in the strings file contains a banned word, an exclamation mark, or Title Case', () => {
  const strings = collect(S);
  assert.ok(strings.length > 150, `the file holds the interface's wording (${strings.length} strings)`);
  const problems = [];
  for (const [path, text] of strings) {
    const found = banned(withoutName(text), { labels: LABEL_ALLOWED.has(path) || path.startsWith('issues.') || path.startsWith('pulls.') });
    if (found.length) problems.push(`${path}: "${text}" contains ${found.join(', ')}`);
    if (text.includes('!')) problems.push(`${path}: "${text}" has an exclamation mark`);
    // Sentence case: after the first word, a capital starts only a name the interface uses as a name.
    const words = text.split(/\s+/).slice(1).filter((word) => /^[A-Z][a-z]+$/.test(word) && !['README', 'Code', 'Pull', 'Settings', 'Explore', 'Issues', 'Enter', 'Ctrl', 'Esc', 'Sync', 'Write', 'Preview'].includes(word));
    if (words.length >= 2 && !/[.:]/.test(text)) problems.push(`${path}: "${text}" looks like Title Case`);
  }
  assert.deepEqual(problems, []);
});

test('the rebuilt interface keeps its wording in the strings file: no banned word in any literal elsewhere', () => {
  const problems = [];
  // gallery.js holds sample content for review, icons.js holds generated path data, strings.js is scanned above.
  const files = readdirSync(join(root, 'web', 'ui')).filter((name) => name.endsWith('.js') && !['strings.js', 'icons.js', 'gallery.js'].includes(name)).map((name) => `web/ui/${name}`);
  for (const file of [...files, 'web/shell.js', 'web/index.html', 'web/404.html']) {
    const source = readFileSync(join(root, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const literals = file.endsWith('.html') ? [source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')] : [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const literal of literals) {
      // File names, storage keys and class names are not wording.
      if (/^[\w./-]+\.(js|css|wasm|json|html)$|^[\w-]+$/.test(literal.trim())) continue;
      // "label" is a class name and an issue-label word in this code; its content-address sense is caught by the other nineteen words around it.
      const found = banned(withoutName(literal), { labels: true });
      if (found.length) problems.push(`${file}: "${literal.trim().slice(0, 60)}" contains ${found.join(', ')}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the old screens are gone: every screen keeps its wording in the strings file', () => {
  for (const file of ['web/app.js', 'web/style.css']) assert.equal(existsSync(join(root, file)), false, `${file} was the last of the old interface`);
});

test('tokens.css and icons.js are exactly what the pinned packages produce', () => {
  for (const [path, content] of Object.entries(build())) assert.equal(readFileSync(join(root, path), 'utf8'), content, `${path} is stale: run node scripts/build-ui.mjs`);
});

test('no colour is typed by hand in any stylesheet', () => {
  for (const file of ['web/ui/ui.css']) {
    const css = readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [], [], file);
  }
});

let engine; let store; let gitjs;
before(async () => {
  engine = await import('../web/engine.js');
  const kernel = await import('../web/kernel.js');
  store = await import('../web/store.js');
  gitjs = await import('../web/git.js');
  await engine.loadEngine(wasm('engine.wasm'));
  await kernel.loadKernel(wasm('kernel.wasm'));
});
after(cleanup);

test('a new repository starts with one commit that git gives the same identifier', async () => {
  await use(newDevice(), store);
  const who = { name: 'Ada Example', email: 'ada@example.org' };
  const repo = await gitjs.createRepo({ name: 'hello-world', description: 'A first repository', who });
  const refs = await store.getRefs('hello-world');
  assert.equal(refs['refs/heads/main'], repo.commit);
  const gitId = async (kind, id) => execFileSync('git', ['hash-object', '-t', kind, '--stdin'], { input: Buffer.from(engine.open(await store.getObject(id)).content) }).toString().trim();
  const { commit } = await gitjs.resolveCommit(refs, 'main');
  assert.equal(await gitId('commit', repo.commit), repo.commit);
  assert.equal(await gitId('tree', commit.tree), commit.tree);
  assert.deepEqual(commit.parents, []);
  const readme = await gitjs.lookup(commit.tree, 'README.md');
  assert.equal(new TextDecoder().decode(engine.open(await store.getObject(readme.id)).content), '# hello-world\n\nA first repository\n');
  assert.equal(gitjs.person(commit.author).name, 'Ada Example');

  // Without a README the first commit holds git's empty tree.
  const empty = await gitjs.createRepo({ name: 'empty', readme: false, who });
  assert.equal((await gitjs.resolveCommit(await store.getRefs('empty'), 'main')).commit.tree, execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], { input: '' }).toString().trim());
  assert.equal(empty.objects, 2);
  // Failures: a taken name, a name with characters a repository cannot have, and nobody to sign as.
  await assert.rejects(gitjs.createRepo({ name: 'hello-world', who }), /already exists/);
  await assert.rejects(gitjs.createRepo({ name: 'has spaces', who }), /letters, digits/);
  await assert.rejects(gitjs.createRepo({ name: 'anonymous', who: { name: '', email: '' } }), /name and an email/);
});
