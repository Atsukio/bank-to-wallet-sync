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
// Ignored rows take no part. Sets t.done / t.likely / t.typeMismatch / t.match (the Wallet record).
export function matchRecords(txs, records) {
  const pool = [...records];
  const take = (t, test) => {
    const i = pool.findIndex((r) => r.date === t.date && Math.abs(r.amount - Math.abs(t.amount)) < 0.005 && test(r));
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  };
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
