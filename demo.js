// Synthetic data for trying the popup without a Maybank login or a Wallet token. Nothing here is real.
// `wallet` says how the fake Wallet already knows each row:
//   'same'   = already there with the identical description
//   'manual' = entered by hand with a different description (date + amount match only)
//   'exact'  = entered by hand, same description apart from case and spacing
//   'cut'    = entered by hand, same description but cut short by Wallet
//   absent   = genuinely new
export const DEMO_TXS = [
  { date: '2026-10-01', desc: 'GRAB* A-4F2K9 KUALA LUMPUR MY', amount: -18.5, wallet: 'same' },
  { date: '2026-10-01', desc: 'SALARY ACME SDN BHD OCT', amount: 4200, wallet: 'same' },
  { date: '2026-10-02', desc: 'TESCO EXTRA CHERAS', amount: -86.4, wallet: 'exact' },
  { date: '2026-10-02', desc: 'MCDONALDS PAVILION KL', amount: -23.9, wallet: 'manual', walletDesc: 'Lunch' },
  { date: '2026-10-04', desc: 'TNG EWALLET RELOAD', amount: -50, wallet: 'manual', walletDesc: 'TNG' },
  { date: '2026-10-04', desc: 'STARBUCKS MID VALLEY', amount: -5, wallet: 'same' },
  { date: '2026-10-04', desc: 'STARBUCKS MID VALLEY', amount: -5 },
  { date: '2026-10-06', desc: 'TENAGA NASIONAL BERHAD BILL', amount: -142.7 },
  { date: '2026-10-06', desc: 'IBG TRANSFER FROM JANE TAN', amount: 300 },
  { date: '2026-10-08', desc: 'SHOPEE MALAYSIA ORDER 88231', amount: -64.9, wallet: 'same' },
  { date: '2026-10-09', desc: 'PETRONAS SETIA ALAM SELANGOR MY', amount: -70, wallet: 'cut' },
  { date: '2026-10-10', desc: 'NETFLIX.COM', amount: -55 },
];

// Wallet records that match nothing above, so the list of existing records isn't only the ones we expect.
const DEMO_OTHER = [
  { date: '2026-10-06', amount: 9.9, type: 'expense', desc: 'Parking' },
  { date: '2026-10-08', amount: 12, type: 'expense', desc: 'Teh tarik' },
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
  }
  return [...recs, ...DEMO_OTHER];
}
