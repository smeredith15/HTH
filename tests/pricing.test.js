import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, withDefaults, feeRate, priceFloor, impliedHourly,
} from '../app/store/settings.js';

const S = DEFAULT_SETTINGS;

test('fee rate adds transaction and processing, and offsite ads only on request', () => {
  assert.equal(feeRate(S), 0.095);                              // 6.5% + 3.0%
  assert.equal(feeRate(S, { includeOffsiteAds: true }), 0.245); // + 15%
});

test('an unenrolled shop pays no offsite-ads rate', () => {
  const s = withDefaults({ offsite_ads_enrolled: false });
  assert.equal(feeRate(s, { includeOffsiteAds: true }), 0.095);
});

test('price floor follows §8.1', () => {
  // (20 h × $25 + $40 materials + $20 shipping) ÷ (1 − 0.095) + 0.25 + 0.20
  assert.equal(priceFloor({ hours: 20, materials_cost: 40 }, S), 619.23);
});

test('the offsite-ads worst case is shown separately and is higher', () => {
  const plain = priceFloor({ hours: 20, materials_cost: 40 }, S);
  const worst = priceFloor({ hours: 20, materials_cost: 40 }, S, { includeOffsiteAds: true });
  assert.equal(worst, 742.17);
  assert.ok(worst > plain);
});

test('no hours means no floor — a floor built on a guess is worse than none', () => {
  assert.equal(priceFloor({ hours: null, materials_cost: 40 }, S), null);
  assert.equal(priceFloor({}, S), null);
});

test('a per-artwork shipping estimate overrides the settings default', () => {
  const cheap = priceFloor({ hours: 10, estimated_shipping: 0 }, S);
  const normal = priceFloor({ hours: 10 }, S);
  assert.ok(normal > cheap);
});

test('the invisible hourly rate becomes visible (§1.1)', () => {
  // A portrait at $150 for 35 hours — the number that was never seen.
  assert.equal(impliedHourly({ hours: 35, materials_cost: 25, asking_price: 150 }, S), 2.58);
  // The golf bag at $495 for 22 hours.
  assert.equal(impliedHourly({ hours: 22, materials_cost: 40, asking_price: 495 }, S), 17.61);
});

test('implied hourly needs both a price and hours', () => {
  assert.equal(impliedHourly({ hours: 10 }, S), null);
  assert.equal(impliedHourly({ asking_price: 400 }, S), null);
});

test('a price at the floor pays about the target hourly', () => {
  const artwork = { hours: 20, materials_cost: 40 };
  const floor = priceFloor(artwork, S);
  const hourly = impliedHourly({ ...artwork, asking_price: floor }, S);
  assert.ok(Math.abs(hourly - S.target_hourly) < 0.05, `got $${hourly}/h, want ~$25/h`);
});

test('the commission price table matches §8.2', () => {
  const byKey = Object.fromEntries(S.commission_prices.map((r) => [`${r.size}/${r.subjects}`, r.price]));
  assert.equal(byKey['8 × 10/1'], 400);
  assert.equal(byKey['11 × 14/1'], 500);
  assert.equal(byKey['11 × 14/2'], 650);
  assert.equal(byKey['16 × 20/1'], 650);
  assert.equal(byKey['16 × 20/2'], 800);
  assert.equal(byKey['any/3'], null, '3+ subjects is quote-only');
});
