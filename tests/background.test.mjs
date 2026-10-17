// background.js run in Node with a stubbed chrome: what it tells Chrome for each combination of settings.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { check, finish, ROOT, wait } from './helpers.mjs';

let prefs = {}, calls = [], opened = 0, badge = [];
const L = {};
const listener = (name) => ({ addListener: (f) => { L[name] = f; } });
globalThis.chrome = {
  storage: {
    local: {
      get: async (d) => (typeof d === 'string' ? (d in prefs ? { [d]: prefs[d] } : {}) : { ...d, ...prefs }),
      set: async (o) => { Object.assign(prefs, o); }, remove: async (k) => { delete prefs[k]; },
    },
    onChanged: listener('storage'),
  },
  sidePanel: {
    setOptions: async (o) => { calls.push(['panel', o.tabId ?? 'global', o.enabled]); },
    setPanelBehavior: async () => {}, open: async (o) => { calls.push(['open', o.tabId]); },
  },
  action: {
    setPopup: async (o) => { calls.push(['popup', o.tabId, o.popup]); }, onClicked: listener('clicked'),
    setBadgeText: async (o) => { badge.push(o.text); }, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {},
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://www.maybank2u.com.my/history' }, { id: 2, url: 'https://example.com/' }],
    get: async (id) => ({ id, url: id === 1 ? 'https://www.maybank2u.com.my/x' : 'https://example.com/' }),
    onUpdated: listener('updated'), onActivated: listener('activated'),
  },
  runtime: { onInstalled: listener('installed'), onStartup: listener('startup'), openOptionsPage: () => { opened++; }, getManifest: () => ({ version: '9.9.0' }) },
};
await import(pathToFileURL(path.join(ROOT, 'background.js')).href);

const cases = [
  // [onlySupported, hideWhenAway, expected (panel, popup) on the bank tab, on another tab, global default]
  [true, true, [true, ''], [false, 'unsupported.html'], false],
  [true, false, [true, ''], [true, 'unsupported.html'], true],
  [false, true, [true, ''], [true, ''], false],
  [false, false, [true, ''], [true, ''], true],
];
for (const [onlySupported, hideWhenAway, bank, other, global] of cases) {
  prefs = { onlySupported, hideWhenAway }; calls = [];
  await L.startup();
  const get = (kind, tab) => calls.find((c) => c[0] === kind && c[1] === tab)?.[2];
  const got = { bank: [get('panel', 1), get('popup', 1)], other: [get('panel', 2), get('popup', 2)], global: get('panel', 'global') };
  const ok = JSON.stringify(got.bank) === JSON.stringify(bank) && JSON.stringify(got.other) === JSON.stringify(other) && got.global === global;
  check(`panel rules: onlySupported=${onlySupported} hideWhenAway=${hideWhenAway}`, ok, JSON.stringify(got));
}

prefs = { onlySupported: true, hideWhenAway: true }; calls = [];
L.storage({ token: { newValue: 'x' } }); await wait(50);
const unrelated = calls.length;
L.storage({ hideWhenAway: { newValue: false } }); await wait(50);
check('only the two panel switches re-sync tabs', unrelated === 0 && calls.length > 0, `unrelated=${unrelated} switch=${calls.length}`);

L.clicked({ id: 1 });
check('icon click (and the shortcut) opens the panel for that tab', calls.some((c) => c[0] === 'open' && c[1] === 1));

opened = 0;
// ---- what's new (the running version is 9.9.0 here)
await L.installed({ reason: 'update', previousVersion: '9.8.0' });
check('updating does not open Settings', opened === 0);
check("what's new: an update stores the version the user came from and puts NEW on the icon", prefs.whatsNewFrom === '9.8.0' && badge.at(-1) === 'NEW', JSON.stringify([prefs.whatsNewFrom, badge]));
await L.installed({ reason: 'update', previousVersion: '9.8.5' });
check("what's new: a second update before the card is seen keeps the older version", prefs.whatsNewFrom === '9.8.0', prefs.whatsNewFrom);
delete prefs.whatsNewFrom; badge = [];
await L.installed({ reason: 'update', previousVersion: '9.9.0' });
check("what's new: reloading the same version (an unpacked copy) does nothing", !('whatsNewFrom' in prefs) && !badge.length);
await L.installed({ reason: 'install' });
check('a fresh install opens Settings (the getting-started guide)', opened === 1);
check("what's new: a fresh install shows nothing", !('whatsNewFrom' in prefs) && !badge.length);
await L.startup();
check("what's new: a browser restart with nothing pending sets no badge", !badge.length);
prefs.whatsNewFrom = '9.8.0';
await L.startup();
check('what\'s new: a browser restart before "Got it" puts NEW back', badge.at(-1) === 'NEW');

finish();
