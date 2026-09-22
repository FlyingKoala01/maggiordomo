import { el, copyText, debounce, escapeHtml } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

const MAX_MATCHES = 2000;

export function findMatches(re, text) {
  const matches = [];
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = global.exec(text)) !== null) {
    matches.push({ index: m.index, text: m[0], groups: m.slice(1), named: m.groups || null });
    if (m[0] === '') global.lastIndex++;
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

export default {
  id: 'regex',
  name: 'Regex',
  icon: '/re/',
  hint: 'JavaScript regular expressions with live highlighting, groups and replace.',

  async mount(body) {
    const state = await loadToolState('regex', { pattern: '', flags: 'g', text: '', replace: '' });

    const pattern = el('input', { type: 'text', class: 'mono grow', placeholder: 'pattern', value: state.pattern, spellcheck: 'false' });
    const flagDefs = [['g', 'global'], ['i', 'ignore case'], ['m', 'multiline'], ['s', 'dot all'], ['u', 'unicode'], ['y', 'sticky']];
    const flagBoxes = flagDefs.map(([f, label]) => {
      const box = el('input', { type: 'checkbox', value: f });
      box.checked = state.flags.includes(f);
      return el('label', { class: 'inline', title: label }, box, f);
    });
    const text = el('textarea', { class: 'mono', placeholder: 'Test string', spellcheck: 'false' }, state.text);
    const highlight = el('div', { class: 'rx-highlight' });
    const replace = el('input', { type: 'text', class: 'mono grow', placeholder: 'replacement ($1, $<name>, $&)', value: state.replace, spellcheck: 'false' });
    const replaced = el('pre', { class: 'output mono', style: { minHeight: '60px' } });
    const status = el('div', { class: 'status' });
    const table = el('div');

    body.append(
      el('div', { class: 'row nowrap' }, el('span', { class: 'mono muted' }, '/'), pattern, el('span', { class: 'mono muted' }, '/'), el('div', { class: 'flags' }, ...flagBoxes)),
      status,
      el('div', { class: 'split' },
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Test string'), text),
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Matches'), highlight),
      ),
      el('div', { class: 'card col' },
        el('h3', {}, 'Replace'),
        el('div', { class: 'row' }, replace, el('button', { class: 'btn btn-sm', onclick: () => copyText(replaced.textContent) }, 'Copy result')),
        replaced,
      ),
      el('div', { class: 'card' }, el('h3', {}, 'Groups'), table),
      el('details', { class: 'help' }, el('summary', {}, 'Cheat sheet'),
        el('div', { class: 'wrap mono', style: { marginTop: '6px' } },
          '.  any char        \\d digit   \\w word   \\s whitespace   \\b word boundary\n' +
          '*  0+   +  1+   ?  0/1   {n,m} range   *? lazy\n' +
          '(x) group   (?<name>x) named   (?:x) non-capturing   x|y alternation\n' +
          '(?=x) lookahead   (?!x) negative   (?<=x) lookbehind   (?<!x) negative\n' +
          '^ start   $ end   [abc] set   [^abc] negated set   \\1 backreference',
        ),
      ),
    );

    function flags() {
      return flagBoxes.map((l) => l.firstChild).filter((b) => b.checked).map((b) => b.value).join('');
    }

    function run() {
      const src = pattern.value;
      const f = flags();
      saveToolState('regex', { pattern: src, flags: f, text: text.value, replace: replace.value });
      status.replaceChildren();
      table.replaceChildren();
      replaced.textContent = '';
      if (!src) {
        highlight.textContent = text.value;
        return;
      }
      let re;
      try {
        re = new RegExp(src, f);
      } catch (err) {
        status.append(el('span', { class: 'error' }, err.message));
        highlight.textContent = text.value;
        return;
      }
      const input = text.value;
      const matches = findMatches(re, input);
      status.append(
        el('span', { class: matches.length ? 'ok' : '' }, `${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''} match${matches.length === 1 ? '' : 'es'}`),
        !f.includes('g') && matches.length > 1 ? el('span', { class: 'muted' }, 'without the g flag only the first match is used by replace') : null,
      );

      // Highlight
      let html = '';
      let cursor = 0;
      for (const m of matches) {
        html += escapeHtml(input.slice(cursor, m.index));
        html += `<mark title="match at ${m.index}">${escapeHtml(m.text) || '<span class="muted">∅</span>'}</mark>`;
        cursor = m.index + m.text.length;
      }
      html += escapeHtml(input.slice(cursor));
      highlight.innerHTML = html;

      // Replace
      try {
        replaced.textContent = input.replace(re, replace.value);
      } catch (err) {
        replaced.textContent = 'Replace error: ' + err.message;
      }

      // Groups table
      if (!matches.length) return;
      const groupCount = matches[0].groups.length;
      const namedKeys = matches[0].named ? Object.keys(matches[0].named) : [];
      const head = el('tr', {}, el('th', {}, '#'), el('th', {}, 'Index'), el('th', {}, 'Match'),
        ...Array.from({ length: groupCount }, (_, i) => el('th', {}, namedKeys.find((k) => matches[0].named[k] === matches[0].groups[i]) ? `$${i + 1} ${namedKeys.find((k) => matches[0].named[k] === matches[0].groups[i])}` : `$${i + 1}`)));
      const rows = matches.slice(0, 500).map((m, i) => el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, String(m.index)),
        el('td', { class: 'mono copyable', onclick: () => copyText(m.text) }, m.text),
        ...m.groups.map((g) => el('td', { class: 'mono' }, g === undefined ? el('span', { class: 'muted' }, 'undefined') : g)),
      ));
      table.append(el('div', { style: { overflowX: 'auto' } }, el('table', { class: 'table' }, el('thead', {}, head), el('tbody', {}, ...rows))));
      if (matches.length > 500) table.append(el('div', { class: 'muted small' }, `Showing first 500 of ${matches.length}`));
    }

    const rerun = debounce(run, 120);
    pattern.addEventListener('input', rerun);
    text.addEventListener('input', rerun);
    replace.addEventListener('input', rerun);
    flagBoxes.forEach((l) => l.firstChild.addEventListener('change', run));

    run();
    pattern.focus();
  },
};
