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
  check('popup explains the site is not supported and where the setting is', (await text(page, 'h1')).includes("isn't supported") && (await text(page, '#notSupported .hint')).includes('Only open on supported sites'));
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

// ---------------------------------------------------------------- optional bank access (CIMB Clicks)
const CIMB = 'https://*.cimbclicks.com.my/*';
{
  const page = await newPanel(browser, server, { ...baseEnv(), tabUrl: 'https://www.cimbclicks.com.my/clicks/#/', noAccess: [CIMB] }, 'unsupported.html');
  await settle(200);
  check('popup on CIMB without access: asks to allow it instead of saying "not supported"',
    (await text(page, 'h1')) === 'Allow CIMB Clicks?' && (await visible(page, '#needsAccess')) && !(await visible(page, '#notSupported')) && (await text(page, '#allow')) === 'Allow CIMB Clicks');
  await page.click('#allow'); await settle(200);
  check('...Allow asks Chrome for that bank only, then says to click the icon again',
    JSON.stringify(await log(page, 'requested')) === JSON.stringify([CIMB]) && (await text(page, '#allowText')).includes('Click the extension icon again') && !(await visible(page, '#allow')));
  await page.close();
}
{
  const page = await newPanel(browser, server, { ...baseEnv(), tabUrl: 'https://www.cimbclicks.com.my/clicks/#/', noAccess: [CIMB], denyAccess: true }, 'unsupported.html');
  await settle(200);
  await page.click('#allow'); await settle(200);
  check('...declining leaves the Allow button there to try again', await visible(page, '#allow'));
  await page.close();
}
{
  const page = await newPanel(browser, server, { ...baseEnv(), noAccess: [CIMB] }, 'options.html');
  await settle(300);
  const cimbItem = () => page.evaluate(() => [...document.querySelectorAll('#banks li')].find((li) => li.textContent.includes('CIMB'))?.textContent);
  check('Settings: Maybank2u needs nothing, CIMB Clicks shows it needs permission',
    !(await page.evaluate(() => document.querySelector('#banks li').querySelector('button'))) && (await cimbItem()).includes('needs your permission'), await cimbItem());
  await page.evaluate(() => [...document.querySelectorAll('#banks button')].find((b) => b.textContent === 'Allow').click()); await settle(200);
  check('Settings: Allow grants it', (await log(page, 'requested')).includes(CIMB) && (await cimbItem()).includes('(allowed)'), await cimbItem());
  await page.evaluate(() => [...document.querySelectorAll('#banks button')].find((b) => b.textContent === 'Remove access').click()); await settle(200);
  check('Settings: Remove access gives it back', (await log(page, 'removed')).includes(CIMB) && (await cimbItem()).includes('needs your permission'), await cimbItem());
  await page.close();
}

await browser.close();
server.close();
finish();
