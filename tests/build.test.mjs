// The Web Store zip: a real zip, with everything the extension needs and nothing it doesn't.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { check, finish, ROOT } from './helpers.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const run = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.cjs')], { cwd: ROOT, encoding: 'utf8' });
check('build succeeds (every referenced file is in the zip)', run.status === 0, run.stderr || run.stdout);

const file = path.join(ROOT, 'dist', `bank-to-wallet-sync-${manifest.version}.zip`);
check('zip is named after the manifest version', fs.existsSync(file), file);
const zip = fs.readFileSync(file);
check('it is a real zip (starts with PK), not a tar archive', zip.subarray(0, 2).toString() === 'PK');

// list the entries through the central directory
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const count = zip.readUInt16LE(eocd + 10);
let p = zip.readUInt32LE(eocd + 16);
const names = [];
const contents = new Map();
for (let i = 0; i < count; i++) {
  const nlen = zip.readUInt16LE(p + 28), elen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32), lho = zip.readUInt32LE(p + 42);
  const name = zip.toString('utf8', p + 46, p + 46 + nlen);
  const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20);
  const start = lho + 30 + zip.readUInt16LE(lho + 26) + zip.readUInt16LE(lho + 28);
  const raw = zip.subarray(start, start + csize);
  names.push(name);
  contents.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
  p += 46 + nlen + elen + clen;
}
check('manifest.json is at the root with forward-slash paths', names.includes('manifest.json') && names.every((n) => !n.includes('\\')));
check('the zipped manifest matches the source', contents.get('manifest.json').toString() === fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
for (const must of ['background.js', 'popup.html', 'popup.js', 'options.html', 'unsupported.html', 'unsupported.js', 'sites.js', 'matching.js', 'wallet.js', 'scanner.js', 'style.css', 'fonts/roboto-latin.woff2', 'fonts/LICENSE-Apache-2.0.txt']) {
  check(`zip contains ${must}`, names.includes(must));
}
check('development files stay out (tests, tools, node_modules, store assets, docs)', !names.some((n) => /^(tests|tools|node_modules|store|dist|\.github)\//.test(n) || /(\.md|package\.json|package-lock\.json)$/.test(n)));
check('the manifest description fits the Web Store limit (132 characters)', manifest.description.length <= 132, String(manifest.description.length));
// the reviewer note is the quoted line under "Test instructions" in the listing
const listing = fs.readFileSync(path.join(ROOT, 'store/LISTING.md'), 'utf8');
const testNote = (listing.split(/^## Test instructions.*$/m)[1] || '').match(/^> (.+)$/m)?.[1] || '';
check('the reviewer test instructions fit the Web Store limit (500 characters)', testNote.length > 0 && testNote.length <= 500, String(testNote.length));
check('the manifest only asks for the permissions it needs', JSON.stringify(manifest.permissions.slice().sort()) === JSON.stringify(['activeTab', 'scripting', 'sidePanel', 'storage']), JSON.stringify(manifest.permissions));
const { SUPPORTED_BANKS } = await import(new URL('../sites.js', import.meta.url).href);
const allowedHosts = [...SUPPORTED_BANKS.map((b) => b.host), 'rest.budgetbakers.com'];
const required = manifest.host_permissions, optional = manifest.optional_host_permissions || [];
check('host access is limited to the supported banks and the Wallet API', [...required, ...optional].every((h) => allowedHosts.some((host) => h.includes(host))), JSON.stringify([required, optional]));
check('every supported bank\'s origin is in the manifest: required banks in host_permissions, optional ones in optional_host_permissions',
  SUPPORTED_BANKS.every((b) => (b.optional ? optional : required).includes(b.origin) && !(b.optional ? required : optional).includes(b.origin)));
// A new required host would disable the extension for existing users until they accept it (see sites.js).
check('required hosts are only the ones existing users already granted (Maybank2u and the Wallet API)', JSON.stringify(required.slice().sort()) === JSON.stringify(['https://*.maybank2u.com.my/*', 'https://rest.budgetbakers.com/*']), JSON.stringify(required));
check('no remote code or analytics hosts anywhere in the shipped scripts', ![...contents].filter(([n]) => n.endsWith('.js') || n.endsWith('.html')).some(([, c]) => /https?:\/\/(?!rest\.budgetbakers\.com|www\.maybank|[^'"\s]*maybank2u|localhost|schema|\*\.)/.test(c.toString().replace(/https:\/\/github\.com\/[^\s'")]+|https:\/\/rest\.budgetbakers\.com[^\s'")]*|\/\^https[^\n]*/g, ''))));

finish();
