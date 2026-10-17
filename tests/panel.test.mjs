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
  check('transfer: the amount has its own colour', await page.evaluate(() => {
    const [t, o] = [...document.querySelectorAll('#list .amt')];
    return t.classList.contains('xfer') && o.classList.contains('neg') && getComputedStyle(t).color !== getComputedStyle(o).color;
  }));
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
  check('type mismatch: no Replace button (it would not fix the sign)', !(await page.evaluate(() => [...document.querySelectorAll('#list button')].some((b) => b.textContent.startsWith('Replace')))));
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

// ---------------------------------------------------------------- optional bank access (panel allowed on any site)
{
  const { page } = await open({ tabUrl: 'https://www.cimbclicks.com.my/clicks/#/history', noAccess: ['https://*.cimbclicks.com.my/*'], rows: [{ date: '2026-10-07', desc: 'ROW ONE', amount: -10 }] });
  await settle();
  check('panel on CIMB without access: asks to allow it and reads nothing', (await visible(page, '#access')) && (await text(page, '#allowBank')) === 'Allow CIMB Clicks' && (await log(page, 'scans')) === 0);
  await page.click('#allowBank'); await settle();
  check('...Allow grants it and reads the page', !(await visible(page, '#access')) && (await rows(page)).length === 1);
  await page.close();
}

// ---------------------------------------------------------------- infinite scroll (CIMB loads more rows into the same table)
{
  const { page } = await open({ tabUrl: 'https://www.cimbclicks.com.my/clicks/#/history', rows: [{ date: '2026-10-07', desc: 'ROW ONE', amount: -10 }, { date: '2026-10-05', desc: 'ROW TWO', amount: -20 }] });
  await settle();
  check('CIMB Clicks pages are read', (await rows(page)).length === 2);
  await page.evaluate(() => document.querySelectorAll('#list li')[0].querySelector('input').click());
  await page.evaluate(() => {
    window.__t.env.rows = [...window.__t.env.rows, { date: '2026-09-30', desc: 'LOADED ON SCROLL', amount: -30 }];
    window.__fire('message', { type: 'b2w-page-changed' });
  });
  await settle();
  const r = await rows(page);
  check('scrolling loads more: the new rows join the list', r.map((x) => x.desc).join('|') === 'ROW ONE|ROW TWO|LOADED ON SCROLL', JSON.stringify(r.map((x) => x.desc)));
  check('scrolling loads more: what you unticked stays unticked', r[0].checked === false && r[2].checked === true);
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

// ---------------------------------------------------------------- Wallet record dated before the bank posted it
{
  const rec = (id, recordDate, amount, note) => ({ id, accountId: 'a1', recordDate, amount: { value: amount }, recordType: 'expense', note });
  const { page } = await open({
    rows: [{ date: '2026-10-08', desc: 'BOOST JUICE AEON KUCHING MY', amount: -19.5 }, { date: '2026-10-09', desc: 'GRAB RIDE', amount: -12 }],
    records: [rec('e1', '2026-10-07T05:30:00.000Z', -19.5, 'Juice'), rec('e2', '2026-10-07T01:00:00.000Z', -12, 'GRAB RIDE')],
  });
  await settle();
  const r = await rows(page);
  check('earlier date: shown as likely and unticked, not as new', r[0].chips[0] === 'Likely in Wallet' && !r[0].checked, JSON.stringify(r[0]));
  check('earlier date: says when Wallet has it and its note', r[0].lines[0] === 'Wallet has this a day earlier, on 7 Oct: "Juice"', JSON.stringify(r[0].lines));
  check('earlier date: two days earlier is worded as such', r[1].lines[0].startsWith('Wallet has this 2 days earlier, on 7 Oct'), JSON.stringify(r[1].lines));
  const buttons = await page.evaluate(() => [...document.querySelectorAll('#list li')[0].querySelectorAll('button')].map((b) => b.textContent));
  check('earlier date: offers "Use bank date" (note actions come after lining it up)', JSON.stringify(buttons) === JSON.stringify(['Use bank date']), JSON.stringify(buttons));
  check('nearby date: the Wallet fetch covers 3 days either side of the bank dates', (await log(page, 'fetches')).some((f) => f.includes('recordDate=gte.2026-10-04T16%3A00%3A00.000Z') && f.includes('recordDate=lte.2026-10-12T15%3A59%3A59.000Z')), JSON.stringify((await log(page, 'fetches')).filter((f) => f.includes('/records?'))));
  check('earlier date: the coverage line counts only the bank\'s dates', (await text(page, '#coverage')).startsWith('Wallet has no records for 8 Oct – 9 Oct'), await text(page, '#coverage'));
  check('earlier date: bulk button for several', (await text(page, '#moveAll')) === 'Use 2 bank dates');
  await page.evaluate(() => document.querySelectorAll('#list li')[0].querySelector('button').click()); await settle(400);
  check('earlier date: moves the record by the lag, keeping its time of day', JSON.stringify((await log(page, 'patched'))[0]) === JSON.stringify([{ id: 'e1', recordDate: '2026-10-08T05:30:00.000Z' }]), JSON.stringify(await log(page, 'patched')));
  const after = (await rows(page))[0];
  check('earlier date: afterwards a different description offers Merge / Replace', after.chips[0] === 'Likely in Wallet' && after.lines[0] === 'Wallet note: "Juice"', JSON.stringify(after));
  await page.click('#moveAll').catch(() => {}); // only one left, so the bulk button is hidden
  await page.evaluate(() => document.querySelectorAll('#list li')[1].querySelector('button').click()); await settle(400);
  check('earlier date: with the same description it is then In Wallet', (await rows(page))[1].chips[0] === 'In Wallet');
  await page.close();
}

// ---------------------------------------------------------------- balance check and adjustment
{
  const { page } = await open({ bankBalance: { label: "Current Balance", amount: 1000 } });
  await settle();
  check("balance check: shows the bank balance and the difference", (await text(page, "#reconcileText")).replace(/ /g, " ") === "Bank current balance: RM 1,000.00 · Wallet is RM 234.50 higher", await text(page, "#reconcileText"));
  check("balance check: offers Adjust", await visible(page, "#adjust"));
  await page.click("#adjust");
  const ask = await text(page, "#adjustText");
  check("adjust: asks first, with the amount and a warning about rows not yet added", ask.startsWith("Add a -RM 234.50 balance adjustment to Savings") && ask.includes("1 new transaction on this page isn't in Wallet yet"), ask);
  check("adjust: nothing is written before confirming", (await log(page, "created")).length === 0);
  await page.evaluate(() => { window.__t.env.accounts = window.__t.env.accounts.map((a) => (a.id === "a1" ? { ...a, balance: { ...a.balance, currentBalance: 1000 } } : a)); });
  await page.click("#adjustYes"); await settle();
  const [made] = await log(page, "created");
  check("adjust: one record for the difference, reconciled, with a clear note", made?.amount.value === -234.5 && made.recordState === "reconciled" && made.note.startsWith("Balance adjustment to match the bank's current balance") && made.accountId === "a1", JSON.stringify(made));
  check("adjust: it can be undone like any add", await visible(page, "#undo") && JSON.stringify((await store(page)).lastAdd?.groups) === JSON.stringify([["new-1"]]));
  check("adjust: afterwards the balances match", (await text(page, "#reconcileText")).endsWith("matches Wallet ✓") && !(await visible(page, "#adjust")), await text(page, "#reconcileText"));
  await page.close();
}
{
  const env = { ...baseEnv(), bankBalance: { label: "Outstanding Balance", amount: 500 }, bank: { label: "Card", digits: "1111" } };
  env.accounts = env.accounts.map((a) => (a.id === "a2" ? { ...a, accountType: "CreditCard" } : a));
  env.settings = { ...env.settings, accountMap: { "d:1111": "a2" } };
  const page = await newPanel(browser, server, env);
  await settle();
  check("balance check: a card's outstanding balance is owed, so it matches Wallet's negative balance", (await text(page, "#reconcileText")).replace(/ /g, " ") === "Bank outstanding balance: RM 500.00 owed · matches Wallet ✓", await text(page, "#reconcileText"));
  await page.close();
}
{
  const { page } = await open({});
  await settle();
  check("balance check: hidden when the page shows no balance", !(await visible(page, "#reconcile")));
  await page.close();
}

// ---------------------------------------------------------------- automated Wallet record dated after the bank
{
  const { page } = await open({
    rows: [{ date: "2026-10-05", desc: "TR IBG · PayNet Direct Debit · EXAMPLE ASSET MGMT", amount: -300 }],
    records: [{ id: "s1", accountId: "a1", recordDate: "2026-10-07T01:00:00.000Z", amount: { value: -300 }, recordType: "expense", note: "Monthly investment" }],
  });
  await settle();
  const r = (await rows(page))[0];
  check("later date: an automated record 2 days after the bank is offered, not treated as new", r.chips[0] === "Likely in Wallet" && !r.checked, JSON.stringify(r));
  check("later date: worded as later", r.lines[0] === "Wallet has this 2 days later, on 7 Oct: \"Monthly investment\"", JSON.stringify(r.lines));
  await page.evaluate(() => document.querySelector("#list li button").click()); await settle(400);
  check("later date: Use bank date moves it back to the bank's day, same time", JSON.stringify((await log(page, "patched"))[0]) === JSON.stringify([{ id: "s1", recordDate: "2026-10-05T01:00:00.000Z" }]), JSON.stringify(await log(page, "patched")));
  await page.close();
}

// ---------------------------------------------------------------- merging notes
{
  const rec = (id, date, amount, note) => ({ id, accountId: 'a1', recordDate: `${date}T04:00:00Z`, amount: { value: amount }, recordType: 'expense', note });
  const { page } = await open({
    rows: [
      { date: '2026-10-02', desc: 'MCDONALDS PAVILION KL', amount: -23.9 },
      { date: '2026-10-04', desc: 'TNG', amount: -50 },
      { date: '2026-10-05', desc: 'SHELL SETIA ALAM', amount: -80 },
    ],
    records: [rec('m1', '2026-10-02', -23.9, 'Lunch'), rec('m2', '2026-10-04', -50, 'Parking'), rec('m3', '2026-10-05', -80, 'Fuel')],
  });
  await settle();
  const buttonsOf = (i) => page.evaluate((n) => [...document.querySelectorAll('#list li')[n].querySelectorAll('button')].map((b) => b.textContent), i);
  check('merge: likely rows offer Merge notes next to Replace note', JSON.stringify(await buttonsOf(0)) === JSON.stringify(['Merge notes', 'Replace note']), JSON.stringify(await buttonsOf(0)));
  check('merge: the row says what the Wallet note is', (await rows(page))[0].lines[0] === 'Wallet note: "Lunch"', JSON.stringify((await rows(page))[0].lines));
  check('merge: hovering shows the note you will get', await page.evaluate(() => [...document.querySelectorAll('#list li')[0].querySelectorAll('button')].map((b) => b.title).join('|')) === 'Wallet note becomes: "Lunch · MCDONALDS PAVILION KL". Amount, payer, category and labels are kept.|Wallet note becomes: "MCDONALDS PAVILION KL". Amount, payer, category and labels are kept.');
  check('merge: the bulk buttons count notes', (await text(page, '#mergeAll')) === 'Merge 3 notes' && (await text(page, '#replaceAll')) === 'Replace 3 notes');
  await page.evaluate(() => document.querySelectorAll('#list li')[0].querySelector('button').click()); await settle(400);
  check('merge: keeps your note and adds the description', JSON.stringify((await log(page, 'patched'))[0]) === JSON.stringify([{ id: 'm1', note: 'Lunch · MCDONALDS PAVILION KL' }]), JSON.stringify(await log(page, 'patched')));
  check('merge: the row is then In Wallet', (await rows(page))[0].chips[0] === 'In Wallet');
  await page.click('#mergeAll'); await settle(400);
  check('merge: the bulk button merges the rest in one request', JSON.stringify((await log(page, 'patched'))[1]) === JSON.stringify([{ id: 'm2', note: 'Parking · TNG' }, { id: 'm3', note: 'Fuel · SHELL SETIA ALAM' }]), JSON.stringify((await log(page, 'patched'))[1]));
  // after Wallet syncs, a re-read sees the merged notes as matches, even the short "TNG"
  await page.evaluate(() => {
    window.__t.env.records = window.__t.env.records.map((r) => ({ ...r, note: { m1: 'Lunch · MCDONALDS PAVILION KL', m2: 'Parking · TNG', m3: 'Fuel · SHELL SETIA ALAM' }[r.id] }));
    window.__fire('activated', {});
  });
  await settle();
  check('merge: merged notes count as In Wallet on the next read', (await rows(page)).every((r) => r.chips[0] === 'In Wallet'), JSON.stringify((await rows(page)).map((r) => r.chips)));
  await page.close();
}

// ---------------------------------------------------------------- fixing a wrong type; notes with extra details
{
  const wrong = (id, date, amount, note, extra = {}) => ({ id, accountId: 'a1', recordDate: `${date}T04:00:00Z`, amount: { value: amount }, recordType: amount < 0 ? 'expense' : 'income', note, ...extra });
  const { page } = await open({
    rows: [
      { date: '2026-10-09', desc: 'XCORE FITNESS-E24 :009/024', amount: -249.96 },
      { date: '2026-10-08', desc: 'TRIP.COM INTERNET HK', amount: -301.41 },
      { date: '2026-10-07', desc: 'CARD REPAYMENT', amount: -500 },
      { date: '2026-10-06', desc: 'GKS*GATHER CAFE SDN. KUCHING MY', amount: -98.05 },
    ],
    records: [
      wrong('r9', '2026-10-09', 249.96, 'XCORE FITNESS-E24 :009/024'), // expense saved as income, same description
      wrong('r8', '2026-10-08', 301.41, 'Holiday flights'),             // expense saved as income, different description
      wrong('r7', '2026-10-07', 500, 'CARD REPAYMENT', { transfer: { pairing: 'paired' } }), // a transfer: not fixable here
      wrong('r6', '2026-10-06', -98.05, 'Team lunch: GKS*GATHER CAFE SDN. KUCHING MY (paid for Ali)'), // note adds details
    ],
  });
  await settle();
  let r = await rows(page);
  check('notes with extra details still count as In Wallet', r[3].chips[0] === 'In Wallet', JSON.stringify(r[3]));
  const fixButtons = await page.evaluate(() => [...document.querySelectorAll('#list li')].map((li) => [...li.querySelectorAll('button')].some((b) => b.textContent === 'Fix in Wallet')));
  check('fix: offered on wrong-type rows, not on a transfer', JSON.stringify(fixButtons.slice(0, 3)) === JSON.stringify([true, true, false]), JSON.stringify(fixButtons));
  check('fix: the transfer explains it must be fixed in Wallet', r[2].lines.join(' ').includes("It's a transfer in Wallet"));
  check('fix: the bulk button appears for several', await visible(page, '#fixAll') && (await text(page, '#fixAll')) === 'Fix 2 types');
  await page.evaluate(() => [...document.querySelectorAll('#list li')[0].querySelectorAll('button')].find((b) => b.textContent === 'Fix in Wallet').click());
  await settle();
  const patched = await log(page, 'patched');
  check('fix: sends only the amount, with the bank sign', JSON.stringify(patched[0]) === JSON.stringify([{ id: 'r9', amount: { value: -249.96 } }]), JSON.stringify(patched));
  r = await rows(page);
  check('fix: the row is then In Wallet', r[0].chips[0] === 'In Wallet', JSON.stringify(r[0]));
  check('fix: a single remaining wrong type hides the bulk button', !(await visible(page, '#fixAll')));
  await page.evaluate(() => [...document.querySelectorAll('#list li')[1].querySelectorAll('button')].find((b) => b.textContent === 'Fix in Wallet').click());
  await settle();
  r = await rows(page);
  check('fix: with a different description it becomes Likely, so Replace is offered', r[1].chips[0] === 'Likely in Wallet' && await page.evaluate(() => [...document.querySelectorAll('#list li')[1].querySelectorAll('button')].some((b) => b.textContent === 'Replace note')), JSON.stringify(r[1]));
  check('fix: the balance is refreshed after a sign change', (await log(page, 'fetches')).filter((f) => f.startsWith('GET /accounts')).length >= 2);
  await page.close();
}

// ---------------------------------------------------------------- busy state: progress, spinner, lock, one request
{
  const { page } = await open({
    delay: 600, // the fake Wallet takes 0.6 s per write
    rows: [{ date: '2026-10-01', desc: 'TESCO EXTRA CHERAS', amount: -10 }, { date: '2026-10-02', desc: 'NEW ONE', amount: -5 }],
    records: [{ id: 'r1', accountId: 'a1', recordDate: '2026-10-01T04:00:00Z', amount: { value: -10 }, recordType: 'expense', note: 'Lunch' }],
  });
  await settle();
  const state = () => page.evaluate(() => ({
    bar: !document.getElementById('progress').hidden,
    locked: document.getElementById('app').inert,
    pending: [...document.querySelectorAll('button.pending')].map((b) => b.textContent),
  }));
  check('busy: idle panel has no progress bar and nothing locked', JSON.stringify(await state()) === JSON.stringify({ bar: false, locked: false, pending: [] }));

  await page.evaluate(() => { const b = [...document.querySelectorAll('#list button')].find((x) => x.textContent === 'Replace note'); b.click(); b.click(); });
  await wait(150);
  let s = await state();
  check('replace: progress bar, "Replacing…" with a spinner, panel locked', s.bar && s.locked && s.pending[0] === 'Replacing…', JSON.stringify(s));
  await page.click('#sync').catch(() => {});
  await wait(800);
  check('replace: a double click sends one request, and Add was not pressable meanwhile', (await log(page, 'patched')).length === 1 && (await log(page, 'created')).length === 0);
  s = await state();
  check('replace: afterwards the bar is gone and the panel unlocked', !s.bar && !s.locked && !s.pending.length, JSON.stringify(s));

  await page.click('#sync'); await wait(150);
  s = await state();
  check('add: "Adding…" with the panel locked', s.pending[0] === 'Adding…' && s.locked, JSON.stringify(s));
  await wait(800);
  check('add: afterwards the Add label is back and Undo is offered', !(await state()).locked && (await text(page, '#sync')).startsWith('Add') && await visible(page, '#undo'));

  await page.click('#undo'); await wait(150);
  check('undo: "Undoing…" while it runs', (await state()).pending[0] === 'Undoing…');
  await wait(1400);
  s = await state();
  check('undo: finishes and unlocks', !s.locked && !s.bar && (await log(page, 'deleted')).length === 1, JSON.stringify(s));
  await page.close();
}
{
  const { page } = await open({ delay: 600, rows: [{ date: '2026-10-02', desc: 'NEW ONE', amount: -5 }] });
  await settle();
  await page.click('#sync'); await wait(100);
  await page.evaluate(() => { window.__t.env.rows = [{ date: '2026-10-03', desc: 'ARRIVED DURING ADD', amount: -7 }]; window.__fire('message', { type: 'b2w-page-changed' }); });
  await wait(1500);
  check('busy: a page change during an add is read once the add finishes (not dropped)', (await rows(page)).some((r) => r.desc === 'ARRIVED DURING ADD'));
  // an automatic refresh shows the bar but never locks the panel
  const during = await page.evaluate(async () => {
    window.__fire('message', { type: 'b2w-page-changed' });
    await new Promise((r) => setTimeout(r, 120)); // past the 100 ms debounce, while the read runs
    return { locked: document.getElementById('app').inert };
  });
  check('busy: automatic refreshes never lock the panel', during.locked === false);
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

// ---------------------------------------------------------------- what's new after an update
{
  // one version: titled with it, no version heading
  const { page } = await open({ version: '0.3.0', settings: { ...baseEnv().settings, whatsNewFrom: '0.2.0' } });
  await settle();
  check('what\'s new: one version is titled "What\'s new in 0.3.0" with its items and no version heading',
    (await visible(page, '#whatsNew')) && (await text(page, '#whatsNew h2')) === "What's new in 0.3.0"
    && await page.evaluate(() => !document.querySelector('#whatsNew h3') && document.querySelectorAll('#whatsNew li').length > 1));
  // several versions, through the same card with a swapped-in changelog
  await page.evaluate(async () => {
    const { showWhatsNew } = await import('./whatsnew.js');
    const box = document.createElement('section'); box.id = 'multi'; document.body.prepend(box);
    showWhatsNew(box, [{ version: '0.3.0', items: ['Three <b>bold</b>.'] }, { version: '0.2.5', items: ['Two and a half.'] }, { version: '0.2.0', items: ['Seen.'] }]);
  });
  await settle(200);
  check("what's new: skipped versions each get a heading, newest first, and only unseen ones",
    (await text(page, '#multi h2')) === "What's new" && await page.evaluate(() => [...document.querySelectorAll('#multi h3')].map((h) => h.textContent).join()) === '0.3.0,0.2.5', await text(page, '#multi'));
  check("what's new: items are text, never HTML", await page.evaluate(() => !document.querySelector('#multi b') && document.querySelector('#multi li').textContent === 'Three <b>bold</b>.'));
  await page.click('#whatsNew .whats-new-actions button'); await settle(200);
  check('what\'s new: "Got it" hides the card, forgets the version and clears the badge',
    !(await visible(page, '#whatsNew')) && !('whatsNewFrom' in (await store(page))) && (await log(page, 'globalBadge')).at(-1) === '');
  await page.close();
}
{
  const { page } = await open({ version: '0.3.0', settings: { ...baseEnv().settings, whatsNewFrom: '0.3.0' } });
  await settle();
  check("what's new: nothing to tell (a quiet release) clears it silently",
    !(await visible(page, '#whatsNew')) && !('whatsNewFrom' in (await store(page))) && (await log(page, 'globalBadge')).at(-1) === '');
  await page.close();
}
{
  const { page } = await open();
  await settle();
  check("what's new: no card without an update", !(await visible(page, '#whatsNew')) && !(await log(page, 'globalBadge')).length);
  await page.evaluate(() => chrome.storage.local.set({ whatsNewFrom: '0.2.0' }));
  await settle(200);
  check("what's new: the card appears while the panel is open (an update, or a preview from the console)", await visible(page, '#whatsNew'));
  await page.close();
}

await browser.close();
server.close();
finish();
