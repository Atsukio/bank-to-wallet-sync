# AGENTS.md

Chrome/Edge (Manifest V3) extension: reads the transaction table on a Maybank2u page and adds new rows to BudgetBakers Wallet through its REST API. Repo: https://github.com/Atsukio/bank-to-wallet-sync (branch `main`).

## Layout
Plain ES modules, no bundler, no dependencies, no build step. Load the folder unpacked at `chrome://extensions`.

| File | Role |
| --- | --- |
| `manifest.json` | MV3. Side panel is `popup.html`. Host permissions: `*.maybank2u.com.my`, `rest.budgetbakers.com`. |
| `background.js` | Service worker. Enables the side panel only on Maybank2u tabs; on other tabs sets a per-tab popup (`unsupported.html`) so the icon shows "not supported". Icon click on a supported tab calls `sidePanel.open`. `openPanelOnActionClick` is deliberately `false`. |
| `popup.html` / `popup.js` | Side panel UI: scan page, match against Wallet, review list, add. |
| `scanner.js` | `scanPage()` / `diagnosePage()` are injected into the bank page via `chrome.scripting.executeScript` (all frames). They must stay self-contained (no imports, no outer-scope references). |
| `wallet.js` | Wallet API client: accounts (archived filtered out), records, record rules, create/update in batches. |
| `demo.js` | Synthetic transactions, fake Wallet records and fake rules for the **Demo data** button. |
| `options.html` / `options.js` | Settings: API token, account, currency. Stored in `chrome.storage.local`. |
| `style.css` | Material Design 3 role tokens (`--md-*`), light and dark. Shared by every page. |
| `store/` | Chrome Web Store listing text, screenshots (1280x800), promo tile. |
| `dist/` | Built upload zip (the one place `.zip` is not gitignored). |

## Behaviour worth knowing
- **Duplicates** (`popup.js` `analyse`): nothing is written to Wallet to track syncs. Existing records for the date range are fetched and paired one-to-one with bank rows by date, absolute amount and normalised description (ignore case/punctuation; Wallet may truncate, so a prefix of 8+ chars counts). Same date and amount but different description is "likely": left unticked, with a Replace button that PATCHes only the note.
- **Categories**: Wallet applies its keyword rules to bank-sync and GPay imports, not to REST-created records. We read `GET /record-rules` and apply the best rule ourselves (`matchRule`: case-insensitive substring, longest keyword wins, skips transfer rules and rules for other accounts). Sets `categoryId` and `labelIds`. If rules fail to load, records are still added uncategorised.
- Bank description goes in `note` (255 max). `counterParty` is intentionally left unset.
- Timezone: dates are Malaysia time (UTC+8); records are created at 12:00 +08:00.
- Old versions tagged notes with `[m2u:<hash>]`. It is stripped when reading, never written.

## Wallet API notes
- Spec (JSON): `curl -sL https://rest.budgetbakers.com/wallet/openapi`. Read it rather than guessing field names. Paths are under `/wallet/v1/api`.
- Premium only. 300 requests/hour. 409 means the first data sync for the token is still running. 401/403 means bad token.
- Amount sign decides income vs expense. List responses use keys like `records`, `accounts`, `recordRules`; pagination via `nextOffset`.
- Account has `archived: boolean`. `PATCH` batches max 10, `POST` batches max 20.

## Conventions
- Match the existing style: small functions, short comments that explain why, no frameworks.
- Keep `style.css` as the single source of colours. Use `--md-*` tokens, not hex values, in pages. Credit green and warning amber are the only custom colours.
- Any UI change should be checked in both light and dark.
- Bank and Wallet data in repo files, screenshots, tests or examples must be **synthetic** (use `demo.js`). Never commit or paste real transactions, API tokens or `.env` files.

## Testing
There is no test suite. To exercise the UI without a bank login or token:
1. Serve the repo folder over HTTP (ES modules need it), e.g. a small `node:http` static server.
2. Drive it with `puppeteer-core` using Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; Chrome is not installed here). Chrome 137+ ignores `--load-extension`, so instead stub `window.chrome` with `evaluateOnNewDocument` (`storage.local.get/set`, `runtime.openOptionsPage`, `tabs.query`).
3. Open `popup.html`, click `#demo`, screenshot. Set `prefers-color-scheme` via `page.emulateMediaFeatures` to check dark.

The service worker and side panel behaviour (`background.js`) can only be verified in a real browser: reload the extension, then click the icon on a Maybank2u tab and a non-bank tab. `onInstalled` does not fire on a plain reload, so tab state is set on the first tab switch (or remove and re-add the extension).

## Releasing to the Web Store
1. Bump `version` in `manifest.json` (the store rejects a re-upload with the same version).
2. Build the zip with `manifest.json` at the root and **forward-slash paths** (PowerShell `Compress-Archive` on 5.1 writes backslashes). From the repo root:
   `tar -a -cf dist/bank-to-wallet-sync-<version>.zip manifest.json background.js popup.html popup.js unsupported.html options.html options.js scanner.js wallet.js demo.js style.css icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png`
   Delete the old zip in `dist/` and update the filename in `README.md`. `unsupported.html` must stay in the list.
3. Update `store/LISTING.md` if permissions or behaviour changed. Privacy policy is `PRIVACY.md` (URL goes in the dashboard).
4. Regenerate screenshots after visible UI changes: render `popup.html` (demo) and `options.html` at 2x, then compose onto a 1280x800 canvas and flatten to PNG with no alpha (`sharp(...).flatten().removeAlpha()`).

## Status as of 2026-10-13 (v0.1.1)
- Pushed: everything through v0.1.1 (archived-account filter, unsupported-site popup, rule-based categories, Material 3 restyle, store assets, `dist/` zip).
- None of the background/side-panel changes have been tested in a real browser.
- Screenshot 2 (`screenshot-2-duplicates.png`) reuses the same panel as screenshot 1; a tighter crop of the "Likely in Wallet" rows would be better.
- The licence holder is "Atsukio" (MIT). "Maybank" appears in the store listing with a non-affiliation disclaimer; reviewers may still flag it.
- Git identity is configured globally. Commit messages end with the `Co-Authored-By` line from the session's attribution instructions.
