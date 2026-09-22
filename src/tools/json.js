import { el, toast, copyText, download, debounce, enableTabIndent, highlightJson, fmtBytes, utf8Bytes, positionToLineCol } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

const SAMPLE = '{"name":"maggiordomo","version":"0.1.0","private":true,"tags":["dev","tools"],"author":{"name":"you","email":null},"stars":42,"ratio":0.75}';

export default {
  id: 'json',
  name: 'JSON',
  icon: '{ }',
  hint: 'Beautify, minify, validate, sort keys and browse as a tree.',
  fill: true,

  async mount(body) {
    const state = await loadToolState('json', { input: '', indent: '2', view: 'text', sortKeys: false });

    const input = el('textarea', { class: 'mono fill', spellcheck: 'false', placeholder: 'Paste JSON here…' }, state.input);
    enableTabIndent(input);
    const output = el('pre', { class: 'output mono', style: { flex: 1, minHeight: '200px' } });
    const tree = el('div', { class: 'json-tree card', style: { flex: 1, overflow: 'auto', minHeight: '200px' } });
    const status = el('div', { class: 'status' });

    const indent = el('select', { title: 'Indentation' },
      el('option', { value: '2' }, '2 spaces'),
      el('option', { value: '4' }, '4 spaces'),
      el('option', { value: '\t' }, 'Tabs'),
    );
    indent.value = state.indent;
    const sortKeys = el('input', { type: 'checkbox' });
    sortKeys.checked = !!state.sortKeys;
    const viewText = el('button', { class: 'btn btn-sm', onclick: () => setView('text') }, 'Text');
    const viewTree = el('button', { class: 'btn btn-sm', onclick: () => setView('tree') }, 'Tree');

    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn btn-primary', onclick: () => run('beautify') }, 'Beautify'),
      el('button', { class: 'btn', onclick: () => run('minify') }, 'Minify'),
      indent,
      el('label', { class: 'inline' }, sortKeys, 'Sort keys'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-sm', title: 'Wrap the JSON as an escaped string literal', onclick: () => run('escape') }, 'Escape'),
      el('button', { class: 'btn btn-sm', title: 'Parse a JSON string literal that contains JSON', onclick: () => run('unescape') }, 'Unescape'),
      el('button', { class: 'btn btn-sm', title: 'Try to repair loose input: single quotes, trailing commas, comments, unquoted keys', onclick: () => run('repair') }, 'Repair'),
      el('button', { class: 'btn btn-sm', onclick: () => { input.value = SAMPLE; onInput(); run('beautify'); } }, 'Sample'),
      el('button', { class: 'btn btn-sm', onclick: () => { input.value = ''; onInput(); } }, 'Clear'),
    );

    const outToolbar = el('div', { class: 'pane-title' },
      'Output',
      el('span', { class: 'spacer' }),
      viewText, viewTree,
      el('button', { class: 'btn btn-sm', title: 'Copy output', onclick: () => copyText(lastOutput, 'Output copied') }, 'Copy'),
      el('button', { class: 'btn btn-sm', title: 'Replace input with output', onclick: () => { input.value = lastOutput; onInput(); } }, '← Use as input'),
      el('button', { class: 'btn btn-sm', title: 'Download .json', onclick: () => download('data.json', lastOutput, 'application/json') }, '⇩'),
    );

    body.append(
      toolbar,
      el('div', { class: 'split', style: { flex: 1, minHeight: '300px' } },
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Input', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: paste }, 'Paste')), input),
        el('div', { class: 'pane' }, outToolbar, output, tree),
      ),
      status,
    );

    let lastOutput = '';
    let lastValue;
    let view = state.view;

    function setView(v) {
      view = v;
      viewText.classList.toggle('active', v === 'text');
      viewTree.classList.toggle('active', v === 'tree');
      output.classList.toggle('hidden', v !== 'text');
      tree.classList.toggle('hidden', v !== 'tree');
      saveToolState('json', { view: v });
      if (v === 'tree' && lastValue !== undefined) renderTree(lastValue);
    }

    async function paste() {
      try {
        input.value = await navigator.clipboard.readText();
        onInput();
        run('beautify');
      } catch {
        toast('Clipboard read not permitted', 'error');
      }
    }

    function parse(text) {
      try {
        return { value: JSON.parse(text) };
      } catch (err) {
        const m = /position (\d+)/.exec(err.message);
        const pos = m ? Number(m[1]) : null;
        const where = pos !== null ? positionToLineCol(text, pos) : null;
        return { error: err.message.replace(/ in JSON at position.*$/, ''), pos, where };
      }
    }

    function sortDeep(value) {
      if (Array.isArray(value)) return value.map(sortDeep);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortDeep(value[k])]));
      }
      return value;
    }

    function run(action) {
      const text = input.value.trim();
      if (!text) return setStatus('', null);
      let value;
      if (action === 'unescape') {
        const r = parse(text);
        if (r.error) return fail(r);
        if (typeof r.value !== 'string') return fail({ error: 'Input is not a JSON string literal' });
        const inner = parse(r.value);
        if (inner.error) return fail(inner);
        value = inner.value;
      } else if (action === 'escape') {
        const r = parse(text);
        if (r.error) return fail(r);
        setOutput(JSON.stringify(JSON.stringify(r.value)), r.value);
        return;
      } else if (action === 'repair') {
        const repaired = repair(text);
        const r = parse(repaired);
        if (r.error) return fail(r);
        value = r.value;
        toast('Repaired', 'ok');
      } else {
        const r = parse(text);
        if (r.error) return fail(r);
        value = r.value;
      }
      if (sortKeys.checked) value = sortDeep(value);
      const space = action === 'minify' ? undefined : indent.value === '\t' ? '\t' : Number(indent.value);
      setOutput(JSON.stringify(value, null, space), value);
    }

    function fail(r) {
      lastOutput = '';
      lastValue = undefined;
      output.textContent = '';
      tree.replaceChildren();
      setStatus(r.error, r.where, r.pos);
    }

    function setOutput(text, value) {
      lastOutput = text;
      lastValue = value;
      output.innerHTML = highlightJson(text);
      if (view === 'tree') renderTree(value);
      const info = describe(value);
      setStatus(null, null, null, `${fmtBytes(utf8Bytes(text))} · ${info}`);
    }

    function describe(value) {
      let keys = 0, depth = 0;
      (function walk(v, d) {
        depth = Math.max(depth, d);
        if (Array.isArray(v)) v.forEach((x) => walk(x, d + 1));
        else if (v && typeof v === 'object') { keys += Object.keys(v).length; Object.values(v).forEach((x) => walk(x, d + 1)); }
      })(value, 0);
      const kind = Array.isArray(value) ? `array[${value.length}]` : value === null ? 'null' : typeof value;
      return `${kind} · ${keys} keys · depth ${depth}`;
    }

    function setStatus(error, where, pos, ok) {
      status.replaceChildren();
      if (error) {
        status.append(el('span', { class: 'error' }, '✕ ', error, where ? ` (line ${where.line}, col ${where.col})` : ''));
        if (pos !== null && pos !== undefined) {
          status.append(el('button', { class: 'btn btn-sm', onclick: () => { input.focus(); input.setSelectionRange(pos, pos + 1); } }, 'Jump to error'));
        }
      } else if (ok) {
        status.append(el('span', { class: 'ok' }, '✓ Valid JSON'), el('span', {}, ok));
      }
    }

    function renderTree(value) {
      tree.replaceChildren(node('root', value, '$', true));
    }

    function node(key, value, path, open = false) {
      const keyEl = el('span', { class: 'tok-key' }, key);
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
        const summary = el('summary', { title: path, onclick: (e) => { if (e.altKey) { e.preventDefault(); copyText(path, 'Path copied'); } } },
          keyEl, Array.isArray(value) ? ' [' : ' {', el('span', { class: 'count' }, `${entries.length} ${Array.isArray(value) ? 'items' : 'keys'}`),
        );
        const details = el('details', { open }, summary);
        // Lazy render children on first open to keep huge documents responsive.
        let rendered = false;
        const fill = () => {
          if (rendered) return;
          rendered = true;
          for (const [k, v] of entries) details.append(node(String(k), v, Array.isArray(value) ? `${path}[${k}]` : `${path}.${k}`));
        };
        if (open) fill();
        else details.addEventListener('toggle', fill, { once: true });
        return details;
      }
      const cls = typeof value === 'string' ? 'tok-str' : typeof value === 'number' ? 'tok-num' : value === null ? 'tok-null' : 'tok-bool';
      const text = JSON.stringify(value);
      return el('div', {
        class: 'leaf copyable', title: `${path}\nclick: copy value · alt+click: copy path`,
        onclick: (e) => copyText(e.altKey ? path : typeof value === 'string' ? value : text, e.altKey ? 'Path copied' : 'Value copied'),
      }, keyEl, ': ', el('span', { class: cls }, text));
    }

    // Best-effort repair for JS-ish input: comments, trailing commas, single quotes, unquoted keys.
    function repair(text) {
      let s = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
      s = s.replace(/'((?:\\.|[^'\\])*)'/g, (_, inner) => '"' + inner.replace(/"/g, '\\"') + '"');
      s = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
      s = s.replace(/,\s*([}\]])/g, '$1');
      s = s.replace(/\bundefined\b|\bNaN\b/g, 'null');
      return s.trim();
    }

    const onInput = debounce(() => {
      saveToolState('json', { input: input.value });
      const text = input.value.trim();
      if (!text) { fail({ error: '' }); status.replaceChildren(); return; }
      const r = parse(text);
      if (r.error) fail(r);
      else setStatus(null, null, null, describe(r.value));
    }, 200);

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run('beautify');
    });
    indent.addEventListener('change', () => { saveToolState('json', { indent: indent.value }); if (lastOutput) run('beautify'); });
    sortKeys.addEventListener('change', () => { saveToolState('json', { sortKeys: sortKeys.checked }); if (lastOutput) run('beautify'); });

    setView(view);
    if (input.value.trim()) run('beautify');
    input.focus();
  },
};
