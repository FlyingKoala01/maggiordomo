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
    // Let this one download through untouched.
    bypass.add(message.url);
    chrome.downloads?.download({ url: message.url });
    sendResponse({ ok: true });
  }
  return false;
});

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
const bypass = new Set();

function isOfficeDownload(item) {
  const url = item.finalUrl || item.url || '';
  return OFFICE_EXT.test(url) || OFFICE_EXT.test(item.filename || '') || OFFICE_MIME.has((item.mime || '').toLowerCase());
}

async function onDownloadCreated(item) {
  const url = item.finalUrl || item.url;
  if (!url || !isOfficeDownload(item)) return;
  if (bypass.has(url)) {
    bypass.delete(url);
    return;
  }
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

function registerDownloadListener() {
  if (chrome.downloads && !chrome.downloads.onCreated.hasListener(onDownloadCreated)) {
    chrome.downloads.onCreated.addListener(onDownloadCreated);
  }
}
registerDownloadListener();
chrome.permissions.onAdded.addListener((p) => { if (p.permissions?.includes('downloads')) registerDownloadListener(); });

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
