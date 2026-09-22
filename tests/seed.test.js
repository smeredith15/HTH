import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_ARTWORKS, SEED_LISTINGS, SEED_BACKLOG, SEED_AT } from '../app/store/seed.js';
import {
  CATEGORY, ARTWORK_STATUS, DISPOSITION, SUBSTRATE, SHAPE, TECHNIQUE,
  RIGHTS_FLAG, VISIBILITY, effectiveRights, printLimits, hasUsableMaster, isGone,
} from '../app/store/schema.js';

test('every Appendix A artwork loads', () => {
  assert.equal(SEED_ARTWORKS.length, 61, 'A.1 9 + A.2 23 + A.3 11 + A.4 18');
  assert.equal(SEED_LISTINGS.length, 10);
  assert.equal(SEED_BACKLOG.length, 11, 'Appendix B.8 backlog');
});

// A device that re-seeds must not look like it just edited all 61 pieces, or
// the merge import in backup.js would let the seed overwrite real work.
test('seed records carry the hand-off date, not the moment they loaded', () => {
  for (const rows of [SEED_ARTWORKS, SEED_LISTINGS, SEED_BACKLOG]) {
    for (const row of rows) {
      assert.equal(row.updated_at, SEED_AT, `${row.id} updated_at`);
      assert.equal(row.created_at, SEED_AT, `${row.id} created_at`);
    }
  }
  assert.ok(Date.parse(SEED_AT) < Date.now(), 'the seed date is in the past');
});

test('ids are unique and slug-shaped', () => {
  const ids = SEED_ARTWORKS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${id} is a clean slug`);
});

test('every enum value is one the schema knows', () => {
  for (const a of SEED_ARTWORKS) {
    assert.ok(ARTWORK_STATUS.includes(a.status), `${a.id}: status ${a.status}`);
    assert.ok(DISPOSITION.includes(a.disposition), `${a.id}: disposition ${a.disposition}`);
    assert.ok(VISIBILITY.includes(a.visibility), `${a.id}: visibility ${a.visibility}`);
    if (a.category) assert.ok(CATEGORY.includes(a.category), `${a.id}: category ${a.category}`);
    if (a.substrate) assert.ok(SUBSTRATE.includes(a.substrate), `${a.id}: substrate ${a.substrate}`);
    if (a.shape) assert.ok(SHAPE.includes(a.shape), `${a.id}: shape ${a.shape}`);
    for (const t of a.techniques) assert.ok(TECHNIQUE.includes(t), `${a.id}: technique ${t}`);
    for (const f of a.rights.flags) assert.ok(RIGHTS_FLAG.includes(f), `${a.id}: rights flag ${f}`);
  }
});

test('only the nine currently-listed pieces seed as public', () => {
  const pub = SEED_ARTWORKS.filter((a) => a.visibility === 'public').map((a) => a.id).sort();
  assert.deepEqual(pub, [
    'cilleyville-covered-bridge', 'golf-bag', 'humpback-whale', 'longhorn-skull-flag',
    'moose', 'peace-sign-globe-ship-wheel', 'surf-van', 'toucan',
    'western-cactus-longhorn-skull',
  ]);
});

test('no sports portrait is public, and none is clear to list', () => {
  for (const a of SEED_ARTWORKS.filter((x) => x.category === 'sports')) {
    assert.equal(a.visibility, 'private', `${a.id} must not seed public`);
    const rights = effectiveRights(a.rights);
    assert.equal(rights.listing_ok, 'no', `${a.id} listing_ok`);
    assert.equal(rights.print_ok, 'no', `${a.id} print_ok`);
  }
});

test('the moose does not carry the golf bag specs (§1.1)', () => {
  const moose = SEED_ARTWORKS.find((a) => a.id === 'moose');
  const golf = SEED_ARTWORKS.find((a) => a.id === 'golf-bag');
  assert.equal(moose.width_in, 16);
  assert.equal(moose.height_in, 12);
  assert.equal(moose.substrate, 'pine');
  assert.equal(golf.width_in, 18.5);
  assert.equal(golf.height_in, 31);
  assert.equal(golf.substrate, 'birch');
});

test('Hooper Strait carries its 1,440 px master and 9.6 in limit', () => {
  const hooper = SEED_ARTWORKS.find((a) => a.id === 'hooper-strait-lighthouse');
  assert.equal(hooper.print_master.long_edge_px, 1440);
  assert.equal(hooper.print_master.print_ready, 'no');
  assert.equal(Math.round(printLimits(hooper.print_master).at150 * 10) / 10, 9.6);
});

test('the rights flags from the September review are carried over', () => {
  const byId = Object.fromEntries(SEED_ARTWORKS.map((a) => [a.id, a]));
  assert.deepEqual(
    byId['surf-van'].rights.flags.sort(),
    ['family_personal', 'trademark_or_logo'],
  );
  assert.deepEqual(byId['atlas-statue'].rights.flags, ['third_party_photo']);
  assert.deepEqual(
    byId['snoopy-snowman'].rights.flags.sort(),
    ['third_party_artwork', 'trademark_or_logo'],
  );
  assert.equal(effectiveRights(byId['blue-heeler-puppy'].rights).listing_ok, 'ask_first');
});

test('the four sold lighthouses have no print master — the lost catalog', () => {
  const lost = SEED_ARTWORKS.filter(
    (a) => a.category === 'lighthouse' && a.disposition === 'sold' && !a.print_master.exists,
  );
  assert.equal(lost.length, 4, 'two Assateague and two Cape Hatteras');
});

test('not one piece that has left the studio can be printed today (§1.1)', () => {
  const gone = SEED_ARTWORKS.filter(isGone);
  assert.ok(gone.length >= 18);
  assert.deepEqual(gone.filter(hasUsableMaster), [], 'the whole sold catalog is unreproducible');
  // Hooper Strait is the near miss: a file exists, and it is still not enough.
  const hooper = SEED_ARTWORKS.find((a) => a.id === 'hooper-strait-lighthouse');
  assert.equal(hooper.print_master.exists, true);
  assert.equal(hasUsableMaster(hooper), false);
});

test('suppression-suspected listings are flagged', () => {
  const suspect = SEED_LISTINGS.filter((l) => l.suppression_suspected).map((l) => l.artwork_id);
  assert.deepEqual(suspect.sort(), ['longhorn-skull-flag', 'surf-van']);
});

test('every listing points at a real artwork, or is the custom listing', () => {
  const ids = new Set(SEED_ARTWORKS.map((a) => a.id));
  for (const l of SEED_LISTINGS) {
    if (l.artwork_id === null) {
      assert.equal(l.listing_type, 'custom');
      continue;
    }
    assert.ok(ids.has(l.artwork_id), `listing ${l.id} → missing artwork ${l.artwork_id}`);
  }
});
