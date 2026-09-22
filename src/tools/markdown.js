import { $, el, toast, copyText, download, pickFile, debounce, enableTabIndent, uid, relativeTime } from '../shared/util.js';
import { storage, loadToolState, saveToolState } from '../shared/storage.js';

const DOCS_KEY = 'mdDocs';

const SAMPLE = `# Welcome to your notes

Everything you type here is saved **locally** in the extension storage as you go.

## What works

- GitHub-flavored markdown: tables, task lists, strikethrough, autolinks
- Fenced code blocks
- Multiple documents (left column)
- Copy as HTML, download as .md, print to PDF

\`\`\`js
const answer = 42;
console.log(\`the answer is \${answer}\`);
\`\`\`

| Shortcut | Action |
| --- | --- |
| Tab | indent |
| Ctrl/Cmd + S | save now |

- [x] Install Maggiordomo
- [ ] Replace this text
`;

export default {
  id: 'markdown',
  name: 'Markdown',
  icon: 'MD',
  hint: 'Notes and previews. Rendered with marked and sanitized with DOMPurify.',
  fill: true,

  async mount(body) {
    const marked = window.marked;
    const DOMPurify = window.DOMPurify;
    marked.setOptions({ gfm: true, breaks: false });

    let docs = await storage.get(DOCS_KEY, []);
    const state = await loadToolState('markdown', { mode: 'split', activeId: null });
    if (!docs.length) {
      docs = [{ id: uid(), title: 'Welcome', content: SAMPLE, createdAt: Date.now(), updatedAt: Date.now() }];
      await storage.set(DOCS_KEY, docs);
    }
    let active = docs.find((d) => d.id === state.activeId) || docs[0];

    // Left: document list
    const docList = el('div', { class: 'md-docs' });
    const newBtn = el('button', { class: 'btn btn-sm', onclick: createDoc }, '+ New');
    const openBtn = el('button', { class: 'btn btn-sm', title: 'Open a .md file', onclick: openFile }, 'Open…');
    const left = el('div', { class: 'col' }, el('div', { class: 'row' }, newBtn, openBtn), docList);

    // Right: editor + preview
    const title = el('input', { type: 'text', class: 'grow', placeholder: 'Document title', value: active.title, style: { fontWeight: 600 } });
    const modeBtns = ['edit', 'split', 'preview'].map((m) => el('button', {
      class: 'btn btn-sm' + (state.mode === m ? ' active' : ''),
      dataset: { mode: m },
      onclick: () => setMode(m),
    }, m[0].toUpperCase() + m.slice(1)));
    const stats = el('span', { class: 'muted small' });
    const savedAt = el('span', { class: 'muted small' });

    const editor = el('textarea', { class: 'mono', spellcheck: 'false', placeholder: 'Write markdown…' }, active.content);
    enableTabIndent(editor);
    const preview = el('div', { class: 'md-preview' }, el('article', { class: 'md-body' }));
    const panes = el('div', { class: 'md-panes mode-' + state.mode },
      el('div', { class: 'md-editor-wrap' }, editor),
      el('div', { class: 'md-preview-wrap' }, preview),
    );

    const right = el('div', { class: 'md-editor' },
      el('div', { class: 'row nowrap' },
        title,
        el('div', { class: 'row', style: { gap: '2px' } }, ...modeBtns),
        el('button', { class: 'btn btn-sm', title: 'Copy rendered HTML', onclick: () => copyText(renderHtml(editor.value), 'HTML copied') }, 'Copy HTML'),
        el('button', { class: 'btn btn-sm', title: 'Copy markdown source', onclick: () => copyText(editor.value, 'Markdown copied') }, 'Copy MD'),
        el('button', { class: 'btn btn-sm', title: 'Download as .md', onclick: downloadMd }, '⇩ .md'),
        el('button', { class: 'btn btn-sm', title: 'Print / save as PDF', onclick: printDoc }, 'Print'),
        el('button', { class: 'btn btn-sm btn-danger', title: 'Delete this document', onclick: deleteDoc }, 'Delete'),
      ),
      panes,
      el('div', { class: 'status' }, stats, savedAt),
    );

    body.append(el('div', { class: 'md-layout' }, left, right));

    function renderHtml(md) {
      return DOMPurify.sanitize(marked.parse(md), { USE_PROFILES: { html: true } });
    }

    function renderPreview() {
      preview.firstChild.innerHTML = renderHtml(editor.value);
      preview.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
      const text = editor.value;
      const words = (text.match(/\S+/g) || []).length;
      stats.textContent = `${words} words · ${text.length} chars · ${text.split('\n').length} lines`;
    }

    function renderDocList() {
      docs.sort((a, b) => b.updatedAt - a.updatedAt);
      docList.replaceChildren(...docs.map((d) => el('div', {
        class: 'doc' + (d.id === active.id ? ' active' : ''),
        title: d.title + ' · ' + relativeTime(d.updatedAt),
        onclick: () => switchDoc(d.id),
      }, d.title || 'Untitled')));
    }

    const persist = debounce(save, 400);
    async function save() {
      active.content = editor.value;
      active.title = title.value.trim() || 'Untitled';
      active.updatedAt = Date.now();
      await storage.set(DOCS_KEY, docs);
      savedAt.textContent = 'Saved ' + new Date().toLocaleTimeString();
      renderDocList();
    }

    function switchDoc(id) {
      const next = docs.find((d) => d.id === id);
      if (!next || next === active) return;
      active = next;
      title.value = active.title;
      editor.value = active.content;
      saveToolState('markdown', { activeId: active.id });
      renderDocList();
      renderPreview();
      editor.focus();
    }

    async function createDoc(content = '', name = 'Untitled') {
      const doc = { id: uid(), title: name, content, createdAt: Date.now(), updatedAt: Date.now() };
      docs.unshift(doc);
      await storage.set(DOCS_KEY, docs);
      switchDoc(doc.id);
      title.select();
    }

    async function openFile() {
      const file = await pickFile('.md,.markdown,.txt,text/markdown,text/plain');
      if (!file) return;
      await createDoc(await file.text(), file.name.replace(/\.(md|markdown|txt)$/i, ''));
    }

    async function deleteDoc() {
      if (!confirm(`Delete "${active.title}"?`)) return;
      docs = docs.filter((d) => d.id !== active.id);
      if (!docs.length) docs.push({ id: uid(), title: 'Untitled', content: '', createdAt: Date.now(), updatedAt: Date.now() });
      await storage.set(DOCS_KEY, docs);
      active = null;
      switchDoc(docs[0].id);
      toast('Deleted', 'info');
    }

    function downloadMd() {
      const name = (title.value.trim() || 'notes').replace(/[^\w.-]+/g, '-');
      download(`${name}.md`, editor.value, 'text/markdown');
    }

    function printDoc() {
      const win = window.open('', '_blank');
      if (!win) return toast('Popup blocked', 'error');
      const css = `body{font:15px/1.6 system-ui,sans-serif;max-width:800px;margin:32px auto;padding:0 16px;color:#111}
        pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto}code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
        table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 10px}blockquote{border-left:3px solid #ccc;margin:0;padding:0 1em;color:#555}`;
      win.document.write(`<!doctype html><title>${escapeText(title.value)}</title><style>${css}</style><body>${renderHtml(editor.value)}</body>`);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 200);
    }

    function escapeText(s) {
      return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    }

    function setMode(mode) {
      panes.className = 'md-panes mode-' + mode;
      modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      saveToolState('markdown', { mode });
    }

    editor.addEventListener('input', () => { renderPreview(); persist(); });
    title.addEventListener('input', persist);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
        toast('Saved', 'ok');
      }
    };
    document.addEventListener('keydown', onKey);

    renderDocList();
    renderPreview();
    editor.focus();

    return { cleanup: () => document.removeEventListener('keydown', onKey) };
  },
};
