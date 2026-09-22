import test from 'node:test';
import assert from 'node:assert/strict';
import { etsyFees, feesFor, saleNet, saleHourly, breakdown } from '../app/store/sales.js';
import { projectQueue, capacity, remainingHours, isOpen, goneQuiet } from '../app/store/commissions.js';
import { totalsByCategory, yearSummary, yearsPresent, yearOf } from '../app/store/expenses.js';
import {
  hourlyByCategory, hourlyByFace, hourlyByRelationship, overallHourly, whatPays, ratedSales,
} from '../app/reports/hourly.js';
import { newSale, newCommission, newExpense, newCustomer, newArtwork, COMMISSION_OPEN } from '../app/store/schema.js';
import { DEFAULT_SETTINGS as S } from '../app/store/settings.js';

// --- a sale's arithmetic (§5.6) -------------------------------------------

test('Etsy takes its percentage plus the fixed fees', () => {
  const sale = newSale({ gross_price: 100, shipping_charged: 0, channel: 'etsy' });
  // 100 × 9.5% + 0.25 + 0.20
  assert.equal(etsyFees(sale, S), 9.95);
});

test('shipping charged to the buyer is part of what Etsy takes a cut of', () => {
  const sale = newSale({ gross_price: 100, shipping_charged: 20, channel: 'etsy' });
  assert.equal(etsyFees(sale, S), round(120 * 0.095 + 0.45));
});

test('Offsite Ads only bite when the order came from Offsite Ads', () => {
  const plain = newSale({ gross_price: 200, channel: 'etsy', source: 'etsy_search' });
  const ads = newSale({ gross_price: 200, channel: 'etsy', source: 'offsite_ads' });
  assert.equal(round(etsyFees(ads, S) - etsyFees(plain, S)), 30, '15% of $200');
});

test('the Offsite Ads cap applies', () => {
  const big = newSale({ gross_price: 2000, channel: 'etsy', source: 'offsite_ads' });
  const plain = newSale({ gross_price: 2000, channel: 'etsy', source: 'etsy_search' });
  assert.equal(round(etsyFees(big, S) - etsyFees(plain, S)), 100, 'capped at $100 per order');
});

test('a fair sale pays Etsy nothing', () => {
  const sale = newSale({ gross_price: 150, channel: 'fair', fees: null });
  assert.equal(feesFor(sale, S), 0);
});

test('a fee figure entered by hand wins over the calculation', () => {
  const sale = newSale({ gross_price: 100, channel: 'etsy', fees: 12.34 });
  assert.equal(feesFor(sale, S), 12.34);
});

test('net follows §5.6 exactly', () => {
  const sale = newSale({
    gross_price: 285, shipping_charged: 0, channel: 'etsy', source: 'etsy_search',
    shipping_cost: 18, materials_cost: 22,
  });
  // Etsy charges whole cents, so the fee is rounded before it is subtracted:
  // 285 × 9.5% + 0.45 = 27.525 → $27.53. Then 285 − 27.53 − 18 − 22.
  assert.equal(feesFor(sale, S), 27.53);
  assert.equal(saleNet(sale, S), 217.47);
});

test('the invisible hourly rate becomes visible (§1.1)', () => {
  // A portrait at $150 for 35 hours, sold offline to a friend.
  const sale = newSale({ gross_price: 150, channel: 'offline', fees: 0, materials_cost: 25, hours: 35 });
  const rate = saleHourly(sale, S);
  assert.ok(rate > 3 && rate < 4, `$${rate} an hour`);
  assert.ok(rate < S.target_hourly / 6, 'nowhere near the $25 target');
});

test('no hours means no rate, rather than a made-up one', () => {
  assert.equal(saleHourly(newSale({ gross_price: 150, hours: null }), S), null);
  assert.equal(breakdown(newSale({ gross_price: 150 }), S).hourly, null);
});

// --- the commission queue (§5.8) ------------------------------------------

const commission = (patch) => newCommission({ status: 'accepted', estimated_hours: 35, ...patch });

test('only work that is actually underway consumes bench time', () => {
  assert.deepEqual(COMMISSION_OPEN, ['accepted', 'in_progress', 'awaiting_approval']);
  assert.equal(isOpen(commission({ status: 'inquiry' })), false, 'an inquiry is not a commitment');
  assert.equal(isOpen(commission({ status: 'delivered' })), false);
  assert.equal(isOpen(commission({ status: 'in_progress' })), true);
});

test('hours already done come off the estimate', () => {
  assert.equal(remainingHours(commission({ estimated_hours: 40, actual_hours: 15 }), S), 25);
  assert.equal(remainingHours(commission({ estimated_hours: 40, actual_hours: 60 }), S), 0, 'never negative');
  assert.equal(remainingHours(commission({ estimated_hours: null }), S), 35, 'falls back to typical');
});

test('the queue is worked in ship_by order and stacks up', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const { rows } = projectQueue([
    commission({ id: 'late', ship_by: '2026-12-01', estimated_hours: 40 }),
    commission({ id: 'first', ship_by: '2026-11-01', estimated_hours: 16 }),
  ], S, now);
  assert.deepEqual(rows.map((r) => r.commission.id), ['first', 'late']);
  assert.equal(rows[0].cumulativeHours, 16);
  assert.equal(rows[1].cumulativeHours, 56, 'the second waits for the first');
});

// This is the whole point of §5.8: it is what makes a quantity above 1 safe.
test('a commission that cannot finish in time is flagged', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  // 8 hours a week: 40 hours is five weeks, so a ship_by two weeks out misses.
  const { rows } = projectQueue([commission({ ship_by: '2026-10-15', estimated_hours: 40 })], S, now);
  assert.equal(rows[0].late, true);
  assert.ok(rows[0].daysSpare < 0);
  assert.equal(rows[0].projectedFinish, '2026-11-05');
});

test('a comfortable deadline is not flagged', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const { rows } = projectQueue([commission({ ship_by: '2026-12-25', estimated_hours: 16 })], S, now);
  assert.equal(rows[0].late, false);
  assert.ok(rows[0].daysSpare > 50);
});

test('an earlier commission can push a later one past its date', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const alone = projectQueue([commission({ id: 'b', ship_by: '2026-11-20', estimated_hours: 30 })], S, now);
  assert.equal(alone.rows[0].late, false, 'on its own it makes it');

  const queued = projectQueue([
    commission({ id: 'a', ship_by: '2026-10-20', estimated_hours: 40 }),
    commission({ id: 'b', ship_by: '2026-11-20', estimated_hours: 30 }),
  ], S, now);
  assert.equal(queued.rows.find((r) => r.commission.id === 'b').late, true, 'behind the first one it does not');
});

test('capacity says how many more will fit (§5.8)', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  // 12 weeks at 8 hours = 96 hours, one 35-hour commission booked.
  const free = capacity([commission({ ship_by: '2026-11-01' })], S, { horizon: '2026-12-24', now });
  assert.equal(free.committedHours, 35);
  assert.ok(free.availableHours >= 90 && free.availableHours <= 100);
  assert.equal(free.canAccept, 1, '61 free hours fits one more 35-hour piece');
});

test('a full queue accepts nothing more', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const full = capacity(
    [commission({ estimated_hours: 50 }), commission({ estimated_hours: 50 })],
    S, { horizon: '2026-11-15', now },
  );
  assert.equal(full.canAccept, 0);
  assert.ok(full.freeHours < 0, 'already over-committed');
});

test('with no horizon there is no capacity claim', () => {
  assert.equal(capacity([], S, {}).canAccept, null);
});

test('past commission customers who went quiet, and only those who agreed', () => {
  const now = new Date('2026-09-22T00:00:00Z');
  const customers = [
    newCustomer({ id: 'quiet', name: 'Quiet', ok_to_contact: true }),
    newCustomer({ id: 'recent', name: 'Recent', ok_to_contact: true }),
    newCustomer({ id: 'no-contact', name: 'Asked not to be', ok_to_contact: false }),
  ];
  const commissions = [
    newCommission({ id: 'c1', customer_id: 'quiet', updated_at: '2026-01-05T00:00:00Z' }),
    newCommission({ id: 'c2', customer_id: 'recent', updated_at: '2026-09-01T00:00:00Z' }),
    newCommission({ id: 'c3', customer_id: 'no-contact', updated_at: '2025-01-05T00:00:00Z' }),
  ];
  const rows = goneQuiet(commissions, customers, { now });
  assert.deepEqual(rows.map((r) => r.customer.id), ['quiet'], '§5.7: only reach out if they agreed');
});

// --- expenses --------------------------------------------------------------

test('expenses total by category, newest year filtered', () => {
  const expenses = [
    newExpense({ id: 'a', date: '2026-03-01', amount: 62.4, category: 'wood' }),
    newExpense({ id: 'b', date: '2026-04-01', amount: 30, category: 'wood' }),
    newExpense({ id: 'c', date: '2026-05-01', amount: 120, category: 'tools' }),
    newExpense({ id: 'd', date: '2025-05-01', amount: 999, category: 'tools' }),
  ];
  assert.deepEqual(totalsByCategory(expenses, 2026), [
    { category: 'tools', amount: 120 },
    { category: 'wood', amount: 92.4 },
  ]);
  assert.deepEqual(yearsPresent([], expenses), ['2026', '2025']);
  assert.equal(yearOf('2026-03-01'), '2026');
});

test('a year in one line', () => {
  const sales = [
    newSale({ id: 's1', date: '2026-02-01', channel: 'fair', fees: 0, gross_price: 285, materials_cost: 22, hours: 14 }),
    newSale({ id: 's2', date: '2026-06-01', channel: 'fair', fees: 0, gross_price: 150, materials_cost: 25, hours: 35 }),
    newSale({ id: 'old', date: '2025-06-01', channel: 'fair', fees: 0, gross_price: 9999 }),
  ];
  const expenses = [newExpense({ id: 'e', date: '2026-03-01', amount: 120, category: 'tools' })];
  const year = yearSummary(sales, expenses, S, 2026);
  assert.equal(year.orders, 2);
  assert.equal(year.gross, 435);
  assert.equal(year.net, 388, '435 − 47 of materials');
  assert.equal(year.expenses, 120);
  assert.equal(year.profit, 268);
  assert.equal(year.hours, 49);
  assert.equal(year.hourly, round(268 / 49));
});

// --- what actually pays (§6.4, §C.2) ---------------------------------------

const ART = [
  newArtwork({ id: 'tower', title: 'Assateague', category: 'lighthouse', has_face: false }),
  newArtwork({ id: 'tower2', title: 'Hatteras', category: 'lighthouse', has_face: false }),
  newArtwork({ id: 'brady', title: 'Tom Brady', category: 'sports', has_face: true }),
  newArtwork({ id: 'bias', title: 'Len Bias', category: 'sports', has_face: true }),
];

// §C.2: tower lighthouses run 10–15 hours; faces take 20–50+ regardless of size.
const SALES = [
  newSale({ id: '1', artwork_id: 'tower', gross_price: 400, channel: 'fair', fees: 0, hours: 12, relationship: 'stranger' }),
  newSale({ id: '2', artwork_id: 'tower2', gross_price: 380, channel: 'fair', fees: 0, hours: 14, relationship: 'stranger' }),
  newSale({ id: '3', artwork_id: 'brady', gross_price: 150, channel: 'offline', fees: 0, hours: 40, relationship: 'friend' }),
  newSale({ id: '4', artwork_id: 'bias', gross_price: 150, channel: 'offline', fees: 0, hours: 35, relationship: 'friend' }),
];

test('effective hourly by category makes the difference obvious (§6.4)', () => {
  const rows = hourlyByCategory(SALES, ART, S);
  assert.equal(rows[0].key, 'lighthouse');
  assert.equal(rows[rows.length - 1].key, 'sports');
  assert.ok(rows[0].hourly > 25, `lighthouses pay $${rows[0].hourly}`);
  assert.ok(rows[rows.length - 1].hourly < 5, `sports portraits pay $${rows[rows.length - 1].hourly}`);
  assert.ok(rows[0].hourly > rows[rows.length - 1].hourly * 6);
});

test('the rate is pooled, not an average of averages', () => {
  const rows = hourlyByCategory(SALES, ART, S);
  const towers = rows.find((r) => r.key === 'lighthouse');
  assert.equal(towers.hours, 26);
  assert.equal(towers.net, 780);
  assert.equal(towers.hourly, round(780 / 26));
});

test('faces against no faces', () => {
  const rows = hourlyByFace(SALES, ART, S);
  const faces = rows.find((r) => r.key === 'face');
  const plain = rows.find((r) => r.key === 'no_face');
  assert.ok(plain.hourly > faces.hourly * 6);
  assert.equal(faces.label, 'Has a face');
});

test('selling to friends distorts the signal, and is separable (§5.6)', () => {
  const rows = hourlyByRelationship(SALES, ART, S);
  assert.equal(rows[0].key, 'stranger');
  assert.equal(rows[rows.length - 1].key, 'friend');
});

test('sales with no hours are counted as unrated, not as zero', () => {
  const withBlank = [...SALES, newSale({ id: '5', artwork_id: 'tower', gross_price: 400, hours: null })];
  const overall = overallHourly(withBlank, ART, S);
  assert.equal(overall.sales, 4);
  assert.equal(overall.unrated, 1);
  assert.equal(ratedSales(withBlank, ART, S).length, 4);
});

test('hours fall back to the artwork when the sale did not record them', () => {
  const art = [newArtwork({ id: 'x', title: 'x', category: 'coastal', hours: 20 })];
  const sales = [newSale({ id: 's', artwork_id: 'x', gross_price: 400, channel: 'fair', fees: 0, hours: null })];
  assert.equal(ratedSales(sales, art, S)[0].hours, 20);
});

test('one sale is an anecdote, not a signal', () => {
  const single = [SALES[0], SALES[2]];
  assert.equal(whatPays(single, ART, S), null, 'needs two of each before it claims anything');
  const verdict = whatPays(SALES, ART, S);
  assert.equal(verdict.best.key, 'lighthouse');
  assert.equal(verdict.worst.key, 'sports');
});

function round(value) { return Math.round(value * 100) / 100; }
