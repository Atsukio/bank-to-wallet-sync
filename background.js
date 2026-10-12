// The side panel is only enabled on Maybank2u tabs; on any other tab Chrome hides it.
// There, the toolbar icon shows a small "not supported" popup instead (a tab-specific popup
// replaces the click, so onClicked below only fires on supported tabs).
const BANK_URL = /^https:\/\/[^/]*maybank2u\.com\.my\//;

async function syncTab(tabId, url) {
  const supported = BANK_URL.test(url || '');
  try {
    await chrome.sidePanel.setOptions({ tabId, path: 'popup.html', enabled: supported });
    await chrome.action.setPopup({ tabId, popup: supported ? '' : 'unsupported.html' });
  } catch {
    // Tab closed before we could update it.
  }
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => syncTab(t.id, t.url)));
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await chrome.sidePanel.setOptions({ enabled: false });
  await syncAllTabs();
});

chrome.runtime.onStartup.addListener(syncAllTabs);

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') syncTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncTab(tabId, tab.url);
  } catch {
    // Tab no longer exists.
  }
});
