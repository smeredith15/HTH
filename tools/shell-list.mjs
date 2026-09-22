// Build the service worker's precache list: every file the app needs to start
// with no network. There is no build step (SPEC §3), so this writes a file
// that is committed, and tests/pwa.test.js fails if it has gone stale.
//
//   node tools/shell-list.mjs          print it
//   node tools/shell-list.mjs --write  rewrite sw-shell.json

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Follow every relative import from the entry point. */
export function moduleGraph(entry = 'app/main.js') {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const full = join(ROOT, rel);
    if (!existsSync(full)) continue;
    seen.add(rel);
    const source = readFileSync(full, 'utf8');
    const specs = [
      ...source.matchAll(/\bimport\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\bexport\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      queue.push(relative(ROOT, resolve(dirname(full), spec)).split('\\').join('/'));
    }
  }
  return [...seen].sort();
}

function filesIn(dir) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => !name.startsWith('.') && statSync(join(full, name)).isFile())
    .map((name) => `${dir}/${name}`)
    .sort();
}

export function shellList() {
  return [
    './',
    'index.html',
    '404.html',
    'styles/app.css',
    'manifest.webmanifest',
    ...moduleGraph(),
    ...filesIn('app/vendor'),
    ...filesIn('icons'),
  ];
}

export const SHELL_PATH = join(ROOT, 'sw-shell.json');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = shellList();
  if (process.argv.includes('--write')) {
    writeFileSync(SHELL_PATH, `${JSON.stringify(list, null, 2)}\n`);
    console.log(`wrote sw-shell.json — ${list.length} files`);
  } else {
    console.log(list.join('\n'));
  }
}
