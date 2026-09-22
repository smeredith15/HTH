import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExport, serializeExport, parseImport, mergeStore, planImport,
  exportFilename, exportAge, ImportError, STORES,
  encodeBlobRows, decodeBlobRows, hollowBlobRows, BLOB_MARKER,
} from '../app/store/backup.js';
import { newArtwork } from '../app/store/schema.js';
import { SEED_ARTWORKS, SEED_LISTINGS } from '../app/store/seed.js';
import { DEFAULT_SETTINGS } from '../app/store/settings.js';

const FULL = {
  settings: { ...DEFAULT_SETTINGS, target_hourly: 30 },
  artworks: SEED_ARTWORKS,
  listings: SEED_LISTINGS,
  sales: [{ id: 's1', artwork_id: 'moose', gross_price: 250, date: '2026-05-01' }],
  customers: [{ id: 'c1', name: 'A Friend', relationship: 'friend' }],
  commissions: [{ id: 'k1', customer_id: 'c1', status: 'in_progress' }],
  expenses: [{ id: 'e1', date: '2026-04-02', amount: 62.4, category: 'wood' }],
  snapshots: [{ id: '2026-08', month: '2026-08', visits: 120 }],
  backlog: [{ id: 'b1', text: 'relist the flag', done: false }],
  images_blobs: [],
};

test('export → import is lossless', () => {
  const json = serializeExport(FULL);
  const back = parseImport(json);
  assert.deepEqual(back.settings, FULL.settings);
  for (const store of STORES) {
    assert.deepEqual(back[store], FULL[store] ?? [], `${store} survived the round trip`);
  }
  assert.equal(back.artworks.length, 61);
});

test('the export filename follows §4.2', () => {
  assert.equal(
    exportFilename(new Date('2026-09-22T14:00:00Z')),
    'hightide-private-2026-09-22.json',
  );
});

test('the export carries every store, even the empty ones', () => {
  const payload = buildExport({ settings: {} });
  for (const store of STORES) assert.deepEqual(payload[store], []);
  assert.equal(payload.format, 'hightide-private');
});

test('a file from the wrong app is refused with a readable message', () => {
  assert.throws(() => parseImport('{"format":"something-else"}'), ImportError);
  assert.throws(() => parseImport('not json at all'), ImportError);
  assert.throws(
    () => parseImport(JSON.stringify({ format: 'hightide-private', version: 99 })),
    /newer version/,
  );
  assert.throws(
    () => parseImport(JSON.stringify({ format: 'hightide-private', version: 1, artworks: {} })),
    /should be a list/,
  );
});

// Phone is the device of record and the desktop imports from it, so the merge
// has to survive both sides having been edited.
test('merge keeps the newer edit of each record', () => {
  const mine = newArtwork({ id: 'moose', title: 'Moose', updated_at: '2026-09-01T00:00:00Z' });
  const theirs = { ...mine, title: 'Scorched wood moose', updated_at: '2026-09-20T00:00:00Z' };
  const result = mergeStore([mine], [theirs]);
  assert.deepEqual(result.updated, ['moose']);
  assert.equal(result.rows[0].title, 'Scorched wood moose');
});

test('merge does not let a stale file overwrite newer work', () => {
  const mine = newArtwork({ id: 'moose', title: 'Fresh', updated_at: '2026-09-20T00:00:00Z' });
  const theirs = { ...mine, title: 'Stale', updated_at: '2026-09-01T00:00:00Z' };
  const result = mergeStore([mine], [theirs]);
  assert.deepEqual(result.unchanged, ['moose']);
  assert.equal(result.rows[0].title, 'Fresh');
});

test('merge adds records the other device has not seen', () => {
  const theirs = newArtwork({ id: 'blue-crab', title: 'Blue crab' });
  const result = mergeStore([], [theirs]);
  assert.deepEqual(result.added, ['blue-crab']);
});

test('a divergent edit with no usable timestamp is reported, not silently picked', () => {
  const result = mergeStore(
    [{ id: 'x', title: 'mine' }],
    [{ id: 'x', title: 'theirs' }],
  );
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].id, 'x');
  assert.equal(result.rows[0].title, 'mine', 'the local copy is kept until Scott decides');
});

test('replace mode takes the file wholesale', () => {
  const current = { artworks: [newArtwork({ id: 'keep-me', title: 'Keep me' })] };
  const incoming = parseImport(serializeExport(FULL));
  const plan = planImport(current, incoming, { mode: 'replace' });
  assert.equal(plan.stores.artworks.rows.length, 61);
  assert.equal(plan.stores.artworks.rows.some((a) => a.id === 'keep-me'), false);
});

test('merge mode keeps local records the file does not mention', () => {
  const current = { artworks: [newArtwork({ id: 'keep-me', title: 'Keep me' })] };
  const incoming = parseImport(serializeExport(FULL));
  const plan = planImport(current, incoming, { mode: 'merge' });
  assert.equal(plan.stores.artworks.rows.some((a) => a.id === 'keep-me'), true);
  assert.equal(plan.stores.artworks.rows.length, 62);
});

// --- photographs (the part that cannot be replaced) ------------------------

// JSON.stringify(blob) is `{}`, silently. An export written without encoding
// carried every photo's id and none of its pixels.
test('a raw Blob does not survive JSON at all', () => {
  const row = { id: 'a-web', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) };
  assert.deepEqual(JSON.parse(JSON.stringify(row)).blob, {}, 'this is the bug');
});

test('encoded photo bytes survive the round trip exactly', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 64]);
  const rows = await encodeBlobRows([{ id: 'a-web', artwork_id: 'blue-crab', blob: new Blob([bytes], { type: 'image/jpeg' }) }]);
  assert.equal(rows[0].blob[BLOB_MARKER], true);
  assert.equal(rows[0].blob.type, 'image/jpeg');

  const back = decodeBlobRows(JSON.parse(JSON.stringify(rows)));
  assert.ok(back[0].blob instanceof Blob);
  assert.equal(back[0].blob.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await back[0].blob.arrayBuffer()), bytes);
  assert.equal(back[0].artwork_id, 'blue-crab', 'the other fields come through untouched');
});

test('a whole export carries its photographs', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const data = {
    settings: {},
    images_blobs: await encodeBlobRows([{ id: 'straight_on-web', blob: new Blob([bytes]) }]),
  };
  const back = parseImport(serializeExport(data));
  assert.equal(back.images_blobs.length, 1);
  assert.ok(back.images_blobs[0].blob instanceof Blob);
  assert.deepEqual(new Uint8Array(await back.images_blobs[0].blob.arrayBuffer()), bytes);
  assert.deepEqual(back.hollowPhotos, []);
});

test('an export written by the broken version is caught, not imported', () => {
  const broken = JSON.stringify({
    format: 'hightide-private', version: 1,
    images_blobs: [{ id: 'a-web', blob: {} }, { id: 'a-thumb', blob: {} }],
  });
  const back = parseImport(broken);
  assert.equal(back.hollowPhotos.length, 2, 'both hollow rows are reported');
});

test('hollowBlobRows can tell a real photo from an empty one', () => {
  const rows = [
    { id: 'good', blob: { [BLOB_MARKER]: true, data: 'AAA=', type: 'image/jpeg' } },
    { id: 'live', blob: new Blob(['x']) },
    { id: 'hollow', blob: {} },
    { id: 'missing' },
  ];
  assert.deepEqual(hollowBlobRows(rows).map((r) => r.id), ['hollow', 'missing']);
});

test('a records-only export leaves photographs out, and says so', () => {
  const data = { settings: {}, artworks: SEED_ARTWORKS, images_blobs: [{ id: 'a-web', blob: {} }] };
  const payload = buildExport(data, { photos: false });
  assert.deepEqual(payload.images_blobs, []);
  assert.equal(payload.photos, false);
  assert.equal(payload.artworks.length, 61, 'the records are all still there');
  assert.match(exportFilename(new Date('2026-09-22T00:00:00Z'), { photos: false }), /records-only/);
});

test('importing a records-only file never deletes photographs', () => {
  const current = { images_blobs: [{ id: 'keep-web' }, { id: 'keep-thumb' }], artworks: [] };
  const incoming = parseImport(serializeExport({ settings: {}, artworks: SEED_ARTWORKS }, { photos: false }));

  for (const mode of ['merge', 'replace']) {
    const plan = planImport(current, incoming, { mode });
    assert.equal(plan.photos, false);
    assert.deepEqual(
      plan.stores.images_blobs.rows.map((r) => r.id), ['keep-web', 'keep-thumb'],
      `${mode} must not wipe photos a records-only file says nothing about`,
    );
  }
});

test('a full export does replace photographs when told to', () => {
  const current = { images_blobs: [{ id: 'old-web' }] };
  const incoming = parseImport(serializeExport({ settings: {}, images_blobs: [{ id: 'new-web' }] }));
  const plan = planImport(current, incoming, { mode: 'replace' });
  assert.deepEqual(plan.stores.images_blobs.rows.map((r) => r.id), ['new-web']);
});

test('the last-exported warning fires at 14 days (§4.2)', () => {
  const now = new Date('2026-09-22T00:00:00Z');
  assert.equal(exportAge(null, now).never, true);
  assert.equal(exportAge(null, now).stale, true);
  assert.equal(exportAge('2026-09-20T00:00:00Z', now).stale, false);
  assert.equal(exportAge('2026-09-08T00:00:00Z', now).days, 14);
  assert.equal(exportAge('2026-09-08T00:00:00Z', now).stale, true);
});
