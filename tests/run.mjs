// Runs every *.test.mjs in this folder, one after another, and fails if any of them does.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();
let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file}`);
  const { status } = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  if (status !== 0) failed++;
}
console.log(failed ? `\n${failed} of ${files.length} test files failed` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
