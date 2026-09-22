import { $, el, toast, copyText, download, pickFile, fmtDate } from '../shared/util.js';
import { storage, loadToolState, saveToolState } from '../shared/storage.js';
import {
  getLinks, saveLinks, addLink, updateLink, removeLink, touchLink,
  filterLinks, sortLinks, hostOf, faviconUrl, cleanTags,
} from '../shared/links.js';

export default {
  id: 'links',
  name: 'Dev links',
  icon: '🔗',
  hint: 'Bookmarks for the things you keep looking up. Search with words or #tags.',

  async mount(body, { params }) {
    const state = await loadToolState('links', { sort: 'recent' });
    let links = await getLinks();
    let query = params.get('q') || '';
    let editing = null; // link id being edited, or 'new'

    const search = el('input', { type: 'search', placeholder: 'Search… (#tag, words)', value: query, class: 'grow' });
    const sort = el('select', {},
      el('option', { value: 'recent' }, 'Newest first'),
      el('option', { value: 'title' }, 'Title A–Z'),
      el('option', { value: 'domain' }, 'Domain'),
      el('option', { value: 'visits' }, 'Most opened'),
    );
    sort.value = state.sort;
    const count = el('span', { class: 'muted small' });

    const toolbar = el('div', { class: 'toolbar' },
      search, sort, count,
      el('button', { class: 'btn btn-primary', onclick: () => openForm('new') }, '+ Add link'),
      el('button', { class: 'btn', title: 'Import JSON or a Chrome bookmarks HTML export', onclick: importLinks }, 'Import'),
      el('button', { class: 'btn', onclick: exportLinks }, 'Export'),
    );

    const formHost = el('div');
    const tagCloud = el('div', { class: 'tag-cloud' });
    const grid = el('div', { class: 'links-grid' });
    body.append(toolbar, formHost, tagCloud, grid);

    search.addEventListener('input', () => { query = search.value; render(); });
    sort.addEventListener('change', () => { saveToolState('links', { sort: sort.value }); render(); });

    function render() {
      const visible = sortLinks(filterLinks(links, query), sort.value);
      count.textContent = `${visible.length} / ${links.length}`;
      renderTagCloud();
      grid.replaceChildren();
      if (!links.length) {
        grid.append(el('div', { class: 'empty', style: { gridColumn: '1 / -1' } },
          'Nothing saved yet. Add a link, use the popup, or right-click any page or link → "Save to Maggiordomo".'));
        return;
      }
      if (!visible.length) {
        grid.append(el('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'No links match this search.'));
        return;
      }
      for (const link of visible) grid.append(card(link));
    }

    function renderTagCloud() {
      const counts = new Map();
      for (const l of links) for (const t of l.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
      const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const active = new Set(query.toLowerCase().split(/\s+/).filter((t) => t.startsWith('#')).map((t) => t.slice(1)));
      tagCloud.replaceChildren(...tags.map(([tag, n]) => el('span', {
        class: 'chip' + (active.has(tag) ? ' active' : ''),
        onclick: () => toggleTag(tag),
      }, `#${tag} `, el('span', { class: 'muted' }, n))));
    }

    function toggleTag(tag) {
      const tokens = query.split(/\s+/).filter(Boolean);
      const idx = tokens.findIndex((t) => t.toLowerCase() === '#' + tag);
      if (idx >= 0) tokens.splice(idx, 1);
      else tokens.push('#' + tag);
      query = tokens.join(' ');
      search.value = query;
      render();
    }

    function card(link) {
      const icon = el('img', { src: faviconUrl(link.url), alt: '' });
      icon.addEventListener('error', () => icon.replaceWith(el('span', { class: 'letter' }, hostOf(link.url)[0] || '?')));
      return el('div', { class: 'link-card' + (link.pinned ? ' pinned' : '') },
        el('div', { class: 'head' },
          icon,
          el('a', {
            href: link.url, title: link.url, target: '_blank', rel: 'noopener',
            onclick: () => touchLink(link.id),
          }, link.pinned ? '★ ' : '', link.title),
        ),
        el('div', { class: 'url' }, link.url),
        link.notes ? el('div', { class: 'notes' }, link.notes) : null,
        el('div', { class: 'foot' },
          ...(link.tags || []).map((t) => el('span', { class: 'chip', onclick: () => toggleTag(t) }, '#' + t)),
          el('span', { class: 'muted small', title: 'Saved ' + fmtDate(link.createdAt) + (link.visits ? ` · opened ${link.visits}×` : '') }, ' '),
          el('div', { class: 'actions' },
            el('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Copy URL', onclick: () => copyText(link.url, 'URL copied') }, '⧉'),
            el('button', { class: 'btn btn-ghost btn-sm btn-icon', title: link.pinned ? 'Unpin' : 'Pin to top', onclick: () => togglePin(link) }, link.pinned ? '★' : '☆'),
            el('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'Edit', onclick: () => openForm(link.id) }, '✎'),
            el('button', { class: 'btn btn-ghost btn-sm btn-icon btn-danger', title: 'Delete', onclick: () => remove(link) }, '✕'),
          ),
        ),
      );
    }

    function openForm(id) {
      editing = id;
      const link = id === 'new' ? { title: '', url: '', tags: [], notes: '' } : links.find((l) => l.id === id);
      if (!link) return;
      const title = el('input', { type: 'text', placeholder: 'Title', value: link.title });
      const url = el('input', { type: 'url', placeholder: 'https://…', value: link.url, class: 'mono' });
      const tags = el('input', { type: 'text', placeholder: 'tags, comma or space separated', value: (link.tags || []).join(', ') });
      const notes = el('textarea', { placeholder: 'Notes (optional)', rows: 2, style: { minHeight: '56px' } }, link.notes || '');
      const form = el('form', { class: 'card link-form', onsubmit: submit },
        el('div', {}, el('label', {}, 'Title'), title),
        el('div', {}, el('label', {}, 'URL'), url),
        el('div', { class: 'full' }, el('label', {}, 'Tags'), tags),
        el('div', { class: 'full' }, el('label', {}, 'Notes'), notes),
        el('div', { class: 'full row' },
          el('button', { class: 'btn btn-primary', type: 'submit' }, id === 'new' ? 'Save link' : 'Update'),
          el('button', { class: 'btn', type: 'button', onclick: closeForm }, 'Cancel'),
          id === 'new' ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: fillFromClipboard }, 'Paste URL from clipboard') : null,
        ),
      );
      formHost.replaceChildren(form);
      (id === 'new' ? url : title).focus();

      async function fillFromClipboard() {
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (text) url.value = text;
        } catch {
          toast('Clipboard read not permitted', 'error');
        }
      }

      async function submit(e) {
        e.preventDefault();
        try {
          const payload = { title: title.value.trim(), url: url.value.trim(), tags: cleanTags(tags.value), notes: notes.value.trim() };
          if (!payload.url) throw new Error('URL is required');
          if (id === 'new') {
            const { duplicate, link: saved } = await addLink(payload);
            if (duplicate) {
              toast('Already saved: ' + saved.title, 'info');
            } else {
              if (!payload.title) await updateLink(saved.id, { title: hostOf(saved.url) });
              toast('Saved', 'ok');
            }
          } else {
            await updateLink(id, { ...payload, title: payload.title || hostOf(payload.url) });
            toast('Updated', 'ok');
          }
          closeForm();
          await reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    }

    function closeForm() {
      editing = null;
      formHost.replaceChildren();
    }

    async function togglePin(link) {
      await updateLink(link.id, { pinned: !link.pinned });
      await reload();
    }

    async function remove(link) {
      if (!confirm(`Delete "${link.title}"?`)) return;
      await removeLink(link.id);
      toast('Deleted', 'info');
      await reload();
    }

    async function reload() {
      links = await getLinks();
      render();
    }

    function exportLinks() {
      const stamp = new Date().toISOString().slice(0, 10);
      download(`dev-links-${stamp}.json`, JSON.stringify(links, null, 2), 'application/json');
    }

    async function importLinks() {
      const file = await pickFile('.json,.html,application/json,text/html');
      if (!file) return;
      const text = await file.text();
      let incoming = [];
      try {
        if (/\.html?$/i.test(file.name) || text.trimStart().startsWith('<!DOCTYPE NETSCAPE')) {
          incoming = parseBookmarksHtml(text);
        } else {
          const parsed = JSON.parse(text);
          const arr = Array.isArray(parsed) ? parsed : parsed?.data?.links || parsed?.links;
          if (!Array.isArray(arr)) throw new Error('Expected an array of links');
          incoming = arr;
        }
      } catch (err) {
        toast('Import failed: ' + err.message, 'error');
        return;
      }
      let added = 0;
      for (const item of incoming) {
        if (!item?.url) continue;
        try {
          const { duplicate } = await addLink({ title: item.title, url: item.url, tags: item.tags || [], notes: item.notes || '' });
          if (!duplicate) added++;
        } catch { /* skip invalid entries */ }
      }
      toast(`Imported ${added} new link${added === 1 ? '' : 's'}`, 'ok');
      await reload();
    }

    function parseBookmarksHtml(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out = [];
      doc.querySelectorAll('a[href]').forEach((a) => {
        // Folder names become tags: walk up to the nearest H3 siblings.
        const tags = [];
        let dl = a.closest('dl');
        while (dl) {
          const h3 = dl.previousElementSibling?.tagName === 'H3' ? dl.previousElementSibling : dl.parentElement?.querySelector(':scope > h3');
          if (h3?.textContent) tags.push(h3.textContent.trim().toLowerCase().replace(/\s+/g, '-'));
          dl = dl.parentElement?.closest('dl');
        }
        out.push({ title: a.textContent.trim(), url: a.getAttribute('href'), tags: tags.slice(0, 3) });
      });
      return out;
    }

    const unsubscribe = storage.onChange('links', async () => {
      if (editing) return;
      await reload();
    });

    render();
    if (!links.length) openForm('new');
    else search.focus();

    return { cleanup: unsubscribe };
  },
};
