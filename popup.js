import { scanPage, diagnosePage } from './scanner.js';
import { getSettings, existingRecords, listRules, matchRule, toWalletRecord, recordText, createRecords, updateRecords } from './wallet.js';
import { DEMO_TXS, DEMO_RULES, demoRecords } from './demo.js';

const $ = (id) => document.getElementById(id);
let settings, txs = [], demo = false, walletRecords = [];

function setStatus(msg, kind = '') { $('status').textContent = msg; $('status').className = `status ${kind}`; }
const fmt = (n) => (n < 0 ? '-' : '+') + 'RM ' + Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2 });

$('openSettings').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

async function init() {
  settings = await getSettings();
  if (settings.accountName) $('account').textContent = settings.accountName;
  if (!settings.token || !settings.accountId) {
    setStatus('Add your Wallet API token and pick an account in Settings first.', 'warn');
    $('read').disabled = true;
  }
}

$('read').onclick = async () => {
  $('results').hidden = true; $('payload').hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https:\/\/[^/]*maybank2u\.com\.my\//.test(tab?.url || '')) {
    return setStatus('Open your Maybank2u transaction history, then try again.', 'error');
  }
  setStatus('Reading page…');
  let frames;
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: scanPage });
  } catch (e) { return setStatus(`Couldn't read the page: ${e.message}`, 'error'); }

  const raw = frames.flatMap((f) => f.result || []);
  if (!raw.length) {
    setStatus('No transactions recognised on this page. Open the account history view and try again. If they are visible, copy the page details below and send them over.', 'error');
    try {
      const diag = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: diagnosePage });
      $('payload').textContent = JSON.stringify(diag.map((f) => f.result), null, 2);
      $('payload').hidden = false; $('results').hidden = false; $('coverage').textContent = '';
      $('list').replaceChildren(); $('sync').disabled = true; $('count').textContent = 'Page details (no transaction values)';
    } catch (e) { /* the status message above still applies */ }
    return;
  }
  demo = false;
  analyse(raw);
};

// Dummy transactions and a fake Wallet history: no Maybank login, token or network needed, and nothing is written.
$('demo').onclick = () => {
  $('results').hidden = true; $('payload').hidden = true;
  demo = true;
  analyse(DEMO_TXS);
};

async function analyse(raw) {
  txs = raw.map((tx) => ({ ...tx, done: false, selected: true }));

  setStatus('Checking what\'s already in Wallet…');
  try {
    const dates = txs.map((t) => t.date).sort();
    const records = demo ? demoRecords(txs) : await existingRecords(settings.token, settings.accountId, dates[0], dates.at(-1));
    // Wallet records are matched one-to-one, so two identical RM 5 coffees need two records. Same date, amount and
    // description counts as already in Wallet. Same date and amount with a different description is only "likely".
    const pool = [...records];
    const claim = (t, test) => {
      const type = t.amount < 0 ? 'expense' : 'income';
      const base = (r) => r.date === t.date && Math.abs(r.amount - Math.abs(t.amount)) < 0.005 && test(r);
      // Prefer a record of the same income/expense type, but don't let a differently labelled type hide a match.
      let i = pool.findIndex((r) => base(r) && (!r.type || r.type === type));
      if (i < 0) i = pool.findIndex(base);
      return i >= 0 ? pool.splice(i, 1)[0] : null;
    };
    txs.filter((t) => !t.done).forEach((t) => {
      const m = claim(t, (r) => (r.texts || [r.desc]).some((x) => sameDescription(x, t.desc)));
      if (m) { t.match = m; t.done = true; t.selected = false; }
    });
    txs.filter((t) => !t.done).forEach((t) => {
      const m = claim(t, () => true);
      if (m) { t.match = m; t.likely = true; t.selected = false; }
    });
    walletRecords = records;
    showCoverage(dates, records);
  } catch (e) { return setStatus(e.message, 'error'); }

  // Categories are a convenience: if the rules can't be loaded, records are still added without one.
  let ruleNote = '';
  try {
    const rules = demo ? DEMO_RULES : await listRules(settings.token);
    txs.filter((t) => !t.done && !t.likely).forEach((t) => { t.rule = matchRule(t.desc, rules, settings.accountId); });
  } catch (e) { ruleNote = ` Couldn't load Wallet rules, so no categories will be set (${e.message})`; }

  const fresh = txs.filter((t) => !t.done && !t.likely).length;
  const likely = txs.filter((t) => t.likely).length;
  const parts = [fresh ? `${fresh} new of ${txs.length} found.` : `No new transactions among the ${txs.length} found.`];
  if (likely) parts.push(`${likely} look like they're already in Wallet (unticked).`);
  setStatus((demo ? 'DEMO DATA, nothing will be sent to Wallet. ' : '') + parts.join(' ') + ruleNote, ruleNote ? 'warn' : '');
  render();
}

// Ignores case, spacing and punctuation. Wallet sometimes cuts descriptions short, so a long enough prefix counts too.
function sameDescription(a, b) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const [x, y] = [n(a), n(b)];
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short === long || (short.length >= 8 && long.startsWith(short));
}

const shortDate = (d) => new Date(`${d}T12:00:00+08:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });

// Tells the user whether Wallet has anything at all for the dates being synced.
function showCoverage(dates, records) {
  const perDay = {};
  records.forEach((r) => { perDay[r.date] = (perDay[r.date] || 0) + 1; });
  const days = [...new Set(dates)];
  const empty = days.filter((d) => !perDay[d]);
  const range = dates[0] === dates.at(-1) ? shortDate(dates[0]) : `${shortDate(dates[0])} – ${shortDate(dates.at(-1))}`;
  let msg = `Wallet has ${records.length} record${records.length === 1 ? '' : 's'} for ${range}.`;
  if (!records.length) msg = `Wallet has no records for ${range}.`;
  else if (empty.length) msg += ` Nothing yet on: ${empty.map(shortDate).join(', ')}.`;
  else msg += ' Every date has at least one record.';
  $('coverage').textContent = msg;
}

function render() {
  $('results').hidden = false;
  $('list').replaceChildren(...txs.map((t, i) => {
    const li = document.createElement('li');
    if (t.done) li.className = 'done';
    else if (t.likely) li.className = 'likely';
    li.innerHTML = `<input type="checkbox" ${t.selected ? 'checked' : ''} ${t.done ? 'disabled' : ''} aria-label="Include">
      <span class="muted">${t.date}</span><span class="desc"></span>
      <span class="amt ${t.amount < 0 ? 'neg' : 'pos'}">${t.done ? '<span class="tag">In Wallet</span> ' : t.likely ? '<span class="tag">Likely in Wallet</span> ' : ''}${fmt(t.amount)}</span>`;
    li.querySelector('.desc').textContent = t.desc;
    li.querySelector('.desc').title = t.desc;
    if (t.likely) {
      const note = document.createElement('span');
      note.className = 'match';
      const text = document.createElement('span');
      text.textContent = `In Wallet as: ${t.match?.desc || '(no description found)'}`;
      const btn = document.createElement('button');
      btn.textContent = 'Replace';
      btn.title = "Set this Wallet record's note to the bank's description. Amount, payer, category and labels are kept.";
      btn.onclick = () => replace([t]);
      note.append(text, btn);
      li.append(note);
    }
    if (t.rule && !t.done && !t.likely) {
      const cat = document.createElement('span');
      cat.className = 'match muted';
      const labels = (t.rule.labels || []).map((l) => l.name).filter(Boolean);
      cat.textContent = `Category: ${t.rule.category.name || 'from your Wallet rule'}${labels.length ? ` · ${labels.join(', ')}` : ''}`;
      li.append(cat);
    }
    li.querySelector('input').onchange = (e) => { t.selected = e.target.checked; updateCount(); };
    return li;
  }));
  updateCount();
}

function selected() { return txs.filter((t) => t.selected && !t.done); }
// Gives the matched Wallet records the bank's description (in the note), so they show as "In Wallet" from now on.
// Only the note is patched: the amount already matched, and payer, category and labels stay as they are.
async function replace(batch) {
  batch = batch.filter((t) => t.likely && (demo || t.match?.id));
  if (!batch.length) return;
  setStatus(`Updating ${batch.length} Wallet record${batch.length === 1 ? '' : 's'}…`);
  try {
    const results = demo
      ? batch.map(() => ({ success: true }))
      : await updateRecords(settings.token, batch.map((t) => ({ id: t.match.id, ...recordText(t) })));
    const failed = [];
    results.forEach((r, i) => { if (r.success) { Object.assign(batch[i], { done: true, likely: false, selected: false }); } else failed.push(r.error); });
    render();
    if (failed.length) setStatus(`Updated ${batch.length - failed.length}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to update ${batch.length}. Nothing was sent.` : `Updated ${batch.length} in Wallet.`);
  } catch (e) { setStatus(e.message, 'error'); }
}

$('replaceAll').onclick = () => replace(txs.filter((t) => t.likely));

function updateCount() {
  const likely = txs.filter((t) => t.likely).length;
  $('replaceAll').hidden = !likely;
  $('replaceAll').textContent = `Replace ${likely} likely`;
  const n = selected().length;
  $('count').textContent = `${n} selected`;
  $('sync').textContent = n ? `Add ${n} to Wallet` : 'Add to Wallet';
  $('sync').disabled = !n;
}

$('toggleAll').onchange = (e) => { txs.forEach((t) => { if (!t.done && !t.likely) t.selected = e.target.checked; }); render(); };

// Shows how each side was parsed (local only), to see why a transaction didn't match its Wallet record.
$('compare').onclick = () => {
  const rows = (list) => list.map((x) => `${x.date}  ${x.amount}  ${x.type || '-'}  ${x.desc}`);
  $('payload').textContent = [
    'Wallet record fields: ' + JSON.stringify(walletRecords.sample || null),
    '', `Wallet records (${walletRecords.length}), as read: date  amount  type  description`, ...rows(walletRecords),
    '', `Bank transactions (${txs.length}), as read: date  amount  type  description`,
    ...rows(txs.map((t) => ({ date: t.date, amount: Math.abs(t.amount), type: t.amount < 0 ? 'expense' : 'income', desc: t.desc }))),
  ].join('\n');
  $('payload').hidden = !$('payload').hidden;
};

$('preview').onclick = () => {
  const records = selected().map((t) => toWalletRecord(t, settings.accountId, settings.currency));
  $('payload').textContent = JSON.stringify(records, null, 2);
  $('payload').hidden = !$('payload').hidden;
};

$('sync').onclick = async () => {
  const batch = selected();
  $('sync').disabled = true;
  setStatus(`Adding ${batch.length} to Wallet…`);
  try {
    const results = demo
      ? batch.map(() => ({ success: true }))
      : await createRecords(settings.token, batch.map((t) => toWalletRecord(t, settings.accountId, settings.currency)));
    const failed = [];
    results.forEach((r, i) => { if (r.success) { batch[i].done = true; batch[i].selected = false; } else failed.push(r.error); });
    render();
    if (failed.length) setStatus(`Added ${batch.length - failed.length}. ${failed.length} failed: ${[...new Set(failed)].join('; ')}`, 'error');
    else setStatus(demo ? `Demo: pretended to add ${batch.length}. Nothing was sent.` : `Added ${batch.length} to Wallet.`);
  } catch (e) { setStatus(e.message, 'error'); updateCount(); }
};

init();
