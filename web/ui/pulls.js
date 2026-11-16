// Pull requests: the list, opening one from a comparison, and one pull request's four tabs
// (Conversation with the merge box, Commits, Checks, Files changed with comments on lines).
//
// The page asks and shows. Whether a merge counts is decided when it is signed onto the log; the merge
// box shows the facts that decision rests on, and a refusal is explained from those facts.

import { S } from './strings.js';
import { el, icon, button, menu, box, boxRow, blankslate, flash, field, textInput, textArea, validate, stateBadge, avatar, relativeTime, commentBox, comment, timeline, timelineItem, tabs, dialog, label, issueLabel } from './components.js';
import { href, navigate, refresh } from './router.js';
import { profile } from './session.js';
import { repoHeader, repoHref, repoPath, show, short, ownerOf } from './repo.js';
import { renderMarkdown } from './markdown.js';
import { changes } from './history.js';
import { readLog, triage, parseQuery } from './issues.js';
import { markRead } from './home.js';
import { listRepos, getRefs } from '../store.js';
import { deviceKey, openPull, addComment, setIssue, review, commentOnLine, resolveThread } from '../identity.js';
import { resolveCommit, history as walk, person, mergePull } from '../git.js';
import { isAncestor } from '../ancestry.js';
import { updatePull, mergeBase } from '../sync.js';
import { expectedActions } from '../evidence.js';

const who = (name, key) => name || key.slice(0, 7);
const subject = (message) => message.split('\n')[0];
const branchOf = (pull) => pull.ref.slice('refs/heads/'.length);
const status = (pull) => (pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open');
const markdown = (context, text) => renderMarkdown(text, { reference: (n) => repoHref(context.repo, 'issues', n) });
const refusal = (error) => (/does not count/.test(error.message) ? S.issues.noPermission : /malformed|needs/.test(error.message) ? S.issues.invalid : S.issues.failed);
async function attempt(note, run, explain = refusal) {
  try { await run(); return true; } catch (error) { note.replaceChildren(flash('error', explain(error))); note.scrollIntoView({ block: 'nearest' }); return false; }
}
function reviewSummary(pull) {
  if (pull.merged) return '';
  if (pull.changes.size) return el('span', { class: 'fg-danger' }, S.pulls.changesRequested);
  if (pull.needed && pull.counted >= pull.needed) return el('span', { class: 'fg-success' }, S.pulls.approved);
  if (pull.needed) return el('span', {}, S.pulls.reviewRequired);
  return pull.counted ? el('span', { class: 'fg-success' }, S.pulls.approved) : '';
}
function pullRow(repo, state, pull, { showRepo } = {}) {
  const [name, text] = { open: ['git-pull-request', S.common.opened], merged: ['git-merge', S.common.merged], closed: ['git-pull-request-closed', S.common.closed] }[status(pull)];
  return boxRow({ lead: icon(name, { label: text, class: `fg-${status(pull)}` }), title: pull.title, href: repoHref(repo, 'pull', pull.number),
    meta: [showRepo && el('span', {}, `${ownerOf(repo)}/${repo.name} `), `#${pull.number} `, S.issues.openedBy(who(pull.name, pull.author)), ' ', relativeTime(pull.time), ' · ', reviewSummary(pull),
      pull.labels.length ? [' ', pull.labels.map((n) => [issueLabel(n, (state.labels.get(n) || {}).color || ''), ' '])] : ''],
    aside: pull.comments ? el('span', { class: 'row' }, icon('comment'), pull.comments) : '' });
}

export async function list(context) {
  const state = await readLog(context.repo.name);
  const text = new URLSearchParams(location.search).get('q') ?? 'is:open';
  const query = parseQuery(text);
  const base = repoPath(context.repo, 'pulls');
  const to = (next) => `${href(base)}?q=${encodeURIComponent(next)}`;
  const pool = state.pulls.filter((pull) => query.words.every((word) => `${pull.title}\n${pull.body}`.toLowerCase().includes(word)) && query.labels.every((n) => pull.labels.includes(n)));
  const open = pool.filter((pull) => status(pull) === 'open');
  const closed = pool.filter((pull) => status(pull) !== 'open');
  const shown = (query.is === 'closed' ? closed : open).slice().sort((a, b) => b.time - a.time);
  const search = el('form', { class: 'main', role: 'search', onsubmit: (event) => { event.preventDefault(); navigate(`${base}?q=${encodeURIComponent(event.currentTarget.elements.q.value.trim())}`); } },
    textInput({ type: 'search', name: 'q', value: text, 'aria-label': S.pulls.search, placeholder: S.pulls.search }));
  const empty = !state.pulls.length ? blankslate({ icon: 'git-pull-request', title: S.pulls.none, action: button({ label: S.pulls.new, kind: 'primary', href: repoHref(context.repo, 'branches') }) }) : blankslate({ icon: 'search', title: S.pulls.noMatch, action: button({ label: S.issues.clear, href: href(base) }) });
  show('wide', repoHeader(context, 'pulls'), el('div', { class: 'page stack' }, el('div', { class: 'row' }, search, button({ label: S.pulls.new, kind: 'primary', href: repoHref(context.repo, 'branches') })),
    box({ head: [el('a', { class: query.is === 'open' ? 'tab-on' : 'muted', href: to('is:open'), 'data-count': 'open' }, icon('git-pull-request'), ' ', S.issues.openCount(open.length)), el('a', { class: query.is === 'closed' ? 'tab-on' : 'muted', href: to('is:closed'), 'data-count': 'closed' }, icon('check'), ' ', S.issues.closedCount(closed.length))],
      rows: shown.length ? shown.map((pull) => pullRow(context.repo, state, pull)) : empty })));
  return { title: `${S.repo.pulls} · ${context.repo.name}`, repo: context.repo };
}

// The form under a comparison: propose the compared commit for the base branch.
export function proposeForm(context, baseBranch, headId, headSubject) {
  const title = field({ label: S.issues.titleField, control: textInput({ value: headSubject, maxlength: 200 }) });
  const body = textArea({ rows: 5, 'aria-label': S.issues.description, placeholder: S.pulls.describe });
  const note = el('div', {});
  return el('form', { class: 'box box-body stack', novalidate: true, 'data-propose': '', onsubmit: async (event) => {
    event.preventDefault();
    if (!validate([[title, title.control.value.trim() ? '' : S.issues.titleBlank]])) return;
    if (!(await attempt(note, () => openPull(context.repo.name, baseBranch, headId, title.control.value, { body: body.value, name: profile().name })))) return;
    const pull = (await readLog(context.repo.name)).pulls.find((item) => item.head === headId && item.ref === `refs/heads/${baseBranch}`);
    navigate(repoPath(context.repo, 'pull', pull.number));
  } }, el('h2', { class: 'page-title' }, S.pulls.open), note, title, body, el('div', {}, button({ label: S.pulls.create, kind: 'primary', type: 'submit' })));
}

// What a pull request changes: from where it left its branch to the commit proposed.
async function span(context, pull) {
  const baseHead = context.refs[pull.ref];
  const head = (await resolveCommit(context.refs, pull.head)).commit;
  // Once merged, the branch contains the commit, so the change is read from where the branch stood just before
  // the merge. Failing that, from the parent of the first commit proposed.
  let forkId = await mergeBase(pull.head, pull.merged ? pull.mergedOnto : baseHead).catch(() => null);
  if (!forkId || forkId === pull.head) forkId = (await resolveCommit(context.refs, pull.first)).commit.parents[0] || null;
  const forkTree = forkId ? (await resolveCommit(context.refs, forkId)).commit.tree : null;
  const commits = [];
  for (const item of await walk(pull.head, 250)) { if (item.id === forkId || (forkId && await isAncestor(item.id, forkId) === true)) continue; commits.push(item); }
  const upToDate = pull.merged || (await isAncestor(baseHead, pull.head)) === true;
  return { baseHead, head, forkId, forkTree, commits, upToDate };
}

// Required checks for exactly this content, each with the result that exists for it.
async function requiredChecks(context, state, pull, baseHead) {
  const rule = state.protections.get(pull.ref);
  const names = rule ? rule.checks : [];
  if (!names.length) return [];
  const expected = pull.merged ? null : await expectedActions(baseHead, pull.head, names);
  return names.map((name, i) => { const key = expected && expected[i]; const result = key && state.checks.get(key); return { name, state: !expected ? 'unknown' : !key ? 'undefined' : !result ? 'waiting' : result.result === 'pass' ? 'passed' : 'failed', result }; });
}
const CHECK = { passed: ['check', 'fg-success'], failed: ['x', 'fg-danger'], waiting: ['dot-fill', 'fg-attention'], undefined: ['alert', 'fg-danger'], unknown: ['dot-fill', 'fg-muted'] };
const checkRow = (check) => el('div', { class: 'box-row check-row', 'data-check': check.name }, icon(CHECK[check.state][0], { class: CHECK[check.state][1] }), el('strong', {}, check.name), el('span', { class: 'main muted' }, S.pulls.checkStates[check.state]),
  check.result ? el('span', { class: 'muted small' }, relativeTime(check.result.time)) : '');

async function frame(context, number, tab) {
  const state = await readLog(context.repo.name);
  const pull = state.pulls.find((item) => String(item.number) === String(number));
  if (!pull) {
    const issue = state.issues.find((item) => String(item.number) === String(number));
    if (issue) { navigate(repoPath(context.repo, 'issues', issue.number), { replace: true }); return null; }
    show('wide', repoHeader(context, 'pulls'), el('div', { class: 'page' }, blankslate({ icon: 'git-pull-request', title: S.pulls.notFound, action: button({ label: S.pulls.backToList, href: repoHref(context.repo, 'pulls') }) })));
    return null;
  }
  const data = await span(context, pull);
  const checks = await requiredChecks(context, state, pull, data.baseHead);
  const at = (part) => repoHref(context.repo, 'pull', pull.number, part);
  const head = [el('div', { class: 'issue-title' }, el('h1', {}, pull.title, ' ', el('span', { class: 'muted' }, `#${pull.number}`))),
    el('div', { class: 'row issue-meta' }, stateBadge(status(pull), 'pull'), el('span', { class: 'muted' }, el('strong', {}, who(pull.name, pull.author)), ' ', pull.merged ? S.pulls.mergedInto(data.commits.length) : S.pulls.wantsToMerge(data.commits.length), ' ', label(branchOf(pull)), ' ', S.pulls.from, ' ', el('span', { class: 'mono' }, short(pull.head)))),
    tabs([{ label: S.pulls.conversation, icon: 'comment', href: at(), current: tab === 'conversation', count: pull.comments || undefined }, { label: S.repo.commits, icon: 'git-commit', href: at('commits'), current: tab === 'commits', count: data.commits.length },
      { label: S.pulls.checks, icon: 'check-circle', href: at('checks'), current: tab === 'checks', count: checks.length || undefined }, { label: S.pulls.files, icon: 'diff-modified', href: at('files'), current: tab === 'files' }], { label: S.pulls.tabs, flush: true })];
  return { state, pull, data, checks, head, mine: (await deviceKey()).id };
}
const draw = (context, head, ...body) => show('wide', repoHeader(context, 'pulls'), el('div', { class: 'page stack' }, head, body));
const titled = (context, pull) => ({ title: `${pull.title} · #${pull.number} · ${context.repo.name}`, repo: context.repo });

function threadBox(context, pull, thread, { onChange, compact }) {
  const note = el('div', {});
  const name = profile().name;
  const reply = textInput({ placeholder: S.pulls.reply, 'aria-label': S.pulls.reply });
  const entry = (item) => el('div', { class: 'thread-entry' }, el('div', { class: 'row' }, avatar(who(item.name, item.key)), el('strong', {}, who(item.name, item.key)), el('span', { class: 'muted small' }, relativeTime(item.time))), markdown(context, item.body));
  return el('div', { class: `box thread${thread.resolved ? ' resolved' : ''}`, 'data-thread': thread.id },
    compact ? '' : el('div', { class: 'box-head' }, el('a', { class: 'mono', href: repoHref(context.repo, 'pull', pull.number, 'files') }, `${thread.path}:${thread.line}`), thread.head !== pull.head ? label(S.pulls.outdated, 'attention') : '', el('span', { class: 'spacer' }), thread.resolved ? label(S.pulls.resolved, 'success') : ''),
    el('div', { class: 'box-body stack condensed' }, note, entry(thread), thread.replies.map(entry),
      el('form', { class: 'row', onsubmit: async (event) => { event.preventDefault(); if (!reply.value.trim()) { reply.focus(); return; } if (await attempt(note, () => commentOnLine(context.repo.name, pull.id, { reply: thread.id, body: reply.value, name }))) onChange(); } },
        el('div', { class: 'main' }, reply), button({ label: S.pulls.replyAction, type: 'submit', size: 'small' }),
        button({ label: thread.resolved ? S.pulls.unresolve : S.pulls.resolve, size: 'small', onclick: async () => { if (await attempt(note, () => resolveThread(context.repo.name, thread.id, !thread.resolved, name))) onChange(); }, attrs: { 'data-resolve': '' } }))));
}

export async function conversation(context, number) {
  const loaded = await frame(context, number, 'conversation');
  if (!loaded) return {};
  const { state, pull, data, checks, head, mine } = loaded;
  markRead(pull.id);
  const repo = context.repo.name;
  const name = profile().name;
  const note = el('div', {});
  const change = (fieldName, value) => async () => { if (await attempt(note, () => setIssue(repo, pull.id, fieldName, value, name))) refresh(); };
  const first = comment({ author: who(pull.name, pull.author), when: relativeTime(pull.time), badge: pull.author === state.owner ? S.common.owner : '', body: pull.body.trim() ? markdown(context, pull.body) : el('p', { class: 'muted' }, S.issues.noDescription) });
  const events = pull.events.map((event) => {
    const actor = el('strong', {}, who(event.name, event.key));
    const when = relativeTime(event.time);
    if (event.kind === 'comment') return comment({ author: who(event.name, event.key), when, badge: event.key === state.owner ? S.common.owner : '', body: markdown(context, event.body) });
    if (event.kind === 'review') {
      const [glyph, tone, text] = { approve: ['check', 'open', S.pulls.approvedThese], changes: ['x', 'closed', S.pulls.requestedChanges], comment: ['eye', '', S.pulls.reviewed] }[event.verdict];
      const stale = event.head !== pull.head && event.verdict !== 'comment';
      return el('div', { class: 'stack condensed' }, timelineItem({ icon: glyph, tone, content: [actor, ' ', text, ' ', when, stale ? [' ', label(S.pulls.outdated, 'attention')] : ''] }), event.body.trim() ? el('div', { class: 'box box-body review-body' }, markdown(context, event.body)) : '');
    }
    if (event.kind === 'head') return timelineItem({ icon: 'git-commit', content: [actor, ' ', S.pulls.updatedTo, ' ', el('a', { class: 'mono', href: repoHref(context.repo, 'commit', event.to) }, short(event.to)), ' ', when] });
    if (event.kind === 'state') return timelineItem({ icon: event.to === 'closed' ? 'git-pull-request-closed' : 'git-pull-request', tone: event.to === 'closed' ? 'closed' : 'open', content: [actor, ' ', event.to === 'closed' ? S.issues.closedThis : S.issues.reopenedThis, ' ', when] });
    if (event.kind === 'title') return timelineItem({ icon: 'pencil', content: [actor, ' ', S.issues.changedTitle, ' ', el('del', {}, event.from), ' ', el('strong', {}, event.to), ' ', when] });
    return timelineItem({ icon: 'tag', content: [actor, ' ', S.pulls.changed(S.pulls.kinds[event.kind] || event.kind), ' ', when] });
  });
  const threads = pull.threads.map((thread) => threadBox(context, pull, thread, { onChange: refresh }));

  // The merge box: the facts the decision rests on, then the one action.
  const rows = [];
  const needsReview = pull.needed > 0 && pull.counted < pull.needed;
  const failing = checks.filter((check) => check.state !== 'passed');
  if (!pull.merged && pull.state === 'open') {
    if (pull.changes.size) rows.push(el('div', { class: 'box-row', 'data-fact': 'changes' }, icon('x', { class: 'fg-danger' }), el('div', { class: 'main' }, el('strong', {}, S.pulls.changesRequested), el('div', { class: 'muted small' }, S.pulls.changesRequestedBy(pull.changes.size)))));
    if (pull.needed > 0) rows.push(el('div', { class: 'box-row', 'data-fact': 'review' }, icon(needsReview ? 'x' : 'check', { class: needsReview ? 'fg-danger' : 'fg-success' }), el('div', { class: 'main' }, el('strong', {}, needsReview ? S.pulls.reviewRequired : S.pulls.changesApproved), el('div', { class: 'muted small' }, needsReview ? S.pulls.reviewNeeds(pull.needed) : S.pulls.approvals(pull.counted)))));
    if (checks.length) rows.push(el('div', { class: 'box-row', 'data-fact': 'checks' }, icon(failing.length ? 'dot-fill' : 'check', { class: failing.length ? 'fg-attention' : 'fg-success' }), el('div', { class: 'main' }, el('strong', {}, failing.length ? S.pulls.checksPending(failing.length) : S.pulls.checksPassed), el('div', { class: 'stack condensed check-list' }, checks.map(checkRow)))));
    rows.push(el('div', { class: 'box-row', 'data-fact': 'branch' }, icon(data.upToDate ? 'check' : 'alert', { class: data.upToDate ? 'fg-success' : 'fg-attention' }), el('div', { class: 'main' }, el('strong', {}, data.upToDate ? S.pulls.noConflicts : S.pulls.outOfDate), el('div', { class: 'muted small' }, data.upToDate ? S.pulls.canMerge : S.pulls.outOfDateHint)),
      data.upToDate ? '' : button({ label: S.pulls.update, onclick: async () => { if (await attempt(note, () => updatePull({ repo: context.repo, refs: context.refs, branch: branchOf(pull), head: pull.head, title: pull.title, who: profile() }), (error) => (/conflicts with/.test(error.message) ? S.pulls.conflicts(error.message.split(': ').pop()) : refusal(error)))) refresh(); }, attrs: { 'data-update': '' } })));
    rows.push(el('div', { class: 'box-row merge-action' }, button({ label: S.pulls.merge, kind: 'primary', disabled: !data.upToDate, attrs: { 'data-merge': '' }, onclick: async () => {
      // A refusal is explained from the facts shown above, in the order a person would fix them.
      const why = () => (needsReview ? S.pulls.blockedReview(pull.needed) : failing.length ? S.pulls.blockedChecks : S.issues.noPermission);
      if (await attempt(note, async () => { await mergePull({ repo: context.repo, refs: await getRefs(repo), branch: branchOf(pull), head: pull.head }); }, (error) => (/refused by the kernel/.test(error.message) ? why() : refusal(error)))) refresh();
    } }), el('span', { class: 'muted small' }, S.pulls.mergeHint(branchOf(pull)))));
  } else rows.push(el('div', { class: 'box-row' }, icon(pull.merged ? 'git-merge' : 'git-pull-request-closed', { class: pull.merged ? 'fg-merged' : 'fg-closed' }), el('div', { class: 'main' }, el('strong', {}, pull.merged ? S.pulls.mergedDone : S.pulls.closedDone))));
  const mergeBox = box({ class: `merge-box ${status(pull)}`, rows });

  const composer = commentBox({ render: (text) => (text.trim() ? markdown(context, text) : el('p', { class: 'muted' }, S.parts.nothingToPreview)), onsubmit: async (text) => { if (await attempt(note, () => addComment(repo, pull.id, { body: text, name }))) refresh(); } });
  if (!pull.merged) composer.querySelector('.foot').prepend(pull.state === 'open' ? button({ label: S.pulls.close, icon: 'git-pull-request-closed', onclick: change('state', 'closed'), attrs: { 'data-close': '' } }) : button({ label: S.pulls.reopen, onclick: change('state', 'open'), attrs: { 'data-reopen': '' } }));
  const reviewers = [...new Set([...pull.approvals, ...pull.changes])];
  const side = el('aside', { class: 'stack side' }, el('div', { class: 'side-section' }, el('h2', {}, S.pulls.reviewers), reviewers.length ? reviewers.map((key) => el('span', { class: 'row' }, icon(pull.changes.has(key) ? 'x' : 'check', { class: pull.changes.has(key) ? 'fg-danger' : 'fg-success' }), avatar(key.slice(0, 7)), key === mine ? S.common.you : (state.names.get(key) || key.slice(0, 7)))) : el('span', { class: 'muted' }, S.pulls.noReviews)),
    triage(context, state, pull, mine, change));
  draw(context, head, note, el('div', { class: 'columns' }, el('div', { class: 'stack' }, first, events.length || threads.length ? timeline(events) : '', threads, mergeBox, composer), side));
  return titled(context, pull);
}

export async function commits(context, number) {
  const loaded = await frame(context, number, 'commits');
  if (!loaded) return {};
  const { pull, data, head } = loaded;
  draw(context, head, data.commits.length ? box({ rows: data.commits.map(({ id, commit }) => { const author = person(commit.author); return boxRow({ title: subject(commit.message), href: repoHref(context.repo, 'commit', id), meta: el('span', { class: 'row' }, avatar(author.name), el('strong', {}, author.name), ' ', S.parts.committed, ' ', relativeTime(author.time)), aside: el('a', { class: 'mono', href: repoHref(context.repo, 'commit', id) }, short(id)) }); }) }) : box({ body: blankslate({ icon: 'git-commit', title: S.pulls.noCommits }) }));
  return titled(context, pull);
}

export async function checksTab(context, number) {
  const loaded = await frame(context, number, 'checks');
  if (!loaded) return {};
  const { pull, checks, head } = loaded;
  draw(context, head, checks.length ? box({ head: el('strong', {}, S.pulls.requiredChecks(branchOf(pull))), rows: checks.map(checkRow) }) : box({ body: blankslate({ icon: 'check-circle', title: pull.merged ? S.pulls.checksAfterMerge : S.pulls.noChecks(branchOf(pull)) }) }));
  return titled(context, pull);
}

const viewedKey = (pull, path) => `viewed:${pull.id}:${pull.head}:${path}`;
const stored = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const store = (key, on) => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* storage unavailable */ } };

export async function files(context, number) {
  const loaded = await frame(context, number, 'files');
  if (!loaded) return {};
  const { pull, data, head } = loaded;
  const repo = context.repo.name;
  const name = profile().name;
  const note = el('div', {});
  const live = pull.threads.filter((thread) => thread.head === pull.head);
  const sideOf = (row) => (row.op === '-' ? ['old', row.a] : row.b ? ['new', row.b] : null);
  const hooks = {
    // A "+" on each line opens a comment form under it.
    cell: (path, row, tr) => {
      const at = sideOf(row);
      if (!at || pull.merged) return null;
      return button({ label: S.pulls.commentOnLine(at[1]), icon: 'plus', iconOnly: true, size: 'small', kind: 'primary', attrs: { class: 'btn btn-primary btn-sm btn-icon line-add', 'data-line': `${path}:${at[0]}:${at[1]}` }, onclick: () => {
        if (tr.nextSibling && tr.nextSibling.classList && tr.nextSibling.classList.contains('line-form')) { tr.nextSibling.remove(); return; }
        const area = textArea({ rows: 3, placeholder: S.parts.leaveComment, 'aria-label': S.parts.leaveComment });
        const formNote = el('div', {});
        const row2 = el('tr', { class: 'line-form' }, el('td', { colspan: '4' }, el('form', { class: 'stack condensed', onsubmit: async (event) => { event.preventDefault(); if (!area.value.trim()) { area.focus(); return; } if (await attempt(formNote, () => commentOnLine(repo, pull.id, { head: pull.head, path, side: at[0], line: at[1], body: area.value, name }))) refresh(); } },
          formNote, area, el('div', { class: 'row' }, button({ label: S.pulls.addComment, kind: 'primary', type: 'submit', size: 'small' }), button({ label: S.common.cancel, size: 'small', onclick: () => row2.remove() })))));
        tr.after(row2);
        area.focus();
      } });
    },
    after: (path, row) => { const at = sideOf(row); return at ? live.filter((thread) => thread.path === path && thread.side === at[0] && thread.line === at[1]).map((thread) => el('tr', { class: 'line-thread' }, el('td', { colspan: '4' }, threadBox(context, pull, thread, { onChange: refresh, compact: true })))) : []; },
    // "Viewed" folds a file away and is remembered in this browser for this commit.
    file: (change, details) => {
      const key = viewedKey(pull, change.path);
      const tick = el('input', { type: 'checkbox', checked: stored(key), 'aria-label': S.pulls.viewedFile(change.path), onchange: () => { store(key, tick.checked); details.open = !tick.checked; }, onclick: (event) => event.stopPropagation() });
      details.querySelector('summary').append(el('label', { class: 'viewed row', onclick: (event) => event.stopPropagation() }, tick, S.pulls.viewed));
      if (tick.checked) details.open = false;
    },
  };
  const submit = () => {
    const area = textArea({ rows: 4, placeholder: S.pulls.reviewSummary, 'aria-label': S.pulls.reviewSummary });
    const choice = (value, text, hint, checked) => el('div', { class: 'choice' }, el('input', { type: 'radio', name: 'verdict', id: `verdict-${value}`, value, checked }), el('div', {}, el('label', { for: `verdict-${value}` }, el('strong', {}, text)), el('div', { class: 'muted small' }, hint)));
    const formNote = el('div', {});
    const form = el('form', { class: 'stack', onsubmit: async (event) => { event.preventDefault(); const verdict = form.elements.verdict.value; if (await attempt(formNote, () => review(repo, pull.id, pull.head, verdict, { body: area.value, name }))) { node.close(); navigate(repoPath(context.repo, 'pull', pull.number)); } } },
      formNote, area, choice('comment', S.parts.comment, S.pulls.verdictComment, true), choice('approve', S.pulls.approve, S.pulls.verdictApprove), choice('changes', S.pulls.requestChanges, S.pulls.verdictChanges),
      el('div', { class: 'row' }, button({ label: S.pulls.submitReview, kind: 'primary', type: 'submit' })));
    const node = dialog({ title: S.pulls.finishReview, body: form });
    node.showModal();
    area.focus();
  };
  const diff = await changes(context, data.forkTree, data.head.tree, pull.head, hooks);
  draw(context, head, note, pull.merged ? '' : el('div', { class: 'row' }, el('span', { class: 'spacer' }), button({ label: S.pulls.reviewChanges, kind: 'primary', icon: 'eye', onclick: submit, attrs: { 'data-review': '' } })), diff);
  return titled(context, pull);
}

// Pull requests across every repository this browser holds.
export async function everywhere({ query }) {
  const mine = (await deviceKey()).id;
  const scope = query.get('scope') === 'all' ? 'all' : 'created';
  const wanted = query.get('state') === 'closed' ? 'closed' : 'open';
  const found = [];
  for (const repo of await listRepos()) { let state; try { state = await readLog(repo.name); } catch { continue; } for (const pull of state.pulls) if (scope === 'all' || pull.author === mine) found.push({ repo, state, pull }); }
  const is = (item) => (status(item.pull) === 'open' ? 'open' : 'closed');
  const shown = found.filter((item) => is(item) === wanted).sort((a, b) => b.pull.time - a.pull.time);
  const to = (s, st) => `${href('/pulls')}?scope=${s}${st === 'closed' ? '&state=closed' : ''}`;
  const node = document.getElementById('main');
  node.className = 'page';
  node.replaceChildren(el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.repo.pulls)), el('div', { class: 'settings' },
    el('nav', { class: 'sidenav', 'aria-label': S.repo.pulls }, ['created', 'all'].map((key) => el('a', { href: to(key, wanted), 'aria-current': key === scope ? 'page' : undefined }, S.issues.scopes[key]))),
    box({ head: [el('a', { class: wanted === 'open' ? 'tab-on' : 'muted', href: to(scope, 'open') }, icon('git-pull-request'), ' ', S.issues.openCount(found.filter((i) => is(i) === 'open').length)), el('a', { class: wanted === 'closed' ? 'tab-on' : 'muted', href: to(scope, 'closed') }, icon('check'), ' ', S.issues.closedCount(found.filter((i) => is(i) === 'closed').length))],
      rows: shown.length ? shown.map((item) => pullRow(item.repo, item.state, item.pull, { showRepo: true })) : blankslate({ icon: 'git-pull-request', title: S.pulls.noneHere }) })));
  return { title: S.repo.pulls };
}
void menu;
