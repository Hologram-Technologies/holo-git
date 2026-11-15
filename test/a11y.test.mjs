// Every screen, in light and in dark, through the project's own accessibility audit (test/audit.mjs).
// A repository is filled with one of everything first, so the screens have something on them.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, root } from './helpers.mjs';
import { launch } from './browser.mjs';
import { serveWeb } from '../scripts/dev-web.mjs';
import { S } from '../web/ui/strings.js';
import { CHECKS_PATH } from '../web/checks.js';
import { AUDIT } from './audit.mjs';

let browser; let site;
const REPO = '/ada-example/demo';
const J = JSON.stringify;

before(async () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'shell-manifest.mjs')]);
  browser = await launch();
  site = await serveWeb();
});
after(async () => { await browser.close(); await site.close(); cleanup(); });

const go = async (page, path) => { await page.goto(site.url + path.slice(1)); };
const scheme = (page, value) => page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const dark = (page) => page.eval("(() => { const m = /\\d+/.exec(getComputedStyle(document.body).backgroundColor); return Number(m[0]) < 128; })()");
async function audit(page, where, found) {
  for (const value of ['light', 'dark']) {
    await scheme(page, value);
    await page.waitFor(`(() => { const m = /\\d+/.exec(getComputedStyle(document.body).backgroundColor); return (Number(m[0]) < 128) === ${value === 'dark'}; })()`, `the ${value} theme`);
    for (const line of await page.eval(AUDIT)) found.push(`${where} [${value}] ${line}`);
  }
  await scheme(page, 'light');
}

test('no screen fails the audit, in light or dark: names, labels, text contrast, headings, regions, target sizes', async () => {
  const page = await browser.open(null, { width: 1280, height: 900 });
  const found = [];
  await go(page, '/');
  await audit(page, 'landing', found);
  await page.goto(`${site.url}welcome`);
  await audit(page, 'welcome 1', found);
  await page.fill(await page.field(S.welcome.name), 'Ada Example');
  await page.fill(await page.field(S.welcome.email), 'ada@example.org');
  await page.click('button', S.common.continue);
  await audit(page, 'welcome 2', found);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${J(S.welcome.repoTitle)}`, 'the third step');
  await audit(page, 'welcome 3', found);
  await page.goto(`${site.url}new`);
  await audit(page, '/new', found);
  await page.fill(await page.field(S.newRepo.name), 'demo');
  await page.fill(await page.field(S.newRepo.description), 'A demonstration');
  await page.click('button', S.newRepo.create);
  await page.arrive(REPO);

  // One of everything.
  const onCommit = () => page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the commit');
  await go(page, `${REPO}/new/main`);
  await page.fill(await page.field(S.code.fileName), CHECKS_PATH);
  await page.fill('textarea', J({ checks: [{ name: 'unit', run: 'npm test', inputs: ['README.md'], tools: [{ run: 'node --version', expect: 'v' }] }, { name: 'lint', run: 'npm run lint', inputs: ['src'] }] }));
  await page.click('button', S.code.commitChanges);
  await onCommit();
  const commit = (await page.eval('location.pathname')).split('/').pop();
  const key = await page.eval(`(async () => { const at = (name) => import(${J(site.url)} + name); const identity = await at('identity.js'); const evidence = await at('evidence.js'); const store = await at('store.js');
    const head = (await store.getRefs('demo'))['refs/heads/main']; const [unit] = await evidence.expectedActions(head, head, ['unit']);
    await identity.recordCheck('demo', 'unit', unit, 'fail'); await identity.recordCheck('demo', 'unit', unit, 'pass'); return unit; })()`);
  for (const [n, title] of [[1, 'First task'], [2, 'Second task']]) {
    await go(page, `${REPO}/issues/new`);
    await page.fill(await page.field(S.issues.titleField), title);
    await page.fill('#main textarea', 'Some **detail**, and a list:\n\n- one\n- two\n\n> [!NOTE]\n> A note.\n\n`code` and [a link](https://example.org).');
    await page.click('button', S.issues.submit);
    await page.arrive(`${REPO}/issues/${n}`);
  }
  await page.fill('#main .comment-box textarea', 'A comment.');
  await page.click('#main .comment-box button', S.parts.comment);
  await page.waitFor("document.querySelectorAll('#main .timeline .comment').length === 1", 'the comment');
  await page.click('[data-close]');
  await page.waitFor("!!document.querySelector('[data-reopen]')", 'the closed issue');
  await go(page, `${REPO}/labels`);
  await page.click('#main .page-head button', S.issues.newLabel);
  // Three labels: a dark colour, a light one, and one in between, where neither white nor dark text reads without help.
  for (const [i, [name, color]] of [['bug', '#b60205'], ['idea', '#fef2c0'], ['help', '#e4572e']].entries()) {
    if (i) await page.click('#main .page-head button', S.issues.newLabel);
    await page.fill(await page.field(S.issues.labelName), name);
    await page.fill(await page.field(S.issues.color), color);
    await page.click('button', S.issues.createLabel);
    await page.waitFor(`document.querySelectorAll('#main .label-row').length === ${i + 1}`, `the label ${name}`);
  }
  await go(page, `${REPO}/milestones/new`);
  await page.fill(await page.field(S.issues.titleField), 'Version 1');
  await page.click('button', S.issues.createMilestone);
  await page.arrive(`${REPO}/milestones`);
  await go(page, `${REPO}/wiki/_new?title=Home`);
  await page.fill('#main textarea', '# Welcome\n\nSee [[Setup]].');
  await page.click('button', S.wiki.save);
  await page.arrive(`${REPO}/wiki/Home`);
  await go(page, `${REPO}/releases/new`);
  await page.fill(await page.field(S.releases.tag), 'v1');
  await page.fill(await page.field(S.releases.titleField), 'One');
  await page.fill('#main textarea', '## Changes\n\n- A start');
  await page.click('button', S.releases.publish);
  await page.arrive(`${REPO}/releases/tag/v1`);
  await go(page, `${REPO}/projects/new`);
  await page.fill(await page.field(S.projects.name), 'Roadmap');
  await page.click('button', S.projects.create);
  await page.arrive(`${REPO}/projects/1`);
  await page.eval(`[...document.querySelectorAll('[data-add] [role=menuitem]')].find((node) => node.textContent.trim() === '#1 First task').click()`);
  await page.waitFor("document.querySelectorAll('.board-card').length === 1", 'the card');

  const paths = ['/', '/explore', '/notifications', '/search?q=demo', '/issues', '/pulls', '/open', '/settings', '/settings/appearance', '/settings/security', '/settings/repositories', '/settings/storage', '/different', '/ada-example', '/nobody/nothing',
    ...['', '/tree/main/.holo', '/blob/main/README.md', '/blob/main/README.md?plain=1', '/blame/main/README.md', '/edit/main/README.md', '/new/main', '/commits/main', `/commit/${commit}`, '/branches', '/tags', '/search?q=demo', '/compare',
      '/issues', '/issues?q=is%3Aclosed', '/issues/1', '/issues/2', '/issues/new', '/labels', '/milestones', '/milestones/new', '/pulls', '/actions', `/actions/runs/${key}`, '/projects', '/projects/1', '/projects/new', '/releases', '/releases/new', '/releases/tag/v1',
      '/wiki', '/wiki/Home/_edit', '/wiki/Home/_history', '/wiki/Setup', '/activity', '/activity/contributors', '/activity/commits', '/settings', '/settings/collaborators', '/settings/branches', '/settings/branches/new', '/settings/remote'].map((rest) => REPO + rest)];
  for (const path of paths) {
    await go(page, path);
    await audit(page, path, found);
  }
  // With something open: a menu, the shortcuts dialog, the About dialog, the command palette.
  await go(page, REPO);
  await page.eval("document.querySelector('#header details.menu:last-of-type').open = true");
  await audit(page, 'account menu', found);
  await page.eval("document.querySelector('#header details.menu:last-of-type').open = false");
  await page.press('?');
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the shortcuts dialog');
  await audit(page, 'shortcuts dialog', found);
  await page.eval("document.querySelector('dialog[open]').close()");
  await page.click('#footer button', S.footer.about);
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the About dialog');
  await audit(page, 'about dialog', found);
  await page.eval("document.querySelector('dialog[open]').close()");
  await page.press('k', { ctrl: true });
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the palette');
  await audit(page, 'command palette', found);
  await page.eval("document.querySelector('dialog[open]').close()");

  // The same at phone width, where the layout changes.
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: false });
  for (const path of ['/', REPO, `${REPO}/issues/1`, `${REPO}/projects/1`, `${REPO}/actions`, `${REPO}/settings`]) {
    await go(page, path);
    await audit(page, `${path} at 360`, found);
  }
  assert.deepEqual(found, [], `${found.length} findings`);
  assert.deepEqual(page.errors, [], 'the page logged no errors');
  await page.close();
});

test('the page that says what is different: reached from the footer without signing in, eight points, each with a heading', async () => {
  const page = await browser.open(null, { width: 360, height: 740 });
  await go(page, '/');
  await page.click('#footer a', S.footer.different);
  await page.arrive('/different');
  assert.equal(await page.text('#main h1'), S.different.title);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#main section h2')].map((node) => node.textContent)"), Object.values(S.different.points).map((point) => point.title));
  assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), 'it fits at 360 px');
  assert.deepEqual(await page.eval(AUDIT), []);
  assert.deepEqual(page.errors, []);
  await page.close();
});
