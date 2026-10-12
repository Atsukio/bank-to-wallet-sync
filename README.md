# Bank to Wallet Sync

> **A note on this project:** I built this for my own use and to share with friends. It does what I need and isn't a polished product, but if it fits your needs too, you're more than welcome to use it. Issues and suggestions are welcome, though I can't promise to act on them quickly.

A Chrome/Edge extension. You log in to your bank yourself as usual; the extension only reads the transaction table already on screen and adds new rows to [BudgetBakers Wallet](https://budgetbakers.com) through its official REST API. Nothing goes anywhere else: there is no server, analytics or tracking.

**Supported banks:** Maybank2u (M2U), Malaysia, for now. The list lives in [sites.js](sites.js) and is shown on the Settings page.

![Reviewing transactions before syncing](store/screenshot-1-review.png)

## What it does
- Reads the transactions on the page, automatically when the panel opens and again when the page changes (you can turn that off).
- Compares them with what Wallet already has, so nothing is added twice.
- Picks the **Wallet account** for the bank account you're looking at, and remembers it.
- Fills in **categories and labels** from your Wallet rules, your own past choices, and similar past records.
- Turns card repayments and similar rows into proper Wallet **transfers**.
- Lets you review, change a category, ignore a row, or flip a sign before anything is written, and **undo** an add for 15 minutes.
- Shows your Wallet balance and, on the toolbar icon, how many new transactions the page has.

## Install
1. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder. (A first install opens the Settings page with a short getting-started guide.)
3. Open **Settings** (the cog in the side panel), paste your Wallet API token (Wallet web app → Settings → REST API, Premium only), click **Load accounts**, pick your default Wallet account and save.

## Use
1. Log in to your bank and open the account's transaction history.
2. Click the extension icon (or press **Alt+Shift+W**). The panel opens and reads the transactions by itself, and re-reads when the page changes. **Read transactions on this page** forces a re-read.
3. Check the Wallet account at the top. If the page shows which bank account it is, your choice is remembered for that account.
4. Untick anything you don't want, then **Add to Wallet**. **Undo last add** removes exactly what was just created.

Chrome only lets an extension open its side panel when you click, so the panel can't slide out on its own.

## Settings
Besides the token, default account and currency, the Settings page (the cog) has:
- **Only open on supported sites** (on): the toolbar button opens the panel only on a supported bank, and elsewhere shows a short "not supported" message. Off: it opens on any site.
- **Read transactions automatically** (on): read when the panel opens and when the page changes. Off: read only when you press the button.
- **Hide the panel when I switch away** (on): the panel hides on tabs where it isn't allowed and returns when you come back. Off: it stays open as you switch tabs.
- **Collect transactions across pages** (off): keep the rows from every page you visit so one Add sends them all. **Clear list** starts again.
- **Transfer rules**: words in a bank description that mean "this is a transfer to my other account", with the account to send it to.
- **Remembered choices**: forget the categories you picked by hand, or the rows you chose not to sync.

## How duplicates are avoided
Nothing is written into Wallet to track what was synced. Before showing the list, the extension fetches the account's existing records for the date range and pairs each bank row with one record (matching on date, amount and description, ignoring case, spacing and punctuation, and allowing for Wallet cutting descriptions short). Two identical coffees on the same day need two Wallet records.

- **In Wallet:** same date, amount, type and description.
- **Likely in Wallet:** same date and amount, different description. Unticked, with the Wallet description shown. **Replace** sets that record's note to the bank's description; payer, category and labels are never touched.
- **Type differs:** same date and amount but the opposite type (an expense recorded as income). It is flagged rather than counted as "In Wallet", because the record needs fixing in Wallet.

Records synced by older versions carry a `[m2u:…]` tag in their note. It's ignored when reading and no longer written.

## Categories, transfers and labels
Wallet applies its categorisation rules to bank-sync and GPay imports but not to records created through the API, so the extension does it itself, in this order:
1. A category you chose by hand for the same merchant before ("remembered").
2. Your Wallet rules (keyword → category and labels).
3. The category of similar past records (same description, else same merchant, same income/expense type, "Unknown" ignored).

Click **Change** on a row to pick another category; it is remembered for that merchant. A row can also be made a **transfer** to another of your Wallet accounts (or automatically, via a transfer rule): Wallet then creates the matching record on the other account, so the other account's own page shows it as already there.

## Before your first real sync
- Click **Preview payload** and compare the fields with the `POST /v1/api/records` schema in the API explorer: https://rest.budgetbakers.com/wallet/openapi/ui.
- Try it with one transaction first. **Undo last add** is there if something looks wrong.

## If something looks off
- **"No transaction table found":** the scanner looks for tables with a date column and an amount (or debit/credit) column. If your bank lays history out differently, `scanPage()` in [scanner.js](scanner.js) needs adjusting.
- **Wrong sign:** click **Compare**; it ends with how the page marks amounts (digits masked) and which bank account it thinks it is on, which is safe to share when reporting a problem.
- **A deleted record still shows as "In Wallet":** Wallet's API serves a synced copy of your data, so deletions can take a moment. The panel says when Wallet is still syncing and when its data last changed.

## Limits
- Wallet allows 300 API requests an hour. One read uses a handful (records, plus accounts, rules, categories and history that are cached for several minutes).
- Rows no rule or past record covers are created without a category (Wallet shows Unknown).

## Privacy
Everything runs in your browser and talks only to the Wallet API with your own token. No analytics, no developer server. See [PRIVACY.md](PRIVACY.md).

## Development
No build step and no runtime dependencies: load the folder unpacked. Tooling is for tests and releases only.
```
npm install          # test and release tooling
npm test             # logic, scanner, side panel, settings, service worker and build tests (headless Chrome/Edge)
npm run build        # dist/bank-to-wallet-sync-<version>.zip for the Chrome Web Store
npm run screenshots  # regenerate the images in store/ from the demo data
npm run palette -- "#1a73e8" --write   # regenerate the Material 3 colours in style.css
```
Tests use a stubbed browser and a fake Wallet, never real data or a real token. Set `CHROME_PATH` if no Chrome/Edge is found. GitHub Actions runs the tests and the build on every push. See [AGENTS.md](AGENTS.md) for the architecture and the things worth knowing before changing it.

## Publishing to the Chrome Web Store
Listing text, permission justifications and data-usage answers are in [store/LISTING.md](store/LISTING.md), with 1280×800 screenshots and a small promo tile alongside. Bump `version` in `manifest.json`, run `npm run build`, and upload the zip from `dist/`.

## License
[MIT](LICENSE). The bundled Roboto font (in [fonts/](fonts/)) is Apache 2.0, see [fonts/NOTICE.txt](fonts/NOTICE.txt). Not affiliated with or endorsed by Malayan Banking Berhad or BudgetBakers.
