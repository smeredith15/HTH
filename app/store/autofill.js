// Sensible defaults, and the line they must not cross.
//
// §1.1's worst bug was the moose inheriting the golf bag's dimensions, because
// a listing was built by copying another one. So there is a rule here:
//
//   Fill in what is true of HOW SCOTT WORKS. Never fill in what is true of
//   THIS PIECE.
//
// Technique, finish and hanging hardware are the same on nearly every piece —
// guessing those saves taps and cannot be wrong in a way that matters.
// Dimensions, price, hours and rights are facts about one object; a guess at
// those is the exact failure this app exists to prevent, so nothing here
// touches them.

import { newArtwork } from './schema.js';

export const NEVER_GUESSED = [
  'width_in', 'height_in', 'depth_in', 'asking_price', 'hours', 'materials_cost',
  'rights', 'print_master', 'images', 'blurb', 'history', 'notes',
];

/**
 * Category from the words in a title. Built from how Scott has actually
 * categorised his own catalogue, not from a general taxonomy.
 */
const CATEGORY_WORDS = [
  ['lighthouse', ['lighthouse', 'light station', 'screw-pile', 'screw pile']],
  ['portrait_pet', ['dog', 'puppy', 'cat', 'kitten', 'pet', 'heeler', 'retriever', 'terrier', 'labrador']],
  ['sports', ['golf', 'football', 'baseball', 'basketball', 'hockey', 'athlete', 'quarterback', 'jersey', 'orioles', 'ravens']],
  ['seasonal', ['pumpkin', 'jack-o', 'gnome', 'snowman', 'christmas', 'halloween', 'santa', 'wreath', 'holiday']],
  ['music', ['guitar', 'guitarist', 'musician', 'banjo', 'saxophone', 'drummer']],
  ['coastal', ['crab', 'surf', 'surfer', 'beach', 'seahorse', 'pier', 'wave', 'ocean', 'sail', 'harbour', 'harbor', 'porthole', 'nautical', 'shell']],
  ['wildlife', ['moose', 'bear', 'heron', 'whale', 'toucan', 'horse', 'deer', 'elk', 'fox', 'owl', 'kingfisher', 'eagle', 'wolf', 'turtle']],
  ['architecture', ['bridge', 'barn', 'church', 'lighthouse keeper', 'cottage', 'cabin', 'building']],
  ['still_life', ['mushroom', 'skull', 'bottle', 'flower', 'fruit', 'bouquet']],
  ['fantasy', ['dragon', 'anime', 'wizard', 'fairy', 'knight']],
  ['portrait_person', ['portrait', 'couple', 'family', 'bride', 'groom', 'astronaut']],
  ['landscape', ['mountain', 'valley', 'arch', 'canyon', 'forest', 'sunset', 'moon']],
];

export function guessCategory(text) {
  const haystack = ` ${String(text ?? '').toLowerCase()} `;
  for (const [category, words] of CATEGORY_WORDS) {
    if (words.some((word) => haystack.includes(word))) return category;
  }
  return null;
}

/** A category that is really a series gets its series name too. */
export function guessSeries(category) {
  return category === 'lighthouse' ? 'Lighthouses' : null;
}

/**
 * How the last few pieces were made. Only fields that describe the workshop,
 * and only when they agree — if the last three pieces used three different
 * substrates, there is nothing to carry forward.
 */
export const CARRIED_FORWARD = ['substrate', 'finish', 'hanging_hardware', 'frame_material', 'framed'];

export function studioDefaults(artworks, { look = 6 } = {}) {
  // Carrying a value that already is the blank default achieves nothing, and
  // announcing it ("filled in framed" when nothing is framed) is just noise.
  const blank = newArtwork({ title: 'x' });
  const recent = [...artworks]
    .filter((a) => a.updated_at)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, look);

  const out = {};
  for (const field of CARRIED_FORWARD) {
    const values = recent
      .map((a) => a[field])
      .filter((v) => v !== null && v !== undefined && v !== '');
    if (values.length < 2) continue;
    // Only carry a value forward when it is what he actually does most of the time.
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / values.length >= 0.6 && best !== blank[field]) out[field] = best;
  }
  return out;
}

/** Everything a brand-new piece can be given without guessing about the piece. */
export function defaultsForNew(title, artworks) {
  const category = guessCategory(title);
  const series = guessSeries(category);
  const applied = {
    // Most pieces are made this way. §B.5: the whole panel is scorched, then
    // carved back into. A new piece inherits it as a starting point, and
    // anything else — the toucan is a painting — is changed on the record.
    techniques: ['scorch_and_carve'],
    subject_name: String(title ?? '').trim() || null,
    ...studioDefaults(artworks),
  };
  if (category) applied.category = category;
  if (series) applied.series = series;
  return applied;
}

/** A first draft of alt text, from what the record already knows. */
export function suggestAlt(artwork, image = {}) {
  const subject = artwork?.subject_name || artwork?.title;
  if (!subject) return '';

  const substrateWords = {
    pine: 'pine', birch: 'birch', birch_plywood: 'birch plywood', mdf: 'MDF',
    live_edge_round: 'a live-edge wood round', skateboard_deck: 'a skateboard deck',
  };
  const roleWords = {
    straight_on: '',
    detail_raking: 'A close detail of ',
    in_room: 'Hanging on a wall, ',
    scale: 'Shown beside something for scale, ',
    back_hardware: 'The back of ',
    signature: 'The signature on ',
    process: 'Work in progress on ',
    mockup: 'A room mockup of ',
  };

  const lead = roleWords[image.role] ?? '';
  const material = substrateWords[artwork?.substrate];
  const colours = (artwork?.colors ?? []).length ? ` in ${artwork.colors.join(' and ')}` : '';
  // "in purple stain, … , stained" says it twice. The colours already carry it.
  const saysStain = (artwork?.colors ?? []).some((c) => /stain/i.test(c));
  const medium = mediumPhrase(artwork, material, { skipStain: saysStain });
  const body = `${subject}${colours}${medium ? `, ${medium}` : ''}`;

  // The subject is a proper noun more often than not, so it keeps its capital.
  const text = `${lead}${body}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * How the piece was made, from what the record says — not from what most of
 * the catalog happens to be.
 *
 * This used to read "scorched and carved into wood" for everything, with a
 * comment asserting that every piece is made that way. The toucan is a
 * painting. Drafting alt text for it produced a confident, published, false
 * description of the artwork, and alt text is exactly where nobody looks to
 * check. Same shape of mistake as claiming archival ink on a latex print.
 *
 * Structural techniques are mutually exclusive in practice, so the first one
 * present wins; stain and gold leaf are finishes and ride along behind. With
 * no technique recorded this says nothing rather than guessing, because a
 * silent omission is recoverable and a confident wrong answer is not.
 */
export function mediumPhrase(artwork, material = null, { skipStain = false } = {}) {
  const techniques = artwork?.techniques ?? [];
  const on = material ? ` ${material}` : ' wood';

  const structural = [
    ['scorch_and_carve', `scorched and carved into${on}`],
    ['relief_carve', `carved in relief into${on}`],
    ['pyrography_line', `burned into${on}`],
    ['paint', material ? `painted on ${material}` : 'painted'],
  ].find(([key]) => techniques.includes(key));

  // No technique on the record is not evidence of the usual one. Say nothing.
  if (!structural) return '';

  // Whatever was added on top of the structural work. A piece can be carved
  // *and* painted — the whale's background is — so paint has to survive not
  // being the headline.
  const added = [
    techniques.includes('stain') && !skipStain ? 'stained' : null,
    techniques.includes('paint') && structural[0] !== 'paint' ? 'painted' : null,
  ].filter(Boolean);

  const parts = [structural[1]];
  if (added.length) parts.push(added.join(' and '));
  if (techniques.includes('gold_leaf')) parts.push('with gold leaf');
  return parts.join(', ');
}
