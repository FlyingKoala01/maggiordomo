import { el, toast, copyText, debounce, fmtBytes, pickFile } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

// MD5 is not in WebCrypto, so a compact implementation lives here. Only for checksums, never for security.
export function md5(bytes) {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length;
  const padLen = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  const bitLen = len * 8;
  view.setUint32(padLen - 8, bitLen >>> 0, true);
  view.setUint32(padLen - 4, Math.floor(bitLen / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return out;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

function hmacMd5(key, msg) {
  if (key.length > 64) key = md5(key);
  const k = new Uint8Array(64);
  k.set(key);
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  return md5(concat(opad, md5(concat(ipad, msg))));
}

const ALGOS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export async function digest(algo, bytes, keyBytes = null) {
  if (algo === 'MD5') return keyBytes ? hmacMd5(keyBytes, bytes) : md5(bytes);
  if (keyBytes) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: algo }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  }
  return new Uint8Array(await crypto.subtle.digest(algo, bytes));
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));

export default {
  id: 'hash',
  name: 'Hash / HMAC',
  icon: '#',
  hint: 'MD5, SHA-1, SHA-256/384/512 of text or a file, optionally keyed (HMAC).',

  async mount(body) {
    const state = await loadToolState('hash', { input: '', key: '', format: 'hex', upper: false });
    const input = el('textarea', { class: 'mono', placeholder: 'Text to hash…' }, state.input);
    const key = el('input', { type: 'text', class: 'mono', placeholder: 'HMAC key (optional)', value: state.key });
    const format = el('select', {}, el('option', { value: 'hex' }, 'Hex'), el('option', { value: 'base64' }, 'Base64'));
    format.value = state.format;
    const upper = el('input', { type: 'checkbox' });
    upper.checked = !!state.upper;
    const fileInfo = el('span', { class: 'muted small' });
    const rows = new Map(ALGOS.map((a) => [a, el('span', { class: 'v copyable', title: 'Click to copy', onclick: (e) => copyText(e.target.textContent) })]));
    const compare = el('input', { type: 'text', class: 'mono grow', placeholder: 'Paste an expected hash to compare…' });
    const compareOut = el('span');

    let fileBytes = null;
    let fileName = '';

    body.append(
      el('div', { class: 'toolbar' },
        format,
        el('label', { class: 'inline' }, upper, 'Uppercase'),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: chooseFile }, 'Hash a file…'),
        el('button', { class: 'btn btn-ghost', onclick: clearFile }, 'Use text'),
        fileInfo,
      ),
      el('div', { class: 'col' }, input, el('div', {}, el('label', {}, 'HMAC key'), key)),
      el('div', { class: 'card' }, el('div', { class: 'kv' },
        ...ALGOS.flatMap((a) => [el('span', { class: 'k' }, a), rows.get(a), el('button', { class: 'btn btn-sm btn-ghost', onclick: () => copyText(rows.get(a).textContent) }, 'Copy')]),
      )),
      el('div', { class: 'card row' }, el('span', { class: 'muted small' }, 'Compare'), compare, compareOut),
    );

    async function compute() {
      const bytes = fileBytes || new TextEncoder().encode(input.value);
      const keyBytes = key.value ? new TextEncoder().encode(key.value) : null;
      for (const a of ALGOS) {
        try {
          const out = await digest(a, bytes, keyBytes);
          let text = format.value === 'hex' ? toHex(out) : toB64(out);
          if (upper.checked && format.value === 'hex') text = text.toUpperCase();
          rows.get(a).textContent = text;
        } catch (err) {
          rows.get(a).textContent = 'error: ' + err.message;
        }
      }
      checkCompare();
    }

    function checkCompare() {
      const expected = compare.value.trim().toLowerCase();
      compareOut.replaceChildren();
      if (!expected) return;
      const match = ALGOS.find((a) => rows.get(a).textContent.toLowerCase() === expected);
      compareOut.append(el('span', { class: 'badge ' + (match ? 'badge-ok' : 'badge-error') }, match ? `✓ matches ${match}` : '✕ no match'));
    }

    async function chooseFile() {
      const file = await pickFile();
      if (!file) return;
      fileBytes = new Uint8Array(await file.arrayBuffer());
      fileName = file.name;
      fileInfo.textContent = `${fileName} · ${fmtBytes(fileBytes.length)}`;
      input.disabled = true;
      compute();
    }
    function clearFile() {
      fileBytes = null;
      fileName = '';
      fileInfo.textContent = '';
      input.disabled = false;
      compute();
    }

    const persist = debounce(() => saveToolState('hash', { input: input.value, key: key.value, format: format.value, upper: upper.checked }), 300);
    const recompute = debounce(compute, 120);
    input.addEventListener('input', () => { recompute(); persist(); });
    key.addEventListener('input', () => { recompute(); persist(); });
    format.addEventListener('change', () => { compute(); persist(); });
    upper.addEventListener('change', () => { compute(); persist(); });
    compare.addEventListener('input', checkCompare);

    compute();
    input.focus();
  },
};
