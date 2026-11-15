// Activity: what happened in a period, who has committed, and commits week by week.
// Everything here is counted from the repository's own history and discussion; nothing is stored for it.

import { S } from './strings.js';
import { el, icon, box, boxRow, blankslate, menu, sideNav, avatar, relativeTime, stateIcon } from './components.js';
import { repoHeader, repoHref, show } from './repo.js';
import { readLog } from './issues.js';
import { history as walk, person, resolveCommit } from '../git.js';

const DAY = 86400000;
const LIMIT = 1000;
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

// The commits reachable from the default branch, newest first. Kept until the branch moves.
const walked = new Map();
async function commitsOf(context) {
  let head;
  try { head = (await resolveCommit(context.refs, `refs/heads/${context.head}`)).id; } catch { return []; }
  const key = `${context.repo.name}:${head}`;
  if (!walked.has(key)) {
    walked.clear();
    walked.set(key, (await walk(head, LIMIT)).map(({ id, commit }) => ({ id, merge: commit.parents.length > 1, ...person(commit.author) })));
  }
  return walked.get(key);
}

function frame(context, current, title, ...children) {
  const item = (key, text, name, ...rest) => ({ label: text, icon: name, href: repoHref(context.repo, 'activity', ...rest), current: current === key });
  show('wide', repoHeader(context, 'activity'), el('div', { class: 'page' }, el('div', { class: 'settings' },
    sideNav([item('pulse', S.activity.pulse, 'pulse'), item('contributors', S.activity.contributors, 'people', 'contributors'), item('commits', S.activity.commits, 'git-commit', 'commits')], { label: S.activity.navigation }),
    el('div', { class: 'stack' }, children))));
  return { title: `${title} · ${context.repo.name}`, repo: context.repo };
}
const heading = (title, ...actions) => el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, title), el('span', { class: 'spacer' }), actions);

export async function pulse(context) {
  const asked = Number(new URLSearchParams(location.search).get('period'));
  const days = [1, 7, 30].includes(asked) ? asked : 7;
  const since = Date.now() - days * DAY;
  const within = (time) => time >= since;
  const state = await readLog(context.repo.name);
  const closedAt = (issue) => { const last = [...issue.events].reverse().find((event) => event.kind === 'state'); return last && last.to === 'closed' ? last.time : 0; };
  const commits = (await commitsOf(context)).filter((commit) => within(commit.time) && !commit.merge);
  const authors = new Set(commits.map((commit) => commit.email || commit.name)).size;
  const pullRow = (pull) => boxRow({ lead: stateIcon(pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open', 'pull'), title: pull.title, href: repoHref(context.repo, 'pull', pull.number), meta: [`#${pull.number} · `, relativeTime(pull.mergedAt || pull.time)] });
  const issueRow = (issue) => boxRow({ lead: stateIcon(issue.state === 'open' ? 'open' : 'closed'), title: issue.title, href: repoHref(context.repo, 'issues', issue.number), meta: [`#${issue.number} · `, relativeTime(closedAt(issue) || issue.time)] });
  const groups = [
    ['merged', S.activity.merged, 'git-merge', state.pulls.filter((pull) => pull.merged && within(pull.mergedAt || pull.updated)), pullRow],
    ['opened', S.activity.opened, 'git-pull-request', state.pulls.filter((pull) => within(pull.time)), pullRow],
    ['closed', S.activity.closed, 'issue-closed', state.issues.filter((issue) => issue.state !== 'open' && within(closedAt(issue))), issueRow],
    ['new', S.activity.fresh, 'issue-opened', state.issues.filter((issue) => within(issue.time)), issueRow],
    ['released', S.activity.released, 'tag', state.releases.filter((release) => within(release.time)), (release) => boxRow({ lead: icon('tag', { class: 'fg-muted' }), title: release.title, href: repoHref(context.repo, 'releases', 'tag', release.tag), meta: [release.tag, ' · ', relativeTime(release.time)] })],
  ];
  const quiet = !commits.length && groups.every((group) => !group[3].length);
  const period = menu({ label: `${S.activity.period}: ${S.activity.periods[days]}`, align: 'end', attrs: { 'data-period': '' }, items: [1, 7, 30].map((n) => ({ label: S.activity.periods[n], icon: n === days ? 'check' : undefined, href: `${repoHref(context.repo, 'activity')}${n === 7 ? '' : `?period=${n}`}` })) });
  return frame(context, 'pulse', S.activity.pulse, heading(S.activity.range(day(since), day(Date.now())), period),
    quiet ? blankslate({ icon: 'pulse', title: S.activity.quiet }) : [
      el('div', { class: 'box stats' }, groups.map(([key, text, name, list]) => el('div', { class: 'stat', 'data-stat': key }, el('strong', {}, icon(name), ' ', list.length), text))),
      el('p', { 'data-summary': '' }, commits.length ? S.activity.summary(authors, commits.length, context.head) : S.activity.noCommits(context.head)),
      groups.filter((group) => group[3].length).map(([, text, , list, row]) => box({ head: el('strong', {}, text), rows: list.map(row) }))]);
}

export async function contributors(context) {
  const commits = await commitsOf(context);
  const people = new Map();
  for (const commit of commits) {
    const key = commit.email || commit.name;
    const known = people.get(key) || { name: commit.name, commits: 0, first: commit.time, last: commit.time };
    known.commits += 1; known.first = Math.min(known.first, commit.time); known.last = Math.max(known.last, commit.time);
    people.set(key, known);
  }
  const list = [...people.values()].sort((a, b) => b.commits - a.commits);
  const most = list.length ? list[0].commits : 1;
  const rows = list.map((one, i) => {
    const fill = el('i', {});
    fill.style.setProperty('width', `${Math.round((one.commits / most) * 100)}%`);
    return el('div', { class: 'box-row contributor', 'data-contributor': one.name }, el('span', { class: 'muted' }, `#${i + 1}`), avatar(one.name, { size: 32 }),
      el('div', { class: 'main' }, el('span', { class: 'title' }, one.name), el('div', { class: 'meta' }, S.activity.commitCount(one.commits), ' · ', one.first === one.last ? day(one.first) : S.activity.between(day(one.first), day(one.last)))),
      el('div', { class: 'progress', 'aria-hidden': 'true' }, fill));
  });
  return frame(context, 'contributors', S.activity.contributors, heading(S.activity.contributors),
    el('p', { class: 'muted' }, S.activity.onBranch(context.head), commits.length >= LIMIT ? ` ${S.activity.limited(LIMIT)}` : ''),
    rows.length ? box({ rows }) : blankslate({ icon: 'people', title: S.activity.noCommits(context.head) }));
}

const WEEKS = 52;
export async function commitGraph(context) {
  const commits = await commitsOf(context);
  const now = Date.now();
  const counts = new Array(WEEKS).fill(0);
  for (const commit of commits) { const back = Math.floor((now - commit.time) / (7 * DAY)); if (back >= 0 && back < WEEKS) counts[WEEKS - 1 - back] += 1; }
  const total = counts.reduce((a, b) => a + b, 0);
  const most = Math.max(1, ...counts);
  const start = (i) => day(now - (WEEKS - i) * 7 * DAY);
  const bars = el('div', { class: 'bars', role: 'img', 'aria-label': S.activity.yearTotal(total) }, counts.map((n, i) => {
    const bar = el('i', { title: S.activity.weekOf(start(i), n), 'data-count': n });
    bar.style.setProperty('height', `${n ? Math.max(4, Math.round((n / most) * 100)) : 0}%`);
    return bar;
  }));
  const busiest = counts.indexOf(Math.max(...counts));
  return frame(context, 'commits', S.activity.commits, heading(S.activity.commits),
    el('p', { class: 'muted' }, S.activity.onBranch(context.head), commits.length >= LIMIT ? ` ${S.activity.limited(LIMIT)}` : ''),
    total ? [box({ head: el('strong', {}, S.activity.perWeek), body: bars }), el('p', { 'data-year': '' }, S.activity.yearTotal(total), ' ', S.activity.busiest(start(busiest), counts[busiest])),
      el('p', {}, el('a', { href: repoHref(context.repo, 'commits', context.head) }, S.activity.seeCommits))] : blankslate({ icon: 'git-commit', title: S.activity.noneThisYear }));
}
