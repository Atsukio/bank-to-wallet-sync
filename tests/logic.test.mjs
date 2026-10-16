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
check('sameDescription: a note that adds details after the description', wallet.sameDescription('GKS*GATHER CAFE SDN. KUCHING MY - lunch with team', 'GKS*GATHER CAFE SDN. KUCHING MY'));
check('sameDescription: a note that adds details before the description', wallet.sameDescription('Groceries: TESCO EXTRA CHERAS (weekly)', 'TESCO EXTRA CHERAS'));
check('sameDescription: a short bank description is not found inside any note', !wallet.sameDescription('Topped up TNG for parking', 'TNG'));
check('mergedNote: your note first, then the bank description', wallet.mergedNote('Lunch', 'MCDONALDS PAVILION KL') === 'Lunch · MCDONALDS PAVILION KL');
check('mergedNote: an empty note becomes the description', wallet.mergedNote('', 'TNG EWALLET RELOAD') === 'TNG EWALLET RELOAD');
check('mergedNote: a note that already holds the description is left as it is', wallet.mergedNote('Weekly: TESCO EXTRA CHERAS', 'TESCO EXTRA CHERAS') === 'Weekly: TESCO EXTRA CHERAS');
{
  const merged = wallet.mergedNote('x'.repeat(300), 'TESCO EXTRA CHERAS');
  check('mergedNote: fits 255 characters by shortening your part, never the bank\'s', merged.length <= 255 && merged.endsWith('… · TESCO EXTRA CHERAS'), `${merged.length}`);
}
check('sameDescription: a merged note matches even a short description', wallet.sameDescription('Parking · TNG', 'TNG') && !wallet.sameDescription('Parking TNG', 'TNG'));
check('sameDescription: part of the bank description inside a note is not enough', !wallet.sameDescription('Lunch at EXTRA CHERAS food court', 'TESCO EXTRA CHERAS'));
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
check('memoryKey: multi-line details use the most specific later line, not the transaction type',
  wallet.memoryKey('DUITNOW TO ACCOUNT · TEST PAYEE · Netflix') === 'netflix'
  && wallet.memoryKey('TR IBG · PayNet Direct Debit · EXAMPLE ASSET MGMT') === 'example asset'
  && wallet.memoryKey('I-PAYMENT · FPXPAY EXAMPLE FUNDS BERHAD') === 'fpxpay example');
check('memoryKey: a trailing amount line falls back to the first line', wallet.memoryKey('NAENKA NAENKA.COM GB · - US$ 57.24') === 'naenka naenka');
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
{
  // records logged a few days before the bank posted the transaction
  const one = [tx('2026-10-08', 'BOOST JUICE AEON', -19.5)];
  matching.matchRecords(one, [rec('2026-10-07', 19.5, 'expense', 'Juice')]);
  check('earlier date: a record a day earlier is likely, with the lag', one[0].likely && one[0].dateLag === 1 && !one[0].done);
  const claimed = [tx('2026-10-07', 'COFFEE A', -20), tx('2026-10-08', 'COFFEE B', -20)];
  matching.matchRecords(claimed, [rec('2026-10-07', 20, 'expense', 'Coffee')]);
  check('earlier date: a bank row on the earlier day keeps its own record', claimed[0].likely && !claimed[0].dateLag && !claimed[1].likely && !claimed[1].done);
  const far = [tx('2026-10-08', 'X SHOP', -5)];
  matching.matchRecords(far, [rec('2026-10-04', 5, 'expense', 'X SHOP')]);
  check(`earlier date: nothing beyond ${matching.MAX_DATE_LAG} days`, !far[0].likely);
  const wrongType = [tx('2026-10-08', 'X SHOP', -5)];
  matching.matchRecords(wrongType, [rec('2026-10-07', 5, 'income', 'X SHOP')]);
  check('earlier date: an opposite-type record a day earlier is not used', !wrongType[0].likely);
  const prefer = [tx('2026-10-08', 'GRAB RIDE', -12)];
  const sameDesc = rec('2026-10-06', 12, 'expense', 'GRAB RIDE');
  matching.matchRecords(prefer, [rec('2026-10-07', 12, 'expense', 'Something else'), sameDesc]);
  check('earlier date: the same description wins over a closer day', prefer[0].match === sameDesc && prefer[0].dateLag === 2);
  const later = [tx('2026-10-05', 'TR IBG · PayNet Direct Debit · EXAMPLE ASSET MGMT', -300)];
  matching.matchRecords(later, [rec('2026-10-07', 300, 'expense', 'Monthly investment')]);
  check('later date: an automated Wallet record 2 days AFTER the bank matches, with a negative lag', later[0].likely && later[0].dateLag === -2, JSON.stringify(later[0]));
  const tie = [tx('2026-10-05', 'X SHOP', -5)];
  const before = rec('2026-10-04', 5, 'expense', 'X SHOP'), after = rec('2026-10-06', 5, 'expense', 'X SHOP');
  matching.matchRecords(tie, [after, before]);
  check('nearby date: equally close either side, the earlier one wins', tie[0].match === before && tie[0].dateLag === 1);
  const real = [tx('2026-10-05', 'INVEST A', -300), tx('2026-10-07', 'INVEST B', -300)];
  matching.matchRecords(real, [rec('2026-10-07', 300, 'expense', 'Monthly investment')]);
  check('later date: a bank row really on the later day keeps that record', real[1].likely && !real[1].dateLag && !real[0].likely);
  const tooLate = [tx('2026-10-05', 'X SHOP', -5)];
  matching.matchRecords(tooLate, [rec('2026-10-09', 5, 'expense', 'X SHOP')]);
  check('later date: nothing beyond 3 days', !tooLate[0].likely);
  check('shiftDate crosses month ends', matching.shiftDate('2026-10-01', -1) === '2026-09-30' && matching.shiftDate('2026-03-01', -3) === '2026-02-26');
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
check('CIMB Clicks pages are supported', isSupportedUrl('https://www.cimbclicks.com.my/clicks/#/') && !isSupportedUrl('https://cimbclicks.com.my.evil.example/'));
check('look-alike hosts are not', !isSupportedUrl('https://maybank2u.com.my.evil.example/') && !isSupportedUrl('http://www.maybank2u.com.my/') && !isSupportedUrl(undefined));
check('supported banks list is populated', SUPPORTED_BANKS.length >= 1 && SUPPORTED_BANKS.every((b) => b.name && b.country && b.url instanceof RegExp));

finish();
