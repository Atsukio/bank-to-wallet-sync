// What users see in the "What's new" card after an update (whatsnew.js), newest first. Write each item for users:
// what they'll notice, in a plain sentence, no internals. Add the entry in the same commit as the version bump;
// a release without an entry updates quietly.
export const CHANGELOG = [
  {
    version: '0.8.0',
    items: [
      'Type to find a category when you change one, instead of scrolling a long list.',
      'Change and the transfer button open on the first click, instead of sometimes closing straight away.',
      'The transfer button says "Transfer to" for money out and "Transfer from" for money in.',
      'Rows already in Wallet are easier to read, and checkboxes and buttons are bigger and easier to hit.',
    ],
  },
  {
    version: '0.7.0',
    items: [
      'Wallet records the bank page doesn\'t show yet are listed as "Not in Bank", and you can delete one that was entered twice or on the wrong account.',
      'The balance check is clearer: Wallet and Bank side by side, an arrow showing whether Wallet is higher or lower, and what on the page explains the difference.',
      'Undo only shows on the page you added from, and goes away when you reload or leave it.',
    ],
  },
  {
    version: '0.6.0',
    items: [
      'Merge, Replace, Fix and Use bank date no longer lock the panel: click as many as you like and they\'re sent in the background.',
      'The select-all bar and Add to Wallet stay in view while you scroll a long list.',
      'Colours now show at a glance what\'s new, what\'s likely already in Wallet, and what needs a look.',
      'A long account name under the picker is shortened, keeping the last four digits visible.',
    ],
  },
  {
    version: '0.3.0',
    items: [
      'Works with CIMB Clicks too, including transactions that load as you scroll.',
      'Shows the bank\'s balance next to Wallet\'s, and Adjust adds one record for any difference (after asking, and you can undo it).',
      'Spots a Wallet record logged a few days before or after the bank\'s date, and can move it to the bank\'s date.',
      'Merge notes keeps your own note and adds the bank\'s description to it.',
      'Transfers have their own colour, and the note buttons show what the note will become.',
    ],
  },
];

// Compares 'X.Y.Z' versions part by part as numbers ('0.10.0' is newer than '0.9.0'). Negative when a is older.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// The entries a user updating from `from` to `to` hasn't seen: newer than `from`, not newer than `to`, newest first.
export const changesSince = (from, to, log = CHANGELOG) =>
  log.filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
