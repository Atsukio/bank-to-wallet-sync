# Chrome Web Store listing

Copy these into the Developer Dashboard.

## Name
Bank to Wallet Sync

## Summary (max 132 characters)
Reads the Maybank2u transactions on screen and adds the new ones to BudgetBakers Wallet. No duplicates, no servers.

## Category
Productivity (or Finance, if offered)

## Language
English

## Description
Bank to Wallet Sync copies transactions from your Maybank2u (M2U) history into BudgetBakers Wallet, so you stop retyping them.

You log in to your bank as usual. Open the extension and it reads the transaction table already on screen and shows the rows next to what Wallet already has. You tick what you want and add it.

FEATURES
• Reads the transaction table on the Maybank2u page you are viewing, automatically when you open the panel and again when you change pages (switch it off in Settings). No bank login is ever handled by the extension.
• Duplicate detection: compares date, amount, type and description against your existing Wallet records, so re-running it never double-adds. A record with the wrong type (an expense saved as income) is flagged, not hidden.
• Picks the right Wallet account for the bank account you're looking at, and remembers it.
• Fills in categories and labels from your own Wallet rules, the categories you've chosen before, and similar past records. Change any row's category before adding.
• Turns card repayments and similar rows into proper Wallet transfers, using rules you set.
• Review before anything is written: untick rows, ignore rows you never want, flip a sign, preview the payload, then Add to Wallet.
• Undo the last add for 15 minutes.
• Shows your Wallet balance, and how many new transactions the page has on the toolbar icon.
• Built-in demo data to try it with no bank login and no Wallet token.
• Settings let you turn automatic reading off, allow the panel on any site, keep it open when you switch tabs, collect several pages into one add, and set a keyboard shortcut (default Alt+Shift+W).
• Material Design 3 look, with light and dark themes.

PRIVACY
Everything runs in your browser. Transactions go straight from your browser to the official Wallet REST API with your own token. No analytics, no tracking, no developer server, and nothing is loaded from the internet except the Wallet API. Your token and choices are stored only in this browser's extension storage.

REQUIREMENTS
• A BudgetBakers Wallet Premium account (the REST API is Premium only) and an API token (Wallet web app → Settings → REST API).
• Currently supports Maybank2u (M2U) Malaysia only.

A NOTE FROM THE DEVELOPER
I built this for my own use and to share with friends. If it fits your needs too, you're more than welcome to use it. It's a small personal project, so updates may be occasional.

Not affiliated with or endorsed by Malayan Banking Berhad (Maybank) or BudgetBakers. "Maybank" and "Wallet" are trademarks of their respective owners.

Source code: https://github.com/Atsukio/bank-to-wallet-sync

## Single purpose
Copy transactions from the supported bank page the user is viewing (currently Maybank2u) into the user's BudgetBakers Wallet account.

## Permission justifications
- **storage**: Saves the user's Wallet API token, chosen Wallet accounts, settings and remembered choices locally in the browser.
- **activeTab**: Lets the extension work with the current tab the user is on.
- **scripting**: Injects the reader that extracts the transaction table (and the account heading) from the bank page the user is viewing.
- **sidePanel**: Shows the review/sync interface in Chrome's side panel.
- **Host permission `https://*.maybank2u.com.my/*`**: Needed to read the transaction table on Maybank2u pages, and to enable the side panel only on those tabs.
- **Host permission `https://rest.budgetbakers.com/*`**: Needed to call the official Wallet REST API to look up existing records, accounts, categories and rules, create new records, and delete the records the extension itself just created when the user presses Undo.
- **Keyboard shortcut (commands)**: Optional Alt+Shift+W to open the panel; it needs no extra permission.

## Remote code
No. All code, including the font, is bundled in the package.

## Data usage disclosures (Privacy practices tab)
- Collects: **Financial and payment information** (transaction date, description and amount, and the name and last four digits of the bank account shown) and **Authentication information** (the user's own Wallet API token).
- Not sold, not used for unrelated purposes, not used for creditworthiness or lending.
- Certify all three Limited Use statements.
- Privacy policy URL: https://github.com/Atsukio/bank-to-wallet-sync/blob/main/PRIVACY.md

## Assets in this folder
- `screenshot-1-review.png`, `screenshot-2-duplicates.png`, `screenshot-3-settings.png`: 1280×800 (upload 1–5)
- `promo-small-440x280.png`: small promo tile
- Store icon: `icons/icon-128.png`
- Regenerate all of them with `npm run screenshots`.

All screenshots use the built-in synthetic demo data. No real bank or Wallet data is shown.
