// The side panel end to end in a headless browser: stubbed extension APIs and a fake Wallet (see helpers.mjs).
import { check, finish, launch, serve, wait, baseEnv, newPanel, rows, text, visible, store, log } from './helpers.mjs';

const server = serve();
const browser = await launch();
const open = async (patch = {}, file) => {
  const env = { ...baseEnv(), ...patch };
  return { env, page: await newPanel(browser, server, env, file) };
};
const settle = (ms = 700) => wait(ms);

// ---------------------------------------------------------------- reading, account picker, balance, badge
{
  const { page } = await open();
  await settle();
  const r = await rows(page);
  check('auto-read on open shows the transaction as a new row', r.length === 1 && r[0].amount === '-RM 10.00' && r[0].chips.length === 0, JSON.stringify(r));
  check('account picker lists the active Wallet accounts', await page.evaluate(() => [...document.querySelectorAll('#accountSelect option')].map((o) => o.textContent).join('|')) === 'Savings|Credit card');
  check('balance shown for the selected account', (await text(page, '#balance')).includes('1,234.50'));
  check('badge shows the number of new transactions', (await log(page, 'badge')).at(-1) === '1');
  check('Add is enabled with a row selected', await page.evaluate(() => !document.getElementById('sync').disabled));
  await page.close();
}

// ---------------------------------------------------------------- account mapping per bank account
{
  const bank = { label: 'Maybank Shopee Visa Platinum Credit Card', digits: '9876' };
  const { page, env } = await open({ bank });
  await settle();
  check('detected bank account is shown', (await text(page, '#bank')).includes('9876'));
  check('unmapped bank account falls back to the default Wallet account', await page.evaluate(() => document.getElementById('accountSelect').value) === 'a1');
  await page.select('#accountSelect', 'a2'); await settle();
  check('choosing an account saves the mapping for that bank account', (await store(page)).accountMap?.['d:9876'] === 'a2', JSON.stringify((await store(page)).accountMap));
  check('the default account is left alone', (await store(page)).accountId === 'a1');
  check('balance follows the chosen account', (await text(page, '#balance')).includes('500.00'));
  await page.close();
  // reopening: the mapping is used
  const second = await newPanel(browser, server, { ...env, settings: { ...env.settings, accountMap: { 'd:9876': 'a2' } } });
  await settle();
  check('a mapped bank account selects its Wallet account on open', await second.evaluate(() => document.getElementById('accountSelect').value) === 'a2');
  await second.close();
  // a different bank account is not affected by that mapping
  const other = await newPanel(browser, server, { ...env, bank: { label: 'Savings Account-i', digits: '1111' }, settings: { ...env.settings, accountMap: { 'd:9876': 'a2' } } });
  await settle();
  check('another bank account still uses the default', await other.evaluate(() => document.getElementById('accountSelect').value) === 'a1');
  await other.close();
}
{
  const { page } = await open({ settings: { token: 't', accountId: '', accountName: '' } });
  await settle();
  check('with no account chosen the panel asks, and will not add', (await text(page, '#status')).includes('Choose') && await page.evaluate(() => document.getElementById('sync').disabled));
  await page.close();
}

// ---------------------------------------------------------------- auto-read setting
{
  const { page } = await open({ settings: { token: 't', accountId: 'a1', autoRead: false } });
  await settle();
  check('auto-read off: nothing is read on open', (await log(page, 'scans')) === 0 && !(await visible(page, '#results')));
  await page.evaluate(() => window.__fire('message', { type: 'b2w-page-changed' })); await settle();
  check('auto-read off: page changes are ignored', (await log(page, 'scans')) === 0);
  await page.click('#read'); await settle();
  check('auto-read off: the Read button still works', (await log(page, 'scans')) === 1 && (await rows(page)).length === 1);
  await page.evaluate(() => { window.__t.env.rows = [{ date: '2026-10-05', desc: 'NEW PAGE ROW', amount: -3 }]; chrome.storage.local.set({ autoRead: true }); }); await settle();
  check('turning auto-read on in Settings takes effect immediately', (await rows(page))[0]?.desc === 'NEW PAGE ROW');
  await page.close();
}

// ---------------------------------------------------------------- Wallet refresh and sync notice
{
  const { page } = await open({ records: [{ id: 'r1', accountId: 'a1', recordDate: '2026-10-01T04:00:00Z', amount: { value: -10 }, recordType: 'expense', note: 'TESCO EXTRA CHERAS' }], headers: { 'X-Sync-In-Progress': 'true' } });
  await settle();
  check('a matching Wallet record shows as In Wallet', (await rows(page))[0].chips[0] === 'In Wallet');
  check('sync-in-progress is explained', (await text(page, '#coverage')).includes('still syncing'));
  await page.evaluate(() => { window.__t.env.records = []; window.__fire('activated', {}); }); await settle();
  check('returning to the tab re-checks Wallet (a deleted record disappears)', (await rows(page))[0].chips.length === 0);
  await page.close();
}

// ---------------------------------------------------------------- categories: rule, memory, guess, manual
{
  const { page } = await open({
    rows: [
      { date: '2026-10-01', desc: 'STARBUCKS MID VALLEY', amount: -5 },
      { date: '2026-10-02', desc: 'AMAZON MKTPL*5998T9QM0 Amzn.com/billUS', amount: -60 },
      { date: '2026-10-03', desc: 'GKS*GATHER CAFE KUCHING', amount: -30 },
      { date: '2026-10-04', desc: 'MYSTERY MERCHANT LTD', amount: -9 },
    ],
    rules: [{ keywords: ['starbucks'], category: { id: 'c-food', name: 'Food & Drinks' } }],
    records: [{ id: 'h1', accountId: 'a2', recordDate: '2026-08-01T04:00:00Z', amount: { value: -20 }, recordType: 'expense', note: 'AMAZON MKTPL*77AB12 Amzn.com/billUS', category: { id: 'c-shop', name: 'Shopping' } }],
    settings: { token: 't', accountId: 'a1', categoryMemory: { 'gks gather': { id: 'c-food', name: 'Food & Drinks' } } },
  });
  await settle(900);
  const lines = (await rows(page)).map((r) => r.lines.join(' '));
  check('category: Wallet rule', lines[0].includes('Food & Drinks') && !lines[0].includes('('), lines[0]);
  check('category: guessed from similar past records', lines[1].includes('Shopping') && lines[1].includes('similar past records'), lines[1]);
  check('category: remembered choice', lines[2].includes('Food & Drinks') && lines[2].includes('remembered'), lines[2]);
  check('category: nothing known stays uncategorised', lines[3].includes('none'), lines[3]);
  // change the last row's category by hand; it is remembered per merchant
  await page.evaluate(() => document.querySelectorAll('#list li')[3].querySelector('.match.cat button').click());
  await page.select('#list li:nth-child(4) select', 'c-shop'); await settle(300);
  const after = (await rows(page))[3].lines.join(' ');
  check('category: picking one by hand is shown as your choice', after.includes('Shopping') && after.includes('your choice'), after);
  check('category: the choice is remembered for the merchant', (await store(page)).categoryMemory?.['mystery merchant']?.id === 'c-shop', JSON.stringify((await store(page)).categoryMemory));
  await page.click('#preview');
  const payload = JSON.parse(await text(page, '#payload'));
  check('category: the payload carries the chosen categoryId', payload[3].categoryId === 'c-shop' && payload[0].categoryId === 'c-food', JSON.stringify(payload.map((p) => p.categoryId)));
  await page.close();
}

// ---------------------------------------------------------------- transfers, add, undo
{
  const { page } = await open({
    rows: [{ date: '2026-10-10', desc: 'SPAYLATER REPAYMENT-EC SPKUALA LUMPUR MY', amount: -3131.27 }, { date: '2026-10-09', desc: 'BOOST JUICE AEON', amount: -19.5 }],
    settings: { token: 't', accountId: 'a1', transferRules: [{ keyword: 'repayment', accountId: 'a2' }] },
  });
  await settle();
  const r = await rows(page);
  check('transfer: a matching rule marks the row as a transfer', r[0].chips.includes('Transfer') && r[0].lines.join(' ').includes('Credit card'), JSON.stringify(r[0]));
  check('transfer: other rows are ordinary', !r[1].chips.includes('Transfer'));
  await page.click('#preview');
  const payload = JSON.parse(await text(page, '#payload'));
  check('transfer: payload has the paired-transfer block and a negative amount', payload[0].transfer?.accountId === 'a2' && payload[0].transfer.pairingMode === 'new' && payload[0].amount.value === -3131.27);
  await page.click('#sync'); await settle();
  const created = await log(page, 'created');
  check('add: both rows are created in one request batch', created.length === 2);
  check('add: Undo appears', await visible(page, '#undo'));
  check('add: last add is saved for later (with the mirror record)', JSON.stringify((await store(page)).lastAdd?.groups) === JSON.stringify([['new-1', 'mirror-1'], ['new-2']]), JSON.stringify((await store(page)).lastAdd));
  await page.evaluate(() => { window.__t.env.records = []; });
  await page.click('#undo'); await settle();
  const deleted = await log(page, 'deleted');
  check('undo: deletes exactly what was added, a transfer together with its mirror', deleted.length === 1 && JSON.stringify(deleted[0]) === JSON.stringify(['new-1', 'mirror-1', 'new-2']), JSON.stringify(deleted));
  check('undo: button disappears and the saved add is cleared', !(await visible(page, '#undo')) && (await store(page)).lastAdd === null);
  check('undo: the rows are new again afterwards', (await rows(page)).every((x) => !x.chips.includes('In Wallet')));
  await page.close();
}
{
  // an add made earlier (a previous session) can still be undone within the window; an old one cannot
  const fresh = { groups: [['old-1']], at: Date.now() - 60e3 };
  const stale = { groups: [['old-2']], at: Date.now() - 20 * 60e3 };
  const a = await open({ settings: { token: 't', accountId: 'a1', lastAdd: fresh } });
  await settle();
  check('undo: an add from a minute ago is still undoable after reopening', await visible(a.page, '#undo'));
  await a.page.close();
  const b = await open({ settings: { token: 't', accountId: 'a1', lastAdd: stale } });
  await settle();
  check('undo: an add older than 15 minutes is not offered (and is dropped)', !(await visible(b.page, '#undo')) && (await store(b.page)).lastAdd === null);
  await b.page.close();
}

// ---------------------------------------------------------------- opposite type, ignore, flip
{
  const { page } = await open({
    rows: [{ date: '2026-10-09', desc: 'XCORE FITNESS-E24 :009/024', amount: -249.96 }],
    records: [{ id: 'r9', accountId: 'a1', recordDate: '2026-10-09T04:00:00Z', amount: { value: 249.96 }, recordType: 'income', note: 'XCORE FITNESS-E24 :009/024' }],
  });
  await settle();
  const r = (await rows(page))[0];
  check('type mismatch: an income record for an expense row is flagged, not "In Wallet"', r.chips[0] === 'Type differs' && !r.chips.includes('In Wallet'), JSON.stringify(r));
  check('type mismatch: no Replace button (it would not fix the sign)', !(await page.evaluate(() => [...document.querySelectorAll('#list button')].some((b) => b.textContent === 'Replace'))));
  await page.close();
}
{
  const { page } = await open({ rows: [{ date: '2026-10-01', desc: 'INTERNAL MOVE A', amount: -10 }, { date: '2026-10-02', desc: 'KEEP ME', amount: -20 }] });
  await settle();
  await page.evaluate(() => [...document.querySelectorAll('#list li')[0].querySelectorAll('button')].find((b) => b.textContent === 'Ignore').click()); await settle();
  let r = await rows(page);
  check('ignore: the row is greyed out, unticked and labelled', r[0].cls.includes('ignored') && r[0].chips.includes('Ignored') && !r[0].checked);
  check('ignore: it is remembered in storage', (await store(page)).ignored?.length === 1);
  check('ignore: it no longer counts as selected', (await text(page, '#count')) === '1 selected');
  await page.evaluate(() => { window.__t.env.rows = [...window.__t.env.rows]; window.__fire('activated', {}); }); await settle();
  r = await rows(page);
  check('ignore: it survives a re-read', r[0].cls.includes('ignored'));
  await page.evaluate(() => [...document.querySelectorAll('#list li')[0].querySelectorAll('button')].find((b) => b.textContent === 'Restore').click()); await settle();
  r = await rows(page);
  check('ignore: Restore brings the row back', !r[0].cls.includes('ignored') && (await store(page)).ignored.length === 0);
  await page.close();
}

// ---------------------------------------------------------------- choices survive a refresh; collecting pages
{
  const { page } = await open({ rows: [{ date: '2026-10-01', desc: 'ROW ONE', amount: -10 }, { date: '2026-10-02', desc: 'ROW TWO', amount: -20 }] });
  await settle();
  await page.evaluate(() => document.querySelectorAll('#list li')[0].querySelector('input').click());
  await page.evaluate(() => window.__fire('activated', {})); await settle();
  check('a refresh keeps the rows you unticked', (await rows(page))[0].checked === false && (await rows(page))[1].checked === true);
  await page.close();
}
{
  const { page } = await open({ settings: { token: 't', accountId: 'a1', collectPages: true }, rows: [{ date: '2026-10-01', desc: 'PAGE ONE ROW', amount: -10 }] });
  await settle();
  check('collect: clear button is offered', await visible(page, '#clear'));
  await page.evaluate(() => { window.__t.env.rows = [{ date: '2026-09-28', desc: 'PAGE TWO ROW', amount: -20 }]; window.__fire('message', { type: 'b2w-page-changed' }); }); await settle();
  check('collect: rows from earlier pages are kept', (await rows(page)).map((r) => r.desc).join('|') === 'PAGE TWO ROW|PAGE ONE ROW', JSON.stringify((await rows(page)).map((r) => r.desc)));
  await page.click('#sync'); await settle();
  check('collect: one Add sends rows from every page', (await log(page, 'created')).length === 2);
  await page.click('#clear'); await settle();
  check('collect: Clear list empties it', !(await visible(page, '#results')));
  await page.close();
}

// ---------------------------------------------------------------- demo mode writes nothing
{
  const { page } = await open({ tabUrl: 'https://example.com/', settings: { token: '', accountId: '' } });
  await page.click('#demo'); await settle();
  const r = await rows(page);
  check('demo: shows rows, a transfer, an opposite-type warning and a guessed category', r.length >= 12 && r.some((x) => x.chips.includes('Transfer')) && r.some((x) => x.chips.includes('Type differs')) && r.some((x) => x.lines.join(' ').includes('similar past records')));
  await page.evaluate(() => [...document.querySelectorAll('#list li')].find((li) => li.querySelector('.desc').textContent.startsWith('NETFLIX')).querySelector('.acts button:last-child').click()); await settle();
  await page.click('#sync'); await settle();
  check('demo: Add pretends and Undo is offered', (await text(page, '#status')).startsWith('Demo: pretended') && await visible(page, '#undo'));
  await page.click('#undo'); await settle();
  check('demo: Undo pretends too', (await text(page, '#status')).startsWith('Demo: pretended to undo'));
  const s = await store(page);
  check('demo: nothing was sent to Wallet or saved', (await log(page, 'created')).length === 0 && (await log(page, 'deleted')).length === 0 && !s.ignored?.length && s.lastAdd == null && !Object.keys(s.categoryMemory || {}).length);
  await page.close();
}

// ---------------------------------------------------------------- leaving demo mode
{
  const accountsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#accountSelect option')].map((o) => o.textContent).join('|'));
  const { page } = await open();
  await settle();
  check('before demo: the real accounts are listed', await accountsOf(page) === 'Savings|Credit card');
  await page.click('#demo'); await settle();
  check('demo: fake accounts, a demo banner, and the button offers to exit', (await accountsOf(page)).includes('Maybank Visa Platinum') && await visible(page, '#demoBar') && await text(page, '#demo') === 'Exit demo');
  await page.click('#exitDemo'); await settle(900);
  check('exit demo: the real accounts and balance are back', await accountsOf(page) === 'Savings|Credit card' && (await text(page, '#balance')).includes('1,234.50'));
  check('exit demo: banner gone, button reads "Demo data" again', !(await visible(page, '#demoBar')) && await text(page, '#demo') === 'Demo data');
  check('exit demo: the real page is read again', (await rows(page)).map((r) => r.desc).join('|') === 'TESCO EXTRA CHERAS');
  // the Demo button itself toggles, and Read also leaves demo
  await page.click('#demo'); await settle();
  await page.click('#demo'); await settle(900);
  check('the Demo button toggles back to real use', await accountsOf(page) === 'Savings|Credit card' && !(await visible(page, '#demoBar')));
  await page.click('#demo'); await settle();
  await page.click('#read'); await settle(900);
  check('pressing Read in demo leaves demo and reads the real page', await accountsOf(page) === 'Savings|Credit card' && !(await visible(page, '#demoBar')) && (await rows(page))[0]?.desc === 'TESCO EXTRA CHERAS');
  await page.close();
}
{
  // no token yet: leaving demo returns to the "set up Settings" state rather than leaving fake accounts behind
  const { page } = await open({ tabUrl: 'https://example.com/', settings: { token: '', accountId: '' } });
  await page.click('#demo'); await settle();
  await page.click('#exitDemo'); await settle();
  check('exit demo without a token: back to the setup prompt, no fake accounts', (await text(page, '#status')).includes('Settings') && !(await visible(page, '#accountSelect')) && !(await visible(page, '#results')));
  await page.close();
}

await browser.close();
server.close();
finish();
