// Actions: the checks a repository describes, where each stands on a branch, and every result reported for them.
//
// A check runs on a contributor's machine, not in the page, and only its result is kept. So these
// screens show and filter; they start nothing, and there is no output to show for a run.

import { S } from './strings.js';
import { el, icon, box, blankslate, menu, sideNav, relativeTime, label, button, avatar } from './components.js';
import { repoHeader, repoHref, show, short } from './repo.js';
import { readLog } from './issues.js';
import { resolveCommit, lookup } from '../git.js';
import { getObject } from '../store.js';
import { open } from '../engine.js';
import { parseChecks, CHECKS_PATH } from '../checks.js';
import { expectedActions } from '../evidence.js';

const LOOK = { pass: ['check-circle', 'fg-success'], fail: ['x-circle-fill', 'fg-danger'], waiting: ['dot-fill', 'fg-attention'], unknown: ['clock', 'fg-muted'] };
const mark = (state) => icon(LOOK[state][0], { class: LOOK[state][1], label: S.actions.states[state] });

// Each branch with the checks its own file describes, and for each check the address a result for the branch's newest commit must carry.
async function gather(context) {
  const state = await readLog(context.repo.name);
  const branches = [];
  for (const name of [context.head, ...context.branches.filter((other) => other !== context.head)].slice(0, 30)) {
    try {
      const { id, commit } = await resolveCommit(context.refs, `refs/heads/${name}`);
      let definitions = new Map();
      try { definitions = parseChecks(open(await getObject((await lookup(commit.tree, CHECKS_PATH)).id)).content); } catch { /* no file, or one that cannot be read: it describes nothing */ }
      const names = [...definitions.keys()];
      const keys = (names.length && await expectedActions(id, id, names)) || [];
      branches.push({ name, head: id, definitions, keys: new Map(names.map((check, i) => [check, keys[i] || null])) });
    } catch { /* a branch that does not lead to a commit */ }
  }
  const at = new Map();
  for (const branch of branches) for (const key of branch.keys.values()) if (key) at.set(key, [...(at.get(key) || []), branch.name]);
  return { state, branches, at, who: (key) => state.names.get(key) || key.slice(0, 7) };
}
const standing = (state, key) => { const result = key && state.checks.get(key); return !key ? 'unknown' : !result ? 'waiting' : result.result; };
const page = (context, ...children) => show('wide', repoHeader(context, 'actions'), el('div', { class: 'page' }, children));
const done = (context, title) => ({ title: `${title} · ${context.repo.name}`, repo: context.repo });

export async function list(context) {
  const { state, branches, at, who } = await gather(context);
  const names = [...new Set([...branches.flatMap((branch) => [...branch.definitions.keys()]), ...state.runs.map((run) => run.name)])].sort();
  if (!names.length) {
    page(context, blankslate({ icon: 'play', title: S.actions.none, text: [S.actions.noneText[0], el('code', {}, CHECKS_PATH), S.actions.noneText[1]] }));
    return done(context, S.actions.title);
  }
  const query = new URLSearchParams(location.search);
  const wanted = { check: names.includes(query.get('check')) ? query.get('check') : '', branch: branches.some((branch) => branch.name === query.get('branch')) ? query.get('branch') : '',
    status: ['pass', 'fail'].includes(query.get('status')) ? query.get('status') : '', person: query.get('person') || '' };
  const to = (change) => { const text = new URLSearchParams(Object.entries({ ...wanted, ...change }).filter(([, value]) => value)).toString(); return `${repoHref(context.repo, 'actions')}${text ? `?${text}` : ''}`; };
  const shown = branches.find((branch) => branch.name === wanted.branch) || branches[0];
  const runs = [...state.runs].reverse().filter((run) => (!wanted.check || run.name === wanted.check) && (!wanted.status || run.result === wanted.status) && (!wanted.person || run.by === wanted.person) && (!wanted.branch || (at.get(run.action) || []).includes(wanted.branch)));

  const now = shown ? [...shown.definitions.keys()].filter((name) => !wanted.check || name === wanted.check).map((name) => {
    const key = shown.keys.get(name); const stands = standing(state, key); const result = key && state.checks.get(key);
    return el('div', { class: 'box-row check-row', 'data-check': name, 'data-state': stands }, mark(stands), result ? el('a', { class: 'title', href: repoHref(context.repo, 'actions', 'runs', key) }, name) : el('strong', {}, name),
      el('span', { class: 'main muted' }, S.actions.states[stands]), result ? el('span', { class: 'muted' }, relativeTime(result.time)) : '');
  }) : [];
  const pickOne = (title, key, options) => menu({ label: title, kind: 'invisible', size: 'small', align: 'end', attrs: { 'data-filter': key }, items: options.map(([value, text]) => ({ label: text, icon: wanted[key] === value ? 'check' : undefined, href: to({ [key]: value }) })) });
  const people = [...new Set(state.runs.map((run) => run.by))];
  const filtered = wanted.check || wanted.branch || wanted.status || wanted.person;
  const rows = runs.map((run) => el('div', { class: 'box-row', 'data-run': run.name, 'data-result': run.result }, mark(run.result),
    el('div', { class: 'main' }, el('a', { class: 'title', href: repoHref(context.repo, 'actions', 'runs', run.action) }, run.name), el('div', { class: 'meta' }, S.actions.states[run.result], ' · ', S.actions.reportedBy(who(run.by)), ' ', relativeTime(run.time))),
    el('div', { class: 'aside' }, (at.get(run.action) || []).map((name) => label(name)), el('span', { class: 'mono' }, short(run.action)))));
  const nav = sideNav([{ label: S.actions.all, icon: 'play', href: to({ check: '' }), current: !wanted.check }, ...names.map((name) => ({ label: name, icon: 'check-circle', href: to({ check: name }), current: wanted.check === name }))], { label: S.actions.checks });
  page(context, el('div', { class: 'settings' }, nav, el('div', { class: 'stack' },
    el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, wanted.check || S.actions.all)),
    shown && now.length ? box({ head: el('strong', {}, S.actions.statusOn(shown.name)), rows: now }) : '',
    box({ head: [el('strong', {}, S.actions.resultCount(runs.length)), el('span', { class: 'spacer' }),
      pickOne(S.actions.branch, 'branch', [['', S.actions.anyBranch], ...branches.map((branch) => [branch.name, branch.name])]),
      pickOne(S.actions.status, 'status', [['', S.actions.anyStatus], ['pass', S.actions.states.pass], ['fail', S.actions.states.fail]]),
      pickOne(S.actions.person, 'person', [['', S.actions.anyone], ...people.map((key) => [key, who(key)])])],
    rows: rows.length ? rows : blankslate({ icon: 'play', title: filtered ? S.actions.noMatch : S.actions.noResults, text: filtered ? '' : S.actions.noResultsText, action: filtered ? button({ label: S.actions.clear, href: repoHref(context.repo, 'actions') }) : '' }) }))));
  return done(context, S.actions.title);
}

export async function run(context, action) {
  const { state, branches, who } = await gather(context);
  const all = state.runs.filter((item) => item.action === action);
  if (!all.length) {
    page(context, blankslate({ icon: 'play', title: S.actions.notFound, action: button({ label: S.actions.back, href: repoHref(context.repo, 'actions') }) }));
    return { title: S.notFound.title, repo: context.repo };
  }
  const last = all[all.length - 1];
  const on = branches.filter((branch) => [...branch.keys.values()].includes(action));
  const described = on[0] || branches.find((branch) => branch.definitions.has(last.name));
  const definition = described ? described.definitions.get(last.name) : null;
  const code = (text) => el('code', { class: 'mono' }, text);
  const step = (name, tone, ...content) => el('div', { class: 'box-row', 'data-step': '' }, icon(name, { class: tone }), el('div', { class: 'main' }, content));
  const steps = definition ? [
    ...definition.tools.map(([command, expect]) => step('shield-check', 'fg-muted', S.actions.toolStep, ' ', code(command), el('div', { class: 'meta' }, S.actions.mustPrint, ' ', code(expect)))),
    step(LOOK[last.result][0], LOOK[last.result][1], S.actions.runStep, ' ', code(definition.run), definition.cwd ? el('div', { class: 'meta' }, S.actions.inFolder, ' ', code(definition.cwd)) : '')] : [];
  const facts = definition ? [[S.actions.reads, definition.inputs], [S.actions.environment, definition.env], [S.actions.needs, definition.uses], [S.actions.produces, definition.outputs]].filter(([, list]) => list.length)
    .map(([title, list]) => el('div', { class: 'box-row' }, el('strong', {}, title), el('div', { class: 'main row' }, list.map((item) => code(item))))) : [];
  page(context, el('div', { class: 'stack' },
    el('div', {}, el('a', { class: 'row', href: repoHref(context.repo, 'actions') }, icon('chevron-left'), S.actions.back)),
    el('div', { class: 'page-head' }, mark(last.result), el('h1', { class: 'page-title' }, last.name), label(S.actions.states[last.result], last.result === 'pass' ? 'success' : 'danger'), el('span', { class: 'spacer' }), el('span', { class: 'mono muted' }, short(action))),
    el('div', { class: 'row muted', 'data-run-meta': '' }, avatar(who(last.by)), el('strong', {}, who(last.by)), S.actions.reported, relativeTime(last.time), ' · ',
      on.length ? [S.actions.appliesTo, on.map((branch) => el('a', { class: 'label', href: repoHref(context.repo, 'tree', branch.name) }, branch.name))] : S.actions.noBranch),
    el('div', { class: 'settings' },
      sideNav([{ label: last.name, icon: LOOK[last.result][0], href: repoHref(context.repo, 'actions', 'runs', action), current: true }], { label: S.actions.jobs }),
      el('div', { class: 'stack' },
        definition ? [on.length ? '' : el('p', { class: 'muted' }, S.actions.describedNow(described.name)), box({ head: el('strong', {}, S.actions.steps), rows: steps }), facts.length ? box({ rows: facts }) : '']
          : el('p', { class: 'muted' }, S.actions.noDefinition),
        box({ head: el('strong', {}, S.actions.log), body: blankslate({ icon: 'file', title: S.actions.noLog, text: S.actions.noLogText }) }),
        all.length > 1 ? box({ head: el('strong', {}, S.actions.earlier), rows: [...all].reverse().map((item) => el('div', { class: 'box-row', 'data-earlier': item.result }, mark(item.result), el('span', { class: 'main' }, S.actions.states[item.result], ' · ', S.actions.reportedBy(who(item.by))), el('span', { class: 'muted' }, relativeTime(item.time)))) }) : ''))));
  return done(context, `${last.name} · ${S.actions.title}`);
}
