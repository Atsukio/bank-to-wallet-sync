import { scanPage, diagnosePage, watchPage, detectAccount, readBalance } from './scanner.js';
import {
  getSettings, listAccounts, balanceOf, listCategories, existingRecords, listRules, matchRule, categoryHistory, guessCategory,
  memoryKey, sameDescription, mergedNote, toWalletRecord, recordText, createRecords, updateRecords, deleteRecords,
} from './wallet.js';
import { signature, matchRecords, carryOver, matchTransferRule, MAX_DATE_LAG, shiftDate } from './matching.js';
import { isSupportedUrl } from './sites.js';
import {
  DEMO_TXS, DEMO_RULES, DEMO_HISTORY, DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSFER_RULES, DEMO_BANK_BALANCE, demoRecords,
} from './demo.js';

const $ = (id) => document.getElementById(id);
const UNDO_WINDOW_MS = 15 * 60e3;
const MAX_IGNORED = 2000, MAX_REMEMBERED = 500;

let settings;
let txs = [], walletRecords = [], collectedRaw = [];
let demo = false, busy = false;
let rerun = null;         // a read requested while busy; runs when the current work finishes
let pendingButton = null, pendingText = '';
let demoIgnored = []; // in demo mode "Ignore" is remembered for the session only, never saved
let accounts = [], categories = [];
let bank = null;          // { label, digits } the page seems to be showing (see detectAccount)
let bankBalance = null;   // { label, amount } the balance the bank page shows (see readBalance)
let accountId = '';       // the Wallet account in use for this page
let activeTabId = null;
let lastAdd = null;       // { groups, at, demo? }
let lastSig = '', lastRead = 0, readTimer;
let walletRange = null; // { from, to } the last Wallet records request covered, shown by Compare

function setStatus(msg, kind = '') { $('status').textContent = msg; $('status').className = `status ${kind}`; }
const fmt = (n) => (n < 0 ? '-' : '+') + 'RM ' + Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2 });
const save = (items) => chrome.storage.local.set(items);
const nameOf = (id) => accounts.find((a) => a.id === id)?.name || 'another account';
const currencyOf = (id) => accounts.find((a) => a.id === id)?.currencyCode || settings.currency || 'MYR';
const isFresh = (t) => !t.done && !t.likely && !t.ignored;
const ready = () => Boolean(settings?.token);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

$('openSettings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

// ---------------------------------------------------------------------------------------------------------------
// Busy state. Anything that talks to Wallet shows a progress bar and, when the user started it, locks the controls
// (the inert attribute: no clicks, no focus) so a second click can't start a second request. The button that was
// pressed shows a spinner and what it is doing. Automatic refreshes show only the bar, so they never dim the panel.
function setBusy(on, { lock = true, button = null, label = '' } = {}) {
  busy = on;
  $('progress').hidden = !on;
  $('app').inert = on && lock;
  document.body.setAttribute('aria-busy', String(on));
  if (on && button) {
    pendingButton = button;
    pendingText = button.textContent;
    button.textContent = label;
    button.classList.add('pending');
  }
  if (on) return;
  if (pendingButton) {
    pendingButton.classList.remove('pending');
    if (pendingButton.isConnected) pendingButton.textContent = pendingText;
    pendingButton = null;
  }
  updateCount(); showUndo(); // these own the text of Add, Replace-all and Undo
  if (rerun) { const next = rerun; rerun = null; setTimeout(() => readPage(next), 0); }
}

// ---------------------------------------------------------------------------------------------------------------
// Accounts: which Wallet account this page's transactions belong to.

// A stable key for the bank account on screen: its last four digits if the page shows a number, else its name.
const bankKey = (b) => (!b ? '' : b.digits ? `d:${b.digits}` : b.label ? `l:${b.label.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '');

// The Wallet account to use: the one mapped to this bank account, else the default from Settings. '' if neither is a
// real, active account, in which case the panel asks the user to choose rather than guessing.
function resolveAccount() {
  if (demo) return accountId && accounts.some((a) => a.id === accountId) ? accountId : DEMO_ACCOUNTS[0].id;
  const valid = (id) => id && (!accounts.length || accounts.some((a) => a.id === id));
  const mapped = settings.accountMap[bankKey(bank)];
  return valid(mapped) ? mapped : valid(settings.accountId) ? settings.accountId : '';
}

let accountsCache = { at: 0, promise: null };
function loadAccounts(fresh = false) {
  if (demo) return Promise.resolve(DEMO_ACCOUNTS);
  if (fresh || !accountsCache.promise || Date.now() - accountsCache.at > 10 * 60e3) {
    accountsCache = { at: Date.now(), promise: listAccounts(settings.token) };
    accountsCache.promise.catch(() => { accountsCache.promise = null; });
  }
  return accountsCache.promise;
}

async function refreshAccounts(fresh = false) {
  try {
    accounts = await loadAccounts(fresh);
    if (!demo) {
      const list = accounts.map((a) => ({ id: a.id, name: a.name }));
      if (JSON.stringify(list) !== JSON.stringify(settings.accountList)) { settings.accountList = list; save({ accountList: list }); }
    }
  } catch { /* keep what we had: the balance and picker are conveniences */ }
  accountId = resolveAccount();
  renderAccount();
}

function renderAccount() {
  $('demo').textContent = demo ? 'Exit demo' : 'Demo data';
  $('demo').title = demo ? 'Leave the demo and go back to your real accounts' : 'Dummy transactions, no login or Wallet token needed';
  $('demoBar').hidden = !demo;
  const select = $('accountSelect');
  const configured = ready() || demo;
  select.hidden = !configured || !accounts.length;
  $('account').hidden = !select.hidden;
  if (!select.hidden) {
    const options = accounts.map((a) => new Option(a.name || a.id, a.id));
    if (!accountId) options.unshift(new Option('Choose a Wallet account…', ''));
    select.replaceChildren(...options);
    select.value = accountId;
  } else if (settings?.accountName) $('account').textContent = settings.accountName;
  $('bank').hidden = !bank?.label;
  if (bank?.label) $('bank').textContent = `Reading: ${bank.label}${bank.digits ? ` ••${bank.digits}` : ''}`;
  showBalance(balanceOf(accounts.find((a) => a.id === accountId)), demo ? ' (demo)' : '');
  renderReconcile();
  updateCount();
}

// ---------------------------------------------------------------------------------------------------------------
// Balance check: the bank's balance against Wallet's, with a confirmed one-record adjustment for the difference.

// What a card or loan page shows is what you owe: positive there, negative in Wallet.
const OWED_TYPES = ['CreditCard', 'Loan', 'Mortgage'];
let adjustBy = 0;

function bankExpected(account) {
  const owed = OWED_TYPES.includes(account?.accountType) || /outstanding|statement|owed|tertunggak|penyata/i.test(bankBalance.label);
  return { owed, value: owed ? -Math.abs(bankBalance.amount) : bankBalance.amount };
}

function renderReconcile() {
  const account = accounts.find((a) => a.id === accountId);
  const wallet = balanceOf(account);
  $('adjustConfirm').hidden = true;
  // on a card or loan, "available" is the credit left, not the balance
  const creditLeft = OWED_TYPES.includes(account?.accountType) && /available|tersedia|boleh guna/i.test(bankBalance?.label);
  $('reconcile').hidden = !bankBalance || !wallet || creditLeft;
  if ($('reconcile').hidden) return;
  const money = (v) => Math.abs(v).toLocaleString('en-MY', { style: 'currency', currency: wallet.currency || currencyOf(accountId) });
  const { owed, value } = bankExpected(account);
  adjustBy = Math.round((value - wallet.value) * 100) / 100;
  const shown = `Bank ${bankBalance.label.toLowerCase()}: ${bankBalance.amount < 0 ? '-' : ''}${money(bankBalance.amount)}${owed ? ' owed' : ''}`;
  $('reconcileText').textContent = adjustBy === 0
    ? `${shown} · matches Wallet ✓`
    : `${shown} · Wallet is ${money(adjustBy)} ${adjustBy < 0 ? 'higher' : 'lower'}`;
  $('reconcile').classList.toggle('off', adjustBy !== 0);
  $('adjust').hidden = adjustBy === 0;
}

$('adjust').onclick = () => {
  const pending = txs.filter(isFresh).length;
  $('adjustText').textContent = `Add a ${fmt(adjustBy)} balance adjustment to ${nameOf(accountId)}, dated now and marked reconciled, so Wallet matches the bank?`
    + (pending ? ` ${pending} new transaction${pending === 1 ? ' on this page isn\'t' : 's on this page aren\'t'} in Wallet yet: add ${pending === 1 ? 'it' : 'them'} first, or ${pending === 1 ? 'it' : 'they'}'ll be counted twice.` : '');
  $('adjustText').classList.toggle('unsure', pending > 0);
  $('adjustConfirm').hidden = false;
};
$('adjustNo').onclick = () => { $('adjustConfirm').hidden = true; };

$('adjustYes').onclick = async () => {
  if (busy || !adjustBy) return;
  const amount = adjustBy;
  setBusy(true, { button: $('adjustYes'), label: 'Adding…' });
  try {
    const record = {
      accountId,
      recordDate: new Date().toISOString(),
      amount: { value: amount, currencyCode: currencyOf(accountId) },
      note: `Balance adjustment to match the bank's ${bankBalance.label.toLowerCase()} (${new Date().toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })})`,
      recordState: 'reconciled',
    };
    const [result] = demo ? [{ success: true, id: 'demo-adjustment' }] : await createRecords(settings.token, [record]);
    if (!result?.success) return setStatus(`Couldn't add the adjustment: ${result?.error || 'unknown error'}`, 'error');
    lastAdd = { groups: [[result.id]], at: Date.now(), ...(demo && { demo: true }) };
    if (!demo) save({ lastAdd });
    setStatus(demo ? 'Demo: pretended to add the adjustment. Nothing was sent.' : `Added a ${fmt(amount)} balance adjustment. You can undo this for 15 minutes.`);
    if (demo) {
      const account = accounts.find((a) => a.id === accountId);
      accounts = accounts.map((a) => (a === account ? { ...a, balance: { ...a.balance, currentBalance: a.balance.currentBalance + amount } } : a));
    }
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
  if (demo) renderAccount(); else await refreshAccounts(true);
};

function showBalance(b, note = '') {
  $('balance').hidden = !b;
  if (!b) return;
  const amount = b.value.toLocaleString('en-MY', { style: 'currency', currency: b.currency || settings.currency || 'MYR' });
  $('balance').textContent = `Wallet balance: ${amount}${note}`;
}

$('accountSelect').onchange = async (e) => {
  const id = e.target.value;
  if (!id) return;
  const key = bankKey(bank);
  if (demo) accountId = id;
  else if (key) { settings.accountMap = { ...settings.accountMap, [key]: id }; await save({ accountMap: settings.accountMap }); }
  else { settings.accountId = id; settings.accountName = nameOf(id); await save({ accountId: id, accountName: settings.accountName }); }
  accountId = id;
  renderAccount();
  reanalyse();
};

// ---------------------------------------------------------------------------------------------------------------
// Reading the page.

async function init() {
  settings = await getSettings();
  lastAdd = settings.lastAdd;
  $('clear').hidden = !settings.collectPages;
  showUndo();
  if (!settings.token) {
    setStatus('Add your Wallet API token in Settings first (the cog above).', 'warn');
    $('read').disabled = true;
    renderAccount();
    return;
  }
  setBusy(true, { lock: false });
  try { await refreshAccounts(); } finally { setBusy(false); }
  readPage({ auto: true });
}

// Reads the active supported-bank tab.
//   auto:  the read was triggered automatically (panel opened, page changed): gated by the auto-read setting, quiet
//          when there is nothing to show, and it leaves the list alone if the transactions haven't changed.
//   quiet: refresh in place without blanking the list first (used after changing account, ignoring a row, undoing).
//   force: re-check Wallet even if the bank's transactions are unchanged (records may have been added or deleted there).
async function readPage(opts = {}) {
  const { auto = false, quiet = false } = opts;
  if (auto && (demo || !ready() || !settings.autoRead)) return;
  // Something is already in flight: do this once it finishes (the newest request wins, and force sticks).
  if (busy) { rerun = { ...opts, force: opts.force || rerun?.force }; return; }
  setBusy(true, { lock: !auto, button: auto || quiet ? null : $('read'), label: 'Reading…' });
  try { await readPageNow(opts); } finally { setBusy(false); }
}

async function readPageNow({ auto = false, quiet = false, force = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  if (!isSupportedUrl(tab?.url)) {
    if (!auto && !quiet) setStatus('Open your bank\'s transaction history, then try again.', 'error');
    return;
  }
  const soft = auto || quiet;
  if (!soft) { $('results').hidden = true; $('payload').hidden = true; setStatus('Reading page…'); }
  const target = { tabId: tab.id, allFrames: true };
  let frames, accountFrames = [], balanceFrames = [];
  try {
    // The watcher survives only until the page navigates, so it is (re)installed on every read.
    if (settings.autoRead) chrome.scripting.executeScript({ target, func: watchPage }).catch(() => {});
    [frames, accountFrames, balanceFrames] = await Promise.all([
      chrome.scripting.executeScript({ target, func: scanPage }),
      chrome.scripting.executeScript({ target, func: detectAccount }).catch(() => []),
      chrome.scripting.executeScript({ target, func: readBalance }).catch(() => []),
    ]);
  } catch (e) { return soft ? undefined : setStatus(`Couldn't read the page: ${e.message}`, 'error'); }

  bank = accountFrames.map((f) => f.result).find(Boolean) || null;
  bankBalance = balanceFrames.map((f) => f.result).find(Boolean) || null;
  let raw = frames.flatMap((f) => f.result || []);
  if (settings.collectPages && raw.length) {
    // Keep rows from pages already visited (the current page's rows replace their earlier copies).
    const seen = new Set(raw.map(signature));
    raw = [...raw, ...collectedRaw.filter((t) => !seen.has(signature(t)))];
    collectedRaw = raw;
  }
  const sig = JSON.stringify([accountId, bankKey(bank), raw.map((t) => [t.date, t.desc, t.amount])]);
  if (soft && !force && sig === lastSig && !$('results').hidden) return;
  lastRead = Date.now();
  lastSig = sig;
  if (soft && !raw.length) {
    $('results').hidden = true; $('payload').hidden = true; txs = []; updateBadge();
    return setStatus('No transactions on this page yet. They are read automatically when they appear.');
  }
  if (!soft) { $('results').hidden = true; $('payload').hidden = true; }
  if (!raw.length) {
    setStatus('No transactions recognised on this page. Open the account history view and try again. If they are visible, copy the page details below and send them over.', 'error');
    try {
      const diag = await chrome.scripting.executeScript({ target, func: diagnosePage });
      $('payload').textContent = JSON.stringify(diag.map((f) => f.result), null, 2);
      $('payload').hidden = false; $('results').hidden = false; $('coverage').textContent = '';
      $('list').replaceChildren(); $('sync').disabled = true; $('count').textContent = 'Page details (no transaction values)';
    } catch (e) { /* the status message above still applies */ }
    return;
  }
  if (demo) leaveDemo();
  await refreshAccounts();
  await analyse(raw);
}

$('read').onclick = async () => {
  if (demo) await exitDemo({ read: false }); // pressing Read means "show me my real page"
  readPage();
};

// Re-check the current rows (after an account change, ignoring/restoring a row, or an undo) without blanking the list.
function reanalyse() {
  if (demo) return analyse(DEMO_TXS);
  return readPage({ quiet: true, force: true });
}

// Re-read automatically (debounced) when the page changes, the user navigates, or switches tab.
const readSoon = (force = false) => { clearTimeout(readTimer); readTimer = setTimeout(() => readPage({ auto: true, force }), 100); };

// Settings changed on the Settings page apply to the open panel straight away.
chrome.storage.onChanged.addListener((changes) => {
  if (!settings) return;
  for (const [key, change] of Object.entries(changes)) if (key in settings) settings[key] = change.newValue;
  if ('collectPages' in changes) { $('clear').hidden = !settings.collectPages; if (!settings.collectPages) collectedRaw = []; }
  if ('token' in changes) { accountsCache = { at: 0, promise: null }; }
  if ('autoRead' in changes && settings.autoRead) readSoon();
});
chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'b2w-page-changed') readSoon(); });
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url && info.status !== 'complete') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === tabId) readSoon();
});
// Coming back to the bank tab or window is when Wallet may have changed (e.g. a record was deleted), so check it again.
chrome.tabs.onActivated.addListener(() => readSoon(true));
window.addEventListener('focus', () => { showUndo(); if (Date.now() - lastRead > 5000) readSoon(true); });

// ---------------------------------------------------------------------------------------------------------------
// Demo mode: dummy transactions and a fake Wallet, no login, token or network needed, and nothing is written.

$('demo').onclick = () => (demo ? exitDemo() : enterDemo());
$('exitDemo').onclick = () => exitDemo();

function enterDemo() {
  $('results').hidden = true; $('payload').hidden = true;
  demo = true;
  accounts = DEMO_ACCOUNTS; categories = DEMO_CATEGORIES; bank = null; bankBalance = DEMO_BANK_BALANCE;
  accountId = DEMO_ACCOUNTS[0].id;
  renderAccount();
  analyse(DEMO_TXS);
}

// Back to real use: the real accounts and balance return, the demo list goes, and the page is read again (if allowed).
async function exitDemo({ read = true } = {}) {
  leaveDemo();
  txs = []; walletRecords = []; lastSig = ''; lastAdd = lastAdd?.demo ? null : lastAdd;
  $('results').hidden = true; $('payload').hidden = true;
  setStatus(ready() ? '' : 'Add your Wallet API token in Settings first (the cog above).', ready() ? '' : 'warn');
  updateBadge();
  setBusy(true);
  try { if (ready()) await refreshAccounts(); else renderAccount(); } finally { setBusy(false); }
  showUndo();
  if (read) readPage({ auto: true, force: true });
}

function leaveDemo() {
  demo = false; demoIgnored = []; bankBalance = null; categories = []; accounts = []; accountId = '';
  if (lastAdd?.demo) { lastAdd = null; showUndo(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Caches for things that rarely change, so a page change costs one request (the Wallet records), not five.

function cached(load, ttl) {
  let at = 0, promise = null;
  return (fresh = false) => {
    if (fresh || !promise || Date.now() - at > ttl) {
      at = Date.now();
      promise = load();
      promise.catch(() => { promise = null; });
    }
    return promise;
  };
}
const rulesOnce = cached(() => listRules(settings.token), 5 * 60e3);
const historyOnce = cached(() => categoryHistory(settings.token), 10 * 60e3);
const categoriesOnce = cached(() => listCategories(settings.token), 30 * 60e3);

// A category the user chose by hand for this merchant before, as a rule-shaped object.
function rememberedRule(t) {
  const key = memoryKey(t.desc);
  const cat = key && settings.categoryMemory[key];
  return cat ? { category: cat, labels: [], remembered: true } : null;
}

function rememberCategory(t, cat) {
  const key = memoryKey(t.desc);
  if (!key || demo) return; // demo choices are not remembered
  const memory = { ...settings.categoryMemory };
  delete memory[key]; // re-insert so the newest choices are last
  if (cat) memory[key] = cat;
  for (const k of Object.keys(memory).slice(0, Math.max(0, Object.keys(memory).length - MAX_REMEMBERED))) delete memory[k];
  settings.categoryMemory = memory;
  save({ categoryMemory: memory });
}

// ---------------------------------------------------------------------------------------------------------------
// Matching against Wallet.

async function analyse(raw) {
  const prior = new Map(txs.map((t) => [t.sig, t]));
  const ignored = new Set(demo ? demoIgnored : settings.ignored);
  txs = raw.map((tx) => {
    const sig = signature(tx);
    return carryOver({ ...tx, sig, done: false, selected: !tx.unsure, ignored: ignored.has(sig) }, prior.get(sig));
  });

  if (!accountId) {
    setStatus('Choose which Wallet account these transactions belong to (the picker above).', 'warn');
    txs.forEach((t) => { t.selected = false; });
    $('coverage').textContent = '';
    return render();
  }

  // Everything below runs alongside the records request.
  const rulesRequest = (demo ? Promise.resolve(DEMO_RULES) : rulesOnce()).catch((e) => e);
  const historyRequest = (demo ? Promise.resolve(DEMO_HISTORY) : historyOnce()).catch(() => []);
  const categoriesRequest = demo ? Promise.resolve(DEMO_CATEGORIES) : categoriesOnce().catch(() => []);

  setStatus('Checking what\'s already in Wallet…');
  try {
    const dates = txs.map((t) => t.date).sort();
    walletRange = { from: shiftDate(dates[0], -MAX_DATE_LAG), to: shiftDate(dates.at(-1), MAX_DATE_LAG) };
    const records = demo ? demoRecords(txs) : await existingRecords(settings.token, accountId, walletRange.from, walletRange.to);
    matchRecords(txs, records);
    walletRecords = records;
    showCoverage(dates, records);
  } catch (e) { return setStatus(e.message, 'error'); }

  // Categories are a convenience: if the rules can't be loaded, records are still added without one.
  let ruleNote = '';
  const rules = await rulesRequest;
  const history = await historyRequest;
  categories = await categoriesRequest;
  if (rules instanceof Error) ruleNote = ` Couldn't load Wallet rules, so rule-based categories are off (${rules.message})`;
  const transferRules = demo ? DEMO_TRANSFER_RULES : settings.transferRules;
  for (const t of txs.filter(isFresh)) {
    if (!t.transferTo) {
      const rule = matchTransferRule(t.desc, transferRules, accountId);
      if (rule && accounts.some((a) => a.id === rule.accountId)) { t.transferTo = rule.accountId; t.transferAuto = true; }
    }
    // Your own choice for this merchant wins, then a Wallet rule, then what similar past records were filed under.
    if (!t.rule) t.rule = rememberedRule(t) || (rules instanceof Error ? null : matchRule(t.desc, rules, accountId)) || guessCategory(t, history);
  }
  txs.forEach((t) => { if (!isFresh(t)) t.selected = false; });

  const fresh = txs.filter(isFresh).length;
  const likely = txs.filter((t) => t.likely).length;
  const mismatched = txs.filter((t) => t.typeMismatch).length;
  const earlier = txs.filter((t) => t.likely && t.dateLag).length;
  const parts = [fresh ? `${fresh} new of ${txs.length} found.` : `No new transactions among the ${txs.length} found.`];
  if (likely - mismatched - earlier) parts.push(`${likely - mismatched - earlier} look like they're already in Wallet (unticked).`);
  if (earlier) parts.push(`${earlier} ${earlier === 1 ? 'is' : 'are'} in Wallet on a nearby date (unticked): "Use bank date" lines ${earlier === 1 ? 'it' : 'them'} up.`);
  if (mismatched) parts.push(`${mismatched} match a Wallet record of the opposite type: use "Fix in Wallet" to correct it.`);
  const bad = ruleNote || mismatched;
  setStatus((demo ? 'DEMO DATA, nothing will be sent to Wallet. ' : '') + parts.join(' ') + ruleNote, bad ? 'warn' : '');
  render();
}

const shortDate = (d) => new Date(`${d}T12:00:00+08:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });

// Tells the user whether Wallet has anything at all for the dates being synced.
function showCoverage(dates, allRecords) {
  const records = allRecords.filter((r) => r.date >= dates[0] && r.date <= dates.at(-1));
  records.meta = allRecords.meta;
  const perDay = {};
  records.forEach((r) => { perDay[r.date] = (perDay[r.date] || 0) + 1; });
  const days = [...new Set(dates)];
  const empty = days.filter((d) => !perDay[d]);
  const range = dates[0] === dates.at(-1) ? shortDate(dates[0]) : `${shortDate(dates[0])} – ${shortDate(dates.at(-1))}`;
  let msg = `Wallet has ${records.length} record${records.length === 1 ? '' : 's'} for ${range}.`;
  if (!records.length) msg = `Wallet has no records for ${range}.`;
  else if (empty.length) msg += ` Nothing yet on: ${empty.map(shortDate).join(', ')}.`;
  else msg += ' Every date has at least one record.';
  // Wallet's API serves a synced copy, so a record deleted in the app can still show here until it catches up.
  const { syncing, changedAt } = records.meta || {};
  if (syncing) msg += ' Wallet is still syncing, so recent changes (such as deletions) may not show yet.';
  else if (changedAt) msg += ` Wallet's data last changed ${new Date(changedAt).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`;
  $('coverage').textContent = msg;
}

// ---------------------------------------------------------------------------------------------------------------
// The list.

const chip = (kind, text) => `<span class="chip ${kind}">${text}</span>`;

function button(text, onclick, { title, cls = '' } = {}) {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = cls;
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
}

// A secondary line under a row: text on the left, optional buttons on the right.
function line(cls, text, ...buttons) {
  const row = document.createElement('span');
  row.className = cls;
  const label = document.createElement('span');
  label.textContent = text;
  row.append(label, ...buttons);
  return row;
}

function categorySelect(t) {
  const select = document.createElement('select');
  select.className = 'mini';
  select.setAttribute('aria-label', 'Category');
  select.append(new Option('Uncategorised', ''));
  const groups = new Map();
  for (const c of categories) {
    if (!groups.has(c.group)) groups.set(c.group, Object.assign(document.createElement('optgroup'), { label: c.group || 'Other' }));
    groups.get(c.group).append(new Option(c.name, c.id));
  }
  select.append(...groups.values());
  select.value = t.rule?.category?.id || '';
  select.onchange = () => {
    const picked = categories.find((c) => c.id === select.value);
    t.rule = { manual: true, category: picked ? { id: picked.id, name: picked.name } : null, labels: [] };
    rememberCategory(t, t.rule.category);
    render();
  };
  select.onblur = () => render();
  return select;
}

function transferSelect(t) {
  const select = document.createElement('select');
  select.className = 'mini';
  select.setAttribute('aria-label', 'Transfer to');
  select.append(new Option('Transfer to…', ''), ...accounts.filter((a) => a.id !== accountId).map((a) => new Option(a.name, a.id)));
  select.onchange = () => { if (select.value) { t.transferTo = select.value; t.transferAuto = false; } render(); };
  select.onblur = () => render();
  return select;
}

function rowFor(t) {
  const fresh = isFresh(t);
  const li = document.createElement('li');
  li.className = [t.done && 'done', t.likely && 'likely', t.ignored && 'ignored'].filter(Boolean).join(' ');
  const chips = [];
  if (t.done) chips.push(chip('in', 'In Wallet'));
  else if (t.likely) chips.push(t.typeMismatch ? chip('check', 'Type differs') : chip('likely', 'Likely in Wallet'));
  else if (t.ignored) chips.push(chip('in', 'Ignored'));
  if (fresh && t.transferTo) chips.push(chip('likely', 'Transfer'));
  li.innerHTML = `<input type="checkbox" ${t.selected ? 'checked' : ''} ${t.done || t.ignored ? 'disabled' : ''} aria-label="Include">
      <span class="desc"></span><span class="amt ${fresh && t.transferTo ? 'xfer' : t.amount < 0 ? 'neg' : 'pos'}"${fresh && t.transferTo ? ' title="Transfer between your accounts"' : ''}>${fmt(t.amount)}</span>
      <span class="sub"><span class="date">${t.date}</span>${chips.join('')}</span>`;
  li.querySelector('.desc').textContent = t.desc;
  li.querySelector('.desc').title = t.desc;
  li.querySelector('input').onchange = (e) => { t.selected = e.target.checked; updateCount(); };

  if (t.likely && t.typeMismatch) {
    const shown = `Wallet has this as ${t.match?.type || 'the other type'}, but the bank shows ${t.amount < 0 ? 'an expense' : 'income'}.`;
    if (t.match?.transfer) li.append(line('match unsure', `${shown} It's a transfer in Wallet, so fix it there.`));
    else {
      li.append(line('match unsure', shown, button('Fix in Wallet', (e) => fixType([t], e.currentTarget),
        { title: `Change the Wallet record's amount to ${fmt(t.amount)} so its type matches the bank. Category, note and labels are kept.` })));
    }
  } else if (t.likely && t.dateLag) {
    const note = walletNote(t).trim();
    const days = Math.abs(t.dateLag);
    const when = `${days === 1 ? 'a day' : `${days} days`} ${t.dateLag > 0 ? 'earlier' : 'later'}, on ${shortDate(t.match.date)}`;
    li.append(line('match', `Wallet has this ${when}${note ? `: "${note}"` : ''}`,
      button('Use bank date', (e) => moveDate([t], e.currentTarget), { title: `Move the Wallet record from ${shortDate(t.match.date)} to ${shortDate(t.date)} (the bank's date). Its time of day, note, category and labels are kept.` })));
  } else if (t.likely) {
    const note = walletNote(t).trim();
    const becomes = (text) => `Wallet note becomes: "${text}". Amount, payer, category and labels are kept.`;
    const merge = canMerge(t)
      ? [button('Merge notes', (e) => replace([t], e.currentTarget, { merge: true }), { title: becomes(mergedNote(note, t.desc)) })]
      : [];
    li.append(line('match', note ? `Wallet note: "${note}"` : `In Wallet as: ${t.match?.desc || '(no description)'}`, ...merge,
      button('Replace note', (e) => replace([t], e.currentTarget), { title: becomes(recordText(t).note) })));
  }
  if (t.ignored) li.append(line('match', "Ignored: this row won't be synced.", button('Restore', () => setIgnored(t, false))));
  if (!fresh) return li;

  if (t.unsure) {
    li.append(line('match unsure', "Couldn't confirm if this is money in or out. Check it before adding.",
      button('Flip sign', () => { t.amount = -t.amount; t.flipped = !t.flipped; t.unsure = false; render(); }, { title: 'Swap between money out and money in' })));
  }
  if (t.transferTo) {
    li.append(line('match cat', `Transfer to ${nameOf(t.transferTo)}${t.transferAuto ? ' (from your transfer rule)' : ''}`,
      button('Not a transfer', () => { t.transferTo = ''; t.transferAuto = false; render(); })));
  } else {
    const name = t.rule?.category?.name || (t.rule?.category ? 'from your Wallet rule' : 'none');
    const how = t.rule?.manual ? ' (your choice)' : t.rule?.remembered ? ' (remembered)' : t.rule?.guessed ? ' (from similar past records)' : '';
    const labels = (t.rule?.labels || []).map((l) => l.name).filter(Boolean);
    const change = categories.length ? button('Change', () => { const s = categorySelect(t); change.replaceWith(s); s.focus(); }) : null;
    li.append(line('match cat', `Category: ${name}${labels.length ? ` · ${labels.join(', ')}` : ''}${how}`, ...(change ? [change] : [])));
  }
  const acts = document.createElement('span');
  acts.className = 'acts';
  if (!t.transferTo && accounts.length > 1) {
    const make = button('Make transfer', () => { const s = transferSelect(t); make.replaceWith(s); s.focus(); }, { cls: 'text', title: 'Create this as a transfer to another of your Wallet accounts' });
    acts.append(make);
  }
  acts.append(button('Ignore', () => setIgnored(t, true), { cls: 'text', title: "Never sync this row (it's remembered on this computer)" }));
  li.append(acts);
  return li;
}

function render() {
  $('results').hidden = false;
  $('list').replaceChildren(...txs.map(rowFor));
  updateCount();
  updateBadge();
}

async function setIgnored(t, on) {
  const list = (demo ? demoIgnored : settings.ignored).filter((s) => s !== t.sig);
  if (on) list.push(t.sig);
  if (demo) demoIgnored = list;
  else { settings.ignored = list.slice(-MAX_IGNORED); await save({ ignored: settings.ignored }); }
  t.ignored = on;
  t.selected = false;
  // An ignored row stops claiming a Wallet record, and a restored one needs matching again.
  Object.assign(t, { done: false, likely: false, typeMismatch: false, match: undefined });
  reanalyse();
}

// The number of new transactions on the toolbar icon, while the panel is open.
function updateBadge() {
  if (demo || activeTabId == null) return;
  const n = txs.filter(isFresh).length;
  const quiet = (p) => Promise.resolve(p).catch(() => {}); // the badge is decoration: the tab may have closed
  quiet(chrome.action.setBadgeText({ tabId: activeTabId, text: n ? String(n) : '' }));
  if (n) quiet(chrome.action.setBadgeBackgroundColor({ tabId: activeTabId, color: cssVar('--md-primary') || '#005bc0' }));
}

function selected() { return txs.filter((t) => t.selected && !t.done && !t.ignored); }

// Gives the matched Wallet records the bank's description (in the note), so they show as "In Wallet" from now on.
// Replace overwrites the note; merge keeps it and adds the description ("<your note> · <bank description>").
// Only the note is patched: the amount already matched, and payer, category and labels stay as they are.
const walletNote = (t) => t.match?.note ?? t.match?.desc ?? '';
const canMerge = (t) => t.likely && !t.typeMismatch && !t.dateLag && Boolean(walletNote(t).trim()) && (demo || t.match?.id);
async function replace(batch, button = null, { merge = false } = {}) {
  batch = batch.filter((t) => t.likely && !t.typeMismatch && !t.dateLag && (demo || t.match?.id));
  if (!batch.length || busy) return;
  setBusy(true, { button, label: merge ? 'Merging…' : 'Replacing…' });
  const what = (n) => `${merge ? 'Merged' : 'Replaced'} the note on ${n} Wallet record${n === 1 ? '' : 's'}`;
  setStatus(`Updating ${batch.length} Wallet record${batch.length === 1 ? '' : 's'}…`);
  const noteFor = (t) => (merge ? mergedNote(walletNote(t), t.desc) : recordText(t).note);
  try {
    const results = demo
      ? batch.map(() => ({ success: true }))
      : await updateRecords(settings.token, batch.map((t) => ({ id: t.match.id, note: noteFor(t) })));
    const failed = [];
    results.forEach((r, i) => { if (r.success) { Object.assign(batch[i], { done: true, likely: false, selected: false }); } else failed.push(r.error); });
    render();
    if (failed.length) setStatus(`${what(batch.length - failed.length)}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to update ${batch.length}. Nothing was sent.` : `${what(batch.length)}.`);
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
}

$('replaceAll').onclick = () => replace(txs.filter((t) => t.likely), $('replaceAll'));
$('mergeAll').onclick = () => replace(txs.filter(canMerge), $('mergeAll'), { merge: true });

// Corrects a Wallet record saved with the wrong type (an expense recorded as income, or the other way round): its
// amount is set to the bank's signed amount, which also sets the type. Only the amount changes. If the description
// differs too, the row becomes "Likely in Wallet" so Replace is still offered for the note.
const canFix = (t) => t.likely && t.typeMismatch && !t.match?.transfer && (demo || t.match?.id);
async function fixType(batch, button = null) {
  batch = batch.filter(canFix);
  if (!batch.length || busy) return;
  setBusy(true, { button, label: 'Fixing…' });
  setStatus(`Fixing ${batch.length} Wallet record${batch.length === 1 ? '' : 's'}…`);
  try {
    const results = demo
      ? batch.map(() => ({ success: true }))
      : await updateRecords(settings.token, batch.map((t) => ({ id: t.match.id, amount: { value: t.amount } })));
    const failed = [];
    results.forEach((r, i) => {
      const t = batch[i];
      if (!r.success) return failed.push(r.error);
      t.match = { ...t.match, type: t.amount < 0 ? 'expense' : 'income' };
      t.typeMismatch = false;
      const same = (t.match.texts || [t.match.desc]).some((x) => sameDescription(x, t.desc));
      Object.assign(t, same ? { done: true, likely: false } : { likely: true }, { selected: false });
    });
    render();
    if (failed.length) setStatus(`Fixed ${batch.length - failed.length}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to fix ${batch.length}. Nothing was sent.` : `Fixed ${batch.length} in Wallet.`);
    if (!demo && failed.length < batch.length) refreshAccounts(true); // the balance changes when a sign flips
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
}

$('fixAll').onclick = () => fixType(txs.filter(canFix), $('fixAll'));

// Moves a Wallet record dated a few days before or after the bank's row (logged before the bank posted it, or an
// automated/scheduled record) to the bank's date, keeping its time of day, so the two line up. Only the date changes. If the description differs too, the row then offers Merge / Replace.
const canMove = (t) => t.likely && t.dateLag && (demo || t.match?.id);
const movedDate = (t) => new Date(Date.parse(t.match.recordDate || `${t.match.date}T12:00:00+08:00`) + t.dateLag * 864e5).toISOString();
async function moveDate(batch, button = null) {
  batch = batch.filter(canMove);
  if (!batch.length || busy) return;
  setBusy(true, { button, label: 'Moving…' });
  setStatus(`Moving ${batch.length} Wallet record${batch.length === 1 ? '' : 's'} to the bank's date…`);
  try {
    const results = demo
      ? batch.map(() => ({ success: true }))
      : await updateRecords(settings.token, batch.map((t) => ({ id: t.match.id, recordDate: movedDate(t) })));
    const failed = [];
    results.forEach((r, i) => {
      const t = batch[i];
      if (!r.success) return failed.push(r.error);
      t.match = { ...t.match, date: t.date, recordDate: movedDate(t) };
      t.dateLag = 0;
      const same = (t.match.texts || [t.match.desc]).some((x) => sameDescription(x, t.desc));
      Object.assign(t, same ? { done: true, likely: false } : { likely: true }, { selected: false });
    });
    render();
    if (failed.length) setStatus(`Moved ${batch.length - failed.length}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to move ${batch.length}. Nothing was sent.` : `Moved ${batch.length} Wallet record${batch.length === 1 ? '' : 's'} to the bank's date.`);
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
}

$('moveAll').onclick = () => moveDate(txs.filter(canMove), $('moveAll'));

function updateCount() {
  const likely = txs.filter((t) => t.likely && !t.typeMismatch && !t.dateLag).length;
  $('replaceAll').hidden = !likely;
  const movable = txs.filter(canMove).length;
  $('moveAll').hidden = movable < 2; // one is moved from its own row; the bulk button is for several
  $('moveAll').textContent = `Use ${movable} bank dates`;
  $('replaceAll').textContent = `Replace ${likely} note${likely === 1 ? '' : 's'}`;
  const mergeable = txs.filter(canMerge).length;
  $('mergeAll').hidden = !mergeable;
  $('mergeAll').textContent = `Merge ${mergeable} note${mergeable === 1 ? '' : 's'}`;
  const fixable = txs.filter(canFix).length;
  $('fixAll').hidden = fixable < 2; // one is fixed from its own row; the bulk button is for several
  $('fixAll').textContent = `Fix ${fixable} types`;
  const n = selected().length;
  $('count').textContent = `${n} selected`;
  $('sync').textContent = n ? `Add ${n} to Wallet` : 'Add to Wallet';
  $('sync').disabled = !n || !accountId;
}

$('toggleAll').onchange = (e) => { txs.forEach((t) => { if (isFresh(t) && !t.unsure) t.selected = e.target.checked; }); render(); };

$('clear').onclick = () => {
  collectedRaw = []; txs = []; lastSig = '';
  $('results').hidden = true; $('payload').hidden = true;
  updateBadge();
  setStatus('List cleared. Pages you visit from now on are collected again.');
};

// ---------------------------------------------------------------------------------------------------------------
// Compare / preview / add / undo.

// Shows how each side was parsed (local only), to see why a transaction didn't match its Wallet record.
$('compare').onclick = async () => {
  if (busy) return;
  // Also report how the real page marks amounts and accounts (digits masked), to debug. Skipped for demo data.
  let pageInfo = [];
  if (!demo) {
    setBusy(true, { button: $('compare'), label: 'Comparing…' });
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const diag = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: diagnosePage });
      pageInfo = diag.map((f) => f.result).filter((r) => r?.amountCells?.length)
        .map((r) => JSON.stringify({ amountCells: r.amountCells, amountShapes: r.amountShapes }, null, 2));
    } catch (e) { /* the comparison below is still useful */ }
    finally { setBusy(false); }
  }
  const mask = (s) => (s || '').replace(/\d/g, '9');
  const rows = (list) => list.map((x) => `${x.date}  ${x.amount}  ${x.type || '-'}  ${x.desc}` + (x.source ? `  [${x.source}, ${x.state || '?'}, updated ${x.updatedAt || '?'}]` : ''));
  $('payload').textContent = [
    `Using Wallet account: ${nameOf(accountId)}. Bank account seen on the page: ${bank ? `"${mask(bank.label)}" last digits ${mask(bank.digits) || 'none'}` : 'not detected'}`,
    'Wallet record fields: ' + JSON.stringify(walletRecords.sample || null),
    '', `Wallet records (${walletRecords.length}) from ${walletRange?.from || '?'} to ${walletRange?.to || '?'} (the bank's dates plus ${MAX_DATE_LAG} days either side), as read: date  amount  type  description  [source, state, updated]`, ...rows(walletRecords),
    '', `Bank transactions (${txs.length}), as read: date  amount  type  description`,
    ...rows(txs.map((t) => ({ date: t.date, amount: Math.abs(t.amount), type: t.amount < 0 ? 'expense' : 'income', desc: t.desc }))),
    ...(pageInfo.length ? ['', 'How the page marks amounts (digits masked):', ...pageInfo] : []),
  ].join('\n');
  $('payload').hidden = !$('payload').hidden;
};

const toRecord = (t) => toWalletRecord(t, accountId, currencyOf(accountId));

$('preview').onclick = () => {
  $('payload').textContent = JSON.stringify(selected().map(toRecord), null, 2);
  $('payload').hidden = !$('payload').hidden;
};

$('sync').onclick = async () => {
  const batch = selected();
  if (!batch.length || !accountId || busy) return;
  setBusy(true, { button: $('sync'), label: 'Adding…' });
  setStatus(`Adding ${batch.length} to Wallet…`);
  try {
    const results = demo
      ? batch.map((_, i) => ({ success: true, id: `demo-${i}` }))
      : await createRecords(settings.token, batch.map(toRecord));
    const failed = [], groups = [];
    results.forEach((r, i) => {
      if (r.success) {
        batch[i].done = true; batch[i].selected = false;
        if (r.id) groups.push([r.id, ...(r.createdMirrorRecordId ? [r.createdMirrorRecordId] : [])]);
      } else failed.push(r.error);
    });
    render();
    if (groups.length) {
      lastAdd = { groups, at: Date.now(), ...(demo && { demo: true }) };
      if (!demo) save({ lastAdd });
      showUndo();
    }
    const added = batch.length - failed.length;
    if (failed.length) setStatus(`Added ${added}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to add ${added}. Nothing was sent.` : `Added ${added} to Wallet. You can undo this for 15 minutes.`);
    if (!demo && added) refreshAccounts(true);
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
};

// The Undo button shows for 15 minutes after an add. It deletes exactly the records that add created (and the mirror
// side of any transfer), so nothing else in Wallet is touched.
function showUndo() {
  const live = lastAdd && Date.now() - lastAdd.at < UNDO_WINDOW_MS;
  if (lastAdd && !live) { lastAdd = null; if (settings?.lastAdd) save({ lastAdd: null }); }
  $('undo').hidden = !live;
  if (live) $('undo').textContent = `Undo last add (${lastAdd.groups.length})`;
}

$('undo').onclick = async () => {
  if (!lastAdd || busy) return;
  const { groups, demo: wasDemo } = lastAdd;
  setBusy(true, { button: $('undo'), label: 'Undoing…' });
  setStatus('Removing what was just added…');
  try {
    const out = wasDemo ? { deleted: groups.length, failed: [] } : await deleteRecords(settings.token, groups);
    if (out.failed.length) {
      setStatus(`Removed ${out.deleted}. ${out.failed.length} could not be removed: ${[...new Set(out.failed)].join('; ')}`, 'error');
    } else {
      lastAdd = null;
      if (!wasDemo) save({ lastAdd: null });
      setStatus(wasDemo ? 'Demo: pretended to undo. Nothing was sent.' : `Removed ${out.deleted} record${out.deleted === 1 ? '' : 's'} from Wallet.`);
      if (wasDemo) txs.forEach((t) => { if (t.done && !t.match) { t.done = false; t.selected = true; } });
    }
    showUndo();
    if (!wasDemo) { await refreshAccounts(true); setBusy(false); await reanalyse(); } else render();
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
};

init();
