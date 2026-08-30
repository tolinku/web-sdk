/**
 * tsup names an IIFE bundle "<entry>.global.js". The dashboard hands out a
 * script tag pointing at dist/tolinku.min.js, and that is the name people paste
 * into their pages, so the file is renamed to match rather than the other way
 * round: the URL is the published contract and is already in the wild.
 *
 * The sourceMappingURL comment inside the bundle names the old file too, so it
 * is rewritten here; otherwise devtools would ask for a map that is not there.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';

const from = 'dist/tolinku.min.global.js';
const to = 'dist/tolinku.min.js';

if (!existsSync(from)) {
  console.error(`name-cdn-bundle: ${from} not found. Did the iife build run?`);
  process.exit(1);
}

for (const f of [to, `${to}.map`]) if (existsSync(f)) unlinkSync(f);

writeFileSync(to, readFileSync(from, 'utf8').replace('tolinku.min.global.js.map', 'tolinku.min.js.map'));
unlinkSync(from);

if (existsSync(`${from}.map`)) {
  const map = JSON.parse(readFileSync(`${from}.map`, 'utf8'));
  map.file = 'tolinku.min.js';
  writeFileSync(`${to}.map`, JSON.stringify(map));
  unlinkSync(`${from}.map`);
}

console.log(`name-cdn-bundle: ${to}`);
