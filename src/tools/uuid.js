import { el, copyText, fmtDate, toast } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

function formatUuid(bytes) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV4() {
  return crypto.randomUUID();
}

export function uuidV7(now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function inspectUuid(str) {
  const m = /^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i.exec(str.trim());
  if (!m) return null;
  const hex = m.slice(1).join('').toLowerCase();
  const version = parseInt(hex[12], 16);
  const variantNibble = parseInt(hex[16], 16);
  const variant = variantNibble < 8 ? 'NCS (reserved)' : variantNibble < 12 ? 'RFC 4122 / 9562' : variantNibble < 14 ? 'Microsoft (reserved)' : 'Future (reserved)';
  const info = { canonical: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`, version, variant };
  if (hex === '0'.repeat(32)) info.note = 'Nil UUID';
  if (hex === 'f'.repeat(32)) info.note = 'Max UUID';
  if (version === 7) info.timestamp = Number(BigInt('0x' + hex.slice(0, 12)));
  if (version === 1) {
    const time = BigInt('0x' + hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8));
    info.timestamp = Number((time - 122192928000000000n) / 10000n);
    info.node = hex.slice(20).match(/../g).join(':');
  }
  return info;
}

const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
};

export function randomString(length, alphabet) {
  if (!alphabet.length) return '';
  const out = [];
  const max = 256 - (256 % alphabet.length);
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of buf) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export default {
  id: 'uuid',
  name: 'UUID / Random',
  icon: 'id',
  hint: 'UUID v4 and v7, random strings and tokens. Generated with the Web Crypto API.',

  async mount(body) {
    const state = await loadToolState('uuid', { version: '4', count: 5, upper: false, hyphens: true, braces: false, len: 32, sets: ['lower', 'upper', 'digits'] });

    // UUIDs
    const version = el('select', {}, el('option', { value: '4' }, 'v4 (random)'), el('option', { value: '7' }, 'v7 (time-ordered)'), el('option', { value: 'nil' }, 'nil'));
    version.value = state.version;
    const count = el('input', { type: 'number', min: 1, max: 1000, value: state.count, style: { width: '80px' } });
    const upper = el('input', { type: 'checkbox' }); upper.checked = state.upper;
    const hyphens = el('input', { type: 'checkbox' }); hyphens.checked = state.hyphens;
    const braces = el('input', { type: 'checkbox' }); braces.checked = state.braces;
    const uuidOut = el('textarea', { class: 'mono', readonly: true, style: { minHeight: '140px' } });

    function genUuids() {
      const n = Math.max(1, Math.min(1000, Number(count.value) || 1));
      const list = [];
      for (let i = 0; i < n; i++) {
        let u = version.value === '7' ? uuidV7() : version.value === 'nil' ? '00000000-0000-0000-0000-000000000000' : uuidV4();
        if (!hyphens.checked) u = u.replace(/-/g, '');
        if (upper.checked) u = u.toUpperCase();
        if (braces.checked) u = `{${u}}`;
        list.push(u);
      }
      uuidOut.value = list.join('\n');
      saveToolState('uuid', { version: version.value, count: n, upper: upper.checked, hyphens: hyphens.checked, braces: braces.checked });
    }

    // Inspector
    const inspectIn = el('input', { type: 'text', class: 'mono', placeholder: 'Paste a UUID to inspect' });
    const inspectOut = el('div', { class: 'kv' });
    inspectIn.addEventListener('input', () => {
      inspectOut.replaceChildren();
      const info = inspectUuid(inspectIn.value);
      if (!inspectIn.value.trim()) return;
      if (!info) return inspectOut.append(el('span', { class: 'error small', style: { gridColumn: '1 / -1' } }, 'Not a UUID'));
      const rows = [['Canonical', info.canonical], ['Version', String(info.version)], ['Variant', info.variant]];
      if (info.note) rows.push(['Note', info.note]);
      if (info.timestamp) rows.push(['Timestamp', `${fmtDate(info.timestamp)} (${new Date(info.timestamp).toISOString()})`]);
      if (info.node) rows.push(['Node', info.node]);
      for (const [k, v] of rows) inspectOut.append(el('span', { class: 'k' }, k), el('span', { class: 'v' }, v), el('button', { class: 'btn btn-sm btn-ghost', onclick: () => copyText(v) }, 'Copy'));
    });

    // Random strings
    const len = el('input', { type: 'number', min: 1, max: 4096, value: state.len, style: { width: '80px' } });
    const setBoxes = Object.keys(CHARSETS).map((k) => {
      const box = el('input', { type: 'checkbox', value: k });
      box.checked = state.sets.includes(k);
      return box;
    });
    const custom = el('input', { type: 'text', class: 'mono', placeholder: 'or a custom alphabet', style: { width: '220px' } });
    const rndCount = el('input', { type: 'number', min: 1, max: 100, value: 5, style: { width: '80px' } });
    const rndOut = el('textarea', { class: 'mono', readonly: true, style: { minHeight: '120px' } });

    function genRandom() {
      const alphabet = custom.value || setBoxes.filter((b) => b.checked).map((b) => CHARSETS[b.value]).join('');
      if (!alphabet) return toast('Pick at least one character set', 'error');
      const n = Math.max(1, Math.min(100, Number(rndCount.value) || 1));
      const l = Math.max(1, Math.min(4096, Number(len.value) || 1));
      rndOut.value = Array.from({ length: n }, () => randomString(l, alphabet)).join('\n');
      saveToolState('uuid', { len: l, sets: setBoxes.filter((b) => b.checked).map((b) => b.value) });
    }

    const hexBytes = el('input', { type: 'number', min: 1, max: 1024, value: 32, style: { width: '80px' } });
    const hexOut = el('input', { type: 'text', class: 'mono', readonly: true });
    function genHex() {
      const n = Math.max(1, Math.min(1024, Number(hexBytes.value) || 1));
      hexOut.value = [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    body.append(
      el('div', { class: 'card col' },
        el('h3', {}, 'UUID'),
        el('div', { class: 'row' },
          version, el('label', { class: 'inline' }, 'Count', count),
          el('label', { class: 'inline' }, upper, 'Uppercase'),
          el('label', { class: 'inline' }, hyphens, 'Hyphens'),
          el('label', { class: 'inline' }, braces, 'Braces'),
          el('button', { class: 'btn btn-primary', onclick: genUuids }, 'Generate'),
          el('button', { class: 'btn', onclick: () => copyText(uuidOut.value) }, 'Copy all'),
          el('button', { class: 'btn', onclick: () => copyText(uuidOut.value.split('\n')[0]) }, 'Copy first'),
        ),
        uuidOut,
        el('div', { class: 'row' }, inspectIn),
        inspectOut,
      ),
      el('div', { class: 'card col' },
        el('h3', {}, 'Random string'),
        el('div', { class: 'row' },
          el('label', { class: 'inline' }, 'Length', len),
          ...setBoxes.map((b) => el('label', { class: 'inline' }, b, b.value)),
          custom,
          el('label', { class: 'inline' }, 'Count', rndCount),
          el('button', { class: 'btn btn-primary', onclick: genRandom }, 'Generate'),
          el('button', { class: 'btn', onclick: () => copyText(rndOut.value) }, 'Copy'),
        ),
        rndOut,
      ),
      el('div', { class: 'card col' },
        el('h3', {}, 'Random bytes (hex)'),
        el('div', { class: 'row' },
          el('label', { class: 'inline' }, 'Bytes', hexBytes),
          el('button', { class: 'btn btn-primary', onclick: genHex }, 'Generate'),
          el('button', { class: 'btn', onclick: () => copyText(hexOut.value) }, 'Copy'),
        ),
        hexOut,
      ),
    );

    genUuids();
    genRandom();
    genHex();
  },
};
