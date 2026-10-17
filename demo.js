// Synthetic data for trying the popup without a bank login or a Wallet token. Nothing here is real, and the names are
// deliberately generic and made up (no real merchants, places, people or bank products).
// `wallet` says how the fake Wallet already knows each row:
//   'same'   = already there with the identical description
//   'manual' = entered by hand with a different description (date + amount match only)
//   'exact'  = entered by hand, same description apart from case and spacing
//   'cut'    = entered by hand, same description but cut short by Wallet
//   'wrongtype' = entered with the OPPOSITE type (an expense recorded as income)
//   'earlier'  = entered a day before the bank posted it (card purchases often post a day later)
//   absent   = genuinely new
export const DEMO_TXS = [
  { date: '2026-10-01', desc: 'RIDE SHARE TRIP A-4F2K9', amount: -18.5, wallet: 'same' },
  { date: '2026-10-01', desc: 'SALARY EXAMPLE CO OCT', amount: 4200, wallet: 'same' },
  { date: '2026-10-02', desc: 'FRESHMART SUPERMARKET', amount: -86.4, wallet: 'exact' },
  { date: '2026-10-02', desc: 'BURGER CORNER CITY MALL', amount: -23.9, wallet: 'manual', walletDesc: 'Lunch' },
  { date: '2026-10-04', desc: 'EWALLET TOP UP', amount: -50, wallet: 'manual', walletDesc: 'E-wallet' },
  { date: '2026-10-04', desc: 'CORNER CAFE MAIN STREET', amount: -5, wallet: 'same' },
  { date: '2026-10-04', desc: 'CORNER CAFE MAIN STREET', amount: -5 },
  { date: '2026-10-06', desc: 'ELECTRICITY BILL PAYMENT', amount: -142.7 },
  { date: '2026-10-06', desc: 'TRANSFER FROM JANE DOE', amount: 300 },
  { date: '2026-10-08', desc: 'ONLINE STORE ORDER 88231', amount: -64.9, wallet: 'same' },
  { date: '2026-10-09', desc: 'FUEL STATION RIVERSIDE BRANCH', amount: -70, wallet: 'cut' },
  { date: '2026-10-09', desc: 'GYM MEMBERSHIP-E24 :009/024', amount: -249.96, wallet: 'wrongtype' },
  { date: '2026-10-08', desc: 'JUICE BAR CENTRAL PARK', amount: -19.5, wallet: 'earlier', walletDesc: 'Juice' },
  { date: '2026-10-10', desc: 'CREDIT CARD REPAYMENT ONLINE', amount: -3131.27 },
  { date: '2026-10-10', desc: 'STREAMFLIX SUBSCRIPTION', amount: -55 },
];

// Fake Wallet accounts, shaped like GET /accounts (the demo "bank account" is the first).
export const DEMO_ACCOUNTS = [
  { id: 'demo-savings', name: 'Everyday Savings', currencyCode: 'MYR', balance: { currentBalance: 3482.1, currencyCode: 'MYR' } },
  { id: 'demo-card', name: 'Visa Credit Card', currencyCode: 'MYR', balance: { currentBalance: -12252.42, currencyCode: 'MYR' } },
  { id: 'demo-cash', name: 'Cash', currencyCode: 'MYR', balance: { currentBalance: 120, currencyCode: 'MYR' } },
];

// What the demo "bank page" shows as its balance (a little above the demo Wallet balance, so Adjust has something to do).
export const DEMO_BANK_BALANCE = { label: 'Current Balance', amount: 3500 };

// Fake category list for the per-row picker, shaped like listCategories().
export const DEMO_CATEGORIES = [
  { id: 'demo-bills', name: 'Bills & Utilities', group: 'Housing' },
  { id: 'demo-ent', name: 'Entertainment', group: 'Life & Entertainment' },
  { id: 'demo-health', name: 'Health & beauty', group: 'Life & Entertainment' },
  { id: 'demo-food', name: 'Food & Drinks', group: 'Food & Drinks' },
  { id: 'demo-income', name: 'Income', group: 'Income' },
  { id: 'demo-shopping', name: 'Shopping', group: 'Shopping' },
  { id: 'demo-transport', name: 'Transportation', group: 'Transportation' },
];

// A transfer rule the demo "user" has set up: card repayments become transfers to the card.
export const DEMO_TRANSFER_RULES = [{ keyword: 'repayment', accountId: 'demo-card' }];

// Wallet records that match nothing above, so the list of existing records isn't only the ones we expect.
const DEMO_OTHER = [
  { date: '2026-10-06', amount: 9.9, type: 'expense', desc: 'Parking' },
  { date: '2026-10-08', amount: 12, type: 'expense', desc: 'Coffee' },
];

// Fake Wallet categorisation rules, shaped like GET /record-rules.
export const DEMO_RULES = [
  { keywords: ['ride share', 'fuel station'], category: { id: 'demo-transport', name: 'Transportation' } },
  { keywords: ['freshmart', 'cafe', 'burger'], category: { id: 'demo-food', name: 'Food & Drinks' } },
  { keywords: ['electricity'], category: { id: 'demo-bills', name: 'Bills & Utilities' }, labels: [{ id: 'demo-home', name: 'Home' }] },
  { keywords: ['salary'], category: { id: 'demo-income', name: 'Income' } },
];

// Past categorised Wallet records, shaped like categoryHistory(), so the demo can show a guessed category.
export const DEMO_HISTORY = [
  { texts: ['STREAMFLIX SUBSCRIPTION'], keys: ['streamflix subscription'], category: { id: 'demo-ent', name: 'Entertainment' }, type: 'expense' },
];

// Mirrors what existingRecords() returns from the real API.
export function demoRecords(txs) {
  const recs = [];
  for (const t of txs) {
    const base = { date: t.date, amount: Math.abs(t.amount), type: t.amount < 0 ? 'expense' : 'income' };
    if (t.wallet === 'same') recs.push({ ...base, desc: t.desc });
    if (t.wallet === 'manual') recs.push({ ...base, desc: t.walletDesc });
    if (t.wallet === 'exact') recs.push({ ...base, desc: t.desc.replace(/ /g, '  ').toLowerCase() });
    if (t.wallet === 'cut') recs.push({ ...base, desc: t.desc.slice(0, 20) });
    if (t.wallet === 'earlier') {
      const d = new Date(Date.parse(`${t.date}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
      recs.push({ ...base, date: d, recordDate: `${d}T05:30:00.000Z`, desc: t.walletDesc, note: t.walletDesc });
    }
    if (t.wallet === 'wrongtype') recs.push({ ...base, type: t.amount < 0 ? 'income' : 'expense', desc: t.desc });
  }
  return [...recs, ...DEMO_OTHER];
}
