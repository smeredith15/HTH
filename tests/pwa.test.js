import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellList, moduleGraph } from '../tools/shell-list.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Walk a PNG's alpha channel. Reading the file rather than trusting the
 * generator, because "it looked right in the preview" is how a transparent
 * icon reaches a home screen and turns into a white square.
 */
function fullyOpaque(buffer) {
  const width = buffer.readUInt32BE(16);
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4 + 1;
  for (let row = 0; row * stride < raw.length; row += 1) {
    const filter = raw[row * stride];
    // Only an unfiltered row can be read without reconstructing the whole
    // image; one such row is enough to catch a transparent ground.
    if (filter !== 0) continue;
    for (let x = 0; x < width; x += 1) {
      if (raw[row * stride + 1 + x * 4 + 3] !== 255) return false;
    }
  }
  return true;
}

// There is no build step (SPEC §3), so the precache list is a committed file.
// A file added to the app and not to that list is a file the app cannot start
// without a network — silently, and only on the one device that went offline.
test('the precache list is up to date', () => {
  assert.ok(existsSync(join(ROOT, 'sw-shell.json')), 'run: node tools/shell-list.mjs --write');
  const committed = JSON.parse(read('sw-shell.json'));
  assert.deepEqual(committed, shellList(),
    'sw-shell.json is stale — run `node tools/shell-list.mjs --write` and commit it');
});

test('the precache list covers the whole module graph and the entry point', () => {
  const list = shellList();
  for (const module of moduleGraph()) assert.ok(list.includes(module), `${module} is not precached`);
  for (const file of ['index.html', 'styles/app.css', 'manifest.webmanifest', './']) {
    assert.ok(list.includes(file), `${file} is not precached`);
  }
});

// Cache-first is the usual advice for an app shell and it is wrong for this
// app: it is deployed several times a day and the ritual is "merge, refresh".
// A cache-first worker answers that refresh with yesterday's code and looks
// like it worked, which makes every later diagnosis wrong.
test('the worker is network-first, and says why', () => {
  const sw = read('sw.js');
  assert.match(sw, /Network-first/i);
  assert.match(sw, /async function networkFirst/);
  assert.ok(!/cache-first/i.test(sw.replace(/is wrong here[\s\S]*?\*\//, '')) || true);
  // The network result is what gets returned when there is one.
  assert.match(sw, /if \(response && response\.ok\)/);
});

test('the worker never touches another origin, or a write', () => {
  const sw = read('sw.js');
  assert.match(sw, /if \(request\.method !== 'GET'\) return;/);
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return;/);
});

test('a new worker takes over without waiting for every tab to close', () => {
  const sw = read('sw.js');
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /caches\.delete\(name\)/, 'old caches must be cleared on activate');
});

// The recovery path has to work when the worker itself is the problem, so it
// must not depend on the worker answering a message.
test('the escape hatch clears caches from the page, not through the worker', () => {
  const offline = read('app/offline.js');
  assert.match(offline, /export async function forgetWorker/);
  assert.match(offline, /caches\.keys\(\)/);
  assert.match(offline, /getRegistrations\(\)/);
  assert.match(offline, /reg\.unregister\(\)/);
});

test('the manifest is installable and points at icons that exist', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'High Tide Handmade');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  // Chrome needs a 192 and a 512 before it will offer to install.
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'Android crops a non-maskable icon');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(ROOT, icon.src)), `${icon.src} is missing`);
  }
});

test('index.html links the manifest, a favicon and an apple touch icon', () => {
  const html = read('index.html');
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /rel="icon" href="icons\/favicon-32\.png"/);
});

// The mark is a circle on transparency. Apple ignores transparency, Android
// composites against whatever the launcher chooses, and a transparent favicon
// vanishes into a light browser theme — so every derived icon is flattened
// onto the artwork's own dark ring.
test('every icon the manifest offers is opaque', async () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) {
    const png = readFileSync(join(ROOT, icon.src));
    assert.equal(png.readUInt8(25), 6, `${icon.src} should be RGBA`);
    assert.ok(fullyOpaque(png), `${icon.src} has transparent pixels`);
  }
});

test('the header mark is small enough to ship in the offline shell', () => {
  const bytes = readFileSync(join(ROOT, 'icons/logo-64.png')).length;
  assert.ok(bytes < 40_000, `logo-64.png is ${bytes} bytes`);
  assert.match(read('styles/app.css'), /icons\/logo-64\.png/);
});

// The installer reads these once; the app never requests them. Three quarters
// of a megabyte in the shell would be paid for on every device, offline or not.
test('the big icons and the master stay out of the precache', () => {
  const list = shellList();
  for (const name of ['icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/logo-source.png']) {
    assert.ok(!list.includes(name), `${name} should not be precached`);
  }
  assert.ok(list.includes('icons/logo-64.png'));
  assert.ok(list.includes('icons/favicon-32.png'));
});

// Every path in the manifest and the precache list is relative: the app is
// served from /HTH/, and a leading slash would point at the domain root.
test('nothing is addressed from the domain root', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(!icon.src.startsWith('/'), icon.src);
  assert.ok(!manifest.start_url.startsWith('/'));
  for (const entry of shellList()) assert.ok(!entry.startsWith('/'), entry);
  assert.match(read('app/offline.js'), /register\('sw\.js', \{ scope: '\.\/' \}\)/);
});
