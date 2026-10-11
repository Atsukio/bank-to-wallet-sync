// Clicking the toolbar icon opens the side panel instead of a popup.
// The panel is only enabled on Maybank2u tabs; on any other tab Chrome hides it.
const BANK_URL = /^https:\/\/[^/]*maybank2u\.com\.my\//;

async function syncPanel(tabId, url) {
  const enabled = BANK_URL.test(url || '');
  try {
    await chrome.sidePanel.setOptions({ tabId, path: 'popup.html', enabled });
  } catch {
    // Tab closed before we could update it.
  }
}

async function syncAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => syncPanel(t.id, t.url)));
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.sidePanel.setOptions({ enabled: false });
  await syncAllTabs();
});

chrome.runtime.onStartup.addListener(syncAllTabs);

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') syncPanel(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncPanel(tabId, tab.url);
  } catch {
    // Tab no longer exists.
  }
});
