import { addLink } from './shared/links.js';

const WORKBENCH = 'src/workbench/workbench.html';
const OFFICE_PATTERNS = ['docx', 'xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'ods']
  .flatMap((ext) => [`*://*/*.${ext}*`, `file:///*.${ext}`]);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-page', title: 'Save this page to Maggiordomo', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Maggiordomo', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'open-workbench', title: 'Open workbench', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'save-tab', title: 'Save current tab to dev links', contexts: ['action'] });
    chrome.contextMenus.create({
      id: 'open-office',
      title: 'Open with Maggiordomo (Word / Excel)',
      contexts: ['link'],
      targetUrlPatterns: OFFICE_PATTERNS,
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'save-page' || info.menuItemId === 'save-tab') {
      await saveAndFlash({ title: tab?.title, url: info.pageUrl || tab?.url });
    } else if (info.menuItemId === 'save-link') {
      await saveAndFlash({ title: info.selectionText || info.linkUrl, url: info.linkUrl });
    } else if (info.menuItemId === 'open-workbench') {
      openWorkbench();
    } else if (info.menuItemId === 'open-office' && info.linkUrl) {
      openWorkbench('#office?url=' + encodeURIComponent(info.linkUrl));
    }
  } catch (err) {
    console.error('Maggiordomo:', err);
    flashBadge('!', '#ff6b6b');
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-workbench') openWorkbench();
  if (command === 'save-current-tab') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) await saveAndFlash({ title: tab.title, url: tab.url });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'open-workbench') {
    openWorkbench(message.hash || '');
    sendResponse({ ok: true });
  } else if (message?.type === 'download-original' && message.url) {
    downloadAnyway(message.url);
    sendResponse({ ok: true });
  }
  return false;
});

// URLs that the next download may pass through untouched (both features check this). Entries expire.
const bypass = new Map();
const BYPASS_TTL = 60e3;
function isBypassed(url) {
  const t = bypass.get(url);
  if (!t) return false;
  if (Date.now() - t > BYPASS_TTL) { bypass.delete(url); return false; }
  return true;
}
function downloadAnyway(url) {
  bypass.set(url, Date.now());
  chrome.downloads?.download({ url });
}

// ---- Optional: open Word / Excel downloads in the viewer instead of saving them ----
const OFFICE_EXT = /\.(docx|xlsx|xlsm|xls|csv|tsv|ods)(\?.*)?$/i;
const OFFICE_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
]);
function isOfficeDownload(item) {
  const url = item.finalUrl || item.url || '';
  return OFFICE_EXT.test(url) || OFFICE_EXT.test(item.filename || '') || OFFICE_MIME.has((item.mime || '').toLowerCase());
}

async function onDownloadCreated(item) {
  const url = item.finalUrl || item.url;
  if (!url || !isOfficeDownload(item)) return;
  if (isBypassed(url) || item.byExtensionId === chrome.runtime.id) return;
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.interceptDownloads) return;
  try {
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
  } catch (err) {
    console.warn('Maggiordomo: could not cancel download', err);
    return;
  }
  const target = chrome.runtime.getURL(WORKBENCH) + '#office?url=' + encodeURIComponent(url) + '&intercepted=1';
  // Navigating straight to a document leaves an empty tab behind; reuse it when that is the case.
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const blank = active && (!active.url || /^(about:blank|chrome:\/\/newtab\/?|edge:\/\/newtab\/?)$/.test(active.url));
  if (blank) chrome.tabs.update(active.id, { url: target });
  else chrome.tabs.create({ url: target });
}

// ---- Optional: skip downloads that are already in the Downloads folder ----
// Chrome never exposes file bytes to extensions, so the fingerprint is the final file name plus
// the exact byte size (and the file must still exist on disk). "Download anyway" bypasses it.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function splitName(filename) {
  const base = filename.split(/[\\/]/).pop() || filename;
  const m = /^(.*?)( \(\d+\))?(\.[^.]+)?$/.exec(base);
  return { stem: m[1], ext: m[3] || '' };
}

async function findExistingDownload(item) {
  if (!item.filename || !(item.totalBytes > 0)) return null;
  const { stem, ext } = splitName(item.filename);
  const filenameRegex = `(^|[\\\\/])${escapeRegex(stem)}( \\(\\d+\\))?${escapeRegex(ext)}$`;
  const matches = await chrome.downloads.search({ filenameRegex, state: 'complete', exists: true, orderBy: ['-endTime'] });
  return matches.find((d) => d.id !== item.id && d.fileSize === item.totalBytes) || null;
}

function onDeterminingFilename(item, suggest) {
  (async () => {
    const url = item.finalUrl || item.url;
    if (isBypassed(url) || item.byExtensionId === chrome.runtime.id) return suggest();
    const { settings = {} } = await chrome.storage.local.get('settings');
    if (!settings.dedupeDownloads) return suggest();
    const [current] = await chrome.downloads.search({ id: item.id });
    if (!current || current.state !== 'in_progress') return suggest();
    const existing = await findExistingDownload(item);
    if (!existing) return suggest();
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch (err) {
      console.warn('Maggiordomo: could not cancel duplicate download', err);
      return suggest();
    }
    notifyDuplicate(item, existing, url);
  })().catch((err) => { console.error('Maggiordomo:', err); suggest(); });
  return true;
}

const pendingNotifications = new Map();

function notifyDuplicate(item, existing, url) {
  if (!chrome.notifications) return;
  const name = splitName(item.filename).stem + splitName(item.filename).ext;
  const when = existing.endTime ? new Date(existing.endTime).toLocaleString() : 'earlier';
  const id = 'dup-' + Date.now();
  pendingNotifications.set(id, { existingId: existing.id, url });
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Already downloaded: ' + name,
    message: `Same name and size (${fmtBytes(existing.fileSize)}) as the file saved ${when}. Skipped. Click here to download anyway.`,
    buttons: [{ title: 'Open file' }, { title: 'Show in folder' }],
    priority: 1,
    requireInteraction: false,
  });
  setTimeout(() => pendingNotifications.delete(id), 10 * 60e3);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function onNotificationButton(id, buttonIndex) {
  const info = pendingNotifications.get(id);
  if (!info) return;
  if (buttonIndex === 0) {
    try { await chrome.downloads.open(info.existingId); } catch { chrome.downloads.show(info.existingId); }
  } else {
    chrome.downloads.show(info.existingId);
  }
  chrome.notifications.clear(id);
}

function onNotificationClicked(id) {
  const info = pendingNotifications.get(id);
  if (!info) return;
  downloadAnyway(info.url);
  chrome.notifications.clear(id);
}

function registerDownloadListeners() {
  if (chrome.downloads) {
    if (!chrome.downloads.onCreated.hasListener(onDownloadCreated)) chrome.downloads.onCreated.addListener(onDownloadCreated);
    if (!chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename)) chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
  }
  if (chrome.notifications) {
    if (!chrome.notifications.onButtonClicked.hasListener(onNotificationButton)) chrome.notifications.onButtonClicked.addListener(onNotificationButton);
    if (!chrome.notifications.onClicked.hasListener(onNotificationClicked)) chrome.notifications.onClicked.addListener(onNotificationClicked);
  }
}
registerDownloadListeners();
chrome.permissions.onAdded.addListener(registerDownloadListeners);

async function saveAndFlash({ title, url }) {
  if (!url || /^(chrome|edge|about|chrome-extension):/.test(url)) {
    flashBadge('x', '#ff6b6b');
    return;
  }
  const { duplicate } = await addLink({ title, url });
  flashBadge(duplicate ? '=' : '+', duplicate ? '#8b93a7' : '#4ade80');
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

function openWorkbench(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(WORKBENCH) + hash });
}
