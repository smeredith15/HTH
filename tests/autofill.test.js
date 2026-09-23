import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guessCategory, guessSeries, studioDefaults, defaultsForNew, suggestAlt, mediumPhrase,
  NEVER_GUESSED, CARRIED_FORWARD,
} from '../app/store/autofill.js';
import { newArtwork, CATEGORY } from '../app/store/schema.js';
import { SEED_ARTWORKS } from '../app/store/seed.js';

// The moose inherited the golf bag's dimensions because a listing was copied.
// That is the failure this whole module has to stay clear of.
test('nothing about the piece itself is ever guessed', () => {
  const filled = defaultsForNew('Assateague Lighthouse', SEED_ARTWORKS);
  for (const field of NEVER_GUESSED) {
    assert.equal(field in filled, false, `${field} must never be filled in automatically`);
  }
  for (const field of CARRIED_FORWARD) {
    assert.equal(NEVER_GUESSED.includes(field), false, `${field} cannot be both carried and forbidden`);
  }
});

test('category is read from the words in the title', () => {
  assert.equal(guessCategory('Assateague Lighthouse'), 'lighthouse');
  assert.equal(guessCategory('Chesapeake blue crab'), 'coastal');
  assert.equal(guessCategory('Scorched wood moose'), 'wildlife');
  assert.equal(guessCategory('Blue heeler puppy'), 'portrait_pet');
  assert.equal(guessCategory('Jack-o’-lantern and gourds'), 'seasonal');
  assert.equal(guessCategory('Row of mushrooms'), 'still_life');
  assert.equal(guessCategory('Cilleyville Covered Bridge'), 'architecture');
});

test('an unrecognised title guesses nothing rather than guessing badly', () => {
  assert.equal(guessCategory('Something with no familiar words'), null);
  assert.equal(guessCategory(''), null);
  assert.equal(guessCategory(null), null);
});

test('every guessed category is one the schema knows', () => {
  for (const title of ['lighthouse', 'crab', 'moose', 'puppy', 'pumpkin', 'guitar', 'bridge', 'skull', 'dragon', 'portrait', 'mountain', 'golf']) {
    const guess = guessCategory(title);
    if (guess) assert.ok(CATEGORY.includes(guess), `${title} → ${guess}`);
  }
});

test('a lighthouse gets its series too', () => {
  assert.equal(guessSeries('lighthouse'), 'Lighthouses');
  assert.equal(guessSeries('wildlife'), null);
});

test('the workshop carries forward only what is consistent', () => {
  const consistent = [
    newArtwork({ id: 'a', title: 'a', substrate: 'birch', finish: 'satin poly', updated_at: '2026-09-20T00:00:00Z' }),
    newArtwork({ id: 'b', title: 'b', substrate: 'birch', finish: 'satin poly', updated_at: '2026-09-19T00:00:00Z' }),
    newArtwork({ id: 'c', title: 'c', substrate: 'birch', finish: 'satin poly', updated_at: '2026-09-18T00:00:00Z' }),
  ];
  const defaults = studioDefaults(consistent);
  assert.equal(defaults.substrate, 'birch');
  assert.equal(defaults.finish, 'satin poly');
});

test('a value that is already the default is not carried, or announced', () => {
  // Nothing is framed, so "filled in framed" would be noise, not help.
  const unframed = [
    newArtwork({ id: 'a', title: 'a', framed: false, updated_at: '2026-09-20T00:00:00Z' }),
    newArtwork({ id: 'b', title: 'b', framed: false, updated_at: '2026-09-19T00:00:00Z' }),
    newArtwork({ id: 'c', title: 'c', framed: false, updated_at: '2026-09-18T00:00:00Z' }),
  ];
  assert.equal('framed' in studioDefaults(unframed), false);

  const framed = unframed.map((a) => ({ ...a, framed: true, frame_material: 'pine' }));
  assert.equal(studioDefaults(framed).framed, true, 'but a real habit is carried');
  assert.equal(studioDefaults(framed).frame_material, 'pine');
});

test('three different substrates carry nothing forward', () => {
  const mixed = [
    newArtwork({ id: 'a', title: 'a', substrate: 'birch', updated_at: '2026-09-20T00:00:00Z' }),
    newArtwork({ id: 'b', title: 'b', substrate: 'pine', updated_at: '2026-09-19T00:00:00Z' }),
    newArtwork({ id: 'c', title: 'c', substrate: 'mdf', updated_at: '2026-09-18T00:00:00Z' }),
  ];
  assert.equal(studioDefaults(mixed).substrate, undefined, 'no majority, so no default');
});

test('one piece is not a habit', () => {
  const single = [newArtwork({ id: 'a', title: 'a', substrate: 'birch', updated_at: '2026-09-20T00:00:00Z' })];
  assert.deepEqual(studioDefaults(single), {});
});

test('a new piece gets the technique, because every piece is made that way', () => {
  const filled = defaultsForNew('Currituck Beach Lighthouse', SEED_ARTWORKS);
  assert.deepEqual(filled.techniques, ['scorch_and_carve']);
  assert.equal(filled.category, 'lighthouse');
  assert.equal(filled.series, 'Lighthouses');
  assert.equal(filled.subject_name, 'Currituck Beach Lighthouse');
});

test('a title with no clue leaves the category alone', () => {
  const filled = defaultsForNew('Untitled study', SEED_ARTWORKS);
  assert.equal('category' in filled, false);
  assert.equal('series' in filled, false);
  assert.deepEqual(filled.techniques, ['scorch_and_carve']);
});

// --- alt text --------------------------------------------------------------

test('alt text is drafted from what the record already knows', () => {
  const artwork = {
    subject_name: 'Assateague Lighthouse', substrate: 'birch',
    techniques: ['scorch_and_carve', 'stain'], colors: ['red stain'],
  };
  assert.equal(
    suggestAlt(artwork, { role: 'straight_on' }),
    // Not "… , stained" as well: the colours already said it.
    'Assateague Lighthouse in red stain, scorched and carved into birch.',
  );
});

test('the role changes how the draft opens, and proper nouns keep their capital', () => {
  const artwork = { subject_name: 'Hooper Strait Lighthouse', substrate: 'pine', techniques: ['scorch_and_carve'] };
  assert.equal(
    suggestAlt(artwork, { role: 'detail_raking' }),
    'A close detail of Hooper Strait Lighthouse, scorched and carved into pine.',
  );
  assert.match(suggestAlt(artwork, { role: 'back_hardware' }), /^The back of Hooper/);
  assert.match(suggestAlt(artwork, { role: 'in_room' }), /^Hanging on a wall, Hooper/);
});

test('an unknown substrate still produces usable alt text', () => {
  assert.equal(
    suggestAlt({ subject_name: 'Blue crab', techniques: ['scorch_and_carve'] }, { role: 'straight_on' }),
    'Blue crab, scorched and carved into wood.',
  );
});

// --- the medium comes from the record, not from the shop -------------------
//
// This said "scorched and carved into wood" for everything, with a comment
// asserting every piece is made that way. The toucan is a painting. Drafting
// alt text for it produced a confident, published, false description of the
// artwork — in the one field nobody re-reads. Same shape as claiming archival
// ink on a latex print.

test('a painting is not described as carved', () => {
  const toucan = { subject_name: 'Toucan', techniques: ['paint'] };
  assert.equal(suggestAlt(toucan, { role: 'straight_on' }), 'Toucan, painted.');
  assert.equal(
    suggestAlt({ ...toucan, substrate: 'birch' }, { role: 'straight_on' }),
    'Toucan, painted on birch.',
  );
});

test('a piece that is carved and painted says both', () => {
  // The whale's background is painted; the whale itself is cut out of the char.
  assert.equal(
    mediumPhrase({ techniques: ['scorch_and_carve', 'paint', 'stain'] }, 'birch'),
    'scorched and carved into birch, stained and painted',
  );
  assert.equal(
    mediumPhrase({ techniques: ['scorch_and_carve', 'gold_leaf', 'paint', 'stain'] }, 'birch'),
    'scorched and carved into birch, stained and painted, with gold leaf',
  );
});

test('each structural technique gets its own words', () => {
  assert.equal(mediumPhrase({ techniques: ['relief_carve'] }, 'pine'), 'carved in relief into pine');
  assert.equal(mediumPhrase({ techniques: ['pyrography_line'] }, 'pine'), 'burned into pine');
  assert.equal(mediumPhrase({ techniques: ['scorch_and_carve'] }), 'scorched and carved into wood');
});

// Eighteen records carry no technique at all. Filling that gap with the shop's
// usual one is how the toucan would have been mislabelled in the first place.
test('no technique on the record means no claim about how it was made', () => {
  assert.equal(mediumPhrase({ techniques: [] }, 'birch'), '');
  assert.equal(suggestAlt({ subject_name: 'Unknown piece', substrate: 'birch' }, { role: 'straight_on' }),
    'Unknown piece.');
});

test('with no subject there is nothing honest to say', () => {
  assert.equal(suggestAlt({}, {}), '');
  assert.equal(suggestAlt(null, {}), '');
});

test('the draft never invents a size or a price', () => {
  const artwork = { subject_name: 'Golf bag', substrate: 'birch', width_in: 18.5, height_in: 31, asking_price: 495 };
  const alt = suggestAlt(artwork, { role: 'straight_on' });
  assert.equal(/18\.5|31|495/.test(alt), false, alt);
});
