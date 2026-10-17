// The banks this extension can read. The scanner finds a transaction table by its Date / Description / Amount (or
// Debit / Credit) headers, so a bank that lays its history out as a table mostly needs an entry here plus its origin
// in manifest.json, then a check against the real page. Used by background.js, popup.js, the Settings page and the
// "not supported" popup.
//
// Banks added after the first release are `optional`: their origin is in `optional_host_permissions` and the user
// grants it when they first use that bank (the "not supported" popup, the side panel or Settings ask). A new required
// host permission would disable the extension for every existing user until they accepted it.
export const SUPPORTED_BANKS = [
  { name: 'Maybank2u (M2U)', country: 'Malaysia', host: 'maybank2u.com.my', origin: 'https://*.maybank2u.com.my/*', url: /^https:\/\/[^/]*maybank2u\.com\.my\// },
  { name: 'CIMB Clicks', country: 'Malaysia', host: 'cimbclicks.com.my', origin: 'https://*.cimbclicks.com.my/*', url: /^https:\/\/[^/]*cimbclicks\.com\.my\//, optional: true },
];

export const bankFor = (url) => SUPPORTED_BANKS.find((bank) => bank.url.test(url || ''));
export const isSupportedUrl = (url) => !!bankFor(url);

// Whether the extension may read this bank's pages. Required banks always may.
export async function hasAccess(bank) {
  if (!bank?.optional) return !!bank;
  try { return await chrome.permissions.contains({ origins: [bank.origin] }); } catch { return false; }
}

// Must run in a click handler (Chrome only shows the prompt for a user gesture). True if access was granted.
export async function requestAccess(bank) {
  try { return await chrome.permissions.request({ origins: [bank.origin] }); } catch { return false; }
}
