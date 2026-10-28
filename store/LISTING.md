# Chrome Web Store listing

Copy these into the Developer Dashboard.

## Name
Bank to Wallet Sync

## Summary (max 132 characters)
Copies the Maybank2u or CIMB Clicks transactions on screen into BudgetBakers Wallet. No duplicates, no servers.

## Category
Productivity (or Finance, if offered)

## Language
English

## Description
Bank to Wallet Sync copies transactions from your Maybank2u (M2U) or CIMB Clicks history into BudgetBakers Wallet, so you stop retyping them.

You log in to your bank as usual. Open the extension and it reads the transaction table already on screen and shows the rows next to what Wallet already has. You tick what you want and add it.

FEATURES
• Reads the transaction table on the Maybank2u or CIMB Clicks page you are viewing, automatically when you open the panel and again when you change pages or scroll to load more (switch it off in Settings). No bank login is ever handled by the extension.
• Duplicate detection: compares date, amount, type and description against your existing Wallet records, so re-running it never double-adds. A record dated a day or two before or after the bank (logged early, or created automatically) is recognised (with a one-click "use the bank's date"), and a record with the wrong type (an expense saved as income) is flagged, not hidden, with a one-click fix. Notes you've added details to still count as matches, and a likely match can be merged (keep your note, add the bank's description) or replaced, and the payee or payer name on CIMB DuitNow transfers goes into Wallet's payer/payee field.
• Picks the right Wallet account for the bank account you're looking at, and remembers it.
• Fills in categories and labels from your own Wallet rules, the categories you've chosen before, and similar past records. Change any row's category before adding: just type to find it.
• Turns card repayments and similar rows into proper Wallet transfers, using rules you set.
• Review before anything is written: untick rows, ignore rows you never want, flip a sign, preview the payload, then Add to Wallet.
• Undo the last add while you're still on the page.
• Shows Wallet records the bank page doesn't have ("Not in Bank"), and can delete one entered twice or on the wrong account.
• Compares your Wallet balance with the bank's, and can add a one-click (confirmed, undoable) adjustment for any difference. The toolbar icon shows how many new transactions the page has.
• Built-in demo data to try it with no bank login and no Wallet token.
• Settings let you turn automatic reading off, allow the panel on any site, keep it open when you switch tabs, collect several pages into one add, and set a keyboard shortcut (default Alt+Shift+W).
• Material Design 3 look, with light and dark themes.

PRIVACY
Everything runs in your browser. Transactions go straight from your browser to the official Wallet REST API with your own token. No analytics, no tracking, no developer server, and nothing is loaded from the internet except the Wallet API. Your token and choices are stored only in this browser's extension storage.

REQUIREMENTS
• A BudgetBakers Wallet Premium account (the REST API is Premium only) and an API token (Wallet web app → Settings → REST API).
• Currently supports Maybank2u (M2U) and CIMB Clicks, in Malaysia.

A NOTE FROM THE DEVELOPER
I built this for my own use and to share with friends. If it fits your needs too, you're more than welcome to use it. It's a small personal project, so updates may be occasional.

Not affiliated with or endorsed by Malayan Banking Berhad (Maybank), CIMB Bank Berhad or BudgetBakers. "Maybank", "CIMB" and "Wallet" are trademarks of their respective owners.

Source code: https://github.com/Atsukio/bank-to-wallet-sync

## Single purpose
Copy transactions from the supported bank page the user is viewing (currently Maybank2u and CIMB Clicks) into the user's BudgetBakers Wallet account.

## Permission justifications
- **storage**: Saves the user's Wallet API token, chosen Wallet accounts, settings and remembered choices locally in the browser.
- **activeTab**: Lets the extension work with the current tab the user is on.
- **scripting**: Injects the reader that extracts the transaction table (and the account heading) from the bank page the user is viewing.
- **sidePanel**: Shows the review/sync interface in Chrome's side panel.
- **Host permission `https://*.maybank2u.com.my/*`**: Needed to read the transaction table on Maybank2u pages, and to enable the side panel only on those tabs.
- **Optional host permission `https://*.cimbclicks.com.my/*`**: Requested only when the user chooses to use CIMB Clicks (from the extension's popup on a CIMB Clicks page, or in Settings), to read the transaction table on those pages and enable the side panel there. Users can remove it in Settings.
- **Host permission `https://rest.budgetbakers.com/*`**: Needed to call the official Wallet REST API to look up existing records, accounts, categories and rules, create new records, update an existing record's note, payer/payee, date or amount sign only when the user presses the matching button, and delete records only when the user asks: the ones the extension itself just created (Undo), or one Wallet record the bank page doesn't show, after the user confirms (Delete).
- **Keyboard shortcut (commands)**: Optional Alt+Shift+W to open the panel; it needs no extra permission.

## Test instructions (for the reviewer)
The supported banks need a login, so reviewers should use the built-in demo:
> The supported bank pages need a login, so please use the built-in demo. 1) Click the toolbar icon on any page; a "not supported" popup appears. 2) Click the cog, turn off "Only open on supported sites" and Save settings. 3) Click the icon again; the side panel opens. 4) Press "Demo data" for fake accounts and transactions. Add, Undo, Fix and Delete only pretend; nothing is sent. "Exit demo" leaves the demo. No account or API key is needed.

## Remote code
No. All code, including the font, is bundled in the package.

## Data usage disclosures (Privacy practices tab)
- Collects: **Financial and payment information** (transaction date, description and amount, the account balance shown, and the name and last four digits of the bank account shown) and **Authentication information** (the user's own Wallet API token).
- Not sold, not used for unrelated purposes, not used for creditworthiness or lending.
- Certify all three Limited Use statements.
- Privacy policy URL: https://github.com/Atsukio/bank-to-wallet-sync/blob/main/PRIVACY.md

## Assets in this folder
- `screenshot-1-review.png`, `screenshot-2-duplicates.png`, `screenshot-3-settings.png`: 1280×800 (upload 1–5)
- `promo-small-440x280.png`: small promo tile (440×280)
- `marquee-1400x560.png`: marquee promo tile (1400×560, optional, used if the store features the extension)
- Store icon: `icons/icon-128.png`
- Regenerate all of them with `npm run screenshots`.

All screenshots use the built-in synthetic demo data. No real bank or Wallet data is shown.
