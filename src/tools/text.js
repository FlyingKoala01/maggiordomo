import { el, copyText, debounce, utf8Bytes, fmtBytes } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

const words = (s) => s
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .split(/[^A-Za-z0-9]+/)
  .filter(Boolean);

export const transforms = {
  upper: { label: 'UPPER', fn: (s) => s.toUpperCase() },
  lower: { label: 'lower', fn: (s) => s.toLowerCase() },
  title: { label: 'Title Case', fn: (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()) },
  sentence: { label: 'Sentence case', fn: (s) => s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase()) },
  camel: { label: 'camelCase', fn: (s) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') },
  pascal: { label: 'PascalCase', fn: (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('') },
  snake: { label: 'snake_case', fn: (s) => words(s).map((w) => w.toLowerCase()).join('_') },
  kebab: { label: 'kebab-case', fn: (s) => words(s).map((w) => w.toLowerCase()).join('-') },
  constant: { label: 'CONSTANT_CASE', fn: (s) => words(s).map((w) => w.toUpperCase()).join('_') },
  dot: { label: 'dot.case', fn: (s) => words(s).map((w) => w.toLowerCase()).join('.') },
  sortAsc: { label: 'Sort lines', fn: (s) => s.split('\n').sort((a, b) => a.localeCompare(b)).join('\n') },
  sortDesc: { label: 'Sort desc', fn: (s) => s.split('\n').sort((a, b) => b.localeCompare(a)).join('\n') },
  sortNum: { label: 'Sort numeric', fn: (s) => s.split('\n').sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)).join('\n') },
  unique: { label: 'Unique lines', fn: (s) => [...new Set(s.split('\n'))].join('\n') },
  reverseLines: { label: 'Reverse lines', fn: (s) => s.split('\n').reverse().join('\n') },
  shuffle: { label: 'Shuffle lines', fn: (s) => { const a = s.split('\n'); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.join('\n'); } },
  trim: { label: 'Trim lines', fn: (s) => s.split('\n').map((l) => l.trim()).join('\n') },
  noEmpty: { label: 'Remove empty lines', fn: (s) => s.split('\n').filter((l) => l.trim()).join('\n') },
  collapse: { label: 'Collapse whitespace', fn: (s) => s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') },
  number: { label: 'Number lines', fn: (s) => s.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') },
  reverse: { label: 'Reverse text', fn: (s) => [...s].reverse().join('') },
  slug: { label: 'Slugify', fn: (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') },
  jsonList: { label: 'Lines → JSON array', fn: (s) => JSON.stringify(s.split('\n').filter((l) => l.trim()), null, 2) },
  csvList: { label: 'Lines → comma list', fn: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).join(', ') },
  stripHtml: { label: 'Strip HTML', fn: (s) => new DOMParser().parseFromString(s, 'text/html').body.textContent || '' },
};

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';

export function lorem(paragraphs = 3, sentencesPer = 4) {
  const sentences = LOREM.split(/(?<=\.)\s+/);
  const out = [];
  let i = 0;
  for (let p = 0; p < paragraphs; p++) {
    const para = [];
    for (let s = 0; s < sentencesPer; s++) para.push(sentences[i++ % sentences.length]);
    out.push(para.join(' '));
  }
  return out.join('\n\n');
}

export default {
  id: 'text',
  name: 'Text',
  icon: 'Aa',
  hint: 'Case conversion, line operations, counts and lorem ipsum.',

  async mount(body) {
    const state = await loadToolState('text', { input: '' });
    const input = el('textarea', { class: 'mono', placeholder: 'Paste text…', style: { minHeight: '160px' } }, state.input);
    const output = el('textarea', { class: 'mono', readonly: true, placeholder: 'Result', style: { minHeight: '160px' } });
    const stats = el('div', { class: 'status' });

    const groups = [
      ['Case', ['upper', 'lower', 'title', 'sentence', 'camel', 'pascal', 'snake', 'kebab', 'constant', 'dot', 'slug']],
      ['Lines', ['sortAsc', 'sortDesc', 'sortNum', 'unique', 'reverseLines', 'shuffle', 'trim', 'noEmpty', 'collapse', 'number']],
      ['Other', ['reverse', 'jsonList', 'csvList', 'stripHtml']],
    ];

    const paras = el('input', { type: 'number', min: 1, max: 50, value: 3, style: { width: '70px' } });

    body.append(
      el('div', { class: 'split' },
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Input', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: () => { input.value = ''; onInput(); } }, 'Clear')), input),
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Output', el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn-sm', onclick: () => copyText(output.value) }, 'Copy'),
          el('button', { class: 'btn btn-sm', onclick: () => { input.value = output.value; onInput(); } }, '← Use as input')), output),
      ),
      stats,
      ...groups.map(([name, keys]) => el('div', { class: 'card' },
        el('h3', {}, name),
        el('div', { class: 'row' }, ...keys.map((k) => el('button', { class: 'btn btn-sm', onclick: () => apply(k) }, transforms[k].label))),
      )),
      el('div', { class: 'card' },
        el('h3', {}, 'Lorem ipsum'),
        el('div', { class: 'row' }, el('label', { class: 'inline' }, 'Paragraphs', paras), el('button', { class: 'btn btn-sm', onclick: () => { output.value = lorem(Number(paras.value) || 3); } }, 'Generate')),
      ),
    );

    function apply(key) {
      try {
        output.value = transforms[key].fn(input.value);
      } catch (err) {
        output.value = 'Error: ' + err.message;
      }
    }

    function updateStats() {
      const s = input.value;
      const lines = s ? s.split('\n').length : 0;
      const wordCount = (s.match(/\S+/g) || []).length;
      stats.textContent = `${s.length} chars · ${s.replace(/\s/g, '').length} non-space · ${wordCount} words · ${lines} lines · ${fmtBytes(utf8Bytes(s))} UTF-8`;
    }

    const onInput = debounce(() => { updateStats(); saveToolState('text', { input: input.value }); }, 150);
    input.addEventListener('input', onInput);
    updateStats();
    input.focus();
  },
};
