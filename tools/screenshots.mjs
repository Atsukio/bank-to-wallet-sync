// Regenerates the Chrome Web Store images in store/ from the real pages, using the built-in demo data only:
//   store/screenshot-1-review.png, screenshot-2-duplicates.png, screenshot-3-settings.png  (1280x800)
//   store/promo-small-440x280.png                                                          (440x280)
// The images are flattened to opaque 24-bit PNGs, as the Web Store requires. Run with: npm run screenshots
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, serve, launch, baseEnv, newPanel, wait } from '../tests/helpers.mjs';

const out = path.join(ROOT, 'store');
const server = serve();
const browser = await launch();
const DPR = 2;

// ---- the real pages, rendered at 2x
async function shoot(file, setup, { width, height = 900, dark = false } = {}) {
  const env = { ...baseEnv(), tabUrl: 'https://example.com/', settings: { token: 'demo', accountId: 'demo-savings', accountName: 'Maybank Savings' } };
  const page = await newPanel(browser, server, env, file, { dark });
  await page.setViewport({ width, height, deviceScaleFactor: DPR });
  await setup(page);
  await wait(500);
  const shot = await page.screenshot({ fullPage: true });
  const rects = await page.evaluate(() => [...document.querySelectorAll('#list li')].map((li) => ({ desc: li.querySelector('.desc')?.textContent, top: li.offsetTop, bottom: li.offsetTop + li.offsetHeight })));
  const headings = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('h2')].map((h) => [h.textContent, h.offsetTop])));
  await page.close();
  return { shot, rects, headings };
}

const panel = await shoot('popup.html', async (page) => { await page.click('#demo'); await wait(700); }, { width: 420 });
const settings = await shoot('options.html', async (page) => {
  await page.evaluate(() => { document.querySelector('.switch-row details').open = true; });
}, { width: 560, height: 700 });

// ---- compose onto the store canvases (a page that already has style.css and Roboto loaded)
const cover = await newPanel(browser, server, baseEnv(), 'unsupported.html');
const primary = await cover.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim());
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

async function compose({ width, height, html }) {
  await cover.setViewport({ width, height });
  await cover.evaluate(({ html, primary }) => {
    document.body.style.cssText = `margin:0;width:100vw;height:100vh;display:flex;align-items:center;color:#fff;background:linear-gradient(135deg, ${primary}, color-mix(in srgb, ${primary} 55%, #000));font-family:Roboto,system-ui,sans-serif;letter-spacing:0;overflow:hidden`;
    document.body.innerHTML = html;
  }, { html, primary });
  await wait(150);
  return sharp(await cover.screenshot()).flatten({ background: primary }).removeAlpha().png().toBuffer();
}

const slide = (title, text, img, { cardWidth }) => `
  <div style="padding:0 64px;flex:1"><h1 style="font:500 46px/52px Roboto;margin:0 0 18px;color:#fff">${title}</h1>
    <p style="font:400 22px/32px Roboto;margin:0;opacity:.92">${text}</p>
    <p style="font:400 14px/20px Roboto;margin:28px 0 0;opacity:.7">Demo data shown. Not affiliated with Maybank or BudgetBakers.</p></div>
  <div style="margin-right:72px;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35);background:#fff;flex:none">
    <img src="${img}" style="display:block;width:${cardWidth}px"></div>`;

// crop the panel to a band of rows (so screenshot 2 can focus on duplicate handling)
const band = async (from, to) => {
  const top = panel.rects.find((r) => r.desc?.startsWith(from)).top * DPR, bottom = panel.rects.find((r) => r.desc?.startsWith(to)).bottom * DPR;
  const header = 0; // keep it clean: just the rows
  return sharp(panel.shot).extract({ left: 0, top: Math.round(top) + header, width: 420 * DPR, height: Math.round(bottom - top) }).toBuffer();
};
const topOfPanel = await sharp(panel.shot).extract({ left: 0, top: 0, width: 420 * DPR, height: Math.min(Math.round(1500), (await sharp(panel.shot).metadata()).height) }).toBuffer();

// Settings: just from the Behaviour heading to the Remembered choices heading
const settingsBand = await (async () => {
  const top = Math.max(0, (settings.headings.Behaviour - 12) * DPR);
  const bottom = settings.headings['Remembered choices'] * DPR - 8;
  return sharp(settings.shot).extract({ left: 0, top: Math.round(top), width: 560 * DPR, height: Math.round(bottom - top) }).toBuffer();
})();

const shots = {
  'screenshot-1-review.png': slide('Review before you sync', 'Read the transactions on your bank page, then tick exactly what you want in Wallet.', b64(topOfPanel), { cardWidth: 400 }),
  'screenshot-2-duplicates.png': slide('No more double entries', 'Compares date, amount and description with your Wallet records. Likely matches stay unticked, and a record with the wrong type is flagged instead of hidden.', b64(await band('MCDONALDS', 'XCORE')), { cardWidth: 380 }),
  'screenshot-3-settings.png': slide('Make it yours', 'Pick the Wallet account per bank account, set transfer rules, and choose how the panel behaves. Everything stays in your browser.', b64(settingsBand), { cardWidth: 500 }),
};
for (const [file, html] of Object.entries(shots)) {
  fs.writeFileSync(path.join(out, file), await compose({ width: 1280, height: 800, html }));
  console.log('wrote store/' + file);
}
const icon = b64(fs.readFileSync(path.join(ROOT, 'icons/icon-48.png')));
fs.writeFileSync(path.join(out, 'promo-small-440x280.png'), await compose({
  width: 440, height: 280,
  html: `<div style="padding:0 28px"><img src="${icon}" width="48" style="margin-bottom:12px"><h1 style="font:500 30px/36px Roboto;margin:0 0 8px;color:#fff">Bank to Wallet Sync</h1><p style="font:400 15px/22px Roboto;margin:0;opacity:.92">Bank transactions into Wallet. No duplicates.</p></div>`,
}));
console.log('wrote store/promo-small-440x280.png');

await browser.close();
server.close();
