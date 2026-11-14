// Repository settings: General with the danger zone, Collaborators, Branches (protection rules), and
// the Remote this repository is published to. Also the screen for resolving conflicts after a fetch.
//
// The page asks and shows. Adding a collaborator or a rule is signed onto the log, where it is judged.

import { S } from './strings.js';
import { el, icon, button, box, boxRow, blankslate, flash, field, textInput, textArea, validate, sideNav, dialog, avatar, label, relativeTime } from './components.js';
import { href, navigate, refresh } from './router.js';
import { profile } from './session.js';
import { repoHeader, repoHref, repoPath, show, decode } from './repo.js';
import { readLog } from './issues.js';
import { setRepo, renameRepo, deleteRepo, listRepos, listRefUpdates } from '../store.js';
import { deviceKey, grant, revoke, protect, unprotect } from '../identity.js';
import { push, setCredentials, hasCredentials } from '../replica.js';
import { fetchFrom } from '../sync.js';

const REPO = /^[A-Za-z0-9._-]+$/;
const refusal = (error) => (/does not count/.test(error.message) ? S.issues.noPermission : S.issues.failed);
async function attempt(note, run, explain = refusal) {
  try { await run(); return true; } catch (error) { note.replaceChildren(flash('error', explain(error))); note.scrollIntoView({ block: 'nearest' }); return false; }
}
function frame(context, tab, ...body) {
  const at = (part) => repoHref(context.repo, 'settings', part);
  show('wide', repoHeader(context, 'settings'), el('div', { class: 'page' }, el('div', { class: 'settings' },
    sideNav([{ label: S.repoSettings.general, icon: 'gear', href: at(), current: tab === 'general' }, { label: S.repoSettings.collaborators, icon: 'people', href: at('collaborators'), current: tab === 'collaborators' },
      { label: S.code.branches, icon: 'git-branch', href: at('branches'), current: tab === 'branches' }, { label: S.repoSettings.remote, icon: 'sync', href: at('remote'), current: tab === 'remote' }], { label: S.repo.settings }),
    el('div', { class: 'stack' }, body))));
  return { title: `${S.repo.settings} · ${context.repo.name}`, repo: context.repo };
}

export async function general(context) {
  const { repo } = context;
  const note = el('div', {});
  const description = field({ label: S.newRepo.description, optional: S.newRepo.optional, control: textInput({ value: repo.description || '', maxlength: 350 }) });
  const branch = el('select', { class: 'select', id: 'default-branch' }, context.branches.map((name) => { const option = el('option', { value: name }, name); option.selected = name === context.head; return option; }));
  const form = el('form', { class: 'stack', onsubmit: async (event) => { event.preventDefault(); await setRepo({ ...repo, description: description.control.value.trim(), head: `refs/heads/${branch.value}` }); note.replaceChildren(flash('success', S.repoSettings.saved)); } },
    description, el('div', { class: 'field' }, el('label', { for: 'default-branch' }, S.repoSettings.defaultBranch), branch, el('span', { class: 'hint' }, S.repoSettings.defaultBranchHint)), el('div', {}, button({ label: S.common.save, kind: 'primary', type: 'submit' })));

  const rename = field({ label: S.newRepo.name, control: textInput({ value: repo.name, maxlength: 100 }) });
  const renameForm = el('form', { class: 'row danger-row', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const value = rename.control.value.trim();
    const taken = value !== repo.name && (await listRepos()).some((item) => item.name === value);
    if (!validate([[rename, !value ? S.newRepo.nameBlank : !REPO.test(value) || value === '.' || value === '..' ? S.newRepo.nameInvalid : taken ? S.newRepo.nameTaken(value) : '']])) return;
    if (value === repo.name) return;
    await renameRepo(repo.name, value);
    navigate(repoPath({ ...repo, name: value }, 'settings'));
  } }, el('div', { class: 'main' }, rename), button({ label: S.repoSettings.rename, type: 'submit', attrs: { 'data-rename': '' } }));

  // Deleting asks for the name to be typed, so it cannot happen by a slip.
  const confirmDelete = () => {
    const typed = field({ label: S.repoSettings.typeName(repo.name), control: textInput({ autocomplete: 'off' }) });
    const go = button({ label: S.repoSettings.deleteConfirm, kind: 'danger', type: 'submit', disabled: true, block: true });
    typed.control.addEventListener('input', () => { go.disabled = typed.control.value !== repo.name; });
    const node = dialog({ title: S.repoSettings.deleteTitle(repo.name), body: el('form', { class: 'stack', onsubmit: async (event) => { event.preventDefault(); if (typed.control.value !== repo.name) return; await deleteRepo(repo.name); node.close(); navigate('/'); } },
      flash('warning', S.repoSettings.deleteWarning), typed, go) });
    node.showModal();
    typed.control.focus();
  };
  return frame(context, 'general', el('h2', { class: 'page-title' }, S.repoSettings.general), note, form,
    el('h2', { class: 'page-title danger-title' }, S.repoSettings.danger),
    el('div', { class: 'box danger-zone' }, el('div', { class: 'box-row' }, el('div', { class: 'main' }, el('strong', {}, S.repoSettings.renameTitle), el('div', { class: 'muted small' }, S.repoSettings.renameHint), renameForm)),
      el('div', { class: 'box-row' }, el('div', { class: 'main' }, el('strong', {}, S.repoSettings.deleteRow), el('div', { class: 'muted small' }, S.repoSettings.deleteHint)), button({ label: S.repoSettings.deleteRow, kind: 'danger', onclick: confirmDelete, attrs: { 'data-delete-repo': '' } }))));
}

const expiry = (grantRecord) => (grantRecord.notAfter ? S.repoSettings.expires(new Date(grantRecord.notAfter * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })) : S.repoSettings.noExpiration);
export async function collaborators(context) {
  const state = await readLog(context.repo.name);
  const repo = context.repo.name;
  const mine = (await deviceKey()).id;
  const note = el('div', {});
  const person = (key) => (key === mine ? profile().name : state.names.get(key) || key.slice(0, 7));
  const rows = [];
  if (state.owner) rows.push(boxRow({ lead: avatar(person(state.owner), { size: 32 }), title: person(state.owner), meta: el('span', { class: 'mono' }, state.owner.slice(0, 16)), aside: label(S.common.owner) }));
  for (const [key, data] of state.grants) {
    if (data.revoked) continue;
    rows.push(el('div', { class: 'box-row collaborator', 'data-collaborator': key }, avatar(person(key), { size: 32 }), el('div', { class: 'main' }, el('span', { class: 'title' }, person(key)), el('div', { class: 'meta mono' }, key.slice(0, 16))),
      el('div', { class: 'aside' }, label(S.repoSettings.roles[data.mode]), el('span', { class: 'muted small' }, expiry(data)), button({ label: S.repoSettings.remove, size: 'small', kind: 'danger', onclick: async () => { if (await attempt(note, () => revoke(repo, key))) refresh(); } }))));
  }
  const key = field({ label: S.repoSettings.theirKey, hint: S.repoSettings.theirKeyHint, control: textInput({ maxlength: 64, class: 'input mono' }) });
  const role = el('select', { class: 'select', id: 'role', 'aria-label': S.repoSettings.role }, ['write', 'read'].map((value) => el('option', { value }, S.repoSettings.roles[value])));
  const days = el('select', { class: 'select', id: 'expiration', 'aria-label': S.repoSettings.expiration }, [['30', S.repoSettings.days(30)], ['7', S.repoSettings.days(7)], ['90', S.repoSettings.days(90)], ['0', S.repoSettings.noExpiration]].map(([value, text]) => el('option', { value }, text)));
  const form = el('form', { class: 'box box-body stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const value = key.control.value.trim().toLowerCase();
    if (!validate([[key, !/^[0-9a-f]{64}$/.test(value) ? S.repoSettings.keyInvalid : value === mine ? S.repoSettings.keyOwn : '']])) return;
    if (await attempt(note, () => grant(repo, value, role.value, Number(days.value)))) refresh();
  } }, el('strong', {}, S.repoSettings.addTitle), key, el('div', { class: 'row' }, el('div', { class: 'field' }, el('label', { for: 'role' }, S.repoSettings.role), role), el('div', { class: 'field' }, el('label', { for: 'expiration' }, S.repoSettings.expiration), days)),
  el('div', {}, button({ label: S.repoSettings.add, kind: 'primary', type: 'submit' })));
  return frame(context, 'collaborators', el('h2', { class: 'page-title' }, S.repoSettings.collaborators), note,
    rows.length ? box({ rows }) : box({ body: blankslate({ icon: 'people', title: S.repoSettings.noCollaborators }) }), form);
}

const summary = (rule) => [rule.minimum === 'admin' ? S.repoSettings.onlyOwner : S.repoSettings.anyWriter, S.repoSettings.approvalsNeeded(rule.approvals), rule.checks.length ? S.repoSettings.checksNeeded(rule.checks.join(', ')) : ''].filter(Boolean).join(' · ');
export async function branchRules(context, more) {
  const state = await readLog(context.repo.name);
  const repo = context.repo.name;
  const note = el('div', {});
  if (more[0] === 'new' || more[0] === 'edit') {
    const wanted = new URLSearchParams(location.search).get('branch') || context.head;
    const rule = state.protections.get(`refs/heads/${wanted}`);
    const editing = more[0] === 'edit' && rule;
    const branch = el('select', { class: 'select', id: 'rule-branch', disabled: Boolean(editing) }, context.branches.map((name) => { const option = el('option', { value: name }, name); option.selected = name === wanted; return option; }));
    const pushers = el('select', { class: 'select', id: 'rule-who' }, [['write', S.repoSettings.anyWriter], ['admin', S.repoSettings.onlyOwner]].map(([value, text]) => { const option = el('option', { value }, text); option.selected = Boolean(rule) && rule.minimum === value; return option; }));
    const approvals = field({ label: S.repoSettings.approvals, control: textInput({ type: 'number', min: '0', max: '200', value: String(rule ? rule.approvals : 0) }) });
    const checks = field({ label: S.repoSettings.checks, hint: S.repoSettings.checksHint, control: textInput({ value: rule ? rule.checks.join(', ') : '' }) });
    return frame(context, 'branches', el('h2', { class: 'page-title' }, editing ? S.repoSettings.editRule : S.repoSettings.newRule), note, el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
      event.preventDefault();
      const count = Number(approvals.control.value);
      const names = checks.control.value.split(',').map((name) => name.trim()).filter(Boolean);
      if (!validate([[approvals, Number.isInteger(count) && count >= 0 && count <= 200 ? '' : S.repoSettings.approvalsInvalid], [checks, names.every((name) => /^[a-z0-9][a-z0-9-]*$/.test(name)) ? '' : S.repoSettings.checksInvalid]])) return;
      if (await attempt(note, () => protect(repo, branch.value, pushers.value, count, names))) navigate(repoPath(context.repo, 'settings', 'branches'));
    } }, el('div', { class: 'field' }, el('label', { for: 'rule-branch' }, S.repoSettings.branch), branch), el('div', { class: 'field' }, el('label', { for: 'rule-who' }, S.repoSettings.whoCanPush), pushers, el('span', { class: 'hint' }, S.repoSettings.forwardOnly)), approvals, checks,
    el('div', { class: 'row' }, button({ label: editing ? S.common.save : S.repoSettings.create, kind: 'primary', type: 'submit' }), button({ label: S.common.cancel, href: repoHref(context.repo, 'settings', 'branches') }))));
  }
  const rows = [...state.protections].map(([ref, rule]) => { const name = ref.replace('refs/heads/', ''); return el('div', { class: 'box-row', 'data-rule': name }, icon('git-branch', { class: 'fg-muted' }), el('div', { class: 'main' }, el('span', { class: 'title mono' }, name), el('div', { class: 'meta' }, summary(rule))),
    el('div', { class: 'aside' }, button({ label: S.issues.edit, size: 'small', href: `${repoHref(context.repo, 'settings', 'branches', 'edit')}?branch=${encodeURIComponent(name)}` }), button({ label: S.repoSettings.deleteRule, size: 'small', kind: 'danger', onclick: async () => { if (await attempt(note, () => unprotect(repo, name))) refresh(); } }))); });
  return frame(context, 'branches', el('div', { class: 'page-head' }, el('h2', { class: 'page-title' }, S.repoSettings.rules), el('span', { class: 'spacer' }), button({ label: S.repoSettings.addRule, kind: 'primary', href: repoHref(context.repo, 'settings', 'branches', 'new') })), note,
    box({ rows: rows.length ? rows : blankslate({ icon: 'shield-check', title: S.repoSettings.noRules, action: button({ label: S.repoSettings.addRule, kind: 'primary', href: repoHref(context.repo, 'settings', 'branches', 'new') }) }) }));
}

// Why a fetch or a push did not go through, in the visitor's terms, with what to do next.
function remoteProblem(error) {
  const text = error.message;
  if (/it needs keys/.test(text)) return S.remote.needsKeys;
  if (/keys are wrong/.test(text)) return S.remote.wrongKeys;
  if (/several branches/.test(text)) return S.remote.oneBranch;
  if (/does not have; clone|changed while pushing/.test(text)) return S.remote.fetchFirst;
  if (/different repository/.test(text)) return S.remote.different;
  if (/not in the replica's history/.test(text)) return S.remote.diverged;
  if (/signed by another device/.test(text)) return S.remote.otherKey;
  if (/does not count/.test(text)) return S.issues.noPermission;
  if (/log|chain|digest|head its/.test(text) && /refused|malformed/.test(text)) return S.remote.tampered;
  if (/nothing on this branch|no branches/.test(text)) return S.remote.empty;
  return S.remote.unreachable;
}
let pending = null; // conflicts from the last fetch, waiting to be resolved

export async function remote(context) {
  const { repo } = context;
  const note = el('div', {});
  const count = (await listRefUpdates(repo.name)).length;
  const known = repo.replica || '';
  const address = field({ label: S.remote.address, hint: S.remote.addressHint, control: textInput({ type: 'url', value: known || repo.url || '', placeholder: 'https://storage.example.org/project' }) });
  const valid = () => validate([[address, /^https?:\/\/\S+$/.test(address.control.value.trim()) ? '' : S.openRepo.addressInvalid]]);
  const where = () => address.control.value.trim().replace(/\/+$/, '');
  const busy = (control, on) => { control.disabled = on; if (on) control.setAttribute('aria-busy', 'true'); else control.removeAttribute('aria-busy'); };
  const say = (tone, text) => note.replaceChildren(flash(tone, text));
  const pushButton = button({ label: known ? S.remote.push : S.remote.publish, kind: 'primary', icon: 'upload', attrs: { 'data-push': '' }, onclick: async () => {
    if (!valid()) return;
    busy(pushButton, true);
    try {
      const result = await push(repo, context.head, where());
      await setRepo({ ...repo, replica: where(), published: count });
      // The screen is drawn again (the button changes from Publish to Push), so the message is handed across.
      sessionStorage.setItem('remote-note', result.upToDate ? S.remote.upToDate : S.remote.published);
      refresh();
    } catch (error) { busy(pushButton, false); say('error', /nothing to push/.test(error.message) ? S.remote.nothingYet : remoteProblem(error)); }
  } });
  const fetchButton = button({ label: S.remote.fetch, icon: 'download', attrs: { 'data-fetch': '' }, onclick: async () => {
    if (!valid()) return;
    busy(fetchButton, true);
    try {
      const result = await fetchFrom(repo, context.head, where(), profile());
      if (result.outcome === 'conflict') { pending = { repo: repo.name, ref: context.head, address: where(), result }; navigate(repoPath(repo, 'resolve')); return; }
      const after = (await listRefUpdates(repo.name)).length;
      await setRepo({ ...repo, replica: where(), published: result.outcome === 'ahead' ? after - result.unpushed : result.outcome === 'up to date' || result.outcome === 'fast-forward' ? after : repo.published });
      sessionStorage.setItem('remote-note', result.outcome === 'ahead' ? S.remote.ahead(result.unpushed) : S.remote.outcomes[result.outcome]);
      refresh();
    } catch (error) { busy(fetchButton, false); say('error', remoteProblem(error)); }
  } });
  let carried = '';
  try { carried = sessionStorage.getItem('remote-note') || ''; sessionStorage.removeItem('remote-note'); } catch { /* storage unavailable */ }
  if (carried) say('success', carried);
  const waiting = repo.published !== undefined && count > repo.published ? count - repo.published : 0;

  const accessKey = field({ label: S.remote.accessKey, control: textInput({ autocomplete: 'off' }) });
  const secretKey = field({ label: S.remote.secretKey, control: textInput({ type: 'password', autocomplete: 'off' }) });
  const region = field({ label: S.remote.region, control: textInput({ value: 'us-east-1' }) });
  const keysNote = el('span', { class: 'muted small' }, known && hasCredentials(known) ? S.remote.keysSaved : '');
  const keys = el('form', { class: 'box box-body stack', onsubmit: (event) => {
    event.preventDefault();
    if (!valid()) return;
    setCredentials(where(), { accessKey: accessKey.control.value.trim(), secretKey: secretKey.control.value, region: region.control.value.trim() || 'us-east-1' });
    secretKey.control.value = '';
    keysNote.textContent = hasCredentials(where()) ? S.remote.keysSaved : S.remote.keysRemoved;
  } }, el('strong', {}, S.remote.keysTitle), el('p', { class: 'muted small' }, S.remote.keysHint), el('div', { class: 'label-form' }, accessKey, secretKey, region), el('div', { class: 'row' }, button({ label: S.remote.saveKeys, type: 'submit' }), keysNote));

  return frame(context, 'remote', el('h2', { class: 'page-title' }, S.repoSettings.remote), el('p', { class: 'muted' }, S.remote.lead), note,
    waiting ? flash('warning', S.remote.waiting(waiting)) : '', el('div', { class: 'stack' }, address, el('div', { class: 'row' }, fetchButton, pushButton)), keys);
}

// Conflicts from the last fetch, for a person to settle. Text conflicts are shown as git shows them,
// between markers; the rest are a choice between your version and the incoming one.
export async function resolve(context) {
  const { repo } = context;
  if (!pending || pending.repo !== repo.name) return frame(context, 'remote', box({ body: blankslate({ icon: 'check', title: S.remote.nothingToResolve, action: button({ label: S.repoSettings.remote, href: repoHref(repo, 'settings', 'remote') }) }) }));
  const { result, address, ref } = pending;
  const note = el('div', {});
  const controls = result.details.map((detail) => {
    if (detail.kind === 'text' && detail.marked) {
      const area = textArea({ code: true, rows: 16, 'aria-label': S.remote.resolveIn(detail.path), spellcheck: 'false' });
      area.value = decode(detail.marked);
      return { detail, node: area, read: () => ({ content: new TextEncoder().encode(area.value) }) };
    }
    const choice = el('select', { class: 'select', 'aria-label': S.remote.whichVersion(detail.path) }, el('option', { value: 'ours' }, S.remote.keepYours), el('option', { value: 'theirs' }, S.remote.keepIncoming));
    return { detail, node: choice, read: () => ({ take: choice.value }) };
  });
  const form = el('form', { class: 'stack', onsubmit: async (event) => {
    event.preventDefault();
    try {
      const paths = new Map(controls.map(({ detail, read }) => [detail.path, read()]));
      const outcome = await fetchFrom(repo, ref, address, profile(), () => {}, { against: result.against, paths });
      if (outcome.outcome === 'conflict') { pending = { ...pending, result: outcome }; refresh(); return; }
      pending = null;
      await setRepo({ ...repo, replica: address });
      navigate(repoPath(repo, 'commit', outcome.head));
    } catch (error) { note.replaceChildren(flash('error', /markers are still in/.test(error.message) ? S.remote.markersLeft(error.message.split(' in ').pop()) : /changed again/.test(error.message) ? S.remote.movedOn : remoteProblem(error))); }
  } }, controls.map(({ detail, node }) => el('div', { class: 'box' }, el('div', { class: 'box-head' }, el('strong', { class: 'mono' }, detail.path), el('span', { class: 'muted small' }, S.remote.sides(detail.ours, detail.theirs))),
    el('div', { class: 'box-body stack condensed' }, detail.kind === 'text' && detail.marked ? el('p', { class: 'muted small' }, S.remote.markersHint) : '', node))),
  el('div', {}, button({ label: S.remote.commitMerge, kind: 'primary', type: 'submit' })));
  return frame(context, 'remote', el('h2', { class: 'page-title' }, S.remote.resolveTitle(result.details.length)), note, form);
}
void relativeTime;
