// The repeated parts every screen is built from. Each function returns a DOM node.
// Text reaches the page only through textContent; nothing here parses a string as HTML.

import { ICONS } from './icons.js';
import { S } from './strings.js';

const SVG = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false && child !== '') node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

// An Octicon. Decorative unless given a label, in which case it is announced by that name.
export function icon(name, { label, size = 16, class: extra } = {}) {
  const paths = ICONS[name];
  if (!paths) throw new Error(`no icon named ${name}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `icon${extra ? ` ${extra}` : ''}`);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  for (const path of paths) {
    const node = document.createElementNS(SVG, 'path');
    for (const [key, value] of Object.entries(typeof path === 'string' ? { d: path } : path)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

// The product's own mark: a plain square with a branch through it. Not an Octicon, and nobody else's logo.
export function mark(size = 32) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  const add = (tag, attrs) => { const node = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); svg.append(node); };
  add('rect', { x: 2, y: 2, width: 28, height: 28, rx: 7, fill: 'currentColor' });
  add('path', { d: 'M11 9v14M11 16h6a4 4 0 0 0 4-4V9', fill: 'none', stroke: 'var(--bgColor-default)', 'stroke-width': 2.5, 'stroke-linecap': 'round' });
  for (const [cx, cy] of [[11, 9], [11, 23], [21, 9]]) add('circle', { cx, cy, r: 2.6, fill: 'var(--bgColor-default)' });
  return svg;
}

const KINDS = { default: '', primary: ' btn-primary', danger: ' btn-danger', invisible: ' btn-invisible' };
const SIZES = { medium: '', small: ' btn-sm', large: ' btn-lg' };

// A button, or a link that looks like one when given href. An icon-only button must have a label for screen readers.
export function button({ label, kind = 'default', size = 'medium', icon: leading, trailing, href, onclick, type = 'button', disabled, pressed, iconOnly, block, count, attrs = {} }) {
  const cls = `btn${KINDS[kind]}${SIZES[size]}${iconOnly ? ' btn-icon' : ''}${block ? ' btn-block' : ''}`;
  const inner = [leading && icon(leading), iconOnly ? null : el('span', {}, label), count !== undefined && counter(count), trailing && icon(trailing)];
  const common = { class: cls, 'aria-label': iconOnly ? label : undefined, title: iconOnly ? label : undefined, onclick, ...attrs };
  if (href) return el('a', { ...common, href, 'aria-disabled': disabled ? 'true' : undefined }, inner);
  return el('button', { ...common, type, disabled, 'aria-pressed': pressed === undefined ? undefined : String(pressed) }, inner);
}

export const counter = (value) => el('span', { class: 'counter' }, value > 999 ? `${(value / 1000).toFixed(1)}k` : value);

// A plain outline label ("Public", "Latest"), toned by role.
export const label = (text, tone) => el('span', { class: `label${tone ? ` ${tone}` : ''}` }, text);

// An issue label in a colour its author chose. The colour is data; the text colour is picked for contrast.
export function issueLabel(text, hex) {
  const clean = /^#?[0-9a-f]{6}$/i.test(hex) ? hex.replace('#', '') : null;
  const node = el('span', { class: 'label issue' }, text);
  if (clean) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    node.classList.add(0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? 'on-light' : 'on-dark');
    node.style.setProperty('--ui-label', `#${clean}`);
  }
  return node;
}

const STATES = {
  issue: { open: ['issue-opened', S.common.opened], closed: ['issue-closed', S.common.closed], draft: ['issue-opened', S.common.draft] },
  pull: { open: ['git-pull-request', S.common.opened], closed: ['git-pull-request-closed', S.common.closed], merged: ['git-merge', S.common.merged], draft: ['git-pull-request-draft', S.common.draft] },
};
export function stateBadge(state, kind = 'issue', { small } = {}) {
  const [name, text] = STATES[kind][state];
  return el('span', { class: `state ${state}${small ? ' sm' : ''}` }, icon(name), text);
}
// The same state as a coloured icon alone, for list rows.
export function stateIcon(state, kind = 'issue') {
  const [name, text] = STATES[kind][state];
  return icon(name, { label: text, class: `fg-${state}` });
}

// A person or organisation. Without an image it shows initials on a colour derived from the name.
export function avatar(name, { size = 20, square, src } = {}) {
  const text = String(name || '?').trim();
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const initials = text.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => [...part][0].toUpperCase()).join('') || '?';
  const node = el('span', { class: `avatar c${hash % 8}${square ? ' square' : ''}`, role: 'img', 'aria-label': text }, src ? el('img', { src, alt: '' }) : initials);
  node.style.setProperty('--ui-avatar', `${size / 16}rem`);
  return node;
}

// The Verified badge. Trust details live behind it, so it is a button.
export const verifiedBadge = (onclick) => el('button', { type: 'button', class: 'label success verified', onclick }, S.common.verified);
export const unsynced = () => el('span', { class: 'unsynced' }, icon('dot-fill'), S.common.notPublished);

// items: [{ label, href, icon, count, current }]
export function tabs(items, { label: name, flush } = {}) {
  return el('nav', { class: `tabs${flush ? ' flush' : ''}`, 'aria-label': name },
    items.map((item) => el('a', { href: item.href, 'aria-current': item.current ? 'page' : undefined, 'data-key': item.key }, item.icon && icon(item.icon), el('span', {}, item.label), item.count !== undefined && counter(item.count))));
}
export function sideNav(items, { label: name } = {}) {
  return el('nav', { class: 'sidenav', 'aria-label': name }, items.map((item) => el('a', { href: item.href, 'aria-current': item.current ? 'page' : undefined }, item.icon && icon(item.icon), item.label)));
}
// parts: [{ label, href }]; the last one is the current location.
export function crumbs(parts) {
  return el('nav', { class: 'crumbs', 'aria-label': S.parts.breadcrumb }, parts.map((part, i) => [i > 0 && el('span', { class: 'sep', 'aria-hidden': 'true' }, '/'),
    i === parts.length - 1 ? el('span', { 'aria-current': 'page' }, part.label) : el('a', { href: part.href }, part.label)]));
}
export function segmented(options, value, onchange) {
  const node = el('div', { class: 'segmented', role: 'group' });
  const draw = (current) => node.replaceChildren(...options.map((option) => el('button', { type: 'button', 'aria-pressed': String(option.value === current), onclick: () => { draw(option.value); onchange(option.value); } }, option.label)));
  draw(value);
  return node;
}

// A dropdown. items: { label, href | onclick, icon, danger } | { heading } | 'divider'. Closing on Escape and outside clicks is handled once, in chrome.js.
export function menu({ label: text, icon: leading, iconOnly, kind = 'default', size = 'medium', align, items, trigger, attrs = {} }) {
  const summary = trigger || el('summary', { class: `btn${KINDS[kind]}${SIZES[size]}${iconOnly ? ' btn-menu-icon' : ''}`, 'aria-label': iconOnly ? text : undefined, title: iconOnly ? text : undefined, 'aria-haspopup': 'menu' },
    leading && icon(leading), iconOnly ? null : el('span', {}, text), icon('triangle-down'));
  const details = el('details', { class: `menu${align === 'end' ? ' end' : ''}`, ...attrs }, summary);
  details.append(el('ul', { class: 'menu-list', role: 'menu' }, items.map((item) => {
    if (item === 'divider') return el('li', { class: 'divider', role: 'separator' });
    if (item.heading) return el('li', { class: 'heading', role: 'presentation' }, item.heading);
    const inner = [item.icon && icon(item.icon), item.label];
    const close = () => { details.open = false; };
    return el('li', { role: 'none' }, item.href
      ? el('a', { href: item.href, role: 'menuitem', class: item.danger ? 'danger' : '', onclick: close }, inner)
      : el('button', { type: 'button', role: 'menuitem', class: item.danger ? 'danger' : '', onclick: () => { close(); item.onclick(); } }, inner));
  })));
  return details;
}

// A modal dialog. Returns the element; call .showModal(). Escape and the close button dismiss it; focus returns to the opener.
export function dialog({ title, body, footer, wide }) {
  const node = el('dialog', { class: `dialog${wide ? ' wide' : ''}`, 'aria-label': title });
  node.append(
    el('div', { class: 'dialog-head' }, el('h2', {}, title), button({ label: S.common.close, icon: 'x', iconOnly: true, kind: 'invisible', onclick: () => node.close() })),
    el('div', { class: 'dialog-body' }, body),
    footer ? el('div', { class: 'dialog-foot' }, footer) : '');
  node.addEventListener('click', (event) => { if (event.target === node) node.close(); });
  node.addEventListener('close', () => node.remove());
  document.body.append(node);
  return node;
}

const FLASH_ICON = { info: 'info', success: 'check-circle', warning: 'alert', error: 'stop' };
// A message at the top of a screen. Errors are announced at once; the rest politely.
export function flash(tone, content, { onDismiss } = {}) {
  const node = el('div', { class: `flash${tone === 'info' ? '' : ` ${tone}`}`, role: tone === 'error' ? 'alert' : 'status' }, icon(FLASH_ICON[tone]), el('div', { class: 'body' }, content));
  if (onDismiss) node.append(button({ label: S.common.close, icon: 'x', iconOnly: true, kind: 'invisible', size: 'small', onclick: () => { node.remove(); onDismiss(); } }));
  return node;
}

// An empty state: one line and one action.
export const blankslate = ({ icon: name, title, text, action }) => el('div', { class: 'blankslate' }, name && icon(name, { size: 24 }), el('h3', {}, title), text && el('p', { class: 'muted' }, text), action);

export function pagination({ page, pages, href }) {
  if (pages <= 1) return '';
  const link = (n, content, extra = {}) => (n < 1 || n > pages ? el('span', { 'aria-disabled': 'true' }, content) : el('a', { href: href(n), ...extra }, content));
  const shown = [...new Set([1, 2, page - 1, page, page + 1, pages - 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const numbers = [];
  shown.forEach((n, i) => { if (i && n - shown[i - 1] > 1) numbers.push(el('span', { 'aria-hidden': 'true' }, '…')); numbers.push(n === page ? el('span', { 'aria-current': 'page' }, n) : link(n, n, { 'aria-label': S.parts.page(n) })); });
  return el('nav', { class: 'pagination', 'aria-label': S.common.pagination }, link(page - 1, [icon('chevron-left'), S.common.previous], { rel: 'prev' }), numbers, link(page + 1, [S.common.next, icon('chevron-right')], { rel: 'next' }));
}

export const box = ({ head, body, rows, class: extra } = {}) => el('div', { class: `box${extra ? ` ${extra}` : ''}` }, head && el('div', { class: 'box-head' }, head), body && el('div', { class: 'box-body' }, body), rows);
export const boxRow = ({ lead, title, href, meta, aside }) => el('div', { class: 'box-row' }, lead, el('div', { class: 'main' }, href ? el('a', { class: 'title', href }, title) : el('span', { class: 'title' }, title), meta && el('div', { class: 'meta' }, meta)), aside && el('div', { class: 'aside' }, aside));

let fieldId = 0;
// A labelled control with an optional hint. setError puts the message under the field, marks it invalid and ties the two together for screen readers.
export function field({ label: text, hint, control, optional }) {
  fieldId += 1;
  const id = control.id || `field-${fieldId}`;
  control.id = id;
  const hintNode = hint ? el('span', { class: 'hint', id: `${id}-hint` }, hint) : null;
  const errorNode = el('span', { class: 'error', id: `${id}-error`, role: 'alert', hidden: true });
  const describe = () => control.setAttribute('aria-describedby', [hintNode && hintNode.id, !errorNode.hidden && errorNode.id].filter(Boolean).join(' '));
  describe();
  const node = el('div', { class: 'field' }, el('label', { for: id }, text, optional && el('span', { class: 'muted' }, ` ${optional}`)), control, hintNode, errorNode);
  node.setError = (message) => {
    errorNode.hidden = !message;
    errorNode.replaceChildren(...(message ? [icon('alert'), message] : []));
    if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
    describe();
  };
  node.control = control;
  return node;
}
export const textInput = (attrs = {}) => el('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', ...attrs });
export const textArea = (attrs = {}) => el('textarea', { class: `textarea${attrs.code ? ' code' : ''}`, ...attrs, code: undefined });
// Show every error at its field and move focus to the first one. Returns true when there were none.
export function validate(checks) {
  let first = null;
  for (const [fieldNode, message] of checks) { fieldNode.setError(message || ''); if (message && !first) first = fieldNode; }
  if (first) first.control.focus();
  return !first;
}

// rows: [{ name, href, dir, message, messageHref, when }]
export function fileTable(rows) {
  return el('table', { class: 'file-table' }, el('tbody', {}, rows.map((row) => el('tr', {},
    el('td', { class: 'name' }, icon(row.dir ? 'file-directory-fill' : 'file', { label: row.dir ? S.parts.directory : S.parts.file, class: row.dir ? 'dir' : '' }), el('a', { href: row.href }, row.name)),
    el('td', { class: 'message' }, row.messageHref ? el('a', { href: row.messageHref }, row.message) : row.message),
    el('td', { class: 'age' }, row.when)))));
}
export const commitRow = ({ title, href, author, when, sha, shaHref, verified, onVerified }) => boxRow({
  title, href, meta: el('span', { class: 'row' }, avatar(author), el('strong', {}, author), ' ', S.parts.committed, ' ', when),
  aside: [verified && verifiedBadge(onVerified), el('a', { class: 'sha', href: shaHref }, sha)],
});
// lines: [{ op: ' ' | '+' | '-' | '@', a, b, text }]
export function diffTable(lines) {
  return el('table', { class: 'diff' }, el('tbody', {}, lines.map((line) => el('tr', { class: { '+': 'add', '-': 'del', '@': 'hunk' }[line.op] || '' },
    el('td', { class: 'num' }, line.a ?? ''), el('td', { class: 'num' }, line.b ?? ''), el('td', {}, line.op === '@' ? line.text : `${line.op}${line.text}`)))));
}
export function diffstat(added, removed) {
  const total = added + removed;
  const squares = total ? Math.round((added / total) * 5) : 0;
  return el('span', { class: 'diffstat' }, el('span', { class: 'fg-success' }, `+${added}`), el('span', { class: 'fg-danger' }, `−${removed}`),
    el('span', { 'aria-hidden': 'true' }, Array.from({ length: 5 }, (_, i) => el('i', { class: !total ? '' : i < squares ? 'a' : 'd' }))));
}

export const timeline = (...items) => el('div', { class: 'timeline' }, items);
export const timelineItem = ({ icon: name, tone, content }) => el('div', { class: 'timeline-item' }, el('span', { class: `badge${tone ? ` ${tone}` : ''}` }, icon(name)), el('div', {}, content));
export const comment = ({ author, when, body, badge }) => el('div', { class: 'box comment' }, el('div', { class: 'box-head' }, avatar(author), el('strong', {}, author), ' ', S.parts.commented, ' ', when, el('span', { class: 'spacer' }), badge && label(badge)), el('div', { class: 'box-body' }, body));

// Write and Preview. `render` turns the text into nodes for the preview; until Markdown lands it shows the text as written.
export function commentBox({ placeholder = S.parts.leaveComment, submit = S.parts.comment, onsubmit, render = (text) => el('p', { class: text ? '' : 'muted' }, text || S.parts.nothingToPreview) }) {
  const area = textArea({ placeholder, 'aria-label': placeholder, rows: 5 });
  const preview = el('div', { class: 'preview', hidden: true });
  const body = el('div', { class: 'body' }, area, preview);
  let mode = 'write';
  const tab = (key, text) => el('a', { href: '#', role: 'tab', 'aria-current': mode === key ? 'page' : undefined, onclick: (event) => { event.preventDefault(); mode = key; draw(); } }, text);
  const head = el('div', { class: 'box-head' });
  const send = () => { if (area.value.trim()) { onsubmit(area.value); area.value = ''; } else area.focus(); };
  function draw() {
    head.replaceChildren(el('nav', { class: 'tabs flush', role: 'tablist' }, tab('write', S.parts.write), tab('preview', S.parts.preview)));
    area.hidden = mode !== 'write';
    preview.hidden = mode !== 'preview';
    if (mode === 'preview') preview.replaceChildren(render(area.value));
  }
  draw();
  area.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } });
  return el('div', { class: 'box comment-box' }, head, body, el('div', { class: 'foot' }, button({ label: submit, kind: 'primary', onclick: send })));
}

// counts: one number per day, oldest first. Levels are quartiles of the largest day.
export function heatmap(counts, { label: name = S.parts.contributions } = {}) {
  const max = Math.max(1, ...counts);
  return el('div', { class: 'heatmap', role: 'img', 'aria-label': S.parts.heatmap(name, counts.reduce((a, b) => a + b, 0), counts.length) },
    counts.map((n) => el('i', { 'data-level': n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)), title: `${n}` })));
}

const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
// "3 days ago", with the full date as a tooltip.
export function relativeTime(ms, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  const unit = UNITS.find(([, size]) => seconds >= size);
  const text = !unit ? S.parts.justNow : S.parts.ago(Math.floor(seconds / unit[1]), unit[0]);
  return el('time', { datetime: new Date(ms).toISOString(), title: new Date(ms).toLocaleString() }, text);
}
