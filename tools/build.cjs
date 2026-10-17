// Builds the Chrome Web Store upload zip: dist/bank-to-wallet-sync-<manifest version>.zip
//
//   npm run build            build the zip
//   npm run build -- --clean also delete older zips in dist/
//
// The file list below is the single source of truth for what ships. The build fails if any shipped file refers to a
// local file that isn't in the list (a missing module or stylesheet would only show up after publishing otherwise).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const FILES = [
  'manifest.json', 'background.js', 'sites.js', 'changelog.js', 'whatsnew.js', 'wallet.js', 'matching.js', 'scanner.js', 'demo.js',
  'popup.html', 'popup.js', 'options.html', 'options.js', 'unsupported.html', 'unsupported.js', 'style.css',
  'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png',
  'fonts/roboto-latin.woff2', 'fonts/NOTICE.txt', 'fonts/LICENSE-Apache-2.0.txt',
];

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const problems = [];

// 1. everything listed exists
for (const f of FILES) if (!fs.existsSync(path.join(root, f))) problems.push(`listed but missing: ${f}`);

// 2. everything the manifest points at is listed
const fromManifest = [
  manifest.background?.service_worker, manifest.side_panel?.default_path, manifest.options_page,
  ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);
for (const f of fromManifest) if (!FILES.includes(f)) problems.push(`manifest.json refers to ${f}, which is not in the zip`);

// 3. everything shipped code/pages/styles import or link is listed
const local = (ref) => ref && !/^(https?:|data:|chrome|#|\/\/)/.test(ref) && !ref.includes('${');
for (const f of FILES.filter((x) => /\.(js|html|css)$/.test(x))) {
  const dir = path.posix.dirname(f);
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const refs = [
    ...[...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...src.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
    ...[...src.matchAll(/popup:\s*[^'"\n]*['"]([^'"]+\.html)['"]/g)].map((m) => m[1]),
    ...[...src.matchAll(/path:\s*['"]([^'"]+\.html)['"]/g)].map((m) => m[1]),
  ].filter(local);
  for (const ref of refs) {
    const target = path.posix.normalize(path.posix.join(dir, ref.replace(/^\.\//, '')));
    if (!FILES.includes(target)) problems.push(`${f} refers to ${ref}, which is not in the zip`);
  }
}

if (problems.length) {
  console.error('Build stopped:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const name = `bank-to-wallet-sync-${manifest.version}.zip`;
const out = path.join(dist, name);
if (process.argv.includes('--clean')) for (const f of fs.readdirSync(dist)) if (f.endsWith('.zip') && f !== name) fs.rmSync(path.join(dist, f));
fs.rmSync(out, { force: true });

// A real zip, written here so the build needs no external tool (Git's tar, for one, silently writes a plain tar archive
// when asked for a .zip, which the Web Store rejects). Forward-slash paths, deflate, standard headers.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function makeZip(entries) { // entries: [{ name, data: Buffer, mtime: Date }]
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const { time, date } = dosTime(mtime);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// Reads the zip back through its central directory and checks every file's CRC and contents against the source.
function verifyZip(zip, entries) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = zip.readUInt16LE(p + 10), crc = zip.readUInt32LE(p + 16), csize = zip.readUInt32LE(p + 20);
    const nlen = zip.readUInt16LE(p + 28), elen = zip.readUInt16LE(p + 30), clen = zip.readUInt16LE(p + 32), lho = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nlen);
    const dataStart = lho + 30 + zip.readUInt16LE(lho + 26) + zip.readUInt16LE(lho + 28);
    const raw = zip.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (crc32(data) !== crc) throw new Error('CRC mismatch for ' + name);
    seen.set(name, data);
    p += 46 + nlen + elen + clen;
  }
  for (const { name, data } of entries) {
    if (!seen.has(name) || !seen.get(name).equals(data)) throw new Error('contents differ for ' + name);
    if (name.includes('\\')) throw new Error('backslash in path ' + name);
  }
  if (seen.size !== entries.length) throw new Error('unexpected number of files in the zip');
}

const entries = FILES.map((name) => ({ name, data: fs.readFileSync(path.join(root, name)), mtime: fs.statSync(path.join(root, name)).mtime }));
const zip = makeZip(entries);
verifyZip(zip, entries);
fs.writeFileSync(out, zip);
console.log('Built dist/' + name + ' (' + (zip.length / 1024).toFixed(0) + ' KB, ' + FILES.length + ' files, verified)');
