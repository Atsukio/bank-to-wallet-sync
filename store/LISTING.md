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

You log in to your bank as usual. When you click the extension, it reads the transaction table already on screen and shows the rows next to what Wallet already has. You tick what you want and add it.

FEATURES
• Reads the transaction table on the Maybank2u page you are viewing. No bank login is ever handled by the extension.
• Duplicate detection: compares date, amount and description against your existing Wallet records, so re-running it never double-adds.
• "Likely in Wallet" matches (same date and amount, different description) are left unticked, with a one-click option to replace the Wallet note with the bank's description.
• Review before anything is written: untick rows, preview the payload, then Add to Wallet.
• Built-in demo data to try it with no bank login and no Wallet token.
• Side panel that only appears on Maybank2u tabs.

PRIVACY
Everything runs in your browser. Transactions go straight from your browser to the official Wallet REST API with your own token. No analytics, no tracking, no developer server. Your token is stored only in this browser's extension storage.

REQUIREMENTS
• A BudgetBakers Wallet Premium account (the REST API is Premium only) and an API token (Wallet web app → Settings → REST API).
• Currently supports Maybank2u (M2U) Malaysia only.

Not affiliated with or endorsed by Malayan Banking Berhad (Maybank) or BudgetBakers. "Maybank" and "Wallet" are trademarks of their respective owners.

Source code: https://github.com/Atsukio/bank-to-wallet-sync

## Single purpose
Copy transactions from the Maybank2u page the user is viewing into the user's BudgetBakers Wallet account.

## Permission justifications
- **storage**: Saves the user's Wallet API token, chosen Wallet account and currency locally in the browser.
- **activeTab**: Lets the extension read the current tab only after the user clicks it.
- **scripting**: Injects the reader that extracts the transaction table from the Maybank2u page the user is viewing.
- **sidePanel**: Shows the review/sync interface in Chrome's side panel.
- **Host permission `https://*.maybank2u.com.my/*`**: Needed to read the transaction table on Maybank2u pages, and to enable the side panel only on those tabs.
- **Host permission `https://rest.budgetbakers.com/*`**: Needed to call the official Wallet REST API to look up existing records and create new ones.

## Remote code
No. All code is bundled in the package.

## Data usage disclosures (Privacy practices tab)
- Collects: **Financial and payment information** (transaction date, description and amount) and **Authentication information** (the user's own Wallet API token).
- Not sold, not used for unrelated purposes, not used for creditworthiness or lending.
- Certify all three Limited Use statements.
- Privacy policy URL: https://github.com/Atsukio/bank-to-wallet-sync/blob/main/PRIVACY.md

## Assets in this folder
- `screenshot-1-review.png`, `screenshot-2-duplicates.png`, `screenshot-3-settings.png`: 1280×800 (upload 1–5)
- `promo-small-440x280.png`: small promo tile
- Store icon: `icons/icon-128.png`

All screenshots use the built-in synthetic demo data. No real bank or Wallet data is shown.
