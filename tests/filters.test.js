import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilters, filterArtworks, seriesIn } from '../app/store/artworks.js';
import { SEED_ARTWORKS } from '../app/store/seed.js';

const ALL = SEED_ARTWORKS;
const ids = (list) => list.map((a) => a.id).sort();

test('search covers title, subject, location and notes (§6.1)', () => {
  assert.ok(ids(filterArtworks(ALL, { q: 'hooper' })).includes('hooper-strait-lighthouse'));
  assert.ok(ids(filterArtworks(ALL, { q: 'st. michaels' })).includes('hooper-strait-lighthouse'));
  assert.ok(ids(filterArtworks(ALL, { q: 'golf bag' })).includes('moose'), 'the moose note mentions it');
  assert.equal(filterArtworks(ALL, { q: 'zzzzz' }).length, 0);
});

test('filters stack', () => {
  const sold = filterArtworks(ALL, { category: 'lighthouse', disposition: 'sold' });
  assert.deepEqual(ids(sold), [
    'assateague-lighthouse-1', 'assateague-lighthouse-2',
    'cape-hatteras-lighthouse-1', 'cape-hatteras-lighthouse-2',
  ]);
});

test('colour versus monochrome (§C.2 — colour draws interest)', () => {
  const colour = filterArtworks(ALL, { color: 'color' });
  assert.ok(ids(colour).includes('humpback-whale'));
  assert.ok(ids(colour).includes('longhorn-skull-flag'));
  const mono = filterArtworks(ALL, { color: 'mono' });
  assert.equal(mono.some((a) => a.id === 'humpback-whale'), false);
  assert.equal(colour.length + mono.length, ALL.length);
});

test('on hand, has face, print master and visibility all filter', () => {
  assert.deepEqual(ids(filterArtworks(ALL, { on_hand: 'yes' })), [
    'blue-crab', 'cilleyville-covered-bridge', 'golf-bag', 'moose',
  ]);
  assert.deepEqual(ids(filterArtworks(ALL, { print_master: 'yes' })), ['hooper-strait-lighthouse']);
  assert.equal(filterArtworks(ALL, { visibility: 'public' }).length, 9);
  assert.ok(filterArtworks(ALL, { has_face: 'yes' }).length > 10);
});

test('rights filter uses the derived answer when the owner has not set one', () => {
  const blocked = filterArtworks(ALL, { listing_ok: 'no' });
  assert.ok(blocked.every((a) => a.rights.listing_ok === 'no'
    || a.rights.flags.some((f) => [
      'public_figure_likeness', 'trademark_or_logo', 'third_party_photo', 'third_party_artwork',
    ].includes(f))));
  assert.ok(ids(blocked).includes('tom-brady'));
  assert.ok(ids(blocked).includes('snoopy-snowman'));
  assert.ok(ids(blocked).includes('atlas-statue'));
});

test('an empty filter set returns everything', () => {
  assert.equal(filterArtworks(ALL, {}).length, ALL.length);
  assert.equal(matchesFilters(ALL[0], {}), true);
});

test('sorting by title and by price', () => {
  const byTitle = filterArtworks(ALL, {}, 'title');
  assert.deepEqual(byTitle.map((a) => a.title), [...byTitle.map((a) => a.title)].sort((a, b) => a.localeCompare(b)));
  const byPrice = filterArtworks(ALL, {}, 'price');
  assert.equal(byPrice[0].id, 'golf-bag', '$495 is the top asking price');
});

test('series list is deduplicated', () => {
  assert.deepEqual(seriesIn(ALL), ['Coastal', 'Lighthouses']);
});
