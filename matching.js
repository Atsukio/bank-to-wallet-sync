// Pairing the bank's transactions with the Wallet records that already exist, and the other pure helpers the panel uses.
import { sameDescription } from './wallet.js';

// Identifies a bank row across re-reads (and in the "ignored" list): date, description and the amount as read.
export const signature = (t) => `${t.date}|${t.desc}|${t.amount}`;

const typeOf = (t) => (t.amount < 0 ? 'expense' : 'income');

// Marks each transaction against the Wallet records, pairing one-to-one (two identical RM 5 coffees need two records).
// Three passes, strictest first:
//   1. same date, amount, type and description  -> done      ("In Wallet")
//   2. same date, amount and type               -> likely    (different description)
//   3. same date and amount, OPPOSITE type      -> likely, typeMismatch (a wrongly signed record, e.g. an expense
//      added as income: it must not hide the problem by counting as "In Wallet")
//   4. same amount and type, Wallet dated up to 3 days away -> likely, dateLag = bank date minus Wallet date in days
//      (positive: Wallet earlier, e.g. a card purchase logged on the day the bank posts later; negative: Wallet later,
//      e.g. a scheduled/automated Wallet record dated after the bank's debit). Closest day first (earlier wins a tie),
//      same description preferred. It runs last, so a bank row that really is on that other day keeps its record.
// Ignored rows take no part. Sets t.done / t.likely / t.typeMismatch / t.dateLag / t.match (the Wallet record), and
// returns the records no transaction claimed.
export const MAX_DATE_LAG = 3;
export const shiftDate = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
// Order to try: 1 day earlier, 1 day later, 2 earlier, 2 later, … (positive = Wallet earlier than the bank).
const LAGS = Array.from({ length: MAX_DATE_LAG }, (_, i) => [i + 1, -(i + 1)]).flat();

export function matchRecords(txs, records) {
  const pool = [...records];
  const take = (t, test, date = t.date) => {
    const i = pool.findIndex((r) => r.date === date && Math.abs(r.amount - Math.abs(t.amount)) < 0.005 && test(r));
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  };
  const sameText = (t) => (r) => (r.texts || [r.desc]).some((x) => sameDescription(x, t.desc));
  const sameType = (t) => (r) => !r.type || r.type === typeOf(t);
  const open = () => txs.filter((t) => !t.ignored && !t.done && !t.likely);

  for (const t of open()) {
    const m = take(t, (r) => sameType(t)(r) && (r.texts || [r.desc]).some((x) => sameDescription(x, t.desc)));
    if (m) { t.match = m; t.done = true; }
  }
  for (const t of open()) {
    const m = take(t, sameType(t));
    if (m) { t.match = m; t.likely = true; }
  }
  for (const t of open()) {
    const m = take(t, () => true);
    if (m) { t.match = m; t.likely = true; t.typeMismatch = true; }
  }
  for (const preferText of [true, false]) {
    for (const t of open()) {
      for (const lag of LAGS) {
        const m = take(t, (r) => sameType(t)(r) && (!preferText || sameText(t)(r)), shiftDate(t.date, -lag));
        if (m) { t.match = m; t.likely = true; t.dateLag = lag; break; }
      }
    }
  }
  return pool;
}

// Remembers what the user chose by hand for a row, so a re-read (or the next page) doesn't undo it.
export function carryOver(tx, prior) {
  if (!prior) return tx;
  const out = { ...tx };
  if (prior.flipped) { out.amount = -out.amount; out.flipped = true; out.unsure = false; }
  if (prior.selected !== undefined) out.selected = prior.selected;
  if (prior.transferTo) { out.transferTo = prior.transferTo; out.transferAuto = prior.transferAuto; }
  if (prior.rule?.manual) out.rule = prior.rule;
  return out;
}

// The first transfer rule (longest keyword wins) whose keyword is in the description and whose target is another account.
export function matchTransferRule(desc, rules, currentAccountId) {
  const text = (desc || '').toLowerCase();
  let best = null, bestLen = 0;
  for (const r of rules || []) {
    const k = String(r.keyword || '').trim().toLowerCase();
    if (!k || !r.accountId || r.accountId === currentAccountId) continue;
    if (text.includes(k) && k.length > bestLen) { best = r; bestLen = k.length; }
  }
  return best;
}
