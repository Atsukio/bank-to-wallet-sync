import { getSettings, listAccounts } from './wallet.js';
import { SUPPORTED_BANKS, hasAccess, requestAccess } from './sites.js';

const $ = (id) => document.getElementById(id);
const SWITCHES = ['onlySupported', 'autoRead', 'hideWhenAway', 'collectPages'];
const setStatus = (msg, kind = '') => { $('status').textContent = msg; $('status').className = `status ${kind}`; };
let accountList = []; // [{ id, name }] used by the default-account picker and the transfer rules

function fillAccounts(accounts, selectedId) {
  $('account').replaceChildren(...accounts.map((a) => {
    const o = new Option(a.name || a.id, a.id);
    o.selected = a.id === selectedId;
    return o;
  }));
}

// ---- transfer rules: [{ keyword, accountId }]
function ruleRow(rule = { keyword: '', accountId: '' }) {
  const row = document.createElement('div');
  row.className = 'rule-row';
  const keyword = Object.assign(document.createElement('input'), { value: rule.keyword, placeholder: 'Description contains…', type: 'text' });
  keyword.setAttribute('aria-label', 'Description contains');
  const account = document.createElement('select');
  account.setAttribute('aria-label', 'Transfer to');
  account.append(new Option('Transfer to…', ''), ...accountList.map((a) => new Option(a.name || a.id, a.id)));
  account.value = rule.accountId;
  const remove = Object.assign(document.createElement('button'), { textContent: 'Remove', className: 'text', onclick: () => row.remove() });
  row.append(keyword, account, remove);
  return row;
}

const renderRules = (rules) => $('transferRules').replaceChildren(...rules.map(ruleRow));
// The rules as typed. Saving keeps only complete ones; re-rendering keeps everything, so half-typed rows survive.
const readRules = () => [...$('transferRules').querySelectorAll('.rule-row')]
  .map((row) => ({ keyword: row.querySelector('input').value.trim(), accountId: row.querySelector('select').value }));
const collectRules = () => readRules().filter((r) => r.keyword && r.accountId);

$('addRule').onclick = () => $('transferRules').append(ruleRow());

// ---- remembered choices
function showCounts(s) {
  const categories = Object.keys(s.categoryMemory).length, ignored = s.ignored.length;
  $('memoryText').textContent = `Categories you picked by hand: ${categories}`;
  $('ignoredText').textContent = `Rows you chose not to sync: ${ignored}`;
  $('forgetCategories').disabled = !categories;
  $('clearIgnored').disabled = !ignored;
}
$('forgetCategories').onclick = async () => { await chrome.storage.local.set({ categoryMemory: {} }); showCounts(await getSettings()); };
$('clearIgnored').onclick = async () => { await chrome.storage.local.set({ ignored: [] }); showCounts(await getSettings()); };

// ---- load
(async () => {
  const s = await getSettings();
  $('token').value = s.token;
  $('currency').value = s.currency;
  for (const key of SWITCHES) $(key).checked = s[key];
  $('welcome').hidden = Boolean(s.token);
  accountList = s.accountList;
  fillAccounts(accountList.length ? accountList : s.accountId ? [{ id: s.accountId, name: s.accountName }] : [], s.accountId);
  renderRules(s.transferRules);
  showCounts(s);
  renderBanks();
  // Refresh the account list quietly so the pickers show everything Wallet has.
  if (s.token) {
    try { await refreshAccounts(s.token, s.accountId); } catch { /* the stored list is still usable */ }
  }
})();

// Banks with optional access show whether it is granted, with a button to allow or remove it.
async function renderBanks() {
  const items = await Promise.all(SUPPORTED_BANKS.map(async (bank) => {
    const li = document.createElement('li');
    li.append(`${bank.name}, ${bank.country}`);
    if (!bank.optional) return li;
    const allowed = await hasAccess(bank);
    const state = Object.assign(document.createElement('span'), { className: 'muted', textContent: allowed ? ' (allowed)' : ' (needs your permission)' });
    const button = Object.assign(document.createElement('button'), { className: 'text', textContent: allowed ? 'Remove access' : 'Allow' });
    button.onclick = async () => {
      if (allowed) await chrome.permissions.remove({ origins: [bank.origin] }).catch(() => {});
      else await requestAccess(bank);
      renderBanks();
    };
    li.append(state, ' ', button);
    return li;
  }));
  $('banks').replaceChildren(...items);
}
// access granted from the popup or the panel while Settings is open
chrome.permissions.onAdded.addListener(renderBanks);
chrome.permissions.onRemoved.addListener(renderBanks);

async function refreshAccounts(token, selectedId) {
  const accounts = await listAccounts(token);
  accountList = accounts.map((a) => ({ id: a.id, name: a.name }));
  fillAccounts(accountList, selectedId);
  renderRules(readRules()); // keep what the user typed (even removing every rule), now offering the new accounts
  await chrome.storage.local.set({ accountList });
  return accounts;
}

$('load').onclick = async () => {
  const token = $('token').value.trim();
  if (!token) return setStatus('Paste your API token first.', 'error');
  setStatus('Loading accounts…');
  try {
    const accounts = await refreshAccounts(token, (await getSettings()).accountId);
    if (!accounts.length) return setStatus('No active (non-archived) accounts returned for this token.', 'warn');
    setStatus(`Loaded ${accounts.length} accounts.`);
  } catch (e) { setStatus(e.message, 'error'); }
};

$('save').onclick = async () => {
  const sel = $('account').selectedOptions[0];
  const token = $('token').value.trim();
  await chrome.storage.local.set({
    token,
    accountId: sel?.value || '',
    accountName: sel?.value ? sel.text : '',
    currency: ($('currency').value.trim() || 'MYR').toUpperCase(),
    ...Object.fromEntries(SWITCHES.map((key) => [key, $(key).checked])),
    transferRules: collectRules(),
  });
  $('welcome').hidden = Boolean(token);
  setStatus('Settings saved.');
};
