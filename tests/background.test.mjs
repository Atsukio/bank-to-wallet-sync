// background.js run in Node with a stubbed chrome: what it tells Chrome for each combination of settings.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { check, finish, ROOT, wait } from './helpers.mjs';

let prefs = {}, calls = [], opened = 0;
const L = {};
const listener = (name) => ({ addListener: (f) => { L[name] = f; } });
globalThis.chrome = {
  storage: { local: { get: async (d) => ({ ...d, ...prefs }) }, onChanged: listener('storage') },
  sidePanel: {
    setOptions: async (o) => { calls.push(['panel', o.tabId ?? 'global', o.enabled]); },
    setPanelBehavior: async () => {}, open: async (o) => { calls.push(['open', o.tabId]); },
  },
  action: { setPopup: async (o) => { calls.push(['popup', o.tabId, o.popup]); }, onClicked: listener('clicked') },
  tabs: {
    query: async () => [{ id: 1, url: 'https://www.maybank2u.com.my/history' }, { id: 2, url: 'https://example.com/' }],
    get: async (id) => ({ id, url: id === 1 ? 'https://www.maybank2u.com.my/x' : 'https://example.com/' }),
    onUpdated: listener('updated'), onActivated: listener('activated'),
  },
  runtime: { onInstalled: listener('installed'), onStartup: listener('startup'), openOptionsPage: () => { opened++; } },
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
await L.installed({ reason: 'update' });
check('updating does not open Settings', opened === 0);
await L.installed({ reason: 'install' });
check('a fresh install opens Settings (the getting-started guide)', opened === 1);

finish();
