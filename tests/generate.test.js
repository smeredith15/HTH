import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateListing, generateDescription, buildContext, suggestTitle, suggestTags,
  suggestMaterials, suggestCategoryPath, variantLines, commissionPriceLines,
  measuresSentence, originalSizeSentence, formatCutoff,
} from '../app/listing/generate.js';
import { render, missingPlaceholders, SEED_TEMPLATES } from '../app/listing/templates.js';
import { validateListing } from '../app/listing/validators.js';
import { SEED_ARTWORKS, SEED_LISTINGS } from '../app/store/seed.js';
import { DEFAULT_SETTINGS as S } from '../app/store/settings.js';
import { newArtwork, newListing } from '../app/store/schema.js';

const art = (id) => SEED_ARTWORKS.find((a) => a.id === id);
const lst = (id) => SEED_LISTINGS.find((l) => l.id === id);

// --- Phase 2 acceptance criterion ------------------------------------------

test('acceptance: the surf van MDF listing says canvas nowhere', () => {
  const listing = lst('lst-surf-van');
  const output = generateListing(listing, art('surf-van'), S);
  const everything = JSON.stringify(output);
  assert.equal(/canvas/i.test(everything), false, 'no "canvas" in any generated field');
  assert.match(output.description, /MDF/);
  assert.match(output.description, /an MDF print/, 'article agrees with the acronym');
});

// --- templates -------------------------------------------------------------

test('a missing value leaves no debris behind', () => {
  assert.equal(render('Measures {{width_in}} × {{height_in}} × {{depth_in}} in.', { width_in: 16, height_in: 12 }),
    'Measures 16 × 12 in.');
  assert.equal(render('a{{gone}}\n\n{{alsogone}}\n\nb', {}), 'a\n\nb');
  assert.equal(render('Framed in {{frame}}. {{hardware}}', {}), 'Framed in.');
});

test('a/an agreement for acronyms', () => {
  assert.equal(render('a {{x}} print', { x: 'MDF' }), 'an MDF print');
  assert.equal(render('a {{x}} print', { x: 'canvas' }), 'a canvas print');
  assert.equal(render('A {{x}} print', { x: 'MDF' }), 'An MDF print');
});

test('every seed template renders with a fully-populated record', () => {
  const full = newArtwork({
    title: 'Test', subject_name: 'Test', subject_location: 'Maryland',
    width_in: 16, height_in: 20, depth_in: 1, substrate: 'birch',
    substrate_note: 'Solid birch panel', framed: true, frame_material: 'pine',
    hanging_hardware: 'sawtooth', hours: 20, history: 'Built in 1887.',
    disposition: 'sold',
  });
  for (const type of ['original', 'print', 'custom']) {
    const listing = newListing({ listing_type: type, print_substrate: 'canvas', variants: [{ label: '8 × 10', width_in: 8, height_in: 10, price: 50 }] });
    const { text, missing } = generateDescription(listing, full, S);
    assert.deepEqual(missing, [], `${type} template had gaps`);
    assert.equal(/\{\{|undefined|null|NaN/.test(text), false, `${type}: ${text}`);
    assert.ok(text.length > 100);
  }
});

test('sentences that cannot be built simply vanish', () => {
  assert.equal(measuresSentence({ width_in: null, height_in: null }), '');
  assert.equal(measuresSentence({ width_in: 16, height_in: 12 }), 'Measures 16 × 12 in.');
  assert.equal(measuresSentence({ width_in: 16, height_in: 12, depth_in: 1 }), 'Measures 16 × 12 × 1 in.');

  assert.equal(originalSizeSentence({ width_in: 24, height_in: 24, hours: 20 }),
    'The original measured 24 × 24 in and took about 20 hours.');
  assert.equal(originalSizeSentence({ width_in: 24, height_in: 24 }),
    'The original measured 24 × 24 in.');
  assert.equal(originalSizeSentence({}), 'The original was carved by hand.');
});

test('an unframed piece with no hardware gets no dangling sentence', () => {
  const bare = newArtwork({ title: 'Blue crab', subject_name: 'Blue crab', substrate: 'pine', width_in: 12, height_in: 12 });
  const { text } = generateDescription(newListing({ listing_type: 'original' }), bare, S);
  assert.equal(/Framed in \./.test(text), false);
  assert.equal(/Hanging hardware is already fitted: \./.test(text), false);
  assert.match(text, /Measures 12 × 12 in\./);
});

// --- generated fields ------------------------------------------------------

test('variant and commission price lines', () => {
  assert.equal(variantLines([{ width_in: 12, height_in: 8, price: 55 }]), '12 × 8 in — $55.00');
  const lines = commissionPriceLines(S).split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0], '8 × 10 in, 1 subject — $400');
  assert.match(lines[5], /3 or more subjects — quote/);
});

test('the holiday cutoff reads as a date, not an ISO string', () => {
  assert.equal(formatCutoff('2026-10-23'), 'October 23');
  assert.equal(formatCutoff(null), '');
});

test('a suggested title leads with the subject and never with Handmade', () => {
  const title = suggestTitle(art('humpback-whale'), { listing_type: 'print', print_substrate: 'canvas' });
  assert.ok(title.length <= 140);
  assert.equal(/^Handmade/i.test(title), false);
  assert.match(title.slice(0, 40), /Humpback Whale/);
});

test('suggested tags satisfy the tag validators', () => {
  for (const id of ['humpback-whale', 'golf-bag', 'moose', 'blue-crab']) {
    const tags = suggestTags(art(id), { listing_type: 'original' });
    assert.equal(tags.length, 13, `${id}: ${tags.length} tags`);
    assert.ok(tags.every((t) => t.length <= 20), `${id}: a tag is too long`);
    assert.ok(tags.every((t) => t.includes(' ')), `${id}: a single-word tag`);
    assert.equal(new Set(tags).size, 13, `${id}: duplicate tags`);
  }
});

test('techniques are not materials (§B.1)', () => {
  const materials = suggestMaterials(art('golf-bag'), { listing_type: 'original' });
  assert.ok(materials.includes('birch'));
  assert.ok(materials.includes('pine'));
  assert.equal(materials.some((m) => /pyrograph|burn|carv/i.test(m)), false);
  assert.ok(materials.length <= 13);
});

test('giclée is never the suggested category until the process is confirmed', () => {
  assert.match(suggestCategoryPath({ listing_type: 'print', print_process: 'unknown' }), /Digital Prints/);
  assert.match(suggestCategoryPath({ listing_type: 'print', print_process: 'giclee' }), /Gicl/);
  assert.match(suggestCategoryPath({ listing_type: 'original' }), /Mixed Media/);
});

// --- the seeded listings ---------------------------------------------------

test('every B.7 drafted listing passes its own validators', () => {
  const problems = [];
  for (const listing of SEED_LISTINGS) {
    if (!listing.title) continue;
    const artwork = listing.artwork_id ? art(listing.artwork_id) : null;
    const generated = generateListing(listing, artwork, S);
    for (const f of validateListing({ ...listing, description: generated.description }, artwork, S)) {
      // Rights, suppression, round variants and resolution are facts about the
      // work, not defects in the drafted copy.
      if (['rights_listing', 'rights_print', 'rights_edits', 'suppression',
        'round_variant', 'print_resolution', 'price_floor', 'giclee_claim'].includes(f.id)) continue;
      problems.push(`${listing.id}: ${f.id} — ${f.message}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the three custom drafts carry B.7 copy and the §8.2 prices', () => {
  const drafts = SEED_LISTINGS.filter((l) => l.listing_type === 'custom' && l.status === 'draft');
  assert.equal(drafts.length, 3);
  for (const draft of drafts) {
    assert.equal(draft.quantity, 3, 'quantity 3, not 1 (§B.1)');
    assert.deepEqual(draft.processing_weeks, [6, 8]);
    assert.equal(draft.tags.length, 13);
    assert.ok(draft.title.length <= 140);
    assert.deepEqual(validateListing(draft, null, S).filter((f) => f.id === 'processing_quantity'), []);
  }
  assert.deepEqual(drafts.map((d) => d.custom_kind).sort(), ['family', 'pet', 'sports']);
});

test('only the sports custom listing mentions your own athlete', () => {
  const text = (id) => generateDescription(lst(id), null, S).text;
  assert.match(text('lst-custom-sports'), /your own athlete/);
  assert.equal(/your own athlete/.test(text('lst-custom-pet')), false);
  assert.equal(/your own athlete/.test(text('lst-custom-family')), false);
});

test('the Cilleyville history is public listing copy, not a private note', () => {
  const bridge = art('cilleyville-covered-bridge');
  assert.match(bridge.history, /Town lattice truss/);
  assert.equal(/Town lattice truss/.test(bridge.notes ?? ''), false);
  const { text } = generateDescription(lst('lst-cilleyville'), bridge, S);
  assert.match(text, /National Register/);
  assert.equal(/VERIFY|fill in/i.test(text), false, 'private reminders must never reach a description');
});

test('a generated description never leaks a private note', () => {
  for (const listing of SEED_LISTINGS) {
    const artwork = listing.artwork_id ? art(listing.artwork_id) : null;
    if (!artwork?.notes) continue;
    const { text } = generateDescription(listing, artwork, S);
    assert.equal(text.includes(artwork.notes), false, `${listing.id} leaked its notes`);
  }
});

test('the whale listing still starts at $50 — a backlog item, and the app says so', () => {
  const whale = lst('lst-humpback-whale');
  assert.equal(Math.min(...whale.variants.map((v) => v.price)), 50);
  assert.equal(whale.print_vendor, 'CanvasChamp');
  assert.equal(whale.print_process, 'digital', 'latex inkjet, per the vendor');
  const findings = validateListing(whale, art('humpback-whale'), S);
  assert.ok(findings.some((f) => f.id === 'giclee_claim'), 'the Giclée category is flagged');
});

test('the confirmed CanvasChamp processes are recorded (October 2026)', () => {
  const byId = Object.fromEntries(SEED_LISTINGS.map((l) => [l.id, l]));
  // "UV-resistant & solvent-free latex inks" on poly-cotton canvas.
  for (const id of ['lst-toucan', 'lst-humpback-whale', 'lst-longhorn-skull-flag']) {
    assert.equal(byId[id].print_process, 'digital', id);
  }
  // "We print directly on wood with permanent UV ink" onto MDF composite.
  for (const id of ['lst-surf-van', 'lst-cactus-skull', 'lst-peace-sign']) {
    assert.equal(byId[id].print_process, 'uv_direct', id);
  }
  for (const l of SEED_LISTINGS.filter((x) => x.listing_type === 'print')) {
    assert.equal(l.print_vendor, 'CanvasChamp', l.id);
    assert.notEqual(l.print_process, 'giclee', `${l.id} must not claim giclée`);
  }
});

test('the ink named in materials matches the process, or is not named at all', () => {
  const inkFor = (process) => suggestMaterials({}, { listing_type: 'print', print_substrate: 'canvas', print_process: process });
  assert.deepEqual(inkFor('digital'), ['canvas', 'latex ink']);
  assert.deepEqual(inkFor('uv_direct'), ['canvas', 'uv ink']);
  assert.deepEqual(inkFor('giclee'), ['canvas', 'archival pigment ink']);
  assert.deepEqual(inkFor('unknown'), ['canvas'], 'an unconfirmed process claims no ink at all');
  assert.deepEqual(inkFor(null), ['canvas']);
});

test('no generated print listing makes a claim its own validators reject', () => {
  for (const listing of SEED_LISTINGS.filter((l) => l.listing_type === 'print')) {
    const artwork = art(listing.artwork_id);
    const generated = generateListing(listing, artwork, S);
    const filled = { ...listing, description: generated.description, materials: generated.materials };
    const claims = validateListing(filled, artwork, S)
      .filter((f) => ['archival_claim', 'museum_claim'].includes(f.id));
    assert.deepEqual(claims, [], `${listing.id} generated an unsupportable claim`);
  }
});
