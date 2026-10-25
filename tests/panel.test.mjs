// The side panel end to end in a headless browser: stubbed extension APIs and a fake Wallet (see helpers.mjs).
import { check, finish, launch, serve, wait, baseEnv, newPanel, rows, text, visible, store, log } from './helpers.mjs';

const server = serve();
const browser = await launch();
const open = async (patch = {}, file) => {
  const env = { ...baseEnv(), ...patch };
  return { env, page: await newPanel(browser, server, env, file) };
};
const settle = (ms = 700) => wait(ms);
// the balance explanation, one line per part, with non-breaking spaces made plain
const whyLines = (page) => page.evaluate(() => [...document.querySelectorAll("#reconcileWhy > div")].map((d) => d.textContent.replace(/\u00a0/g, " ")).join("\n"));

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

// ---------------------------------------------------------------- the "Reading:" line with a long account name
{
  const { page } = await open({ bank: { label: 'Example Bank Everyday Savings Account-i With A Very Long Product Name 1234 5678 9012', digits: '9012' } });
  await settle();
  const got = await page.evaluate(() => {
    const p = document.getElementById('bank').getBoundingClientRect(), d = document.getElementById('bankDigits').getBoundingClientRect();
    const label = document.getElementById('bankLabel');
    return {
      text: document.getElementById('bank').textContent, title: document.getElementById('bank').title,
      digitsInside: d.width > 0 && d.right <= p.right + 0.5, oneLine: p.height <= 21,
      cut: label.scrollWidth > label.clientWidth && getComputedStyle(label).textOverflow === 'ellipsis',
    };
  });
  check('Reading line: a long name is cut with "…" but the last digits stay visible, on one line', got.cut && got.digitsInside && got.oneLine && got.text.endsWith('••9012'), JSON.stringify(got));
  check('Reading line: the full account number is left out (only the masked last four show), and the tooltip has the whole name', !got.text.includes('5678') && got.title === 'Reading: Example Bank Everyday Savings Account-i With A Very Long Product Name ••9012', JSON.stringify(got));
  await page.close();
}

// ---------------------------------------------------------------- row edits queue up instead of locking the panel
{
  const rec = (id, date, amount, note) => ({ id, accountId: 'a1', recordDate: `${date}T04:00:00Z`, amount: { value: amount }, recordType: 'expense', note });
  const { page } = await open({
    delay: 600,
    rows: [{ date: '2026-10-01', desc: 'FIRST SHOP', amount: -10 }, { date: '2026-10-02', desc: 'SECOND SHOP', amount: -20 }, { date: '2026-10-03', desc: 'THIRD SHOP', amount: -30 }, { date: '2026-10-04', desc: 'BRAND NEW', amount: -5 }],
    records: [rec('q1', '2026-10-01', -10, 'One'), rec('q2', '2026-10-02', -20, 'Two'), rec('q3', '2026-10-03', -30, 'Three')],
  });
  await settle();
  const press = (desc, label) => page.evaluate((d, l) => [...document.querySelectorAll('#list li')].find((li) => li.querySelector('.desc').textContent === d).querySelectorAll('button').forEach((b) => { if (b.textContent === l) b.click(); }), desc, label);
  await press('FIRST SHOP', 'Merge notes');
  await press('SECOND SHOP', 'Replace note');
  await wait(400); // the first request is on its way
  check('queue: while an edit is on its way the panel is not locked', await page.evaluate(() => !document.getElementById('app').inert));
  await press('THIRD SHOP', 'Merge notes');
  await page.click('#sync');
  await wait(100);
  check('queue: Add can be pressed while edits are still running', (await text(page, '#sync')) === 'Adding…', await text(page, '#sync'));
  await wait(2500);
  const patched = await log(page, 'patched');
  check('queue: clicks close together share one request, a later one goes in the next',
    JSON.stringify(patched) === JSON.stringify([[{ id: 'q1', note: 'One · FIRST SHOP' }, { id: 'q2', note: 'SECOND SHOP' }], [{ id: 'q3', note: 'Three · THIRD SHOP' }]]), JSON.stringify(patched));
  check('queue: Add ran alongside and every row ends up done', (await log(page, 'created')).length === 1 && await page.evaluate(() => !document.querySelector('#list li.editing') && document.getElementById('progress').hidden));
  await page.close();
}
{
  const { page } = await open({
    rows: [{ date: '2026-10-01', desc: 'FAILING SHOP', amount: -10 }],
    records: [{ id: 'bad', accountId: 'a1', recordDate: '2026-10-01T04:00:00Z', amount: { value: -10 }, recordType: 'expense', note: 'Mine' }],
  });
  await settle();
  await page.evaluate(() => { window.__t.env.patchFails = true; [...document.querySelectorAll('#list button')].find((b) => b.textContent === 'Replace note').click(); });
  await settle();
  check('queue: a failed edit says why on its row and offers the button again',
    (await text(page, '#list li')).includes("Couldn't update Wallet") && await page.evaluate(() => [...document.querySelectorAll('#list button')].some((b) => b.textContent === 'Replace note' && !b.disabled)) && (await page.evaluate(() => document.getElementById('status').className)) === 'status error');
  await page.close();
}

{
  // an edit clicked while a page read is fetching Wallet: the rebuilt row keeps "working" and gets the result
  const row = { date: '2026-10-01', desc: 'RACE SHOP', amount: -10 };
  const { page } = await open({ delay: 1500, rows: [row], records: [{ id: 'race', accountId: 'a1', recordDate: '2026-10-01T04:00:00Z', amount: { value: -10 }, recordType: 'expense', note: 'Mine' }] });
  await settle();
  await page.evaluate(() => { window.__t.env.readDelay = 700; window.__fire('activated', {}); }); // a forced read starts, Wallet is slow
  await wait(150);
  await page.evaluate(() => [...document.querySelectorAll('#list button')].find((b) => b.textContent === 'Replace note').click());
  await wait(900); // the read has rebuilt the list from records fetched before the edit; the edit is still on its way
  check('race: a row rebuilt by a read while its edit is in flight stays "working", with no buttons to press again',
    await page.evaluate(() => !!document.querySelector('#list li.editing') && ![...document.querySelectorAll('#list button')].some((b) => b.textContent === 'Replace note' && !b.disabled)));
  await wait(1500);
  check('race: when the edit lands the rebuilt row is shown as done, and only one request was sent',
    (await log(page, 'patched')).length === 1 && await page.evaluate(() => !document.querySelector('#list li.editing') && document.querySelector('#list li').classList.contains('done')));
  await page.close();
}
{
  // the edit lands while a read is still waiting on Wallet data fetched before it: the panel reads again afterwards
  const { page } = await open({ delay: 100, rows: [{ date: '2026-10-01', desc: 'LATE READ SHOP', amount: -10 }], records: [{ id: 'late', accountId: 'a1', recordDate: '2026-10-01T04:00:00Z', amount: { value: -10 }, recordType: 'expense', note: 'Mine' }] });
  await settle();
  await page.evaluate(() => { window.__t.env.readDelay = 1200; window.__fire('activated', {}); });
  await wait(150);
  await page.evaluate(() => {
    [...document.querySelectorAll('#list button')].find((b) => b.textContent === 'Replace note').click();
    window.__t.env.records = window.__t.env.records.map((r) => ({ ...r, note: 'LATE READ SHOP' })); // Wallet now has the new note
  });
  await wait(1300); // the slow read finishes with the old records
  await page.evaluate(() => { window.__t.env.readDelay = 0; });
  await wait(1200); // the follow-up read
  check('stale read: an edit that lands during a read triggers one more read, so the row ends up "In Wallet"',
    await page.evaluate(() => document.querySelector('#list li').classList.contains('done') && !document.querySelector('#list li.editing') && document.getElementById('progress').hidden));
  await page.close();
}
{
  // two identical bank rows edited in different requests: the second stays "working" until its own result
  const rec = (id, date, amount, note) => ({ id, accountId: 'a1', recordDate: `${date}T04:00:00Z`, amount: { value: amount }, recordType: 'expense', note });
  const shops = Array.from({ length: 9 }, (_, i) => ({ date: `2026-10-0${i + 1}`, desc: `SHOP ${i}`, amount: -(i + 1) }));
  const twin = { date: '2026-10-09', desc: 'TWIN CAFE', amount: -50 };
  const { page } = await open({
    delay: 800,
    rows: [...shops, twin, twin],
    records: [...shops.map((r, i) => rec(`s${i}`, r.date, r.amount, `note ${i}`)), rec('t1', twin.date, -50, 'coffee one'), rec('t2', twin.date, -50, 'coffee two')],
  });
  await settle();
  await page.click('#replaceAll');
  await wait(1100); // the first request (10 edits, one twin) is done, the second (the other twin) is on its way
  const mid = await page.evaluate(() => [...document.querySelectorAll('#list li')].filter((li) => li.querySelector('.desc').textContent === 'TWIN CAFE')
    .map((li) => li.classList.contains('done') || li.classList.contains('editing')));
  check('twins: after the first request, each identical row is either done or still "working", none offers Replace again',
    mid.length === 2 && mid.every(Boolean) && !(await page.evaluate(() => [...document.querySelectorAll('#list button')].some((b) => b.textContent === 'Replace note' && !b.disabled))), JSON.stringify(mid));
  await wait(1200);
  check('twins: both end up done, each record patched once', JSON.stringify((await log(page, 'patched')).map((p) => p.length)) === '[10,1]' && await page.evaluate(() => [...document.querySelectorAll('#list li')].every((li) => li.classList.contains('done'))));
  await page.close();
}
{
  // demo mode is decided when an edit is clicked, not when it is sent
  const { page } = await open({ tabUrl: 'https://example.com/', delay: 300 });
  await settle();
  await page.click('#demo'); await settle();
  await page.evaluate(() => [...document.querySelectorAll('#list button')].find((b) => b.textContent === 'Replace note').click());
  await page.click('#exitDemo'); // within the gather window
  await wait(900);
  check('demo switch: a demo edit still waiting when demo is left is never sent to Wallet', (await log(page, 'patched')).length === 0, JSON.stringify(await log(page, 'patched')));
  await page.close();
}
{
  const { page } = await open({ delay: 300, rows: [{ date: '2026-10-01', desc: 'REAL SHOP', amount: -10 }], records: [{ id: 'real1', accountId: 'a1', recordDate: '2026-10-01T04:00:00Z', amount: { value: -10 }, recordType: 'expense', note: 'Mine' }] });
  await settle();
  await page.evaluate(() => [...document.querySelectorAll('#list button')].find((b) => b.textContent === 'Replace note').click());
  await page.click('#demo'); // within the gather window
  await wait(900);
  check('demo switch: a real edit still waiting when demo is entered is still sent', JSON.stringify(await log(page, 'patched')) === JSON.stringify([[{ id: 'real1', note: 'REAL SHOP' }]]), JSON.stringify(await log(page, 'patched')));
  await page.close();
}

// ---------------------------------------------------------------- colour coding
{
  const { page } = await open({ rows: [{ date: '2026-10-01', desc: 'NO CATEGORY SHOP', amount: -10 }, { date: '2026-10-03', desc: 'ANOTHER SHOP', amount: -5 }] });
  await settle();
  const got = await page.evaluate(() => ({
    none: !!document.querySelector('#list li .cat.none'),
    gap: document.querySelector('#coverage .s-warn')?.textContent || '',
    fresh: document.querySelector('#status .s-new')?.textContent || '',
  }));
  check('colours: a row with no category is flagged, the dates Wallet has nothing for are amber, the new count is highlighted',
    got.none && got.gap.startsWith('Wallet has no records') && got.fresh.includes('new of 2'), JSON.stringify(got));
  await page.click('#sync'); await settle();
  check('colours: a successful add is shown in green', (await page.evaluate(() => document.getElementById('status').className)) === 'status ok' && (await text(page, '#status')).startsWith('Added 2'), await text(page, '#status'));
  await page.close();
}

// ---------------------------------------------------------------- a long list keeps the main buttons in reach
{
  const many = Array.from({ length: 60 }, (_, i) => ({ date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, desc: `SHOP NUMBER ${i}`, amount: -(i + 1) }));
  const { page } = await open({ rows: many });
  await settle(900);
  const reachable = () => page.evaluate(() => ['toggleAll', 'compare', 'sync'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.top >= 0 && r.bottom <= window.innerHeight && (hit === document.getElementById(id) || document.getElementById(id).contains(hit) || hit?.contains(document.getElementById(id)));
  }));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  const middle = await reachable();
  check('long list: in the middle, the select-all bar (with the bulk buttons) and "Add to Wallet" stay on screen and clickable', middle.every(Boolean), JSON.stringify(middle));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const end = await page.evaluate(() => { const last = document.querySelector('#list li:last-child').getBoundingClientRect(), add = document.getElementById('sync').getBoundingClientRect(); return last.bottom <= add.top; });
  check('long list: at the end the last row sits above "Add to Wallet", not under it', end);
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
  check('category: Change opens a box to type in, listing the categories', await page.evaluate(() => {
    const input = document.querySelector('#list li:nth-child(4) input.mini');
    return document.activeElement === input && [...input.list.options].map((o) => o.value).join('|') === 'Uncategorised|Food & Drinks|Shopping';
  }));
  // the re-read the panel does when it gains focus must not close the picker under the user
  await page.evaluate(() => window.__fire('activated', {})); await settle();
  check('category: the picker stays open through a re-read', await page.evaluate(() => document.activeElement?.matches('#list li:nth-child(4) input.mini')));
  await page.keyboard.type('shop'); await page.keyboard.press('Enter'); await settle(300);
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
  check('transfer: money out reads "Transfer to"', r[0].lines.join(' ').includes('Transfer to Credit card') && await page.evaluate(() =>
    [...document.querySelectorAll('#list li')][1].querySelector('.acts button')?.textContent === 'Transfer to'));
  await page.click('#preview');
  const payload = JSON.parse(await text(page, '#payload'));
  check('transfer: payload has the paired-transfer block and a negative amount', payload[0].transfer?.accountId === 'a2' && payload[0].transfer.pairingMode === 'new' && payload[0].amount.value === -3131.27);
  await page.click('#sync'); await settle();
  const created = await log(page, 'created');
  check('add: both rows are created in one request batch', created.length === 2);
  check('add: Undo appears', await visible(page, '#undo'));
  check('add: the last add is not saved to storage (Undo belongs to this page)', (await store(page)).lastAdd === undefined, JSON.stringify((await store(page)).lastAdd));
  await page.evaluate(() => { window.__t.env.records = []; });
  await page.click('#undo'); await settle();
  const deleted = await log(page, 'deleted');
  check('undo: deletes exactly what was added, a transfer together with its mirror', deleted.length === 1 && JSON.stringify(deleted[0]) === JSON.stringify(['new-1', 'mirror-1', 'new-2']), JSON.stringify(deleted));
  check('undo: button disappears', !(await visible(page, '#undo')));
  check('undo: the rows are new again afterwards', (await rows(page)).every((x) => !x.chips.includes('In Wallet')));
  await page.close();
}
{
  // money in came from the other account
  const { page } = await open({
    rows: [{ date: '2026-10-10', desc: 'TOP UP FROM SAVINGS', amount: 200 }, { date: '2026-10-09', desc: 'SALARY', amount: 5000 }],
    settings: { token: 't', accountId: 'a1', transferRules: [{ keyword: 'top up', accountId: 'a2' }] },
  });
  await settle();
  const r = await rows(page);
  check('transfer: money in reads "Transfer from"', r[0].lines.join(' ').includes('Transfer from Credit card') && await page.evaluate(() =>
    [...document.querySelectorAll('#list li')][1].querySelector('.acts button')?.textContent === 'Transfer from'), JSON.stringify(r[0]));
  await page.evaluate(() => [...document.querySelectorAll('#list li')][1].querySelector('.acts button').click());
  await page.evaluate(() => window.__fire('activated', {})); await settle();
  check('transfer: the account picker stays open through a re-read', await page.evaluate(() => document.activeElement?.matches('#list li:nth-child(2) select.mini')));
  await page.select('#list li:nth-child(2) select', 'a2'); await settle(300);
  check('transfer: the account picked after a re-read is applied', (await rows(page))[1].lines.join(' ').includes('Transfer from Credit card'));
  await page.close();
}
{
  // an add saved by an older version is not offered when the panel opens, and is removed from storage
  const { page } = await open({ settings: { token: 't', accountId: 'a1', lastAdd: { groups: [['old-1']], at: Date.now() - 60e3 } } });
  await settle();
  check('undo: an add from before the panel opened is not offered (and the old saved one is dropped)', !(await visible(page, '#undo')) && (await store(page)).lastAdd === undefined);
  await page.close();
}
{
  // Undo belongs to the page it was added on
  const a = await open();
  await settle();
  await a.page.click('#sync'); await settle();
  check('undo: offered after an add', await visible(a.page, '#undo'));
  await a.page.evaluate(() => window.__fire('updated', 1, { status: 'loading' })); await settle(200);
  check('undo: a reload of the page ends it', !(await visible(a.page, '#undo')));
  await a.page.close();
  const { page } = await open();
  await settle();
  await page.click('#sync'); await settle();
  await page.evaluate(() => { window.__t.env.tabId = 2; window.__fire('activated', { tabId: 2 }); }); await settle(200);
  check('undo: not shown on another tab', !(await visible(page, '#undo')));
  await page.evaluate(() => { window.__t.env.tabId = 1; window.__fire('activated', { tabId: 1 }); }); await settle(200);
  check('undo: shown again back on its tab', await visible(page, '#undo'));
  await page.evaluate(() => window.__fire('updated', 1, { status: 'complete' })); await settle();
  check('undo: an in-page change (no reload) keeps it', await visible(page, '#undo'));
  await page.evaluate(() => window.__fire('tabRemoved', 1)); await settle(200);
  check('undo: closing the tab ends it', !(await visible(page, '#undo')));
  await page.close();
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
  await page.evaluate(() => [...document.querySelectorAll('#list li')].find((li) => li.querySelector('.desc').textContent.startsWith('STREAMFLIX')).querySelector('.acts button:last-child').click()); await settle();
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
  const plain = async (sel) => (await text(page, sel)).replace(/ /g, " ");
  check("balance check: Wallet's balance beside the bank's", (await plain("#walletLbl")) === "Wallet" && (await plain("#balance")) === "RM 1,234.50" && (await plain("#bankLine")) === "RM 1,000.00" && (await plain("#reconcile .lbl")) === "Bank", (await text(page, "#balance")) + " / " + (await text(page, "#bankLine")));
  check("balance check: Wallet higher is a green up arrow under Wallet", (await plain("#reconcileText")) === "▲ +RM 234.50 than bank" && await page.evaluate(() => document.querySelector("#reconcileText .verdict").classList.contains("up")), await text(page, "#reconcileText"));
  check("balance check: says what on the page explains the difference", (await whyLines(page)) === "Not in Wallet: 1 (-RM 10.00)\nOther: RM 224.50 (dates not on this page)", await text(page, "#reconcileWhy"));
  check("balance check: offers Adjust", await visible(page, "#adjust"));
  await page.click("#adjust");
  const ask = await text(page, "#adjustText");
  check("adjust: asks first, with the amount and a warning about rows not yet added", ask.startsWith("Add a -RM 234.50 balance adjustment to Savings") && ask.includes("1 new transaction on this page isn't in Wallet yet"), ask);
  check("adjust: nothing is written before confirming", (await log(page, "created")).length === 0);
  await page.evaluate(() => { window.__t.env.accounts = window.__t.env.accounts.map((a) => (a.id === "a1" ? { ...a, balance: { ...a.balance, currentBalance: 1000 } } : a)); });
  await page.click("#adjustYes"); await settle();
  const [made] = await log(page, "created");
  check("adjust: one record for the difference, reconciled, with a clear note", made?.amount.value === -234.5 && made.recordState === "reconciled" && made.note.startsWith("Balance adjustment to match the bank's current balance") && made.accountId === "a1", JSON.stringify(made));
  check("adjust: it can be undone like any add", await visible(page, "#undo") && (await text(page, "#undo")) === "Undo last add (1)", await text(page, "#undo"));
  check("adjust: afterwards the balances match", (await text(page, "#reconcileText")) === "Matches bank ✓" && !(await visible(page, "#adjust")), await text(page, "#reconcileText"));
  await page.close();
}
{
  const env = { ...baseEnv(), bankBalance: { label: "Outstanding Balance", amount: 500 }, bank: { label: "Card", digits: "1111" } };
  env.accounts = env.accounts.map((a) => (a.id === "a2" ? { ...a, accountType: "CreditCard" } : a));
  env.settings = { ...env.settings, accountMap: { "d:1111": "a2" } };
  const page = await newPanel(browser, server, env);
  await settle();
  const plain = async (sel) => (await text(page, sel)).replace(/ /g, " ");
  check("balance check: a card's outstanding balance is owed, so it matches Wallet's negative balance", (await plain("#bankLine")) === "RM 500.00 owed" && (await text(page, "#reconcileText")) === "Matches bank ✓", await text(page, "#reconcileText"));
  check("balance check: no explanation when it matches", !(await visible(page, "#reconcileWhy")));
  await page.close();
}
{
  // Bank owes 525 = Wallet's 500 + the new 30 - the 5 Wallet has that the bank hasn't posted.
  const rec = (id, recordDate, amount, note) => ({ id, accountId: "a2", recordDate, amount: { value: amount }, recordType: "expense", note });
  const env = {
    ...baseEnv(), bankBalance: { label: "Outstanding Balance", amount: 525 }, bank: { label: "Card", digits: "1111" },
    rows: [{ date: "2026-10-01", desc: "SHOP A", amount: -30 }, { date: "2026-10-02", desc: "SHOP B", amount: -15 }, { date: "2026-10-03", desc: "SHOP C", amount: -12 }],
    records: [rec("w1", "2026-10-02T04:00:00.000Z", -15, "SHOP B"), rec("w2", "2026-10-02T06:00:00.000Z", -5, "Snacks"), rec("w3", "2026-09-30T04:00:00.000Z", -7, "Before the page"),
      rec("w4", "2026-10-03T04:00:00.000Z", -12, "SHOP C"), rec("w5", "2026-10-03T06:00:00.000Z", -4, "Last day, may be on the next page"), rec("w6", "2026-10-01T06:00:00.000Z", -6, "First day, may be on the previous page")],
  };
  env.accounts = env.accounts.map((a) => (a.id === "a2" ? { ...a, accountType: "CreditCard" } : a));
  env.settings = { ...env.settings, accountMap: { "d:1111": "a2" } };
  const page = await newPanel(browser, server, env);
  await settle();
  const plain = async (sel) => (await text(page, sel)).replace(/ /g, " ");
  check("balance check: on a card, owing less than the bank is Wallet higher (up arrow)", (await plain("#bankLine")) === "RM 525.00 owed" && (await plain("#reconcileText")) === "▲ +RM 25.00 than bank", await text(page, "#reconcileText"));
  check("balance check: new rows and Wallet-only records explain the difference, with nothing left over", (await whyLines(page)) === "Not in Wallet: 1 (-RM 30.00)\nNot in Bank: 1 (-RM 5.00)", await text(page, "#reconcileWhy"));
  const walletRows = () => page.evaluate(() => [...document.querySelectorAll("#list li.wallet-only")].map((li) => li.querySelector(".desc").textContent + "|" + [...li.querySelectorAll(".chip")].map((c) => c.textContent).join(",")));
  check("wallet only: the unmatched record inside the page's dates is in the list as Not in Bank, not ones before or on its first and last dates (they may be on the next page)", JSON.stringify(await walletRows()) === JSON.stringify(["Snacks|Not in Bank"]), JSON.stringify(await walletRows()));
  check("wallet only: it sits among the bank rows by date", (await page.evaluate(() => [...document.querySelectorAll("#list .desc")].map((d) => d.textContent).join("|"))) === "SHOP A|SHOP B|Snacks|SHOP C");
  check("wallet only: the summary mentions it", (await text(page, "#status")).includes(`1 in Wallet isn't on the bank page yet ("Not in Bank").`), await text(page, "#status"));
  await page.close();
}
{
  // On a current page, Wallet is checked up to today, so what the bank hasn't posted yet shows.
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const { page } = await open({
    rows: [{ date: day(-6), desc: "SHOP C", amount: -12 }],
    records: [{ id: "w9", accountId: "a1", recordDate: `${day(0)}T04:00:00.000Z`, amount: { value: -8 }, recordType: "expense", note: "Logged today" }],
  });
  await settle();
  const walletRows = () => page.evaluate(() => [...document.querySelectorAll("#list li.wallet-only")].map((li) => li.querySelector(".desc").textContent + "|" + [...li.querySelectorAll(".chip")].map((c) => c.textContent).join(",")));
  check("wallet only: a current page lists today's Wallet record the bank hasn't posted", JSON.stringify(await walletRows()) === JSON.stringify(["Logged today|Not in Bank"]), JSON.stringify(await walletRows()));
  await page.click("#list li.wallet-only button"); await settle(300);
  check("wallet only: Delete asks first and sends nothing", (await text(page, "#list li.wallet-only button")) === "Delete from Wallet?" && (await log(page, "deleted")).length === 0);
  await page.click("#list li.wallet-only button"); await settle();
  // the fake Wallet keeps returning the record, like the API's synced copy can for a while
  check("wallet only: the second click deletes that record and it leaves the list", JSON.stringify(await log(page, "deleted")) === JSON.stringify([["w9"]]) && JSON.stringify(await walletRows()) === "[]", JSON.stringify(await log(page, "deleted")) + JSON.stringify(await walletRows()));
  check("wallet only: says it was deleted", (await text(page, "#status")).includes('Deleted "Logged today" from Wallet.'), await text(page, "#status"));
  await page.close();
}
{
  // Paging: page 1 (current) then page 2, which is recent enough to count as current too. What page 1 matched isn't
  // "Not in Bank" on page 2.
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const rec = (id, d, amount, note) => ({ id, accountId: "a1", recordDate: `${d}T04:00:00.000Z`, amount: { value: amount }, recordType: "expense", note });
  const { page } = await open({
    rows: [{ date: day(-2), desc: "PAGE ONE A", amount: -11 }, { date: day(-1), desc: "PAGE ONE B", amount: -12 }],
    records: [rec("p1", day(-2), -11, "PAGE ONE A"), rec("p2", day(-1), -12, "PAGE ONE B"), rec("p3", day(-5), -13, "PAGE TWO A"), rec("p4", day(-4), -14, "PAGE TWO B")],
  });
  await settle();
  const walletRows = () => page.evaluate(() => [...document.querySelectorAll("#list li.wallet-only")].map((li) => li.querySelector(".desc").textContent));
  await page.evaluate((rows) => { window.__t.env.rows = rows; window.__fire("message", { type: "b2w-page-changed" }); },
    [{ date: day(-5), desc: "PAGE TWO A", amount: -13 }, { date: day(-4), desc: "PAGE TWO B", amount: -14 }]);
  await settle();
  check("wallet only: records matched on the page before aren't Not in Bank on the next page", JSON.stringify(await walletRows()) === "[]", JSON.stringify(await walletRows()));
  await page.close();
}
{
  const { page } = await open({});
  await settle();
  check("wallet only: none when every Wallet record is matched", (await page.evaluate(() => document.querySelectorAll("#list li.wallet-only").length)) === 0);
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
  await wait(100);
  let s = await state();
  check('replace: progress bar and "Replacing…" on that row, but the panel stays usable', s.bar && !s.locked && s.pending[0] === 'Replacing…', JSON.stringify(s));
  check('replace: the row being edited has no other buttons to press', await page.evaluate(() => [...document.querySelector('#list li.editing').querySelectorAll('button')].every((b) => b.disabled)));
  await wait(900);
  check('replace: a double click sends one request', (await log(page, 'patched')).length === 1);
  s = await state();
  check('replace: afterwards the bar is gone and the row is in Wallet', !s.bar && !s.pending.length && (await text(page, '#status')).startsWith('Replaced 1 note'), JSON.stringify(s));

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
  check('demo: fake accounts, a demo banner, and the button offers to exit', (await accountsOf(page)).includes('Visa Credit Card') && await visible(page, '#demoBar') && await text(page, '#demo') === 'Exit demo');
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
