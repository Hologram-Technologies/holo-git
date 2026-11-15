// Around the code: releases, the wiki, and project boards.
//
// The page asks and shows. Whether a change counts is decided when it is signed; a refusal comes back
// as an error and is shown as "You don't have permission".

import { S } from './strings.js';
import { el, icon, button, menu, box, boxRow, blankslate, flash, field, textInput, textArea, validate, label, avatar, relativeTime, stateIcon, dialog, counter } from './components.js';
import { href, navigate, refresh } from './router.js';
import { profile } from './session.js';
import { repoHeader, repoHref, repoPath, show, short } from './repo.js';
import { renderMarkdown } from './markdown.js';
import { readLog } from './issues.js';
import { resolveCommit } from '../git.js';
import { saveRelease, saveWikiPage, saveProject, moveCard } from '../identity.js';

const who = (name, key) => name || key.slice(0, 7);
const refusal = (error) => (/does not count|protected branch/.test(error.message) ? S.issues.noPermission : /malformed/.test(error.message) ? S.issues.invalid : S.issues.failed);
async function attempt(note, run) {
  try { await run(); return true; } catch (error) { note.replaceChildren(flash('error', refusal(error))); note.scrollIntoView({ block: 'nearest' }); return false; }
}
const done = (context, title) => ({ title: `${title} · ${context.repo.name}`, repo: context.repo });
const page = (context, tab, ...children) => show('wide', repoHeader(context, tab), el('div', { class: 'page stack' }, children));
function absent(context, tab, name, title, action) {
  page(context, tab, blankslate({ icon: name, title, action }));
  return { title: S.notFound.title, repo: context.repo };
}
const head = (title, ...actions) => el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, title), el('span', { class: 'spacer' }), actions);
function confirm({ title, text, action, run }) {
  const node = dialog({ title, body: el('p', {}, text), footer: [button({ label: S.common.cancel, onclick: () => node.close() }), button({ label: action, kind: 'danger', attrs: { 'data-confirm': '' }, onclick: async () => { node.close(); await run(); } })] });
  node.showModal();
}
const search = () => new URLSearchParams(location.search);

// ---- Releases ----

const TAG = /^[^\s~^:?*[\\]{1,100}$/;
const tagOk = (tag) => TAG.test(tag) && !tag.startsWith('-') && !tag.includes('..');

function releaseBox(context, release, latest, actions) {
  const author = who(release.name, release.author);
  return el('div', { class: 'box release', 'data-release': release.tag },
    el('div', { class: 'box-head' }, el('a', { class: 'release-title', href: repoHref(context.repo, 'releases', 'tag', release.tag) }, release.title),
      release === latest && label(S.releases.latest, 'success'), release.prerelease && label(S.releases.prerelease, 'attention'), el('span', { class: 'spacer' }), actions),
    el('div', { class: 'box-body stack' },
      el('div', { class: 'row muted' }, avatar(author), el('strong', {}, author), S.releases.released, relativeTime(release.time),
        el('span', { class: 'row' }, icon('tag'), release.tag), el('a', { class: 'row mono', href: repoHref(context.repo, 'commit', release.target) }, icon('git-commit'), short(release.target)),
        el('a', { class: 'row', href: repoHref(context.repo, 'tree', release.target) }, icon('code'), S.releases.browse)),
      release.body.trim() ? renderMarkdown(release.body, { reference: (n) => repoHref(context.repo, 'issues', n) }) : el('p', { class: 'muted' }, S.releases.noNotes)));
}

export async function releases(context, more) {
  const state = await readLog(context.repo.name);
  const list = [...state.releases].sort((a, b) => b.time - a.time);
  const latest = list.find((release) => !release.prerelease);
  const create = () => button({ label: S.releases.new, kind: 'primary', href: repoHref(context.repo, 'releases', 'new') });
  if (more[0] === 'new') return releaseForm(context, state, null);
  if (more[0] === 'tag' || more[0] === 'edit') {
    const tag = decodeURIComponent(more.slice(1).join('/'));
    const release = list.find((item) => item.tag === tag);
    if (!release) return absent(context, 'releases', 'tag', S.releases.notFound, button({ label: S.releases.back, href: repoHref(context.repo, 'releases') }));
    if (more[0] === 'edit') return releaseForm(context, state, release);
    const note = el('div', {});
    const remove = () => confirm({ title: S.releases.deleteTitle, text: S.releases.deleteText, action: S.releases.deleteConfirm,
      run: async () => { if (await attempt(note, () => saveRelease(context.repo.name, { ...release, removed: true, name: profile().name }))) navigate(repoPath(context.repo, 'releases')); } });
    page(context, 'releases', el('div', {}, el('a', { class: 'row', href: repoHref(context.repo, 'releases') }, icon('chevron-left'), S.releases.back)), note,
      releaseBox(context, release, latest, [button({ label: S.releases.edit, size: 'small', href: repoHref(context.repo, 'releases', 'edit', release.tag) }), button({ label: S.releases.delete, size: 'small', kind: 'danger', onclick: remove, attrs: { 'data-delete-release': '' } })]));
    return done(context, `${release.title} · ${S.releases.title}`);
  }
  if (more[0]) return absent(context, 'releases', 'tag', S.notFound.title, button({ label: S.releases.back, href: repoHref(context.repo, 'releases') }));
  page(context, 'releases', head(S.releases.title, list.length ? create() : ''),
    list.length ? list.map((release) => releaseBox(context, release, latest)) : blankslate({ icon: 'tag', title: S.releases.none, text: S.releases.noneText, action: create() }));
  return done(context, S.releases.title);
}

function releaseForm(context, state, known) {
  const tag = field({ label: S.releases.tag, hint: S.releases.tagHint, control: textInput({ value: known ? known.tag : '', maxlength: 100 }) });
  const branch = el('select', { class: 'select' }, context.branches.map((name) => { const option = el('option', { value: name }, name); option.selected = name === context.head; return option; }));
  const target = field({ label: S.releases.target, hint: S.releases.targetHint, control: branch });
  const title = field({ label: S.releases.titleField, control: textInput({ value: known ? known.title : '', maxlength: 200 }) });
  const notes = field({ label: S.releases.notes, optional: S.newRepo.optional, control: textArea({ rows: 10 }) });
  notes.control.value = known ? known.body : '';
  const pre = el('input', { type: 'checkbox', id: 'prerelease', checked: Boolean(known && known.prerelease) });
  const note = el('div', {});
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const value = tag.control.value.trim();
    const taken = state.releases.some((other) => other.tag === value && (!known || other.id !== known.id));
    if (!validate([[tag, !value ? S.releases.tagBlank : !tagOk(value) ? S.releases.tagInvalid : taken ? S.releases.tagTaken : ''], [title, title.control.value.trim() ? '' : S.releases.titleBlank]])) return;
    const sent = await attempt(note, async () => {
      // An existing tag is used as it is; otherwise the release marks the newest commit of the chosen branch.
      const at = known ? known.target : (await resolveCommit(context.refs, context.refs[`refs/tags/${value}`] ? `refs/tags/${value}` : `refs/heads/${branch.value}`)).id;
      await saveRelease(context.repo.name, { id: known ? known.id : undefined, tag: value, target: at, title: title.control.value, body: notes.control.value, prerelease: pre.checked, name: profile().name });
    });
    if (sent) navigate(repoPath(context.repo, 'releases', 'tag', value));
  } }, el('h1', { class: 'page-title' }, known ? S.releases.editTitle : S.releases.new), note, tag, known ? '' : target, title, notes,
  el('div', { class: 'field' }, el('label', { class: 'row', for: 'prerelease' }, pre, S.releases.markPrerelease), el('span', { class: 'hint' }, S.releases.prereleaseHint)),
  el('div', { class: 'row' }, button({ label: known ? S.releases.update : S.releases.publish, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: repoHref(context.repo, 'releases') })));
  show('wide', repoHeader(context, 'releases'), el('div', { class: 'page form' }, form));
  tag.control.focus();
  return done(context, known ? S.releases.editTitle : S.releases.new);
}

// ---- Wiki ----

const wikiHref = (context, ...rest) => repoHref(context.repo, 'wiki', ...rest);
// [[Another page]] links to that page; everything else is ordinary Markdown.
const wikiText = (context, body) => renderMarkdown(body.replace(/\[\[([^[\]\n|]{1,100})\]\]/g, (_, name) => `[${name.trim()}](wiki:${encodeURIComponent(name.trim())})`),
  { link: (target) => (target.startsWith('wiki:') ? wikiHref(context, decodeURIComponent(target.slice(5))) : /^(https?:|mailto:|#)/i.test(target) ? target : null) });
const livePages = (state) => [...state.wiki.values()].filter((item) => !item.removed).sort((a, b) => (a.title === S.wiki.home ? -1 : b.title === S.wiki.home ? 1 : a.title.localeCompare(b.title)));

export async function wiki(context, more) {
  const state = await readLog(context.repo.name);
  const pages = livePages(state);
  if (more[0] === '_new') return wikiForm(context, state, null);
  const name = more[0] ? decodeURIComponent(more[0]) : pages[0] ? pages[0].title : '';
  const known = state.wiki.get(name);
  if (known && more[1] === '_history') return wikiHistory(context, known);
  if (!name) return (page(context, 'wiki', blankslate({ icon: 'book', title: S.wiki.none, text: S.wiki.noneText, action: button({ label: S.wiki.createFirst, kind: 'primary', href: `${wikiHref(context, '_new')}?title=${encodeURIComponent(S.wiki.home)}` }) })), done(context, S.wiki.title));
  if (!known || known.removed || (more[1] && more[1] !== '_edit')) {
    return absent(context, 'wiki', 'book', S.wiki.missing(name), [button({ label: S.wiki.createThis, kind: 'primary', href: `${wikiHref(context, '_new')}?title=${encodeURIComponent(name)}` }), known ? button({ label: S.wiki.history, href: wikiHref(context, name, '_history') }) : '']);
  }
  if (more[1] === '_edit') return wikiForm(context, state, known);
  const version = known.revisions[Number(search().get('version')) - 1];
  const old = version && version !== known.revisions[known.revisions.length - 1];
  const last = known.revisions[known.revisions.length - 1];
  page(context, 'wiki', head(known.title, button({ label: S.wiki.history, icon: 'history', href: wikiHref(context, known.title, '_history') }), button({ label: S.wiki.edit, icon: 'pencil', href: wikiHref(context, known.title, '_edit') }), button({ label: S.wiki.newPage, kind: 'primary', href: wikiHref(context, '_new') })),
    el('div', { class: 'columns' },
      el('div', { class: 'stack' }, old ? flash('warning', [S.wiki.older, ' ', el('a', { href: wikiHref(context, known.title) }, S.wiki.current)]) : '',
        box({ body: wikiText(context, old ? version.body : known.body) }),
        el('p', { class: 'muted' }, S.wiki.lastEdited(who(last.name, last.key)), ' ', relativeTime(last.time), ' · ', S.wiki.revisions(known.revisions.length))),
      el('aside', { class: 'stack side' }, box({ head: el('strong', {}, S.wiki.pages), rows: pages.map((item) => boxRow({ title: item.title, href: wikiHref(context, item.title) })) }))));
  return done(context, `${known.title} · ${S.wiki.title}`);
}

function wikiForm(context, state, known) {
  const title = field({ label: S.wiki.pageTitle, control: textInput({ value: known ? known.title : (search().get('title') || ''), maxlength: 100, readonly: Boolean(known) }) });
  const body = field({ label: S.wiki.content, hint: S.wiki.contentHint, control: textArea({ rows: 16 }) });
  body.control.value = known ? known.body : '';
  const note = el('div', {});
  const name = () => profile().name;
  const remove = () => confirm({ title: S.wiki.deleteTitle, text: S.wiki.deleteText, action: S.wiki.delete,
    run: async () => { if (await attempt(note, () => saveWikiPage(context.repo.name, { page: known.title, removed: true, name: name() }))) navigate(repoPath(context.repo, 'wiki')); } });
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const value = title.control.value.trim();
    const other = state.wiki.get(value);
    if (!validate([[title, !value ? S.wiki.titleBlank : /\//.test(value) || value.startsWith('_') ? S.wiki.titleInvalid : !known && other && !other.removed ? S.wiki.titleTaken : '']])) return;
    if (await attempt(note, () => saveWikiPage(context.repo.name, { page: value, body: body.control.value, name: name() }))) navigate(repoPath(context.repo, 'wiki', value));
  } }, el('h1', { class: 'page-title' }, known ? S.wiki.editTitle(known.title) : S.wiki.newPage), note, title, body,
  el('div', { class: 'row' }, button({ label: S.wiki.save, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: known ? wikiHref(context, known.title) : wikiHref(context) }),
    known ? [el('span', { class: 'main' }), button({ label: S.wiki.delete, kind: 'danger', onclick: remove, attrs: { 'data-delete-page': '' } })] : ''));
  show('wide', repoHeader(context, 'wiki'), el('div', { class: 'page form' }, form));
  (known ? body : title).control.focus();
  return done(context, known ? S.wiki.editTitle(known.title) : S.wiki.newPage);
}

function wikiHistory(context, known) {
  const rows = known.revisions.map((revision, i) => boxRow({ lead: avatar(who(revision.name, revision.key)), title: [who(revision.name, revision.key), ' ', revision.removed ? S.wiki.deleted : S.wiki.saved],
    href: revision.removed ? undefined : `${wikiHref(context, known.title)}?version=${i + 1}`, meta: relativeTime(revision.time) })).reverse();
  page(context, 'wiki', head(S.wiki.historyOf(known.title), known.removed ? '' : button({ label: S.wiki.view, href: wikiHref(context, known.title) })), box({ head: el('strong', {}, S.wiki.revisions(known.revisions.length)), rows }));
  return done(context, `${S.wiki.historyOf(known.title)} · ${S.wiki.title}`);
}

// ---- Projects ----

export async function projects(context, more) {
  const state = await readLog(context.repo.name);
  const back = () => button({ label: S.projects.back, href: repoHref(context.repo, 'projects') });
  if (more[0] === 'new') return projectForm(context, null);
  if (more[0]) {
    const project = state.projects.find((item) => String(item.number) === more[0]);
    if (!project || (more[1] && more[1] !== 'edit')) return absent(context, 'projects', 'project', S.projects.notFound, back());
    return more[1] === 'edit' ? projectForm(context, project) : board(context, state, project);
  }
  const wanted = search().get('state') === 'closed' ? 'closed' : 'open';
  const count = (is) => state.projects.filter((item) => item.state === is).length;
  const create = () => button({ label: S.projects.new, kind: 'primary', href: repoHref(context.repo, 'projects', 'new') });
  const rows = state.projects.filter((item) => item.state === wanted).map((item) => boxRow({ lead: icon('project', { class: 'fg-muted' }), title: item.title, href: repoHref(context.repo, 'projects', item.number),
    meta: [`#${item.number} · `, S.projects.items(item.cards.size), item.description ? ` · ${item.description}` : ''] }));
  page(context, 'projects', head(S.projects.title, create()),
    box({ head: [el('a', { class: wanted === 'open' ? 'tab-on' : 'muted', href: repoHref(context.repo, 'projects') }, icon('project'), ' ', S.issues.openCount(count('open'))), el('a', { class: wanted === 'closed' ? 'tab-on' : 'muted', href: `${repoHref(context.repo, 'projects')}?state=closed` }, icon('check'), ' ', S.issues.closedCount(count('closed')))],
      rows: rows.length ? rows : blankslate({ icon: 'project', title: wanted === 'open' ? S.projects.none : S.projects.noClosed, text: wanted === 'open' ? S.projects.noneText : '', action: wanted === 'open' ? create() : '' }) }));
  return done(context, S.projects.title);
}

function projectForm(context, known) {
  const title = field({ label: S.projects.name, control: textInput({ value: known ? known.title : '', maxlength: 100 }) });
  const description = field({ label: S.newRepo.description, optional: S.newRepo.optional, control: textArea({ rows: 3, maxlength: 2000 }) });
  description.control.value = known ? known.description : '';
  const note = el('div', {});
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    if (!validate([[title, title.control.value.trim() ? '' : S.projects.nameBlank]])) return;
    let id;
    const columns = known ? known.columns : Object.values(S.projects.columns).map((text) => ({ title: text }));
    if (!(await attempt(note, async () => { id = await saveProject(context.repo.name, { id: known ? known.id : undefined, title: title.control.value, description: description.control.value, state: known ? known.state : 'open', columns, name: profile().name }); }))) return;
    const saved = (await readLog(context.repo.name)).projects.find((item) => item.id === id);
    navigate(repoPath(context.repo, 'projects', saved.number));
  } }, el('h1', { class: 'page-title' }, known ? S.projects.editTitle : S.projects.new), note, title, description,
  el('div', { class: 'row' }, button({ label: known ? S.common.save : S.projects.create, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: known ? repoHref(context.repo, 'projects', known.number) : repoHref(context.repo, 'projects') })));
  show('wide', repoHeader(context, 'projects'), el('div', { class: 'page form' }, form));
  title.control.focus();
  return done(context, known ? S.projects.editTitle : S.projects.new);
}

function askName({ title, value = '', action, run }) {
  const name = field({ label: S.projects.columnName, control: textInput({ value, maxlength: 50 }) });
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const text = name.control.value.trim();
    if (!validate([[name, text ? '' : S.projects.columnBlank]])) return;
    node.close();
    await run(text);
  } }, name, el('div', { class: 'row' }, button({ label: action, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, onclick: () => node.close() })));
  const node = dialog({ title, body: form });
  node.showModal();
  name.control.focus();
}

function board(context, state, project) {
  const repo = context.repo.name;
  const name = profile().name;
  const note = el('div', {});
  const save = (change) => async () => { if (await attempt(note, () => saveProject(repo, { id: project.id, title: project.title, description: project.description, state: project.state, columns: project.columns, name, ...change }))) refresh(); };
  const place = (item, column, position) => async () => { if (await attempt(note, () => moveCard(repo, project.id, item, column, position, name))) refresh(); };
  const items = new Map([
    ...state.issues.map((issue) => [issue.id, { kind: 'issue', state: issue.state === 'open' ? 'open' : 'closed', number: issue.number, title: issue.title, href: repoHref(context.repo, 'issues', issue.number) }]),
    ...state.pulls.map((pull) => [pull.id, { kind: 'pull', state: pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open', number: pull.number, title: pull.title, href: repoHref(context.repo, 'pull', pull.number) }])]);
  const cardsIn = (column) => [...project.cards].filter(([id, card]) => card.column === column.id && items.has(id)).sort((a, b) => a[1].position - b[1].position).map(([id, card]) => ({ id, position: card.position, ...items.get(id) }));
  const end = (column) => { const cards = cardsIn(column); return cards.length ? cards[cards.length - 1].position + 1 : 1; };
  const offBoard = [...items].filter(([id, item]) => !project.cards.has(id) && item.state === 'open');

  const cardNode = (card, column) => {
    const node = el('div', { class: 'board-card', draggable: 'true', 'data-item': card.id },
      el('div', { class: 'row' }, stateIcon(card.state, card.kind), el('span', { class: 'muted' }, `#${card.number}`), el('span', { class: 'spacer' }),
        menu({ label: S.projects.cardOptions(card.title), iconOnly: true, icon: 'kebab-horizontal', kind: 'invisible', size: 'small', align: 'end', attrs: { 'data-card-menu': '' },
          items: [...project.columns.filter((other) => other.id !== column.id).map((other) => ({ label: S.projects.moveTo(other.title), icon: 'arrow-right', onclick: place(card.id, other.id, end(other)) })), 'divider', { label: S.projects.remove, icon: 'x', danger: true, onclick: place(card.id, '', 0) }] })),
      el('a', { class: 'title', href: card.href }, card.title));
    node.addEventListener('dragstart', (event) => { event.dataTransfer.setData('text/plain', card.id); event.dataTransfer.effectAllowed = 'move'; });
    return node;
  };
  const columnNode = (column) => {
    const cards = cardsIn(column);
    const list = el('div', { class: 'board-cards' }, cards.length ? cards.map((card) => cardNode(card, column)) : el('p', { class: 'muted board-empty' }, S.projects.empty));
    list.addEventListener('dragover', (event) => { event.preventDefault(); list.classList.add('over'); });
    list.addEventListener('dragleave', () => list.classList.remove('over'));
    list.addEventListener('drop', (event) => {
      event.preventDefault();
      list.classList.remove('over');
      const id = event.dataTransfer.getData('text/plain');
      if (!items.has(id)) return;
      // Dropped above the middle of a card: it goes before that card. Otherwise it goes last.
      const others = cards.filter((card) => card.id !== id);
      const nodes = [...list.querySelectorAll('[data-item]')].filter((node) => node.dataset.item !== id);
      let index = nodes.findIndex((node) => { const r = node.getBoundingClientRect(); return event.clientY < r.top + r.height / 2; });
      if (index < 0) index = others.length;
      const before = others[index - 1]; const after = others[index];
      place(id, column.id, before && after ? (before.position + after.position) / 2 : before ? before.position + 1 : after ? after.position - 1 : 1)();
    });
    return el('section', { class: 'board-column', 'data-column': column.title, 'aria-label': column.title },
      el('div', { class: 'board-head' }, el('h2', {}, column.title), counter(cards.length), el('span', { class: 'spacer' }),
        menu({ label: S.projects.addItem, iconOnly: true, icon: 'plus', kind: 'invisible', size: 'small', align: 'end', attrs: { 'data-add': '' },
          items: offBoard.length ? offBoard.map(([id, item]) => ({ label: `#${item.number} ${item.title}`, icon: item.kind === 'pull' ? 'git-pull-request' : 'issue-opened', onclick: place(id, column.id, end(column)) })) : [{ heading: S.projects.nothingToAdd }] }),
        menu({ label: S.projects.columnOptions(column.title), iconOnly: true, icon: 'kebab-horizontal', kind: 'invisible', size: 'small', align: 'end', attrs: { 'data-column-menu': '' },
          items: [{ label: S.projects.rename, icon: 'pencil', onclick: () => askName({ title: S.projects.renameColumn, value: column.title, action: S.projects.rename, run: (text) => save({ columns: project.columns.map((other) => (other.id === column.id ? { ...other, title: text } : other)) })() }) },
            { label: S.projects.deleteColumn, icon: 'trash', danger: true, onclick: save({ columns: project.columns.filter((other) => other.id !== column.id) }) }] })),
      list);
  };
  const addColumn = () => (project.columns.length >= 20 ? note.replaceChildren(flash('error', S.projects.tooMany))
    : askName({ title: S.projects.addColumn, action: S.projects.add, run: (text) => save({ columns: [...project.columns, { title: text }] })() }));
  page(context, 'projects',
    head([project.title, ' ', el('span', { class: 'muted' }, `#${project.number}`)], project.state === 'closed' ? label(S.projects.closed) : '', button({ label: S.projects.addColumn, icon: 'plus', onclick: addColumn, attrs: { 'data-add-column': '' } }),
      menu({ label: S.projects.options, iconOnly: true, icon: 'kebab-horizontal', align: 'end', attrs: { 'data-project-menu': '' }, items: [{ label: S.projects.edit, icon: 'pencil', href: repoHref(context.repo, 'projects', project.number, 'edit') },
        { label: project.state === 'open' ? S.projects.close : S.projects.reopen, icon: project.state === 'open' ? 'x' : 'sync', onclick: save({ state: project.state === 'open' ? 'closed' : 'open' }) }] })),
    project.description ? el('p', { class: 'muted' }, project.description) : '', note,
    project.columns.length ? el('div', { class: 'board' }, project.columns.map(columnNode)) : blankslate({ icon: 'project', title: S.projects.noColumns, action: button({ label: S.projects.addColumn, kind: 'primary', onclick: addColumn }) }));
  return done(context, `${project.title} · ${S.projects.title}`);
}
void href;
