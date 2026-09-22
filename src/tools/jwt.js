import { el, toast, copyText, debounce, relativeTime, fmtDate, highlightJson } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

const utf8 = { enc: new TextEncoder(), dec: new TextDecoder() };

export function b64urlDecodeBytes(s) {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function b64urlEncodeBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlEncode = (s) => b64urlEncodeBytes(utf8.enc.encode(s));

export function decodeJwt(token) {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error(`Expected 3 dot-separated parts, got ${parts.length}`);
  const [h, p, s] = parts;
  let header, payload;
  try { header = JSON.parse(utf8.dec.decode(b64urlDecodeBytes(h))); } catch { throw new Error('Header is not valid base64url JSON'); }
  try { payload = JSON.parse(utf8.dec.decode(b64urlDecodeBytes(p))); } catch { throw new Error('Payload is not valid base64url JSON'); }
  return { header, payload, signature: s, signingInput: `${h}.${p}` };
}

function pemToBytes(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

const ALG = {
  HS256: { kind: 'HMAC', hash: 'SHA-256' }, HS384: { kind: 'HMAC', hash: 'SHA-384' }, HS512: { kind: 'HMAC', hash: 'SHA-512' },
  RS256: { kind: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, RS384: { kind: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, RS512: { kind: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
  PS256: { kind: 'RSA-PSS', hash: 'SHA-256', salt: 32 }, PS384: { kind: 'RSA-PSS', hash: 'SHA-384', salt: 48 }, PS512: { kind: 'RSA-PSS', hash: 'SHA-512', salt: 64 },
  ES256: { kind: 'ECDSA', hash: 'SHA-256', curve: 'P-256' }, ES384: { kind: 'ECDSA', hash: 'SHA-384', curve: 'P-384' }, ES512: { kind: 'ECDSA', hash: 'SHA-512', curve: 'P-521' },
};

export async function verifyJwt(decoded, secretOrPem, { secretIsBase64 = false } = {}) {
  const alg = ALG[decoded.header.alg];
  if (!alg) throw new Error(`Unsupported alg: ${decoded.header.alg}`);
  const data = utf8.enc.encode(decoded.signingInput);
  const sig = b64urlDecodeBytes(decoded.signature);
  if (alg.kind === 'HMAC') {
    const keyBytes = secretIsBase64 ? b64urlDecodeBytes(secretOrPem) : utf8.enc.encode(secretOrPem);
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: alg.hash }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, sig, data);
  }
  const spki = pemToBytes(secretOrPem);
  if (alg.kind === 'ECDSA') {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: alg.curve }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: alg.hash }, key, sig, data);
  }
  const key = await crypto.subtle.importKey('spki', spki, { name: alg.kind, hash: alg.hash }, false, ['verify']);
  const params = alg.kind === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: alg.salt } : { name: alg.kind };
  return crypto.subtle.verify(params, key, sig, data);
}

export async function signHs(header, payload, secret, { secretIsBase64 = false } = {}) {
  const alg = ALG[header.alg];
  if (!alg || alg.kind !== 'HMAC') throw new Error('Signing supports HS256, HS384 and HS512 only');
  const input = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  const keyBytes = secretIsBase64 ? b64urlDecodeBytes(secret) : utf8.enc.encode(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: alg.hash }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.enc.encode(input)));
  return `${input}.${b64urlEncodeBytes(sig)}`;
}

const TIME_CLAIMS = { exp: 'Expires', iat: 'Issued at', nbf: 'Not before', auth_time: 'Auth time' };

export default {
  id: 'jwt',
  name: 'JWT',
  icon: 'JWT',
  hint: 'Decode tokens, check expiry, verify signatures (HS/RS/PS/ES) and sign HS tokens. Nothing leaves the browser.',

  async mount(body) {
    const state = await loadToolState('jwt', { token: '', secret: '', secretB64: false, tab: 'decode' });

    const token = el('textarea', { class: 'mono', placeholder: 'eyJhbGciOi…', spellcheck: 'false', style: { minHeight: '90px' } }, state.token);
    const secret = el('textarea', { class: 'mono', placeholder: 'HMAC secret, or PEM public key for RS/PS/ES', spellcheck: 'false', style: { minHeight: '60px' } }, state.secret);
    const secretB64 = el('input', { type: 'checkbox' });
    secretB64.checked = !!state.secretB64;
    const verifyResult = el('span');
    const status = el('div', { class: 'status' });
    const headerOut = el('pre', { class: 'output mono', style: { minHeight: '80px' } });
    const payloadOut = el('pre', { class: 'output mono', style: { minHeight: '120px' } });
    const claims = el('div', { class: 'kv' });

    // Sign panel
    const signHeader = el('textarea', { class: 'mono', style: { minHeight: '70px' }, spellcheck: 'false' }, '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    const signPayload = el('textarea', { class: 'mono', style: { minHeight: '120px' }, spellcheck: 'false' },
      JSON.stringify({ sub: '1234567890', name: 'Jane Doe', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, null, 2));
    const signOut = el('textarea', { class: 'mono', readonly: true, style: { minHeight: '90px' }, placeholder: 'Signed token appears here' });

    const decodePanel = el('div', { class: 'col' },
      el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Token', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: pasteToken }, 'Paste'), el('button', { class: 'btn btn-sm', onclick: () => { token.value = ''; decode(); } }, 'Clear')), token),
      status,
      el('div', { class: 'split' },
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Header', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: () => copyText(headerOut.textContent) }, 'Copy')), headerOut),
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Payload', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: () => copyText(payloadOut.textContent) }, 'Copy')), payloadOut),
      ),
      el('div', { class: 'card' }, el('h3', {}, 'Time claims'), claims),
      el('div', { class: 'card col' },
        el('h3', {}, 'Verify signature'),
        secret,
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-primary', onclick: verify }, 'Verify'),
          el('label', { class: 'inline' }, secretB64, 'Secret is base64url encoded'),
          verifyResult,
        ),
      ),
    );

    const signPanel = el('div', { class: 'col' },
      el('div', { class: 'split' },
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Header'), signHeader),
        el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Payload'), signPayload),
      ),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-primary', onclick: sign }, 'Sign with secret above'),
        el('span', { class: 'muted small' }, 'Uses the secret from the Verify box. HS256/384/512 only.'),
      ),
      el('div', { class: 'pane' }, el('div', { class: 'pane-title' }, 'Token', el('span', { class: 'spacer' }), el('button', { class: 'btn btn-sm', onclick: () => copyText(signOut.value, 'Token copied') }, 'Copy'), el('button', { class: 'btn btn-sm', onclick: () => { token.value = signOut.value; setTab('decode'); decode(); } }, 'Decode it')), signOut),
    );

    const tabs = ['decode', 'sign'].map((t) => el('button', { class: 'btn btn-sm', dataset: { tab: t }, onclick: () => setTab(t) }, t === 'decode' ? 'Decode & verify' : 'Sign'));
    body.append(el('div', { class: 'toolbar' }, ...tabs), decodePanel, signPanel);

    function setTab(t) {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
      decodePanel.classList.toggle('hidden', t !== 'decode');
      signPanel.classList.toggle('hidden', t !== 'sign');
      saveToolState('jwt', { tab: t });
    }

    let decoded = null;

    function decode() {
      const value = token.value.trim().replace(/^Bearer\s+/i, '');
      verifyResult.textContent = '';
      status.replaceChildren();
      claims.replaceChildren();
      headerOut.textContent = '';
      payloadOut.textContent = '';
      decoded = null;
      if (!value) return;
      try {
        decoded = decodeJwt(value);
      } catch (err) {
        status.append(el('span', { class: 'error' }, '✕ ' + err.message));
        return;
      }
      headerOut.innerHTML = highlightJson(JSON.stringify(decoded.header, null, 2));
      payloadOut.innerHTML = highlightJson(JSON.stringify(decoded.payload, null, 2));

      const now = Date.now();
      const badges = [el('span', { class: 'badge badge-info' }, decoded.header.alg || 'no alg')];
      if (decoded.header.alg === 'none') badges.push(el('span', { class: 'badge badge-error' }, 'alg=none: unsigned'));
      if (typeof decoded.payload.exp === 'number') {
        const expired = decoded.payload.exp * 1000 < now;
        badges.push(el('span', { class: 'badge ' + (expired ? 'badge-error' : 'badge-ok') }, expired ? 'Expired ' + relativeTime(decoded.payload.exp * 1000) : 'Expires ' + relativeTime(decoded.payload.exp * 1000)));
      }
      if (typeof decoded.payload.nbf === 'number' && decoded.payload.nbf * 1000 > now) badges.push(el('span', { class: 'badge badge-warn' }, 'Not yet valid'));
      status.append(...badges, el('span', {}, `${value.length} chars · signature ${decoded.signature.length} chars`));

      for (const [claim, label] of Object.entries(TIME_CLAIMS)) {
        const v = decoded.payload[claim];
        if (typeof v !== 'number') continue;
        const ms = v * 1000;
        claims.append(
          el('span', { class: 'k' }, `${label} (${claim})`),
          el('span', { class: 'v' }, `${fmtDate(ms)} · ${new Date(ms).toISOString()} · ${relativeTime(ms)}`),
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => copyText(String(v)) }, 'Copy'),
        );
      }
      if (!claims.children.length) claims.append(el('span', { class: 'muted small' }, 'No exp / iat / nbf claims.'));
    }

    async function verify() {
      if (!decoded) return toast('Decode a token first', 'error');
      if (!secret.value.trim()) return toast('Enter a secret or public key', 'error');
      verifyResult.textContent = '…';
      try {
        const ok = await verifyJwt(decoded, secret.value.trim(), { secretIsBase64: secretB64.checked });
        verifyResult.replaceChildren(el('span', { class: 'badge ' + (ok ? 'badge-ok' : 'badge-error') }, ok ? '✓ Signature valid' : '✕ Signature invalid'));
      } catch (err) {
        verifyResult.replaceChildren(el('span', { class: 'badge badge-error' }, err.message));
      }
    }

    async function sign() {
      try {
        const header = JSON.parse(signHeader.value);
        const payload = JSON.parse(signPayload.value);
        if (!secret.value) throw new Error('Enter a secret in the Verify box first');
        signOut.value = await signHs(header, payload, secret.value, { secretIsBase64: secretB64.checked });
        toast('Signed', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function pasteToken() {
      try {
        token.value = await navigator.clipboard.readText();
        decode();
        persist();
      } catch {
        toast('Clipboard read not permitted', 'error');
      }
    }

    const persist = debounce(() => saveToolState('jwt', { token: token.value, secret: secret.value, secretB64: secretB64.checked }), 300);
    token.addEventListener('input', () => { decode(); persist(); });
    secret.addEventListener('input', persist);
    secretB64.addEventListener('change', persist);

    setTab(state.tab === 'sign' ? 'sign' : 'decode');
    decode();
    token.focus();
  },
};
