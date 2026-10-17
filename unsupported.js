import { SUPPORTED_BANKS, bankFor, hasAccess, requestAccess } from './sites.js';
import { showWhatsNew } from './whatsnew.js';

showWhatsNew(document.getElementById('whatsNew'));

// The "not supported" popup replaces the toolbar click, so it needs its own way into Settings.
document.getElementById('openSettings').onclick = () => {
  chrome.runtime.openOptionsPage();
  window.close();
};

// Which banks it does work on, from the same list the rest of the extension uses.
document.getElementById('banks').replaceChildren(...SUPPORTED_BANKS.map((bank) => {
  const li = document.createElement('li');
  const host = Object.assign(document.createElement('span'), { className: 'muted', textContent: ` (${bank.host})` });
  li.append(bank.name, host);
  return li;
}));

// On a bank whose access is optional and not yet granted, this popup is where the user allows it. Clicking the icon
// (activeTab) lets the popup see the tab's address even without that access.
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const bank = bankFor(tab?.url);
  if (!bank || (await hasAccess(bank))) return;
  document.querySelector('h1').textContent = `Allow ${bank.name}?`;
  document.getElementById('allowText').textContent = `To read your transactions here, Bank to Wallet Sync needs permission to read ${bank.host} pages. It only reads the transaction table, and only when you use it.`;
  const allow = document.getElementById('allow');
  allow.textContent = `Allow ${bank.name}`;
  allow.onclick = async () => {
    if (!(await requestAccess(bank))) return;
    // Chrome may close the popup for its prompt; if it is still open, say what to do next.
    document.getElementById('allowText').textContent = 'Done. Click the extension icon again to open the side panel.';
    allow.hidden = true; document.getElementById('allowHint').hidden = true;
  };
  document.getElementById('notSupported').hidden = true;
  document.getElementById('needsAccess').hidden = false;
})();
