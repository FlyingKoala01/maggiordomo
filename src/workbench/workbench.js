import { $, el, toast, download, pickFile } from '../shared/util.js';
import { storage } from '../shared/storage.js';
import tools from '../tools/index.js';

const nav = $('#nav');
const main = $('#main');
let current = null;

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [id, query = ''] = raw.split('?');
  return { id: id || tools[0].id, params: new URLSearchParams(query) };
}

function renderNav(activeId) {
  nav.replaceChildren(
    ...tools.map((tool, i) => el('a', {
      href: '#' + tool.id,
      class: tool.id === activeId ? 'active' : '',
      title: tool.hint || tool.name,
    },
      el('span', { class: 'icon' }, tool.icon),
      el('span', {}, tool.name),
      i < 9 ? el('span', { class: 'nav-key' }, `alt+${i + 1}`) : null,
    )),
  );
}

async function route() {
  const { id, params } = parseHash();
  const tool = tools.find((t) => t.id === id) || tools[0];
  if (current?.cleanup) {
    try { current.cleanup(); } catch (err) { console.warn(err); }
  }
  renderNav(tool.id);
  document.title = `${tool.name} — Maggiordomo`;

  const root = el('section', { class: 'tool', dataset: { tool: tool.id } },
    el('div', { class: 'tool-header' }, el('h1', {}, tool.name), tool.hint ? el('span', { class: 'hint' }, tool.hint) : null),
  );
  const body = el('div', { class: 'tool-body' + (tool.fill ? ' fill' : '') });
  root.append(body);
  main.replaceChildren(root);

  try {
    current = (await tool.mount(body, { params })) || {};
  } catch (err) {
    console.error(err);
    body.append(el('div', { class: 'card' }, el('p', { class: 'error' }, 'This tool failed to load: ' + err.message)));
  }
}

async function applyTheme(next) {
  const settings = await storage.get('settings', {});
  const theme = next || settings.theme || 'dark';
  document.documentElement.dataset.theme = theme;
  if (next) await storage.set('settings', { ...settings, theme });
}

// Opt-in download features. Each switch requests its optional permissions when turned on and
// releases the ones no other switch still needs when turned off.
const DOWNLOAD_SWITCHES = [
  { el: $('#intercept-downloads'), key: 'interceptDownloads', perms: ['downloads'], on: 'Word / Excel downloads will open in the viewer', off: 'Downloads left alone' },
  { el: $('#dedupe-downloads'), key: 'dedupeDownloads', perms: ['downloads', 'downloads.open', 'notifications'], on: 'Duplicate downloads will be skipped', off: 'Duplicate check disabled' },
];
(async () => {
  const settings = await storage.get('settings', {});
  for (const sw of DOWNLOAD_SWITCHES) {
    const granted = await chrome.permissions.contains({ permissions: sw.perms });
    sw.el.checked = !!settings[sw.key] && granted;
  }
})();
for (const sw of DOWNLOAD_SWITCHES) {
  sw.el.addEventListener('change', async () => {
    const settings = await storage.get('settings', {});
    if (sw.el.checked) {
      const ok = await chrome.permissions.request({ permissions: sw.perms });
      if (!ok) {
        sw.el.checked = false;
        toast('Permission not granted', 'error');
        return;
      }
      await storage.set('settings', { ...settings, [sw.key]: true });
      toast(sw.on, 'ok');
    } else {
      const next = { ...settings, [sw.key]: false };
      await storage.set('settings', next);
      const stillNeeded = new Set(DOWNLOAD_SWITCHES.filter((o) => next[o.key]).flatMap((o) => o.perms));
      const release = sw.perms.filter((p) => !stillNeeded.has(p));
      if (release.length) await chrome.permissions.remove({ permissions: release }).catch(() => {});
      toast(sw.off, 'info');
    }
  });
}

$('#theme-toggle').addEventListener('click', () => {
  const now = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(now);
});

$('#export-all').addEventListener('click', async () => {
  const data = await storage.all();
  const stamp = new Date().toISOString().slice(0, 10);
  download(`maggiordomo-backup-${stamp}.json`, JSON.stringify({ app: 'maggiordomo', version: 1, exportedAt: Date.now(), data }, null, 2), 'application/json');
});

$('#import-all').addEventListener('click', async () => {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed?.app === 'maggiordomo' ? parsed.data : parsed;
    if (!data || typeof data !== 'object') throw new Error('Not a Maggiordomo export');
    const existing = await storage.all();
    // Merge links by URL, replace everything else.
    if (Array.isArray(data.links) && Array.isArray(existing.links)) {
      const seen = new Set(existing.links.map((l) => l.url));
      data.links = [...existing.links, ...data.links.filter((l) => l?.url && !seen.has(l.url))];
    }
    if (Array.isArray(data.mdDocs) && Array.isArray(existing.mdDocs)) {
      const seen = new Set(existing.mdDocs.map((d) => d.id));
      data.mdDocs = [...existing.mdDocs, ...data.mdDocs.filter((d) => d?.id && !seen.has(d.id))];
    }
    await chrome.storage.local.set(data);
    toast('Import complete', 'ok');
    route();
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
    const tool = tools[Number(e.key) - 1];
    if (tool) {
      e.preventDefault();
      location.hash = '#' + tool.id;
    }
  }
});

window.addEventListener('hashchange', route);
applyTheme().then(route);
