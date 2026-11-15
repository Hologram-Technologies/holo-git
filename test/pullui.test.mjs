// The pull request screens, driven in a real browser engine: each through its main path and one failure.
// What reviewers other than the author may do is tested on the operations, in test/reviews.test.mjs:
// one browser is one person, so here the author is also the only reviewer.

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
const count = (page, selector) => page.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const sees = (page, selector, text) => page.waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((n) => n.textContent.trim() === ${JSON.stringify(text)})`, `${selector} reading "${text}"`);
const onCommit = (page) => page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the commit');
// Change a file through the editor: directly on main, or as a pull request.
async function change(page, path, text, message, { propose } = {}) {
  await go(page, `${REPO}/edit/main/${path}`);
  await page.fill('textarea', text);
  await page.fill(await page.field(S.code.commitMessage), message);
  if (propose) await page.eval("document.getElementById('how-propose').click()");
  await page.click('button', S.code.commitChanges);
  if (propose) await page.arrive(`${REPO}/pulls`); else await onCommit(page);
}

test('a pull request: proposed, discussed, commented on at a line, reviewed, and merged; the list and every tab show it', async () => {
  const page = await withRepo();
  await go(page, `${REPO}/pulls`);
  assert.equal(await page.text('#main .blankslate h2'), S.pulls.none);
  await change(page, 'README.md', '# demo\n\nNow with more words.\nAnd a second line.\n', 'Say more in the README', { propose: true });
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['Say more in the README']);
  assert.equal((await page.text('[data-count=open]')).trim(), S.issues.openCount(1));
  await page.click('.box-row a.title');
  await page.arrive(`${REPO}/pull/1`);
  assert.equal(await page.text('.issue-title h1'), 'Say more in the README #1');
  assert.equal(await page.text('.issue-meta .state'), S.common.opened);
  assert.match(await page.text('.issue-meta'), new RegExp(S.pulls.wantsToMerge(1)));
  assert.equal(await page.text('[data-fact=branch] strong'), S.pulls.noConflicts);
  assert.equal(await page.exists('[data-fact=review]'), false, 'no rule, so no review row');

  await page.fill('.comment-box textarea', 'Ready for a look.');
  await page.click('.comment-box button', S.parts.comment);
  await page.waitFor("document.querySelectorAll('.comment').length === 2", 'the comment');

  // Files changed: a comment on a line, a reply, and settling it.
  await page.click('nav.tabs a', S.pulls.files);
  await page.arrive(`${REPO}/pull/1/files`);
  assert.equal(await count(page, 'table.diff tr.add'), 3, 'a blank line and two lines of text');
  await page.eval(`document.querySelector('[data-line="README.md:new:3"]').click()`);
  await page.fill('tr.line-form textarea', 'Why "more words"?');
  await page.click('tr.line-form button', S.pulls.addComment);
  await page.waitFor("!!document.querySelector('tr.line-thread')", 'the conversation under the line');
  assert.equal(await page.eval("document.querySelector('tr.line-thread').previousElementSibling.querySelector('td.text').textContent"), '+Now with more words.'.slice(1), 'it sits under the line it is about');
  await page.fill('tr.line-thread input', 'Because there are more.');
  await page.press('Enter');
  await page.waitFor("document.querySelectorAll('tr.line-thread .thread-entry').length === 2", 'the reply');
  // Failure: an empty line comment is not sent.
  await page.eval(`document.querySelector('[data-line="README.md:new:4"]').click()`);
  await page.click('tr.line-form button', S.pulls.addComment);
  assert.equal(await count(page, 'tr.line-thread'), 1);
  await page.click('tr.line-form button', S.common.cancel);

  // Viewed folds the file and is remembered.
  await page.eval("document.querySelector('.viewed input').click()");
  assert.equal(await page.eval("document.querySelector('.diff-file').open"), false);
  await page.reload();
  assert.equal(await page.eval("document.querySelector('.diff-file').open"), false, 'remembered after a reload');
  assert.equal(await page.eval("document.querySelector('.viewed input').checked"), true);

  // A review with a summary.
  await page.click('[data-review]');
  await page.fill('dialog textarea', 'One question on line 3, otherwise fine.');
  await page.click('dialog button', S.pulls.submitReview);
  await page.arrive(`${REPO}/pull/1`);
  assert.match(await page.text('.timeline'), new RegExp(S.pulls.reviewed));
  assert.match(await page.text('.review-body'), /One question on line 3/);
  assert.equal(await page.text('.thread .box-head a'), 'README.md:3');
  await page.click('.thread [data-resolve]');
  await sees(page, '.thread .label', S.pulls.resolved);

  await page.click('nav.tabs a[href$="/pull/1/commits"]');
  await page.arrive(`${REPO}/pull/1/commits`);
  assert.equal(await page.text('nav.tabs a[href$="/pull/1/commits"] .counter'), '1');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['Say more in the README']);
  await page.click('nav.tabs a', S.pulls.checks);
  await page.arrive(`${REPO}/pull/1/checks`);
  assert.equal(await page.text('#main .blankslate h2'), S.pulls.noChecks('main'));

  await go(page, `${REPO}/pull/1`);
  await page.click('[data-merge]');
  await sees(page, '.issue-meta .state', S.common.merged);
  assert.equal(await page.text('.merge-box strong'), S.pulls.mergedDone);
  await go(page, REPO);
  await page.waitFor("!!document.querySelector('.readme .markdown p')", 'the README');
  assert.match(await page.text('.readme'), /Now with more words\./, 'the branch has the change');
  await go(page, `${REPO}/pulls?q=is%3Aclosed`);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['Say more in the README']);
  await go(page, `${REPO}/pull/1/files`);
  assert.equal(await count(page, 'table.diff tr.add'), 3, 'a merged pull request still shows what it changed');
  // Failure: a number that is no pull request.
  await go(page, `${REPO}/pull/99`);
  assert.equal(await page.text('#main .blankslate h2'), S.pulls.notFound);
  noErrors(page);
  await page.close();
});

test('the merge box: a branch that fell behind is brought up to date and keeps its number; a conflict and a missing review are explained', async () => {
  const page = await withRepo();
  await change(page, 'README.md', '# demo\n\nProposed text.\n', 'Propose new text', { propose: true });
  // Meanwhile main moves on, in another file.
  await go(page, `${REPO}/new/main`);
  await page.fill(await page.field(S.code.fileName), 'notes.txt');
  await page.fill('textarea', 'one\n');
  await page.click('button', S.code.commitChanges);
  await onCommit(page);
  await go(page, `${REPO}/pull/1`);
  assert.equal(await page.text('[data-fact=branch] strong'), S.pulls.outOfDate);
  assert.equal(await page.eval("document.querySelector('[data-merge]').disabled"), true);
  await page.click('[data-update]');
  await sees(page, '[data-fact=branch] strong', S.pulls.noConflicts);
  assert.equal(await page.text('.issue-title h1'), 'Propose new text #1', 'still pull request 1');
  assert.match(await page.text('.timeline'), new RegExp(S.pulls.updatedTo));
  assert.match(await page.text('.issue-meta'), new RegExp(S.pulls.wantsToMerge(2)));

  // Failure: main changes the same lines. Updating reports the conflict and changes nothing.
  await change(page, 'README.md', '# demo\n\nA different text on main.\n', 'Change the README on main');
  await go(page, `${REPO}/pull/1`);
  await page.click('[data-update]');
  await page.waitFor("!!document.querySelector('#main .flash.error')", 'the conflict message');
  assert.equal(await page.text('#main .flash.error'), S.pulls.conflicts('README.md'));
  assert.equal(await page.text('[data-fact=branch] strong'), S.pulls.outOfDate);

  // Failure: a rule asks for one approving review, and the author's own does not count.
  await page.eval("import('/identity.js').then((m) => m.protect('demo', 'main', 'write', 1, []))");
  await go(page, `${REPO}/new/main`);
  await page.fill(await page.field(S.code.fileName), 'direct.txt');
  await page.fill('textarea', 'x\n');
  await page.click('button', S.code.commitChanges);
  await page.waitFor("!!document.querySelector('#main .flash.error')", 'the protected-branch message');
  assert.equal(await page.text('#main .flash.error'), S.code.protectedBranch);
  await change(page, 'notes.txt', 'one\ntwo\n', 'Add a second note', { propose: true });
  await page.click('.box-row a.title', 'Add a second note');
  await page.waitFor("/\\/pull\\/\\d+$/.test(document.documentElement.dataset.screen || '')", 'the pull request');
  assert.equal(await page.text('[data-fact=review] strong'), S.pulls.reviewRequired);
  await page.click('nav.tabs a', S.pulls.files);
  await page.waitFor("/\\/files$/.test(document.documentElement.dataset.screen || '')", 'files');
  await page.click('[data-review]');
  await page.eval("document.getElementById('verdict-approve').click()");
  await page.click('dialog button', S.pulls.submitReview);
  await page.waitFor("/\\/pull\\/\\d+$/.test(document.documentElement.dataset.screen || '')", 'the conversation');
  assert.match(await page.text('.timeline'), new RegExp(S.pulls.approvedThese));
  assert.equal(await page.text('[data-fact=review] strong'), S.pulls.reviewRequired, 'an author cannot approve their own pull request');
  await page.click('[data-merge]');
  await page.waitFor("!!document.querySelector('#main .flash.error')", 'the refusal');
  assert.equal(await page.text('#main .flash.error'), S.pulls.blockedReview(1));
  assert.equal(await page.text('.issue-meta .state'), S.common.opened);
  page.errors.length = 0;
  await page.close();
});

test('opening from a comparison, closing and reopening, and the list across repositories', async () => {
  const page = await withRepo();
  await change(page, 'README.md', '# demo\n\nCompared.\n', 'Compare me', { propose: true });
  await page.click('.box-row a.title');
  await page.arrive(`${REPO}/pull/1`);
  await go(page, `${REPO}/pull/1/commits`);
  const head = await page.eval("document.querySelector('.box-row a.title').getAttribute('href').split('/').pop()");
  await go(page, `${REPO}/pull/1`);
  await page.click('[data-close]');
  await sees(page, '.issue-meta .state', S.common.closed);
  assert.equal(await page.text('.merge-box strong'), S.pulls.closedDone);
  await page.click('[data-reopen]');
  await sees(page, '.issue-meta .state', S.common.opened);

  // The comparison of main with the proposed commit offers to open a pull request for it.
  await go(page, `${REPO}/compare/main...${head}`);
  assert.equal(await page.exists('[data-propose]'), true);
  const title = await page.field(S.issues.titleField);
  await page.fill(title, '');
  await page.click('[data-propose] button', S.pulls.create);
  assert.equal(await page.text(`${title}-error`), S.issues.titleBlank);
  await page.fill(title, 'Compare me');
  await page.click('[data-propose] button', S.pulls.create);
  await page.arrive(`${REPO}/pull/1`);

  await page.click('#header a', S.header.pulls);
  await page.arrive('/pulls');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['Compare me']);
  assert.match(await page.text('.box'), /ada-example\/demo/);
  noErrors(page);
  await page.close();
});

test('at 360 px wide the pull request screens do not overflow sideways', async () => {
  const page = await withRepo({ width: 360, height: 740 });
  await change(page, 'README.md', '# demo\n\nA fairly long line of proposed text that has to wrap on a narrow screen without pushing the page wider than it is.\n', 'A long pull request title that has to wrap on a narrow screen', { propose: true });
  for (const path of [`${REPO}/pulls`, `${REPO}/pull/1`, `${REPO}/pull/1/commits`, `${REPO}/pull/1/checks`, `${REPO}/pull/1/files`, '/pulls']) {
    await go(page, path);
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  noErrors(page);
  await page.close();
});
