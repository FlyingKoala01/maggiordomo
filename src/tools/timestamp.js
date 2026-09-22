import { el, copyText, relativeTime, debounce } from '../shared/util.js';
import { loadToolState, saveToolState } from '../shared/storage.js';

export function parseInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (s.replace('-', '').length <= 10) return new Date(n * 1000);
    if (s.replace('-', '').length <= 13) return new Date(n);
    if (s.replace('-', '').length <= 16) return new Date(n / 1000);
    return new Date(n / 1e6);
  }
  if (/^-?\d+\.\d+$/.test(s)) return new Date(Number(s) * 1000);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

export function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return { year: date.getUTCFullYear(), week: Math.ceil(((date - yearStart) / 864e5 + 1) / 7) };
}

function dayOfYear(d) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
}

const ZONES = ['UTC', 'Europe/London', 'Europe/Madrid', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'];

export default {
  id: 'timestamp',
  name: 'Timestamp',
  icon: '⏱',
  hint: 'Unix seconds, milliseconds, ISO 8601 and local time, converted every direction.',

  async mount(body) {
    const state = await loadToolState('timestamp', { input: '', zones: ['UTC', 'America/New_York', 'Asia/Tokyo'] });

    const clockS = el('span', { class: 'clock copyable', title: 'Click to copy', onclick: (e) => copyText(e.target.textContent) });
    const clockMs = el('span', { class: 'clock copyable', title: 'Click to copy', onclick: (e) => copyText(e.target.textContent) });
    const clockIso = el('span', { class: 'mono copyable', onclick: (e) => copyText(e.target.textContent) });
    const clockLocal = el('span', { class: 'mono' });

    const input = el('input', { type: 'text', class: 'mono grow', placeholder: '1700000000, 1700000000000, 2024-01-31T12:00:00Z, "next friday" won\'t work but most date strings do', value: state.input });
    const picker = el('input', { type: 'datetime-local', step: '1', style: { width: 'auto' } });
    const status = el('span', { class: 'status' });
    const results = el('div', { class: 'kv' });
    const zonesHost = el('div', { class: 'kv' });
    const zoneSelect = el('select', { style: { width: 'auto' } }, ...ZONES.map((z) => el('option', { value: z }, z)));
    const customZone = el('input', { type: 'text', placeholder: 'IANA zone, e.g. Europe/Rome', style: { width: '220px' } });
    let zones = state.zones;

    body.append(
      el('div', { class: 'card' },
        el('h3', {}, 'Now'),
        el('div', { class: 'row gap-lg' },
          el('div', {}, el('label', {}, 'Unix seconds'), clockS),
          el('div', {}, el('label', {}, 'Unix milliseconds'), clockMs),
          el('div', {}, el('label', {}, 'ISO 8601 (UTC)'), clockIso),
          el('div', {}, el('label', {}, 'Local'), clockLocal),
        ),
      ),
      el('div', { class: 'card col' },
        el('h3', {}, 'Convert'),
        el('div', { class: 'row' },
          input, picker,
          el('button', { class: 'btn', onclick: () => { input.value = String(Math.floor(Date.now() / 1000)); convert(); } }, 'Now'),
          el('button', { class: 'btn btn-ghost', onclick: () => { input.value = ''; convert(); } }, 'Clear'),
        ),
        status,
        results,
      ),
      el('div', { class: 'card col' },
        el('h3', {}, 'In other time zones'),
        el('div', { class: 'row' }, zoneSelect, el('button', { class: 'btn btn-sm', onclick: () => addZone(zoneSelect.value) }, 'Add'), customZone, el('button', { class: 'btn btn-sm', onclick: () => addZone(customZone.value.trim()) }, 'Add custom')),
        zonesHost,
      ),
    );

    let current = null;

    function tick() {
      const now = new Date();
      clockS.textContent = Math.floor(now / 1000);
      clockMs.textContent = now.getTime();
      clockIso.textContent = now.toISOString();
      clockLocal.textContent = now.toLocaleString();
    }
    tick();
    const timer = setInterval(tick, 1000);

    function convert() {
      results.replaceChildren();
      status.replaceChildren();
      current = null;
      saveToolState('timestamp', { input: input.value });
      if (!input.value.trim()) return renderZones();
      const d = parseInput(input.value);
      if (!d || isNaN(d)) {
        status.append(el('span', { class: 'error' }, 'Could not parse that date'));
        return renderZones();
      }
      current = d;
      const w = isoWeek(d);
      const rows = [
        ['Unix seconds', String(Math.floor(d.getTime() / 1000))],
        ['Unix milliseconds', String(d.getTime())],
        ['ISO 8601 UTC', d.toISOString()],
        ['ISO 8601 local', isoLocal(d)],
        ['RFC 2822 / HTTP', d.toUTCString()],
        ['Local', d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })],
        ['Relative', relativeTime(d.getTime())],
        ['Day', `${d.toLocaleDateString(undefined, { weekday: 'long' })} · day ${dayOfYear(d)} of the year · ISO week ${w.week} of ${w.year}`],
        ['Date only', d.toISOString().slice(0, 10)],
      ];
      for (const [k, v] of rows) {
        results.append(el('span', { class: 'k' }, k), el('span', { class: 'v' }, v), el('button', { class: 'btn btn-sm btn-ghost', onclick: () => copyText(v) }, 'Copy'));
      }
      try {
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
        picker.value = local.toISOString().slice(0, 19);
      } catch { /* out of range */ }
      renderZones();
    }

    function renderZones() {
      zonesHost.replaceChildren();
      const d = current || new Date();
      for (const zone of zones) {
        let text;
        try {
          text = new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'long' }).format(d);
        } catch {
          text = 'unknown zone';
        }
        zonesHost.append(
          el('span', { class: 'k' }, zone),
          el('span', { class: 'v' }, text),
          el('button', { class: 'btn btn-sm btn-ghost btn-danger', title: 'Remove', onclick: () => { zones = zones.filter((z) => z !== zone); saveToolState('timestamp', { zones }); renderZones(); } }, '✕'),
        );
      }
      if (!current) zonesHost.append(el('span', { class: 'muted small', style: { gridColumn: '1 / -1' } }, 'Showing the current time. Enter a value above to convert it.'));
    }

    function addZone(zone) {
      if (!zone) return;
      try { new Intl.DateTimeFormat(undefined, { timeZone: zone }); } catch { return status.replaceChildren(el('span', { class: 'error' }, 'Unknown time zone: ' + zone)); }
      if (!zones.includes(zone)) zones.push(zone);
      saveToolState('timestamp', { zones });
      renderZones();
    }

    input.addEventListener('input', debounce(convert, 150));
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      input.value = new Date(picker.value).toISOString();
      convert();
    });

    convert();
    input.focus();
    return { cleanup: () => clearInterval(timer) };
  },
};
