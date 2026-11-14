// Around the code: the commit list, one commit with its diff, compare, branches, tags, and search.

import { S } from './strings.js';
import { el, icon, button, box, boxRow, blankslate, avatar, relativeTime, segmented, diffstat, label, textInput, flash } from './components.js';
import { navigate } from './router.js';
import { repoHeader, refSwitcher, repoHref, repoPath, show, short, decode, isBinary } from './repo.js';
import { commitAt, missing } from './code.js';
import { proposeForm } from './pulls.js';
import { getObject } from '../store.js';
import { open, diffLines, splitLines } from '../engine.js';
import { resolveCommit, readTree, lookup, history as walk, changedPaths, person, fileVersions } from '../git.js';

const subject = (message) => message.split('\n')[0];
const PAGE = 30;
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const saved = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } };

function commitItem(context, id, commit) {
  const author = person(commit.author);
  const copy = button({ label: S.code.copySha, icon: 'copy', iconOnly: true, kind: 'invisible', size: 'small', onclick: () => navigator.clipboard.writeText(id) });
  return boxRow({ title: subject(commit.message), href: repoHref(context.repo, 'commit', id), meta: el('span', { class: 'row' }, avatar(author.name), el('strong', {}, author.name), ' ', S.parts.committed, ' ', relativeTime(author.time)),
    aside: [el('a', { class: 'mono', href: repoHref(context.repo, 'commit', id) }, short(id)), copy, button({ label: S.code.browseAt, icon: 'code', iconOnly: true, kind: 'invisible', size: 'small', href: repoHref(context.repo, 'tree', id) })] });
}

export async function commits(context, at) {
  const resolved = await commitAt(context, at);
  if (!resolved) return {};
  const from = Math.max(0, Number(new URLSearchParams(location.search).get('after')) || 0);
  let list; let more;
  if (at.path) {
    // History of one file: the commits where its contents changed, following the first parent.
    const { versions } = await fileVersions(resolved.id, at.path, from + PAGE + 1);
    if (!versions.length) return missing(context, 'code', S.code.noFile(at.ref));
    list = versions.slice(from, from + PAGE); more = versions.length > from + PAGE;
  } else {
    const all = await walk(resolved.id, from + PAGE + 1);
    list = all.slice(from, from + PAGE); more = all.length > from + PAGE;
  }
  const groups = [];
  for (const item of list) {
    const date = day(person(item.commit.author).time);
    if (!groups.length || groups[groups.length - 1].date !== date) groups.push({ date, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  const here = repoPath(context.repo, 'commits', at.ref, at.path);
  const pager = el('nav', { class: 'pagination', 'aria-label': S.common.pagination },
    from > 0 ? el('a', { href: `${repoHref(context.repo, 'commits', at.ref, at.path)}${from - PAGE > 0 ? `?after=${from - PAGE}` : ''}`, rel: 'prev' }, icon('chevron-left'), S.code.newer) : el('span', { 'aria-disabled': 'true' }, icon('chevron-left'), S.code.newer),
    more ? el('a', { href: `${repoHref(context.repo, 'commits', at.ref, at.path)}?after=${from + PAGE}`, rel: 'next' }, S.code.older, icon('chevron-right')) : el('span', { 'aria-disabled': 'true' }, S.code.older, icon('chevron-right')));
  void here;
  show('wide', repoHeader(context, 'code'), el('div', { class: 'page stack' }, el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.repo.commits), at.path && el('span', { class: 'muted' }, `${S.code.historyFor} ${at.path}`)),
    el('div', { class: 'row' }, refSwitcher(context, at, 'commits')),
    groups.map((group) => el('section', { class: 'stack condensed' }, el('h2', { class: 'day' }, icon('git-commit'), S.code.commitsOn(group.date)), box({ rows: group.items.map((item) => commitItem(context, item.id, item.commit)) }))),
    from > 0 || more ? pager : ''));
  return { title: `${S.repo.commits} · ${context.repo.name}`, repo: context.repo };
}

// One file's change as rows for a diff table, with three lines of context around each change and a header per hunk.
const MAX_DIFF_LINES = 3000;
async function fileRows(change, oldTree, newTree) {
  const read = async (tree) => { if (!tree) return new Uint8Array(); try { return open(await getObject((await lookup(tree, change.path)).id)).content; } catch { return new Uint8Array(); } };
  const before = change.status === 'added' ? new Uint8Array() : await read(oldTree);
  const after = change.status === 'removed' ? new Uint8Array() : await read(newTree);
  if (isBinary(before) || isBinary(after)) return { note: S.code.binary, added: 0, removed: 0 };
  const a = splitLines(before); const b = splitLines(after);
  if (a.length + b.length > MAX_DIFF_LINES) return { note: S.code.largeDiff, added: 0, removed: 0, load: true };
  const all = [];
  let i = 0; let j = 0;
  const text = (line) => decode(line).replace(/\r?\n$/, '');
  for (const run of diffLines(before, after)) for (let n = 0; n < run.count; n += 1) {
    if (run.op === 'equal') { all.push({ op: ' ', a: i + 1, b: j + 1, text: text(b[j]) }); i += 1; j += 1; } else if (run.op === 'delete') { all.push({ op: '-', a: i + 1, text: text(a[i]) }); i += 1; } else { all.push({ op: '+', b: j + 1, text: text(b[j]) }); j += 1; }
  }
  const keep = new Uint8Array(all.length);
  all.forEach((row, at) => { if (row.op !== ' ') for (let k = Math.max(0, at - 3); k <= Math.min(all.length - 1, at + 3); k += 1) keep[k] = 1; });
  const rows = [];
  let start = -1;
  const close = (end) => {
    if (start < 0) return;
    const part = all.slice(start, end);
    const first = part.find((r) => r.a) || { a: 0 }; const firstB = part.find((r) => r.b) || { b: 0 };
    rows.push({ op: '@', text: `@@ -${first.a},${part.filter((r) => r.op !== '+').length} +${firstB.b},${part.filter((r) => r.op !== '-').length} @@` }, ...part);
    start = -1;
  };
  all.forEach((row, at) => { if (keep[at]) { if (start < 0) start = at; } else close(at); });
  close(all.length);
  return { rows, added: all.filter((r) => r.op === '+').length, removed: all.filter((r) => r.op === '-').length };
}

// hooks.cell(path, row, tr) may return a control for the line; hooks.after(path, row) may return rows to show under it.
function unified(rows, hooks = {}, path = '') {
  return el('table', { class: 'diff' }, el('tbody', {}, rows.flatMap((row) => {
    const text = el('td', { class: 'text' }, row.text);
    const tr = el('tr', { class: { '+': 'add', '-': 'del', '@': 'hunk' }[row.op] || '' }, el('td', { class: 'num' }, row.a ?? ''), el('td', { class: 'num' }, row.b ?? ''), el('td', { class: 'sign' }, row.op === '@' ? '' : row.op), text);
    const control = hooks.cell && row.op !== '@' ? hooks.cell(path, row, tr) : null;
    if (control) text.prepend(control);
    return [tr, ...(hooks.after && row.op !== '@' ? hooks.after(path, row) : [])];
  })));
}
// Side by side: removed lines on the left, added lines on the right, paired in order within each run of changes.
function split(rows) {
  const out = [];
  let dels = []; let adds = [];
  const flush = () => { for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) out.push([dels[k], adds[k]]); dels = []; adds = []; };
  for (const row of rows) { if (row.op === '-') dels.push(row); else if (row.op === '+') adds.push(row); else { flush(); out.push(row.op === '@' ? row : [row, row]); } }
  flush();
  const side = (row, key, cls) => (row ? [el('td', { class: `num${row.op === ' ' ? '' : ` ${cls}`}` }, row[key]), el('td', { class: `text${row.op === ' ' ? '' : ` ${cls}`}` }, row.text)] : [el('td', { class: 'num empty' }), el('td', { class: 'text empty' })]);
  return el('table', { class: 'diff split' }, el('colgroup', {}, el('col', { class: 'num' }), el('col', {}), el('col', { class: 'num' }), el('col', {})), el('tbody', {}, out.map((pair) => (Array.isArray(pair) ? el('tr', {}, side(pair[0], 'a', 'del'), side(pair[1], 'b', 'add')) : el('tr', { class: 'hunk' }, el('td', { class: 'num' }), el('td', { class: 'text', colspan: '3' }, pair.text))))));
}

const STATUS = { added: ['diff-added', 'fg-success'], removed: ['diff-removed', 'fg-danger'], modified: ['diff-modified', 'fg-attention'] };
// The changed files between two trees: a summary line with the Unified / Split switch, a list of files, and each file's diff, which can be folded away.
export async function changes(context, oldTree, newTree, fileRef, hooks = {}) {
  const list = await changedPaths(oldTree, newTree);
  let mode = saved('diff-view', 'unified') === 'split' && window.innerWidth >= 768 ? 'split' : 'unified';
  const files = [];
  let added = 0; let removed = 0;
  for (const change of list) { const result = await fileRows(change, oldTree, newTree); added += result.added; removed += result.removed; files.push({ change, result }); }
  const bodies = [];
  const sections = files.map(({ change, result }, index) => {
    const body = el('div', { class: 'diff-body' });
    const draw = () => body.replaceChildren(result.rows ? (mode === 'split' ? split(result.rows) : unified(result.rows, hooks, change.path)) : el('p', { class: 'box-body muted' }, result.note));
    draw(); bodies.push(draw);
    const [name, tone] = STATUS[change.status];
    const details = el('details', { class: 'box diff-file', open: true, id: `diff-${index}` }, el('summary', { class: 'box-head' }, icon('chevron-down', { class: 'fold' }), icon(name, { label: S.code.status[change.status], class: tone }),
      change.status === 'removed' ? el('span', { class: 'mono' }, change.path) : el('a', { class: 'mono', href: repoHref(context.repo, 'blob', fileRef, change.path) }, change.path), el('span', { class: 'spacer' }), diffstat(result.added, result.removed)), body);
    if (hooks.file) hooks.file(change, details);
    return details;
  });
  const summary = el('div', { class: 'row' }, el('span', {}, S.code.showing(list.length, added, removed)), el('span', { class: 'spacer' }),
    segmented([{ value: 'unified', label: S.code.unified }, { value: 'split', label: S.code.split }], mode, (value) => { mode = value; save('diff-view', value); bodies.forEach((draw) => draw()); }));
  const index = list.length > 1 ? box({ class: 'diff-index', rows: files.map(({ change, result }, at) => el('a', { class: 'box-row', href: `#diff-${at}` }, icon(STATUS[change.status][0], { class: STATUS[change.status][1] }), el('span', { class: 'main mono' }, change.path), diffstat(result.added, result.removed))) }) : '';
  return list.length ? [summary, index, ...sections] : [box({ body: blankslate({ icon: 'diff-modified', title: S.code.noDiff }) })];
}

export async function commit(context, at) {
  let resolved;
  try { resolved = await resolveCommit(context.refs, at.ref); } catch { return missing(context, 'code', S.code.noCommit); }
  const { id, commit: data } = resolved;
  const author = person(data.author);
  const parentTree = data.parents.length ? (await resolveCommit(context.refs, data.parents[0])).commit.tree : null;
  const body = data.message.split('\n').slice(1).join('\n').trim();
  show('wide', repoHeader(context, 'code'), el('div', { class: 'page stack' },
    box({ head: [el('div', { class: 'main stack condensed' }, el('h1', { class: 'commit-title' }, subject(data.message)), body && el('pre', { class: 'plain' }, body)), button({ label: S.code.browseFiles, href: repoHref(context.repo, 'tree', id) })],
      body: el('div', { class: 'row' }, avatar(author.name), el('strong', {}, author.name), el('span', { class: 'muted' }, S.parts.committed, ' ', relativeTime(author.time)), el('span', { class: 'spacer' }),
        data.parents.length ? el('span', { class: 'muted' }, S.code.parents(data.parents.length), ' ', data.parents.map((p) => [el('a', { class: 'mono', href: repoHref(context.repo, 'commit', p) }, short(p)), ' '])) : '',
        el('span', { class: 'muted' }, S.code.commit, ' ', el('span', { class: 'mono', 'data-sha': '' }, id))) }),
    await changes(context, parentTree, data.tree, id)));
  return { title: `${subject(data.message)} · ${short(id)} · ${context.repo.name}`, repo: context.repo };
}

// /compare/base...head. The two trees are compared directly; a comparison from their common ancestor comes with pull requests.
export async function compare(context, rest) {
  const [baseName, headName] = decodeURIComponent(rest || '').split('...');
  let base; let head;
  try { base = await resolveCommit(context.refs, baseName || context.head); head = await resolveCommit(context.refs, headName || ''); } catch { return missing(context, 'code', S.code.noCompare); }
  show('wide', repoHeader(context, 'code'), el('div', { class: 'page stack' }, el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.code.comparing)),
    el('div', { class: 'row' }, label(`${S.code.base}: ${baseName}`), icon('arrow-right', { class: 'fg-muted' }), label(`${S.code.compareWith}: ${headName}`)),
    base.id === head.id ? flash('info', S.code.identical) : [context.branches.includes(baseName) ? proposeForm(context, baseName, head.id, subject(head.commit.message)) : '', await changes(context, base.commit.tree, head.commit.tree, head.id)]));
  return { title: `${S.code.comparing} ${baseName}...${headName} · ${context.repo.name}`, repo: context.repo };
}

async function refList(context, kind) {
  const names = kind === 'branch' ? context.branches : context.tags;
  const prefix = kind === 'branch' ? 'refs/heads/' : 'refs/tags/';
  const rows = [];
  for (const name of [...names].sort((a, b) => (a === context.head ? -1 : b === context.head ? 1 : a < b ? -1 : 1))) {
    let detail = '';
    try { const { id, commit: data } = await resolveCommit(context.refs, prefix + name); const author = person(data.author); detail = [el('a', { class: 'mono', href: repoHref(context.repo, 'commit', id) }, short(id)), ' · ', S.code.updated, ' ', relativeTime(author.time), ' ', S.code.by, ' ', author.name]; } catch { /* a ref that does not lead to a commit */ }
    rows.push(boxRow({ lead: icon(kind === 'branch' ? 'git-branch' : 'tag', { class: 'fg-muted' }), title: name, href: repoHref(context.repo, 'tree', name), meta: detail,
      aside: [kind === 'branch' && name === context.head ? label(S.code.default) : '', kind === 'branch' && name !== context.head ? button({ label: S.code.compare, size: 'small', href: repoHref(context.repo, 'compare') + `/${encodeURIComponent(context.head)}...${encodeURIComponent(name)}` }) : ''] }));
  }
  const title = kind === 'branch' ? S.code.branches : S.code.tags;
  show('', repoHeader(context, 'code'), el('div', { class: 'page stack' }, el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, title)),
    rows.length ? box({ rows }) : box({ body: blankslate({ icon: 'tag', title: S.code.noTags }) })));
  return { title: `${title} · ${context.repo.name}`, repo: context.repo };
}
export const branches = (context) => refList(context, 'branch');
export const tags = (context) => refList(context, 'tag');

// Search the default branch, file by file, in this browser. Plain text, case-insensitive.
const SEARCH_FILES = 3000; const SEARCH_BYTES = 512 * 1024;
export async function search(context) {
  const q = (new URLSearchParams(location.search).get('q') || '').trim();
  const form = el('form', { role: 'search', class: 'row', onsubmit: (event) => { event.preventDefault(); const value = event.currentTarget.elements.q.value.trim(); if (value) navigate(`${repoPath(context.repo, 'search')}?q=${encodeURIComponent(value)}`); } },
    el('div', { class: 'main' }, textInput({ type: 'search', name: 'q', value: q, placeholder: S.code.searchCode, 'aria-label': S.code.searchCode })), button({ label: S.header.search, type: 'submit' }));
  const results = [];
  let scanned = 0; let truncated = false;
  if (q) {
    const { commit: data } = await resolveCommit(context.refs, context.head);
    const needle = q.toLowerCase();
    const visit = async (treeId, prefix) => {
      for (const entry of await readTree(treeId)) {
        if (scanned >= SEARCH_FILES) { truncated = true; return; }
        if (entry.mode === '40000') await visit(entry.id, `${prefix}${entry.name}/`);
        else if (entry.mode !== '160000') {
          scanned += 1;
          const content = open(await getObject(entry.id)).content;
          const inName = entry.name.toLowerCase().includes(needle);
          if (content.length > SEARCH_BYTES || isBinary(content)) { if (inName) results.push({ path: prefix + entry.name, lines: [] }); continue; }
          const lines = [];
          decode(content).split('\n').forEach((line, i) => { if (lines.length < 5 && line.toLowerCase().includes(needle)) lines.push({ n: i + 1, text: line.slice(0, 300) }); });
          if (lines.length || inName) results.push({ path: prefix + entry.name, lines });
        }
      }
    };
    await visit(data.tree, '');
  }
  show('', repoHeader(context, 'code'), el('div', { class: 'page stack' }, form,
    !q ? '' : !results.length ? box({ body: blankslate({ icon: 'search', title: S.code.noResults(q) }) }) : [el('p', { class: 'muted' }, S.code.results(results.length, context.head)), truncated ? flash('warning', S.code.searchTruncated(SEARCH_FILES)) : '',
      ...results.slice(0, 100).map((result) => box({ head: [icon('file', { class: 'fg-muted' }), el('a', { class: 'mono', href: repoHref(context.repo, 'blob', context.head, result.path) }, result.path)],
        rows: result.lines.length ? el('table', { class: 'code-lines' }, el('tbody', {}, result.lines.map((line) => el('tr', {}, el('td', { class: 'num' }, el('a', { href: `${repoHref(context.repo, 'blob', context.head, result.path)}#L${line.n}` }, line.n)), el('td', { class: 'text' }, line.text))))) : '' }))]));
  return { title: `${q ? `${q} · ` : ''}${S.header.search} · ${context.repo.name}`, repo: context.repo };
}
