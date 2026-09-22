import test from 'node:test';
import assert from 'node:assert/strict';
import {
  landedCost, breakEven, priceForMargin, marginAt, priceGuidance,
  compareVendors, sameSize, costForVariant,
} from '../app/listing/print-pricing.js';
import {
  buildTemplate, toCSV, parseCSV, applyCSV, CSV_COLUMNS, SEED_VENDORS, PRODUCT_LINES, SEED_SIZES,
} from '../app/store/print-costs.js';
import { checkPrintMargin } from '../app/listing/validators.js';
import { DEFAULT_SETTINGS as S } from '../app/store/settings.js';

const CANVASCHAMP = SEED_VENDORS.find((v) => v.name === 'CanvasChamp');
const NATIONS = SEED_VENDORS.find((v) => v.name === 'Nations Photo Lab');

const row = (patch) => ({ vendor: 'CanvasChamp', substrate: 'canvas', width_in: 16, height_in: 20, unit_cost: 20, ship_each: 6, ...patch });

// --- landed cost ----------------------------------------------------------

test('landed cost adds the legs the vendor does not cover', () => {
  // receive_and_ship: lab cost + inbound + postage out + packaging
  const cost = landedCost(row(), CANVASCHAMP, S);
  assert.equal(cost.total, 20 + 6 + 12 + 2.5);
});

test('a local lab saves the inbound leg', () => {
  const cost = landedCost(row({ ship_each: 6 }), NATIONS, S);
  assert.equal(cost.inbound, 0, 'collected in person');
  assert.equal(cost.total, 20 + 0 + 12 + 2.5);
});

test('a drop-shipping lab means no postage and no packaging of your own', () => {
  const dropship = { ...CANVASCHAMP, fulfilment: 'dropship' };
  const cost = landedCost(row({ ship_each: 8 }), dropship, S);
  assert.equal(cost.outbound, 0);
  assert.equal(cost.packaging, 0);
  assert.equal(cost.total, 28);
});

test('no lab cost means no answer at all, never a guess', () => {
  assert.equal(landedCost(row({ unit_cost: null }), CANVASCHAMP, S), null);
  assert.equal(landedCost(row({ unit_cost: 0 }), CANVASCHAMP, S), null);
  assert.equal(landedCost(undefined, CANVASCHAMP, S), null);
  assert.equal(priceGuidance(50, row({ unit_cost: null }), CANVASCHAMP, S).known, false);
});

// --- the arithmetic -------------------------------------------------------

test('break even really breaks even', () => {
  const cost = landedCost(row(), CANVASCHAMP, S);
  const price = breakEven(cost, S);
  const at = marginAt(price, cost, S);
  assert.ok(Math.abs(at.profit) < 0.01, `profit at break even was $${at.profit}`);
});

test('the target price really pays the target margin', () => {
  const cost = landedCost(row(), CANVASCHAMP, S);
  const price = priceForMargin(cost, S, 0.55);
  const at = marginAt(price, cost, S);
  assert.ok(Math.abs(at.margin - 0.55) < 0.001, `margin was ${at.margin}`);
});

test('a margin the fees cannot leave room for has no answer', () => {
  const cost = landedCost(row(), CANVASCHAMP, S);
  assert.equal(priceForMargin(cost, S, 0.95), null, '95% margin on top of 9.5% fees is impossible');
  assert.ok(priceForMargin(cost, S, 0.7) > 0);
});

test('Offsite Ads raise both the break even and the target', () => {
  const cost = landedCost(row(), CANVASCHAMP, S);
  assert.ok(breakEven(cost, S, { includeOffsiteAds: true }) > breakEven(cost, S));
});

test('marginAt reports fees, profit, margin and the markup multiple', () => {
  const cost = landedCost(row(), CANVASCHAMP, S);   // $40.50 landed
  const at = marginAt(100, cost, S);
  assert.equal(at.cost, 40.5);
  assert.equal(at.fees, Math.round((100 * 0.095 + 0.25 + 0.2) * 100) / 100);
  assert.equal(at.profit, Math.round((100 - at.fees - 40.5) * 100) / 100);
  assert.ok(at.multiple > 2.4 && at.multiple < 2.5);
});

test('a price below cost reports a loss rather than a small margin', () => {
  const cost = landedCost(row(), CANVASCHAMP, S);
  const at = marginAt(25, cost, S);
  assert.ok(at.profit < 0);
  assert.ok(at.margin < 0);
});

// --- sizes and lookup -----------------------------------------------------

test('16 × 20 and 20 × 16 are the same print turned round', () => {
  assert.equal(sameSize({ width_in: 16, height_in: 20 }, { width_in: 20, height_in: 16 }), true);
  assert.equal(sameSize({ width_in: 16, height_in: 20 }, { width_in: 16, height_in: 24 }), false);
});

test('a variant finds the cost row for its own lab and substrate first', () => {
  const rows = [
    row({ vendor: 'Nations Photo Lab', substrate: 'paper', unit_cost: 30 }),
    row({ vendor: 'CanvasChamp', substrate: 'canvas', unit_cost: 20 }),
  ];
  const variant = { width_in: 20, height_in: 16 };
  const listing = { print_vendor: 'CanvasChamp', print_substrate: 'canvas' };
  assert.equal(costForVariant(variant, listing, rows).unit_cost, 20);
  // Falls back to substrate when the vendor does not match.
  assert.equal(costForVariant(variant, { print_substrate: 'paper' }, rows).unit_cost, 30);
  // A variant with no size cannot be matched.
  assert.equal(costForVariant({ label: 'from' }, listing, rows), null);
});

test('comparing labs sorts cheapest first', () => {
  const rows = [
    row({ vendor: 'Nations Photo Lab', substrate: 'paper', process: 'giclee', unit_cost: 34, ship_each: 0 }),
    row({ vendor: 'CanvasChamp', substrate: 'canvas', process: 'digital', unit_cost: 20, ship_each: 6 }),
  ];
  const options = compareVendors(rows, SEED_VENDORS, S, { width_in: 16, height_in: 20 });
  assert.equal(options.length, 2);
  assert.equal(options[0].row.vendor, 'CanvasChamp');
  assert.ok(options[1].target > options[0].target, 'giclée costs the buyer more');
});

test('a lab with no price quoted is left out of the comparison', () => {
  const rows = [row({ unit_cost: 20 }), row({ vendor: 'Nations Photo Lab', unit_cost: null })];
  assert.equal(compareVendors(rows, SEED_VENDORS, S, { width_in: 16, height_in: 20 }).length, 1);
});

// --- the template ---------------------------------------------------------

test('the template covers every line and size, and starts blank', () => {
  const rows = buildTemplate();
  assert.equal(rows.length, PRODUCT_LINES.length * SEED_SIZES.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'ids are unique');
  assert.ok(rows.every((r) => r.unit_cost === null), 'no cost is invented');
  // The sizes the live listings already sell are in there.
  for (const size of [[8, 12], [12, 12], [12, 18], [16, 24], [24, 24]]) {
    assert.ok(rows.some((r) => sameSize(r, { width_in: size[0], height_in: size[1] })), size.join('×'));
  }
});

test('one lab line is genuine giclée and the CanvasChamp lines are not', () => {
  const giclee = PRODUCT_LINES.filter((l) => l.process === 'giclee');
  assert.ok(giclee.length >= 1);
  assert.ok(giclee.every((l) => l.vendor === 'Nations Photo Lab'));
  assert.ok(PRODUCT_LINES.filter((l) => l.vendor === 'CanvasChamp').every((l) => l.process !== 'giclee'));
});

// --- CSV round trip -------------------------------------------------------

test('CSV survives a round trip through a spreadsheet', () => {
  const rows = buildTemplate();
  const filled = rows.map((r, i) => (i < 3 ? { ...r, unit_cost: 20 + i, ship_each: 6 } : r));
  const result = applyCSV(toCSV(filled), rows);
  assert.equal(result.updated.length, 3);
  assert.equal(result.unknown.length, 0);
  assert.equal(result.updated[0].unit_cost, 20);
});

test('a CSV carrying only id and unit_cost changes only the price', () => {
  const rows = buildTemplate();
  const target = rows[0];
  const csv = `id,unit_cost\n${target.id},18.50`;
  const result = applyCSV(csv, rows);
  assert.equal(result.updated.length, 1);
  assert.equal(result.updated[0].unit_cost, 18.5);
  assert.equal(result.updated[0].vendor, target.vendor, 'everything else is untouched');
  assert.equal(result.updated[0].height_in, target.height_in);
});

test('CSV handles quoted notes with commas in them', () => {
  const rows = buildTemplate();
  const csv = `id,note\n${rows[0].id},"12mm panel, matte finish"`;
  const result = applyCSV(csv, rows);
  assert.equal(result.updated[0].note, '12mm panel, matte finish');
});

test('a CSV without an id column is refused with a readable message', () => {
  assert.throws(() => applyCSV('vendor,unit_cost\nCanvasChamp,20', buildTemplate()), /must include "id"/);
  assert.throws(() => applyCSV('', buildTemplate()), /no rows/);
});

test('unknown ids are reported rather than silently creating rows', () => {
  const result = applyCSV('id,unit_cost\nnot-a-real-row,20', buildTemplate());
  assert.deepEqual(result.unknown, ['not-a-real-row']);
  assert.equal(result.updated.length, 0);
});

test('a blank cell clears a value rather than being read as zero', () => {
  const rows = buildTemplate().map((r) => ({ ...r, unit_cost: 20 }));
  const result = applyCSV(`id,unit_cost\n${rows[0].id},`, rows);
  assert.equal(result.updated[0].unit_cost, null);
});

test('CSV columns round trip through the parser', () => {
  const parsed = parseCSV(toCSV(buildTemplate().slice(0, 2)));
  assert.deepEqual(parsed[0], CSV_COLUMNS);
  assert.equal(parsed.length, 3);
});

// --- the validator --------------------------------------------------------

const context = (unit_cost) => ({
  costRows: [row({ unit_cost, width_in: 16, height_in: 20 })],
  vendors: SEED_VENDORS,
});

const printListing = (price) => ({
  listing_type: 'print', print_vendor: 'CanvasChamp', print_substrate: 'canvas',
  variants: [{ label: '16 × 20', width_in: 16, height_in: 20, price }],
});

test('a print priced below what it costs is serious, not a suggestion', () => {
  const findings = checkPrintMargin(printListing(30), S, context(20));
  assert.equal(findings[0].id, 'print_below_cost');
  assert.equal(findings[0].level, 'stop');
  assert.match(findings[0].message, /loses money/);
});

test('a print under the target margin is only a note', () => {
  const cost = landedCost(row({ unit_cost: 20 }), CANVASCHAMP, S);
  const price = Math.round((breakEven(cost, S) + priceForMargin(cost, S, 0.55)) / 2);
  const findings = checkPrintMargin(printListing(price), S, context(20));
  assert.equal(findings[0].id, 'print_margin');
  assert.equal(findings[0].level, 'note');
});

test('a print at the target margin says nothing', () => {
  const cost = landedCost(row({ unit_cost: 20 }), CANVASCHAMP, S);
  const price = priceForMargin(cost, S, 0.55);
  assert.deepEqual(checkPrintMargin(printListing(price + 1), S, context(20)), []);
});

test('with no cost recorded the check stays quiet', () => {
  assert.deepEqual(checkPrintMargin(printListing(30), S, context(null)), []);
  assert.deepEqual(checkPrintMargin(printListing(30), S, {}), []);
});

test('the check only applies to prints', () => {
  const original = { ...printListing(30), listing_type: 'original' };
  assert.deepEqual(checkPrintMargin(original, S, context(20)), []);
});
