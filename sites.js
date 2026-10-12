// The banks this extension can read. The scanner finds a transaction table by its Date / Description / Amount headers,
// so a bank that lays its history out as a table mostly needs an entry here plus its host in manifest.json
// (`host_permissions`), then a check against the real page. Used by background.js, popup.js and the Settings page.
export const SUPPORTED_BANKS = [
  { name: 'Maybank2u (M2U)', country: 'Malaysia', url: /^https:\/\/[^/]*maybank2u\.com\.my\// },
];

export const isSupportedUrl = (url) => SUPPORTED_BANKS.some((bank) => bank.url.test(url || ''));
