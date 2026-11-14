// The screens that exist in the rebuilt interface so far: landing, home, first run, new and open
// repository, settings, and the not-found and error screens. Repository screens are still the older
// ones (web/app.js) and are replaced phase by phase.

import { S } from './strings.js';
import { el, icon, button, field, textInput, validate, flash, blankslate, box, boxRow, sideNav, label, relativeTime } from './components.js';
import { href, navigate } from './router.js';
import { profile, setProfile, hasKey, createKey, keyId, signedIn, THEMES, theme, setTheme } from './session.js';
import { listRepos } from '../store.js';
import { clone, createRepo } from '../git.js';
import { repoHref, repoPath, ownerOf, slug } from './repo.js';

const main = () => document.getElementById('main');
function show(kind, ...children) {
  const node = main();
  node.className = `page${kind ? ` ${kind}` : ''}`;
  node.replaceChildren(...children.flat().filter(Boolean));
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const REPO = /^[A-Za-z0-9._-]+$/;

export async function home() {
  if (!(await signedIn())) {
    show('', el('div', { class: 'hero' }, el('h1', {}, S.landing.title), el('p', {}, S.landing.lead), button({ label: S.landing.action, kind: 'primary', size: 'large', href: href('/welcome') })));
    return { title: S.landing.title };
  }
  const repos = (await listRepos()).sort((a, b) => (b.cloned || 0) - (a.cloned || 0));
  const list = el('div', {});
  const filter = textInput({ type: 'search', placeholder: S.home.filter, 'aria-label': S.home.filter });
  const draw = () => {
    const wanted = filter.value.trim().toLowerCase();
    const shown = repos.filter((repo) => repo.name.toLowerCase().includes(wanted));
    if (!repos.length) list.replaceChildren(box({ body: blankslate({ icon: 'repo', title: S.home.empty, action: button({ label: S.home.emptyAction, kind: 'primary', href: href('/new') }) }) }));
    else if (!shown.length) list.replaceChildren(box({ body: blankslate({ icon: 'search', title: S.home.noMatch }) }));
    else list.replaceChildren(box({ rows: shown.map((repo) => boxRow({ lead: icon('repo', { class: 'fg-muted' }), title: `${ownerOf(repo)} / ${repo.name}`, href: repoHref(repo),
      meta: [repo.description && el('div', {}, repo.description), el('span', {}, S.home.updated(''), relativeTime(repo.cloned || Date.now()))], aside: repo.url ? '' : label(S.home.local) })) }));
  };
  filter.addEventListener('input', draw);
  draw();
  show('narrow', el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.home.title), el('span', { class: 'spacer' }),
    button({ label: S.home.open, icon: 'download', href: href('/open') }), button({ label: S.home.new, icon: 'repo', kind: 'primary', href: href('/new') })),
  el('div', { class: 'stack' }, repos.length ? filter : '', list));
  return { title: S.home.title };
}

// First run, three steps at most: a name, a sign-in key, a first repository.
export async function welcome({ query }) {
  const who = profile();
  const key = await hasKey();
  // The step follows from what exists, not from the address: no name yet, no key yet, or both.
  const step = !who.name || query.get('step') === '1' ? 1 : !key ? 2 : 3;
  const steps = el('ol', { class: 'steps', 'aria-label': S.welcome.progress }, S.welcome.steps.map((text, i) => el('li', { 'aria-current': i + 1 === step ? 'step' : undefined }, i + 1 < step ? icon('check', { class: 'fg-success' }) : el('span', {}, `${i + 1}.`), el('span', {}, text))));
  let body;
  if (step === 1) {
    const name = field({ label: S.welcome.name, control: textInput({ value: who.name, autocomplete: 'name', autofocus: true }) });
    const email = field({ label: S.welcome.email, hint: S.welcome.emailHint, control: textInput({ type: 'email', value: who.email, autocomplete: 'email' }) });
    body = el('form', { class: 'stack', novalidate: true, onsubmit: (event) => {
      event.preventDefault();
      const n = name.control.value.trim();
      const e = email.control.value.trim();
      if (!validate([[name, !n ? S.welcome.nameBlank : /[<>]/.test(n) ? S.welcome.nameChars : ''], [email, EMAIL.test(e) ? '' : S.welcome.emailInvalid]])) return;
      setProfile({ name: n, email: e });
      navigate('/welcome?step=2');
    } }, el('h1', { class: 'page-title' }, S.welcome.nameTitle), el('p', { class: 'muted' }, S.welcome.nameLead), name, email, el('div', {}, button({ label: S.common.continue, kind: 'primary', type: 'submit' })));
  } else if (step === 2) {
    const note = el('div', {});
    body = el('div', { class: 'stack' }, el('h1', { class: 'page-title' }, S.welcome.keyTitle), el('p', { class: 'muted' }, S.welcome.keyLead), flash('warning', S.welcome.keyWarn), note,
      el('div', {}, button({ label: S.welcome.createKey, icon: 'key', kind: 'primary', onclick: async (event) => {
        event.currentTarget.disabled = true;
        try { await createKey(); navigate('/welcome?step=3'); } catch { event.currentTarget.disabled = false; note.replaceChildren(flash('error', S.welcome.keyFailed)); }
      } })));
  } else {
    body = el('div', { class: 'stack' }, el('h1', { class: 'page-title' }, S.welcome.repoTitle), flash('success', S.welcome.keyReady),
      el('div', { class: 'row' }, button({ label: S.welcome.create, icon: 'repo', kind: 'primary', href: href('/new') }), button({ label: S.welcome.open, icon: 'download', href: href('/open') }), button({ label: S.welcome.later, kind: 'invisible', href: href('/') })));
  }
  show('form', el('div', { class: 'stack' }, steps, body));
  const focus = main().querySelector('[autofocus]');
  if (focus) focus.focus();
  return { title: S.welcome.title, user: true };
}

export async function newRepository() {
  if (!(await signedIn())) { navigate('/welcome', { replace: true }); return {}; }
  const name = field({ label: S.newRepo.name, hint: S.newRepo.nameHint, control: textInput({ autofocus: true, maxlength: 100 }) });
  const description = field({ label: S.newRepo.description, optional: S.newRepo.optional, control: textInput({ maxlength: 350 }) });
  const readme = el('input', { type: 'checkbox', id: 'readme', checked: true });
  const note = el('div', {});
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const value = name.control.value.trim();
    const taken = value && (await listRepos()).some((repo) => repo.name === value);
    if (!validate([[name, !value ? S.newRepo.nameBlank : !REPO.test(value) || value === '.' || value === '..' ? S.newRepo.nameInvalid : taken ? S.newRepo.nameTaken(value) : '']])) return;
    try {
      const repo = await createRepo({ name: value, description: description.control.value, readme: readme.checked, message: S.newRepo.initial, who: profile(), owner: slug(profile().name) });
      navigate(repoPath(repo));
    } catch { note.replaceChildren(flash('error', S.failed.lead)); }
  } }, el('div', {}, el('h1', { class: 'page-title' }, S.newRepo.title), el('p', { class: 'muted' }, S.newRepo.lead)), note, name, description,
  el('div', { class: 'choice' }, readme, el('div', {}, el('label', { for: 'readme' }, el('strong', {}, S.newRepo.readme)), el('div', { class: 'muted small' }, S.newRepo.readmeHint))),
  el('div', {}, button({ label: S.newRepo.create, kind: 'primary', type: 'submit' })));
  show('form', form);
  name.control.focus();
  return { title: S.newRepo.title };
}

export async function openRepository({ query }) {
  const address = field({ label: S.openRepo.address, control: textInput({ type: 'url', placeholder: S.openRepo.placeholder, value: query.get('address') || '', autofocus: true }) });
  const note = el('div', {});
  const submit = button({ label: S.openRepo.open, kind: 'primary', type: 'submit' });
  const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    const value = address.control.value.trim();
    if (!validate([[address, !value ? S.openRepo.addressBlank : !/^https?:\/\/\S+$/.test(value) ? S.openRepo.addressInvalid : '']])) return;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    note.replaceChildren();
    try {
      const repo = await clone(value);
      navigate(repoPath(repo));
    } catch {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      note.replaceChildren(flash('error', S.openRepo.failed(S.openRepo.unreachable)));
      address.control.focus();
    }
  } }, el('div', {}, el('h1', { class: 'page-title' }, S.openRepo.title), el('p', { class: 'muted' }, S.openRepo.lead)), note, address, el('div', {}, submit));
  show('form', form);
  address.control.focus();
  return { title: S.openRepo.title };
}

export async function settings({ params }) {
  if (!(await signedIn())) { navigate('/welcome', { replace: true }); return {}; }
  const tab = params.tab || 'profile';
  const nav = sideNav([['profile', S.settings.profile, 'person'], ['appearance', S.settings.appearance, 'sun'], ['security', S.settings.security, 'shield-check']]
    .map(([key, text, name]) => ({ label: text, icon: name, href: href(`/settings/${key}`), current: key === tab })), { label: S.settings.nav });
  let body;
  if (tab === 'profile') {
    const who = profile();
    const note = el('div', {});
    const name = field({ label: S.welcome.name, control: textInput({ value: who.name, autocomplete: 'name' }) });
    const email = field({ label: S.welcome.email, hint: S.welcome.emailHint, control: textInput({ type: 'email', value: who.email, autocomplete: 'email' }) });
    body = el('form', { class: 'stack', novalidate: true, onsubmit: (event) => {
      event.preventDefault();
      const n = name.control.value.trim();
      const e = email.control.value.trim();
      if (!validate([[name, !n ? S.welcome.nameBlank : /[<>]/.test(n) ? S.welcome.nameChars : ''], [email, EMAIL.test(e) ? '' : S.welcome.emailInvalid]])) return;
      setProfile({ name: n, email: e });
      note.replaceChildren(flash('success', S.settings.profileSaved));
      document.dispatchEvent(new CustomEvent('profilechange'));
    } }, el('h2', { class: 'page-title' }, S.settings.profile), note, name, email, el('div', {}, button({ label: S.settings.saveProfile, kind: 'primary', type: 'submit' })));
  } else if (tab === 'appearance') {
    const current = theme();
    body = el('div', { class: 'stack' }, el('h2', { class: 'page-title' }, S.settings.themeTitle), el('p', { class: 'muted' }, S.settings.themeLead),
      el('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': S.settings.themeTitle }, THEMES.map((key) => {
        const input = el('input', { type: 'radio', name: 'theme', value: key, checked: key === current, onchange: () => setTheme(key) });
        const card = el('label', { class: 'theme-card' }, el('span', { class: 'swatch', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')), el('span', { class: 'row' }, input, S.settings.themes[key]));
        if (key !== 'auto') card.querySelector('.swatch').dataset.theme = key;
        return card;
      })));
  } else if (tab === 'security') {
    const id = await keyId();
    body = el('div', { class: 'stack' }, el('h2', { class: 'page-title' }, S.settings.keyTitle), el('p', { class: 'muted' }, S.settings.keyLead),
      id ? el('div', { class: 'keyline', 'data-key': true }, id) : flash('warning', S.settings.noKey),
      id ? el('div', {}, button({ label: S.common.copy, icon: 'copy', onclick: async (event) => { const target = event.currentTarget; await navigator.clipboard.writeText(id); target.lastChild.textContent = S.common.copied; } })) : '');
  } else return notFoundPage();
  show('', el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.settings.title)), el('div', { class: 'settings' }, nav, body));
  return { title: `${S.settings[tab]} · ${S.settings.title}` };
}

export function notFoundPage() {
  show('', blankslate({ icon: 'search', title: S.notFound.title, text: S.notFound.lead, action: button({ label: S.notFound.action, kind: 'primary', href: href('/') }) }));
  return { title: S.notFound.title, status: 404 };
}

export function errorPage(error) {
  console.error(error);
  show('', blankslate({ icon: 'alert', title: S.failed.title, text: S.failed.lead, action: button({ label: S.failed.action, onclick: () => location.reload() }) }));
  return { title: S.failed.title };
}
