// DOM and formatting helpers. No top-level DOM access so this can be imported by the service worker.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// el('div', { class: 'x', onclick: fn, dataset: {...} }, child1, 'text', ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

let toastTimer;
export function toast(message, kind = 'info') {
  let host = document.getElementById('toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast';
    document.body.append(host);
  }
  host.textContent = message;
  host.className = `toast toast-${kind} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), 1800);
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'ok');
    return true;
  } catch (err) {
    toast('Copy failed: ' + err.message, 'error');
    return false;
  }
}

export function download(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.click();
  });
}

export function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

export function relativeTime(ts, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const units = [
    ['year', 365 * 24 * 3600e3],
    ['month', 30 * 24 * 3600e3],
    ['day', 24 * 3600e3],
    ['hour', 3600e3],
    ['minute', 60e3],
    ['second', 1e3],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') {
      const value = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
    }
  }
  return '';
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function utf8Bytes(str) {
  return new TextEncoder().encode(str).length;
}

// Bind Tab in a textarea to insert spaces instead of moving focus.
export function enableTabIndent(textarea, spaces = '  ') {
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    textarea.value = value.slice(0, start) + spaces + value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Wrap JSON text tokens in spans for colouring. Input is raw JSON text; output is safe HTML.
export function highlightJson(json) {
  const esc = escapeHtml(json);
  const re = /(&quot;(?:\\.|[^\\&]|&(?!quot;))*&quot;)(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
  return esc.replace(re, (m, str, colon, bool, nul, num) => {
    if (str) return colon ? `<span class="tok-key">${str}</span>${colon}` : `<span class="tok-str">${str}</span>`;
    if (bool) return `<span class="tok-bool">${bool}</span>`;
    if (nul) return `<span class="tok-null">${nul}</span>`;
    if (num) return `<span class="tok-num">${num}</span>`;
    return m;
  });
}

export function positionToLineCol(text, position) {
  const before = text.slice(0, position);
  const lines = before.split('\n');
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

export function openWorkbench(hash = '') {
  const url = chrome.runtime.getURL('src/workbench/workbench.html') + hash;
  return chrome.tabs.create({ url });
}
