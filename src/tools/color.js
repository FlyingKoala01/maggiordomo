import { el, copyText, debounce } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

// Parse any CSS color the browser understands, via a canvas context.
export function parseColor(input) {
  const ctx = document.createElement('canvas').getContext('2d');
  const probe = (sentinel) => {
    ctx.fillStyle = sentinel;
    ctx.fillStyle = input;
    return ctx.fillStyle;
  };
  let out = probe('#000000');
  if (out === '#000000') {
    out = probe('#ffffff');
    if (out === '#ffffff') return null;
  }
  if (out.startsWith('#')) {
    return { r: parseInt(out.slice(1, 3), 16), g: parseInt(out.slice(3, 5), 16), b: parseInt(out.slice(5, 7), 16), a: 1 };
  }
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(out);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
export const toHex = ({ r, g, b, a = 1 }) => `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;

export function luminance({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const fmt = (n, d = 0) => Number(n.toFixed(d)).toString();

export default {
  id: 'color',
  name: 'Color',
  icon: '◧',
  hint: 'Convert between hex, rgb and hsl, check WCAG contrast and pull shades.',

  async mount(body) {
    const state = await loadToolState('color', { input: '#f5c842' });
    const input = el('input', { type: 'text', class: 'mono grow', placeholder: '#3b82f6, rgb(59 130 246), hsl(217 91% 60%), rebeccapurple, oklch(…)', value: state.input });
    const picker = el('input', { type: 'color' });
    const swatch = el('div', { class: 'swatch' });
    const error = el('span', { class: 'error small' });
    const values = el('div', { class: 'kv' });
    const shades = el('div', { class: 'shade-row' });
    const tints = el('div', { class: 'shade-row' });
    const contrastGrid = el('div', { class: 'contrast-grid' });
    const bgInput = el('input', { type: 'text', class: 'mono', placeholder: 'custom background', style: { width: '180px' } });

    body.append(
      el('div', { class: 'row' }, input, picker),
      error,
      swatch,
      el('div', { class: 'card' }, values),
      el('div', { class: 'card col' }, el('h3', {}, 'Shades'), shades, el('h3', {}, 'Tints'), tints, el('span', { class: 'muted small' }, 'Click a swatch to copy its hex.')),
      el('div', { class: 'card col' }, el('h3', {}, 'Contrast (WCAG 2.1)'), el('div', { class: 'row' }, el('span', { class: 'muted small' }, 'Against white, black and:'), bgInput), contrastGrid),
    );

    function update() {
      saveToolState('color', { input: input.value });
      const rgb = parseColor(input.value.trim());
      values.replaceChildren();
      shades.replaceChildren();
      tints.replaceChildren();
      contrastGrid.replaceChildren();
      if (!rgb) {
        error.textContent = input.value.trim() ? 'Not a color the browser understands' : '';
        swatch.style.background = 'transparent';
        return;
      }
      error.textContent = '';
      const hsl = rgbToHsl(rgb);
      const hex = toHex(rgb);
      swatch.style.background = hex;
      picker.value = hex.slice(0, 7);

      const rows = [
        ['HEX', hex],
        ['RGB', `rgb(${fmt(rgb.r)} ${fmt(rgb.g)} ${fmt(rgb.b)}${rgb.a < 1 ? ' / ' + fmt(rgb.a, 2) : ''})`],
        ['RGB (legacy)', `rgb${rgb.a < 1 ? 'a' : ''}(${fmt(rgb.r)}, ${fmt(rgb.g)}, ${fmt(rgb.b)}${rgb.a < 1 ? ', ' + fmt(rgb.a, 2) : ''})`],
        ['HSL', `hsl(${fmt(hsl.h)} ${fmt(hsl.s)}% ${fmt(hsl.l)}%${rgb.a < 1 ? ' / ' + fmt(rgb.a, 2) : ''})`],
        ['Luminance', fmt(luminance(rgb), 4)],
        ['Int / ARGB', `0x${hex2(rgb.a * 255).toUpperCase()}${hex.slice(1, 7).toUpperCase()}`],
        ['CSS var', `--color: ${hex};`],
      ];
      for (const [k, v] of rows) values.append(el('span', { class: 'k' }, k), el('span', { class: 'v' }, v), el('button', { class: 'btn btn-sm btn-ghost', onclick: () => copyText(v) }, 'Copy'));

      for (let i = 9; i >= 1; i--) {
        const c = hslToRgb({ h: hsl.h, s: hsl.s, l: (hsl.l * i) / 10 });
        shades.append(shade(c));
      }
      for (let i = 1; i <= 9; i++) {
        const c = hslToRgb({ h: hsl.h, s: hsl.s, l: hsl.l + ((100 - hsl.l) * i) / 10 });
        tints.append(shade(c));
      }

      const white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 };
      const bgs = [['White', white], ['Black', black]];
      const custom = parseColor(bgInput.value.trim());
      if (custom) bgs.push(['Custom', custom]);
      for (const [label, bg] of bgs) {
        const ratio = contrast(rgb, bg);
        const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail';
        contrastGrid.append(el('div', { class: 'contrast-sample', style: { background: toHex(bg), color: hex } },
          el('div', { style: { fontWeight: 600 } }, `${label}: ${ratio.toFixed(2)}:1`),
          el('div', { class: 'small' }, 'The quick brown fox · ', el('span', { class: 'badge', style: { background: 'rgba(128,128,128,.25)', color: 'inherit' } }, grade)),
        ));
        const inv = contrast(bg, rgb);
        contrastGrid.append(el('div', { class: 'contrast-sample', style: { background: hex, color: toHex(bg) } },
          el('div', { style: { fontWeight: 600 } }, `${label} text: ${inv.toFixed(2)}:1`),
          el('div', { class: 'small' }, 'The quick brown fox'),
        ));
      }
    }

    function shade(c) {
      const h = toHex(c);
      const textColor = contrast(c, { r: 255, g: 255, b: 255 }) > contrast(c, { r: 0, g: 0, b: 0 }) ? '#fff' : '#000';
      return el('div', { class: 'shade', style: { background: h, color: textColor }, title: h, onclick: () => copyText(h) }, h);
    }

    input.addEventListener('input', debounce(update, 100));
    bgInput.addEventListener('input', debounce(update, 100));
    picker.addEventListener('input', () => { input.value = picker.value; update(); });
    update();
    input.focus();
  },
};
