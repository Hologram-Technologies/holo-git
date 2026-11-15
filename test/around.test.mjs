// Releases, the wiki, project boards and activity, driven in a real browser engine: each through its main path and one failure.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, root } from './helpers.mjs';
import { launch } from './browser.mjs';
import { serveWeb } from '../scripts/dev-web.mjs';
import { S } from '../web/ui/strings.js';

let browser; let site;
const REPO = '/ada-example/demo';

before(async () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'shell-manifest.mjs')]);
  browser = await launch();
  site = await serveWeb();
});
after(async () => { await browser.close(); await site.close(); cleanup(); });

async function withRepo(options) {
  const page = await browser.open(null, options);
  await page.goto(`${site.url}welcome`);
  await page.fill(await page.field(S.welcome.name), 'Ada Example');
  await page.fill(await page.field(S.welcome.email), 'ada@example.org');
  await page.click('button', S.common.continue);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.repoTitle)}`, 'the third step');
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'demo');
  await page.click('button', S.newRepo.create);
  await page.arrive(REPO);
  return page;
}
const go = async (page, path) => { await page.goto(site.url + path.slice(1)); };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'the page logged no errors');
const J = JSON.stringify;
const fieldError = (page, text, scope = '#main') => page.waitFor(`[...document.querySelectorAll(${J(`${scope} .field .error`)})].some((node) => !node.hidden && node.innerText.trim() === ${J(text)})`, `the field error "${text}"`);
const has = (page, selector, text) => page.waitFor(`[...document.querySelectorAll(${J(selector)})].some((node) => node.innerText.includes(${J(text)}))`, `"${text}" in ${selector}`);
// Choose an item of a menu, open or not.
const pick = (page, scope, text) => page.eval(`(() => { const item = [...document.querySelectorAll(${J(`${scope} [role=menuitem]`)})].find((node) => node.textContent.trim() === ${J(text)}); if (!item) throw new Error('no menu item ' + ${J(text)}); item.click(); })()`);
async function issue(page, title, number) {
  await go(page, `${REPO}/issues/new`);
  await page.fill(await page.field(S.issues.titleField), title);
  await page.click('button', S.issues.submit);
  await page.arrive(`${REPO}/issues/${number}`);
}

test('releases: published with notes, marked as a pre-release, edited and deleted; a missing, malformed or taken tag is refused at the field', async () => {
  const page = await withRepo();
  await page.click('#main nav.tabs a', S.repo.releases);
  await page.arrive(`${REPO}/releases`);
  await has(page, '#main .blankslate', S.releases.none);
  await page.click('#main .blankslate a', S.releases.new);
  await page.arrive(`${REPO}/releases/new`);
  await page.click('button', S.releases.publish);
  await fieldError(page, S.releases.tagBlank);
  await fieldError(page, S.releases.titleBlank);
  await page.fill(await page.field(S.releases.tag), 'has space');
  await page.click('button', S.releases.publish);
  await fieldError(page, S.releases.tagInvalid);
  await page.fill(await page.field(S.releases.tag), 'v1.0.0');
  await page.fill(await page.field(S.releases.titleField), 'First release');
  await page.fill('#main textarea', '## Changes\n\n- A start');
  await page.click('button', S.releases.publish);
  await page.arrive(`${REPO}/releases/tag/v1.0.0`);
  await has(page, '#main .release h2', 'Changes');
  assert.match(await page.text('#main .release .box-head'), new RegExp(`First release\\s*${S.releases.latest}`));

  await go(page, `${REPO}/releases/new`);
  await page.fill(await page.field(S.releases.tag), 'v1.0.0');
  await page.fill(await page.field(S.releases.titleField), 'Again');
  await page.click('button', S.releases.publish);
  await fieldError(page, S.releases.tagTaken);
  await page.fill(await page.field(S.releases.tag), 'v1.1.0-rc1');
  await page.fill(await page.field(S.releases.titleField), 'Candidate');
  await page.click('#prerelease');
  await page.click('button', S.releases.publish);
  await page.arrive(`${REPO}/releases/tag/v1.1.0-rc1`);
  await has(page, '#main .release .box-head', S.releases.prerelease);
  await go(page, `${REPO}/releases`);
  assert.equal(await page.eval("document.querySelectorAll('#main .release').length"), 2);
  assert.equal(await page.eval(`[...document.querySelectorAll('#main .release')].filter((node) => node.querySelector('.label.success')).map((node) => node.dataset.release).join()`), 'v1.0.0');

  await go(page, `${REPO}/releases/tag/v1.0.0`);
  await page.click('#main .release a', S.releases.edit);
  await page.arrive(`${REPO}/releases/edit/v1.0.0`);
  await page.fill(await page.field(S.releases.titleField), 'First release, corrected');
  await page.click('button', S.releases.update);
  await page.arrive(`${REPO}/releases/tag/v1.0.0`);
  await has(page, '#main .release .box-head', 'First release, corrected');
  await page.click('[data-delete-release]');
  await page.waitFor("!!document.querySelector('dialog[open] [data-confirm]')", 'the confirmation');
  await page.click('dialog[open] [data-confirm]');
  await page.arrive(`${REPO}/releases`);
  assert.equal(await page.eval("[...document.querySelectorAll('#main .release')].map((node) => node.dataset.release).join()"), 'v1.1.0-rc1');
  await go(page, `${REPO}/releases/tag/v1.0.0`);
  await has(page, '#main .blankslate', S.releases.notFound);
  noErrors(page);
  await page.close();
});

test('wiki: a first page, a link to a page that is then written, an edit with its history, and a deletion; a taken or malformed title is refused', async () => {
  const page = await withRepo();
  await page.click('#main nav.tabs a', S.repo.wiki);
  await page.arrive(`${REPO}/wiki`);
  await page.click('#main .blankslate a', S.wiki.createFirst);
  await page.arrive(`${REPO}/wiki/_new`);
  assert.equal(await page.eval("document.querySelector('#main input').value"), S.wiki.home);
  await page.fill('#main textarea', '# Welcome\n\nSee [[Setup guide]].');
  await page.click('button', S.wiki.save);
  await page.arrive(`${REPO}/wiki/Home`);
  await page.click('#main .markdown a', 'Setup guide');
  await page.arrive(`${REPO}/wiki/Setup%20guide`);
  await has(page, '#main .blankslate', S.wiki.missing('Setup guide'));
  await page.click('#main .blankslate a', S.wiki.createThis);
  await page.arrive(`${REPO}/wiki/_new`);
  assert.equal(await page.eval("document.querySelector('#main input').value"), 'Setup guide');
  await page.fill('#main textarea', 'Install, then run.');
  await page.click('button', S.wiki.save);
  await page.arrive(`${REPO}/wiki/Setup%20guide`);
  await has(page, '#main .markdown', 'Install, then run.');
  assert.equal(await page.eval("[...document.querySelectorAll('#main aside .box-row')].map((node) => node.innerText.trim()).join()"), 'Home,Setup guide');

  await page.click('#main .page-head a', S.wiki.newPage);
  await page.arrive(`${REPO}/wiki/_new`);
  await page.click('button', S.wiki.save);
  await fieldError(page, S.wiki.titleBlank);
  await page.fill(await page.field(S.wiki.pageTitle), 'a/b');
  await page.click('button', S.wiki.save);
  await fieldError(page, S.wiki.titleInvalid);
  await page.fill(await page.field(S.wiki.pageTitle), 'Home');
  await page.click('button', S.wiki.save);
  await fieldError(page, S.wiki.titleTaken);

  await go(page, `${REPO}/wiki/Home/_edit`);
  await page.fill('#main textarea', '# Welcome\n\nRewritten.');
  await page.click('button', S.wiki.save);
  await page.arrive(`${REPO}/wiki/Home`);
  await has(page, '#main .markdown', 'Rewritten.');
  await has(page, '#main', S.wiki.revisions(2));
  await page.click('#main .page-head a', S.wiki.history);
  await page.arrive(`${REPO}/wiki/Home/_history`);
  assert.equal(await page.eval("document.querySelectorAll('#main .box-row').length"), 2);
  await page.eval("[...document.querySelectorAll('#main .box-row a')].pop().click()");
  await has(page, '#main .flash', S.wiki.older);
  await has(page, '#main .markdown', 'Setup guide');

  await go(page, `${REPO}/wiki/Setup%20guide/_edit`);
  await page.click('[data-delete-page]');
  await page.waitFor("!!document.querySelector('dialog[open] [data-confirm]')", 'the confirmation');
  await page.click('dialog[open] [data-confirm]');
  await page.arrive(`${REPO}/wiki`);
  assert.equal(await page.eval("[...document.querySelectorAll('#main aside .box-row')].map((node) => node.innerText.trim()).join()"), 'Home');
  noErrors(page);
  await page.close();
});

test('projects: a board with its columns; cards added, moved by menu and by dragging, and removed; columns added, renamed and deleted; a blank name is refused', async () => {
  const page = await withRepo();
  await issue(page, 'First task', 1);
  await issue(page, 'Second task', 2);
  await page.click('#main nav.tabs a', S.repo.projects);
  await page.arrive(`${REPO}/projects`);
  await has(page, '#main .blankslate', S.projects.none);
  await page.click('#main .page-head a', S.projects.new);
  await page.arrive(`${REPO}/projects/new`);
  await page.click('button', S.projects.create);
  await fieldError(page, S.projects.nameBlank);
  await page.fill(await page.field(S.projects.name), 'Roadmap');
  await page.click('button', S.projects.create);
  await page.arrive(`${REPO}/projects/1`);
  const columns = () => page.eval("[...document.querySelectorAll('.board-column')].map((node) => node.dataset.column + ':' + [...node.querySelectorAll('.board-card .title')].map((card) => card.textContent).join('+')).join(' | ')");
  const board = async (expected) => { await page.waitFor(`[...document.querySelectorAll('.board-column')].map((node) => node.dataset.column + ':' + [...node.querySelectorAll('.board-card .title')].map((card) => card.textContent).join('+')).join(' | ') === ${J(expected)}`, `the board ${expected}`).catch(async (error) => { throw new Error(`${error.message}; it shows ${await columns()}`); }); };
  const { todo, doing, done } = S.projects.columns;
  await board(`${todo}: | ${doing}: | ${done}:`);
  await pick(page, `[data-column="${todo}"] [data-add]`, '#1 First task');
  await board(`${todo}:First task | ${doing}: | ${done}:`);
  await pick(page, `[data-column="${todo}"] [data-add]`, '#2 Second task');
  await board(`${todo}:First task+Second task | ${doing}: | ${done}:`);
  await pick(page, `[data-column="${todo}"] .board-card [data-card-menu]`, S.projects.moveTo(doing));
  await board(`${todo}:Second task | ${doing}:First task | ${done}:`);
  // Drag the second card onto the top half of the first: it lands above it.
  await page.eval(`(() => { const card = document.querySelector('[data-column="${todo}"] .board-card'); const list = document.querySelector('[data-column="${doing}"] .board-cards'); const data = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: data, bubbles: true })); const r = list.querySelector('.board-card').getBoundingClientRect();
    list.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientY: r.top + 2 })); })()`);
  await board(`${todo}: | ${doing}:Second task+First task | ${done}:`);

  await page.click('[data-add-column]');
  await page.waitFor("!!document.querySelector('dialog[open] input')", 'the column dialog');
  await page.click('dialog[open] button', S.projects.add);
  await fieldError(page, S.projects.columnBlank, 'dialog[open]');
  await page.fill('dialog[open] input', 'Review');
  await page.click('dialog[open] button', S.projects.add);
  await board(`${todo}: | ${doing}:Second task+First task | ${done}: | Review:`);
  await pick(page, `[data-column="${todo}"] [data-column-menu]`, S.projects.rename);
  await page.waitFor("!!document.querySelector('dialog[open] input')", 'the rename dialog');
  await page.fill('dialog[open] input', 'Backlog');
  await page.click('dialog[open] button', S.projects.rename);
  await board(`Backlog: | ${doing}:Second task+First task | ${done}: | Review:`);
  await pick(page, `[data-column="${doing}"] .board-card [data-card-menu]`, S.projects.remove);
  await board(`Backlog: | ${doing}:First task | ${done}: | Review:`);
  // Deleting a column takes its cards off the board; they can be added again.
  await pick(page, `[data-column="${doing}"] [data-column-menu]`, S.projects.deleteColumn);
  await board(`Backlog: | ${done}: | Review:`);
  await pick(page, '[data-column="Review"] [data-add]', '#1 First task');
  await board(`Backlog: | ${done}: | Review:First task`);

  await pick(page, '[data-project-menu]', S.projects.close);
  await has(page, '#main .page-head .label', S.projects.closed);
  await go(page, `${REPO}/projects`);
  await has(page, '#main .blankslate', S.projects.none);
  await go(page, `${REPO}/projects?state=closed`);
  await has(page, '#main .box-row', 'Roadmap');
  await has(page, '#main .box-row', S.projects.items(1));
  await go(page, `${REPO}/projects/7`);
  await has(page, '#main .blankslate', S.projects.notFound);
  noErrors(page);
  await page.close();
});

test('activity: the period in numbers, who committed, and commits by week; an unknown page is not found; nothing overflows at 360 px', async () => {
  const page = await withRepo({ width: 360, height: 740 });
  await go(page, `${REPO}/new/main`);
  await page.fill(await page.field(S.code.fileName), 'notes.txt');
  await page.fill('textarea', 'one\n');
  await page.click('button', S.code.commitChanges);
  await page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the commit');
  await issue(page, 'First task', 1);
  await go(page, `${REPO}/wiki/_new?title=Home`);
  await page.fill('#main textarea', 'Hello.');
  await page.click('button', S.wiki.save);
  await page.arrive(`${REPO}/wiki/Home`);
  await go(page, `${REPO}/projects/new`);
  await page.fill(await page.field(S.projects.name), 'Roadmap');
  await page.click('button', S.projects.create);
  await page.arrive(`${REPO}/projects/1`);
  await go(page, `${REPO}/releases/new`);
  await page.fill(await page.field(S.releases.tag), 'v1');
  await page.fill(await page.field(S.releases.titleField), 'One');
  await page.click('button', S.releases.publish);
  await page.arrive(`${REPO}/releases/tag/v1`);

  await go(page, `${REPO}/activity`);
  await page.waitFor("!!document.querySelector('[data-stat]')", 'the numbers');
  assert.equal(await page.eval("[...document.querySelectorAll('[data-stat]')].map((node) => node.dataset.stat + '=' + node.querySelector('strong').textContent.trim()).join()"), 'merged=0,opened=0,closed=0,new=1,released=1');
  assert.equal(await page.text('[data-summary]'), S.activity.summary(1, 2, 'main'));
  await go(page, `${REPO}/activity?period=1`);
  await has(page, '[data-period] summary', S.activity.periods[1]);
  await go(page, `${REPO}/activity/contributors`);
  await has(page, '[data-contributor="Ada Example"]', S.activity.commitCount(2));
  await go(page, `${REPO}/activity/commits`);
  assert.equal((await page.text('[data-year]')).startsWith(S.activity.yearTotal(2)), true);
  assert.equal(await page.eval("[...document.querySelectorAll('.bars i')].reduce((sum, bar) => sum + Number(bar.dataset.count), 0)"), 2);
  await go(page, `${REPO}/activity/nothing`);
  await has(page, '#main', S.notFound.title);

  for (const path of ['/releases', '/releases/new', '/releases/tag/v1', '/wiki', '/wiki/Home/_edit', '/wiki/Home/_history', '/projects', '/projects/1', '/activity', '/activity/contributors', '/activity/commits']) {
    await go(page, REPO + path);
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  noErrors(page);
  await page.close();
});
