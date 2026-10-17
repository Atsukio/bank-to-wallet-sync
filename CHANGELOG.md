# Changelog

What changed in each version of Bank to Wallet Sync. Chrome and Edge update the extension by themselves; after an update the side panel shows a short note linking here.

## 0.4.0 (unreleased)
- A short "what's new" note in the side panel after an update, with a link to this page. Dismiss it once and it stays gone.

## 0.3.0 (2026-10-16)
- **CIMB Clicks** support, including rows loaded as you scroll. The extension now asks for permission to read cimbclicks.com.my pages.
- **Balance check**: shows the bank's balance next to Wallet's. **Adjust** adds one record for the difference, after asking, and Undo removes it. On credit cards the outstanding balance is used (not the statement balance) and counted as owed.
- **Nearby dates**: a Wallet record up to 3 days earlier or later than the bank's (logged early, or created automatically) is recognised, with **Use bank date** to move it.
- **Merge notes**: keep your own note and add the bank's description, as well as Replace.
- Transfer amounts have their own colour, and each note button shows the note it will produce.

## 0.2.0 (2026-10-15)
- **Fix in Wallet** for a record saved with the wrong type (an expense saved as income).
- A Wallet note that you added details to still counts as the same transaction.
- A progress bar while the extension talks to Wallet, and buttons locked until it finishes, so nothing is sent twice.

## 0.1.2 (2026-10-13)
- Choose the Wallet account for each bank account, remembered.
- Transfers (by rule or per row), and Undo the last add for 15 minutes.
- Change a row's category; the choice is remembered for that merchant. Categories are also learned from your Wallet rules and similar past records.
- Ignore list, collecting across pages, a count on the toolbar icon, the Alt+Shift+W shortcut and a getting-started guide.
- Reads the page automatically, with switches in Settings.
- Fixes for debit/credit signs, refreshing after you return to the tab, voided records and archived accounts.
- A brighter Material Design 3 look with bundled Roboto.

## 0.1.1 (2026-10-13)
- Applies your Wallet record rules (category and labels) to new records.
- Archived accounts are left out of the account picker.
- Clicking the icon on an unsupported site explains why nothing opens.
- Material Design 3 colours, light and dark.

## 0.1.0 (2026-10-12)
- First release: reads the Maybank2u transaction table and adds new rows to BudgetBakers Wallet, skipping ones already there.
