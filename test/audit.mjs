// An accessibility audit that runs inside a page and returns what it found, as text.
//
// It is this project's own, written because the project takes no dependency for it. It checks what can
// be decided from the page as drawn, against WCAG 2.2 at level AA:
//   1.1.1  images and icons that carry meaning have a text alternative
//   1.3.1  form controls have labels; headings do not skip a level; one main region
//   1.4.3  text contrast: 4.5 to 1, or 3 to 1 for large text
//   2.4.2  the page has a title            2.4.6  one top heading per screen
//   2.5.8  targets are at least 24 by 24 px, links inside a sentence excepted
//   3.1.1  the language is declared
//   4.1.2  every control has a name; references between elements lead somewhere; no id is used twice
// It does not check focus order, focus visibility, what a screen reader says, the contrast of borders
// and icons, or anything that needs a person. Passing it is not an audit by a person.

export const AUDIT = `(() => {
  const out = [];
  const shown = (n) => { if (n.closest('[hidden]') || n.closest('details:not([open]) > :not(summary)') || n.closest('dialog:not([open])')) return false; const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const say = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\\s+/).join('.') : '') + ' "' + (n.innerText || n.getAttribute('aria-label') || n.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40) + '"';
  const byIds = (text) => text.split(/\\s+/).filter(Boolean).map((id) => document.getElementById(id));
  // If a dialog is open, only what is inside it can be reached.
  const modal = document.querySelector('dialog[open]');
  const scope = modal || document;

  const name = (n) => {
    const by = n.getAttribute('aria-labelledby');
    if (by) return byIds(by).map((x) => (x ? x.textContent : '')).join(' ').trim();
    if ((n.getAttribute('aria-label') || '').trim()) return n.getAttribute('aria-label').trim();
    if (n.matches('input, select, textarea')) {
      const label = (n.id && document.querySelector('label[for="' + CSS.escape(n.id) + '"]')) || n.closest('label');
      return ((label ? label.textContent : '') || n.getAttribute('title') || '').trim();
    }
    const inner = [...n.querySelectorAll('[aria-label], img[alt]')].map((x) => x.getAttribute('aria-label') || x.alt).join(' ');
    return ((n.textContent || '') + ' ' + inner + ' ' + (n.getAttribute('title') || '')).trim();
  };
  for (const n of scope.querySelectorAll('a[href], button, summary, input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], [role=tab]')) if (shown(n) && !name(n)) out.push('4.1.2 no name: ' + say(n));

  const ids = new Map();
  for (const n of document.querySelectorAll('[id]')) ids.set(n.id, (ids.get(n.id) || 0) + 1);
  for (const [id, count] of ids) if (count > 1) out.push('4.1.2 id used ' + count + ' times: ' + id);
  for (const attr of ['aria-describedby', 'aria-labelledby', 'aria-controls']) for (const n of document.querySelectorAll('[' + attr + ']')) if (byIds(n.getAttribute(attr)).some((x) => !x)) out.push('4.1.2 ' + attr + ' leads nowhere: ' + say(n));
  for (const n of document.querySelectorAll('label[for]')) if (!document.getElementById(n.getAttribute('for'))) out.push('1.3.1 label for nothing: ' + say(n));

  for (const n of scope.querySelectorAll('img')) if (!n.hasAttribute('alt')) out.push('1.1.1 image without alt: ' + say(n));
  for (const n of scope.querySelectorAll('[role=img]')) if (shown(n) && !(n.getAttribute('aria-label') || '').trim()) out.push('1.1.1 image role without a name: ' + say(n));
  for (const n of scope.querySelectorAll('svg')) if (!n.hasAttribute('aria-hidden') && !n.getAttribute('aria-label')) out.push('1.1.1 icon neither hidden nor named: ' + say(n.parentElement));

  if (!modal) {
    // Headings inside a document someone wrote (a README, a comment, a wiki page) are theirs, not the screen's.
    const heads = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((n) => shown(n) && !n.closest('.markdown'));
    const tops = heads.filter((n) => n.tagName === 'H1');
    if (tops.length !== 1) out.push('2.4.6 ' + tops.length + ' top headings: ' + tops.map(say).join(' | '));
    let last = 0;
    for (const n of heads) { const level = Number(n.tagName[1]); if (last && level > last + 1) out.push('1.3.1 heading skips from ' + last + ' to ' + level + ': ' + say(n)); last = level; }
    if (document.querySelectorAll('main').length !== 1) out.push('1.3.1 not exactly one main region');
    const navs = [...document.querySelectorAll('nav')].filter(shown);
    if (navs.length > 1) for (const n of navs) if (!n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby')) out.push('1.3.1 navigation without a name: ' + say(n));
    const names = navs.map((n) => n.getAttribute('aria-label')).filter(Boolean);
    for (const text of new Set(names)) if (names.filter((x) => x === text).length > 1) out.push('1.3.1 two navigations called ' + text);
  }
  if (!document.documentElement.lang) out.push('3.1.1 no language');
  if (!document.title.trim()) out.push('2.4.2 no title');

  const parse = (text) => { const m = /rgba?\\(([^)]+)\\)/.exec(text); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const behind = (n) => {
    const layers = [];
    for (let at = n; at; at = at.parentElement) { const c = parse(getComputedStyle(at).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; } }
    let color = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) color = over(layer, color);
    return color;
  };
  const light = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const seen = new Set();
  const walker = document.createTreeWalker(scope === document ? document.body : scope, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const n = text.parentElement;
    if (!text.nodeValue.trim() || seen.has(n) || !shown(n) || n.closest('[aria-disabled=true], :disabled, [aria-hidden=true], script, style')) continue;
    if (!modal && n.closest('dialog')) continue;
    seen.add(n);
    const s = getComputedStyle(n);
    if (Number(s.opacity) === 0) continue;
    const back = behind(n); const ink = parse(s.color);
    if (!ink) { out.push('1.4.3 colour not understood: ' + s.color + ' ' + say(n)); continue; }
    const fore = over(ink, back);
    const a = light(fore); const b = light(back);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(s.fontSize); const heavy = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && heavy) ? 3 : 4.5;
    if (ratio + 0.005 < need) out.push('1.4.3 contrast ' + ratio.toFixed(2) + ' under ' + need + ': ' + say(n));
  }

  // A target under 24 by 24 passes if a 24 px circle on its centre touches no other target (the spacing exception). Links inside a line of text are excepted.
  const targets = [...scope.querySelectorAll('a[href], button, summary, select, input, textarea, [role=button]')].filter((n) => shown(n) && !n.closest('[aria-disabled=true], :disabled')).map((n) => { const r = n.getBoundingClientRect(); return { n, r, x: r.left + r.width / 2, y: r.top + r.height / 2, small: r.width < 24 || r.height < 24 }; });
  for (const t of targets) {
    if (!t.small || t.n.matches('input, textarea')) continue;
    // Line numbers sit one to a line of code, and a line is 20 px high: their size is essential to what they are.
    if (t.n.closest('.code-lines td.num, .diff td.num')) continue;
    if (t.n.tagName === 'A' && getComputedStyle(t.n).display === 'inline' && t.n.parentElement.closest('p, li, td, dd, blockquote, .meta')) continue;
    const hit = targets.find((o) => { if (o === t || o.n.contains(t.n) || t.n.contains(o.n)) return false;
      if (o.small) return Math.hypot(o.x - t.x, o.y - t.y) < 24;
      const dx = Math.max(o.r.left - t.x, 0, t.x - o.r.right); const dy = Math.max(o.r.top - t.y, 0, t.y - o.r.bottom); return Math.hypot(dx, dy) < 12; });
    if (hit) out.push('2.5.8 target ' + Math.round(t.r.width) + ' by ' + Math.round(t.r.height) + ' too close to ' + say(hit.n) + ': ' + say(t.n));
  }
  return [...new Set(out)];
})()`;
