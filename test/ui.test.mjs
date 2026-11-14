// The interface, driven in a real browser engine: each rebuilt screen through its main path and
// through one failure. Storage starts empty for every test.
// Needs web/engine.wasm (sh scripts/build-engine.sh) and a Chromium-family browser (test/browser.mjs).

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, makeFixture, root } from './helpers.mjs';
import { launch } from './browser.mjs';
import { serveWeb } from '../scripts/dev-web.mjs';
import { S, PRODUCT } from '../web/ui/strings.js';

let browser;
let site;
let prefixed;
let remote;

before(async () => {
  // web/sw.js is generated, not committed. Write it from the files as they are, as the build does, so the page under test is pinned.
  execFileSync(process.execPath, [join(root, 'scripts', 'shell-manifest.mjs')]);
  browser = await launch();
  site = await serveWeb();
  prefixed = await serveWeb({ prefix: '/project/' });
  remote = await serveWeb({ dir: makeFixture().served });
});
after(async () => {
  await browser.close();
  await Promise.all([site.close(), prefixed.close(), remote.close()]);
  cleanup();
});

// The value a token has in a theme, read from the generated file, so no colour is typed here either.
function token(theme, name) {
  const css = readFileSync(join(root, 'web', 'ui', 'tokens.css'), 'utf8');
  const block = css.slice(css.indexOf(`[data-theme="${theme}"]`));
  const rules = block.slice(0, block.indexOf('}'));
  let value = `var(${name})`;
  // A token may name another token; follow it to the colour.
  for (let i = 0; i < 6 && value.startsWith('var('); i += 1) value = rules.match(new RegExp(`${value.slice(4, -1)}: ([^;]+);`))[1];
  return `rgb(${[1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).join(', ')})`;
}

// Go through first run, so the rest of a test starts signed in.
async function signIn(page, name = 'Ada Example') {
  await page.goto(`${page.base}welcome`);
  await page.fill(await page.field(S.welcome.name), name);
  await page.fill(await page.field(S.welcome.email), 'ada@example.org');
  await page.click('button', S.common.continue);
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.repoTitle)}`, 'the third step');
}
async function open(options = {}, from = site) {
  const page = await browser.open(null, options);
  page.base = from.url;
  return page;
}
const noErrors = (page) => assert.deepEqual(page.errors, [], 'the page logged no errors');

test('landing: a signed-out visitor sees one action; an unknown address shows the not-found screen', async () => {
  const page = await open();
  await page.goto(site.url);
  assert.equal(await page.text('#main h1'), S.landing.title);
  assert.equal(await page.eval("document.querySelectorAll('#main a.btn').length"), 1, 'one action');
  assert.equal(await page.exists('#header details.menu'), false, 'no account menu when signed out');
  assert.equal(await page.eval('document.title'), `${S.landing.title} · ${PRODUCT}`);

  // Failure: a deep link nobody serves. The host answers with its 404 page, which hands the address to the app.
  await page.goto(`${site.url}no/such/place/here/at/all`);
  assert.equal(await page.path(), '/no/such/place/here/at/all');
  assert.match(await page.text(), new RegExp(S.repo.notHere));
  await page.goto(`${site.url}settings/nothing`);
  await page.arrive('/welcome');
  noErrors(page);
  await page.close();
});

test('first run: a name, a sign-in key, then a choice; blank and malformed fields are reported at the field', async () => {
  const page = await open();
  await page.goto(`${site.url}welcome`);
  assert.equal(await page.text('#main h1'), S.welcome.nameTitle);
  // Failure: submit with nothing typed.
  await page.click('button', S.common.continue);
  const name = await page.field(S.welcome.name);
  const email = await page.field(S.welcome.email);
  assert.equal(await page.text(`${name}-error`), S.welcome.nameBlank);
  assert.equal(await page.text(`${email}-error`), S.welcome.emailInvalid);
  assert.equal(await page.eval(`document.querySelector('${name}').getAttribute('aria-invalid')`), 'true');
  assert.equal(await page.eval(`'#' + document.activeElement.id`), name, 'focus moves to the first field in error');
  assert.equal(await page.eval(`document.querySelector('${name}').getAttribute('aria-describedby').includes('${name.slice(1)}-error')`), true);

  await page.fill(name, 'Ada Example');
  await page.fill(email, 'ada@example.org');
  await page.press('Enter', { ctrl: true });
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.keyTitle)}`, 'the second step');
  assert.equal(await page.exists('#header details.menu'), false, 'not signed in until the key exists');
  await page.click('button', S.welcome.createKey);
  await page.waitFor(`document.querySelector('#main h1').textContent === ${JSON.stringify(S.welcome.repoTitle)}`, 'the third step');
  assert.equal(await page.eval("document.querySelectorAll('#header details.menu').length"), 2, 'the create and account menus appear');
  await page.click('a', S.welcome.later);
  await page.arrive('/');
  assert.equal(await page.text('#main h1'), S.home.title);
  assert.match(await page.text(), new RegExp(S.home.empty));
  // First run is not offered twice.
  await page.reload();
  assert.equal(await page.text('#main h1'), S.home.title);
  noErrors(page);
  await page.close();
});

test('new repository: created with a first commit and listed on home; a bad or taken name is refused at the field', async () => {
  const page = await open();
  await signIn(page);
  await page.click('a', S.welcome.create);
  await page.arrive('/new');
  const name = await page.field(S.newRepo.name);
  // Failures: blank, then characters a repository name cannot have.
  await page.click('button', S.newRepo.create);
  assert.equal(await page.text(`${name}-error`), S.newRepo.nameBlank);
  await page.fill(name, 'has spaces');
  await page.click('button', S.newRepo.create);
  await page.waitFor(`document.querySelector('${name}-error').innerText === ${JSON.stringify(S.newRepo.nameInvalid)}`, 'the invalid-name message');

  await page.fill(name, 'hello-world');
  await page.fill(await page.field(S.newRepo.description), 'A first repository');
  await page.click('button', S.newRepo.create);
  await page.arrive('/ada-example/hello-world');
  assert.match(await page.text(), /README\.md/);
  assert.match(await page.text(), /A first repository/);
  assert.match(await page.text(), new RegExp(S.newRepo.initial));
  assert.equal(await page.eval('document.title'), `hello-world · ${PRODUCT}`);

  await page.click('a.brand');
  await page.arrive('/');
  assert.match(await page.text(), /hello-world/);
  assert.match(await page.text(), new RegExp(S.home.local));
  // Failure: the same name again.
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'hello-world');
  await page.click('button', S.newRepo.create);
  const again = await page.field(S.newRepo.name);
  await page.waitFor(`document.querySelector('${again}-error').innerText === ${JSON.stringify(S.newRepo.nameTaken('hello-world'))}`, 'the name-taken message');
  noErrors(page);
  await page.close();
});

test('open repository: a repository served as files is copied in; a bad or dead address says what to do', async () => {
  const page = await open();
  await signIn(page);
  await page.goto(`${site.url}open`);
  const address = await page.field(S.openRepo.address);
  await page.fill(address, 'not an address');
  await page.click('button', S.openRepo.open);
  assert.equal(await page.text(`${address}-error`), S.openRepo.addressInvalid);
  // Failure: an address where nothing answers.
  await page.fill(address, `${remote.url}missing.git`);
  await page.click('button', S.openRepo.open);
  await page.waitFor("!!document.querySelector('#main .flash.error')", 'the error message');
  assert.equal(await page.text('#main .flash.error'), S.openRepo.failed(S.openRepo.unreachable));
  assert.equal(await page.eval(`document.querySelector('#main .flash.error').getAttribute('role')`), 'alert');
  page.errors.length = 0; // the browser itself logs the failed request

  await page.fill(address, `${remote.url}fixture.git`);
  await page.click('button', S.openRepo.open);
  await page.arrive('/127-0-0-1/fixture');
  assert.match(await page.text(), /docs/);
  assert.match(await page.text(), /A repository for tests\./);
  noErrors(page);
  await page.close();
});

test('settings: the profile is validated and saved; a theme is applied at once, from the tokens, and kept', async () => {
  const page = await open({ scheme: 'light' });
  await signIn(page);
  await page.goto(`${site.url}settings`);
  assert.equal(await page.text('#main h2'), S.settings.profile);
  const name = await page.field(S.welcome.name);
  await page.fill(name, '');
  await page.click('button', S.settings.saveProfile);
  assert.equal(await page.text(`${name}-error`), S.welcome.nameBlank);
  await page.fill(name, 'Grace Hopper');
  await page.click('button', S.settings.saveProfile);
  await page.waitFor("!!document.querySelector('#main .flash.success')", 'the saved message');
  await page.waitFor("document.querySelector('#header .avatar').getAttribute('aria-label') === 'Grace Hopper'", 'the header to follow the profile');

  await page.click('.sidenav a', S.settings.appearance);
  await page.arrive('/settings/appearance');
  const background = () => page.eval('getComputedStyle(document.body).backgroundColor');
  assert.equal(await page.eval('document.documentElement.dataset.theme'), 'light', 'follows the system by default');
  assert.equal(await background(), token('light', '--bgColor-default'));
  await page.click('label.theme-card', S.settings.themes.dark_dimmed);
  await page.waitFor("document.documentElement.dataset.theme === 'dark_dimmed'", 'the theme to apply');
  assert.equal(await background(), token('dark_dimmed', '--bgColor-default'));
  await page.reload();
  assert.equal(await page.eval('document.documentElement.dataset.theme'), 'dark_dimmed', 'kept across a reload');
  assert.equal(await page.eval("document.querySelector('input[name=theme]:checked').value"), 'dark_dimmed');

  await page.click('.sidenav a', S.settings.security);
  await page.waitFor("!!document.querySelector('[data-key]')", 'the key');
  assert.match(await page.text('[data-key]'), /^[0-9a-f]{64}$/);
  // Failure: a settings page that does not exist.
  await page.goto(`${site.url}settings/billing`);
  assert.equal(await page.text('#main h3'), S.notFound.title);
  noErrors(page);
  await page.close();
});

test('a system set to dark gets the dark theme before anything is chosen', async () => {
  const page = await open({ scheme: 'dark' });
  await page.goto(site.url);
  assert.equal(await page.eval('document.documentElement.dataset.theme'), 'dark');
  assert.equal(await page.eval('getComputedStyle(document.body).backgroundColor'), token('dark', '--bgColor-default'));
  await page.close();
});

test('addresses: back, forward, reload and deep links work, and scroll position returns', async () => {
  const page = await open({ height: 600 });
  await signIn(page);
  await page.goto(`${site.url}-/gallery`);
  await page.eval('window.scrollTo(0, 900)');
  await page.waitFor('history.state && history.state.y === 900', 'the scroll position to be remembered');
  // Follow a link without the pointer (as Enter on a focused link does), so the test itself does not scroll the page.
  await page.eval("document.querySelector('a.brand').click()");
  await page.arrive('/');
  assert.equal(await page.eval('window.scrollY'), 0);
  assert.equal(await page.eval("document.activeElement.id"), 'main', 'focus moves to the new screen');
  await page.eval('history.back()');
  await page.arrive('/-/gallery');
  await page.waitFor('window.scrollY === 900', 'the scroll position to return');
  await page.eval('history.forward()');
  await page.arrive('/');

  // An address written by an older screen ('#/name/view') becomes a path.
  await page.eval("location.hash = '#/settings/appearance'");
  await page.arrive('/settings/appearance');
  assert.equal(await page.text('#main h2'), S.settings.themeTitle);

  // Once the service worker is in place it answers deep links itself, so a reload works with the host gone.
  await page.waitFor('navigator.serviceWorker.controller !== null', 'the service worker to take control', 30000);
  await page.offline(true);
  await page.reload();
  assert.equal(await page.path(), '/settings/appearance');
  assert.equal(await page.text('#main h2'), S.settings.themeTitle);
  assert.equal(await page.exists('head base'), true, 'served by the service worker');
  await page.waitFor("document.querySelector('[data-offline]') && !document.querySelector('[data-offline]').hidden", 'the offline mark');
  await page.offline(false);
  page.errors.length = 0; // the update check fails while offline, as it should
  await page.close();
});

test('served under a path prefix, every address keeps the prefix', async () => {
  const page = await open({}, prefixed);
  await signIn(page);
  assert.equal(await page.path(), '/project/welcome?step=3');
  await page.click('a', S.welcome.later);
  await page.arrive('/project/');
  // A deep link under the prefix, before the service worker exists: the host's 404 page finds the root by itself.
  await page.goto(`${prefixed.url}settings/appearance`);
  assert.equal(await page.path(), '/project/settings/appearance');
  assert.equal(await page.text('#main h2'), S.settings.themeTitle);
  noErrors(page);
  await page.close();
});

test('gallery: every part renders in every theme; dialogs, menus and the shortcut list work from the keyboard', async () => {
  const page = await open();
  await signIn(page);
  await page.goto(`${site.url}-/gallery`);
  assert.equal(await page.eval("document.querySelectorAll('#main section').length"), Object.keys(S.gallery).length - 2);
  assert.ok(await page.eval("document.querySelectorAll('#main .icons svg').length") > 80, 'the icon set');
  for (const theme of ['light', 'dark', 'dark_dimmed', 'light_high_contrast', 'dark_high_contrast']) {
    await page.eval(`document.documentElement.dataset.theme = '${theme}'`);
    assert.equal(await page.eval('getComputedStyle(document.body).backgroundColor'), token(theme, '--bgColor-default'), theme);
    assert.equal(await page.eval("getComputedStyle(document.querySelector('#main .btn-primary')).backgroundColor"), token(theme, '--button-primary-bgColor-rest'), `${theme} primary button`);
  }
  // Measurements the study recorded on github.com: 14 px text, 32 px controls, 6 px radius, 1 px borders.
  assert.equal(await page.eval('getComputedStyle(document.body).fontSize'), '14px');
  assert.deepEqual(await page.eval("(() => { const s = getComputedStyle(document.querySelector('#main .btn-primary')); return [s.height, s.borderRadius, s.borderTopWidth, s.fontWeight]; })()"), ['32px', '6px', '1px', '500']);
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#main .file-table td')).height"), '40px');

  await page.click('[data-open-dialog]');
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the dialog');
  await page.press('Escape');
  await page.waitFor("!document.querySelector('dialog')", 'the dialog to close');
  assert.equal(await page.eval("document.activeElement.hasAttribute('data-open-dialog')"), true, 'focus returns to the opener');

  await page.click('#main details.menu summary');
  await page.waitFor("!!document.querySelector('#main details.menu[open]')", 'the menu');
  await page.press('Escape');
  await page.waitFor("!document.querySelector('details.menu[open]')", 'the menu to close');

  await page.eval('document.activeElement.blur()');
  await page.press('?', { shift: true });
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the shortcut list');
  assert.equal(await page.text('dialog h2'), S.shortcuts.title);
  await page.press('Escape');
  // Failure: a shortcut must not fire while typing.
  await page.fill(await page.field('Repository name'), '');
  await page.press('?', { shift: true });
  assert.equal(await page.exists('dialog[open]'), false);
  noErrors(page);
  await page.close();
});

test('a repository screen sits in the new frame: tabs, the go-to keys, and the page it is not', async () => {
  const page = await open();
  await signIn(page);
  await page.goto(`${site.url}new`);
  await page.fill(await page.field(S.newRepo.name), 'demo');
  await page.click('button', S.newRepo.create);
  await page.arrive('/ada-example/demo');
  assert.equal(await page.eval("document.querySelector('#main nav.tabs a[aria-current=page]').textContent"), S.repo.code);
  await page.eval('document.activeElement.blur()');
  await page.press('g'); await page.press('p');
  await page.arrive('/ada-example/demo/pulls');
  await page.press('g'); await page.press('c');
  await page.arrive('/ada-example/demo');
  await page.click('[data-commits]');
  await page.arrive('/ada-example/demo/commits/main');
  assert.match(await page.text(), new RegExp(S.newRepo.initial));
  // Failure: a repository this browser does not hold.
  await page.goto(`${site.url}nothing-here`);
  assert.equal(await page.text('#main h3'), S.repo.notHere);
  noErrors(page);
  await page.close();
});

test('at 360 px wide nothing overflows sideways', async () => {
  const page = await open({ width: 360, height: 740 });
  await page.goto(site.url);
  const fits = async (what) => assert.ok(await page.eval('document.documentElement.scrollWidth <= window.innerWidth'), `${what} fits`);
  await fits('landing');
  await signIn(page);
  await fits('first run');
  for (const path of ['', 'new', 'open', 'settings/profile', 'settings/appearance', 'settings/security', '-/gallery']) { await page.goto(site.url + path); await fits(path || 'home'); }
  noErrors(page);
  await page.close();
});
