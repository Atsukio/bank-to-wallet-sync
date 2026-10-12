const BASE = 'https://rest.budgetbakers.com/wallet/v1/api';
// Earlier versions appended this tag to notes. It's no longer written, but is stripped when reading old records.
const LEGACY_TAG_RE = /\s*\[m2u:[a-f0-9]{12}\]/;

// Behaviour switches on the Settings page (background.js imports the two it needs).
export const BEHAVIOUR_DEFAULTS = { onlySupported: true, autoRead: true, hideWhenAway: true, collectPages: false };

// Everything the extension stores, with defaults. Only the token is secret; the rest are the user's own choices.
export async function getSettings() {
  return chrome.storage.local.get({
    token: '', accountId: '', accountName: '', currency: 'MYR',
    ...BEHAVIOUR_DEFAULTS,
    accountMap: {},      // bank account key -> Wallet account id (see popup.js bankKey)
    transferRules: [],   // [{ keyword, accountId }]: matching rows are created as transfers to that account
    categoryMemory: {},  // merchant key -> { id, name }: categories the user picked by hand
    ignored: [],         // signatures of rows the user chose never to sync
    lastAdd: null,       // { groups: [[recordId, mirrorId?]], at }: what the last "Add" created, for Undo
    accountList: [],     // [{ id, name }] last seen Wallet accounts, so Settings can offer them without a request
  });
}

// meta (optional) is filled with how fresh Wallet's data is: the API serves its own synced copy, so changes made in
// the Wallet app (e.g. deleting a record) can take a while to show.
async function call(token, path, opts = {}, meta) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (meta) {
    meta.syncing = res.headers.get('X-Sync-In-Progress') === 'true';
    meta.changedAt = res.headers.get('X-Last-Data-Change-At') || undefined;
  }
  if (res.status === 401 || res.status === 403) throw new Error('Wallet rejected the API token. Check it in Settings.');
  if (res.status === 409) throw new Error('Wallet is still doing its first data sync for this token. Try again in a few minutes.');
  if (res.status === 429) throw new Error(`Wallet rate limit reached. Retry in ${res.headers.get('Retry-After') || 'a few'} seconds.`);
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 207) throw new Error(`Wallet returned ${res.status}: ${body?.message || body?.error || 'unknown error'}`);
  return body;
}

// Archived accounts are left out: they're hidden in Wallet and shouldn't receive new records.
export async function listAccounts(token) {
  const data = await call(token, '/accounts?limit=200');
  return (data.accounts || data.items || (Array.isArray(data) ? data : [])).filter((a) => !a.archived);
}

// Current balance of an account object from listAccounts() as { value, currency }, or null if Wallet doesn't report one.
export function balanceOf(account) {
  const b = account?.balance;
  return typeof b?.currentBalance === 'number' ? { value: b.currentBalance, currency: b.currencyCode || account.currencyCode } : null;
}

// Active categories for the per-row category picker: [{ id, name, group }], sorted by group then name.
export async function listCategories(token) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 5; page++) {
    const data = await call(token, `/categories?limit=200&offset=${offset}`);
    for (const c of data.categories || data.items || []) {
      if (c.archived || c.enabled === false || !c.id || !c.name) continue;
      out.push({ id: c.id, name: c.parentName ? `${c.parentName} › ${c.name}` : c.name, group: c.group?.name || '' });
    }
    if (data.nextOffset == null) break;
    offset = data.nextOffset;
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

// The user's Wallet categorisation rules (keywords -> category and labels). Wallet applies these to bank-sync and
// GPay imports but not to records created through the API, so we apply them ourselves.
export async function listRules(token) {
  const data = await call(token, '/record-rules?limit=200');
  return data.recordRules || data.rules || data.items || (Array.isArray(data) ? data : []);
}

// Returns the best matching rule for a bank description, or null. A keyword matches if it appears in the description
// ignoring case; the rule with the longest matching keyword wins, so "STARBUCKS MID VALLEY" beats "STAR".
// Transfer rules (with a target account) are skipped, as are rules limited to a different account.
export function matchRule(desc, rules, accountId) {
  const text = (desc || '').toLowerCase();
  let best = null, bestLen = 0;
  for (const rule of rules) {
    if (!rule.category?.id || rule.toAccountId) continue;
    if (rule.fromAccountId && rule.fromAccountId !== accountId) continue;
    for (const kw of rule.keywords || []) {
      const k = String(kw).trim().toLowerCase();
      if (k && k.length > bestLen && text.includes(k)) { best = rule; bestLen = k.length; }
    }
  }
  return best;
}

// Hand-entered records may keep the description in the note or in the payer, so keep every text they have.
function recordTexts(r) {
  return [...new Set([r.note, r.counterParty, r.payee, r.merchant, r.description]
    .map((v) => (typeof v === 'string' ? v : v?.name || '').replace(LEGACY_TAG_RE, '').trim()).filter(Boolean))];
}

// Ignores case, spacing and punctuation. Wallet sometimes cuts descriptions short, so a long enough prefix counts too.
export function sameDescription(a, b) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const [x, y] = [n(a), n(b)];
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short === long || (short.length >= 8 && long.startsWith(short));
}

// The merchant part of a description: its first two words with digits, codes and punctuation dropped, so
// "AMAZON MKTPL*5998T9QM0 Amzn.com/billUS" and "AMAZON MKTPL*77AB12 Amzn.com/billUS" share "amazon mktpl".
export const merchantKey = (s) => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 2).join(' ');

// A merchant key specific enough to learn from or remember (two words, or one long word), else ''.
export const memoryKey = (s) => { const k = merchantKey(s); return k.includes(' ') || k.length >= 5 ? k : ''; };

// Categorised records from roughly the last six months (any account), newest first, for guessing the category of a
// new transaction from what the user already filed under the same merchant. "Unknown" categories teach nothing.
export async function categoryHistory(token) {
  const out = [];
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  let offset = 0;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ limit: '200', offset: String(offset), sortBy: '-recordDate' });
    q.append('recordDate', `gte.${since}`);
    const data = await call(token, `/records?${q}`);
    for (const r of data.records || []) {
      const cat = r.category;
      if (!cat?.id || /unknown/i.test(cat.name || '') || String(r.recordState).toLowerCase() === 'void') continue;
      const texts = recordTexts(r);
      if (!texts.length) continue;
      out.push({ texts, keys: [...new Set(texts.map(memoryKey).filter(Boolean))],
        category: { id: cat.id, name: cat.name }, type: String(r.recordType || '').toLowerCase() });
    }
    if (data.nextOffset == null) break;
    offset = data.nextOffset;
  }
  return out;
}

// Best category for a transaction from past records of the same income/expense type: the same description first,
// then the same merchant. The most common category among the matches wins (ties go to the most recent).
// Returns a rule-shaped object ({ category, labels, guessed, count }) or null.
export function guessCategory(tx, history) {
  const type = tx.amount < 0 ? 'expense' : 'income';
  const pool = history.filter((h) => !h.type || h.type === type);
  const key = memoryKey(tx.desc);
  const matches = (test) => pool.filter(test);
  let found = matches((h) => h.texts.some((x) => sameDescription(x, tx.desc)));
  if (!found.length && key) found = matches((h) => h.keys.includes(key));
  if (!found.length) return null;
  const counts = new Map();
  for (const h of found) counts.set(h.category.id, { cat: h.category, n: (counts.get(h.category.id)?.n || 0) + 1 });
  const best = [...counts.values()].reduce((a, b) => (b.n > a.n ? b : a));
  return { category: best.cat, labels: [], guessed: true, count: best.n };
}

const MY_OFFSET_MS = 8 * 3600e3;
const myDate = (iso) => new Date(new Date(iso).getTime() + MY_OFFSET_MS).toISOString().slice(0, 10);

// Returns every Wallet record for this account between two YYYY-MM-DD dates (Malaysia time, inclusive):
// { id, date, amount (absolute), type, texts (note, payer, ...), desc (texts joined for display) }.
export async function existingRecords(token, accountId, from, to) {
  const out = [];
  out.meta = {};
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: '200', offset: String(offset) });
    q.append('recordDate', `gte.${new Date(`${from}T00:00:00+08:00`).toISOString()}`);
    q.append('recordDate', `lte.${new Date(`${to}T23:59:59+08:00`).toISOString()}`);
    const data = await call(token, `/records?${q}`, {}, out.meta);
    for (const r of data.records || []) {
      const acc = r.accountId ?? r.account?.id;
      if (acc && acc !== accountId) continue;
      if (String(r.recordState).toLowerCase() === 'void') continue; // cancelled/reversed: the bank's transaction isn't recorded by it
      const rawAmount = r.amount?.value ?? r.amount?.amount ?? r.amount ?? r.value;
      const value = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount).replace(/,/g, ''));
      if (!out.sample) out.sample = { keys: Object.keys(r), amountShape: typeof r.amount === 'object' ? Object.keys(r.amount || {}) : typeof r.amount, recordType: r.recordType };
      const texts = recordTexts(r);
      out.push({
        id: r.id,
        source: r.source,
        state: r.recordState,
        updatedAt: r.updatedAt,
        date: myDate(r.recordDate),
        amount: Math.abs(value),
        type: String(r.recordType || '').toLowerCase() || undefined,
        texts,
        desc: texts.join(' · '),
      });
    }
    if (data.nextOffset == null) break;
    offset = data.nextOffset;
  }
  return out;
}

// The bank's description goes in the note (255 characters max). The payer/payee field (counterParty) is left unset.
export function recordText(tx) {
  return { note: tx.desc.slice(0, 255) };
}

// Body of POST /records (see https://rest.budgetbakers.com/wallet/openapi). The amount's sign decides
// income vs expense, so there is no separate type field. A row marked as a transfer (tx.transferTo) asks Wallet to
// create the paired record on the other account and gets no category or labels: Wallet files transfers itself.
export function toWalletRecord(tx, accountId, currency) {
  const base = {
    accountId,
    recordDate: new Date(`${tx.date}T12:00:00+08:00`).toISOString(),
    amount: { value: tx.amount, ...(currency && { currencyCode: currency }) },
    ...recordText(tx),
  };
  if (tx.transferTo) return { ...base, transfer: { pairingMode: 'new', accountId: tx.transferTo } };
  const rule = tx.rule;
  const labelIds = (rule?.labels || []).filter((l) => l.id && !l.archived).map((l) => l.id);
  return {
    ...base,
    ...(rule?.category?.id && { categoryId: rule.category.id }),
    ...(labelIds.length && { labelIds }),
  };
}

// PATCH in batches of 10 (the API maximum). patches: [{ id, ...fields }]. Returns results aligned with the input.
export async function updateRecords(token, patches) {
  const results = [];
  for (let i = 0; i < patches.length; i += 10) {
    const chunk = patches.slice(i, i + 10);
    const data = await call(token, '/records', { method: 'PATCH', body: JSON.stringify(chunk) });
    const rows = data?.results || [];
    chunk.forEach((_, j) => {
      const r = rows.find((x) => x.inputIndex === j);
      results.push(r || { success: false, error: 'No result returned for this item' });
    });
  }
  return results;
}

// POST in batches of 20. Returns per-transaction results aligned with the input. A successful result carries the new
// record's `id` and, for a transfer, `createdMirrorRecordId`.
export async function createRecords(token, records) {
  const results = [];
  for (let i = 0; i < records.length; i += 20) {
    const chunk = records.slice(i, i + 20);
    const data = await call(token, '/records', { method: 'POST', body: JSON.stringify(chunk) });
    const rows = data?.results || [];
    chunk.forEach((_, j) => {
      const r = rows.find((x) => x.inputIndex === j);
      results.push(r || { success: false, error: 'No result returned for this item' });
    });
  }
  return results;
}

// Packs ID groups into DELETE requests of at most 10 IDs, never splitting a group: a transfer and its mirror record
// have to be deleted in the same request or Wallet rejects it.
export function chunkGroups(groups, max = 10) {
  const chunks = [];
  let cur = [];
  for (const g of groups) {
    if (cur.length && cur.length + g.length > max) { chunks.push(cur); cur = []; }
    cur.push(...g);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// DELETE /records for groups of IDs (see chunkGroups). Returns { deleted, failed: [error messages] }.
export async function deleteRecords(token, groups) {
  let deleted = 0;
  const failed = [];
  for (const ids of chunkGroups(groups)) {
    const data = await call(token, '/records', { method: 'DELETE', body: JSON.stringify({ ids }) });
    for (const r of data?.results || []) {
      if (r.success) deleted++; else failed.push(r.error || 'unknown error');
    }
  }
  return { deleted, failed };
}
