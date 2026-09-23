import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, uniqueId, newArtwork, deriveRightsAnswer, effectiveRights,
  printLimits, completeness, hasUsableMaster, isGone,
  recoverableFromPhoto, trulyLost, RECOVERABLE_LONG_EDGE,
  PUBLIC_ARTWORK_FIELDS, PRIVATE_ARTWORK_FIELDS,
} from '../app/store/schema.js';

test('slugify makes readable ids', () => {
  assert.equal(slugify('Hooper Strait Lighthouse'), 'hooper-strait-lighthouse');
  assert.equal(slugify("Jack-o'-lantern and gourds"), 'jack-o-lantern-and-gourds');
  assert.equal(slugify('   '), 'untitled');
});

test('uniqueId suffixes collisions', () => {
  assert.equal(uniqueId('moose', new Set(['moose'])), 'moose-2');
  assert.equal(uniqueId('moose', new Set(['moose', 'moose-2'])), 'moose-3');
  assert.equal(uniqueId('elk', new Set(['moose'])), 'elk');
});

test('title is the only required field', () => {
  const art = newArtwork({ title: 'Blue crab' });
  assert.equal(art.title, 'Blue crab');
  assert.equal(art.id, 'blue-crab');
  assert.equal(art.visibility, 'private', 'nothing is public unless it is made public');
  for (const field of ['category', 'substrate', 'width_in', 'hours', 'asking_price']) {
    assert.equal(art[field], null, `${field} should start empty`);
  }
});

test('public and private field lists do not overlap', () => {
  const overlap = PUBLIC_ARTWORK_FIELDS.filter((f) => PRIVATE_ARTWORK_FIELDS.includes(f));
  assert.deepEqual(overlap, [], 'a field cannot be both public and private');
});

test('rights derivation follows §5.2', () => {
  assert.equal(deriveRightsAnswer(['own_design']), 'yes');
  assert.equal(deriveRightsAnswer(['own_photo_reference', 'public_domain_reference']), 'yes');
  assert.equal(deriveRightsAnswer(['customer_photo']), 'ask_first');
  assert.equal(deriveRightsAnswer(['family_personal']), 'ask_first');
  assert.equal(deriveRightsAnswer(['public_figure_likeness']), 'no');
  assert.equal(deriveRightsAnswer(['trademark_or_logo', 'own_design']), 'no', 'the strictest flag wins');
  assert.equal(deriveRightsAnswer([]), 'unknown');
});

test('an owner decision overrides the derived answer', () => {
  const r = effectiveRights({ flags: ['family_personal'], print_ok: 'yes' });
  assert.equal(r.print_ok, 'yes');
  assert.equal(r.print_ok_derived, false);
  assert.equal(r.listing_ok, 'ask_first');
  assert.equal(r.listing_ok_derived, true);
});

test('print size limits match the spec worked examples', () => {
  assert.equal(printLimits({ long_edge_px: 3600 }).at150, 24);
  const hooper = printLimits({ long_edge_px: 1440 });
  assert.equal(Math.round(hooper.at150 * 10) / 10, 9.6, 'Hooper Strait: 9.6 in at 150 DPI');
  assert.equal(hooper.at100, 14.4);
  assert.equal(printLimits({}), null);
});

test('a file that exists is not automatically a usable master', () => {
  assert.equal(hasUsableMaster({ print_master: { exists: false } }), false);
  assert.equal(hasUsableMaster({ print_master: { exists: true, print_ready: 'yes' } }), true);
  assert.equal(hasUsableMaster({ print_master: { exists: true, print_ready: 'needs_retouch' } }), true);
  // Hooper Strait: a 1,440 px file exists and still cannot produce a print.
  assert.equal(hasUsableMaster({ print_master: { exists: true, print_ready: 'no' } }), false);
  assert.equal(hasUsableMaster({}), false);
});

test('isGone covers every way a piece leaves the studio', () => {
  for (const d of ['sold', 'gifted', 'commission_delivered']) {
    assert.equal(isGone({ disposition: d }), true, d);
  }
  for (const d of ['available', 'kept', 'unknown', 'lost']) {
    assert.equal(isGone({ disposition: d }), false, d);
  }
});

test('completeness counts the fields that matter', () => {
  const empty = completeness(newArtwork({ title: 'x' }));
  assert.equal(empty.done, 0);
  assert.equal(empty.total, 7);

  const better = completeness(newArtwork({
    title: 'x', width_in: 12, height_in: 12, substrate: 'birch',
    images: [{ role: 'straight_on', alt: 'a lighthouse' }],
    rights: { flags: ['own_design'] },
  }));
  assert.equal(better.done, 5); // dimensions, substrate, straight-on, alt text, rights
  assert.equal(better.checks.find((c) => c.key === 'print_master').ok, false);
});

// --- gone, but not necessarily lost ----------------------------------------
//
// The app counted every gone piece with no registry entry as "cannot be
// reproduced". That was true while nothing had been photographed. Once eleven
// sold and gifted pieces had 4,080 px photographs attached it was telling
// their owner they were lost while holding the file that could still print
// them at 27 inches.

const sold = (patch) => newArtwork({ title: 'x', disposition: 'sold', ...patch });
const photo = (px) => ({ id: 'straight_on', role: 'straight_on', original_width_px: px, original_height_px: Math.round(px * 0.75) });

test('a big photograph makes a gone piece recoverable, not lost', () => {
  const a = sold({ images: [photo(4080)] });
  const r = recoverableFromPhoto(a);
  assert.ok(r, 'a 4,080 px photograph is a master waiting to be cropped');
  assert.equal(r.long_edge_px, 4080);
  assert.equal(r.limits.at150, 27.2);
  assert.equal(trulyLost(a), false);
  assert.equal(hasUsableMaster(a), false, 'it is still not a master, and must not pretend to be');
});

test('a small photograph is a record of the piece, not a source for one', () => {
  const a = sold({ images: [photo(1800)] });
  assert.equal(recoverableFromPhoto(a), null);
  assert.equal(trulyLost(a), true);
  assert.equal(RECOVERABLE_LONG_EDGE, 3000);
});

test('nothing on file is the only thing that is truly lost', () => {
  const a = sold({});
  assert.equal(recoverableFromPhoto(a), null);
  assert.equal(trulyLost(a), true);
});

test('a measured master is neither lost nor waiting to be cropped', () => {
  const a = sold({ images: [photo(4080)], print_master: { exists: true, long_edge_px: 6000, print_ready: 'yes' } });
  assert.equal(recoverableFromPhoto(a), null, 'it already has one');
  assert.equal(trulyLost(a), false);
});

// A master the owner marked unprintable is not usable, and the photograph
// behind it may still be the way back.
test('a master marked "no" falls back to the photograph', () => {
  const a = sold({ images: [photo(4080)], print_master: { exists: true, long_edge_px: 1200, print_ready: 'no' } });
  assert.equal(hasUsableMaster(a), false);
  assert.ok(recoverableFromPhoto(a));
});

test('a piece still in the studio is not in either list', () => {
  const a = newArtwork({ title: 'x', disposition: 'available', on_hand: true, images: [photo(4080)] });
  assert.equal(recoverableFromPhoto(a), null);
  assert.equal(trulyLost(a), false);
});
