// The issue screens, driven in a real browser engine: each through its main path and one failure.
// What a person without write access may do is tested on the operations themselves, in test/issues.test.mjs.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from './helpers.mjs';
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
after(async () => { await browser.close(); await site.close(); });

// A signed-in page with a new repository called demo.
async function withRepo(options, name = 'demo') {
  const page = await browser.open(null, options);
  await page.goto(`${site.url}welcome`);
  await page.fill(await page.field(S.welcome.name), 'Ada Example');
  await page.fill(await page.field(S.welcome.email), 'ada@example.org');
  await page.click('button', S.common.continue);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.repoTitle)}`, 'the third step');
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), name);
  await page.click('button', S.newRepo.create);
  await page.arrive(`/ada-example/${name}`);
  return page;
}
const go = async (page, path) => { await page.goto(site.url + path.slice(1)); };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'the page logged no errors');
const count = (page, selector) => page.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const sees = (page, selector, text) => page.waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((n) => n.textContent.trim() === ${JSON.stringify(text)})`, `${selector} reading "${text}"`);
async function newIssue(page, title, body = '', repo = REPO) {
  await go(page, `${repo}/issues/new`);
  await page.fill(await page.field(S.issues.titleField), title);
  if (body) await page.fill('#issue-body', body);
  await page.click('button', S.issues.submit);
  await page.waitFor(`/\\/issues\\/\\d+$/.test(document.documentElement.dataset.screen || '')`, 'the new issue');
  return page.eval("location.pathname.split('/').pop()");
}

test('an issue: opened from an empty list, discussed, renamed, closed and reopened; a blank title and an unknown number are refused', async () => {
  const page = await withRepo();
  await page.click('#main nav.tabs a', S.repo.issues);
  await page.arrive(`${REPO}/issues`);
  assert.equal(await page.text('#main .blankslate h3'), S.issues.none);
  await page.eval('document.activeElement.blur()');
  await page.press('c');
  await page.arrive(`${REPO}/issues/new`);
  // Failure: no title.
  await page.click('button', S.issues.submit);
  const title = await page.field(S.issues.titleField);
  assert.equal(await page.text(`${title}-error`), S.issues.titleBlank);
  await page.fill(title, 'Formatting drops leading zeros');
  await page.fill('#issue-body', 'Steps to reproduce:\n\n- [x] call `format3(7)`\n- [ ] compare with the guide\n\nSee #1.');
  await page.click('button', S.issues.submit);
  await page.arrive(`${REPO}/issues/1`);
  assert.equal(await page.text('.issue-title h1'), 'Formatting drops leading zeros #1');
  assert.equal(await page.text('.issue-meta .state'), S.common.opened);
  assert.equal(await count(page, '.comment .markdown li.md-task'), 2, 'the description is rendered');
  assert.equal(await page.eval("document.querySelector('.comment .markdown a').getAttribute('href')"), `${REPO}/issues/1`, 'a number is a link');
  assert.match(await page.text('.comment .box-head'), new RegExp(S.common.owner));
  await page.waitFor("!!document.querySelector('#main nav.tabs a[data-key=issues] .counter')", 'the count on the tab');
  assert.equal(await page.text('#main nav.tabs a[data-key=issues] .counter'), '1');

  // A comment, previewed first.
  await page.fill('.comment-box textarea', 'Confirmed. The padding is a **space**.');
  await page.click('.comment-box a', S.parts.preview);
  assert.equal(await page.text('.comment-box .preview strong'), 'space');
  await page.click('.comment-box a', S.parts.write);
  await page.click('.comment-box button', S.parts.comment);
  await page.waitFor("document.querySelectorAll('.comment').length === 2", 'the comment');
  assert.match(await page.text('.issue-meta'), new RegExp(S.issues.commentCount(1)));
  // Failure: an empty comment is not sent.
  await page.click('.comment-box button', S.parts.comment);
  assert.equal(await count(page, '.comment'), 2);

  await page.click('.issue-title button', S.issues.edit);
  await page.fill('.issue-title input', 'Formatting drops zeros');
  await page.press('Enter');
  await sees(page, '.issue-title h1', 'Formatting drops zeros #1');
  assert.match(await page.text('.timeline'), new RegExp(S.issues.changedTitle));

  await page.click('[data-close]');
  await sees(page, '.issue-meta .state', S.common.closed);
  assert.match(await page.text('.timeline'), new RegExp(S.issues.closedThis));
  await page.click('[data-reopen]');
  await sees(page, '.issue-meta .state', S.common.opened);
  await page.reload();
  assert.equal(await page.text('.issue-title h1'), 'Formatting drops zeros #1', 'it is all still there after a reload');
  assert.equal(await count(page, '.comment'), 2);

  await go(page, `${REPO}/issues/99`);
  assert.equal(await page.text('#main .blankslate h3'), S.issues.notFound);
  noErrors(page);
  await page.close();
});

test('labels and milestones: made, put on an issue, counted, and removed; bad names and colours are reported at the field', async () => {
  const page = await withRepo();
  await newIssue(page, 'Formatting drops leading zeros');
  await go(page, `${REPO}/labels`);
  assert.equal(await page.text('#main .blankslate h3'), S.issues.noLabelsYet);
  await page.click('.page-head button', S.issues.newLabel);
  // Failures: blank name, then a colour that is not one.
  await page.click('button', S.issues.createLabel);
  const name = await page.field(S.issues.labelName);
  assert.equal(await page.text(`${name}-error`), S.issues.labelNameBlank);
  await page.fill(name, 'bug');
  const color = await page.field(S.issues.color);
  await page.fill(color, 'red');
  await page.click('button', S.issues.createLabel);
  await page.waitFor(`document.querySelector('${color}-error').innerText === ${JSON.stringify(S.issues.colorInvalid)}`, 'the colour message');
  await page.fill(color, '#d73a4a');
  await page.click('button', S.issues.createLabel);
  await sees(page, '.label-row .label', 'bug');
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.label-row .label')).backgroundColor"), 'rgb(215, 58, 74)');

  await go(page, `${REPO}/milestones/new`);
  await page.click('button', S.issues.createMilestone);
  const title = await page.field(S.issues.titleField);
  assert.equal(await page.text(`${title}-error`), S.issues.titleBlank);
  await page.fill(title, 'v1.0');
  await page.eval(`document.querySelector('${await page.field(S.issues.dueDate)}').value = '2027-01-31'`);
  await page.click('button', S.issues.createMilestone);
  await page.arrive(`${REPO}/milestones`);
  assert.match(await page.text('.milestone-row'), /v1\.0/);
  assert.match(await page.text('.milestone-row'), /January 31, 2027/);
  assert.match(await page.text('.milestone-row'), new RegExp(S.issues.complete(0)));

  await go(page, `${REPO}/issues/1`);
  await page.click('[data-pick=labels] summary');
  await page.click('[data-pick=labels] button', 'bug');
  await sees(page, '.side-section .label', 'bug');
  await page.click('[data-pick=milestone] summary');
  await page.click('[data-pick=milestone] button', 'v1.0');
  await sees(page, '.side-section a', 'v1.0');
  assert.match(await page.text('.timeline'), new RegExp(S.issues.addedToMilestone('v1.0')));
  await page.click('.side-section summary');
  await page.click('.side-section button', S.issues.assignMe);
  await page.waitFor(`document.querySelector('.side-section').textContent.includes(${JSON.stringify(S.common.you)})`, 'the assignee');

  // Followed without the pointer: the sidebar has just been redrawn, and a pointer aimed at where the link was can miss it.
  await page.eval("[...document.querySelectorAll('.side-section a')].find((a) => a.textContent.trim() === 'v1.0').click()");
  await page.waitFor(`/\\/milestone\\/[0-9a-f]{32}$/.test(document.documentElement.dataset.screen || '')`, 'the milestone');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['Formatting drops leading zeros']);
  await go(page, `${REPO}/issues/1`);
  await page.click('[data-close]');
  await sees(page, '.issue-meta .state', S.common.closed);
  await go(page, `${REPO}/milestones`);
  assert.match(await page.text('.milestone-row'), new RegExp(S.issues.complete(100)));
  await page.click('[data-toggle="v1.0"]');
  await page.waitFor(`document.querySelector('#main .blankslate h3') && document.querySelector('#main .blankslate h3').textContent === ${JSON.stringify(S.issues.noMilestonesYet)}`, 'the milestone to leave the open list');

  await go(page, `${REPO}/labels`);
  await page.click('[data-delete="bug"]');
  await page.waitFor("!document.querySelector('.label-row')", 'the label to go');
  await go(page, `${REPO}/issues/1`);
  assert.equal(await count(page, '.side-section .label'), 0, 'a deleted label leaves its issues');
  await go(page, `${REPO}/milestone/${'0'.repeat(32)}`);
  assert.equal(await page.text('#main .blankslate h3'), S.issues.milestoneNotFound);
  noErrors(page);
  await page.close();
});

test('the list: open and closed counts, filters by label and words, sorting; a search with no match says so; and the list across repositories', async () => {
  const page = await withRepo();
  await newIssue(page, 'Formatting drops leading zeros', 'Padding is wrong.');
  await newIssue(page, 'Add a verbose option');
  await newIssue(page, 'How do I run the tests?');
  await page.click('[data-close]');
  await sees(page, '.issue-meta .state', S.common.closed);
  await go(page, `${REPO}/labels`);
  await page.click('.page-head button', S.issues.newLabel);
  await page.fill(await page.field(S.issues.labelName), 'good first issue');
  await page.click('button', S.issues.createLabel);
  await sees(page, '.label-row .label', 'good first issue');
  await go(page, `${REPO}/issues/2`);
  await page.click('[data-pick=labels] summary');
  await page.click('[data-pick=labels] button', 'good first issue');
  await sees(page, '.side-section .label', 'good first issue');

  await go(page, `${REPO}/issues`);
  const titles = () => page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)");
  assert.deepEqual(await titles(), ['Add a verbose option', 'Formatting drops leading zeros'], 'open issues, newest first');
  assert.equal((await page.text('[data-count=open]')).trim(), S.issues.openCount(2));
  assert.equal((await page.text('[data-count=closed]')).trim(), S.issues.closedCount(1));
  await page.click('[data-count=closed]');
  await page.waitFor("location.search.includes('closed')", 'the closed list');
  await page.waitFor("document.querySelectorAll('.box-row a.title').length === 1", 'one closed issue');
  assert.deepEqual(await titles(), ['How do I run the tests?']);

  await go(page, `${REPO}/issues`);
  await page.click('.box-head details.menu summary');
  await page.click('.box-head details.menu a', 'good first issue');
  await page.waitFor("decodeURIComponent(location.search).includes('label:\"good first issue\"')", 'the label in the search');
  await page.waitFor("document.querySelectorAll('.box-row a.title').length === 1", 'one labelled issue');
  assert.deepEqual(await titles(), ['Add a verbose option']);
  await page.fill('[data-issue-search]', 'is:open padding sort:oldest');
  await page.press('Enter');
  await page.waitFor("document.querySelectorAll('.box-row a.title').length === 1 && document.querySelector('.box-row a.title').textContent.startsWith('Formatting')", 'the word search, in title and description');
  await page.fill('[data-issue-search]', 'is:open sort:oldest');
  await page.press('Enter');
  await page.waitFor("document.querySelectorAll('.box-row a.title').length === 2 && document.querySelector('.box-row a.title').textContent.startsWith('Formatting')", 'oldest first');
  // Failure: nothing matches.
  await page.fill('[data-issue-search]', 'is:open zzzqqq');
  await page.press('Enter');
  await page.waitFor(`document.querySelector('#main .blankslate h3') && document.querySelector('#main .blankslate h3').textContent === ${JSON.stringify(S.issues.noMatch)}`, 'the no-match line');

  // Across repositories: a second repository with an issue of its own.
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'other');
  await page.click('button', S.newRepo.create);
  await page.arrive('/ada-example/other');
  await newIssue(page, 'An issue elsewhere', '', '/ada-example/other');
  await page.click('#header a', S.header.issues);
  await page.arrive('/issues');
  assert.deepEqual((await titles()).sort(), ['Add a verbose option', 'An issue elsewhere', 'Formatting drops leading zeros']);
  assert.match(await page.text('.box'), /ada-example\/other/);
  await page.click('.sidenav a', S.issues.scopes.assigned);
  await page.waitFor(`document.querySelector('#main .blankslate h3') && document.querySelector('#main .blankslate h3').textContent === ${JSON.stringify(S.issues.noneHere)}`, 'nothing assigned');
  noErrors(page);
  await page.close();
});

test('at 360 px wide the issue screens do not overflow sideways', async () => {
  const page = await withRepo({ width: 360, height: 740 });
  await newIssue(page, 'A fairly long issue title that has to wrap on a narrow screen without pushing the page wider', 'Body with a long `inline code span that should wrap rather than overflow the viewport` here.');
  await go(page, `${REPO}/milestones/new`);
  await page.fill(await page.field(S.issues.titleField), 'v1.0');
  await page.click('button', S.issues.createMilestone);
  await page.arrive(`${REPO}/milestones`);
  for (const path of [`${REPO}/issues`, `${REPO}/issues/1`, `${REPO}/issues/new`, `${REPO}/labels`, `${REPO}/milestones`, '/issues']) {
    await go(page, path);
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  noErrors(page);
  await page.close();
});
