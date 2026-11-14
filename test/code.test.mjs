// The Code tab, driven in a real browser engine: each screen through its main path and one failure.
// The repository is the fixture from test/helpers.mjs: README.md, docs/notes.txt changed in each of three
// commits ("first", "second", "third"), src/old.txt removed and src/new.txt added in the third.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, makeFixture, root } from './helpers.mjs';
import { launch } from './browser.mjs';
import { serveWeb } from '../scripts/dev-web.mjs';
import { S } from '../web/ui/strings.js';

let browser; let site; let remote;
const REPO = '/127-0-0-1/fixture';

before(async () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'shell-manifest.mjs')]);
  browser = await launch();
  site = await serveWeb();
  remote = await serveWeb({ dir: makeFixture().served });
});
after(async () => { await browser.close(); await Promise.all([site.close(), remote.close()]); cleanup(); });

async function signIn(page) {
  await page.goto(`${site.url}welcome`);
  await page.fill(await page.field(S.welcome.name), 'Ada Example');
  await page.fill(await page.field(S.welcome.email), 'ada@example.org');
  await page.click('button', S.common.continue);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.repoTitle)}`, 'the third step');
}
// A signed-in page with the fixture opened, on its Code tab.
async function withFixture(options) {
  const page = await browser.open(null, options);
  await signIn(page);
  await page.goto(`${site.url}open`);
  await page.fill(await page.field(S.openRepo.address), `${remote.url}fixture.git`);
  await page.click('button', S.openRepo.open);
  await page.arrive(REPO);
  return page;
}
const go = async (page, path) => { await page.goto(site.url + path.slice(1)); };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'the page logged no errors');
const count = (page, selector) => page.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

test('code: files with their last commit, the rendered README, and a way into folders; a missing branch or file says so', async () => {
  const page = await withFixture();
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.file-table td.name a')].map((a) => a.textContent)"), ['docs', 'src', 'README.md']);
  await page.waitFor("[...document.querySelectorAll('.file-table td.message')].every((td) => td.textContent)", 'the last commit of each row');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.file-table td.message')].map((td) => td.textContent)"), ['third', 'third', 'first']);
  await page.waitFor("!!document.querySelector('.readme .markdown h1')", 'the README');
  assert.equal(await page.text('.readme .markdown h1'), 'Fixture');
  await page.waitFor(`document.querySelector('[data-commits]').textContent === ${JSON.stringify(S.code.commitCount(3))}`, 'the commit count');
  assert.equal(await page.eval("document.querySelector('#main nav.tabs a[aria-current=page]').textContent"), S.repo.code);
  assert.equal(await page.text('.repo-head .name'), 'fixture');

  await page.click('.file-table td.name a', 'docs');
  await page.arrive(`${REPO}/tree/main/docs`);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.file-table td.name a')].map((a) => a.textContent)"), ['..', 'notes.txt']);
  await page.click('.file-table td.name a', 'notes.txt');
  await page.arrive(`${REPO}/blob/main/docs/notes.txt`);
  await page.click('.crumbs a', 'docs');
  await page.arrive(`${REPO}/tree/main/docs`);

  // An address from before owners were part of it is sent on.
  await go(page, '/fixture/tree/main/docs');
  await page.arrive(`${REPO}/tree/main/docs`);
  // Failures.
  await go(page, `${REPO}/tree/no-such-branch`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noRef('no-such-branch'));
  await go(page, `${REPO}/blob/main/docs/missing.txt`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noFile('main'));
  noErrors(page);
  await page.close();
});

test('file finder: t focuses it, typing narrows, Enter opens; nothing matching says so', async () => {
  const page = await withFixture();
  await page.eval('document.activeElement.blur()');
  await page.press('t');
  assert.equal(await page.eval("document.activeElement.hasAttribute('data-finder')"), true);
  await page.cdp('Input.insertText', { text: 'nts' });
  await page.waitFor("!document.querySelector('.finder-results').hidden", 'results');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.finder-results a')].map((a) => a.textContent)"), ['docs/notes.txt']);
  await page.press('Enter');
  await page.arrive(`${REPO}/blob/main/docs/notes.txt`);
  await page.eval('history.back()');
  await page.arrive(REPO);
  await page.fill('[data-finder]', 'zzzz');
  await page.waitFor(`document.querySelector('.finder-results').textContent === ${JSON.stringify(S.code.noFiles)}`, 'the no-match line');
  noErrors(page);
  await page.close();
});

test('file view: numbered lines, a selection kept in the address, a permanent link, blame; Markdown renders and can be read as source', async () => {
  const page = await withFixture();
  // A shared link with a selection, opened cold: the host's 404 page hands it over with the selection intact.
  await go(page, `${REPO}/blob/main/docs/notes.txt#L2-L4`);
  assert.equal(await count(page, '.code-lines tr.selected'), 3);
  await go(page, `${REPO}/blob/main/docs/notes.txt`);
  const lines = await count(page, '.code-lines tr');
  assert.equal(lines, 30);
  assert.match(await page.text('.box-head .muted.small'), new RegExp(`^${S.code.lineCount(30)}`));
  await page.click('#L3 td.num a');
  await page.waitFor("location.hash === '#L3'", 'one line selected');
  assert.equal(await count(page, '.code-lines tr.selected'), 1);
  // Shift-click extends the selection to a range.
  const box = await page.eval("(() => { const r = document.querySelector('#L6 td.num a').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  for (const type of ['mousePressed', 'mouseReleased']) await page.cdp('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1, modifiers: 8 });
  await page.waitFor("location.hash === '#L3-L6'", 'a range selected');
  assert.equal(await count(page, '.code-lines tr.selected'), 4);
  await page.reload();
  assert.equal(await count(page, '.code-lines tr.selected'), 4, 'the selection survives a reload');

  await page.eval('document.activeElement.blur()');
  await page.press('y');
  await page.waitFor("/\\/blob\\/[0-9a-f]{40}\\/docs\\/notes\\.txt$/.test(location.pathname) && location.hash === '#L3-L6'", 'the permanent link');
  await page.reload();
  assert.equal(await count(page, '.code-lines tr'), 30, 'the permanent link opens the same file');
  await go(page, `${REPO}/blob/main/docs/notes.txt`);
  await page.eval('document.activeElement.blur()');
  await page.press('b');
  await page.arrive(`${REPO}/blame/main/docs/notes.txt`);
  const credited = await page.eval("[...new Set([...document.querySelectorAll('.blame td.who a')].map((a) => a.textContent))].sort()");
  assert.deepEqual(credited, ['first', 'second', 'third'], 'every commit that left lines is credited');
  assert.equal(await count(page, '.blame tr'), 30);

  await go(page, `${REPO}/blob/main/README.md`);
  assert.equal(await page.text('.markdown h1'), 'Fixture');
  await page.click('.segmented button', S.repo.code);
  await page.waitFor("location.search === '?plain=1' && !!document.querySelector('.code-lines')", 'the source view');
  assert.equal(await page.text('#L1 td.text'), '# Fixture');
  // Failure: blame of a file that is not there.
  await go(page, `${REPO}/blame/main/nope.txt`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noFile('main'));
  noErrors(page);
  await page.close();
});

test('commits and one commit: grouped list, file history, a diff shown unified or split and folded per file; an unknown commit says so', async () => {
  const page = await withFixture();
  await page.click('[data-commits]');
  await page.arrive(`${REPO}/commits/main`);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['third', 'second', 'first']);
  assert.equal(await count(page, 'h2.day'), 1, 'one day, one group');
  await go(page, `${REPO}/commits/main/src/new.txt`);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['third']);
  await go(page, `${REPO}/commits/main`);
  await page.click('.box-row a.title', 'second');
  await page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the commit');
  assert.equal(await page.text('.commit-title'), 'second');
  assert.match(await page.text(), new RegExp(S.code.showing(1, 2, 1).replace('.', '\\.')));
  assert.equal(await count(page, 'table.diff tr.add'), 2);
  assert.equal(await count(page, 'table.diff tr.del'), 1);
  assert.equal(await count(page, 'table.diff tr.hunk'), 1, 'the two changes are close enough to share one hunk');
  await page.click('.segmented button', S.code.split);
  await page.waitFor("!!document.querySelector('table.diff.split')", 'the split view');
  assert.equal(await count(page, 'table.diff.split td.text.add'), 2);
  assert.ok(await page.eval("document.querySelector('table.diff.split td.text.add').getBoundingClientRect().width > 300"), 'each side gets half the width');
  await page.reload();
  assert.equal(await page.exists('table.diff.split'), true, 'the choice is remembered');
  await page.eval("document.querySelector('.diff-file > summary').click()");
  assert.equal(await page.eval("document.querySelector('.diff-file').open"), false, 'a file folds away');

  // The third commit against the first, through compare.
  await go(page, `${REPO}/commits/main`);
  const first = await page.eval("[...document.querySelectorAll('.box-row a.title')].pop().getAttribute('href').split('/').pop()");
  await go(page, `${REPO}/compare/${first}...main`);
  assert.match(await page.text(), /Showing 3 changed files/);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.diff-file > summary .mono')].map((n) => n.textContent)"), ['docs/notes.txt', 'src/new.txt', 'src/old.txt']);
  // Failures.
  await go(page, `${REPO}/commit/${'0'.repeat(40)}`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noCommit);
  await go(page, `${REPO}/compare/nope...main`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noCompare);
  noErrors(page);
  await page.close();
});

test('branches, tags and search: lists from the repository, and text found in files; no match says so', async () => {
  const page = await withFixture();
  await page.click('.code-bar a', S.code.branchCount(1));
  await page.arrive(`${REPO}/branches`);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-row a.title')].map((a) => a.textContent)"), ['main']);
  assert.match(await page.text('.box-row .aside'), new RegExp(S.code.default));
  await go(page, `${REPO}/tags`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noTags);

  await go(page, REPO);
  await page.fill(`aside input[type=search]`, 'inserted');
  await page.press('Enter');
  await page.arrive(`${REPO}/search`);
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.box-head a.mono')].map((a) => a.textContent)"), ['docs/notes.txt']);
  assert.equal(await page.text('.code-lines td.text'), 'an inserted line');
  await page.click('.code-lines td.num a');
  await page.arrive(`${REPO}/blob/main/docs/notes.txt`);
  assert.equal(await page.eval("document.querySelector('.code-lines tr.selected td.text').textContent"), 'an inserted line', 'a result opens the file at its line');
  await go(page, `${REPO}/search?q=zzzqqq`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.noResults('zzzqqq'));
  noErrors(page);
  await page.close();
});

test('editor: a new file and an edit become commits; a blank name and an unchanged file are refused', async () => {
  const page = await browser.open(null);
  await signIn(page);
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'demo');
  await page.click('button', S.newRepo.create);
  await page.arrive('/ada-example/demo');
  await page.click('.code-bar a', S.code.addFile);
  await page.arrive('/ada-example/demo/new/main');
  const name = await page.field(S.code.fileName);
  await page.click('button', S.code.commitChanges);
  assert.equal(await page.text(`${name}-error`), S.code.fileNameBlank);
  await page.fill(name, 'docs/guide.md');
  await page.fill('textarea', '# Guide\n\nHow to use it.\n');
  await page.click('button', S.code.commitChanges);
  await page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the new commit');
  assert.equal(await page.text('.commit-title'), S.code.createMessage('guide.md'));
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.diff-file > summary .mono')].map((n) => n.textContent)"), ['docs/guide.md']);

  await page.goto(`${site.url}ada-example/demo/blob/main/docs/guide.md`);
  await page.eval('document.activeElement.blur()');
  await page.press('e');
  await page.arrive('/ada-example/demo/edit/main/docs/guide.md');
  // Failure: nothing changed.
  await page.click('button', S.code.commitChanges);
  await page.waitFor("!!document.querySelector('#main .flash.warning')", 'the no-changes message');
  assert.equal(await page.text('#main .flash.warning'), S.code.noChanges);
  await page.fill('textarea', '# Guide\n\nHow to use it, step by step.\n');
  await page.fill(await page.field(S.code.commitMessage), 'Say more in the guide');
  await page.click('button', S.code.commitChanges);
  await page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the edit commit');
  assert.equal(await page.text('.commit-title'), 'Say more in the guide');
  assert.match(await page.text(), new RegExp(S.code.showing(1, 1, 1).replace('.', '\\.')));
  await page.goto(`${site.url}ada-example/demo`);
  await page.waitFor(`document.querySelector('[data-commits]').textContent === ${JSON.stringify(S.code.commitCount(3))}`, 'three commits');
  // Failure: a tag or commit cannot be edited.
  const sha = await page.eval("document.querySelector('.box-head a.mono').getAttribute('href').split('/').pop()");
  await page.goto(`${site.url}ada-example/demo/edit/${sha}/README.md`);
  assert.equal(await page.text('#main .blankslate h3'), S.code.editNeedsBranch);
  noErrors(page);
  await page.close();
});

test('Markdown: structure is rendered, and nothing in a document becomes markup or script', async () => {
  const page = await browser.open(site.url);
  const html = async (source) => page.eval(`import('./ui/markdown.js').then((m) => m.renderMarkdown(${JSON.stringify(source)}).innerHTML)`);
  const out = await html('# Title\n\nSome *emphasis*, **strong**, ~~gone~~ and `code`.\n\n- [x] done\n- [ ] todo\n\n1. one\n2. two\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n```js\nlet x = 1 < 2;\n```\n\n> [!WARNING]\n> Careful.\n\n[site](https://example.org) <https://example.org/x>\n');
  for (const part of ['<h1 id="title">Title</h1>', '<em>emphasis</em>', '<strong>strong</strong>', '<del>gone</del>', '<code>code</code>', 'type="checkbox"', '<ol>', '<th>a</th>', 'class="md-right"', '<pre data-lang="js"><code>let x = 1 &lt; 2;</code></pre>', 'md-alert attention', 'href="https://example.org"', 'href="https://example.org/x"']) assert.ok(out.includes(part), `renders ${part}`);
  // Failure: a hostile document.
  const hostile = await html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) ![x](https://example.org/track.png)\n');
  assert.equal(/<script|<img|javascript:|onerror=/.test(hostile.replace(/&lt;[^&]*&gt;/g, '')), false, hostile);
  assert.ok(hostile.includes('&lt;script&gt;'), 'raw HTML is shown as text');
  noErrors(page);
  await page.close();
});

test('at 360 px wide the Code screens do not overflow sideways', async () => {
  const page = await withFixture({ width: 360, height: 740 });
  for (const path of [REPO, `${REPO}/tree/main/docs`, `${REPO}/blob/main/docs/notes.txt`, `${REPO}/blame/main/docs/notes.txt`, `${REPO}/commits/main`, `${REPO}/branches`, `${REPO}/search?q=line`]) {
    await go(page, path);
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  noErrors(page);
  await page.close();
});
