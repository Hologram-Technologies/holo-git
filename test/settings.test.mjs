// Repository and user settings, driven in a real browser engine: each screen through its main path and one failure.
// The remote is the stand-in object store the other tests use; the conflict is made by a second person in a second browser.

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
  await page.click('button', S.newRepo.create);
  await page.arrive(REPO);
  return page;
}
const go = async (page, path) => { await page.goto(site.url + path.slice(1)); };
const noErrors = (page) => assert.deepEqual(page.errors, [], 'the page logged no errors');
const flashIs = (page, tone, text) => page.waitFor(`document.querySelector('#main .flash.${tone}') && document.querySelector('#main .flash.${tone}').innerText.trim() === ${JSON.stringify(text)}`, `the message "${text}"`);
const onCommit = (page) => page.waitFor("/\\/commit\\/[0-9a-f]{40}$/.test(document.documentElement.dataset.screen || '')", 'the commit');
async function write(page, repo, path, text, { create } = {}) {
  await go(page, `${repo}/${create ? 'new/main' : `edit/main/${path}`}`);
  if (create) await page.fill(await page.field(S.code.fileName), path);
  await page.fill('textarea', text);
  await page.click('button', S.code.commitChanges);
}

test('general settings: a description, a new name, and deleting only when the name is typed; a bad name is refused at the field', async () => {
  const page = await withRepo();
  await page.click('#main nav.tabs a', S.repo.settings);
  await page.arrive(`${REPO}/settings`);
  await page.fill(await page.field(S.newRepo.description), 'A demonstration repository');
  await page.click('button', S.common.save);
  await flashIs(page, 'success', S.repoSettings.saved);
  await go(page, REPO);
  assert.match(await page.text('aside'), /A demonstration repository/);

  await go(page, `${REPO}/settings`);
  const name = await page.field(S.newRepo.name);
  await page.fill(name, 'has spaces');
  await page.click('[data-rename]');
  await page.waitFor(`document.querySelector('${name}-error').innerText.trim() === ${JSON.stringify(S.newRepo.nameInvalid)}`, 'the invalid-name message');
  await page.fill(name, 'renamed');
  await page.click('[data-rename]');
  await page.arrive('/ada-example/renamed/settings');
  assert.equal(await page.text('.repo-head .name'), 'renamed');
  await go(page, '/ada-example/renamed');
  await page.waitFor("!!document.querySelector('.file-table')", 'its files, under the new name');

  await go(page, '/ada-example/renamed/settings');
  await page.click('[data-delete-repo]');
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the confirmation');
  assert.equal(await page.eval("document.querySelector('dialog button[type=submit]').disabled"), true);
  // Failure: the wrong name leaves the button off.
  await page.fill('dialog input', 'demo');
  assert.equal(await page.eval("document.querySelector('dialog button[type=submit]').disabled"), true);
  await page.fill('dialog input', 'renamed');
  assert.equal(await page.eval("document.querySelector('dialog button[type=submit]').disabled"), false);
  await page.click('dialog button[type=submit]');
  await page.arrive('/');
  assert.equal(await page.text('.repo-list .blankslate h2'), S.home.empty);
  noErrors(page);
  await page.close();
});

test('collaborators and branch rules: added, shown, and removed; bad keys and bad numbers are reported; a protected branch refuses a direct commit', async () => {
  const page = await withRepo();
  await go(page, `${REPO}/settings/collaborators`);
  assert.equal(await page.text('#main .blankslate h2'), S.repoSettings.noCollaborators);
  const key = await page.field(S.repoSettings.theirKey);
  await page.fill(key, 'not-a-key');
  await page.click('button', S.repoSettings.add);
  assert.equal(await page.text(`${key}-error`), S.repoSettings.keyInvalid);
  await go(page, '/settings/security');
  const mine = await page.text('[data-key]');
  await go(page, `${REPO}/settings/collaborators`);
  await page.fill(await page.field(S.repoSettings.theirKey), mine);
  await page.click('button', S.repoSettings.add);
  assert.equal(await page.text(`${await page.field(S.repoSettings.theirKey)}-error`), S.repoSettings.keyOwn);
  const other = 'ab'.repeat(32);
  await page.fill(await page.field(S.repoSettings.theirKey), other);
  await page.eval("document.getElementById('role').value = 'read'; document.getElementById('expiration').value = '7'");
  await page.click('button', S.repoSettings.add);
  await page.waitFor(`!!document.querySelector('[data-collaborator="${other}"]')`, 'the collaborator');
  assert.match(await page.text(`[data-collaborator="${other}"]`), new RegExp(`${S.repoSettings.roles.read}[\\s\\S]*${S.repoSettings.expires('').trim()}`));
  assert.match(await page.text('.box'), new RegExp(S.common.owner), 'the owner is listed');
  await page.click(`[data-collaborator="${other}"] button`, S.repoSettings.remove);
  await page.waitFor(`!document.querySelector('[data-collaborator="${other}"]')`, 'the collaborator to go');

  await go(page, `${REPO}/settings/branches`);
  assert.equal(await page.text('#main .blankslate h2'), S.repoSettings.noRules);
  await page.click('.page-head a', S.repoSettings.addRule);
  await page.arrive(`${REPO}/settings/branches/new`);
  const approvals = await page.field(S.repoSettings.approvals);
  const checks = await page.field(S.repoSettings.checks);
  await page.fill(approvals, '500');
  await page.fill(checks, 'Bad Name');
  await page.click('button', S.repoSettings.create);
  assert.equal(await page.text(`${approvals}-error`), S.repoSettings.approvalsInvalid);
  assert.equal(await page.text(`${checks}-error`), S.repoSettings.checksInvalid);
  await page.fill(approvals, '1');
  await page.fill(checks, '');
  await page.click('button', S.repoSettings.create);
  await page.arrive(`${REPO}/settings/branches`);
  assert.match(await page.text('[data-rule=main]'), new RegExp(`${S.repoSettings.anyWriter}[\\s\\S]*${S.repoSettings.approvalsNeeded(1)}`));
  await write(page, REPO, 'notes.txt', 'one\n', { create: true });
  await flashIs(page, 'error', S.code.protectedBranch);

  await go(page, `${REPO}/settings/branches/edit?branch=main`);
  assert.equal(await page.eval(`document.querySelector('${await page.field(S.repoSettings.approvals)}').value`), '1', 'the rule opens with its values');
  await page.eval("document.getElementById('rule-who').value = 'admin'");
  await page.click('button', S.common.save);
  await page.arrive(`${REPO}/settings/branches`);
  assert.match(await page.text('[data-rule=main]'), new RegExp(S.repoSettings.onlyOwner));
  await page.click('[data-rule=main] button', S.repoSettings.deleteRule);
  await page.waitFor("!document.querySelector('[data-rule]')", 'the rule to go');
  await write(page, REPO, 'notes.txt', 'one\n', { create: true });
  await onCommit(page);
  noErrors(page);
  await page.close();
});

test('the remote: published, marked when it falls behind, and a conflict with another person resolved on screen; a dead address and unfinished markers say what to do', async () => {
  const url = `${replica.url}/demo`;
  const ada = await withRepo();
  await go(ada, `${REPO}/settings/remote`);
  const address = await ada.field(S.remote.address);
  // Failures: not an address; nothing to publish yet; nobody answering.
  await ada.fill(address, 'nowhere');
  await ada.click('[data-push]');
  assert.equal(await ada.text(`${address}-error`), S.openRepo.addressInvalid);
  await ada.fill(address, url);
  await ada.click('[data-push]');
  await flashIs(ada, 'error', S.remote.nothingYet);
  await write(ada, REPO, 'notes.txt', 'one\n', { create: true });
  await onCommit(ada);
  await go(ada, `${REPO}/settings/remote`);
  await ada.fill(await ada.field(S.remote.address), 'http://127.0.0.1:9/nothing');
  await ada.click('[data-fetch]');
  await flashIs(ada, 'error', S.remote.unreachable);
  ada.errors.length = 0; // the browser logs the refused connection

  // Room for Bob, then publish.
  const bob = await person('Bob Builder');
  await go(bob, '/settings/security');
  const bobKey = await bob.text('[data-key]');
  await go(ada, `${REPO}/settings/collaborators`);
  await ada.fill(await ada.field(S.repoSettings.theirKey), bobKey);
  await ada.click('button', S.repoSettings.add);
  await ada.waitFor(`!!document.querySelector('[data-collaborator="${bobKey}"]')`, 'Bob in the list');
  await go(ada, `${REPO}/settings/remote`);
  assert.equal(await ada.text('[data-push]'), S.remote.publish, 'the first time it is Publish');
  await ada.fill(await ada.field(S.remote.address), url);
  await ada.click('[data-push]');
  await flashIs(ada, 'success', S.remote.published);
  assert.equal(await ada.text('[data-push]'), S.remote.push, 'after that it is Push');
  assert.equal(await ada.exists('.repo-head .unsynced'), false);

  // Bob opens it, changes the line, and publishes.
  await go(bob, '/open');
  await bob.fill(await bob.field(S.openRepo.address), url);
  await bob.click('button', S.openRepo.open);
  await bob.arrive('/127-0-0-1/demo');
  await write(bob, '/127-0-0-1/demo', 'notes.txt', 'one, says Bob\n');
  await onCommit(bob);
  await go(bob, '/127-0-0-1/demo/settings/remote');
  await bob.click('[data-push]');
  await flashIs(bob, 'success', S.remote.published);

  // Ada changes the same line. Her copy is now marked as not published.
  await write(ada, REPO, 'notes.txt', 'one, says Ada\n');
  await onCommit(ada);
  await go(ada, REPO);
  await ada.waitFor("!!document.querySelector('.repo-head .unsynced')", 'the not-published mark');
  assert.equal(await ada.text('.repo-head .unsynced'), S.common.notPublished);
  await go(ada, `${REPO}/settings/remote`);
  await flashIs(ada, 'warning', S.remote.waiting(1));
  // Pushing first is refused: there is something to fetch.
  await ada.click('[data-push]');
  await flashIs(ada, 'error', S.remote.fetchFirst);
  await ada.click('[data-fetch]');
  await ada.arrive(`${REPO}/resolve`);
  assert.equal(await ada.text('#main h2'), S.remote.resolveTitle(1));
  assert.match(await ada.eval("document.querySelector('#main textarea').value"), /<<<<<<<[\s\S]*says Ada[\s\S]*=======[\s\S]*says Bob[\s\S]*>>>>>>>/);
  // Failure: committing with the markers still there.
  await ada.click('button', S.remote.commitMerge);
  await flashIs(ada, 'error', S.remote.markersLeft('notes.txt'));
  await ada.fill('#main textarea', 'one, say Ada and Bob\n');
  await ada.click('button', S.remote.commitMerge);
  await onCommit(ada);
  await go(ada, `${REPO}/blob/main/notes.txt`);
  assert.equal(await ada.text('#L1 td.text'), 'one, say Ada and Bob');
  await go(ada, `${REPO}/settings/remote`);
  await ada.click('[data-push]');
  await flashIs(ada, 'success', S.remote.published);
  // Bob fetches the merge.
  await go(bob, '/127-0-0-1/demo/settings/remote');
  await bob.click('[data-fetch]');
  await flashIs(bob, 'success', S.remote.outcomes['fast-forward']);
  await go(bob, '/127-0-0-1/demo/blob/main/notes.txt');
  assert.equal(await bob.text('#L1 td.text'), 'one, say Ada and Bob');
  ada.errors.length = 0; bob.errors.length = 0;
  await ada.close(); await bob.close();
});

test('user settings: your repositories and where your data is kept; and nothing overflows at 360 px', async () => {
  const page = await withRepo({ width: 360, height: 740 });
  await go(page, '/settings/repositories');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#main a.title')].map((a) => a.textContent)"), ['ada-example / demo']);
  await go(page, '/settings/storage');
  await page.waitFor(`/^Using .+ of .+ available/.test(document.querySelector('#main p.muted').textContent)`, 'the space used');
  await page.click('[data-persist]');
  await page.waitFor("!!document.querySelector('#main .flash')", 'an answer about keeping the data');
  for (const path of ['/settings/repositories', '/settings/storage', `${REPO}/settings`, `${REPO}/settings/collaborators`, `${REPO}/settings/branches`, `${REPO}/settings/branches/new`, `${REPO}/settings/remote`]) {
    await go(page, path);
    assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${path} fits`);
  }
  noErrors(page);
  await page.close();
});
