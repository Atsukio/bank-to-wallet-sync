import { scanPage, diagnosePage, watchPage, detectAccount, readBalance } from './scanner.js';
import {
  getSettings, listAccounts, balanceOf, listCategories, existingRecords, listRules, matchRule, categoryHistory, guessCategory,
  memoryKey, sameDescription, mergedNote, toWalletRecord, recordText, createRecords, updateRecords, deleteRecords,
} from './wallet.js';
import { signature, matchRecords, carryOver, matchTransferRule, MAX_DATE_LAG, shiftDate } from './matching.js';
import { bankFor, hasAccess, requestAccess } from './sites.js';
import { showWhatsNew } from './whatsnew.js';
import {
  DEMO_TXS, DEMO_RULES, DEMO_HISTORY, DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSFER_RULES, DEMO_BANK_BALANCE, demoRecords,
} from './demo.js';

const $ = (id) => document.getElementById(id);
const UNDO_WINDOW_MS = 15 * 60e3;
const RECENT_DAYS = 7; // a page whose last row is this recent is the current one (see analyse)
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
let lastAdd = null;       // { groups, at, tabId, demo? }: in memory only, for the page it was added from (see showUndo)
let lastSig = '', lastRead = 0, readTimer;
let walletRange = null; // { from, to } the last Wallet records request covered, shown by Compare
let walletOnly = [];    // Wallet records on the page's dates that no bank row matched (see analyse)
const deletedIds = new Set(); // Wallet records deleted from the panel: the API's synced copy can keep returning them a while
const seenInBank = new Map(); // `${tabId}|${accountId}` → ids of Wallet records a bank row on that tab matched (see analyse)

function setStatus(msg, kind = '') { $('status').textContent = msg; $('status').className = `status ${kind}`; }
// A status made of sentences, each coloured by its kind: [[text, 'new' | 'likely' | 'check' | 'warn' | ''], …]
function setStatusParts(parts) {
  $('status').className = 'status';
  $('status').replaceChildren(...parts.flatMap(([text, kind], i) => [i ? ' ' : '', Object.assign(document.createElement('span'), { className: kind ? `s-${kind}` : '', textContent: text })]));
}
const fmt = (n) => (n < 0 ? '-' : '+') + 'RM ' + Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2 });
const save = (items) => chrome.storage.local.set(items);

showWhatsNew($('whatsNew')); // after an update: what changed, until "Got it"
const nameOf = (id) => accounts.find((a) => a.id === id)?.name || 'another account';
const currencyOf = (id) => accounts.find((a) => a.id === id)?.currencyCode || settings.currency || 'MYR';
const isFresh = (t) => !t.done && !t.likely && !t.ignored;
const todayMY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const signedAmount = (r) => (r.type === 'income' ? r.amount : -r.amount);
const total = (list, amountOf) => Math.round(list.reduce((s, x) => s + amountOf(x), 0) * 100) / 100;
const ready = () => Boolean(settings?.token);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

$('openSettings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

// ---------------------------------------------------------------------------------------------------------------
// Busy state. Anything that talks to Wallet shows a progress bar and, when the user started it, locks the controls
// (the inert attribute: no clicks, no focus) so a second click can't start a second request. The button that was
// pressed shows a spinner and what it is doing. Automatic refreshes show only the bar, so they never dim the panel.
function setBusy(on, { lock = true, button = null, label = '' } = {}) {
  busy = on;
  showProgress();
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
  if (rerun && !editing) { const next = rerun; rerun = null; setTimeout(() => readPage(next), 0); }
}

// The bar shows while anything talks to Wallet: a locking action (busy) or the queue of record edits (editing).
function showProgress() { $('progress').hidden = !(busy || editing); }

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
  if (bank?.label) {
    // Pages often put the full account number in the name; the last four digits are shown separately (masked).
    const label = bank.label.replace(/\d[\d\s-]{4,}\d/g, '').replace(/\s+/g, ' ').replace(/[\s·:,-]+$/, '').trim() || 'bank account';
    const digits = bank.digits ? `••${bank.digits}` : '';
    $('bankLabel').textContent = `Reading: ${label}`;
    $('bankDigits').textContent = digits;
    $('bank').title = `Reading: ${label} ${digits}`.trim();
  }
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
  $('reconcile').hidden = $('reconcileText').hidden = !bankBalance || !wallet || creditLeft;
  if ($('reconcile').hidden) return renderWhy();
  const money = (v) => Math.abs(v).toLocaleString('en-MY', { style: 'currency', currency: wallet.currency || currencyOf(accountId) });
  const { owed, value } = bankExpected(account);
  adjustBy = Math.round((value - wallet.value) * 100) / 100;
  // the bank's figure as the page shows it (owed on a card); its label ("Outstanding Balance" etc.) is the tooltip
  const bankShown = owed ? `${money(bankBalance.amount)} owed` : `${bankBalance.amount < 0 ? '-' : ''}${money(bankBalance.amount)}`;
  $('bankLine').textContent = bankShown;
  $('reconcile').title = `The bank's ${bankBalance.label.toLowerCase()}`;
  // Wallet's balance minus the bank's, both as signed balances: up (green) when Wallet is higher, down (red) when lower
  const diff = -adjustBy;
  const verdict = Object.assign(document.createElement('span'), {
    className: `verdict ${!diff ? 'ok' : diff > 0 ? 'up' : 'down'}`,
    textContent: !diff ? 'Matches bank ✓' : `${diff > 0 ? '▲' : '▼'} ${fmt(diff)} than bank`,
  });
  $('reconcileText').replaceChildren(verdict); // under Wallet's column, so it needs no "Wallet:"
  $('adjust').hidden = adjustBy === 0;
  renderWhy();
}

// Where a balance difference comes from, as far as this page can tell: bank rows not added yet, and Wallet records the
// bank page doesn't show (often ones the bank hasn't posted). Shown once the page has been checked against Wallet.
function renderWhy() {
  const why = $('reconcileWhy');
  why.hidden = $('reconcile').hidden || !adjustBy || !txs.length || !walletRange;
  if (why.hidden) return;
  const money = (v) => Math.abs(v).toLocaleString('en-MY', { style: 'currency', currency: currencyOf(accountId) });
  const fresh = txs.filter(isFresh);
  const freshSum = total(fresh, (t) => t.amount), onlySum = total(walletOnly, signedAmount);
  // the bank's balance already counts the new rows and doesn't yet count the Wallet-only records
  const rest = Math.round((adjustBy - freshSum + onlySum) * 100) / 100;
  const line = (text, title) => Object.assign(document.createElement('div'), { textContent: text, title });
  const lines = [];
  if (fresh.length) lines.push(line(`Not in Wallet: ${fresh.length} (${fmt(freshSum)})`, 'New rows on this page, not added to Wallet yet. The bank\'s balance already counts them.'));
  if (walletOnly.length) lines.push(line(`Not in Bank: ${walletOnly.length} (${fmt(onlySum)})`, 'Wallet records this page doesn\'t show, marked "Not in Bank" in the list. Often ones the bank hasn\'t posted yet.'));
  if (rest) lines.push(line(`Other: ${money(rest)} (dates not on this page)`, 'Not from anything on this page: usually older history, or a Wallet record that was edited or deleted.'));
  why.replaceChildren(...lines);
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
    lastAdd = { groups: [[result.id]], at: Date.now(), tabId: activeTabId, ...(demo && { demo: true }) };
    setStatus(demo ? 'Demo: pretended to add the adjustment. Nothing was sent.' : `Added a ${fmt(amount)} balance adjustment. You can undo this until you leave or reload the page.`, demo ? '' : 'ok');
    if (demo) {
      const account = accounts.find((a) => a.id === accountId);
      accounts = accounts.map((a) => (a === account ? { ...a, balance: { ...a.balance, currentBalance: a.balance.currentBalance + amount } } : a));
    }
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
  if (demo) renderAccount();
  else { await refreshAccounts(true); reanalyse(); } // the new record then shows in the list too
};

function showBalance(b, note = '') {
  $('balances').hidden = !b;
  if (!b) return;
  const amount = b.value.toLocaleString('en-MY', { style: 'currency', currency: b.currency || settings.currency || 'MYR' });
  $('walletLbl').textContent = `Wallet${note}`;
  $('balance').textContent = amount;
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
  chrome.storage.local.remove('lastAdd'); // versions before 0.7.0 kept the last add across reloads
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
  if (busy || editing) { rerun = { ...opts, force: opts.force || rerun?.force }; return; }
  setBusy(true, { lock: !auto, button: auto || quiet ? null : $('read'), label: 'Reading…' });
  try { await readPageNow(opts); } finally { setBusy(false); }
}

// A bank with optional access that hasn't been granted yet (see sites.js): ask, then read.
function askAccess(site) {
  $('accessText').textContent = `To read this page, Bank to Wallet Sync needs your permission to read ${site.host} pages. It only reads the transaction table, and only when you use it.`;
  $('allowBank').textContent = `Allow ${site.name}`;
  $('allowBank').onclick = async () => { if (await requestAccess(site)) readPage(); };
  $('access').hidden = false;
  setStatus('');
}

async function readPageNow({ auto = false, quiet = false, force = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  const site = bankFor(tab?.url);
  $('access').hidden = true;
  if (!site) {
    if (!auto && !quiet) setStatus('Open your bank\'s transaction history, then try again.', 'error');
    return;
  }
  if (!(await hasAccess(site))) return askAccess(site);
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
  const sig = JSON.stringify([accountId, bankKey(bank), raw.map((t) => [t.date, t.desc, t.amount, t.payee])]);
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
  // a reload or a new page in the tab the last add came from ends its Undo (an in-page change, like CIMB's, doesn't)
  if (info.status === 'loading' && tabId === lastAdd?.tabId && !lastAdd.demo) { lastAdd = null; showUndo(); }
  if (!info.url && info.status !== 'complete') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === tabId) readSoon();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === lastAdd?.tabId && !lastAdd.demo) { lastAdd = null; showUndo(); }
  for (const key of seenInBank.keys()) if (key.startsWith(`${tabId}|`)) seenInBank.delete(key);
});
// Coming back to the bank tab or window is when Wallet may have changed (e.g. a record was deleted), so check it again.
chrome.tabs.onActivated.addListener(async () => {
  // Undo shows only on the tab it belongs to, even when the switch doesn't lead to a read
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  showUndo();
  readSoon(true);
});
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
  txs = []; walletRecords = []; walletOnly = []; lastSig = ''; lastAdd = lastAdd?.demo ? null : lastAdd;
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
    walletOnly = [];
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
    // A page that runs to the last week is the current one: what Wallet has after its last row (up to today) is what
    // the bank hasn't posted yet. An older page only covers its own dates.
    const today = todayMY(), current = dates.at(-1) >= shiftDate(today, -RECENT_DAYS);
    const to = shiftDate(dates.at(-1), MAX_DATE_LAG);
    walletRange = { from: shiftDate(dates[0], -MAX_DATE_LAG), to: current && today > to ? today : to };
    const fetched = demo ? demoRecords(txs) : await existingRecords(settings.token, accountId, walletRange.from, walletRange.to);
    // keep .meta (sync state) on the filtered list
    const records = Object.assign(fetched.filter((r) => !deletedIds.has(r.id)), { meta: fetched.meta });
    const unclaimed = matchRecords(txs, records);
    // Records a bank row on another page of this tab matched (the user paged through) are on the bank's side too.
    const key = `${activeTabId}|${accountId}`, seen = seenInBank.get(key) ?? new Set();
    txs.forEach((t) => { if (t.match?.id) seen.add(t.match.id); });
    seenInBank.set(key, seen);
    // A page's first and last dates can carry on over the page break, so only the dates inside it count. A current
    // page's newest date is complete, and runs on to today.
    const inside = (d) => d > dates[0] && (current ? d <= walletRange.to : d < dates.at(-1));
    walletOnly = unclaimed.filter((r) => inside(r.date) && !seen.has(r.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    walletRecords = records;
    showCoverage(dates, records);
  } catch (e) { walletOnly = []; return setStatus(e.message, 'error'); }

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
  // Each part is coloured like the row chips it describes: new (primary), likely in Wallet (tertiary, like "Likely in
  // Wallet"), nearby date (tertiary), type differs (error), problems (amber).
  const parts = [];
  if (demo) parts.push(['DEMO DATA, nothing will be sent to Wallet.', 'warn']);
  parts.push(fresh ? [`${fresh} new of ${txs.length} found.`, 'new'] : [`No new transactions among the ${txs.length} found.`, '']);
  if (likely - mismatched - earlier) parts.push([`${likely - mismatched - earlier} look like they're already in Wallet (unticked).`, 'likely']);
  if (earlier) parts.push([`${earlier} ${earlier === 1 ? 'is' : 'are'} in Wallet on a nearby date (unticked): "Use bank date" lines ${earlier === 1 ? 'it' : 'them'} up.`, 'likely']);
  if (mismatched) parts.push([`${mismatched} match a Wallet record of the opposite type: use "Fix in Wallet" to correct it.`, 'check']);
  if (walletOnly.length) parts.push([`${walletOnly.length} in Wallet ${walletOnly.length === 1 ? 'isn\'t' : 'aren\'t'} on the bank page yet ("Not in Bank").`, '']);
  if (ruleNote) parts.push([ruleNote.trim(), 'warn']);
  setStatusParts(parts);
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
  // what needs a look (dates with nothing, a sync still running) is amber; the rest stays muted
  const parts = [];
  if (!records.length) parts.push([`Wallet has no records for ${range}.`, 'warn']);
  else {
    parts.push([`Wallet has ${records.length} record${records.length === 1 ? '' : 's'} for ${range}.`, '']);
    parts.push(empty.length ? [`Nothing yet on: ${empty.map(shortDate).join(', ')}.`, 'warn'] : ['Every date has at least one record.', '']);
  }
  // Wallet's API serves a synced copy, so a record deleted in the app can still show here until it catches up.
  const { syncing, changedAt } = records.meta || {};
  if (syncing) parts.push(['Wallet is still syncing, so recent changes (such as deletions) may not show yet.', 'warn']);
  else if (changedAt) parts.push([`Wallet's data last changed ${new Date(changedAt).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`, '']);
  $('coverage').replaceChildren(...parts.flatMap(([text, kind], i) => [i ? ' ' : '', Object.assign(document.createElement('span'), { className: kind ? `s-${kind}` : '', textContent: text })]));
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

// The open Change / Transfer picker. The list isn't rebuilt under it (see render): the panel re-reads when it gains
// focus, which the first click into it does, and the picker would vanish as if the click never happened.
let picker = null;

function openPicker(btn, el) {
  picker = el;
  btn.replaceWith(el);
  el.focus();
  el.onblur = () => closePicker(el);
}

function closePicker(el) {
  if (picker !== el) return;
  picker = null;
  render();
}

// A re-read may have replaced the row while its picker was open, so a choice goes to the row now in the list.
const liveRow = (t) => txs.find((x) => x.sig === t.sig) || t;

// A text box filtering the categories as you type (a datalist, so the browser draws the list). Each option's text is
// the category name, with its group added only where two groups share a name.
function categorySelect(t) {
  const input = document.createElement('input');
  input.className = 'mini';
  input.setAttribute('aria-label', 'Category');
  input.placeholder = 'Type to find a category';
  const byText = new Map([['Uncategorised', null]]);
  const counts = new Map();
  for (const c of categories) counts.set(c.name, (counts.get(c.name) || 0) + 1);
  for (const c of categories) byText.set(counts.get(c.name) > 1 ? `${c.name} (${c.group || 'Other'})` : c.name, c);
  const list = $('categoryOptions') || document.body.appendChild(Object.assign(document.createElement('datalist'), { id: 'categoryOptions' }));
  list.replaceChildren(...[...byText].map(([text, c]) => Object.assign(new Option(text), c?.group ? { label: c.group } : {})));
  input.setAttribute('list', list.id);
  const pick = (text) => {
    if (!byText.has(text)) return false;
    const c = byText.get(text), row = liveRow(t);
    row.rule = { manual: true, category: c ? { id: c.id, name: c.name } : null, labels: [] };
    rememberCategory(row, row.rule.category);
    input.blur();
    return true;
  };
  // A choice from the list arrives as an input event that isn't typing
  input.oninput = (e) => { if (!(e instanceof InputEvent) || e.inputType === 'insertReplacementText') pick(input.value); };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); input.blur(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter takes an exact name, else the only category containing what was typed
    const q = input.value.trim().toLowerCase();
    const hits = [...byText.keys()].filter((k) => k.toLowerCase().includes(q));
    pick([...byText.keys()].find((k) => k.toLowerCase() === q) ?? (q && hits.length === 1 ? hits[0] : ''));
  };
  return input;
}

// Money in came from the other account, money out went to it
const transferWord = (t) => (t.amount > 0 ? 'Transfer from' : 'Transfer to');

function transferSelect(t) {
  const select = document.createElement('select');
  select.className = 'mini';
  select.setAttribute('aria-label', transferWord(t));
  select.append(new Option(`${transferWord(t)}…`, ''),...accounts.filter((a) => a.id !== accountId).map((a) => new Option(a.name, a.id)));
  select.onchange = () => {
    if (select.value) Object.assign(liveRow(t), { transferTo: select.value, transferAuto: false });
    select.blur();
  };
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
      li.append(line('match unsure', shown, button('Fix in Wallet', () => fixType([t]),
        { title: `Change the Wallet record's amount to ${fmt(t.amount)} so its type matches the bank. Category, note and labels are kept.` })));
    }
  } else if (t.likely && t.dateLag) {
    const note = walletNote(t).trim();
    const days = Math.abs(t.dateLag);
    const when = `${days === 1 ? 'a day' : `${days} days`} ${t.dateLag > 0 ? 'earlier' : 'later'}, on ${shortDate(t.match.date)}`;
    li.append(line('match', `Wallet has this ${when}${note ? `: "${note}"` : ''}`,
      button('Use bank date', () => moveDate([t]), { title: `Move the Wallet record from ${shortDate(t.match.date)} to ${shortDate(t.date)} (the bank's date). Its time of day, note, category and labels are kept.` })));
  } else if (t.likely) {
    const note = walletNote(t).trim();
    const becomes = (text) => `Wallet note becomes: "${text}". Amount, payer, category and labels are kept.`;
    const merge = canMerge(t)
      ? [button('Merge notes', () => replace([t], { merge: true }), { title: becomes(mergedNote(note, t.desc)) })]
      : [];
    li.append(line('match', note ? `Wallet note: "${note}"` : `In Wallet as: ${t.match?.desc || '(no description)'}`, ...merge,
      button('Replace note', () => replace([t]), { title: becomes(recordText(t).note) }),
      ...(canPayee(t) ? [
        button(`Set ${payeeWord(t)}`, () => setPayee([t]), { title: `Wallet ${payeeWord(t)} becomes "${t.payee}". Note, category and labels are kept.` }),
        button('Replace all', () => setPayee([t], { withNote: true }), { title: `Wallet note becomes "${recordText(t).note}" and the ${payeeWord(t)} becomes "${t.payee}". Category and labels are kept.` })] : [])));
  }
  if (t.ignored) li.append(line('match', "Ignored: this row won't be synced.", button('Restore', () => setIgnored(t, false))));
  if (!fresh) return li;

  if (t.unsure) {
    li.append(line('match unsure', "Couldn't confirm if this is money in or out. Check it before adding.",
      button('Flip sign', () => { t.amount = -t.amount; t.flipped = !t.flipped; t.unsure = false; render(); }, { title: 'Swap between money out and money in' })));
  }
  if (t.transferTo) {
    li.append(line('match cat', `${transferWord(t)} ${nameOf(t.transferTo)}${t.transferAuto ? ' (from your transfer rule)' : ''}`,
      button('Not a transfer', () => { t.transferTo = ''; t.transferAuto = false; render(); })));
  } else {
    const name = t.rule?.category?.name || (t.rule?.category ? 'from your Wallet rule' : 'none');
    const how = t.rule?.manual ? ' (your choice)' : t.rule?.remembered ? ' (remembered)' : t.rule?.guessed ? ' (from similar past records)' : '';
    const labels = (t.rule?.labels || []).map((l) => l.name).filter(Boolean);
    const change = categories.length ? button('Change', () => {
      const s = categorySelect(t);
      openPicker(change, s);
      try { s.showPicker(); } catch { /* the list still opens as you type */ }
    }) : null;
    // no category: Wallet shows it as "Unknown expense", so it is amber to catch the eye before adding
    li.append(line(t.rule?.category ? 'match cat' : 'match cat none', `Category: ${name}${labels.length ? ` · ${labels.join(', ')}` : ''}${how}`, ...(change ? [change] : [])));
  }
  const acts = document.createElement('span');
  acts.className = 'acts';
  if (!t.transferTo && accounts.length > 1) {
    const make = button(transferWord(t), () => openPicker(make, transferSelect(t)), { cls: 'text', title: `Create this as a transfer ${t.amount > 0 ? 'from' : 'to'} another of your Wallet accounts` });
    acts.append(make);
  }
  acts.append(button('Ignore', () => setIgnored(t, true), { cls: 'text', title: "Never sync this row (it's remembered on this computer)" }));
  li.append(acts);
  return li;
}

// A row whose Wallet record is being edited (see queueEdits) shows only a spinner in place of its buttons; one whose
// edit failed says why and offers its buttons again.
function withEditState(li, t) {
  if (t.editError) li.append(line('match unsure', `Couldn't update Wallet: ${t.editError}`));
  const pending = pendingOf(t);
  if (!pending) return li;
  li.classList.add('editing');
  li.querySelectorAll('button, input, select').forEach((el) => { el.disabled = true; });
  const buttons = [...li.querySelectorAll('.match button')];
  const working = button(pending, null, { cls: 'pending' });
  working.disabled = true;
  if (buttons.length) { buttons[0].before(working); buttons.forEach((b) => b.remove()); } else li.append(working);
  return li;
}

function render() {
  $('results').hidden = false;
  if (picker && !picker.isConnected) picker = null; // the list was cleared some other way
  if (!picker) renderList(); // closing the picker renders again
  renderWhy();
  updateCount();
  updateBadge();
}

function renderList() {
  const entries = txs.map((t) => ({ date: t.date, li: withEditState(rowFor(t), t) }));
  // Wallet-only records go among the bank's rows by date, in whichever order the page lists them (newest or oldest first)
  const ascending = txs.length < 2 || txs[0].date <= txs.at(-1).date;
  for (const r of ascending ? [...walletOnly].reverse() : walletOnly) {
    const i = entries.findIndex((e) => (ascending ? e.date > r.date : e.date < r.date));
    entries.splice(i < 0 ? entries.length : i, 0, { date: r.date, li: walletRow(r) });
  }
  $('list').replaceChildren(...entries.map((e) => e.li));
}

// A Wallet record no bank row matched, read-only: usually one the bank hasn't posted yet; otherwise a record entered
// twice or on the wrong account. No checkbox (there's nothing to add), so an empty cell keeps the columns aligned.
function walletRow(r) {
  const li = document.createElement('li');
  li.className = 'wallet-only';
  li.title = "In Wallet, but not on this bank page: usually one the bank hasn't posted yet. If not, check for a record entered twice or on the wrong account.";
  const amount = signedAmount(r);
  li.innerHTML = `<span></span><span class="desc"></span><span class="amt ${r.transfer ? 'xfer' : amount < 0 ? 'neg' : 'pos'}">${fmt(amount)}</span>
      <span class="sub"><span class="date">${r.date}</span>${chip('notbank', 'Not in Bank')}${r.transfer ? chip('likely', 'Transfer') : ''}</span>`;
  li.querySelector('.desc').textContent = r.note || r.desc || '(no note)';
  // A transfer's other side would be left behind, so that one is deleted in Wallet itself.
  if (r.transfer) return li;
  const acts = document.createElement('span');
  acts.className = 'acts';
  // Deleting can't be undone, so the first click only asks.
  const del = button('Delete', () => {
    if (del.classList.contains('confirm')) return deleteWalletOnly(r, del);
    del.classList.add('confirm');
    del.textContent = 'Delete from Wallet?';
    setTimeout(() => { del.classList.remove('confirm'); del.textContent = 'Delete'; }, 5000);
  }, { cls: 'text', title: "Delete this record from Wallet, for one entered twice or on the wrong account. It can't be undone." });
  acts.append(del);
  li.append(acts);
  return li;
}

async function deleteWalletOnly(r, btn) {
  if (busy) return;
  const wasDemo = demo;
  setBusy(true, { button: btn, label: 'Deleting…' });
  try {
    const out = wasDemo ? { deleted: 1, failed: [] } : await deleteRecords(settings.token, [[r.id]]);
    if (out.failed.length) return setStatus(`Couldn't delete it: ${out.failed[0]}`, 'error');
    if (!wasDemo) deletedIds.add(r.id);
    walletOnly = walletOnly.filter((x) => x !== r);
    const name = r.note || r.desc;
    if (wasDemo) render();
    else { await refreshAccounts(true); setBusy(false); await reanalyse(); }
    // after the re-read, whose own summary would replace it
    setStatus(wasDemo ? 'Demo: pretended to delete it. Nothing was sent.' : `Deleted ${name ? `"${name}"` : 'the record'} from Wallet.`, wasDemo ? '' : 'ok');
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
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

// ---------------------------------------------------------------------------------------------------------------
// Edits to existing Wallet records: Merge / Replace note, Fix in Wallet, Use bank date.
// They don't lock the panel. Each click marks its row as working ("Merging…") and joins a queue, so the user can keep
// clicking other rows. The queue sends what has gathered, up to 10 per request (the API's PATCH limit), one request
// at a time, and updates each row as its result comes back. A page read asked for meanwhile waits for the queue.

const editQueue = [];
// signature -> { label: "Merging…" etc., n: edits queued or in flight }. By signature, not row object: a page read can
// rebuild the rows at any moment, even between a click and the request. Counted, because two identical bank rows share
// a signature and both can be queued.
const editingSigs = new Map();
let editing = false;
const pendingOf = (t) => editingSigs.get(t.sig)?.label || '';
const markEditing = (sig, label) => editingSigs.set(sig, { label, n: (editingSigs.get(sig)?.n || 0) + 1 });
const unmarkEditing = (sig) => { const e = editingSigs.get(sig); if (e && --e.n <= 0) editingSigs.delete(sig); };
const EDIT_GATHER_MS = 150; // quick clicks within this share a request

const KINDS = {
  merge: { label: 'Merging…', done: (n) => `Merged ${n} note${n === 1 ? '' : 's'}` },
  replace: { label: 'Replacing…', done: (n) => `Replaced ${n} note${n === 1 ? '' : 's'}` },
  payee: { label: 'Setting…', done: (n) => `Set ${n} payee${n === 1 ? '' : 's'}/payer${n === 1 ? '' : 's'}` },
  both: { label: 'Replacing…', done: (n) => `Replaced ${n} note${n === 1 ? '' : 's'} and payee${n === 1 ? '' : 's'}` },
  fix: { label: 'Fixing…', done: (n) => `Fixed ${n} type${n === 1 ? '' : 's'}` },
  move: { label: 'Moving…', done: (n) => `Moved ${n} record${n === 1 ? '' : 's'} to the bank's date` },
};

// `patch` is worked out now, from the row as clicked; `apply(row, patch)` updates the row once Wallet accepts it.
function queueEdits(batch, kind, patch, apply) {
  for (const t of batch) {
    markEditing(t.sig, KINDS[kind].label);
    t.editError = '';
    // demo is fixed per edit: switching demo on or off while it waits must neither send a demo edit nor fake a real one
    editQueue.push({ t, kind, patch: patch(t), apply, demo });
  }
  render();
  drainEdits();
}

// A page read can rebuild the list while an edit is on its way; the result then belongs to the row that replaced it:
// same signature and the same Wallet record (two identical bank rows can share a signature).
const currentRow = (t) => (txs.includes(t) ? t : txs.find((x) => x.sig === t.sig && x.match?.id === t.match?.id));

async function drainEdits() {
  if (editing) return;
  editing = true;
  showProgress();
  const tally = {}, failed = [];
  let pretended = 0, stale = false, ownStatus = null;
  // The queue's messages give way to others: an Add or a read that finishes meanwhile keeps its message.
  const say = (msg, kind) => { setStatus(msg, kind); ownStatus = msg; };
  const ours = () => ownStatus === null || $('status').textContent === ownStatus;
  try {
    await new Promise((r) => setTimeout(r, EDIT_GATHER_MS));
    while (editQueue.length) {
      // one request holds only real or only demo edits (in practice the queue never mixes them for long)
      const fake = editQueue[0].demo;
      const chunk = [];
      while (chunk.length < 10 && editQueue.length && editQueue[0].demo === fake) chunk.push(editQueue.shift());
      const left = chunk.length + editQueue.length;
      if (ours()) say(`Updating ${left} Wallet record${left === 1 ? '' : 's'}…`);
      let results;
      try {
        results = fake ? chunk.map(() => ({ success: true })) : await updateRecords(settings.token, chunk.map((e) => ({ id: e.t.match.id, ...e.patch })));
      } catch (err) {
        results = chunk.map(() => ({ success: false, error: err.message }));
      }
      chunk.forEach((e, i) => {
        const r = results[i] || { success: false, error: 'No result returned' };
        unmarkEditing(e.t.sig);
        const t = currentRow(e.t);
        // No row to update (a read replaced the list), or a read is running now with records fetched before this
        // landed: either way the list may show the old state, so read again once everything settles.
        if (!t || busy) stale = true;
        if (!r.success) { if (t) t.editError = r.error; failed.push(r.error); return; }
        if (t) e.apply(t, e.patch);
        if (fake) pretended++; else tally[e.kind] = (tally[e.kind] || 0) + 1;
      });
      render();
    }
  } catch (err) {
    failed.push(err.message);
  } finally {
    // whatever happened, nothing stays "working" and reads are not held back
    for (const e of editQueue.splice(0)) unmarkEditing(e.t.sig);
    editing = false;
    showProgress();
    const done = Object.entries(tally).map(([kind, n]) => KINDS[kind].done(n));
    if (failed.length) setStatus(`${done.length ? `${done.join(', ')}. ` : ''}${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else if (ours()) {
      if (done.length) say(`${done.join(', ')} in Wallet.`, 'ok');
      else say(`Demo: pretended to update ${pretended}. Nothing was sent.`);
    }
    if (tally.fix) refreshAccounts(true); // the balance changes when a sign flips
    if (stale && !demo) rerun = { ...rerun, quiet: true, force: true };
    if (!busy && rerun) { const next = rerun; rerun = null; setTimeout(() => readPage(next), 0); }
    render();
  }
}

// Gives the matched Wallet records the bank's description (in the note), so they show as "In Wallet" from now on.
// Replace overwrites the note; merge keeps it and adds the description ("<your note> · <bank description>").
// Only the note is patched: the amount already matched, and payer, category and labels stay as they are.
const walletNote = (t) => t.match?.note ?? t.match?.desc ?? '';
const canReplace = (t) => t.likely && !t.typeMismatch && !t.dateLag && !pendingOf(t) && (demo || t.match?.id);
const canMerge = (t) => canReplace(t) && Boolean(walletNote(t).trim());
function replace(batch, { merge = false } = {}) {
  batch = batch.filter(merge ? canMerge : canReplace);
  if (!batch.length) return;
  queueEdits(batch, merge ? 'merge' : 'replace',
    (t) => ({ note: merge ? mergedNote(walletNote(t), t.desc) : recordText(t).note }),
    (t) => Object.assign(t, { done: true, likely: false, selected: false }));
}

// Wallet's payer/payee field (counterParty), for rows where the scanner read the other party's name (CIMB DuitNow).
// "Set" changes only that field; "Replace all" also replaces the note, so the row then counts as In Wallet.
const payeeWord = (t) => (t.amount < 0 ? 'payee' : 'payer');
const canPayee = (t) => canReplace(t) && t.payee && (t.match?.counterParty || '').toLowerCase() !== t.payee.toLowerCase();
function setPayee(batch, { withNote = false } = {}) {
  batch = batch.filter(canPayee);
  if (!batch.length) return;
  queueEdits(batch, withNote ? 'both' : 'payee',
    (t) => (withNote ? recordText(t) : { counterParty: t.payee.slice(0, 255) }),
    (t, patch) => {
      t.match = { ...t.match, counterParty: patch.counterParty, texts: [...new Set([...(t.match.texts || []), patch.counterParty])] };
      if (withNote) Object.assign(t, { done: true, likely: false, selected: false });
      else afterEdit(t);
    });
}

$('replaceAll').onclick = () => replace(txs);
$('payeeAll').onclick = () => setPayee(txs);
$('bothAll').onclick = () => setPayee(txs, { withNote: true });
$('mergeAll').onclick = () => replace(txs, { merge: true });

// After a fix or a move the row is "In Wallet" if the descriptions agree, else still "Likely" (Merge/Replace offered).
const afterEdit = (t) => {
  const same = (t.match.texts || [t.match.desc]).some((x) => sameDescription(x, t.desc));
  Object.assign(t, same ? { done: true, likely: false } : { likely: true }, { selected: false });
};

// Corrects a Wallet record saved with the wrong type (an expense recorded as income, or the other way round): its
// amount is set to the bank's signed amount, which also sets the type. Only the amount changes.
const canFix = (t) => t.likely && t.typeMismatch && !t.match?.transfer && !pendingOf(t) && (demo || t.match?.id);
function fixType(batch) {
  batch = batch.filter(canFix);
  if (!batch.length) return;
  queueEdits(batch, 'fix', (t) => ({ amount: { value: t.amount } }), (t) => {
    t.match = { ...t.match, type: t.amount < 0 ? 'expense' : 'income' };
    t.typeMismatch = false;
    afterEdit(t);
  });
}

$('fixAll').onclick = () => fixType(txs);

// Moves a Wallet record dated a few days before or after the bank's row (logged before the bank posted it, or an
// automated/scheduled record) to the bank's date, keeping its time of day, so the two line up. Only the date changes.
const canMove = (t) => t.likely && t.dateLag && !pendingOf(t) && (demo || t.match?.id);
const movedDate = (t) => new Date(Date.parse(t.match.recordDate || `${t.match.date}T12:00:00+08:00`) + t.dateLag * 864e5).toISOString();
function moveDate(batch) {
  batch = batch.filter(canMove);
  if (!batch.length) return;
  queueEdits(batch, 'move', (t) => ({ recordDate: movedDate(t) }), (t, { recordDate }) => {
    t.match = { ...t.match, date: t.date, recordDate };
    t.dateLag = 0;
    afterEdit(t);
  });
}

$('moveAll').onclick = () => moveDate(txs);

function updateCount() {
  const likely = txs.filter(canReplace).length;
  $('replaceAll').hidden = !likely;
  const movable = txs.filter(canMove).length;
  $('moveAll').hidden = movable < 2; // one is moved from its own row; the bulk button is for several
  $('moveAll').textContent = `Use ${movable} bank dates`;
  $('replaceAll').textContent = `Replace ${likely} note${likely === 1 ? '' : 's'}`;
  const payable = txs.filter(canPayee).length;
  $('payeeAll').hidden = !payable;
  $('payeeAll').textContent = `Set ${payable} payee${payable === 1 ? '' : 's'}`;
  $('bothAll').hidden = !payable;
  $('bothAll').textContent = `Replace all ${payable}`;
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
    '', `Wallet records (${walletRecords.length}) from ${walletRange?.from || '?'} to ${walletRange?.to || '?'} (the bank's dates plus ${MAX_DATE_LAG} days either side, and up to today when the page is current), as read: date  amount  type  description  [source, state, updated]`, ...rows(walletRecords),
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
      lastAdd = { groups, at: Date.now(), tabId: activeTabId, ...(demo && { demo: true }) };
      showUndo();
    }
    const added = batch.length - failed.length;
    if (failed.length) setStatus(`Added ${added}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to add ${added}. Nothing was sent.` : `Added ${added} to Wallet. You can undo this until you leave or reload the page.`, demo ? '' : 'ok');
    if (!demo && added) refreshAccounts(true);
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
};

// The Undo button belongs to the page the add was made on: it shows only on that tab, and goes when the tab reloads,
// navigates or closes, or the panel closes (it isn't saved), or after 15 minutes at most. It deletes exactly the records
// that add created (and the mirror side of any transfer), so nothing else in Wallet is touched.
function showUndo() {
  const live = lastAdd && Date.now() - lastAdd.at < UNDO_WINDOW_MS;
  if (lastAdd && !live) lastAdd = null;
  $('undo').hidden = !live || !(lastAdd.demo || lastAdd.tabId === activeTabId);
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
      setStatus(wasDemo ? 'Demo: pretended to undo. Nothing was sent.' : `Removed ${out.deleted} record${out.deleted === 1 ? '' : 's'} from Wallet.`, wasDemo ? '' : 'ok');
      if (wasDemo) txs.forEach((t) => { if (t.done && !t.match) { t.done = false; t.selected = true; } });
    }
    showUndo();
    if (!wasDemo) { await refreshAccounts(true); setBusy(false); await reanalyse(); } else render();
  } catch (e) { setStatus(e.message, 'error'); }
  finally { setBusy(false); }
};

init();
