// The Settings page and the "not supported" popup.
import { check, finish, launch, serve, wait, baseEnv, newPanel, text, visible, store, log } from './helpers.mjs';

const server = serve();
const browser = await launch();
const settle = (ms = 500) => wait(ms);

// ---------------------------------------------------------------- Settings: first run
{
  const env = { ...baseEnv(), settings: { token: '', accountId: '' } };
  const page = await newPanel(browser, server, env, 'options.html');
  await settle();
  check('first run: the getting-started guide is shown without a token', await visible(page, '#welcome'));
  check('supported banks are listed from sites.js', (await text(page, '#banks')).includes('Maybank2u'));
  await page.close();
}

// ---------------------------------------------------------------- Settings: saving everything
{
  const env = { ...baseEnv(), settings: { token: 'abc', accountId: 'a1', accountName: 'Savings', categoryMemory: { 'a b': { id: 'c', name: 'C' }, 'c d': { id: 'c', name: 'C' } }, ignored: ['x'] } };
  const page = await newPanel(browser, server, env, 'options.html');
  await settle();
  check('with a token the guide is hidden', !(await visible(page, '#welcome')));
  check('the default-account picker offers every Wallet account', await page.evaluate(() => document.getElementById('account').options.length) === 2);
  check('remembered-choice counts are shown', (await text(page, '#memoryText')).endsWith(': 2') && (await text(page, '#ignoredText')).endsWith(': 1'));

  // a complete rule, and an incomplete one that must be dropped
  await page.click('#addRule'); await page.click('#addRule');
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.rule-row');
    rows[0].querySelector('input').value = 'repayment'; rows[0].querySelector('select').value = 'a2';
    rows[1].querySelector('input').value = 'half typed';
  });
  await page.click('#autoRead'); // turn auto-read off
  await page.click('#collectPages'); // turn collect on
  await page.click('#save'); await settle(200);
  const s = await store(page);
  check('saved: transfer rules keep only complete rules', JSON.stringify(s.transferRules) === JSON.stringify([{ keyword: 'repayment', accountId: 'a2' }]), JSON.stringify(s.transferRules));
  check('saved: switches', s.autoRead === false && s.collectPages === true && s.onlySupported === true && s.hideWhenAway === true, JSON.stringify({ a: s.autoRead, c: s.collectPages }));
  check('saved: account list for the panel and rule pickers', s.accountList?.length === 2);

  // removing every rule then loading accounts must not bring them back
  await page.evaluate(() => document.querySelectorAll('.rule-row button').forEach((b) => b.click()));
  await page.click('#load'); await settle();
  check('Load accounts does not resurrect removed rules', await page.evaluate(() => document.querySelectorAll('.rule-row').length) === 0);

  await page.click('#forgetCategories'); await page.click('#clearIgnored'); await settle(200);
  const t = await store(page);
  check('forget and clear empty the remembered lists', Object.keys(t.categoryMemory).length === 0 && t.ignored.length === 0);
  check('...and the counts follow', (await text(page, '#memoryText')).endsWith(': 0'));
  await page.close();
}

// ---------------------------------------------------------------- "not supported" popup
{
  const page = await newPanel(browser, server, baseEnv(), 'unsupported.html');
  await settle(200);
  check('popup lists every supported bank', (await text(page, '#banks')).includes('Maybank2u') && (await text(page, '#banks')).includes('CIMB Clicks') && (await text(page, '#banks')).includes('cimbclicks.com.my'));
  check('popup explains the site is not supported and where the setting is', (await text(page, 'h1')).includes("isn't supported") && (await text(page, '.hint')).includes('Only open on supported sites'));
  await page.evaluate(() => { window.close = () => { window.__closed = true; }; });
  await page.click('#openSettings');
  check('the cog opens Settings and closes the popup', (await log(page, 'opened')) === 1 && await page.evaluate(() => window.__closed === true));
  check("the popup shows no what's-new card without an update", !(await visible(page, '#whatsNew')));
  await page.close();
}
{
  const page = await newPanel(browser, server, { ...baseEnv(), version: '0.3.0', settings: { ...baseEnv().settings, whatsNewFrom: '0.2.0' } }, 'unsupported.html');
  await settle(200);
  check("the popup shows the what's-new card too (the NEW badge shows on every site)", (await visible(page, '#whatsNew')) && (await text(page, '#whatsNew h2')) === "What's new in 0.3.0");
  await page.click('#whatsNew button'); await settle(200);
  check('...and "Got it" there clears it as well', !(await visible(page, '#whatsNew')) && !('whatsNewFrom' in (await store(page))));
  await page.close();
}

await browser.close();
server.close();
finish();
