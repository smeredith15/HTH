import test from 'node:test';
import assert from 'node:assert/strict';
import { repriceOriginals, repricePrints, recommendations, summarise } from '../app/reports/reprice.js';
import { newArtwork, newListing } from '../app/store/schema.js';
import { SEED_VENDORS } from '../app/store/print-costs.js';
import { DEFAULT_SETTINGS as S } from '../app/store/settings.js';

// Scott's real quotes, 22 September 2026, both labs drop-shipping.
const COSTS = [
  { id: 'cc-wood-16x24', line: 'cc-wood', vendor: 'CanvasChamp', product: 'Wood / MDF', substrate: 'mdf', width_in: 16, height_in: 24, unit_cost: 107.32, ship_each: 9.99 },
  { id: 'cc-wood-12x18', line: 'cc-wood', vendor: 'CanvasChamp', product: 'Wood / MDF', substrate: 'mdf', width_in: 12, height_in: 18, unit_cost: 48.97, ship_each: 9.99 },
  { id: 'cc-canvas-16x24', line: 'cc-canvas', vendor: 'CanvasChamp', product: 'Canvas', substrate: 'canvas', width_in: 16, height_in: 24, unit_cost: 26.01, ship_each: 9.99 },
  { id: 'cc-canvas-12x18', line: 'cc-canvas', vendor: 'CanvasChamp', product: 'Canvas', substrate: 'canvas', width_in: 12, height_in: 18, unit_cost: 20.14, ship_each: 9.99 },
  { id: 'cc-canvas-24x36', line: 'cc-canvas', vendor: 'CanvasChamp', product: 'Canvas', substrate: 'canvas', width_in: 24, height_in: 36, unit_cost: 32.00, ship_each: 9.99 },
];

const cactus = newListing({
  id: 'lst-cactus', artwork_id: 'western-cactus-longhorn-skull',
  listing_type: 'print', print_substrate: 'mdf', print_vendor: 'CanvasChamp',
  variants: [
    { label: '18 × 12', width_in: 12, height_in: 18, price: 75 },
    { label: '24 × 16', width_in: 16, height_in: 24, price: 140 },
  ],
});

const ART = [newArtwork({ id: 'western-cactus-longhorn-skull', title: 'Cactus and longhorn skull' })];

// --- prints ---------------------------------------------------------------

test('the wood prints are reported as barely clearing cost', () => {
  const rows = repricePrints([cactus], ART, COSTS, SEED_VENDORS, S);
  assert.equal(rows.length, 2);
  const big = rows.find((r) => r.variant.label === '24 × 16');
  assert.equal(big.cost.total, 117.31);
  assert.ok(big.margin < 0.1, `${Math.round(big.margin * 100)}% margin`);
  assert.equal(big.severity, 'thin');
  assert.match(big.reason, /leaves 6%/);
  assert.ok(big.suggested > 300, 'the target price is not a print price');
});

test('a price under the landed cost is called a loss, not a thin margin', () => {
  const losing = { ...cactus, variants: [{ label: '24 × 16', width_in: 16, height_in: 24, price: 90 }] };
  const [row] = repricePrints([losing], ART, COSTS, SEED_VENDORS, S);
  assert.equal(row.severity, 'losing');
  assert.match(row.reason, /does not cover/);
  assert.ok(row.profit < 0);
});

// The finding that matters most: the same image on canvas costs a third as much.
test('a much cheaper substrate at the same size is surfaced', () => {
  const rows = repricePrints([cactus], ART, COSTS, SEED_VENDORS, S);
  const big = rows.find((r) => r.variant.label === '24 × 16');
  assert.ok(big.cheaper, 'the canvas option should be found');
  assert.equal(big.cheaper.row.substrate, 'canvas');
  assert.equal(big.cheaper.cost.total, 36.00);
  assert.equal(big.cheaper.saves, 81.31);
  assert.match(big.cheaper.text, /Canvas at this size lands at \$36\.00/);
});

test('a marginally cheaper option is not worth mentioning', () => {
  // Two rows within 25% of each other should not generate a switch suggestion.
  const close = [
    { id: 'a', line: 'x', vendor: 'CanvasChamp', product: 'A', substrate: 'canvas', width_in: 16, height_in: 24, unit_cost: 26.01, ship_each: 9.99 },
    { id: 'b', line: 'y', vendor: 'CanvasChamp', product: 'B', substrate: 'paper', width_in: 16, height_in: 24, unit_cost: 24.00, ship_each: 9.99 },
  ];
  const listing = { ...cactus, print_substrate: 'canvas', variants: [{ label: '24 × 16', width_in: 16, height_in: 24, price: 120 }] };
  const [row] = repricePrints([listing], ART, close, SEED_VENDORS, S);
  assert.equal(row.cheaper, null);
});

test('a healthy price is reported as healthy', () => {
  const whale = newListing({
    id: 'lst-whale', listing_type: 'print', print_substrate: 'canvas', print_vendor: 'CanvasChamp',
    variants: [{ label: '24 × 36', width_in: 24, height_in: 36, price: 340 }],
  });
  const [row] = repricePrints([whale], ART, COSTS, SEED_VENDORS, S);
  assert.equal(row.severity, 'ok');
  assert.equal(row.suggested, null);
  assert.ok(row.margin > 0.7, `${Math.round(row.margin * 100)}%`);
});

test('a size with no lab cost says nothing at all', () => {
  const unknown = { ...cactus, variants: [{ label: '8 × 10', width_in: 8, height_in: 10, price: 40 }] };
  assert.deepEqual(repricePrints([unknown], ART, COSTS, SEED_VENDORS, S), []);
});

test('relisted and deleted listings are left out', () => {
  for (const status of ['relisted', 'deleted']) {
    assert.deepEqual(repricePrints([{ ...cactus, status }], ART, COSTS, SEED_VENDORS, S), []);
  }
});

// --- originals -------------------------------------------------------------

test('an original under its floor is flagged with the rate it actually pays', () => {
  const portrait = newArtwork({
    id: 'p', title: 'Portrait', disposition: 'available',
    hours: 35, materials_cost: 25, asking_price: 150,
  });
  const [row] = repriceOriginals([portrait], S);
  assert.equal(row.severity, 'losing', 'under half the target rate');
  assert.ok(row.suggested > 1000);
  assert.match(row.reason, /an hour against your \$25 target/);
});

test('an original with no hours gets no floor, and says why', () => {
  const piece = newArtwork({ id: 'q', title: 'q', disposition: 'available', asking_price: 250 });
  const [row] = repriceOriginals([piece], S);
  assert.equal(row.needsHours, true);
  assert.equal(row.suggested, null);
  assert.equal(row.severity, 'ok', 'an unknown is not a finding');
});

test('a well-priced original is left alone', () => {
  const piece = newArtwork({
    id: 'r', title: 'r', disposition: 'available', hours: 14, materials_cost: 30, asking_price: 500,
  });
  const [row] = repriceOriginals([piece], S);
  assert.equal(row.severity, 'ok');
  assert.equal(row.gap, 0);
});

test('sold pieces are not repriced', () => {
  const sold = newArtwork({ id: 's', title: 's', disposition: 'sold', hours: 40, asking_price: 150 });
  assert.deepEqual(repriceOriginals([sold], S), []);
});

// --- the whole list --------------------------------------------------------

test('recommendations put the worst first', () => {
  const losing = { ...cactus, id: 'l', variants: [{ label: '24 × 16', width_in: 16, height_in: 24, price: 90 }] };
  const rows = recommendations({
    artworks: [...ART, newArtwork({ id: 'ok', title: 'ok', disposition: 'available', hours: 14, materials_cost: 30, asking_price: 500 })],
    listings: [losing, cactus], costRows: COSTS, vendors: SEED_VENDORS, settings: S,
  });
  assert.equal(rows[0].severity, 'losing');
  assert.equal(rows[rows.length - 1].severity, 'ok');
});

test('the summary counts what needs doing', () => {
  const rows = recommendations({
    artworks: ART, listings: [cactus], costRows: COSTS, vendors: SEED_VENDORS, settings: S,
  });
  const counts = summarise(rows);
  assert.equal(counts.total, 2);
  assert.equal(counts.thin, 2);
  assert.equal(counts.needsAttention, 2);
  // $92.35 short at 18 × 12 plus $191.72 at 24 × 16.
  assert.equal(counts.perSale, 284.07);
});

test('nothing to price is not an error', () => {
  assert.deepEqual(recommendations({ settings: S }), []);
  assert.equal(summarise([]).total, 0);
});
