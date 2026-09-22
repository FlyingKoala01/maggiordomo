// Renders raw .md files that the browser shows as plain text (file:// and raw GitHub URLs).
// Runs as a content script with marked and DOMPurify already loaded into the same isolated world.
(() => {
  const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn)(\?.*)?(#.*)?$/i;
  const isPlainText = ['text/plain', 'text/markdown', 'text/x-markdown'].includes(document.contentType);
  const pre = document.body && document.body.children.length === 1 && document.body.firstElementChild.tagName === 'PRE'
    ? document.body.firstElementChild : null;
  if (!isPlainText || !pre || !MD_EXT.test(location.pathname)) return;
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') return;

  const raw = pre.textContent.replace(/^﻿/, '');
  const filename = decodeURIComponent(location.pathname.split('/').pop() || 'document.md');

  // Split YAML front matter off so it does not render as a broken table.
  let frontMatter = '';
  let body = raw;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (fm) {
    frontMatter = fm[1];
    body = raw.slice(fm[0].length);
  }

  marked.setOptions({ gfm: true, breaks: false });
  const html = DOMPurify.sanitize(marked.parse(body), { USE_PROFILES: { html: true } });

  const CSS = `
    :root { color-scheme: light dark; }
    html[data-md-theme="light"] { color-scheme: light; }
    html[data-md-theme="dark"] { color-scheme: dark; }
    body.md-viewer { margin: 0; background: light-dark(#f7f7f9, #0f1115); color: light-dark(#1f2328, #e6e8ee); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    body.md-viewer > pre.md-raw { display: none; margin: 0; padding: 24px; font: 13px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
    body.md-viewer.raw > pre.md-raw { display: block; }
    body.md-viewer.raw > .md-page { display: none; }
    .md-page { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
    .md-page.no-toc { grid-template-columns: minmax(0, 1fr); }
    .md-toc { position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 56px 16px 24px; border-right: 1px solid light-dark(#e1e4e8, #2a2f3a); background: light-dark(#ffffff, #171a21); font-size: 13px; }
    .md-page.no-toc .md-toc { display: none; }
    .md-toc a { display: block; color: light-dark(#57606a, #8b93a7); text-decoration: none; padding: 3px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .md-toc a:hover { color: light-dark(#0969da, #93c5fd); }
    .md-toc a.l2 { padding-left: 12px; } .md-toc a.l3 { padding-left: 24px; font-size: 12px; }
    .md-toc a.active { color: light-dark(#0969da, #f5c842); }
    .md-main { max-width: 880px; padding: 56px 40px 80px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .md-bar { position: fixed; top: 10px; right: 12px; z-index: 10; display: flex; gap: 4px; background: light-dark(#ffffffee, #1e222bee); border: 1px solid light-dark(#d0d7de, #2a2f3a); border-radius: 8px; padding: 4px; box-shadow: 0 4px 16px rgba(0,0,0,.15); font-size: 12px; }
    .md-bar button { all: unset; cursor: pointer; padding: 4px 9px; border-radius: 5px; color: light-dark(#1f2328, #e6e8ee); font: inherit; }
    .md-bar button:hover { background: light-dark(#eaeef2, #2a2f3a); }
    .md-bar button.on { background: light-dark(#0969da, #f5c842); color: light-dark(#fff, #1a1a1a); }
    .md-bar .sep { width: 1px; background: light-dark(#d0d7de, #2a2f3a); margin: 2px 2px; }
    .md-fm { margin: 0 0 24px; font-size: 12px; color: light-dark(#57606a, #8b93a7); }
    .md-fm pre { margin: 6px 0 0; padding: 10px; background: light-dark(#f6f8fa, #1e222b); border-radius: 6px; font-size: 12px; overflow: auto; }
    .md-body h1, .md-body h2, .md-body h3, .md-body h4 { margin: 1.4em 0 .6em; line-height: 1.25; font-weight: 600; scroll-margin-top: 16px; }
    .md-body h1:first-child { margin-top: 0; }
    .md-body h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid light-dark(#d8dee4, #2a2f3a); }
    .md-body h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid light-dark(#d8dee4, #2a2f3a); }
    .md-body h3 { font-size: 1.2em; } .md-body h4 { font-size: 1em; }
    .md-body p, .md-body ul, .md-body ol, .md-body blockquote, .md-body pre, .md-body table { margin: 0 0 1em; }
    .md-body li + li { margin-top: .2em; }
    .md-body a { color: light-dark(#0969da, #93c5fd); }
    .md-body code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: .875em; background: light-dark(#eff1f3, #1e222b); padding: .15em .4em; border-radius: 5px; }
    .md-body pre { background: light-dark(#f6f8fa, #1e222b); border: 1px solid light-dark(#d8dee4, #2a2f3a); border-radius: 8px; padding: 14px; overflow: auto; line-height: 1.45; }
    .md-body pre code { background: none; padding: 0; font-size: .85em; }
    .md-body blockquote { border-left: 4px solid light-dark(#d0d7de, #f5c842); margin-left: 0; padding: .1em 1em; color: light-dark(#57606a, #8b93a7); }
    .md-body table { border-collapse: collapse; display: block; overflow-x: auto; max-width: 100%; font-size: .95em; }
    .md-body th, .md-body td { border: 1px solid light-dark(#d8dee4, #2a2f3a); padding: 6px 12px; vertical-align: top; }
    .md-body th { background: light-dark(#f6f8fa, #1e222b); font-weight: 600; }
    .md-body tr:nth-child(even) td { background: light-dark(#fafbfc, #14171d); }
    .md-body img { max-width: 100%; }
    .md-body hr { border: 0; border-top: 1px solid light-dark(#d8dee4, #2a2f3a); margin: 2em 0; }
    .md-body input[type="checkbox"] { margin-right: 6px; }
    .md-body h1 a.anchor, .md-body h2 a.anchor, .md-body h3 a.anchor { color: inherit; text-decoration: none; }
    @media (max-width: 900px) { .md-page { grid-template-columns: 1fr; } .md-toc { display: none; } .md-main { padding: 56px 20px 60px; } }
    @media print { .md-bar, .md-toc { display: none; } .md-page { display: block; } }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  pre.className = 'md-raw';
  const page = document.createElement('div');
  page.className = 'md-page';
  const toc = document.createElement('nav');
  toc.className = 'md-toc';
  const main = document.createElement('main');
  main.className = 'md-main';
  const article = document.createElement('article');
  article.className = 'md-body';
  article.innerHTML = html;

  if (frontMatter) {
    const details = document.createElement('details');
    details.className = 'md-fm';
    const summary = document.createElement('summary');
    summary.textContent = 'Front matter';
    const fmPre = document.createElement('pre');
    fmPre.textContent = frontMatter;
    details.append(summary, fmPre);
    main.append(details);
  }
  main.append(article);
  page.append(toc, main);

  // Heading ids + table of contents.
  const used = new Set();
  const headings = Array.from(article.querySelectorAll('h1, h2, h3'));
  for (const h of headings) {
    let id = h.textContent.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
    let candidate = id, n = 2;
    while (used.has(candidate)) candidate = `${id}-${n++}`;
    used.add(candidate);
    h.id = candidate;
    const link = document.createElement('a');
    link.href = '#' + candidate;
    link.textContent = h.textContent;
    link.className = 'l' + h.tagName[1];
    link.title = h.textContent;
    toc.append(link);
  }
  if (headings.length < 3) page.classList.add('no-toc');

  article.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href.startsWith('#')) a.rel = 'noopener';
  });

  // Toolbar
  const bar = document.createElement('div');
  bar.className = 'md-bar';
  const btn = (label, title, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    bar.append(b);
    return b;
  };
  const rendered = btn('Rendered', 'Show rendered markdown', () => setRaw(false));
  const rawBtn = btn('Raw', 'Show the original text', () => setRaw(true));
  const sep = () => { const s = document.createElement('span'); s.className = 'sep'; bar.append(s); };
  sep();
  btn('Copy HTML', 'Copy rendered HTML', () => navigator.clipboard.writeText(article.innerHTML).then(() => flash('Copied')));
  btn('Save to notes', 'Save into Maggiordomo markdown notes', saveToNotes);
  sep();
  const themeBtn = btn('◐', 'Toggle light / dark', toggleTheme);

  function setRaw(on) {
    document.body.classList.toggle('raw', on);
    rendered.classList.toggle('on', !on);
    rawBtn.classList.toggle('on', on);
  }

  let flashTimer;
  function flash(text) {
    const prev = themeBtn.textContent;
    themeBtn.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { themeBtn.textContent = '◐'; }, 1200);
    void prev;
  }

  async function saveToNotes() {
    try {
      const { mdDocs = [] } = await chrome.storage.local.get('mdDocs');
      const title = filename.replace(MD_EXT, '');
      const existing = mdDocs.find((d) => d.sourceUrl === location.href);
      if (existing) {
        existing.content = raw;
        existing.updatedAt = Date.now();
      } else {
        mdDocs.unshift({ id: crypto.randomUUID(), title, content: raw, sourceUrl: location.href, createdAt: Date.now(), updatedAt: Date.now() });
      }
      await chrome.storage.local.set({ mdDocs });
      flash(existing ? 'Updated' : 'Saved');
    } catch (err) {
      console.error('Maggiordomo:', err);
      flash('Failed');
    }
  }

  async function applyTheme(next) {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const theme = next || settings.theme;
    if (theme) document.documentElement.dataset.mdTheme = theme;
    if (next) await chrome.storage.local.set({ settings: { ...settings, theme } });
  }
  function toggleTheme() {
    const isDark = document.documentElement.dataset.mdTheme === 'dark'
      || (!document.documentElement.dataset.mdTheme && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark ? 'light' : 'dark');
  }

  // Highlight the current section in the table of contents while scrolling.
  if (headings.length >= 3 && 'IntersectionObserver' in window) {
    const links = new Map(headings.map((h, i) => [h.id, toc.children[i]]));
    let current = null;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (current) current.classList.remove('active');
        current = links.get(entry.target.id);
        current?.classList.add('active');
      }
    }, { rootMargin: '0px 0px -80% 0px' });
    headings.forEach((h) => observer.observe(h));
  }

  document.body.classList.add('md-viewer');
  document.body.append(page, bar);
  setRaw(false);
  applyTheme();
  const firstH1 = article.querySelector('h1');
  document.title = (firstH1 ? firstH1.textContent.trim() + ' · ' : '') + filename;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
