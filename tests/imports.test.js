import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// There is no build step (SPEC §3), so nothing checks that an import actually
// resolves until a browser hits that line at runtime — and a view that is only
// reached after three taps can stay broken for a while. `label` living in
// ui/dom.js rather than store/schema.js is exactly how that happens.

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

/**
 * Named imports, per module specifier. Default and namespace forms are
 * skipped. `{ DEFAULT_SETTINGS as S }` has two names that matter: the one the
 * module has to export, and the one the file actually uses.
 */
function namedImports(source) {
  const found = [];
  const re = /\bimport\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(re)) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [exported, local] = part.split(/\s+as\s+/).map((x) => x.trim());
        return { exported, local: local ?? exported };
      });
    found.push({ names, spec: match[2] });
  }
  return found;
}

/** Every name a module exports. */
function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const as = piece.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  return names;
}

const FILES = [...jsFilesUnder(join(ROOT, 'app')), ...jsFilesUnder(join(ROOT, 'tests'))];

test('there is something to check', () => {
  assert.ok(FILES.length > 15, `only found ${FILES.length} modules`);
});

test('every relative import resolves to a file that exists', () => {
  const broken = [];
  for (const file of FILES) {
    for (const { spec } of namedImports(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) broken.push(`${relative(ROOT, file)} → ${spec}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('every named import exists in the module it comes from', () => {
  const cache = new Map();
  const exportsOf = (path) => {
    if (!cache.has(path)) cache.set(path, exportedNames(readFileSync(path, 'utf8')));
    return cache.get(path);
  };

  const broken = [];
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    for (const { names, spec } of namedImports(source)) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) continue; // reported by the test above
      const available = exportsOf(target);
      for (const { exported } of names) {
        if (!available.has(exported)) {
          broken.push(`${relative(ROOT, file)} imports { ${exported} } from ${spec}, which does not export it`);
        }
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('nothing imports a name it never uses', () => {
  const unused = [];
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8');
    // Strip the import block itself before looking for usages.
    const body = source.replace(/\bimport\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, '');
    for (const { names } of namedImports(source)) {
      for (const { local } of names) {
        if (!new RegExp(`\\b${local}\\b`).test(body)) {
          unused.push(`${relative(ROOT, file)}: ${local}`);
        }
      }
    }
  }
  assert.deepEqual(unused, []);
});
