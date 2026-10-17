import { CHANGELOG, changesSince, compareVersions } from './changelog.js';

// "What's new" after an update. Chrome updates extensions silently, so background.js stores the version the user
// came from (whatsNewFrom) and puts NEW on the toolbar icon; the side panel and the "not supported" popup show a card
// listing what changed since then until "Got it". Nothing here touches the page at import time, so the service worker
// can import the badge helpers.

// Mirrors --md-primary / --md-on-primary in style.css (the service worker has no CSS to read).
const BADGE = { background: '#005bc0', text: '#ffffff' };
const quiet = (p) => Promise.resolve(p).catch(() => {});

export async function setNewBadge() {
  await quiet(chrome.action.setBadgeText({ text: 'NEW' }));
  await quiet(chrome.action.setBadgeBackgroundColor({ color: BADGE.background }));
  await quiet(chrome.action.setBadgeTextColor?.({ color: BADGE.text }));
}

// Called from onInstalled. A reload of an unpacked copy reports 'update' with the same version: not an update.
// If the user updates twice before looking, keep the older version so they see both releases' changes. A release
// with nothing new to tell (no changelog entry since `from`) stays quiet: no badge, so nothing that clears itself.
export async function noteUpdate(previousVersion, log = CHANGELOG) {
  const version = chrome.runtime.getManifest().version;
  if (!previousVersion || previousVersion === version) return;
  const { whatsNewFrom } = await chrome.storage.local.get('whatsNewFrom');
  const from = whatsNewFrom && compareVersions(whatsNewFrom, previousVersion) < 0 ? whatsNewFrom : previousVersion;
  if (!changesSince(from, version, log).length) return;
  await chrome.storage.local.set({ whatsNewFrom: from });
  await setNewBadge();
}

// Badge text doesn't survive a browser restart.
export async function restoreBadge(log = CHANGELOG) {
  const { whatsNewFrom } = await chrome.storage.local.get('whatsNewFrom');
  if (whatsNewFrom && changesSince(whatsNewFrom, chrome.runtime.getManifest().version, log).length) await setNewBadge();
}

async function dismiss() {
  await chrome.storage.local.remove('whatsNewFrom');
  await quiet(chrome.action.setBadgeText({ text: '' }));
}

// Fills `box` with the card, or hides it. Built with textContent only. `log` is swappable for tests.
async function render(box, log) {
  const { whatsNewFrom } = await chrome.storage.local.get('whatsNewFrom');
  box.hidden = true;
  if (!whatsNewFrom) return;
  const version = chrome.runtime.getManifest().version;
  const entries = changesSince(whatsNewFrom, version, log);
  if (!entries.length) return dismiss(); // a quiet release: nothing to tell
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const list = (items) => el('ul', {}, ...items.map((text) => el('li', { textContent: text })));
  const title = entries.length === 1 ? `What's new in ${entries[0].version}` : "What's new";
  const body = entries.length === 1 ? [list(entries[0].items)]
    : entries.flatMap((e) => [el('h3', { textContent: e.version }), list(e.items)]);
  const ok = el('button', { className: 'text', textContent: 'Got it' });
  ok.onclick = () => { box.hidden = true; dismiss(); };
  box.replaceChildren(el('h2', { textContent: title }), ...body, el('div', { className: 'whats-new-actions' }, ok));
  box.hidden = false;
}

// Shows the card now and again whenever an update (or a preview from the console) stores a version.
export function showWhatsNew(box, log = CHANGELOG) {
  render(box, log);
  chrome.storage.onChanged.addListener((changes) => { if ('whatsNewFrom' in changes) render(box, log); });
}
