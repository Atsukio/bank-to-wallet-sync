const BASE = 'https://rest.budgetbakers.com/wallet/v1/api';
// Earlier versions appended this tag to notes. It's no longer written, but is stripped when reading old records.
const LEGACY_TAG_RE = /\s*\[m2u:[a-f0-9]{12}\]/;

export async function getSettings() {
  return chrome.storage.local.get({ token: '', accountId: '', accountName: '', currency: 'MYR' });
}

async function call(token, path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Wallet rejected the API token. Check it in Settings.');
  if (res.status === 409) throw new Error('Wallet is still doing its first data sync for this token. Try again in a few minutes.');
  if (res.status === 429) throw new Error(`Wallet rate limit reached. Retry in ${res.headers.get('Retry-After') || 'a few'} seconds.`);
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 207) throw new Error(`Wallet returned ${res.status}: ${body?.message || body?.error || 'unknown error'}`);
  return body;
}

export async function listAccounts(token) {
  const data = await call(token, '/accounts?limit=200');
  return data.accounts || data.items || (Array.isArray(data) ? data : []);
}

const MY_OFFSET_MS = 8 * 3600e3;
const myDate = (iso) => new Date(new Date(iso).getTime() + MY_OFFSET_MS).toISOString().slice(0, 10);

// Returns every Wallet record for this account between two YYYY-MM-DD dates (Malaysia time, inclusive):
// { id, date, amount (absolute), type, texts (note, payer, ...), desc (texts joined for display) }.
export async function existingRecords(token, accountId, from, to) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: '200', offset: String(offset) });
    q.append('recordDate', `gte.${new Date(`${from}T00:00:00+08:00`).toISOString()}`);
    q.append('recordDate', `lte.${new Date(`${to}T23:59:59+08:00`).toISOString()}`);
    const data = await call(token, `/records?${q}`);
    for (const r of data.records || []) {
      const acc = r.accountId ?? r.account?.id;
      if (acc && acc !== accountId) continue;
      const rawAmount = r.amount?.value ?? r.amount?.amount ?? r.amount ?? r.value;
      const value = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount).replace(/,/g, ''));
      if (!out.sample) out.sample = { keys: Object.keys(r), amountShape: typeof r.amount === 'object' ? Object.keys(r.amount || {}) : typeof r.amount, recordType: r.recordType };
      // Hand-entered records may keep the description in the note or in the payer, so keep both.
      const texts = [...new Set([r.note, r.counterParty, r.payee, r.merchant, r.description]
        .map((v) => (typeof v === 'string' ? v : v?.name || '').replace(LEGACY_TAG_RE, '').trim()).filter(Boolean))];
      out.push({
        id: r.id,
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
// income vs expense, so there is no separate type field.
export function toWalletRecord(tx, accountId, currency) {
  return {
    accountId,
    recordDate: new Date(`${tx.date}T12:00:00+08:00`).toISOString(),
    amount: { value: tx.amount, currencyCode: currency },
    ...recordText(tx),
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

// POST in batches of 20. Returns per-transaction results aligned with the input.
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
