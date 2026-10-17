# Privacy Policy

_Bank to Wallet Sync · last updated 17 October 2026_

Bank to Wallet Sync is a browser extension that reads the transaction table on a supported bank page you have open and adds new transactions to your BudgetBakers Wallet account. This policy explains what it does with your data.

## What the extension accesses
- **Transactions on the bank page you are viewing.** The date, description and amount of each row, the account balance the page shows (to compare it with Wallet's), and (to pick the right Wallet account) the name and last four digits of the bank account the page shows. They are read only while the side panel is open on a supported bank tab: when you open it, and again when the page or tab changes. You can also click **Read transactions on this page** to read on demand, or turn automatic reading off in Settings so the page is read only when you click. Nothing is read when the panel is closed. The extension only notes that the page changed (no page content is sent anywhere) and re-reads the page locally. It never reads your login details, full account numbers, or anything outside the transaction table, the account heading and the balance, and it does not run on pages other than supported banks. For banks added after the first release (currently CIMB Clicks), it can only read that bank's pages after you allow it when Chrome asks; you can remove that access in Settings.
- **Your Wallet API token.** You enter it in Settings. It is stored in the extension's local storage (`chrome.storage.local`) in your browser only.
- **Your Wallet data**, fetched from Wallet using your token so the extension can avoid duplicates and fill in categories: your accounts (names, balances), your existing records for the dates being synced and for roughly the last six months (to learn categories), your categorisation rules and your category list.

## What the extension stores on your computer
Only in this browser's extension storage, never sent anywhere except as described below: your token; your default Wallet account and currency; which Wallet account you chose for each bank account; your transfer rules; the categories you picked by hand for particular merchants; the rows you chose not to sync; the identifiers of the records created by your last "Add" (so "Undo" can remove them, kept for 15 minutes); your behaviour settings; the names of your Wallet accounts (so Settings can offer them); and, after an update, the version number you updated from, until you dismiss the "What's new" card. Forgetting the remembered choices is one click in Settings, and uninstalling the extension removes everything.

## Where data goes
- Transactions you choose to add, the requests used to check for duplicates, categories and balances, and "Undo" requests are sent **directly from your browser to the official BudgetBakers Wallet API** (`https://rest.budgetbakers.com`) using your own API token. "Undo" deletes only the records the extension itself created in your last add. "Merge", "Replace", "Fix in Wallet" and "Use bank date" change existing records that you chose: their note (Merge adds the bank's description to it, Replace swaps it), their amount's sign, or their date, and nothing else. "Adjust" adds one record, after you confirm, for the difference between the bank's balance and Wallet's.
- The extension loads nothing from the internet apart from the Wallet API: its font is bundled, not fetched.
- **Nothing is sent to the developer or to any other third party.** There is no server run by the developer, no analytics, no telemetry, no advertising and no tracking.
- Bank data is not stored by the extension. It exists in memory while the side panel is open and is discarded afterwards. (The only exception is the optional "ignore this row" list, which stores a short fingerprint of a row's date, description and amount on your computer so it stays ignored.)

## Sharing, selling and use
Your data is not sold, shared or used for any purpose other than the single purpose of copying the transactions you select into your own Wallet account. It is not used for creditworthiness, lending or advertising.

## Your control
- Nothing is written to Wallet until you review the list and click **Add to Wallet**, and you can undo an add for 15 minutes.
- You can remove the stored token and settings at any time by clearing them in Settings or by uninstalling the extension.
- Data already added to Wallet is governed by BudgetBakers' own privacy policy and can be edited or deleted there.

## Changes
If this policy changes, the updated version will be published in this repository with a new date.

## Contact
Questions or concerns: open an issue at https://github.com/Atsukio/bank-to-wallet-sync/issues
