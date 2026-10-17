// What users see in the "What's new" card after an update (whatsnew.js), newest first. Write each item for users:
// what they'll notice, in a plain sentence, no internals. Add the entry in the same commit as the version bump;
// a release without an entry updates quietly.
export const CHANGELOG = [
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
