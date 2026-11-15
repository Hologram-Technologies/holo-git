// The Actions screens, driven in a real browser engine: checks described in the repository, results reported for them, filters, one run, and what is not there.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, root } from './helpers.mjs';
import { launch } from './browser.mjs';
import { serveWeb } from '../scripts/dev-web.mjs';
import { S } from '../web/ui/strings.js';
import { CHECKS_PATH } from '../web/checks.js';

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
const has = (page, selector, text) => page.waitFor(`[...document.querySelectorAll(${J(selector)})].some((node) => node.innerText.includes(${J(text)}))`, `"${text}" in ${selector}`);
const onCommit = (page) => page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the commit');
const standing = (page) => page.eval("[...document.querySelectorAll('#main [data-check]')].map((node) => node.dataset.check + '=' + node.dataset.state).join()");
const results = (page) => page.eval("[...document.querySelectorAll('#main [data-run]')].map((node) => node.dataset.run + '=' + node.dataset.result).join()");

test('actions: nothing set up; checks described in a file; results reported, filtered and opened; a result for content no branch has now; an unknown address', async () => {
  const page = await browser.open(null);
  await page.goto(`${site.url}welcome`);
  await page.fill(await page.field(S.welcome.name), 'Ada Example');
  await page.fill(await page.field(S.welcome.email), 'ada@example.org');
  await page.click('button', S.common.continue);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${J(S.welcome.repoTitle)}`, 'the third step');
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'demo');
  await page.click('button', S.newRepo.create);
  await page.arrive(REPO);

  await page.click('#main nav.tabs a', S.repo.actions);
  await page.arrive(`${REPO}/actions`);
  await has(page, '#main .blankslate', S.actions.none);
  await has(page, '#main .blankslate code', CHECKS_PATH);

  // An issue, so the log knows this person's name; then the checks file.
  await go(page, `${REPO}/issues/new`);
  await page.fill(await page.field(S.issues.titleField), 'First task');
  await page.click('button', S.issues.submit);
  await page.arrive(`${REPO}/issues/1`);
  await go(page, `${REPO}/new/main`);
  await page.fill(await page.field(S.code.fileName), CHECKS_PATH);
  await page.fill('textarea', J({ checks: [{ name: 'unit', run: 'npm test', cwd: 'src', inputs: ['src'], tools: [{ run: 'node --version', expect: 'v' }], env: ['CI'] }, { name: 'lint', run: 'npm run lint', inputs: ['README.md'] }] }));
  await page.click('button', S.code.commitChanges);
  await onCommit(page);
  await go(page, `${REPO}/actions`);
  await has(page, '#main .box-head', S.actions.statusOn('main'));
  assert.equal(await standing(page), 'unit=waiting,lint=waiting');
  await has(page, '#main .blankslate', S.actions.noResults);

  // Results arrive the way a runner sends them: signed by someone with write access, under the address of the content checked.
  const keys = await page.eval(`(async () => { const at = (name) => import(${J(site.url)} + name); const identity = await at('identity.js'); const evidence = await at('evidence.js'); const store = await at('store.js');
    const head = (await store.getRefs('demo'))['refs/heads/main']; const [unit, lint] = await evidence.expectedActions(head, head, ['unit', 'lint']);
    await identity.recordCheck('demo', 'unit', unit, 'fail'); await identity.recordCheck('demo', 'unit', unit, 'pass'); await identity.recordCheck('demo', 'lint', lint, 'fail'); return { unit, lint }; })()`);
  await go(page, `${REPO}/actions`);
  assert.equal(await standing(page), 'unit=pass,lint=fail');
  assert.equal(await results(page), 'lint=fail,unit=pass,unit=fail');
  await has(page, '#main [data-run] .meta', S.actions.reportedBy('Ada Example'));
  await has(page, '#main [data-run] .aside', 'main');
  await page.eval(`[...document.querySelectorAll('[data-filter="status"] [role=menuitem]')].find((node) => node.textContent.trim() === ${J(S.actions.states.fail)}).click()`);
  await page.waitFor("location.search === '?status=fail' && document.querySelectorAll('#main [data-run]').length === 2", 'the failed results');
  assert.equal(await results(page), 'lint=fail,unit=fail');
  await page.click('#main .sidenav a', 'lint');
  await page.waitFor("document.querySelectorAll('#main [data-run]').length === 1", 'one check');
  assert.equal(await standing(page), 'lint=fail');
  await go(page, `${REPO}/actions?check=lint&status=pass`);
  await has(page, '#main .blankslate', S.actions.noMatch);
  await page.click('#main .blankslate a', S.actions.clear);
  await page.waitFor("document.querySelectorAll('#main [data-run]').length === 3", 'every result again');
  await go(page, `${REPO}/actions?branch=main&person=nobody`);
  await has(page, '#main .blankslate', S.actions.noMatch);

  // One run: what it ran, what it reads, that it kept no output, and both results for the same content.
  await go(page, `${REPO}/actions`);
  await page.click('#main [data-check="unit"] a', 'unit');
  await page.arrive(`${REPO}/actions/runs/${keys.unit}`);
  const text = await page.text('#main');
  for (const part of ['npm test', 'node --version', 'src', 'CI', S.actions.noLog, S.actions.states.pass, S.actions.appliesTo, S.actions.earlier]) assert.ok(text.includes(part), `the run shows ${part}`);
  assert.equal(await page.eval("[...document.querySelectorAll('#main [data-earlier]')].map((node) => node.dataset.earlier).join()"), 'pass,fail');
  assert.equal(await page.eval("document.querySelectorAll('#main [data-step]').length"), 2);

  // Change what lint reads: its old result no longer speaks for the branch, and the screen says so.
  await go(page, `${REPO}/edit/main/README.md`);
  await page.fill('textarea', '# demo\n\nChanged.\n');
  await page.click('button', S.code.commitChanges);
  await onCommit(page);
  await go(page, `${REPO}/actions`);
  assert.equal(await standing(page), 'unit=pass,lint=waiting');
  assert.equal(await results(page), 'lint=fail,unit=pass,unit=fail');
  await go(page, `${REPO}/actions/runs/${keys.lint}`);
  await has(page, '#main [data-run-meta]', S.actions.noBranch);
  await has(page, '#main', S.actions.describedNow('main'));

  await go(page, `${REPO}/actions/runs/${'f'.repeat(64)}`);
  await has(page, '#main .blankslate', S.actions.notFound);
  await go(page, `${REPO}/actions/nothing`);
  await has(page, '#main', S.notFound.title);

  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: false });
  for (const path of ['/actions', '/actions?status=fail', `/actions/runs/${keys.unit}`, `/actions/runs/${keys.lint}`]) {
    await go(page, REPO + path);
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  assert.deepEqual(page.errors, [], 'the page logged no errors');
  await page.close();
});
