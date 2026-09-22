import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function jsFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

function importSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bimport\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bexport\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) specs.push(match[1]);
  }
  return specs;
}

// SPEC §9.2: kiosk mode reads only data/catalog.json and images/. It must not
// be able to reach the private IndexedDB store even when both live on the same
// tablet. This is a standing guard — it has to keep passing as Phase 4 fills
// app/kiosk/ in.
test('no kiosk or public module can reach the private store', () => {
  const guarded = [join(ROOT, 'app/kiosk'), join(ROOT, 'app/public')];
  const offenders = [];
  for (const dir of guarded) {
    for (const file of jsFilesUnder(dir)) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (/(^|\/)store\//.test(spec) || /\/db\.js$/.test(spec)) {
          offenders.push(`${relative(ROOT, file)} imports ${spec}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'kiosk and public code must not import app/store/');
});

test('the private store is never reached by a bare global either', () => {
  const guarded = [join(ROOT, 'app/kiosk'), join(ROOT, 'app/public')];
  const offenders = [];
  for (const dir of guarded) {
    for (const file of jsFilesUnder(dir)) {
      const source = readFileSync(file, 'utf8');
      if (/\bindexedDB\b/.test(source)) offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], 'kiosk and public code must not touch indexedDB directly');
});

test('the guarded directories exist so this test is not silently vacuous', () => {
  assert.ok(existsSync(join(ROOT, 'app/kiosk')), 'app/kiosk/ is missing');
  assert.ok(existsSync(join(ROOT, 'app/public')), 'app/public/ is missing');
});
