import { getSettings, listAccounts } from './wallet.js';
const $ = (id) => document.getElementById(id);
const setStatus = (msg, kind = '') => { $('status').textContent = msg; $('status').className = `status ${kind}`; };

function fillAccounts(accounts, selectedId) {
  $('account').replaceChildren(...accounts.map((a) => {
    const o = new Option(a.name || a.id, a.id);
    o.selected = a.id === selectedId;
    return o;
  }));
}

(async () => {
  const s = await getSettings();
  $('token').value = s.token;
  $('currency').value = s.currency;
  if (s.accountId) fillAccounts([{ id: s.accountId, name: s.accountName }], s.accountId);
})();

$('load').onclick = async () => {
  const token = $('token').value.trim();
  if (!token) return setStatus('Paste your API token first.', 'error');
  setStatus('Loading accounts…');
  try {
    const accounts = await listAccounts(token);
    if (!accounts.length) return setStatus('No accounts returned for this token.', 'warn');
    fillAccounts(accounts, (await getSettings()).accountId);
    setStatus(`Loaded ${accounts.length} accounts.`);
  } catch (e) { setStatus(e.message, 'error'); }
};

$('save').onclick = async () => {
  const sel = $('account').selectedOptions[0];
  await chrome.storage.local.set({
    token: $('token').value.trim(),
    accountId: sel?.value || '',
    accountName: sel?.value ? sel.text : '',
    currency: ($('currency').value.trim() || 'MYR').toUpperCase(),
  });
  setStatus('Settings saved.');
};
