import { addLink } from './shared/links.js';

const WORKBENCH = 'src/workbench/workbench.html';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-page', title: 'Save this page to Maggiordomo', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'Save link to Maggiordomo', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'open-workbench', title: 'Open workbench', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'save-tab', title: 'Save current tab to dev links', contexts: ['action'] });
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
  }
  return false;
});

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
