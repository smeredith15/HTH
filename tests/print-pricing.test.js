import test from 'node:test';
import assert from 'node:assert/strict';
import {
  landedCost, finishingCost, breakEven, priceForMargin, marginAt, priceGuidance,
  compareVendors, costAnomalies, sameSize, costForVariant,
} from '../app/listing/print-pricing.js';
import {
  buildTemplate, toCSV, parseCSV, applyCSV, CSV_COLUMNS, SEED_VENDORS, PRODUCT_LINES,
  SEED_SIZES, lineFor,
} from '../app/store/print-costs.js';
import { checkPrintMargin } from '../app/listing/validators.js';
import { DEFAULT_SETTINGS as S } from '../app/store/settings.js';

const CANVASCHAMP = SEED_VENDORS.find((v) => v.name === 'CanvasChamp');
const NATIONS = SEED_VENDORS.find((v) => v.name === 'Nations Photo Lab');

const row = (patch) => ({ vendor: 'CanvasChamp', substrate: 'canvas', width_in: 16, height_in: 20, unit_cost: 20, ship_each: 6, ...patch });

// Both labs drop-ship, so this is the shape that matters. The other two modes
// stay tested because they are still offered.
const POSTS_IT_HIMSELF = { ...CANVASCHAMP, fulfilment: 'receive_and_ship' };

// --- landed cost ----------------------------------------------------------

test('landed cost adds the legs the vendor does not cover', () => {
  // receive_and_ship: lab cost + inbound + postage out + packaging
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);
  assert.equal(cost.total, 20 + 6 + 12 + 2.5);
});

test('both seeded labs drop-ship, so Scott never touches a print', () => {
  for (const vendor of SEED_VENDORS) {
    assert.equal(vendor.fulfilment, 'dropship', vendor.name);
  }
  const cost = landedCost(row(), CANVASCHAMP, S);
  assert.equal(cost.total, 26, 'lab cost plus the lab\u2019s shipping, and nothing else');
  assert.equal(cost.outbound, 0);
  assert.equal(cost.packaging, 0);
});

test('collecting in person saves the inbound leg', () => {
  const collected = { ...POSTS_IT_HIMSELF, fulfilment: 'local_pickup' };
  const cost = landedCost(row({ ship_each: 6 }), collected, S);
  assert.equal(cost.inbound, 0, 'collected in person');
  assert.equal(cost.total, 20 + 0 + 12 + 2.5);
});

// Nations is local but offers no in-person collection, and their postage is
// likely cheaper than Scott's, so they ship straight to the buyer.
test('Nations drop-ships, so Scott posts nothing', () => {
  assert.equal(NATIONS.fulfilment, 'dropship');
  const cost = landedCost(row({ unit_cost: 34, ship_each: 8 }), NATIONS, S);
  assert.equal(cost.outbound, 0);
  assert.equal(cost.packaging, 0);
  assert.equal(cost.total, 42, 'the lab\u2019s own shipping charge is the only postage');
});

// --- finishing ------------------------------------------------------------

test('CanvasChamp quotes a finished piece; Nations quotes a bare print', () => {
  const cc = PRODUCT_LINES.filter((l) => l.vendor === 'CanvasChamp');
  assert.ok(cc.every((l) => l.finishing === null), 'nothing to add');
  assert.ok(cc.every((l) => l.includes.includes('hanging hardware')));

  const npl = PRODUCT_LINES.filter((l) => l.vendor === 'Nations Photo Lab');
  assert.ok(npl.every((l) => l.finishing?.pct === 0.5));
  assert.ok(npl.every((l) => l.includes.length === 0));
});

test('mounting is half the base print price', () => {
  assert.equal(finishingCost({ mounted: true, unit_cost: 34, finishing_pct: 0.5 }), 17);
  assert.equal(finishingCost({ mounted: true, unit_cost: 79, finishing_pct: 0.5 }), 39.5);
});

test('a flat mounting figure overrides the percentage', () => {
  assert.equal(finishingCost({ mounted: true, unit_cost: 34, finishing_pct: 0.5, finishing_cost: 12 }), 12);
});

test('nothing is added when the print is sold unmounted', () => {
  assert.equal(finishingCost({ mounted: false, unit_cost: 34, finishing_pct: 0.5 }), 0);
  assert.equal(finishingCost({ unit_cost: 34 }), 0);
  assert.equal(finishingCost(null), 0);
});

test('mounting lands in the total, not beside it', () => {
  const bare = landedCost(row({ unit_cost: 34, ship_each: 8 }), NATIONS, S);
  const mounted = landedCost(
    row({ unit_cost: 34, ship_each: 8, mounted: true, finishing_pct: 0.5 }), NATIONS, S,
  );
  assert.equal(mounted.finishing, 17);
  assert.equal(mounted.total, bare.total + 17);
  assert.ok(priceForMargin(mounted, S, 0.55) > priceForMargin(bare, S, 0.55));
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
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);
  const price = breakEven(cost, S);
  const at = marginAt(price, cost, S);
  assert.ok(Math.abs(at.profit) < 0.01, `profit at break even was $${at.profit}`);
});

test('the target price really pays the target margin', () => {
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);
  const price = priceForMargin(cost, S, 0.55);
  const at = marginAt(price, cost, S);
  assert.ok(Math.abs(at.margin - 0.55) < 0.001, `margin was ${at.margin}`);
});

test('a margin the fees cannot leave room for has no answer', () => {
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);
  assert.equal(priceForMargin(cost, S, 0.95), null, '95% margin on top of 9.5% fees is impossible');
  assert.ok(priceForMargin(cost, S, 0.7) > 0);
});

test('Offsite Ads raise both the break even and the target', () => {
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);
  assert.ok(breakEven(cost, S, { includeOffsiteAds: true }) > breakEven(cost, S));
});

test('marginAt reports fees, profit, margin and the markup multiple', () => {
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);   // $40.50 landed
  const at = marginAt(100, cost, S);
  assert.equal(at.cost, 40.5);
  assert.equal(at.fees, Math.round((100 * 0.095 + 0.25 + 0.2) * 100) / 100);
  assert.equal(at.profit, Math.round((100 - at.fees - 40.5) * 100) / 100);
  assert.ok(at.multiple > 2.4 && at.multiple < 2.5);
});

test('a price below cost reports a loss rather than a small margin', () => {
  const cost = landedCost(row(), POSTS_IT_HIMSELF, S);
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

// The honest comparison is ready-to-hang against ready-to-hang: a $20
// CanvasChamp canvas arrives with hardware on it, a $34 Nations giclée is a
// bare sheet until $17 of foamcore is added.
test('comparing labs sorts cheapest first, mounting included', () => {
  // Scott's real 16 × 20 numbers: $22.27 canvas, $39.85 giclée paper.
  const rows = [
    row({
      vendor: 'Nations Photo Lab', substrate: 'paper', process: 'giclee',
      unit_cost: 39.85, ship_each: 9.95, mounted: true, finishing_pct: 0.5,
    }),
    row({ vendor: 'CanvasChamp', substrate: 'canvas', process: 'digital', unit_cost: 22.27, ship_each: 9.99 }),
  ];
  const options = compareVendors(rows, SEED_VENDORS, S, { width_in: 16, height_in: 20 });
  assert.equal(options.length, 2);
  assert.equal(options[0].row.vendor, 'CanvasChamp');
  assert.equal(options[0].cost.total, 32.26);
  assert.equal(options[1].cost.total, 69.73, 'print plus a $19.93 mount plus their postage');
  assert.ok(options[1].target > options[0].target * 2, 'giclée more than doubles the shelf price');
});

test('a comparison row says whether it is ready to hang and whether the lab is checked', () => {
  const rows = [
    row({ vendor: 'CanvasChamp', unit_cost: 20, ship_each: 6 }),
    row({ vendor: 'Nations Photo Lab', substrate: 'paper', unit_cost: 34, ship_each: 8, mounted: true, finishing_pct: 0.5 }),
  ];
  const options = compareVendors(rows, SEED_VENDORS, S, { width_in: 16, height_in: 20 });
  const cc = options.find((o) => o.row.vendor === 'CanvasChamp');
  const npl = options.find((o) => o.row.vendor === 'Nations Photo Lab');
  assert.equal(cc.readyToHang, true);
  assert.equal(cc.qualityChecked, true, 'CanvasChamp has produced good work before');
  assert.equal(npl.qualityChecked, false, 'Nations is assumed good, not proved');
});

test('an unmounted Nations print is not ready to hang', () => {
  const bare = row({
    vendor: 'Nations Photo Lab', unit_cost: 34, mounted: false, finishing_pct: 0.5,
  });
  assert.equal(landedCost(bare, NATIONS, S).readyToHang, false);
});

test('a lab with no price quoted is left out of the comparison', () => {
  const rows = [row({ unit_cost: 20 }), row({ vendor: 'Nations Photo Lab', unit_cost: null })];
  assert.equal(compareVendors(rows, SEED_VENDORS, S, { width_in: 16, height_in: 20 }).length, 1);
});

// --- cost sanity (real CanvasChamp and Nations numbers, 22 September 2026) --

const line = (key, sizes) => sizes.map(([w, h, cost]) => ({
  id: `${key}-${w}x${h}`, line: key, width_in: w, height_in: h, unit_cost: cost,
}));

test('a meaningfully larger print costing meaningfully less is flagged', () => {
  // CanvasChamp canvas: 18 × 36 at $47.55 against 24 × 36 at $32.00.
  const rows = line('cc-canvas', [[16, 20, 22.27], [18, 36, 47.55], [24, 36, 32.00]]);
  const found = costAnomalies(rows);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'inverted');
  assert.match(found[0].message, /18 × 36/);
  assert.match(found[0].message, /promotion|typo/);
});

test('a lumpy size ladder is not an anomaly', () => {
  // 12 × 24 is 288 sq in at $22.76; 16 × 20 is 320 sq in at $22.27. Forty-nine
  // cents across a 10% area step is granularity, not an error.
  const rows = line('cc-canvas', [[12, 18, 20.14], [12, 24, 22.76], [16, 20, 22.27], [16, 24, 26.01]]);
  assert.deepEqual(costAnomalies(rows), []);
});

test('small sizes costing far more per square inch is normal, not a finding', () => {
  // 8 × 10 canvas runs about 17¢/sq in against 6¢ at 16 × 20. Real, and fine.
  const rows = line('cc-canvas', [
    [8, 10, 13.93], [12, 12, 17.27], [16, 20, 22.27], [18, 24, 25.26], [20, 30, 31.09],
  ]);
  assert.deepEqual(costAnomalies(rows), []);
});

test('a misplaced decimal point is still caught', () => {
  const rows = line('cc-canvas', [[8, 10, 13.93], [12, 12, 17.27], [16, 20, 2227], [18, 24, 25.26]]);
  const found = costAnomalies(rows);
  assert.ok(found.some((a) => a.kind === 'outlier' && /decimal/.test(a.message)));
});

test('one finding per row, and a short line is left alone', () => {
  const rows = line('cc-canvas', [[16, 20, 22.27], [24, 36, 32.00]]);
  assert.deepEqual(costAnomalies(rows), [], 'two sizes prove nothing');
  const unpriced = line('cc-canvas', [[8, 10, null], [16, 20, null], [24, 36, null]]);
  assert.deepEqual(costAnomalies(unpriced), []);
});

// --- the real numbers -----------------------------------------------------

test('the MDF line cannot carry the shop\u2019s current print prices', () => {
  // CanvasChamp wood 16 × 24 at $107.32 plus $9.99 drop-ship shipping. The
  // cactus print sells that size at $140.
  const row = { unit_cost: 107.32, ship_each: 9.99 };
  const dropship = { fulfilment: 'dropship' };
  const cost = landedCost(row, dropship, S);
  assert.equal(cost.total, 117.31);
  const at = marginAt(140, cost, S);
  assert.ok(at.profit > 0, 'it does at least clear cost');
  assert.ok(at.margin < 0.1, `only ${(at.margin * 100).toFixed(0)}% margin`);
  // Reaching the target margin would mean a price nobody pays for a print.
  assert.ok(priceForMargin(cost, S, 0.55) > 300);
});

test('the same image on canvas costs a third as much', () => {
  const dropship = { fulfilment: 'dropship' };
  const wood = landedCost({ unit_cost: 107.32, ship_each: 9.99 }, dropship, S);
  const canvas = landedCost({ unit_cost: 26.01, ship_each: 9.99 }, dropship, S);
  assert.equal(canvas.total, 36.00);
  assert.ok(wood.total > canvas.total * 3);
});

// --- the template ---------------------------------------------------------

test('the template carries each line\u2019s finishing rule', () => {
  const rows = buildTemplate();
  for (const row of rows) {
    const line = lineFor(row.line);
    assert.equal(row.finishing_pct, line.finishing?.pct ?? null, row.id);
    assert.equal(row.mounted, !!line.finishing, row.id);
    assert.equal(row.finishing_cost, null, 'no mounting figure is invented either');
  }
});

test('CSV carries the mounting columns', () => {
  assert.ok(CSV_COLUMNS.includes('finishing_cost'));
  assert.ok(CSV_COLUMNS.includes('mounted'));
  const rows = buildTemplate();
  const target = rows.find((r) => r.line === 'npl-paper');
  const result = applyCSV(`id,unit_cost,finishing_cost,mounted\n${target.id},34,15,yes`, rows);
  assert.equal(result.updated[0].finishing_cost, 15);
  assert.equal(result.updated[0].mounted, true);
});

test('mounted reads the words a spreadsheet actually produces', () => {
  const rows = buildTemplate();
  const target = rows.find((r) => r.line === 'npl-paper');
  for (const [text, expected] of [['yes', true], ['TRUE', true], ['1', true], ['no', false], ['FALSE', false]]) {
    const result = applyCSV(`id,mounted\n${target.id},${text}`, rows.map((r) => ({ ...r, mounted: null })));
    assert.equal(result.updated[0].mounted, expected, text);
  }
});

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

// Sizes added on one device have to survive the trip to another, and an
// export has to be able to rebuild a catalogue browser storage has thrown
// away. Scott's own file carries fourteen sizes the seed never had.
test('a size this device has not seen is created, not dropped', () => {
  const csv = 'id,vendor,product,substrate,process,width_in,height_in,unit_cost\n'
    + 'pc-npl-paper-30x40-8651,Nations Photo Lab,Giclée on fine-art paper,paper,giclee,30,40,119.75';
  const result = applyCSV(csv, buildTemplate());
  assert.deepEqual(result.created, ['pc-npl-paper-30x40-8651']);
  assert.equal(result.updated.length, 1);
  const made = result.updated[0];
  assert.equal(made.unit_cost, 119.75);
  assert.equal(made.line, 'npl-paper');
  assert.equal(made.width_in, 30);
  assert.equal(made.finishing_pct, 0.5, 'a created row inherits its line\u2019s mounting rule');
  assert.equal(made.mounted, true);
});

test('the line is read from the id even without vendor columns', () => {
  const csv = 'id,width_in,height_in,unit_cost\npc-cc-wood-12x24-3414,12,24,81.61';
  const [made] = applyCSV(csv, buildTemplate()).updated;
  assert.equal(made.line, 'cc-wood');
  assert.equal(made.vendor, 'CanvasChamp');
  assert.equal(made.substrate, 'mdf');
  assert.equal(made.finishing_pct, null, 'CanvasChamp needs no mount');
});

test('a row with no usable size is still refused', () => {
  const result = applyCSV('id,unit_cost\nnot-a-real-row,20', buildTemplate());
  assert.deepEqual(result.unknown, ['not-a-real-row']);
  assert.equal(result.updated.length, 0);
  assert.equal(result.created.length, 0);
});

test('a whole export rebuilds from nothing', () => {
  const full = buildTemplate().map((r, i) => ({ ...r, unit_cost: 10 + i }));
  const result = applyCSV(toCSV(full), []);
  assert.equal(result.created.length, full.length);
  assert.equal(result.updated.length, full.length);
  assert.equal(result.unknown.length, 0);
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
  const findings = checkPrintMargin(printListing(25), S, context(20));
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
  assert.deepEqual(checkPrintMargin(printListing(25), S, context(null)), []);
  assert.deepEqual(checkPrintMargin(printListing(25), S, {}), []);
});

test('the check only applies to prints', () => {
  const original = { ...printListing(25), listing_type: 'original' };
  assert.deepEqual(checkPrintMargin(original, S, context(20)), []);
});
