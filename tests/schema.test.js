import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, uniqueId, newArtwork, deriveRightsAnswer, effectiveRights,
  printLimits, completeness, hasUsableMaster, isGone,
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
