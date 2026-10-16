// The banks this extension can read. The scanner finds a transaction table by its Date / Description / Amount (or
// Debit / Credit) headers, so a bank that lays its history out as a table mostly needs an entry here plus its host in
// manifest.json (`host_permissions`), then a check against the real page. Used by background.js, popup.js, the
// Settings page and the "not supported" popup.
export const SUPPORTED_BANKS = [
  { name: 'Maybank2u (M2U)', country: 'Malaysia', host: 'maybank2u.com.my', url: /^https:\/\/[^/]*maybank2u\.com\.my\// },
  { name: 'CIMB Clicks', country: 'Malaysia', host: 'cimbclicks.com.my', url: /^https:\/\/[^/]*cimbclicks\.com\.my\// },
];

export const isSupportedUrl = (url) => SUPPORTED_BANKS.some((bank) => bank.url.test(url || ''));
