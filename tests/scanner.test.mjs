// scanPage / detectAccount, run against synthetic pages in a headless browser.
import fs from 'node:fs';
import path from 'node:path';
import { check, finish, launch, ROOT } from './helpers.mjs';

// scanner.js's functions are injected into pages, so evaluate their source in the page just like the extension does.
const src = fs.readFileSync(path.join(ROOT, 'scanner.js'), 'utf8').replace(/export /g, '');
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const H = ['Date', 'Description', 'Amount', 'Balance'], H0 = ['Date', 'Description', 'Amount'];
const red = (t) => `<span style="color:#d32f2f">${t}</span>`, green = (t) => `<span style="color:#1b7a3a">${t}</span>`;

// [html, expected amounts]; 'unsure' means the row is flagged for the user to check
const cases = {
  'red text, no minus': [table(H0, [['10/10/2026', 'A', red('RM 239.69')], ['09/10/2026', 'B', red('RM 3,131.27')]]), [-239.69, -3131.27]],
  'minus drawn by CSS': ['<style>.d::before{content:"- "}</style>' + table(H0, [['10/10/2026', 'A', '<span class="d">RM 239.69</span>']]), [-239.69]],
  'green credit stays positive': [table(H0, [['10/10/2026', 'A', green('RM 300.00')], ['09/10/2026', 'B', red('RM 5.00')]]), [300, -5]],
  'plain black stays positive': [table(H0, [['10/10/2026', 'A', 'RM 300.00']]), [300]],
  'unicode minus': [table(H0, [['01/10/2026', 'A', '−10.00'], ['02/10/2026', 'B', '300.00'], ['03/10/2026', 'C', '–5.00']]), [-10, 300, -5]],
  'trailing signs': [table(H0, [['01/10/2026', 'A', '10.00-'], ['02/10/2026', 'B', '300.00+'], ['03/10/2026', 'C', '5.00-']]), [-10, 300, -5]],
  'DB / CR / DR suffixes': [table(H0, [['01/10/2026', 'A', '10.00 DB'], ['02/10/2026', 'B', '300.00 CR'], ['03/10/2026', 'C', '5.00 DR']]), [-10, 300, -5]],
  'unsigned, balances newest-first': [table(H, [['03/10/2026', 'C', '5.00', '1,285.00'], ['02/10/2026', 'B', '300.00', '1,290.00'], ['01/10/2026', 'A', '10.00', '990.00'], ['30/09/2026', 'Z', '1.00', '1,000.00']]), [-5, 300, -10, 'unsure']],
  'unsigned, balances oldest-first': [table(H, [['01/10/2026', 'A', '10.00', '990.00'], ['02/10/2026', 'B', '300.00', '1,290.00'], ['03/10/2026', 'C', '5.00', '1,285.00']]), ['unsure', 300, -5]],
  'balance overrides a wrong "+"': [table(H, [['02/10/2026', 'B', '300.00+', '690.00'], ['01/10/2026', 'A', '10.00', '990.00']]), [-300, 'unsure']],
  'balances that do not line up': [table(H, [['02/10/2026', 'B', '7.00-', '500.00'], ['01/10/2026', 'A', '10.00', '990.00']]), [-7, 10]],
  // CIMB-style layouts (synthetic): separate money-out / money-in columns, a combined column, Malay headings
  'withdrawal / deposit columns with a balance': [table(['Transaction Date', 'Description', 'Withdrawal (RM)', 'Deposit (RM)', 'Balance (RM)'], [
    ['12 Oct 2026', 'DUITNOW TRANSFER', '50.00', '', '1,150.00'], ['11 Oct 2026', 'SALARY', '', '1,000.00', '1,200.00'], ['10 Oct 2026', 'GRAB', '20.00', '', '200.00']]), [-50, 1000, -20]],
  'one combined Debit/Credit column': [table(['Date', 'Description', 'Debit/Credit (RM)'], [['12/10/2026', 'A', '-50.00'], ['11/10/2026', 'B', '1,000.00'], ['10/10/2026', 'C', '-20.00']]), [-50, 1000, -20]],
  'Malay headings': [table(['Tarikh', 'Keterangan', 'Pengeluaran (RM)', 'Simpanan (RM)', 'Baki (RM)'], [['12/10/2026', 'A', '15.00', '', '985.00'], ['11/10/2026', 'B', '', '500.00', '1,000.00']]), [-15, 500]],
};

const browser = await launch();
const page = await browser.newPage();
const scan = async (html) => { await page.setContent(`<body>${html}</body>`); return page.evaluate(`(() => { ${src}; return scanPage().map((t) => (t.unsure ? 'unsure' : t.amount)); })()`); };
for (const [name, [html, want]] of Object.entries(cases)) {
  const got = await scan(html);
  check(`sign: ${name}`, want.every((w, i) => got[i] === w), JSON.stringify(got));
}

// ---- CIMB Clicks layout (structure copied from the real page; every value here is invented)
const cimbAmount = (v) => {
  if (!v) return '<span>&nbsp;</span>';
  const [whole, dec] = v.split('.');
  return `<number-cmp><span class="positive-number"><span class="currency">MYR</span>
    <span class="whole-number"><span class="positive-number">${whole}</span><!----><span>.</span><!----><span class="decimal-part">${dec}</span></span><span></span></span></number-cmp>`;
};
const cimbRow = (date, lines, moneyIn, moneyOut, balance, i) => `<tr ui-rendered="">
  <td class="cv-top" data-search="redacted"><span>${date}</span></td>
  <td data-search="redacted">
    <div class="showLessDetails_${i}">${lines.map((l) => `<p>${l}</p>`).join('')}<p></p></div>
    <div style="display:none; word-break: break-all;" class="showMoreDetails_${i}">${lines.map((l) => `<p>${l}</p>`).join('')}<p>SHOULD NOT APPEAR</p></div>
  </td>
  <td style="white-space: nowrap;">${cimbAmount(moneyIn)}</td>
  <td style="white-space: nowrap;">${cimbAmount(moneyOut)}</td>
  <td class="result-col" style="white-space: nowrap;">${cimbAmount(balance)}</td></tr>`;
const cimbTable = (wrapperStyle = '') => `<div class="table-responsive hidden-xs hidden-sm trx-histoy-table" style="${wrapperStyle}">
  <table class="table table-hover dataTable no-footer" id="basicTableHistory">
  <thead><tr><th><span>Date</span><i class="icon icon--arrow-bt"></i></th><th>Transaction Details</th><th>Money In</th><th>Money Out</th><th>Balance</th></tr></thead>
  <tbody>${[
    ['07 Oct 2026', ['I-PAYMENT', 'FPXPAY EXAMPLE FUNDS BERHAD', '11112222', '333344445555666'], '', '250.00', '112.47'],
    ['07 Oct 2026', ['DUITNOW TO ACCOUNT', '123456789', 'TEST PAYEE', 'Fund Transfer'], '100.00', '', '362.47'],
    ['05 Oct 2026', ['TR IBG', '5000000001', 'PayNet Direct Debit', 'EXAMPLE ASSET MGMT'], '', '300.00', '262.47'],
    ['01 Oct 2026', ['DUITNOW TO ACCOUNT', '987654321', 'TEST PAYEE', 'Netflix'], '', '16.00', '562.47'],
    ['30 Sep 2026', ['CREDIT INTEREST'], '0.06', '', '578.47'],
  ].map((r, i) => cimbRow(...r, i)).join('')}</tbody></table></div>
  <div class="visible-xs-block trx-history-mobile"><div class="history-record"><span>Wed, 07 Oct</span><span>MYR 250.00</span></div></div>`;
const cimbWant = [
  { date: '2026-10-07', desc: 'I-PAYMENT · FPXPAY EXAMPLE FUNDS BERHAD', amount: -250 },
  { date: '2026-10-07', desc: 'DUITNOW TO ACCOUNT · TEST PAYEE · Fund Transfer', amount: 100 },
  { date: '2026-10-05', desc: 'TR IBG · PayNet Direct Debit · EXAMPLE ASSET MGMT', amount: -300 },
  { date: '2026-10-01', desc: 'DUITNOW TO ACCOUNT · TEST PAYEE · Netflix', amount: -16 },
  { date: '2026-09-30', desc: 'CREDIT INTEREST', amount: 0.06 },
];
const scanFull = async (html) => { await page.setContent(`<body>${html}</body>`); return page.evaluate(`(() => { ${src}; return scanPage(); })()`); };
for (const [name, style] of [['desktop layout', ''], ['table hidden by the mobile layout (narrow window)', 'display:none']]) {
  const got = await scanFull(cimbTable(style));
  const simple = got.map(({ date, desc, amount }) => ({ date, desc, amount }));
  check(`CIMB ${name}: dates, details and signs`, JSON.stringify(simple) === JSON.stringify(cimbWant), JSON.stringify(simple));
  check(`CIMB ${name}: the hidden "show more" copy is never read`, !JSON.stringify(got).includes('SHOULD NOT APPEAR'));
  check(`CIMB ${name}: account and reference numbers are dropped`, !/\d{6,}/.test(got.map((t) => t.desc).join(' ')));
  check(`CIMB ${name}: no row is flagged unsure (balances confirm the signs)`, got.every((t) => !t.unsure));
}

// ---- readBalance (CIMB account header structure; values invented)
const valueBox = (label, whole, dec) => `<div class="col-md-3 value-box"><label>${label}</label><div class="value"><number-cmp><span class="positive-number">
  <span class="currency">MYR</span><span class="whole-number"><span class="positive-number">${whole}</span><!----><span>.</span><!----><span class="decimal-part">${dec}</span></span><span></span></span></number-cmp></div></div>`;
const balanceOf = async (html) => { await page.setContent(`<body>${html}</body>`); return page.evaluate(`(() => { ${src}; return readBalance(); })()`); };
let bal = await balanceOf(`<div class="panel-title">${valueBox('Current Balance', '1,234', '56')}${valueBox('Available Balance', '1,200', '00')}</div>${cimbTable()}`);
check('balance: CIMB current balance (split whole/decimal spans)', bal?.label === 'Current Balance' && bal?.amount === 1234.56, JSON.stringify(bal));
bal = await balanceOf(`${valueBox('Available Balance', '88', '10')}`);
check('balance: falls back to available balance', bal?.label === 'Available Balance' && bal?.amount === 88.1, JSON.stringify(bal));
bal = await balanceOf(`<dl><dt>Outstanding Balance</dt><dd>RM 12,252.42</dd></dl>`);
check('balance: a card\'s outstanding balance is read as shown (positive)', bal?.label === 'Outstanding Balance' && bal?.amount === 12252.42, JSON.stringify(bal));
// Maybank2u card summary: label in .panel-body, amount in the sibling .well (values invented)
const m2uCard = (label, amount) => `<div class="col-sm-4"><div class="panel"><div class="panel-body"><div class="container-fluid"><div class="row"><p>${label}</p><div class="due"></div></div></div><div class="well"><div><div class="amount"><span>RM</span><span>${amount}</span></div><button>PAY NOW</button></div></div></div></div></div>`;
bal = await balanceOf(`<div class="row">${m2uCard('Minimum Payment', '100.00')}${m2uCard('Statement Balance', '2,000.00')}${m2uCard('Outstanding Balance', '3,456.78')}</div>`);
check('balance: Maybank2u card prefers outstanding over statement balance', bal?.label === 'Outstanding Balance' && bal?.amount === 3456.78, JSON.stringify(bal));
bal = await balanceOf(`<div class="row">${m2uCard('Minimum Payment', '100.00')}${m2uCard('Statement Balance', '2,000.00')}</div>`);
check('balance: falls back to the statement balance', bal?.label === 'Statement Balance' && bal?.amount === 2000, JSON.stringify(bal));
bal = await balanceOf(cimbTable());
check('balance: a transactions table\'s Balance column is not mistaken for the account balance', bal === null, JSON.stringify(bal));

// ---- detectAccount
const detect = async (html) => { await page.setContent(`<body>${html}</body>`); return page.evaluate(`(() => { ${src}; return detectAccount(); })()`); };
const a1 = await detect('<h1>Maybank Shopee Visa Platinum Credit Card</h1><div class="account-number">5123 45** **** 9876</div><h2>All Transaction History</h2>');
check('account: label and last digits from a heading and a masked number', a1?.label === 'Maybank Shopee Visa Platinum Credit Card' && a1?.digits === '9876', JSON.stringify(a1));
const a2 = await detect('<select><option>Savings Account-i</option><option>Current Account</option></select><span class="account-no">1234567890</span>');
check('account: selected option of an account drop-down', a2?.label === 'Savings Account-i' && a2?.digits === '7890', JSON.stringify(a2));
const tagged = await detect('<h4><label>Account</label><select><optgroup><option disabled value=""></option></optgroup><optgroup><option selected value="11 2222222 333-SA-false" data-account-no="70 1234567 8" data-label="BASIC SA">11 2222222 333-SA-false</option></optgroup></select></h4>');
check('account: CIMB-style tagged option (data-label / data-account-no) wins over the internal option text', tagged?.label === 'BASIC SA' && tagged?.digits === '5678', JSON.stringify(tagged));
const a3 = await detect('<h2>All Transaction History</h2><nav><a>Home</a></nav>');
check('account: page-furniture headings are not mistaken for an account', a3 === null, JSON.stringify(a3));
const a4 = await detect('<h1>Statement</h1><h2>Recent transactions</h2>');
check('account: nothing detected is null, never a guess', a4 === null, JSON.stringify(a4));

await browser.close();
finish();
