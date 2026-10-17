// Shared test helpers: a static server for the extension's pages, a headless browser, and a stub of the browser's
// extension APIs plus a fake Wallet API whose behaviour each test controls through `env`.
// No real bank data, token or network is ever used.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() {
  const found = BROWSERS.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set CHROME_PATH to a browser executable.');
  return found;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };

export function serve(root = ROOT) {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  return { url: `http://localhost:${server.address().port}`, close: () => server.close() };
}

export const launch = () => puppeteer.launch({ executablePath: findBrowser(), headless: 'new', args: ['--no-sandbox'] });
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tiny assertion helper -------------------------------------------------------------------------------------
let failures = 0;
export function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
}
export const finish = () => { console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0); };

// ---- the stubbed extension environment ------------------------------------------------------------------------
// Defaults describe a configured user on a supported bank page showing one new transaction. Tests override pieces.
export const baseEnv = () => ({
  tabUrl: 'https://www.maybank2u.com.my/history',
  settings: { token: 'test-token', accountId: 'a1', accountName: 'Savings', currency: 'MYR' },
  rows: [{ date: '2026-10-01', desc: 'TESCO EXTRA CHERAS', amount: -10 }],
  bank: null,                 // what detectAccount() returns
  accounts: [
    { id: 'a1', name: 'Savings', currencyCode: 'MYR', balance: { currentBalance: 1234.5, currencyCode: 'MYR' } },
    { id: 'a2', name: 'Credit card', currencyCode: 'MYR', balance: { currentBalance: -500, currencyCode: 'MYR' } },
  ],
  records: [],                // Wallet records the fake API returns (history and date-range reads)
  rules: [],
  categories: [{ id: 'c-food', name: 'Food & Drinks', group: 'Food' }, { id: 'c-shop', name: 'Shopping', group: 'Shopping' }],
  headers: {},
});

// Installs window.chrome and window.fetch before the page's scripts run. State and call logs are on window.__t.
export async function newPanel(browser, server, env, file = 'popup.html', { dark = false } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.setViewport({ width: 420, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }]);
  await page.evaluateOnNewDocument((e) => {
    const t = (window.__t = { env: e, scans: 0, watchers: 0, fetches: [], created: [], deleted: [], patched: [], badge: [], globalBadge: [], opened: 0, mirror: 0, listeners: { message: [], updated: [], activated: [], storage: [] } });
    const store = { ...e.settings };
    t.store = store;
    const json = (body) => ({ ok: true, status: 200, headers: new Headers(e.headers), json: async () => body });
    window.fetch = async (url, opts = {}) => {
      const u = String(url), method = (opts.method || 'GET').toUpperCase();
      t.fetches.push(`${method} ${u.replace('https://rest.budgetbakers.com/wallet/v1/api', '')}`);
      const body = opts.body ? JSON.parse(opts.body) : null;
      if (method !== 'GET' && t.env.delay) await new Promise((r) => setTimeout(r, t.env.delay)); // slow writes, for the busy-state tests
      if (u.includes('/accounts')) return json({ accounts: t.env.accounts });
      if (u.includes('/record-rules')) return json({ recordRules: t.env.rules });
      if (u.includes('/categories')) return json({ categories: t.env.categories });
      if (u.includes('/records')) {
        if (method === 'POST') {
          const results = body.map((r, i) => {
            t.created.push(r);
            const res = { inputIndex: i, success: true, id: `new-${t.created.length}` };
            if (r.transfer) res.createdMirrorRecordId = `mirror-${++t.mirror}`;
            return res;
          });
          return json({ results });
        }
        if (method === 'DELETE') { t.deleted.push(body.ids); return json({ results: body.ids.map((id, i) => ({ inputIndex: i, id, success: true })) }); }
        if (method === 'PATCH') { t.patched.push(body); return json({ results: body.map((_, i) => ({ inputIndex: i, success: true })) }); }
        return json({ records: t.env.records });
      }
      return { ok: false, status: 404, headers: new Headers(), json: async () => ({ message: 'not found' }) };
    };
    const ev = (name) => ({ addListener: (f) => t.listeners[name].push(f) });
    const tab = () => ({ id: 1, url: t.env.tabUrl });
    window.chrome = {
      storage: {
        local: {
          get: async (keys) => (typeof keys === 'string' ? (keys in store ? { [keys]: store[keys] } : {}) : { ...keys, ...store }),
          set: async (items) => {
            const changes = {};
            for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
            t.listeners.storage.forEach((f) => f(changes, 'local'));
          },
          remove: async (key) => {
            if (!(key in store)) return;
            const changes = { [key]: { oldValue: store[key] } };
            delete store[key];
            t.listeners.storage.forEach((f) => f(changes, 'local'));
          },
        },
        onChanged: ev('storage'),
      },
      runtime: { openOptionsPage() { t.opened++; }, onMessage: ev('message'), getManifest: () => ({ version: e.version || '0.3.0' }) },
      tabs: { query: async () => [tab()], onUpdated: ev('updated'), onActivated: ev('activated') },
      action: {
        setBadgeText: async (o) => { t.badge.push(o.text); if (o.tabId == null) t.globalBadge.push(o.text); },
        setBadgeBackgroundColor: async () => {},
        setBadgeTextColor: async () => {},
      },
      scripting: {
        executeScript: async ({ func }) => {
          if (func.name === 'scanPage') { t.scans++; return [{ result: t.env.rows }]; }
          if (func.name === 'detectAccount') return [{ result: t.env.bank }];
          if (func.name === 'readBalance') return [{ result: t.env.bankBalance ?? null }];
          if (func.name === 'watchPage') { t.watchers++; return [{}]; }
          return [{ result: {} }];
        },
      },
    };
    // Test hooks
    window.__fire = (name, ...args) => t.listeners[name].forEach((f) => f(...args));
  }, env);
  await page.goto(`${server.url}/${file}`, { waitUntil: 'networkidle0' });
  return page;
}

// Convenience readers for the panel's state.
export const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#list li')].map((li) => ({
  desc: li.querySelector('.desc').textContent,
  amount: li.querySelector('.amt').textContent,
  cls: li.className,
  chips: [...li.querySelectorAll('.chip')].map((c) => c.textContent),
  lines: [...li.querySelectorAll('.match')].map((m) => m.firstElementChild.textContent),
  checked: li.querySelector('input').checked,
})));
export const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
export const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.hidden; }, sel);
export const store = (page) => page.evaluate(() => window.__t.store);
export const log = (page, key) => page.evaluate((k) => window.__t[k], key);
