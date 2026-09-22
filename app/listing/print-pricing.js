// What a print actually costs to make, and what it has to sell for (SPEC §8).
//
// §8.1's price floor is built on hours, which is right for an original but
// wrong for a print: a print costs what the lab charges, however long the
// original took. This module is the print side of the same question, and it is
// pure so the tests can check the arithmetic.

import { withDefaults, feeRate } from '../store/settings.js';

/**
 * How a vendor gets the print to the customer. This decides which shipping
 * legs Scott actually pays for.
 *
 *  dropship          the lab ships straight to the buyer; `ship_each` is what
 *                    the lab charges for that, and Scott posts nothing
 *  receive_and_ship  the lab ships to Scott, who packs and posts it on
 *  local_pickup      Scott collects from the lab, then packs and posts it
 */
export const FULFILMENT = ['dropship', 'receive_and_ship', 'local_pickup'];

export const FULFILMENT_LABELS = {
  dropship: 'Lab ships to the buyer',
  receive_and_ship: 'Lab ships to me, I post it',
  local_pickup: 'I collect it, then post it',
};

/**
 * Everything one print costs Scott before Etsy takes anything.
 * Returns null when the vendor cost is unknown — a margin built on a guess is
 * worse than no margin.
 */
export function landedCost(costRow, vendor, settings) {
  const s = withDefaults(settings);
  const unit = Number(costRow?.unit_cost);
  if (!Number.isFinite(unit) || unit <= 0) return null;

  const fulfilment = vendor?.fulfilment ?? 'receive_and_ship';
  const inbound = fulfilment === 'local_pickup' ? 0 : (Number(costRow?.ship_each) || 0);
  const posts = fulfilment !== 'dropship';
  const outbound = posts ? Number(s.print_shipping_estimate) || 0 : 0;
  const packaging = posts ? Number(s.packaging_cost) || 0 : 0;

  return {
    unit,
    inbound,
    outbound,
    packaging,
    total: round(unit + inbound + outbound + packaging),
  };
}

/**
 * The price at which a sale makes exactly nothing.
 *
 *   P − (P·r + f) − C = 0   →   P = (C + f) ÷ (1 − r)
 *
 * where C is the landed cost, r the percentage fees and f the fixed ones.
 * Free shipping is assumed, because §B.1 says US search favours it and the
 * cost is therefore inside the price.
 */
export function breakEven(cost, settings, { includeOffsiteAds = false } = {}) {
  if (!cost) return null;
  const s = withDefaults(settings);
  const r = feeRate(s, { includeOffsiteAds });
  const f = s.etsy_processing_fixed + s.etsy_listing_fee;
  return round((cost.total + f) / (1 - r));
}

/**
 * The price that leaves `margin` of the sale as profit.
 *
 *   P − (P·r + f) − C = m·P   →   P = (C + f) ÷ (1 − r − m)
 */
export function priceForMargin(cost, settings, margin, { includeOffsiteAds = false } = {}) {
  if (!cost) return null;
  const s = withDefaults(settings);
  const r = feeRate(s, { includeOffsiteAds });
  const f = s.etsy_processing_fixed + s.etsy_listing_fee;
  const denominator = 1 - r - margin;
  // Asking for a margin the fees cannot leave room for has no answer.
  if (denominator <= 0.01) return null;
  return round((cost.total + f) / denominator);
}

/** What a given asking price actually leaves, once everything is paid. */
export function marginAt(price, cost, settings, { includeOffsiteAds = false } = {}) {
  if (!cost || !Number.isFinite(Number(price)) || Number(price) <= 0) return null;
  const s = withDefaults(settings);
  const p = Number(price);
  const fees = round(p * feeRate(s, { includeOffsiteAds }) + s.etsy_processing_fixed + s.etsy_listing_fee);
  const profit = round(p - fees - cost.total);
  return {
    price: p,
    fees,
    cost: cost.total,
    profit,
    margin: round(profit / p, 4),
    multiple: round(p / cost.total, 2),
  };
}

/** Everything the listing screen needs for one variant, in one call. */
export function priceGuidance(price, costRow, vendor, settings) {
  const s = withDefaults(settings);
  const cost = landedCost(costRow, vendor, s);
  if (!cost) return { known: false };
  return {
    known: true,
    cost,
    breakEven: breakEven(cost, s),
    breakEvenWithAds: breakEven(cost, s, { includeOffsiteAds: true }),
    target: priceForMargin(cost, s, Number(s.target_print_margin)),
    targetMargin: Number(s.target_print_margin),
    at: marginAt(price, cost, s),
    atWithAds: marginAt(price, cost, s, { includeOffsiteAds: true }),
  };
}

/**
 * The same size from every vendor that quotes it, so "is real giclée worth
 * it?" is a table rather than a feeling.
 */
export function compareVendors(costRows, vendors, settings, { width_in, height_in }) {
  const s = withDefaults(settings);
  const byName = new Map(vendors.map((v) => [v.name, v]));
  return costRows
    .filter((row) => sameSize(row, { width_in, height_in }) && Number(row.unit_cost) > 0)
    .map((row) => {
      const vendor = byName.get(row.vendor);
      const cost = landedCost(row, vendor, s);
      return {
        row,
        vendor,
        cost,
        breakEven: breakEven(cost, s),
        target: priceForMargin(cost, s, Number(s.target_print_margin)),
      };
    })
    .sort((a, b) => a.cost.total - b.cost.total);
}

/** 16 × 20 and 20 × 16 are the same print turned round. */
export function sameSize(a, b) {
  const pair = (x) => [Number(x?.width_in), Number(x?.height_in)].sort((m, n) => m - n).join('×');
  return pair(a) === pair(b);
}

export function sizeLabel({ width_in, height_in }) {
  if (!width_in || !height_in) return '—';
  return `${width_in} × ${height_in} in`;
}

/** Find the cost row that covers a listing variant. */
export function costForVariant(variant, listing, costRows) {
  if (!variant?.width_in || !variant?.height_in) return null;
  const candidates = costRows.filter((row) => sameSize(row, variant));
  if (!candidates.length) return null;
  // Prefer the vendor and substrate the listing actually names.
  return candidates.find((row) => row.vendor === listing?.print_vendor && row.substrate === listing?.print_substrate)
    ?? candidates.find((row) => row.substrate === listing?.print_substrate)
    ?? candidates.find((row) => row.vendor === listing?.print_vendor)
    ?? null;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
