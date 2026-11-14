// Issues: the list with its filters, one issue with its timeline and sidebar, new issue, labels,
// milestones, and the list across every repository in this browser.
//
// The page asks and shows. Whether a change counts is decided when it is signed onto the log; a refusal
// comes back as an error and is shown as "You don't have permission".

import { S } from './strings.js';
import { el, icon, button, menu, box, boxRow, blankslate, flash, field, textInput, textArea, validate, issueLabel, stateBadge, stateIcon, avatar, relativeTime, commentBox, comment, timeline, timelineItem, counter, label as plainLabel } from './components.js';
import { href, navigate, refresh } from './router.js';
import { profile } from './session.js';
import { repoHeader, repoHref, repoPath, show, ownerOf } from './repo.js';
import { renderMarkdown } from './markdown.js';
import { listRefUpdates, listRepos } from '../store.js';
import { fold } from '../log.js';
import { deviceKey, openIssue, addComment, setIssue, saveLabel, removeLabel, saveMilestone } from '../identity.js';

// Reading a log checks every signature in it. The result is kept until the log grows.
const folded = new Map();
export async function readLog(name) {
  const log = await listRefUpdates(name);
  const stamp = `${log.length}:${log.length ? log[log.length - 1].signature : ''}`;
  const known = folded.get(name);
  if (known && known.stamp === stamp) return known.state;
  const state = await fold(log);
  folded.set(name, { stamp, state });
  return state;
}
export const openIssueCount = async (name) => { try { return (await readLog(name)).issues.filter((issue) => issue.state === 'open').length; } catch { return 0; } };

const who = (name, key) => name || key.slice(0, 7);
const me = async () => (await deviceKey()).id;
const refusal = (error) => (/does not count/.test(error.message) ? S.issues.noPermission : /malformed|needs a|is 1 to 50|six hexadecimal/.test(error.message) ? S.issues.invalid : S.issues.failed);
// Run a change; on refusal say why in `note`. Returns whether it went through.
async function attempt(note, run) {
  try { await run(); return true; } catch (error) { note.replaceChildren(flash('error', refusal(error))); note.scrollIntoView({ block: 'nearest' }); return false; }
}
const markdown = (context, text) => renderMarkdown(text, { reference: (n) => repoHref(context.repo, 'issues', n) });

// 'is:open label:bug milestone:"v1.0" author:ada sort:oldest some words' -> its parts.
export function parseQuery(text) {
  const query = { is: 'open', labels: [], milestone: null, author: null, assignee: null, sort: 'newest', words: [] };
  for (const m of String(text || '').matchAll(/(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g)) {
    const key = (m[1] || m[3] || '').toLowerCase(); const value = m[2] ?? m[4];
    if (key === 'is' && ['open', 'closed'].includes(value)) query.is = value;
    else if (key === 'is' && value === 'issue') continue;
    else if (key === 'label') query.labels.push(value);
    else if (key === 'milestone') query.milestone = value;
    else if (key === 'author') query.author = value.toLowerCase();
    else if (key === 'assignee') query.assignee = value.toLowerCase();
    else if (key === 'sort') query.sort = value;
    else query.words.push((m[5] ?? m[6] ?? m[0]).toLowerCase());
  }
  return query;
}
const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
// The same query with one part changed, as text for the address.
function withQuery(text, change) {
  const kept = [...String(text || '').matchAll(/\w+:"[^"]*"|\S+/g)].map((m) => m[0]).filter((part) => !change.drop.some((prefix) => part.toLowerCase().startsWith(prefix)));
  return [...kept, ...(change.add || [])].join(' ');
}
const SORTS = { newest: (a, b) => b.time - a.time, oldest: (a, b) => a.time - b.time, comments: (a, b) => b.comments - a.comments, updated: (a, b) => b.updated - a.updated };

function matches(issue, query, state, mine) {
  const title = (id) => (state.milestones.find((m) => m.id === id) || {}).title;
  const person = (name, key, wanted) => wanted === '@me' ? key === mine : who(name, key).toLowerCase().includes(wanted);
  return query.labels.every((name) => issue.labels.includes(name)) && (!query.milestone || title(issue.milestone) === query.milestone)
    && (!query.author || person(issue.name, issue.author, query.author)) && (!query.assignee || issue.assignees.some((key) => (query.assignee === '@me' ? key === mine : key.startsWith(query.assignee))))
    && query.words.every((word) => `${issue.title}\n${issue.body}`.toLowerCase().includes(word));
}

function issueRow(repo, state, issue, { showRepo } = {}) {
  const milestone = state.milestones.find((m) => m.id === issue.milestone);
  return boxRow({ lead: stateIcon(issue.state === 'open' ? 'open' : 'closed'), title: issue.title, href: repoHref(repo, 'issues', issue.number),
    meta: [showRepo && el('span', {}, `${ownerOf(repo)}/${repo.name} `), `#${issue.number} `, S.issues.openedBy(who(issue.name, issue.author)), ' ', relativeTime(issue.time), milestone && [' · ', icon('milestone'), ' ', milestone.title],
      issue.labels.length ? [' ', issue.labels.map((name) => [issueLabel(name, (state.labels.get(name) || {}).color || ''), ' '])] : ''],
    aside: [issue.assignees.length ? issue.assignees.slice(0, 3).map((key) => avatar(key.slice(0, 7))) : '', issue.comments ? el('span', { class: 'row' }, icon('comment'), issue.comments) : ''] });
}

export async function list(context) {
  const state = await readLog(context.repo.name);
  const text = new URLSearchParams(location.search).get('q') ?? 'is:open';
  const query = parseQuery(text);
  const mine = await me();
  const base = repoPath(context.repo, 'issues');
  const to = (next) => `${href(base)}?q=${encodeURIComponent(next)}`;
  const pool = state.issues.filter((issue) => matches(issue, query, state, mine));
  const shown = pool.filter((issue) => issue.state === query.is).sort(SORTS[query.sort] || SORTS.newest);
  const count = (is) => pool.filter((issue) => issue.state === is).length;
  const search = el('form', { class: 'main', role: 'search', onsubmit: (event) => { event.preventDefault(); navigate(`${base}?q=${encodeURIComponent(event.currentTarget.elements.q.value.trim())}`); } },
    textInput({ type: 'search', name: 'q', value: text, 'aria-label': S.issues.search, placeholder: S.issues.search, 'data-issue-search': '' }));
  const pick = (title, prefix, values, current) => menu({ label: title, kind: 'invisible', size: 'small', align: 'end', items: values.length ? values.map((value) => ({ label: value, icon: current.includes(value) ? 'check' : undefined,
    href: to(withQuery(text, current.includes(value) ? { drop: [`${prefix}:${quote(value).toLowerCase()}`] } : { drop: prefix === 'label' ? [] : [`${prefix}:`], add: [`${prefix}:${quote(value)}`] })) })) : [{ heading: S.issues.nothingToPick }] });
  const head = [el('a', { class: query.is === 'open' ? 'tab-on' : 'muted', href: to(withQuery(text, { drop: ['is:'], add: ['is:open'] })), 'data-count': 'open' }, icon('issue-opened'), ' ', S.issues.openCount(count('open'))),
    el('a', { class: query.is === 'closed' ? 'tab-on' : 'muted', href: to(withQuery(text, { drop: ['is:'], add: ['is:closed'] })), 'data-count': 'closed' }, icon('check'), ' ', S.issues.closedCount(count('closed'))), el('span', { class: 'spacer' }),
    pick(S.issues.labelFilter, 'label', [...state.labels.keys()], query.labels), pick(S.issues.milestone, 'milestone', state.milestones.map((m) => m.title), query.milestone ? [query.milestone] : []),
    menu({ label: S.issues.sort, kind: 'invisible', size: 'small', align: 'end', items: Object.keys(SORTS).map((key) => ({ label: S.issues.sorts[key], icon: query.sort === key ? 'check' : undefined, href: to(withQuery(text, { drop: ['sort:'], add: key === 'newest' ? [] : [`sort:${key}`] })) })) })];
  const empty = !state.issues.length ? blankslate({ icon: 'issue-opened', title: S.issues.none, action: button({ label: S.issues.new, kind: 'primary', href: repoHref(context.repo, 'issues', 'new') }) })
    : blankslate({ icon: 'search', title: S.issues.noMatch, action: button({ label: S.issues.clear, href: href(base) }) });
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page stack' },
    el('div', { class: 'row' }, search, button({ label: S.issues.labels, icon: 'tag', href: repoHref(context.repo, 'labels') }), button({ label: S.issues.milestones, icon: 'milestone', href: repoHref(context.repo, 'milestones') }),
      button({ label: S.issues.new, kind: 'primary', href: repoHref(context.repo, 'issues', 'new') })),
    box({ head, rows: shown.length ? shown.map((issue) => issueRow(context.repo, state, issue)) : empty })));
  return { title: `${S.issues.title} · ${context.repo.name}`, repo: context.repo,
    keys: [{ keys: 'c', label: S.issues.new, run: () => navigate(repoPath(context.repo, 'issues', 'new')) }, { keys: '/', label: S.issues.search, run: () => document.querySelector('[data-issue-search]').focus() }] };
}

export async function create(context) {
  const title = field({ label: S.issues.titleField, control: textInput({ maxlength: 200, autofocus: true }) });
  const body = textArea({ rows: 10, 'aria-label': S.issues.description, placeholder: S.issues.descriptionHint });
  const note = el('div', {});
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    if (!validate([[title, title.control.value.trim() ? '' : S.issues.titleBlank]])) return;
    let id;
    if (!(await attempt(note, async () => { id = await openIssue(context.repo.name, { title: title.control.value, body: body.value, name: profile().name }); }))) return;
    const issue = (await readLog(context.repo.name)).issues.find((item) => item.id === id);
    navigate(repoPath(context.repo, 'issues', issue.number));
  } }, el('h1', { class: 'page-title' }, S.issues.new), note, title, el('div', { class: 'field' }, el('label', { for: 'issue-body' }, S.issues.description), Object.assign(body, { id: 'issue-body' })),
  el('div', { class: 'row' }, button({ label: S.issues.submit, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: repoHref(context.repo, 'issues') })));
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page form' }, form));
  title.control.focus();
  return { title: `${S.issues.new} · ${context.repo.name}`, repo: context.repo };
}

// Assignees, labels and milestone: the part of the sidebar an issue and a pull request share.
export function triage(context, state, issue, mine, change) {
  const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const milestoneTitle = (id) => (state.milestones.find((m) => m.id === id) || {}).title || '';
  return [
    section(S.issues.assignees, menu({ label: S.issues.edit, iconOnly: true, icon: 'gear', kind: 'invisible', size: 'small', align: 'end', items: [{ label: issue.assignees.includes(mine) ? S.issues.unassignMe : S.issues.assignMe, icon: 'person', onclick: change('assignees', toggle(issue.assignees, mine)) }] }),
      issue.assignees.length ? issue.assignees.map((key) => el('span', { class: 'row' }, avatar(key.slice(0, 7)), key === mine ? S.common.you : key.slice(0, 7))) : el('span', { class: 'muted' }, S.issues.noOne)),
    section(S.issues.labels, menu({ label: S.issues.edit, iconOnly: true, icon: 'gear', kind: 'invisible', size: 'small', align: 'end', attrs: { 'data-pick': 'labels' }, items: state.labels.size ? [...state.labels.keys()].map((label) => ({ label, icon: issue.labels.includes(label) ? 'check' : 'dot-fill', onclick: change('labels', toggle(issue.labels, label)) })) : [{ heading: S.issues.noLabelsYet }, { label: S.issues.editLabels, href: repoHref(context.repo, 'labels') }] }),
      issue.labels.length ? issue.labels.map((label) => issueLabel(label, (state.labels.get(label) || {}).color || '')) : el('span', { class: 'muted' }, S.issues.noneYet)),
    section(S.issues.milestone, menu({ label: S.issues.edit, iconOnly: true, icon: 'gear', kind: 'invisible', size: 'small', align: 'end', attrs: { 'data-pick': 'milestone' }, items: [...state.milestones.filter((m) => m.state === 'open' || m.id === issue.milestone).map((m) => ({ label: m.title, icon: m.id === issue.milestone ? 'check' : 'milestone', onclick: change('milestone', m.id === issue.milestone ? '' : m.id) })),
      ...(state.milestones.length ? [] : [{ heading: S.issues.noMilestonesYet }, { label: S.issues.newMilestone, href: repoHref(context.repo, 'milestones', 'new') }])] }),
      issue.milestone ? el('a', { href: repoHref(context.repo, 'milestone', issue.milestone) }, icon('milestone'), ' ', milestoneTitle(issue.milestone)) : el('span', { class: 'muted' }, S.issues.noMilestone))];
}

// A sidebar section: a heading with a menu that changes the value, and the value below it.
function section(title, picker, value) {
  return el('div', { class: 'side-section' }, el('div', { class: 'row' }, el('h2', {}, title), el('span', { class: 'spacer' }), picker), el('div', { class: 'row' }, value));
}

export async function view(context, number) {
  const state = await readLog(context.repo.name);
  const issue = state.issues.find((item) => String(item.number) === String(number));
  if (!issue) {
    const pull = state.pulls.find((item) => String(item.number) === String(number));
    if (pull) { navigate(repoPath(context.repo, 'pull', pull.number), { replace: true }); return {}; }
    show('wide', repoHeader(context, 'issues'), el('div', { class: 'page' }, blankslate({ icon: 'issue-opened', title: S.issues.notFound, action: button({ label: S.issues.backToList, href: repoHref(context.repo, 'issues') }) })));
    return { title: S.notFound.title, repo: context.repo };
  }
  const repo = context.repo.name;
  const name = profile().name;
  const mine = await me();
  const note = el('div', {});
  const change = (field, value) => async () => { if (await attempt(note, () => setIssue(repo, issue.id, field, value, name))) refresh(); };

  // Title, with editing in place.
  const heading = el('div', { class: 'issue-title' });
  const drawTitle = (editing) => {
    if (!editing) { heading.replaceChildren(el('h1', {}, issue.title, ' ', el('span', { class: 'muted' }, `#${issue.number}`)), button({ label: S.issues.edit, size: 'small', onclick: () => drawTitle(true) }), button({ label: S.issues.new, size: 'small', kind: 'primary', href: repoHref(context.repo, 'issues', 'new') })); return; }
    const input = textInput({ value: issue.title, maxlength: 200, 'aria-label': S.issues.titleField });
    heading.replaceChildren(el('form', { class: 'row main', onsubmit: async (event) => { event.preventDefault(); const next = input.value.trim(); if (!next || next === issue.title) { drawTitle(false); return; } await change('title', next)(); } },
      el('div', { class: 'main' }, input), button({ label: S.common.save, type: 'submit', kind: 'primary' }), button({ label: S.common.cancel, onclick: () => drawTitle(false) })));
    input.focus();
  };
  drawTitle(false);

  // The first post, editable by whoever may.
  const first = el('div', {});
  const drawBody = (editing) => {
    if (!editing) {
      const node = comment({ author: who(issue.name, issue.author), when: relativeTime(issue.time), badge: issue.author === state.owner ? S.common.owner : '', body: issue.body.trim() ? markdown(context, issue.body) : el('p', { class: 'muted' }, S.issues.noDescription) });
      node.querySelector('.box-head').append(button({ label: S.issues.editBody, icon: 'pencil', iconOnly: true, kind: 'invisible', size: 'small', onclick: () => drawBody(true) }));
      first.replaceChildren(node); return;
    }
    const area = textArea({ rows: 8, 'aria-label': S.issues.description });
    area.value = issue.body;
    first.replaceChildren(el('form', { class: 'box stack box-body', onsubmit: async (event) => { event.preventDefault(); await change('body', area.value)(); } }, area, el('div', { class: 'row' }, button({ label: S.issues.updateComment, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, onclick: () => drawBody(false) }))));
    area.focus();
  };
  drawBody(false);

  const milestoneTitle = (id) => (state.milestones.find((m) => m.id === id) || {}).title || '';
  const events = issue.events.map((event) => {
    const actor = el('strong', {}, who(event.name, event.key));
    const when = relativeTime(event.time);
    if (event.kind === 'comment') return comment({ author: who(event.name, event.key), when, badge: event.key === state.owner ? S.common.owner : '', body: markdown(context, event.body) });
    if (event.kind === 'state') return timelineItem({ icon: event.to === 'closed' ? 'issue-closed' : 'issue-reopened', tone: event.to === 'closed' ? 'merged' : 'open', content: [actor, ' ', event.to === 'closed' ? S.issues.closedThis : S.issues.reopenedThis, ' ', when] });
    if (event.kind === 'title') return timelineItem({ icon: 'pencil', content: [actor, ' ', S.issues.changedTitle, ' ', el('del', {}, event.from), ' ', el('strong', {}, event.to), ' ', when] });
    if (event.kind === 'labels') return timelineItem({ icon: 'tag', content: [actor, ' ', event.added.length ? [S.issues.added, ' ', event.added.map((n) => [issueLabel(n, (state.labels.get(n) || {}).color || ''), ' '])] : '', event.removed.length ? [S.issues.removed, ' ', event.removed.map((n) => [issueLabel(n, (state.labels.get(n) || {}).color || ''), ' '])] : '', when] });
    if (event.kind === 'milestone') return timelineItem({ icon: 'milestone', content: [actor, ' ', event.to ? S.issues.addedToMilestone(milestoneTitle(event.to)) : S.issues.removedFromMilestone(milestoneTitle(event.from)), ' ', when] });
    return timelineItem({ icon: 'person', content: [actor, ' ', event.added.length ? S.issues.assigned(event.added.map((k) => (k === mine ? S.common.you : k.slice(0, 7))).join(', ')) : S.issues.unassigned(event.removed.map((k) => (k === mine ? S.common.you : k.slice(0, 7))).join(', ')), ' ', when] });
  });

  const composer = commentBox({ render: (text) => (text.trim() ? markdown(context, text) : el('p', { class: 'muted' }, S.parts.nothingToPreview)), onsubmit: async (text) => { if (await attempt(note, () => addComment(repo, issue.id, { body: text, name }))) refresh(); } });
  composer.querySelector('.foot').prepend(issue.state === 'open' ? button({ label: S.issues.close, icon: 'issue-closed', onclick: change('state', 'closed'), attrs: { 'data-close': '' } }) : button({ label: S.issues.reopen, icon: 'issue-reopened', onclick: change('state', 'open'), attrs: { 'data-reopen': '' } }));

  const side = el('aside', { class: 'stack side' }, triage(context, state, issue, mine, change));

  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page stack' }, heading,
    el('div', { class: 'row issue-meta' }, stateBadge(issue.state === 'open' ? 'open' : 'closed'), el('span', { class: 'muted' }, el('strong', {}, who(issue.name, issue.author)), ' ', S.issues.openedThis, ' ', relativeTime(issue.time), ' · ', S.issues.commentCount(issue.comments))),
    note, el('div', { class: 'columns' }, el('div', { class: 'stack' }, first, events.length ? timeline(events) : '', composer), side)));
  return { title: `${issue.title} · #${issue.number} · ${context.repo.name}`, repo: context.repo };
}

const randomColor = () => ['d73a4a', '0075ca', 'a2eeef', '7057ff', '008672', 'e4e669', 'd876e3', 'f9d0c4'][Math.floor(Math.random() * 8)];
export async function labels(context) {
  const state = await readLog(context.repo.name);
  const repo = context.repo.name;
  const note = el('div', {});
  const editor = el('div', {});
  const openCount = (name) => state.issues.filter((issue) => issue.state === 'open' && issue.labels.includes(name)).length;
  const edit = (known) => {
    const name = field({ label: S.issues.labelName, control: textInput({ value: known ? known.name : '', maxlength: 50, readonly: Boolean(known) }) });
    const description = field({ label: S.newRepo.description, optional: S.newRepo.optional, control: textInput({ value: known ? known.description : '', maxlength: 200 }) });
    const color = field({ label: S.issues.color, hint: S.issues.colorHint, control: textInput({ value: `#${known ? known.color : randomColor()}`, maxlength: 7 }) });
    const preview = el('span', {});
    const draw = () => preview.replaceChildren(issueLabel(name.control.value.trim() || S.issues.labelPreview, color.control.value));
    name.control.addEventListener('input', draw); color.control.addEventListener('input', draw); draw();
    editor.replaceChildren(el('form', { class: 'box box-body stack', novalidate: true, onsubmit: async (event) => {
      event.preventDefault();
      const value = name.control.value.trim();
      if (!validate([[name, !value ? S.issues.labelNameBlank : /,/.test(value) ? S.issues.labelNameComma : !known && state.labels.has(value) ? S.issues.labelTaken : ''], [color, /^#?[0-9a-fA-F]{6}$/.test(color.control.value.trim()) ? '' : S.issues.colorInvalid]])) return;
      if (await attempt(note, () => saveLabel(repo, { name: value, color: color.control.value.trim(), description: description.control.value }))) refresh();
    } }, preview, el('div', { class: 'label-form' }, name, description, color), el('div', { class: 'row' }, button({ label: known ? S.common.save : S.issues.createLabel, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, onclick: () => editor.replaceChildren() }))));
    (known ? description : name).control.focus();
  };
  const rows = [...state.labels].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, data]) => el('div', { class: 'box-row label-row' }, el('div', { class: 'label-cell' }, issueLabel(name, data.color)), el('div', { class: 'main muted' }, data.description),
    el('a', { class: 'muted', href: `${repoHref(context.repo, 'issues')}?q=${encodeURIComponent(`is:open label:${quote(name)}`)}` }, icon('issue-opened'), ' ', S.issues.openCount(openCount(name))),
    el('div', { class: 'aside' }, button({ label: S.issues.edit, size: 'small', kind: 'invisible', onclick: () => edit({ name, ...data }) }), button({ label: S.issues.delete, size: 'small', kind: 'invisible', onclick: async () => { if (await attempt(note, () => removeLabel(repo, name))) refresh(); }, attrs: { 'data-delete': name } }))));
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page stack' }, el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.issues.labels), el('span', { class: 'spacer' }), button({ label: S.issues.newLabel, kind: 'primary', onclick: () => edit(null) })),
    note, editor, box({ head: el('strong', {}, S.issues.labelCount(state.labels.size)), rows: rows.length ? rows : blankslate({ icon: 'tag', title: S.issues.noLabelsYet, action: button({ label: S.issues.newLabel, kind: 'primary', onclick: () => edit(null) }) }) })));
  return { title: `${S.issues.labels} · ${context.repo.name}`, repo: context.repo };
}

const progress = (state, id) => { const all = state.issues.filter((issue) => issue.milestone === id); const closed = all.filter((issue) => issue.state === 'closed').length; return { open: all.length - closed, closed, share: all.length ? closed / all.length : 0 }; };
function progressBar(share) {
  const fill = el('i', {});
  fill.style.setProperty('width', `${Math.round(share * 100)}%`);
  return el('div', { class: 'progress', role: 'img', 'aria-label': S.issues.complete(Math.round(share * 100)) }, fill);
}
const due = (m) => (m.due ? S.issues.dueBy(new Date(`${m.due}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })) : S.issues.noDue);

export async function milestones(context) {
  const state = await readLog(context.repo.name);
  const repo = context.repo.name;
  const wanted = new URLSearchParams(location.search).get('state') === 'closed' ? 'closed' : 'open';
  const note = el('div', {});
  const rows = state.milestones.filter((m) => m.state === wanted).map((m) => {
    const p = progress(state, m.id);
    return el('div', { class: 'box-row milestone-row' }, el('div', { class: 'main' }, el('a', { class: 'title', href: repoHref(context.repo, 'milestone', m.id) }, m.title), el('div', { class: 'meta' }, icon('clock'), ' ', due(m)), m.description && el('p', { class: 'muted' }, m.description)),
      el('div', { class: 'milestone-progress' }, progressBar(p.share), el('div', { class: 'meta' }, S.issues.progress(Math.round(p.share * 100), p.open, p.closed)),
        el('div', { class: 'row' }, button({ label: S.issues.edit, size: 'small', kind: 'invisible', href: repoHref(context.repo, 'milestones', m.id, 'edit') }),
          button({ label: m.state === 'open' ? S.issues.closeMilestone : S.issues.reopenMilestone, size: 'small', kind: 'invisible', onclick: async () => { if (await attempt(note, () => saveMilestone(repo, { ...m, state: m.state === 'open' ? 'closed' : 'open' }))) refresh(); }, attrs: { 'data-toggle': m.title } }))));
  });
  const count = (is) => state.milestones.filter((m) => m.state === is).length;
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page stack' }, el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.issues.milestones), el('span', { class: 'spacer' }), button({ label: S.issues.newMilestone, kind: 'primary', href: repoHref(context.repo, 'milestones', 'new') })), note,
    box({ head: [el('a', { class: wanted === 'open' ? 'tab-on' : 'muted', href: repoHref(context.repo, 'milestones') }, icon('milestone'), ' ', S.issues.openCount(count('open'))), el('a', { class: wanted === 'closed' ? 'tab-on' : 'muted', href: `${repoHref(context.repo, 'milestones')}?state=closed` }, icon('check'), ' ', S.issues.closedCount(count('closed')))],
      rows: rows.length ? rows : blankslate({ icon: 'milestone', title: wanted === 'open' ? S.issues.noMilestonesYet : S.issues.noClosedMilestones, action: wanted === 'open' ? button({ label: S.issues.newMilestone, kind: 'primary', href: repoHref(context.repo, 'milestones', 'new') }) : '' }) })));
  return { title: `${S.issues.milestones} · ${context.repo.name}`, repo: context.repo };
}

export async function milestoneForm(context, id) {
  const state = await readLog(context.repo.name);
  const known = id ? state.milestones.find((m) => m.id === id) : null;
  if (id && !known) return milestoneMissing(context);
  const title = field({ label: S.issues.titleField, control: textInput({ value: known ? known.title : '', maxlength: 100, autofocus: true }) });
  const date = field({ label: S.issues.dueDate, optional: S.newRepo.optional, control: textInput({ type: 'date', value: known ? known.due : '' }) });
  const description = field({ label: S.newRepo.description, optional: S.newRepo.optional, control: textArea({ rows: 4 }) });
  description.control.value = known ? known.description : '';
  const note = el('div', {});
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page form' }, el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    if (!validate([[title, title.control.value.trim() ? '' : S.issues.titleBlank]])) return;
    if (await attempt(note, () => saveMilestone(context.repo.name, { id: known ? known.id : undefined, title: title.control.value, description: description.control.value, due: date.control.value, state: known ? known.state : 'open' }))) navigate(repoPath(context.repo, 'milestones'));
  } }, el('h1', { class: 'page-title' }, known ? S.issues.editMilestone : S.issues.newMilestone), note, title, date, description,
  el('div', { class: 'row' }, button({ label: known ? S.common.save : S.issues.createMilestone, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: repoHref(context.repo, 'milestones') })))));
  title.control.focus();
  return { title: `${known ? S.issues.editMilestone : S.issues.newMilestone} · ${context.repo.name}`, repo: context.repo };
}
function milestoneMissing(context) {
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page' }, blankslate({ icon: 'milestone', title: S.issues.milestoneNotFound, action: button({ label: S.issues.milestones, href: repoHref(context.repo, 'milestones') }) })));
  return { title: S.notFound.title, repo: context.repo };
}

export async function milestone(context, id) {
  const state = await readLog(context.repo.name);
  const m = state.milestones.find((item) => item.id === id);
  if (!m) return milestoneMissing(context);
  const wanted = new URLSearchParams(location.search).get('state') === 'closed' ? 'closed' : 'open';
  const p = progress(state, m.id);
  const rows = state.issues.filter((issue) => issue.milestone === m.id && issue.state === wanted).map((issue) => issueRow(context.repo, state, issue));
  show('wide', repoHeader(context, 'issues'), el('div', { class: 'page stack' }, el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, m.title), m.state === 'closed' ? plainLabel(S.common.closed) : '', el('span', { class: 'spacer' }), button({ label: S.issues.edit, href: repoHref(context.repo, 'milestones', m.id, 'edit') })),
    el('div', { class: 'stack condensed' }, progressBar(p.share), el('div', { class: 'muted' }, icon('clock'), ' ', due(m), ' · ', S.issues.progress(Math.round(p.share * 100), p.open, p.closed)), m.description && el('p', {}, m.description)),
    box({ head: [el('a', { class: wanted === 'open' ? 'tab-on' : 'muted', href: repoHref(context.repo, 'milestone', m.id) }, icon('issue-opened'), ' ', S.issues.openCount(p.open)), el('a', { class: wanted === 'closed' ? 'tab-on' : 'muted', href: `${repoHref(context.repo, 'milestone', m.id)}?state=closed` }, icon('check'), ' ', S.issues.closedCount(p.closed))],
      rows: rows.length ? rows : blankslate({ icon: 'issue-opened', title: S.issues.noneInMilestone }) })));
  return { title: `${m.title} · ${S.issues.milestones} · ${context.repo.name}`, repo: context.repo };
}

// Issues across every repository this browser holds.
export async function everywhere({ query }) {
  const mine = await me();
  const scope = ['created', 'assigned', 'all'].includes(query.get('scope')) ? query.get('scope') : 'created';
  const wanted = query.get('state') === 'closed' ? 'closed' : 'open';
  const found = [];
  for (const repo of await listRepos()) {
    let state;
    try { state = await readLog(repo.name); } catch { continue; }
    for (const issue of state.issues) if (scope === 'all' || (scope === 'created' && issue.author === mine) || (scope === 'assigned' && issue.assignees.includes(mine))) found.push({ repo, state, issue });
  }
  const shown = found.filter((item) => item.issue.state === wanted).sort((a, b) => b.issue.time - a.issue.time);
  const to = (s, st) => `${href('/issues')}?scope=${s}${st === 'closed' ? '&state=closed' : ''}`;
  const count = (is) => found.filter((item) => item.issue.state === is).length;
  const node = document.getElementById('main');
  node.className = 'page';
  node.replaceChildren(el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.issues.title)), el('div', { class: 'settings' },
    el('nav', { class: 'sidenav', 'aria-label': S.issues.title }, ['created', 'assigned', 'all'].map((key) => el('a', { href: to(key, wanted), 'aria-current': key === scope ? 'page' : undefined }, S.issues.scopes[key]))),
    box({ head: [el('a', { class: wanted === 'open' ? 'tab-on' : 'muted', href: to(scope, 'open') }, icon('issue-opened'), ' ', S.issues.openCount(count('open'))), el('a', { class: wanted === 'closed' ? 'tab-on' : 'muted', href: to(scope, 'closed') }, icon('check'), ' ', S.issues.closedCount(count('closed')))],
      rows: shown.length ? shown.map((item) => issueRow(item.repo, item.state, item.issue, { showRepo: true })) : blankslate({ icon: 'issue-opened', title: S.issues.noneHere }) })));
  return { title: S.issues.title };
}
void counter;
