import { el, toast, copyText, download, pickFile, fmtBytes, uid, debounce } from '../shared/util.js';
import { storage } from '../shared/storage.js';

const WORD = /\.(docx)$/i;
const SHEET = /\.(xlsx|xlsm|xls|csv|tsv|ods)$/i;
export const OFFICE_EXT = /\.(docx|xlsx|xlsm|xls|csv|tsv|ods)$/i;

const MAX_ROWS_FIRST = 500;

export default {
  id: 'office',
  name: 'Word / Excel',
  icon: 'doc',
  hint: 'Read .docx and spreadsheets in the browser. Files are parsed locally and never uploaded.',

  async mount(body, { params }) {
    const drop = el('div', { class: 'drop-zone' },
      el('div', { class: 'drop-title' }, 'Drop a Word or Excel file here'),
      el('div', { class: 'muted small' }, '.docx · .xlsx · .xlsm · .xls · .csv · .tsv · .ods'),
      el('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } },
        el('button', { class: 'btn btn-primary', onclick: chooseFile }, 'Choose file…'),
        el('button', { class: 'btn', onclick: () => urlBox.classList.toggle('hidden') }, 'Open from URL'),
      ),
    );
    const urlInput = el('input', { type: 'url', class: 'mono grow', placeholder: 'https://… or file:///C:/… (needs "Allow access to file URLs")' });
    const urlBox = el('form', { class: 'row hidden', onsubmit: (e) => { e.preventDefault(); openUrl(urlInput.value.trim()); } },
      urlInput, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Open'));
    const status = el('div', { class: 'status' });
    const viewer = el('div', { class: 'office-viewer' });
    body.append(drop, urlBox, status, viewer);

    // Drag and drop anywhere on the tool.
    const onDrag = (e) => { e.preventDefault(); drop.classList.add('over'); };
    const onLeave = () => drop.classList.remove('over');
    const onDrop = async (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const file = e.dataTransfer?.files?.[0];
      if (file) await openFile(file);
    };
    body.addEventListener('dragover', onDrag);
    body.addEventListener('dragleave', onLeave);
    body.addEventListener('drop', onDrop);

    async function chooseFile() {
      const file = await pickFile('.docx,.xlsx,.xlsm,.xls,.csv,.tsv,.ods');
      if (file) await openFile(file);
    }

    async function openUrl(url) {
      if (!url) return;
      urlInput.value = url;
      setStatus('Fetching…');
      let buf;
      try {
        buf = await loadBytes(url);
      } catch (err) {
        showFetchError(url, err);
        return;
      }
      try {
        const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file');
        await render(name, buf);
      } catch (err) {
        console.error(err);
        setStatus(err.message, true);
      }
    }

    // fetch() rejects file:// even with file access granted; XMLHttpRequest still supports it.
    function loadBytes(url) {
      if (!url.startsWith('file:')) {
        return fetch(url).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        });
      }
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => (xhr.status === 0 || xhr.status === 200) && xhr.response?.byteLength
          ? resolve(xhr.response)
          : reject(new Error('file not readable'));
        xhr.onerror = () => reject(new Error('file access denied'));
        xhr.send();
      });
    }

    function showFetchError(url, err) {
      let origin = null;
      try { origin = new URL(url).origin; } catch { /* ignore */ }
      status.replaceChildren(el('span', { class: 'error' }, `Could not load: ${err.message}. `));
      if (origin && /^https?:$/.test(new URL(url).protocol)) {
        status.append(el('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
            if (granted) openUrl(url);
            else toast('Permission not granted', 'error');
          },
        }, `Allow access to ${origin}`));
      } else if (url.startsWith('file:')) {
        status.append(el('span', { class: 'muted' }, 'For local files enable "Allow access to file URLs" on the extension\u2019s details page, or drop the file here instead.'));
      }
    }

    async function openFile(file) {
      setStatus(`Reading ${file.name} (${fmtBytes(file.size)})…`);
      try {
        await render(file.name, await file.arrayBuffer());
      } catch (err) {
        console.error(err);
        setStatus(err.message, true);
      }
    }

    function setStatus(text, isError = false) {
      status.replaceChildren(el('span', { class: isError ? 'error' : '' }, text));
    }

    async function render(name, buffer) {
      viewer.replaceChildren();
      if (WORD.test(name)) await renderDocx(name, buffer);
      else if (SHEET.test(name)) await renderSheet(name, buffer);
      else throw new Error('Unsupported file type. Use .docx or a spreadsheet (.xlsx, .xls, .csv, .ods).');
      drop.classList.add('compact');
    }

    // ---------- Word ----------
    async function renderDocx(name, buffer) {
      const mammoth = window.mammoth;
      if (!mammoth) throw new Error('Word renderer failed to load');
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
        styleMap: [
          "p[style-name='Title'] => h1.title:fresh",
          "p[style-name='Subtitle'] => p.subtitle:fresh",
          "p[style-name='Quote'] => blockquote:fresh",
          "p[style-name='Intense Quote'] => blockquote:fresh",
          "p[style-name='List Bullet'] => ul > li:fresh",
          "p[style-name='List Bullet 2'] => ul > li:fresh",
          "p[style-name='List Number'] => ol > li:fresh",
          "p[style-name='Code'] => pre:fresh",
        ],
      });
      const html = window.DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } });
      const article = el('article', { class: 'md-body office-doc' });
      article.innerHTML = html;
      const words = (article.textContent.match(/\S+/g) || []).length;
      const warnings = result.messages.filter((m) => m.type === 'warning');

      const bar = el('div', { class: 'toolbar' },
        el('strong', {}, name),
        el('span', { class: 'muted small' }, `${words} words`),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-sm', onclick: () => copyText(article.innerHTML, 'HTML copied') }, 'Copy HTML'),
        el('button', { class: 'btn btn-sm', onclick: () => copyText(article.textContent, 'Text copied') }, 'Copy text'),
        el('button', { class: 'btn btn-sm', onclick: () => saveAsNote(name, buffer) }, 'Save as markdown note'),
        el('button', { class: 'btn btn-sm', onclick: () => printHtml(name, article.innerHTML) }, 'Print'),
      );
      viewer.append(bar, el('div', { class: 'office-page' }, article));
      if (warnings.length) {
        viewer.append(el('details', { class: 'help' }, el('summary', {}, `${warnings.length} conversion note${warnings.length === 1 ? '' : 's'}`),
          el('ul', {}, ...[...new Set(warnings.map((w) => w.message))].slice(0, 20).map((m) => el('li', {}, m)))));
      }
      setStatus(`Rendered ${name}. Layout, headers and footers are not preserved; content is.`);
    }

    async function saveAsNote(name, buffer) {
      try {
        const md = await window.mammoth.convertToMarkdown({ arrayBuffer: buffer });
        const docs = await storage.get('mdDocs', []);
        docs.unshift({ id: uid(), title: name.replace(WORD, ''), content: md.value, createdAt: Date.now(), updatedAt: Date.now() });
        await storage.set('mdDocs', docs);
        toast('Saved to markdown notes', 'ok');
      } catch (err) {
        toast('Could not convert: ' + err.message, 'error');
      }
    }

    function printHtml(title, html) {
      const win = window.open('', '_blank');
      if (!win) return toast('Popup blocked', 'error');
      win.document.write(`<!doctype html><title>${title.replace(/[<>&]/g, '')}</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#111}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 10px}img{max-width:100%}</style><body>${html}</body>`);
      win.document.close();
      setTimeout(() => win.print(), 200);
    }

    // ---------- Spreadsheets ----------
    async function renderSheet(name, buffer) {
      const XLSX = window.XLSX;
      if (!XLSX) throw new Error('Spreadsheet renderer failed to load');
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true, cellStyles: false });
      if (!wb.SheetNames.length) throw new Error('No sheets found');

      const tabs = el('div', { class: 'row', style: { gap: '2px' } });
      const search = el('input', { type: 'search', placeholder: 'Filter rows…', style: { width: '220px' } });
      const info = el('span', { class: 'muted small' });
      const table = el('div', { class: 'sheet-wrap' });
      let active = wb.SheetNames[0];
      let showAll = false;

      const bar = el('div', { class: 'toolbar' },
        el('strong', {}, name),
        tabs,
        el('span', { class: 'spacer' }),
        search,
        el('button', { class: 'btn btn-sm', title: 'Copy the visible sheet as tab-separated text', onclick: () => copyText(XLSX.utils.sheet_to_csv(wb.Sheets[active], { FS: '\t' }), 'Copied as TSV') }, 'Copy TSV'),
        el('button', { class: 'btn btn-sm', title: 'Copy the visible sheet as a markdown table', onclick: () => copyText(toMarkdown(rowsOf(active)), 'Copied as markdown') }, 'Copy MD'),
        el('button', { class: 'btn btn-sm', title: 'Copy as JSON (first row as keys)', onclick: () => copyText(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[active], { defval: null }), null, 2), 'Copied as JSON') }, 'Copy JSON'),
        el('button', { class: 'btn btn-sm', onclick: () => download(`${active}.csv`, XLSX.utils.sheet_to_csv(wb.Sheets[active]), 'text/csv') }, '⇩ CSV'),
      );
      viewer.append(bar, info, table);

      function rowsOf(sheetName) {
        return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
      }

      function renderTabs() {
        tabs.replaceChildren(...wb.SheetNames.map((s) => el('button', {
          class: 'btn btn-sm' + (s === active ? ' active' : ''),
          onclick: () => { active = s; showAll = false; renderTabs(); renderTable(); },
        }, s)));
      }

      function renderTable() {
        const rows = rowsOf(active);
        const q = search.value.trim().toLowerCase();
        const filtered = q ? rows.filter((r, i) => i === 0 || r.some((c) => String(c).toLowerCase().includes(q))) : rows;
        const cols = Math.max(0, ...filtered.map((r) => r.length));
        const limit = showAll ? filtered.length : Math.min(filtered.length, MAX_ROWS_FIRST);
        const range = wb.Sheets[active]['!ref'] || '';
        info.textContent = `${rows.length} rows × ${cols} columns${range ? ` · ${range}` : ''}${q ? ` · ${filtered.length} matching` : ''}`;

        const head = el('tr', {}, el('th', { class: 'rownum' }, ''), ...Array.from({ length: cols }, (_, c) => el('th', {}, colName(c))));
        const bodyRows = [];
        for (let i = 0; i < limit; i++) {
          const r = filtered[i];
          const cells = [];
          for (let c = 0; c < cols; c++) {
            const v = r[c] ?? '';
            const cls = typeof v === 'string' && /^-?[\d,.]+%?$/.test(v.trim()) && v.trim() !== '' ? 'num' : '';
            cells.push(el('td', { class: cls, title: String(v).length > 60 ? String(v) : null }, String(v)));
          }
          bodyRows.push(el('tr', {}, el('td', { class: 'rownum' }, String(i + 1)), ...cells));
        }
        const t = el('table', { class: 'sheet' }, el('thead', {}, head), el('tbody', {}, ...bodyRows));
        table.replaceChildren(t);
        if (limit < filtered.length) {
          table.append(el('div', { class: 'row', style: { padding: '8px' } },
            el('span', { class: 'muted small' }, `Showing ${limit} of ${filtered.length} rows`),
            el('button', { class: 'btn btn-sm', onclick: () => { showAll = true; renderTable(); } }, 'Show all')));
        }
      }

      search.addEventListener('input', debounce(() => { showAll = false; renderTable(); }, 150));
      renderTabs();
      renderTable();
      setStatus(`Opened ${name}: ${wb.SheetNames.length} sheet${wb.SheetNames.length === 1 ? '' : 's'}. Formula results are shown as saved; charts are not rendered.`);
    }

    function colName(i) {
      let s = '';
      for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
      return s;
    }

    function toMarkdown(rows) {
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length));
      const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => esc(r[i])).join(' | ') + ' |';
      return [line(rows[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
    }

    const url = params.get('url');
    if (url) openUrl(url);

    return {
      cleanup: () => {
        body.removeEventListener('dragover', onDrag);
        body.removeEventListener('dragleave', onLeave);
        body.removeEventListener('drop', onDrop);
      },
    };
  },
};
