// Every component on one page, for review. The sample text below is demonstration content, not interface
// wording, so it lives here and not in strings.js.

import { S } from './strings.js';
import { ICONS } from './icons.js';
import * as c from './components.js';
import { headerNode } from './chrome.js';
import { href } from './router.js';

const { el } = c;
const DAY = 86400000;

export function gallery() {
  const section = (title, ...children) => el('section', { 'data-part': title }, el('h2', {}, title), el('div', { class: 'stack' }, children));
  const now = Date.now();
  const here = href('/-/gallery');

  const name = c.field({ label: 'Repository name', hint: 'Short and memorable.', control: c.textInput({ value: 'hello-world' }) });
  const broken = c.field({ label: 'Title', control: c.textInput({}) });
  broken.setError("Title can't be blank");
  const openDialog = () => c.dialog({ title: 'Delete branch', body: el('p', {}, 'This removes fix-padding. Its commits stay reachable from the merged pull request.'),
    footer: [c.button({ label: S.common.cancel, onclick: (event) => event.currentTarget.closest('dialog').close() }), c.button({ label: 'Delete branch', kind: 'danger', onclick: (event) => event.currentTarget.closest('dialog').close() })] }).showModal();
  const days = Array.from({ length: 26 * 7 }, (_, i) => [0, 0, 1, 0, 3, 7, 2, 0, 12, 4, 0, 1, 5][(i * 7 + (i % 11)) % 13]);

  const main = document.getElementById('main');
  main.className = 'page gallery';
  main.replaceChildren(
    el('div', { class: 'page-head' }, el('h1', { class: 'page-title' }, S.gallery.title)), el('p', { class: 'muted' }, S.gallery.lead),
    section(S.gallery.header, el('div', { class: 'box' }, headerNode({ user: { name: 'Ada Example' } }))),
    section(S.gallery.buttons,
      el('div', { class: 'row' }, c.button({ label: 'Default' }), c.button({ label: 'Primary', kind: 'primary' }), c.button({ label: 'Danger', kind: 'danger' }), c.button({ label: 'Invisible', kind: 'invisible' }), c.button({ label: 'Disabled', disabled: true }), c.button({ label: 'Primary disabled', kind: 'primary', disabled: true })),
      el('div', { class: 'row' }, c.button({ label: 'Small', size: 'small' }), c.button({ label: 'Medium' }), c.button({ label: 'Large', size: 'large' }), c.button({ label: 'Code', kind: 'primary', icon: 'code', trailing: 'triangle-down' }), c.button({ label: 'Star', icon: 'star', count: 42 }), c.button({ label: 'Settings', icon: 'gear', iconOnly: true }),
        el('span', { class: 'btn-group' }, c.button({ label: 'Watch', icon: 'eye', count: 3 }), c.button({ label: 'More', icon: 'triangle-down', iconOnly: true })), c.segmented([{ value: 'unified', label: 'Unified' }, { value: 'split', label: 'Split' }], 'unified', () => {}))),
    section(S.gallery.fields, el('div', { class: 'stack', role: 'group' }, name, broken,
      c.field({ label: 'Description', optional: '(optional)', control: c.textArea({ rows: 3 }) }),
      el('div', { class: 'choice' }, el('input', { type: 'checkbox', id: 'g-check', checked: true }), el('label', { for: 'g-check' }, 'Add a README file')))),
    section(S.gallery.small,
      el('div', { class: 'row' }, c.stateBadge('open'), c.stateBadge('closed'), c.stateBadge('open', 'pull'), c.stateBadge('merged', 'pull'), c.stateBadge('closed', 'pull'), c.stateBadge('draft', 'pull'), c.stateBadge('merged', 'pull', { small: true })),
      el('div', { class: 'row' }, c.label('Public'), c.label('Latest', 'success'), c.label('Pre-release', 'attention'), c.label('Archived', 'danger'), c.label('Owner', 'accent'), c.issueLabel('bug', '#d73a4a'), c.issueLabel('enhancement', '#a2eeef'), c.issueLabel('question', '#d876e3'), c.issueLabel('good first issue', '#7057ff'), c.verifiedBadge(() => {}), c.unsynced()),
      el('div', { class: 'row' }, c.counter(3), c.counter(128), c.counter(1900), c.avatar('Ada Example'), c.avatar('Grace Hopper', { size: 24 }), c.avatar('lin', { size: 32 }), c.avatar('Acme', { size: 40, square: true }), c.stateIcon('open'), c.stateIcon('closed'), c.stateIcon('merged', 'pull'), c.diffstat(12, 3), c.relativeTime(now - 3 * DAY))),
    section(S.gallery.tabs,
      el('div', { class: 'repo-head box' }, el('div', { class: 'title' }, c.icon('repo', { class: 'fg-muted' }), el('a', { href: here }, 'ada'), el('span', { class: 'muted' }, '/'), el('a', { class: 'name', href: here }, 'hello-world'), c.label('Public'),
        el('span', { class: 'actions' }, c.button({ label: 'Watch', icon: 'eye', size: 'small', count: 3 }), c.button({ label: 'Fork', icon: 'repo-forked', size: 'small', count: 1 }), c.button({ label: 'Star', icon: 'star', size: 'small', count: 42 }))),
      c.tabs([{ label: 'Code', icon: 'code', href: here, current: true }, { label: 'Issues', icon: 'issue-opened', href: here, count: 2 }, { label: 'Pull requests', icon: 'git-pull-request', href: here, count: 1 }, { label: 'Actions', icon: 'play', href: here },
        { label: 'Packages', icon: 'package', href: here }, { label: 'Projects', icon: 'table', href: here }, { label: 'Releases', icon: 'tag', href: here }, { label: 'Wiki', icon: 'book', href: here }, { label: 'Activity', icon: 'graph', href: here }, { label: 'Settings', icon: 'gear', href: here }], { label: 'Repository (sample)' })),
      c.crumbs([{ label: 'hello-world', href: here }, { label: 'src', href: here }, { label: 'app.js' }]),
      el('div', { class: 'row' }, c.sideNav([{ label: 'General', icon: 'gear', href: here, current: true }, { label: 'Collaborators', icon: 'people', href: here }, { label: 'Branches', icon: 'git-branch', href: here }], { label: 'Settings (sample)' }))),
    section(S.gallery.menus, el('div', { class: 'row' },
      c.menu({ label: 'main', icon: 'git-branch', items: [{ heading: 'Switch branches or tags' }, { label: 'main', icon: 'check', onclick: () => {} }, { label: 'fix-padding', onclick: () => {} }, 'divider', { label: 'View all branches', href: here }] }),
      c.menu({ label: 'More options', icon: 'kebab-horizontal', iconOnly: true, kind: 'invisible', items: [{ label: 'Copy link', icon: 'link', onclick: () => {} }, { label: 'Edit', icon: 'pencil', onclick: () => {} }, 'divider', { label: 'Delete', icon: 'trash', danger: true, onclick: () => {} }] }),
      c.button({ label: 'Open dialog', onclick: openDialog, attrs: { 'data-open-dialog': '' } }))),
    section(S.gallery.messages, c.flash('info', 'A new version is available.'), c.flash('success', 'Profile updated.'), c.flash('warning', 'This branch is out-of-date with the base branch.'), c.flash('error', 'This branch is protected. Open a pull request.', { onDismiss: () => {} }),
      c.box({ body: c.blankslate({ icon: 'git-pull-request', title: 'No pull requests yet.', action: c.button({ label: 'New pull request', kind: 'primary' }) }) })),
    section(S.gallery.lists, c.box({ head: [el('strong', {}, '2 Open'), el('span', { class: 'muted' }, '1 Closed'), el('span', { class: 'spacer' }), c.menu({ label: 'Sort', kind: 'invisible', size: 'small', align: 'end', items: [{ label: 'Newest', icon: 'check', onclick: () => {} }, { label: 'Oldest', onclick: () => {} }] })],
      rows: [c.boxRow({ lead: c.stateIcon('open'), title: 'Formatting drops leading zeros', href: here, meta: ['#1 opened ', c.relativeTime(now - 2 * DAY), ' by ada ', c.issueLabel('bug', '#d73a4a')], aside: [c.icon('comment'), '2'] }),
        c.boxRow({ lead: c.stateIcon('open', 'pull'), title: 'Pad formatted values with zeros', href: here, meta: ['#4 opened ', c.relativeTime(now - DAY), ' by grace'], aside: c.avatar('Grace Hopper') }),
        c.boxRow({ lead: c.stateIcon('merged', 'pull'), title: 'Say how to run the tests', href: here, meta: ['#5 merged ', c.relativeTime(now - 5 * DAY)] })] }),
    c.pagination({ page: 4, pages: 12, href: () => here })),
    section(S.gallery.code, c.box({ head: [c.avatar('Ada Example'), el('strong', {}, 'ada'), el('span', { class: 'muted' }, 'Describe usage in the README'), el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, 'b3e83fb · '), c.relativeTime(now - 3600000), c.button({ label: '7 commits', icon: 'history', kind: 'invisible', size: 'small' })],
      rows: c.fileTable([{ name: 'docs', dir: true, href: here, message: 'Say how to run the tests', messageHref: here, when: c.relativeTime(now - 5 * DAY) }, { name: 'src', dir: true, href: here, message: 'Add formatting helpers', when: c.relativeTime(now - 9 * DAY) },
        { name: 'LICENSE', href: here, message: 'Initial commit', when: c.relativeTime(now - 30 * DAY) }, { name: 'README.md', href: here, message: 'Describe usage in the README', when: c.relativeTime(now - 3600000) }]) }),
    c.box({ rows: [c.commitRow({ title: 'Pad with zeros', href: here, author: 'Grace Hopper', when: c.relativeTime(now - DAY), sha: 'd93409f', shaHref: here, verified: true, onVerified: () => {} }), c.commitRow({ title: 'Add the guide', href: here, author: 'Ada Example', when: c.relativeTime(now - 9 * DAY), sha: '4a1c2e0', shaHref: here })] }),
    c.box({ head: [c.icon('chevron-down'), el('span', { class: 'mono' }, 'src/util/format.js'), el('span', { class: 'spacer' }), c.diffstat(2, 1)], rows: c.diffTable([{ op: '@', text: '@@ -1,4 +1,5 @@' }, { op: ' ', a: 1, b: 1, text: 'export const format1 = (v) => String(v).padStart(1);' },
      { op: '-', a: 2, text: 'export const format3 = (v) => String(v).padStart(3);' }, { op: '+', b: 2, text: "export const format3 = (v) => String(v).padStart(3, '0');" }, { op: '+', b: 3, text: 'export const formatAll = (list) => list.map(format3);' }, { op: ' ', a: 3, b: 4, text: '' }]) })),
    section(S.gallery.conversation, c.comment({ author: 'Ada Example', when: c.relativeTime(now - 2 * DAY), badge: 'Owner', body: el('p', {}, 'Steps to reproduce: call format3(7) and compare with the guide.') }),
      c.timeline(c.timelineItem({ icon: 'tag', content: [el('strong', {}, 'ada'), ' added the ', c.issueLabel('bug', '#d73a4a'), ' label ', c.relativeTime(now - 2 * DAY)] }),
        c.timelineItem({ icon: 'git-merge', tone: 'merged', content: [el('strong', {}, 'grace'), ' merged commit d93409f into main ', c.relativeTime(now - DAY)] }),
        c.timelineItem({ icon: 'issue-closed', tone: 'closed', content: [el('strong', {}, 'ada'), ' closed this as completed ', c.relativeTime(now - DAY)] })),
      c.commentBox({ onsubmit: () => {} })),
    section(S.gallery.heatmap, c.heatmap(days)),
    section(S.gallery.icons, el('div', { class: 'icons' }, Object.keys(ICONS).map((key) => el('div', {}, c.icon(key), key)))));
  return { title: S.gallery.title };
}
