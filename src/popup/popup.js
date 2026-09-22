import { $, $$, el, toast, copyText, openWorkbench } from '../shared/util.js';
import { storage } from '../shared/storage.js';
import { getLinks, addLink, touchLink, filterLinks, sortLinks, hostOf, faviconUrl } from '../shared/links.js';

const list = $('#list');
const search = $('#search');
const tagsHost = $('#tags');

let links = [];
let focused = -1;
let activeTag = '';

async function applyTheme() {
  const settings = await storage.get('settings', {});
  document.documentElement.dataset.theme = settings.theme || 'dark';
}

async function load() {
  links = await getLinks();
  render();
}

function currentQuery() {
  return `${search.value} ${activeTag ? '#' + activeTag : ''}`.trim();
}

function render() {
  const visible = sortLinks(filterLinks(links, currentQuery()), 'recent');
  list.replaceChildren();
  renderTags();

  if (!links.length) {
    list.append(el('div', { class: 'empty' }, 'No dev links yet. Save the current tab or right-click any link.'));
    return;
  }
  if (!visible.length) {
    list.append(el('div', { class: 'empty' }, 'No matches.'));
    return;
  }

  focused = Math.min(focused, visible.length - 1);
  visible.slice(0, 200).forEach((link, i) => {
    const icon = el('img', { src: faviconUrl(link.url), alt: '' });
    icon.addEventListener('error', () => icon.replaceWith(el('span', { class: 'letter' }, hostOf(link.url)[0] || '?')));
    const item = el('a', {
      class: 'link-item' + (i === focused ? ' focused' : ''),
      href: link.url,
      title: link.url,
      onclick: (e) => {
        e.preventDefault();
        openLink(link, e.ctrlKey || e.metaKey);
      },
    },
      icon,
      el('div', { class: 'body' },
        el('div', { class: 'title' }, link.pinned ? el('span', { class: 'pin' }, '★ ') : null, link.title),
        el('div', { class: 'url' }, hostOf(link.url), link.tags?.length ? '  ·  ' + link.tags.map((t) => '#' + t).join(' ') : ''),
      ),
      el('button', {
        class: 'btn btn-ghost btn-sm copy',
        title: 'Copy URL',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          copyText(link.url, 'URL copied');
        },
      }, '⧉'),
    );
    list.append(item);
  });
}

function renderTags() {
  const counts = new Map();
  for (const l of links) for (const t of l.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  tagsHost.replaceChildren(
    ...top.map(([tag]) => el('span', {
      class: 'chip' + (activeTag === tag ? ' active' : ''),
      onclick: () => {
        activeTag = activeTag === tag ? '' : tag;
        focused = -1;
        render();
      },
    }, '#' + tag)),
  );
}

async function openLink(link, background = false) {
  await touchLink(link.id);
  await chrome.tabs.create({ url: link.url, active: !background });
  if (!background) window.close();
}

search.addEventListener('input', () => {
  focused = -1;
  render();
});

search.addEventListener('keydown', (e) => {
  const items = $$('.link-item', list);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focused = Math.min(focused + 1, items.length - 1);
    items.forEach((n, i) => n.classList.toggle('focused', i === focused));
    items[focused]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focused = Math.max(focused - 1, 0);
    items.forEach((n, i) => n.classList.toggle('focused', i === focused));
    items[focused]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const target = items[focused >= 0 ? focused : 0];
    if (target) target.click();
    else if (search.value.trim()) openWorkbench('#links?q=' + encodeURIComponent(search.value.trim()));
  } else if (e.key === 'Escape') {
    if (search.value) {
      search.value = '';
      render();
    } else window.close();
  }
});

$('#save-tab').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
    toast('This page cannot be saved', 'error');
    return;
  }
  try {
    const { duplicate } = await addLink({ title: tab.title, url: tab.url });
    toast(duplicate ? 'Already saved' : 'Saved', duplicate ? 'info' : 'ok');
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#open-workbench').addEventListener('click', () => openWorkbench('#links'));

$$('.popup-tools a').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openWorkbench('#' + a.dataset.tool);
  });
});

storage.onChange('links', load);
applyTheme();
load();
