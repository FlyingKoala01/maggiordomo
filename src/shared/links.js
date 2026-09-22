import { storage } from './storage.js';
import { uid } from './util.js';

export const LINKS_KEY = 'links';

export async function getLinks() {
  return storage.get(LINKS_KEY, []);
}

export async function saveLinks(links) {
  return storage.set(LINKS_KEY, links);
}

export function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).href;
  } catch {
    try {
      return new URL('https://' + raw).href;
    } catch {
      return null;
    }
  }
}

export function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,\s]+/);
  return [...new Set(list.map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];
}

export async function addLink({ title, url, tags = [], notes = '' }) {
  const href = normalizeUrl(url);
  if (!href) throw new Error('Invalid URL');
  const links = await getLinks();
  const existing = links.find((l) => l.url === href);
  if (existing) return { link: existing, duplicate: true };
  const link = {
    id: uid(),
    title: String(title || href).trim() || href,
    url: href,
    tags: cleanTags(tags),
    notes: String(notes || ''),
    createdAt: Date.now(),
    pinned: false,
    visits: 0,
  };
  links.unshift(link);
  await saveLinks(links);
  return { link, duplicate: false };
}

export async function updateLink(id, patch) {
  const links = await getLinks();
  const idx = links.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  if (patch.url) {
    const href = normalizeUrl(patch.url);
    if (!href) throw new Error('Invalid URL');
    patch.url = href;
  }
  if (patch.tags) patch.tags = cleanTags(patch.tags);
  links[idx] = { ...links[idx], ...patch, updatedAt: Date.now() };
  await saveLinks(links);
  return links[idx];
}

export async function removeLink(id) {
  const links = await getLinks();
  await saveLinks(links.filter((l) => l.id !== id));
}

export async function touchLink(id) {
  const links = await getLinks();
  const link = links.find((l) => l.id === id);
  if (!link) return;
  link.visits = (link.visits || 0) + 1;
  link.lastVisit = Date.now();
  await saveLinks(links);
}

// Query syntax: free words match title/url/notes; "#tag" tokens must all match tags.
export function filterLinks(links, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return links;
  const tags = tokens.filter((t) => t.startsWith('#')).map((t) => t.slice(1)).filter(Boolean);
  const words = tokens.filter((t) => !t.startsWith('#'));
  return links.filter((l) => {
    const hay = `${l.title} ${l.url} ${l.notes || ''} ${(l.tags || []).join(' ')}`.toLowerCase();
    return tags.every((t) => (l.tags || []).some((lt) => lt.includes(t))) && words.every((w) => hay.includes(w));
  });
}

export function sortLinks(links, mode = 'recent') {
  const copy = [...links];
  const byPinned = (a, b) => Number(b.pinned) - Number(a.pinned);
  const cmp = {
    recent: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    visits: (a, b) => (b.visits || 0) - (a.visits || 0) || b.createdAt - a.createdAt,
    domain: (a, b) => hostOf(a.url).localeCompare(hostOf(b.url)) || a.title.localeCompare(b.title),
  }[mode] || ((a, b) => b.createdAt - a.createdAt);
  return copy.sort((a, b) => byPinned(a, b) || cmp(a, b));
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function faviconUrl(url, size = 16) {
  try {
    return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=${size}`;
  } catch {
    return '';
  }
}
