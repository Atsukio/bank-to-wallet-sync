import { SUPPORTED_BANKS } from './sites.js';

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
