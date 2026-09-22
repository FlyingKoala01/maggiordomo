import { el, toast, copyText, debounce } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

const utf8 = { enc: new TextEncoder(), dec: new TextDecoder() };

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const clean = b64.replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const HTML_NAMED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const codecs = {
  base64: {
    name: 'Base64',
    encode: (s) => bytesToBase64(utf8.enc.encode(s)),
    decode: (s) => utf8.dec.decode(base64ToBytes(s)),
  },
  base64url: {
    name: 'Base64 URL-safe',
    encode: (s) => bytesToBase64(utf8.enc.encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    decode: (s) => utf8.dec.decode(base64ToBytes(s)),
  },
  url: {
    name: 'URL component',
    encode: (s) => encodeURIComponent(s),
    decode: (s) => decodeURIComponent(s.replace(/\+/g, '%20')),
  },
  uri: {
    name: 'URL (keep :/?&=)',
    encode: (s) => encodeURI(s),
    decode: (s) => decodeURI(s),
  },
  html: {
    name: 'HTML entities',
    encode: (s) => s.replace(/[&<>"']/g, (c) => HTML_NAMED[c]),
    decode: (s) => {
      if (typeof DOMParser !== 'undefined') {
        return new DOMParser().parseFromString(s, 'text/html').documentElement.textContent;
      }
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', eacute: 'é', hellip: '…', mdash: '—', ndash: '–' };
      return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
        return named[e] ?? m;
      });
    },
  },
  hex: {
    name: 'Hex',
    encode: (s) => [...utf8.enc.encode(s)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    decode: (s) => {
      const clean = s.replace(/^0x/i, '').replace(/[\s:,-]/g, '');
      if (clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error('Not valid hex');
      return utf8.dec.decode(Uint8Array.from(clean.match(/../g) || [], (h) => parseInt(h, 16)));
    },
  },
  binary: {
    name: 'Binary',
    encode: (s) => [...utf8.enc.encode(s)].map((b) => b.toString(2).padStart(8, '0')).join(' '),
    decode: (s) => {
      const bits = s.replace(/[^01]/g, '');
      if (bits.length % 8) throw new Error('Bit count is not a multiple of 8');
      return utf8.dec.decode(Uint8Array.from(bits.match(/.{8}/g) || [], (b) => parseInt(b, 2)));
    },
  },
  unicode: {
    name: 'Unicode escapes (\\uXXXX)',
    encode: (s) => [...s].map((c) => {
      const cp = c.codePointAt(0);
      if (cp < 0x80) return c;
      return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
    }).join(''),
    decode: (s) => s.replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b, c) => String.fromCodePoint(parseInt(a || b || c, 16))),
  },
  rot13: {
    name: 'ROT13',
    encode: (s) => s.replace(/[a-z]/gi, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }),
    decode: (s) => codecs.rot13.encode(s),
  },
};

export default {
  id: 'encode',
  name: 'Encode / Decode',
  icon: 'b64',
  hint: 'Base64, URL, HTML entities, hex, binary, unicode escapes and number bases.',

  async mount(body) {
    const state = await loadToolState('encode', { codec: 'base64', input: '', live: true });

    const codec = el('select', {}, ...Object.entries(codecs).map(([k, c]) => el('option', { value: k }, c.name)));
    codec.value = state.codec in codecs ? state.codec : 'base64';
    const live = el('input', { type: 'checkbox' });
    live.checked = state.live !== false;

    const input = el('textarea', { class: 'mono', placeholder: 'Plain text' }, state.input);
    const output = el('textarea', { class: 'mono', placeholder: 'Encoded text' });
    const status = el('div', { class: 'status' });

    body.append(
      el('div', { class: 'toolbar' },
        codec,
        el('button', { class: 'btn btn-primary', onclick: () => encode() }, 'Encode →'),
        el('button', { class: 'btn', onclick: () => decode() }, '← Decode'),
        el('button', { class: 'btn', title: 'Swap input and output', onclick: swap }, '⇄ Swap'),
        el('label', { class: 'inline' }, live, 'Encode as you type'),
      ),
      el('div', { class: 'split' },
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Plain', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: () => copyText(input.value) }, 'Copy')), input),
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Encoded', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: () => copyText(output.value) }, 'Copy')), output),
      ),
      status,
      numberBases(),
    );

    function encode() {
      try {
        output.value = codecs[codec.value].encode(input.value);
        status.replaceChildren(el('span', { class: 'ok' }, `Encoded · ${output.value.length} chars`));
      } catch (err) {
        status.replaceChildren(el('span', { class: 'error' }, err.message));
      }
    }
    function decode() {
      try {
        input.value = codecs[codec.value].decode(output.value);
        status.replaceChildren(el('span', { class: 'ok' }, `Decoded · ${input.value.length} chars`));
        saveState();
      } catch (err) {
        status.replaceChildren(el('span', { class: 'error' }, 'Cannot decode: ' + err.message));
      }
    }
    function swap() {
      [input.value, output.value] = [output.value, input.value];
      saveState();
    }
    const saveState = debounce(() => saveToolState('encode', { input: input.value, codec: codec.value, live: live.checked }), 300);

    input.addEventListener('input', () => { if (live.checked) encode(); saveState(); });
    output.addEventListener('input', () => { if (live.checked) decode(); });
    codec.addEventListener('change', () => { if (live.checked && input.value) encode(); saveState(); });
    live.addEventListener('change', saveState);

    if (input.value) encode();
    input.focus();
  },
};

function numberBases() {
  const fields = {
    dec: el('input', { type: 'text', class: 'mono', placeholder: '255' }),
    hex: el('input', { type: 'text', class: 'mono', placeholder: 'ff' }),
    oct: el('input', { type: 'text', class: 'mono', placeholder: '377' }),
    bin: el('input', { type: 'text', class: 'mono', placeholder: '11111111' }),
  };
  const radix = { dec: 10, hex: 16, oct: 8, bin: 2 };
  const err = el('span', { class: 'error small' });
  for (const [k, field] of Object.entries(fields)) {
    field.addEventListener('input', () => {
      const raw = field.value.trim().replace(/^0[xXoObB]/, '').replace(/[_\s]/g, '');
      err.textContent = '';
      if (!raw) { for (const f of Object.values(fields)) if (f !== field) f.value = ''; return; }
      let n;
      try {
        n = k === 'dec' ? BigInt(raw) : BigInt((k === 'hex' ? '0x' : k === 'oct' ? '0o' : '0b') + raw);
      } catch {
        err.textContent = 'Invalid ' + k;
        return;
      }
      for (const [key, f] of Object.entries(fields)) if (f !== field) f.value = n.toString(radix[key]);
    });
  }
  return el('div', { class: 'card' },
    el('h3', {}, 'Number bases'),
    el('div', { class: 'row', style: { alignItems: 'end' } },
      ...Object.entries(fields).map(([k, f]) => el('div', { class: 'grow' }, el('label', {}, { dec: 'Decimal', hex: 'Hex', oct: 'Octal', bin: 'Binary' }[k]), f)),
    ),
    err,
  );
}
