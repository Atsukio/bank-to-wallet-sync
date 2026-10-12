// Pure logic: no browser needed.
import { check, finish, ROOT } from './helpers.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const load = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const wallet = await load('wallet.js');
const matching = await load('matching.js');
const { isSupportedUrl, SUPPORTED_BANKS } = await load('sites.js');

// ---- sameDescription / matchRule
check('sameDescription ignores case and punctuation', wallet.sameDescription('Gather Cafe, KL', 'GATHER CAFE KL'));
check('sameDescription accepts a long truncated prefix', wallet.sameDescription('PETRONAS SETIA ALAM SELANGOR MY', 'PETRONAS SETIA ALAM'));
check('sameDescription rejects short prefixes', !wallet.sameDescription('TNG', 'TNG EWALLET RELOAD'));
const rules = [
  { keywords: ['star'], category: { id: 'x', name: 'Other' } },
  { keywords: ['starbucks'], category: { id: 'food', name: 'Food' } },
  { keywords: ['repay'], category: { id: 't', name: 'T' }, toAccountId: 'a2' },
  { keywords: ['grab'], category: { id: 'tr', name: 'Transport' }, fromAccountId: 'other' },
];
check('matchRule: longest keyword wins', wallet.matchRule('STARBUCKS MID VALLEY', rules, 'a1')?.category.id === 'food');
check('matchRule: transfer rules are skipped', wallet.matchRule('CARD REPAYMENT', rules, 'a1') === null);
check('matchRule: rules for another account are skipped', wallet.matchRule('GRAB KL', rules, 'a1') === null);

// ---- guessCategory (history learned from past records)
globalThis.fetch = async () => ({
  ok: true, status: 200, headers: new Headers(),
  json: async () => ({ records: [
    { note: 'GKS*GATHER CAFE SDN. KUCHING MY', category: { id: 'food', name: 'Food & Drinks' }, recordType: 'expense' },
    { note: 'GKS*GATHER CAFE SDN. KUCHING MY', category: { id: 'food', name: 'Food & Drinks' }, recordType: 'expense' },
    { note: 'AMAZON MKTPL*77AB12 Amzn.com/billUS', category: { id: 'shop', name: 'Shopping' }, recordType: 'expense' },
    { note: 'NAENKA NAENKA.COM GB', category: { id: 'unk', name: 'Unknown expense' }, recordType: 'expense' },
    { note: 'VOID SHOP', category: { id: 'shop', name: 'Shopping' }, recordType: 'expense', recordState: 'void' },
    { note: 'SALARY ACME', category: { id: 'inc', name: 'Income' }, recordType: 'income' },
    { note: 'SALARY ACME', category: { id: 'shop', name: 'Shopping' }, recordType: 'expense' },
  ] }),
});
const history = await wallet.categoryHistory('t');
const guess = (desc, amount) => wallet.guessCategory({ desc, amount }, history)?.category.name ?? null;
check('guess: same description', guess('GKS*GATHER CAFE SDN. KUCHING MY', -127) === 'Food & Drinks');
check('guess: same merchant, new reference code', guess('AMAZON MKTPL*5998T9QM0 Amzn.com/billUS', -639) === 'Shopping');
check('guess: "Unknown" categories are never learned', guess('NAENKA NAENKA.COM GB', -239) === null);
check('guess: void records are ignored', guess('VOID SHOP', -5) === null);
check('guess: income and expense histories are separate', guess('SALARY ACME', 4200) === 'Income' && guess('SALARY ACME', -50) === 'Shopping');
check('guess: unseen merchant gives nothing', guess('TOTALLY NEW PLACE', -9) === null);
check('memoryKey needs a specific merchant', wallet.memoryKey('TNG') === '' && wallet.memoryKey('AMAZON MKTPL*1') === 'amazon mktpl');

// ---- matchRecords: pairing with Wallet, including the opposite-type case
const tx = (date, desc, amount, extra = {}) => ({ date, desc, amount, ...extra });
const rec = (date, amount, type, desc) => ({ date, amount, type, desc, texts: [desc] });
{
  const txs = [tx('2026-10-01', 'A SHOP', -10), tx('2026-10-01', 'B SHOP', -20), tx('2026-10-02', 'C SHOP', -30), tx('2026-10-03', 'D SHOP', -40), tx('2026-10-03', 'D SHOP', -40)];
  matching.matchRecords(txs, [
    rec('2026-10-01', 10, 'expense', 'A SHOP'),     // exact -> done
    rec('2026-10-01', 20, 'expense', 'Lunch'),      // other description -> likely
    rec('2026-10-02', 30, 'income', 'C SHOP'),      // opposite type -> likely + mismatch
    rec('2026-10-03', 40, 'expense', 'D SHOP'),     // only one record for two identical rows
  ]);
  check('match: exact is done', txs[0].done && !txs[0].likely);
  check('match: different description is likely', txs[1].likely && !txs[1].typeMismatch);
  check('match: opposite type is likely with a mismatch, never "done"', txs[2].likely && txs[2].typeMismatch && !txs[2].done);
  check('match: records pair one-to-one (second identical row stays new)', txs[3].done && !txs[4].done && !txs[4].likely);
  const ignored = [tx('2026-10-01', 'A SHOP', -10, { ignored: true })];
  matching.matchRecords(ignored, [rec('2026-10-01', 10, 'expense', 'A SHOP')]);
  check('match: ignored rows take no part', !ignored[0].done && !ignored[0].likely);
}
check('signature is stable', matching.signature(tx('2026-10-01', 'X', -1)) === '2026-10-01|X|-1');

// ---- carryOver keeps the user's manual choices
{
  const out = matching.carryOver(tx('d', 'x', 5, { selected: true }), { flipped: true, selected: false, transferTo: 'a2', transferAuto: true, rule: { manual: true, category: { id: 'c' } } });
  check('carryOver: flip, selection, transfer and manual category survive', out.amount === -5 && out.selected === false && out.transferTo === 'a2' && out.rule.manual === true);
  const auto = matching.carryOver(tx('d', 'x', 5), { rule: { guessed: true } });
  check('carryOver: guesses are recomputed, not carried', auto.rule === undefined);
}

// ---- transfer rules
const trules = [{ keyword: 'repay', accountId: 'a2' }, { keyword: 'repayment spay', accountId: 'a3' }, { keyword: 'self', accountId: 'a1' }];
check('transfer rule: longest keyword wins', matching.matchTransferRule('SPAYLATER REPAYMENT SPAY', trules, 'a1')?.accountId === 'a3');
check('transfer rule: never targets the account in use', matching.matchTransferRule('SELF TRANSFER', trules, 'a1') === null);
check('transfer rule: no keyword, no match', matching.matchTransferRule('NETFLIX', trules, 'a1') === null);

// ---- payloads
{
  const plain = wallet.toWalletRecord(tx('2026-10-01', 'TESCO', -10, { rule: { category: { id: 'food' }, labels: [{ id: 'home' }, { id: 'old', archived: true }] } }), 'a1', 'MYR');
  check('payload: category and active labels', plain.categoryId === 'food' && plain.labelIds.length === 1 && plain.labelIds[0] === 'home');
  check('payload: negative amount stays negative', plain.amount.value === -10 && plain.amount.currencyCode === 'MYR');
  const transfer = wallet.toWalletRecord(tx('2026-10-10', 'REPAYMENT', -3131.27, { transferTo: 'a2', rule: { category: { id: 'food' } } }), 'a1', 'MYR');
  check('payload: transfer asks Wallet for a paired record', transfer.transfer?.pairingMode === 'new' && transfer.transfer.accountId === 'a2');
  check('payload: transfers carry no category', !('categoryId' in transfer) && !('labelIds' in transfer));
  check('payload: currency omitted when unknown', !('currencyCode' in wallet.toWalletRecord(tx('2026-10-01', 'X', -1), 'a1', undefined).amount));
}

// ---- delete batching never splits a transfer from its mirror
{
  const groups = [['r1'], ['r2', 'm2'], ['r3'], ['r4', 'm4'], ['r5'], ['r6', 'm6'], ['r7'], ['r8', 'm8'], ['r9']];
  const chunks = wallet.chunkGroups(groups);
  const flat = chunks.flat();
  check('delete: every id is sent exactly once', flat.length === 13 && new Set(flat).size === 13);
  check('delete: at most 10 ids per request', chunks.every((c) => c.length <= 10));
  check('delete: a transfer and its mirror share a request', chunks.every((c) => !c.some((id, i) => id.startsWith('r') && ['2', '4', '6', '8'].includes(id[1]) && !c.includes(`m${id[1]}`))));
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(JSON.parse(opts.body).ids); return { ok: true, status: 200, headers: new Headers(), json: async () => ({ results: JSON.parse(opts.body).ids.map((id) => ({ id, success: true })) }) }; };
  const out = await wallet.deleteRecords('t', groups);
  check('delete: reports the count and no failures', out.deleted === 13 && out.failed.length === 0 && calls.length === chunks.length);
}

// ---- balances and sites
check('balanceOf reads current balance', wallet.balanceOf({ currencyCode: 'MYR', balance: { currentBalance: -12.5 } })?.value === -12.5);
check('balanceOf is null without a balance', wallet.balanceOf({ id: 'x' }) === null);
check('maybank2u pages are supported', isSupportedUrl('https://www.maybank2u.com.my/home/m2u/common/login.do'));
check('look-alike hosts are not', !isSupportedUrl('https://maybank2u.com.my.evil.example/') && !isSupportedUrl('http://www.maybank2u.com.my/') && !isSupportedUrl(undefined));
check('supported banks list is populated', SUPPORTED_BANKS.length >= 1 && SUPPORTED_BANKS.every((b) => b.name && b.country && b.url instanceof RegExp));

finish();
