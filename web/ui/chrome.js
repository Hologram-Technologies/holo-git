// The frame around every screen: header, footer, the About and shortcut dialogs, menus and keys.
// An entry point appears only when its screen exists; nothing here links to an apology.

import { S, PRODUCT } from './strings.js';
import { el, icon, mark, button, menu, dialog, avatar, flash } from './components.js';
import { href, navigate } from './router.js';
import { shell, acceptUpdate } from '../shell.js';
import { repoPath } from './repo.js';

const header = () => document.getElementById('header');
const footer = () => document.getElementById('footer');
const notices = () => document.getElementById('notices');

// The complete header, as it will be once search, issues, pull request lists, explore and notifications exist.
// `only` limits it to the parts whose screens exist today; the gallery passes nothing and shows all of it.
export function headerNode({ user, only, bare }) {
  const has = (part) => !only || only.includes(part);
  const brand = el('a', { class: 'brand', href: href('/'), 'aria-label': S.header.home }, mark(), el('span', {}, PRODUCT));
  if (!user) return el('div', { class: 'app-header' }, brand, el('span', { class: 'spacer' }), offlineNode(), bare ? '' : button({ label: S.header.getStarted, kind: 'primary', href: href('/welcome') }));
  return el('div', { class: 'app-header' }, brand,
    has('search') && el('div', { class: 'search', role: 'search' }, icon('search'), el('input', { class: 'input', type: 'search', placeholder: S.header.searchPlaceholder, 'aria-label': S.header.search, 'data-shortcut': 'search' }), el('kbd', { 'aria-hidden': 'true' }, '/')),
    el('nav', { 'aria-label': S.header.navigation },
      has('issues') && button({ label: S.header.issues, kind: 'invisible', href: href('/issues') }),
      has('pulls') && button({ label: S.header.pulls, kind: 'invisible', href: href('/pulls') }),
      has('explore') && button({ label: S.header.explore, kind: 'invisible', href: href('/explore/repos') })),
    el('span', { class: 'spacer' }), offlineNode(),
    has('notifications') && button({ label: S.header.notifications, icon: 'bell', iconOnly: true, kind: 'invisible', href: href('/notifications') }),
    menu({ label: S.header.create, icon: 'plus', iconOnly: true, align: 'end', items: [
      { label: S.header.newRepository, icon: 'repo', href: href('/new') }, { label: S.header.openRepository, icon: 'download', href: href('/open') }] }),
    menu({ align: 'end', trigger: el('summary', { class: 'btn btn-invisible btn-icon', 'aria-label': S.header.account, 'aria-haspopup': 'menu' }, avatar(user.name, { size: 24 })), items: [
      { heading: `${S.header.signedInAs} ${user.name}` }, 'divider',
      { label: S.header.settings, icon: 'gear', href: href('/settings/profile') },
      { label: S.header.shortcuts, icon: 'question', onclick: openShortcuts },
      { label: S.header.gallery, icon: 'table', href: href('/-/gallery') }] }));
}

function offlineNode() {
  const node = el('span', { class: 'offline', role: 'status', 'data-offline': true }, icon('cloud-offline'), S.common.offline);
  node.hidden = navigator.onLine !== false;
  return node;
}

let current = { user: null, repo: null, firstRun: false };
export function drawFrame(state) {
  current = { ...current, ...state };
  // During first run the header offers nothing: the screen itself is the one action.
  header().replaceChildren(headerNode({ user: current.user, only: ['issues'], bare: current.firstRun }));
  footer().replaceChildren(
    el('span', {}, PRODUCT),
    el('button', { type: 'button', class: 'btn-link', onclick: openAbout }, S.footer.about),
    el('button', { type: 'button', class: 'btn-link', onclick: openShortcuts }, S.footer.shortcuts));
}
export const setRepoContext = (repo) => { current.repo = repo; };
// Keys that belong to the screen on show: [{ keys: 't', label, run }]. Replaced on every navigation.
let screenKeys = [];
export const setScreenKeys = (keys) => { screenKeys = keys; };

export function openAbout() {
  const value = shell.integrity;
  const line = el('div', { class: 'keyline', 'data-integrity': true }, value || S.about.unavailable);
  const copy = button({ label: S.common.copy, icon: 'copy', size: 'small', disabled: !value, onclick: async () => { await navigator.clipboard.writeText(value); copy.lastChild.textContent = S.common.copied; } });
  dialog({ title: S.about.title, body: el('div', { class: 'stack' },
    el('p', {}, S.about.lead), el('p', { class: 'muted' }, S.about.verified),
    shell.supported ? '' : flash('warning', S.about.noOffline),
    el('div', { class: 'stack condensed' }, el('div', { class: 'row' }, el('strong', {}, S.about.integrity), el('span', { class: 'spacer' }), copy), line, el('p', { class: 'muted small' }, S.about.integrityHint))) }).showModal();
}

const kbd = (...keys) => keys.map((key, i) => [i > 0 && el('span', { class: 'muted small' }, ` ${S.shortcuts.then} `), el('kbd', {}, key)]);
export function openShortcuts() {
  const table = (title, rows) => [el('h3', { class: 'small muted' }, title), el('table', { class: 'keys' }, el('tbody', {}, rows.map(([text, keys]) => el('tr', {}, el('td', {}, text), el('td', {}, keys)))))];
  dialog({ title: S.shortcuts.title, body: el('div', { class: 'stack' },
    table(S.shortcuts.site, [[S.shortcuts.help, kbd('?')], [S.shortcuts.submit, [el('kbd', {}, 'Ctrl'), ' ', el('kbd', {}, 'Enter')]], [S.shortcuts.closeDialog, kbd('Esc')]]),
    current.repo ? table(S.shortcuts.repository, [[S.shortcuts.goCode, kbd('g', 'c')], [S.shortcuts.goPulls, kbd('g', 'p')]]) : '',
    screenKeys.length ? table(S.code.shortcuts, screenKeys.map((key) => [key.label, kbd(key.keys)])) : '') }).showModal();
}

// Shown once, above the screen, when a newer version has been fetched and is waiting to be accepted.
export function drawUpdateNotice() {
  const existing = notices().querySelector('[data-update]');
  notices().hidden = !shell.waiting;
  if (!shell.waiting) { if (existing) existing.remove(); return; }
  if (existing) return;
  const node = flash('info', el('div', { class: 'row' }, el('span', {}, S.about.updateReady), button({ label: S.about.update, size: 'small', onclick: acceptUpdate })));
  node.dataset.update = '';
  notices().append(node);
}

const typing = (target) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function startChrome() {
  const sync = () => { for (const node of document.querySelectorAll('[data-offline]')) node.hidden = navigator.onLine; };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);

  // One menu open at a time; a click elsewhere or Escape closes it and returns focus to its button.
  document.addEventListener('click', (event) => { for (const open of document.querySelectorAll('details.menu[open]')) if (!open.contains(event.target)) open.open = false; });
  document.addEventListener('toggle', (event) => {
    if (!(event.target instanceof HTMLDetailsElement) || !event.target.classList.contains('menu') || !event.target.open) return;
    for (const other of document.querySelectorAll('details.menu[open]')) if (other !== event.target) other.open = false;
  }, true);

  let pending = null;
  let timer = 0;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const open = document.querySelector('details.menu[open]');
      if (open) { open.open = false; open.querySelector('summary').focus(); }
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      const form = event.target instanceof HTMLElement && event.target.closest('form');
      if (form) { event.preventDefault(); form.requestSubmit(); }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || document.querySelector('dialog[open]')) return;
    if (event.key === '?') { event.preventDefault(); openShortcuts(); return; }
    if (pending === 'g' && current.repo) {
      const target = { c: repoPath(current.repo), p: repoPath(current.repo, 'pulls') }[event.key];
      pending = null;
      if (target) { event.preventDefault(); navigate(target); }
      return;
    }
    if (event.key === 'g') { pending = 'g'; clearTimeout(timer); timer = setTimeout(() => { pending = null; }, 1500); return; }
    const own = screenKeys.find((key) => key.keys === event.key);
    if (own) { event.preventDefault(); own.run(); }
  });
}
