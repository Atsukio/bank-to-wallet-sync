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
};

const browser = await launch();
const page = await browser.newPage();
const scan = async (html) => { await page.setContent(`<body>${html}</body>`); return page.evaluate(`(() => { ${src}; return scanPage().map((t) => (t.unsure ? 'unsure' : t.amount)); })()`); };
for (const [name, [html, want]] of Object.entries(cases)) {
  const got = await scan(html);
  check(`sign: ${name}`, want.every((w, i) => got[i] === w), JSON.stringify(got));
}

// ---- detectAccount
const detect = async (html) => { await page.setContent(`<body>${html}</body>`); return page.evaluate(`(() => { ${src}; return detectAccount(); })()`); };
const a1 = await detect('<h1>Maybank Shopee Visa Platinum Credit Card</h1><div class="account-number">5123 45** **** 9876</div><h2>All Transaction History</h2>');
check('account: label and last digits from a heading and a masked number', a1?.label === 'Maybank Shopee Visa Platinum Credit Card' && a1?.digits === '9876', JSON.stringify(a1));
const a2 = await detect('<select><option>Savings Account-i</option><option>Current Account</option></select><span class="account-no">1234567890</span>');
check('account: selected option of an account drop-down', a2?.label === 'Savings Account-i' && a2?.digits === '7890', JSON.stringify(a2));
const a3 = await detect('<h2>All Transaction History</h2><nav><a>Home</a></nav>');
check('account: page-furniture headings are not mistaken for an account', a3 === null, JSON.stringify(a3));
const a4 = await detect('<h1>Statement</h1><h2>Recent transactions</h2>');
check('account: nothing detected is null, never a guess', a4 === null, JSON.stringify(a4));

await browser.close();
finish();
