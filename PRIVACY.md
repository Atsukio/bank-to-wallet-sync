# Privacy Policy

_Bank to Wallet Sync · last updated 12 October 2026_

Bank to Wallet Sync is a browser extension that reads the transaction table on a Maybank2u page you have open and adds new transactions to your BudgetBakers Wallet account. This policy explains what it does with your data.

## What the extension accesses
- **Transactions on the Maybank2u page you are viewing.** The date, description and amount of each row are read from the page, only when you click **Read transactions on this page**. The extension never reads your login details, account numbers, balances or anything outside the transaction table, and it does not run on pages other than `maybank2u.com.my`.
- **Your Wallet API token, chosen account and currency.** You enter these in Settings. They are stored in the extension's local storage (`chrome.storage.local`) in your browser only.
- **Your existing Wallet records for the relevant date range.** These are fetched from Wallet so the extension can avoid creating duplicates.

## Where data goes
- Transactions you choose to add, and the requests used to check for duplicates, are sent **directly from your browser to the official BudgetBakers Wallet API** (`https://rest.budgetbakers.com`) using your own API token.
- **Nothing is sent to the developer or to any other third party.** There is no server run by the developer, no analytics, no telemetry, no advertising and no tracking.
- Bank data is not stored by the extension. It exists in memory while the side panel is open and is discarded afterwards.

## Sharing, selling and use
Your data is not sold, shared or used for any purpose other than the single purpose of copying the transactions you select into your own Wallet account. It is not used for creditworthiness, lending or advertising.

## Your control
- Nothing is written to Wallet until you review the list and click **Add to Wallet**.
- You can remove the stored token and settings at any time by clearing them in Settings or by uninstalling the extension.
- Data already added to Wallet is governed by BudgetBakers' own privacy policy and can be edited or deleted there.

## Changes
If this policy changes, the updated version will be published in this repository with a new date.

## Contact
Questions or concerns: open an issue at https://github.com/Atsukio/bank-to-wallet-sync/issues
