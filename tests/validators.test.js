import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListing, summarise, checkTitle, checkTags, checkTrademarks,
  checkSubstrateConsistency, checkDimensionConsistency, checkOffsiteRedirects,
  checkRoundVariant, checkPrintResolution, checkRights, checkPriceFloor,
  checkProcessingVsQuantity, checkGicleeClaim, checkUnsupportedPrintClaims,
  checkTechniqueClaim,
} from '../app/listing/validators.js';
import { newArtwork, newListing } from '../app/store/schema.js';
import { DEFAULT_SETTINGS as S } from '../app/store/settings.js';
import { SEED_ARTWORKS } from '../app/store/seed.js';

const ids = (findings) => findings.map((f) => f.id).sort();
const has = (findings, id) => findings.some((f) => f.id === id);

const CLEAN_ART = newArtwork({
  title: 'Assateague Lighthouse', subject_name: 'Assateague Lighthouse',
  width_in: 16, height_in: 20, substrate: 'birch', shape: 'rect',
  hours: 14, materials_cost: 30, asking_price: 450, // floor is $442.44 at $25/h
  rights: { flags: ['own_design'] },
  print_master: { exists: true, long_edge_px: 3600, print_ready: 'yes' },
});

const CLEAN_LISTING = newListing({
  listing_type: 'original',
  title: 'Assateague Lighthouse Wall Art, Original Scorched Wood, Coastal Decor',
  tags: [
    'lighthouse wall art', 'coastal wall art', 'wood burning art', 'carved wood art',
    'rustic wall art', 'nautical wall decor', 'beach house decor', 'original wood art',
    'lighthouse gift', 'virginia coast art', 'pyrography art', 'lighthouse decor',
    'one of a kind art',
  ],
  materials: ['birch', 'pine'],
  description: 'Measures 16 × 20 in. Burned and carved into birch.',
  variants: [{ label: '16 × 20', width_in: 16, height_in: 20, price: 450 }],
});

test('a clean listing produces no findings at all', () => {
  assert.deepEqual(validateListing(CLEAN_LISTING, CLEAN_ART, S), []);
});

// --- title (§7.4 rows 1–3) -------------------------------------------------

test('title length', () => {
  assert.deepEqual(checkTitle({ title: 'x'.repeat(140) }), []);
  assert.ok(has(checkTitle({ title: 'x'.repeat(141) }), 'title_length'));
});

test('title separators', () => {
  assert.deepEqual(checkTitle({ title: 'Lighthouse Art, Coastal Decor' }), []);
  for (const bad of ['Art || Decor', 'Art // Decor', 'Art /// Decor']) {
    assert.ok(has(checkTitle({ title: bad }), 'title_separators'), bad);
  }
});

test('title opener', () => {
  assert.ok(has(checkTitle({ title: 'Handmade Lighthouse Art' }), 'title_opener'));
  assert.ok(has(checkTitle({ title: 'handmade lighthouse art' }), 'title_opener'));
  // The word is fine anywhere but the front.
  assert.deepEqual(checkTitle({ title: 'Lighthouse Art, Handmade Wood Carving' }), []);
});

// --- tags (§7.4 rows 4–7) --------------------------------------------------

const thirteen = (over) => Array.from({ length: 13 }, (_, i) => over && i === 0 ? 'x'.repeat(21) : `tag number ${i}`);

test('tag count wants exactly 13', () => {
  assert.deepEqual(checkTags({ tags: thirteen() }), []);
  assert.ok(has(checkTags({ tags: thirteen().slice(0, 9) }), 'tag_count'));
  assert.ok(has(checkTags({ tags: [...thirteen(), 'one more tag'] }), 'tag_count'));
});

test('a 21-character tag warns', () => {
  assert.ok(has(checkTags({ tags: thirteen(true) }), 'tag_length'));
  assert.equal(has(checkTags({ tags: [...thirteen().slice(0, 12), 'x'.repeat(20)] }), 'tag_length'), false,
    'exactly 20 is allowed');
});

test('single-word tags and duplicates', () => {
  assert.ok(has(checkTags({ tags: ['lighthouse', 'coastal wall art'] }), 'tag_form'));
  assert.ok(has(checkTags({ tags: ['coastal wall art', 'Coastal Wall Art'] }), 'tag_duplicates'),
    'case does not make a tag distinct');
});

// --- trademarks (§7.4 row 8, §B.4) -----------------------------------------

test('a blocklist term anywhere warns', () => {
  assert.ok(has(checkTrademarks({ title: 'Retro VW Bus Art' }, S), 'trademark'));
  assert.ok(has(checkTrademarks({ tags: ['packers wall art'] }, S), 'trademark'));
  assert.ok(has(checkTrademarks({ description: 'A Snoopy snowman.' }, S), 'trademark'));
  assert.ok(has(checkTrademarks({ materials: ['topps card stock'] }, S), 'trademark'));
});

test('longhorn is a cattle breed; texas longhorns is a mark (§B.4)', () => {
  assert.deepEqual(checkTrademarks({ title: 'Longhorn Skull Wall Art' }, S), []);
  assert.ok(has(checkTrademarks({ title: 'Texas Longhorns Skull Art' }, S), 'trademark'));
});

test('a blocklist term inside a longer word does not fire', () => {
  // "vw" must not match "vwxyz"; "bills" must not match "billsworth".
  assert.deepEqual(checkTrademarks({ title: 'Screwdriver and Billsworth Lane' }, S), []);
});

// --- substrate (§7.4 row 9) ------------------------------------------------

test('an MDF listing that says canvas warns', () => {
  const listing = { print_substrate: 'mdf', description: 'Printed on canvas and stretched.' };
  assert.ok(has(checkSubstrateConsistency(listing, {}), 'substrate_consistency'));
});

test('a print may describe both its own stock and the original panel', () => {
  const listing = { print_substrate: 'mdf', description: 'An MDF print of an original carved into birch.' };
  assert.deepEqual(checkSubstrateConsistency(listing, { substrate: 'birch' }), []);
});

test('a frame material is not a substrate claim', () => {
  // The golf bag is birch in a pine frame; the Cilleyville bridge hangs in a
  // gold metal float. Neither is a contradiction.
  const golf = { description: 'Carved into birch. Framed in pine.' };
  assert.deepEqual(checkSubstrateConsistency(golf, { substrate: 'birch', frame_material: 'pine' }), []);
  const bridge = { description: 'Framed in gold metal float.' };
  assert.deepEqual(checkSubstrateConsistency(bridge, { frame_material: 'gold metal float' }), []);
  // But a stray wood word with no frame to explain it still warns.
  assert.ok(has(checkSubstrateConsistency(golf, { substrate: 'birch' }), 'substrate_consistency'));
});

test('an original that names the wrong wood warns', () => {
  const listing = { description: 'Carved into pine.' };
  assert.ok(has(checkSubstrateConsistency(listing, { substrate: 'birch' }), 'substrate_consistency'));
});

// --- dimensions (§7.4 row 10) ----------------------------------------------

test('dimensions in the description must match the record', () => {
  const artwork = { width_in: 16, height_in: 12 };
  assert.deepEqual(checkDimensionConsistency({ description: 'Measures 16 × 12 in.' }, artwork), []);
  assert.deepEqual(checkDimensionConsistency({ description: 'Measures 12 x 16 in.' }, artwork), [],
    'either order is the same piece');
  // The moose inheriting the golf bag's size is exactly this.
  assert.ok(has(checkDimensionConsistency({ description: 'Measures 18.5 × 31 in.' }, artwork),
    'dimension_consistency'));
});

test('variant sizes count as known dimensions', () => {
  const listing = { description: 'Sizes: 12 × 8, 18 × 12', variants: [
    { width_in: 12, height_in: 8 }, { width_in: 18, height_in: 12 },
  ] };
  assert.deepEqual(checkDimensionConsistency(listing, {}), []);
});

test('a description with no dimensions is not a finding', () => {
  assert.deepEqual(checkDimensionConsistency({ description: 'A lighthouse.' }, {}), []);
});

// --- the rest --------------------------------------------------------------

test('off-site redirects', () => {
  assert.ok(has(checkOffsiteRedirects({ description: 'Follow me on Instagram' }), 'offsite_redirect'));
  assert.ok(has(checkOffsiteRedirects({ description: 'Find me @hightidehandmade' }), 'offsite_redirect'));
  assert.deepEqual(checkOffsiteRedirects({ description: 'Message me before ordering.' }), []);
});

test('a round variant of a rectangular composition warns', () => {
  const round = { variants: [{ shape: 'round' }] };
  assert.ok(has(checkRoundVariant(round, { shape: 'square' }), 'round_variant'));
  assert.deepEqual(checkRoundVariant(round, { shape: 'round' }), []);
  assert.deepEqual(checkRoundVariant({ variants: [{ shape: 'rect' }] }, { shape: 'rect' }), []);
});

test('print resolution against the master (§5.4)', () => {
  const artwork = { print_master: { exists: true, long_edge_px: 3600 } }; // 24 in @150, 36 in @100
  const at = (edge) => ({ listing_type: 'print', variants: [{ label: `${edge} in`, width_in: edge, height_in: 8 }] });
  assert.deepEqual(checkPrintResolution(at(24), artwork), [], '24 in is exactly the 150 DPI limit');
  assert.equal(checkPrintResolution(at(30), artwork)[0].level, 'warn', 'past 150 DPI');
  assert.equal(checkPrintResolution(at(40), artwork)[0].level, 'stop', 'past 100 DPI');
});

// Scott's photographs arrive long before a cropped master does. Checking the
// sizes against the best photo on file, and saying plainly that it is a photo,
// beats the old behaviour of shrugging until a master existed.
test('with no master the sizes are checked against the largest photo', () => {
  const artwork = newArtwork({ title: 'Vintage golf bag', images: [
    { id: 'straight_on', role: 'straight_on', original_width_px: 1440, original_height_px: 1800 },
  ] });
  // 1,800 px is 12 in at 150 DPI and 18 in at the 100 DPI floor.
  const at = (edge) => ({ listing_type: 'print', variants: [{ label: `${edge} in`, width_in: 8, height_in: edge }] });
  const soft = checkPrintResolution(at(14), artwork);
  assert.equal(soft[0].level, 'warn');
  assert.match(soft[0].message, /largest photo on file \(before cropping\)/);
  assert.match(soft[0].message, /12\.0 in at 150 DPI/);

  const tooBig = checkPrintResolution(at(20), artwork);
  assert.equal(tooBig[0].level, 'stop');
  assert.match(tooBig[0].message, /18\.0 in even at 100 DPI/);
});

test('a size the photo does support still says no master has been measured', () => {
  const artwork = newArtwork({ title: 'Vintage golf bag', images: [
    { id: 'straight_on', role: 'straight_on', original_width_px: 1440, original_height_px: 1800 },
  ] });
  const listing = { listing_type: 'print', variants: [{ label: '8 × 10', width_in: 8, height_in: 10 }] };
  const findings = checkPrintResolution(listing, artwork);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'note');
  assert.match(findings[0].message, /No master measured yet/);
});

test('a measured master silences the reminder entirely', () => {
  const artwork = newArtwork({ title: 'x',
    print_master: { exists: true, long_edge_px: 6000 },
    images: [{ id: 'a', role: 'straight_on', original_width_px: 1440, original_height_px: 1800 }] });
  const listing = { listing_type: 'print', variants: [{ label: '16 × 20', width_in: 16, height_in: 20 }] };
  assert.deepEqual(checkPrintResolution(listing, artwork), []);
});

test('Hooper Strait cannot support anything past 9.6 in', () => {
  const hooper = SEED_ARTWORKS.find((a) => a.id === 'hooper-strait-lighthouse');
  const listing = { listing_type: 'print', variants: [{ label: '16 × 20', width_in: 16, height_in: 20 }] };
  const findings = checkPrintResolution(listing, hooper);
  assert.equal(findings[0].level, 'stop');
  assert.match(findings[0].message, /14\.4 in/);
});

test('rights warn but never block (§5.2)', () => {
  const sports = SEED_ARTWORKS.find((a) => a.id === 'tom-brady');
  const findings = checkRights({ listing_type: 'print' }, sports);
  assert.ok(has(findings, 'rights_listing'));
  assert.ok(has(findings, 'rights_print'));
  assert.deepEqual(checkRights({ listing_type: 'original' }, CLEAN_ART), []);
});

test('an original below its price floor warns (§8.1)', () => {
  const artwork = { ...CLEAN_ART, hours: 40, asking_price: 150 };
  assert.ok(has(checkPriceFloor({ listing_type: 'original', variants: [] }, artwork, S), 'price_floor'));
  assert.deepEqual(checkPriceFloor({ listing_type: 'original', variants: [] }, CLEAN_ART, S), []);
});

test('no hours means no price-floor claim', () => {
  const artwork = { ...CLEAN_ART, hours: null, asking_price: 20 };
  assert.deepEqual(checkPriceFloor({ listing_type: 'original', variants: [] }, artwork, S), []);
});

test('a custom listing at quantity 1 warns (§B.1)', () => {
  assert.ok(has(checkProcessingVsQuantity({ listing_type: 'custom', quantity: 1 }), 'processing_quantity'));
  assert.deepEqual(checkProcessingVsQuantity({ listing_type: 'custom', quantity: 3 }), []);
  assert.deepEqual(checkProcessingVsQuantity({ listing_type: 'original', quantity: 1 }), []);
});

test('giclée is only allowed once the process is confirmed (§5.5)', () => {
  assert.ok(has(checkGicleeClaim({ category_path: 'Prints > Giclée', print_process: 'unknown' }), 'giclee_claim'));
  assert.ok(has(checkGicleeClaim({ description: 'A giclee print.', print_process: 'digital' }), 'giclee_claim'));
  assert.deepEqual(checkGicleeClaim({ category_path: 'Prints > Giclée', print_process: 'giclee' }), []);
  assert.deepEqual(checkGicleeClaim({ category_path: 'Prints > Digital Prints', print_process: 'unknown' }), []);
});

test('an archival claim needs a giclée process behind it', () => {
  const base = { listing_type: 'print', description: 'Printed with archival inks.' };
  // CanvasChamp's canvas line is latex ink — durable, but not archival.
  assert.ok(has(checkUnsupportedPrintClaims({ ...base, print_process: 'digital' }), 'archival_claim'));
  assert.ok(has(checkUnsupportedPrintClaims({ ...base, print_process: 'uv_direct' }), 'archival_claim'));
  assert.ok(has(checkUnsupportedPrintClaims({ ...base, print_process: null }), 'archival_claim'));
  assert.deepEqual(checkUnsupportedPrintClaims({ ...base, print_process: 'giclee' }), []);
  // The claim also counts when it is hiding in the materials list.
  assert.ok(has(checkUnsupportedPrintClaims({
    listing_type: 'print', print_process: 'digital', materials: ['canvas', 'archival ink'],
  }), 'archival_claim'));
});

test('museum quality is flagged as a note, and only on prints', () => {
  assert.ok(has(checkUnsupportedPrintClaims({
    listing_type: 'print', print_process: 'digital', description: 'Museum-quality canvas.',
  }), 'museum_claim'));
  assert.deepEqual(checkUnsupportedPrintClaims({
    listing_type: 'original', description: 'Museum-quality.',
  }), []);
});

// --- Phase 2 acceptance criteria -------------------------------------------

test('acceptance: a title with || or VW warns, and a 21-character tag warns', () => {
  const listing = newListing({
    title: 'Surf Van Art || VW Bus Print',
    tags: ['x'.repeat(21)],
  });
  const findings = validateListing(listing, CLEAN_ART, S);
  assert.ok(has(findings, 'title_separators'));
  assert.ok(has(findings, 'trademark'));
  assert.ok(has(findings, 'tag_length'));
});

test('findings are ordered worst first and summarise', () => {
  const sports = SEED_ARTWORKS.find((a) => a.id === 'tom-brady');
  const findings = validateListing(newListing({ listing_type: 'print', tags: ['solo'] }), sports, S);
  assert.equal(findings[0].level, 'stop');
  const counts = summarise(findings);
  assert.equal(counts.total, findings.length);
  assert.ok(counts.stop >= 1);
});

test('nothing in the validators throws on an empty listing', () => {
  assert.doesNotThrow(() => validateListing(newListing({}), null, S));
  assert.doesNotThrow(() => validateListing({}, undefined, undefined));
});

// --- the description has to match how the piece was actually made ----------

test('a painting listed with the stock carved description is a blocker', () => {
  const toucan = newArtwork({ title: 'Toucan', techniques: ['paint'] });
  const listing = {
    listing_type: 'original',
    title: 'Toucan Wall Art',
    description: 'The whole panel is scorched black, then I carve back into it to reveal the wood.',
  };
  const findings = checkTechniqueClaim(listing, toucan);
  assert.equal(findings[0].level, 'stop');
  assert.match(findings[0].message, /techniques are paint/);
});

test('a carved piece described as carved is fine', () => {
  const moose = newArtwork({ title: 'Moose', techniques: ['scorch_and_carve', 'paint'] });
  assert.deepEqual(checkTechniqueClaim({
    listing_type: 'original',
    description: 'The whole panel is scorched black, then carved back into.',
  }, moose), []);
});

test('a painting described as a painting passes', () => {
  const toucan = newArtwork({ title: 'Toucan', techniques: ['paint'] });
  assert.deepEqual(checkTechniqueClaim({
    listing_type: 'original',
    title: 'Toucan Painting',
    description: 'Painted by hand on a wood panel.',
  }, toucan), []);
});

// An empty techniques list is missing information, not evidence of a painting.
test('a record with no techniques recorded is not second-guessed', () => {
  assert.deepEqual(checkTechniqueClaim({
    listing_type: 'original', description: 'Scorched and carved.',
  }, newArtwork({ title: 'x' })), []);
});
