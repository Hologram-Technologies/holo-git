// Home, driven in a real browser engine: the dashboard, a profile, explore, search, the command palette,
// and notifications. The last test is two people in two browsers sharing one remote: one opens an issue and a
// pull request, the other comments and approves, and each sees what the other did.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, root, startReplica } from './helpers.mjs';
import { launch } from './browser.mjs';
import { serveWeb } from '../scripts/dev-web.mjs';
import { S } from '../web/ui/strings.js';

let browser; let site; let replica;
const REPO = '/ada-example/demo';

before(async () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'shell-manifest.mjs')]);
  browser = await launch();
  site = await serveWeb();
  replica = await startReplica();
});
after(async () => { await browser.close(); await site.close(); replica.close(); cleanup(); });

async function person(name, options) {
  const page = await browser.open(null, options);
  await page.goto(`${site.url}welcome`);
  await page.fill(await page.field(S.welcome.name), name);
  await page.fill(await page.field(S.welcome.email), `${name.split(' ')[0].toLowerCase()}@example.org`);
  await page.click('button', S.common.continue);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.repoTitle)}`, 'the third step');
  return page;
}
async function withRepo(options) {
  const page = await person('Ada Example', options);
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'demo');
  await page.fill(await page.field(S.newRepo.description), 'A demonstration');
  await page.click('button', S.newRepo.create);
  await page.arrive(REPO);
  return page;
}
const go = async (page, path) => { await page.goto(site.url + path.slice(1)); };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'the page logged no errors');
const sees = (page, selector, text) => page.waitFor(`[...document.querySelectorAll(${JSON.stringify(selector)})].some((n) => n.textContent.trim() === ${JSON.stringify(text)})`, `${selector} reading "${text}"`);
async function newIssue(page, repo, title) {
  await go(page, `${repo}/issues/new`);
  await page.fill(await page.field(S.issues.titleField), title);
  await page.click('button', S.issues.submit);
  await page.waitFor(`/\\/issues\\/\\d+$/.test(document.documentElement.dataset.screen || '')`, 'the new issue');
}

test('dashboard, profile and explore: what happened, a year of contributions, and the repositories, all from this browser', async () => {
  const page = await withRepo();
  await newIssue(page, REPO, 'Formatting drops leading zeros');
  await page.click('a.brand');
  await page.arrive('/');
  assert.equal(await page.text('#main h1'), S.home.dashboard);
  await page.waitFor("document.querySelectorAll('.feed-row').length > 0", 'the feed');
  assert.match(await page.text('.feed-row'), new RegExp(`Ada Example ${S.home.openedIssue(1)} ${S.home.in} ada-example/demo`));
  assert.match(await page.text('.feed-row'), /Formatting drops leading zeros/);
  await page.waitFor("!!document.querySelector('.heatmap')", 'the heatmap');
  assert.equal(await page.eval("document.querySelectorAll('.heatmap i').length >= 365"), true, 'a year of days');
  assert.ok(await page.eval("(() => { const day = [...document.querySelectorAll('.heatmap i')].pop(); const box = document.querySelector('.heat-scroll').getBoundingClientRect(); const r = day.getBoundingClientRect(); return day.dataset.level !== '0' && r.right <= box.right + 1 && r.left >= box.left; })()"), 'today is coloured and in view');
  assert.match(await page.eval("document.querySelector('.heatmap').getAttribute('aria-label')"), /: [1-9]\d* in the last/, 'the issue and the first commit count');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.repo-list a.title')].map((a) => a.textContent)"), ['ada-example / demo']);
  // Failure: a filter that matches nothing.
  await page.fill('.dashboard aside input', 'zzzz');
  await page.waitFor(`document.querySelector('.repo-list .blankslate h2') && document.querySelector('.repo-list .blankslate h2').textContent === ${JSON.stringify(S.home.noMatch)}`, 'the no-match line');

  await go(page, '/ada-example');
  assert.equal(await page.text('.profile h1'), 'Ada Example');
  assert.match(await page.text('.profile'), /ada-example \/ demo/);
  assert.match(await page.text('.profile'), /A demonstration/);
  await page.click('.profile nav.tabs a[href$="tab=repositories"]');
  await page.waitFor("location.search === '?tab=repositories'", 'the repositories tab');
  await go(page, '/nobody-here');
  assert.equal(await page.text('#main .blankslate h2'), S.profile.unknown);

  await page.click('#header a', S.header.explore);
  await page.arrive('/explore/repos');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#main a.title')].map((a) => a.textContent)"), ['ada-example / demo']);
  assert.match(await page.text(), new RegExp(S.explore.scope.slice(0, 40)));
  await page.click('#main nav.tabs a', S.explore.users);
  await page.arrive('/explore/users');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#main a.title')].map((a) => a.textContent)"), ['ada-example']);
  await go(page, '/explore/repos?q=zzzz');
  assert.equal(await page.text('#main .blankslate h2'), S.explore.noMatch);
  noErrors(page);
  await page.close();
});

test('search and the command palette: found from the header box and from the keyboard; no match says so; Ctrl+K leaves text fields alone', async () => {
  const page = await withRepo();
  await newIssue(page, REPO, 'Formatting drops leading zeros');
  await go(page, REPO);
  await page.eval('document.activeElement.blur()');
  await page.press('/');
  assert.equal(await page.eval("document.activeElement.getAttribute('data-shortcut')"), 'search', '/ focuses the search box');
  await page.cdp('Input.insertText', { text: 'zeros' });
  await page.press('Enter');
  await page.arrive('/search');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.sidenav a')].map((a) => a.dataset.kind + ':' + a.querySelector('.counter').textContent)"), ['repositories:0', 'issues:1', 'pulls:0']);
  assert.equal(await page.text('#main .blankslate h2'), S.search.none('zeros'), 'no repository is called that');
  await page.click('.sidenav a[data-kind=issues]');
  await page.waitFor("location.search.includes('type=issues') && !!document.querySelector('#main a.title')", 'the issue results');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#main a.title')].map((a) => a.textContent)"), ['Formatting drops leading zeros']);
  await go(page, '/search?q=demo');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#main a.title')].map((a) => a.textContent)"), ['ada-example / demo']);

  // The palette.
  await page.eval('document.activeElement.blur()');
  await page.press('k', { ctrl: true });
  await page.waitFor("!!document.querySelector('dialog.palette[open]')", 'the palette');
  await page.cdp('Input.insertText', { text: 'theme dark' });
  await page.waitFor(`document.querySelector('.palette-list li[aria-selected=true]').textContent === ${JSON.stringify(S.palette.theme(S.settings.themes.dark))}`, 'the theme command');
  await page.press('Enter');
  await page.waitFor("document.documentElement.dataset.theme === 'dark' && !document.querySelector('dialog.palette')", 'the dark theme');
  await page.press('k', { ctrl: true });
  await page.waitFor("!!document.querySelector('dialog.palette[open]')", 'the palette again');
  await page.cdp('Input.insertText', { text: 'ada demo' });
  await page.waitFor("document.querySelector('.palette-list li[aria-selected=true]').textContent.includes('demo')", 'a repository command');
  await page.press('Enter');
  await page.waitFor("/\\/ada-example\\/demo/.test(document.documentElement.dataset.screen || '') && !document.querySelector('dialog.palette')", 'the repository');
  // Failures: nothing matches; and in a text field Ctrl+K is not the palette's.
  await page.press('k', { ctrl: true });
  await page.waitFor("!!document.querySelector('dialog.palette[open]')", 'the palette');
  await page.cdp('Input.insertText', { text: 'qqqqzzzz' });
  await page.waitFor(`document.querySelector('.palette-list').textContent === ${JSON.stringify(S.palette.none)}`, 'the no-match line');
  await page.press('Escape');
  await page.waitFor("!document.querySelector('dialog.palette')", 'the palette to close');
  await go(page, `${REPO}/issues/new`);
  await page.eval("document.querySelector('#issue-body').focus()");
  await page.press('k', { ctrl: true });
  assert.equal(await page.exists('dialog.palette'), false);
  noErrors(page);
  await page.close();
});

test('two people, one remote: a comment arrives as a notification, and another person\'s approval opens the merge gate', async () => {
  const url = `${replica.url}/demo`;
  const publish = (page) => page.eval(`Promise.all([import('/replica.js'), import('/store.js')]).then(async ([r, s]) => { await r.push(await s.getRepo('demo'), 'main', ${JSON.stringify(url)}); return true; })`);
  const fetch = (page, name) => page.eval(`Promise.all([import('/sync.js'), import('/store.js')]).then(async ([y, s]) => (await y.fetchFrom(await s.getRepo('demo'), 'main', ${JSON.stringify(url)}, { name: ${JSON.stringify(name)}, email: 'x@example.org' })).outcome)`);

  // Ada makes a repository with a commit, an issue, and room for Bob.
  const ada = await withRepo();
  await go(ada, `${REPO}/new/main`);
  await ada.fill(await ada.field(S.code.fileName), 'notes.txt');
  await ada.fill('textarea', 'one\n');
  await ada.click('button', S.code.commitChanges);
  await ada.waitFor("/\\/commit\\//.test(document.documentElement.dataset.screen || '')", 'the commit');
  await newIssue(ada, REPO, 'How should this be formatted?');
  const bob = await person('Bob Builder');
  await go(bob, '/settings/security');
  const bobKey = await bob.text('[data-key]');
  await ada.eval(`import('/identity.js').then((m) => m.grant('demo', ${JSON.stringify(bobKey)}, 'write', 0))`);
  await publish(ada);

  // Bob opens it by address and answers.
  await go(bob, '/open');
  await bob.fill(await bob.field(S.openRepo.address), url);
  await bob.click('button', S.openRepo.open);
  await bob.arrive('/127-0-0-1/demo');
  await go(bob, '/127-0-0-1/demo/issues/1');
  assert.equal(await bob.text('.issue-title h1'), 'How should this be formatted? #1');
  await bob.fill('.comment-box textarea', 'With leading zeros, I think.');
  await bob.click('.comment-box button', S.parts.comment);
  await bob.waitFor("document.querySelectorAll('.comment').length === 2", 'his comment');
  await publish(bob);

  // Ada fetches: a dot on the bell, one unread notification, and Bob's words under his name.
  assert.equal(await ada.exists('#header [data-bell].unread'), false);
  await fetch(ada, 'Ada Example');
  await go(ada, '/');
  await ada.waitFor("!!document.querySelector('#header [data-bell].unread')", 'the dot on the bell');
  await ada.click('#header [data-bell]');
  await ada.arrive('/notifications');
  assert.match(await ada.text('.notification.unread'), /How should this be formatted\?/);
  assert.match(await ada.text('.notification.unread'), new RegExp(`Bob Builder ${S.notifications.commented}`));
  await ada.click('.notification a.title');
  await ada.arrive(`${REPO}/issues/1`);
  assert.match(await ada.text('#main'), /Bob Builder/);
  assert.match(await ada.text('#main'), /With leading zeros, I think\./);
  await go(ada, '/notifications');
  assert.equal(await ada.text('#main .blankslate h2'), S.notifications.caughtUp, 'reading it marked it read');
  assert.equal(await ada.exists('#header [data-bell].unread'), false);

  // A rule asks for one approving review. Ada proposes; her own approval would not count.
  await ada.eval("import('/identity.js').then((m) => m.protect('demo', 'main', 'write', 1, []))");
  await go(ada, `${REPO}/edit/main/notes.txt`);
  await ada.fill('textarea', 'one\ntwo\n');
  await ada.fill(await ada.field(S.code.commitMessage), 'Add a second note');
  await ada.eval("document.getElementById('how-propose').click()");
  await ada.click('button', S.code.commitChanges);
  await ada.arrive(`${REPO}/pulls`);
  await publish(ada);
  await go(ada, `${REPO}/pull/2`);
  assert.equal(await ada.text('[data-fact=review] strong'), S.pulls.reviewRequired);

  // Bob fetches, reads the change and approves.
  await fetch(bob, 'Bob Builder');
  await go(bob, '/127-0-0-1/demo/pull/2/files');
  assert.equal(await bob.eval("document.querySelectorAll('table.diff tr.add').length"), 1);
  await bob.click('[data-review]');
  await bob.eval("document.getElementById('verdict-approve').click()");
  await bob.fill('dialog textarea', 'Looks right.');
  await bob.click('dialog button', S.pulls.submitReview);
  await bob.arrive('/127-0-0-1/demo/pull/2');
  await publish(bob);

  // Ada fetches: the merge box now says approved, by Bob, and the merge goes through.
  await fetch(ada, 'Ada Example');
  await go(ada, `${REPO}/pull/2`);
  assert.equal(await ada.text('[data-fact=review] strong'), S.pulls.changesApproved);
  assert.match(await ada.text('.timeline'), new RegExp(`Bob Builder ${S.pulls.approvedThese}`));
  assert.match(await ada.text('.side-section'), /Bob Builder/);
  await ada.click('[data-merge]');
  await sees(ada, '.issue-meta .state', S.common.merged);
  await go(ada, '/notifications?filter=all');
  assert.match(await ada.text('#main'), new RegExp(`Bob Builder ${S.notifications.approved}`));
  ada.errors.length = 0; bob.errors.length = 0;
  await ada.close(); await bob.close();
});

test('at 360 px wide the home screens do not overflow sideways', async () => {
  const page = await withRepo({ width: 360, height: 740 });
  await newIssue(page, REPO, 'A fairly long issue title that has to wrap on a narrow screen');
  for (const path of ['/', '/ada-example', '/explore/repos', '/explore/users', '/notifications', '/search?q=demo']) {
    await go(page, path);
    if (path === '/') await page.waitFor("!!document.querySelector('.heatmap')", 'the heatmap');
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  noErrors(page);
  await page.close();
});
