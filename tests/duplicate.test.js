import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newArtwork, duplicateAsNew, DUPLICABLE_FIELDS, NEVER_DUPLICATED_FIELDS,
} from '../app/store/schema.js';

// The golf bag / moose incident (SPEC §1.1) is the reason this exists: a new
// listing was built by copying an old one and silently inherited 18.5 × 31 in,
// birch with a pine frame.
const GOLF_BAG = newArtwork({
  id: 'golf-bag',
  title: 'Vintage golf bag',
  subject_name: 'Vintage golf bag',
  category: 'still_life',
  series: 'Clubhouse',
  width_in: 18.5, height_in: 31, depth_in: 1,
  substrate: 'birch',
  substrate_note: 'birch panel',
  framed: true, frame_material: 'pine', hanging_hardware: 'sawtooth',
  finish: 'satin poly',
  techniques: ['scorch_and_carve'],
  colors: ['natural'],
  asking_price: 495,
  hours: 22,
  materials_cost: 40,
  blurb: 'A vintage golf bag.',
  notes: 'sold at a club show',
  images: [{ id: 'img1', role: 'primary', web_path: 'images/golf-bag/primary.jpg' }],
  rights: { flags: ['own_design'], print_ok: 'yes' },
  print_master: { exists: true, long_edge_px: 3600 },
  primary_listing_url: 'https://www.etsy.com/listing/1239539354',
});

test('duplicate-as-new copies only the shop-setup fields', () => {
  const copy = duplicateAsNew(GOLF_BAG, 'Scorched wood moose');
  for (const field of DUPLICABLE_FIELDS) {
    assert.deepEqual(copy[field], GOLF_BAG[field], `${field} should carry over`);
  }
});

test('duplicate-as-new never carries the golf bag dimensions forward', () => {
  const copy = duplicateAsNew(GOLF_BAG, 'Scorched wood moose');
  assert.equal(copy.width_in, null);
  assert.equal(copy.height_in, null);
  assert.equal(copy.depth_in, null);
  assert.equal(copy.title, 'Scorched wood moose');
  assert.notEqual(copy.id, GOLF_BAG.id);
});

test('every forbidden field comes back blank', () => {
  const copy = duplicateAsNew(GOLF_BAG, 'New piece');
  const blank = newArtwork({ title: 'New piece' });
  for (const field of NEVER_DUPLICATED_FIELDS) {
    if (field === 'id' || field === 'title') continue;
    assert.deepEqual(
      copy[field], blank[field],
      `${field} must not be copied from the source artwork`,
    );
  }
});

test('the two field lists cannot disagree', () => {
  const overlap = DUPLICABLE_FIELDS.filter((f) => NEVER_DUPLICATED_FIELDS.includes(f));
  assert.deepEqual(overlap, []);
});

test('mutating the copy does not reach back into the original', () => {
  const copy = duplicateAsNew(GOLF_BAG, 'Moose');
  copy.techniques.push('stain');
  assert.deepEqual(GOLF_BAG.techniques, ['scorch_and_carve']);
});
