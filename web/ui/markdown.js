// Markdown to DOM nodes. Nothing is ever parsed as HTML: every node is created here and every piece of
// text goes in as text, so a document cannot inject markup or script. Raw HTML in the source is shown as text.
//
// Covered: headings, paragraphs, emphasis, strikethrough, inline code, fenced and indented code, block
// quotes, alerts, ordered and unordered lists with nesting, task lists, tables, rules, links, images,
// automatic links, hard breaks. Not covered yet: footnotes, emoji codes, mentions and issue references,
// syntax highlighting, diagrams and math.

import { el, icon } from './components.js';

const ALERTS = { NOTE: ['info', 'accent'], TIP: ['check-circle', 'success'], IMPORTANT: ['comment', 'done'], WARNING: ['alert', 'attention'], CAUTION: ['stop', 'danger'] };
const slugify = (text) => text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

// options.link(target) -> an address or null; options.image(target) -> a promise of an address or null.
export function renderMarkdown(source, options = {}) {
  const link = options.link || ((target) => (/^(https?:|mailto:|#)/i.test(target) ? target : null));
  const image = options.image || (async () => null);
  const used = new Map();

  function inline(text) {
    const out = [];
    let plain = '';
    const flush = () => { if (plain) { out.push(plain); plain = ''; } };
    let i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      let m;
      if (rest[0] === '\\' && /[\\`*_{}[\]()#+\-.!|<>~]/.test(rest[1] || '')) { plain += rest[1]; i += 2; continue; }
      if ((m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) { flush(); out.push(el('code', {}, m[2].replace(/^ (.+) $/, '$1'))); i += m[0].length; continue; }
      if ((m = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flush();
        const holder = el('span', { class: 'md-image' }, m[1]);
        image(m[2]).then((src) => { if (src) holder.replaceChildren(el('img', { src, alt: m[1] })); else { const to = link(m[2]); holder.replaceChildren(to ? el('a', { href: to, rel: 'noopener noreferrer' }, m[1] || m[2]) : m[1]); } });
        out.push(holder); i += m[0].length; continue;
      }
      if ((m = /^\[((?:[^\[\]]|\[[^\]]*\])+)\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
        flush();
        const to = link(m[2]);
        out.push(to ? el('a', { href: to, rel: /^https?:/i.test(to) ? 'noopener noreferrer' : undefined }, inline(m[1])) : el('span', {}, inline(m[1])));
        i += m[0].length; continue;
      }
      if ((m = /^<(https?:\/\/[^\s<>]+)>/.exec(rest)) || ((i === 0 || /[\s(]/.test(text[i - 1])) && (m = /^(https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"])/.exec(rest)))) {
        flush(); out.push(el('a', { href: m[1], rel: 'noopener noreferrer' }, m[1])); i += m[0].length; continue;
      }
      // #12 is a link to issue or pull request 12, where the caller says where that is.
      if (options.reference && (i === 0 || /[\s(]/.test(text[i - 1])) && (m = /^#(\d{1,9})\b/.exec(rest))) { flush(); out.push(el('a', { href: options.reference(m[1]) }, m[0])); i += m[0].length; continue; }
      if ((m = /^(\*\*|__)(?=\S)([\s\S]+?\S)\1/.exec(rest))) { flush(); out.push(el('strong', {}, inline(m[2]))); i += m[0].length; continue; }
      if ((m = /^~~(?=\S)([\s\S]+?\S)~~/.exec(rest))) { flush(); out.push(el('del', {}, inline(m[1]))); i += m[0].length; continue; }
      if ((m = /^\*(?=\S)([\s\S]+?\S)\*(?!\*)/.exec(rest)) || ((i === 0 || /\W/.test(text[i - 1])) && (m = /^_(?=\S)([\s\S]+?\S)_(?!\w)/.exec(rest)))) { flush(); out.push(el('em', {}, inline(m[1]))); i += m[0].length; continue; }
      if ((m = /^( {2,}|\\)\n/.exec(rest))) { flush(); out.push(el('br')); i += m[0].length; continue; }
      plain += rest[0]; i += 1;
    }
    flush();
    return out;
  }

  function heading(level, text) {
    let id = slugify(text.replace(/[`*_~[\]()]/g, ''));
    const seen = used.get(id) || 0;
    used.set(id, seen + 1);
    if (seen) id = `${id}-${seen}`;
    return el(`h${level}`, { id: id || undefined }, inline(text));
  }

  const row = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

  function blocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) { i += 1; continue; }
      if ((m = /^ {0,3}(```+|~~~+)\s*([^\s`]*)/.exec(line))) {
        const body = [];
        i += 1;
        while (i < lines.length && !new RegExp(`^ {0,3}${m[1][0]}{${m[1].length},}\\s*$`).test(lines[i])) { body.push(lines[i]); i += 1; }
        i += 1;
        out.push(el('pre', { 'data-lang': m[2] || undefined }, el('code', {}, body.join('\n'))));
        continue;
      }
      if ((m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { out.push(heading(m[1].length, m[2])); i += 1; continue; }
      if (/^ {0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) { out.push(el('hr')); i += 1; continue; }
      if (/^ {0,3}>/.test(line)) {
        const body = [];
        while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() && body.length && !/^ {0,3}(#{1,6}\s|```|~~~|[-*+]\s|\d+[.)]\s)/.test(lines[i])))) { body.push(lines[i].replace(/^ {0,3}> ?/, '')); i += 1; }
        const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/.exec(body[0] || '');
        if (alert) {
          const [name, tone] = ALERTS[alert[1]];
          out.push(el('div', { class: `md-alert ${tone}` }, el('p', { class: 'md-alert-title' }, icon(name), alert[1][0] + alert[1].slice(1).toLowerCase()), blocks(body.slice(1))));
        } else out.push(el('blockquote', {}, blocks(body)));
        continue;
      }
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const head = row(line);
        const align = row(lines[i + 1]).map((cell) => (/^:-+:$/.test(cell) ? 'center' : /-+:$/.test(cell) ? 'right' : null));
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].trim() && /\|/.test(lines[i])) { body.push(row(lines[i])); i += 1; }
        const cell = (tag, text, at) => el(tag, { class: align[at] ? `md-${align[at]}` : undefined }, inline(text || ''));
        out.push(el('div', { class: 'md-table' }, el('table', {}, el('thead', {}, el('tr', {}, head.map((text, at) => cell('th', text, at)))), el('tbody', {}, body.map((cells) => el('tr', {}, head.map((_, at) => cell('td', cells[at], at))))))));
        continue;
      }
      if ((m = ITEM.exec(line)) && m[1].length < 4) {
        const ordered = /\d/.test(m[2]);
        const indent = m[1].length;
        const items = [];
        while (i < lines.length) {
          const next = ITEM.exec(lines[i]);
          if (next && next[1].length <= indent + 1 && /\d/.test(next[2]) === ordered) { items.push([next[3]]); i += 1; continue; }
          if (!items.length) break;
          if (!lines[i].trim()) { if (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || ITEM.test(lines[i + 1]))) { items[items.length - 1].push(''); i += 1; continue; } break; }
          if (/^\s+\S/.test(lines[i]) || (next && next[1].length > indent)) { items[items.length - 1].push(lines[i].replace(new RegExp(`^\\s{0,${indent + m[2].length + 1}}`), '')); i += 1; continue; }
          if (next) break;
          items[items.length - 1].push(lines[i].trim()); i += 1;
        }
        let tasks = false;
        const nodes = items.map((body) => {
          const task = /^\[([ xX])\]\s+(.*)$/.exec(body[0]);
          if (task) { tasks = true; body[0] = task[2]; }
          const inner = blocks(body);
          // A list item that is one paragraph reads as a line, not a block.
          const content = inner.length && inner[0].tagName === 'P' ? [...inner[0].childNodes, ...inner.slice(1)] : inner;
          return el('li', { class: task ? 'md-task' : undefined }, task && el('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' }), content);
        });
        const start = ordered ? Number(m[2].replace(/\D/g, '')) : 1;
        out.push(el(ordered ? 'ol' : 'ul', { class: tasks ? 'md-tasks' : undefined, start: ordered && start !== 1 ? start : undefined }, nodes));
        continue;
      }
      if (/^( {4}|\t)/.test(line)) {
        const body = [];
        while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) { body.push(lines[i].replace(/^( {4}|\t)/, '')); i += 1; }
        out.push(el('pre', {}, el('code', {}, body.join('\n').replace(/\n+$/, ''))));
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^ {0,3}(#{1,6}\s|```|~~~|>)/.test(lines[i]) && !(para.length && ITEM.test(lines[i]) && ITEM.exec(lines[i])[1].length < 4 && !/^\s*\d{2,}/.test(lines[i]))) {
        if (para.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i])) { const level = lines[i].trim()[0] === '=' ? 1 : 2; out.push(heading(level, para.join(' '))); para.length = 0; i += 1; break; }
        para.push(lines[i].replace(/^\s+/, '')); i += 1;
      }
      if (para.length) out.push(el('p', {}, inline(para.join('\n'))));
    }
    return out;
  }

  return el('div', { class: 'markdown' }, blocks(String(source).replace(/\r\n?/g, '\n').split('\n')));
}
