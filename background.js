import { isSupportedUrl } from './sites.js';
import { BEHAVIOUR_DEFAULTS } from './wallet.js';

// Two settings decide how the side panel behaves (Settings page; defaults shown):
//   onlySupported (true): the toolbar button opens the panel only on a supported bank. Elsewhere it shows a small
//     "not supported" popup (a tab-specific popup replaces the click, so onClicked below only fires where the panel
//     may open).
//   hideWhenAway (true): the panel belongs to the tab it was opened on and hides when you switch to a tab where it
//     isn't allowed. When false it stays open as you switch tabs.
const prefsOf = () => chrome.storage.local.get({ onlySupported: BEHAVIOUR_DEFAULTS.onlySupported, hideWhenAway: BEHAVIOUR_DEFAULTS.hideWhenAway });

async function syncTab(tabId, url, prefs) {
  const { onlySupported, hideWhenAway } = prefs || (await prefsOf());
  const supported = isSupportedUrl(url);
  try {
    await chrome.sidePanel.setOptions({ tabId, path: 'popup.html', enabled: !hideWhenAway || supported || !onlySupported });
    await chrome.action.setPopup({ tabId, popup: onlySupported && !supported ? 'unsupported.html' : '' });
  } catch {
    // Tab closed before we could update it.
  }
}

async function syncAllTabs() {
  const prefs = await prefsOf();
  await chrome.sidePanel.setOptions({ enabled: !prefs.hideWhenAway });
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => syncTab(t.id, t.url, prefs)));
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await syncAllTabs();
  // First run: open Settings, which shows a short getting-started guide until a token is saved.
  if (reason === 'install') chrome.runtime.openOptionsPage();
  // Chrome updates silently, so the panel shows a dismissible "what's new" note next time it opens.
  const version = chrome.runtime.getManifest().version;
  if (reason === 'update' && previousVersion !== version) await chrome.storage.local.set({ whatsNew: version });
});

chrome.runtime.onStartup.addListener(syncAllTabs);

// Changing either switch applies to every open tab straight away.
chrome.storage.onChanged.addListener((changes) => {
  if ('onlySupported' in changes || 'hideWhenAway' in changes) syncAllTabs();
});

// Fires for the toolbar button and for the keyboard shortcut (commands._execute_action in the manifest).
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
