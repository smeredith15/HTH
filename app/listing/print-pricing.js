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
 * What it costs to turn a quoted print into something ready to hang.
 *
 * The two labs quote different products: CanvasChamp's price already includes
 * proofing and hanging hardware, while Nations quotes a bare print and mounts
 * it on 3/16 in foamcore for roughly half the base price again. Comparing
 * their headline numbers without this is comparing a finished piece against a
 * sheet of paper.
 */
export function finishingCost(costRow) {
  if (!costRow?.mounted) return 0;
  const flat = Number(costRow.finishing_cost);
  if (Number.isFinite(flat) && flat > 0) return round(flat);
  const pct = Number(costRow.finishing_pct);
  const unit = Number(costRow.unit_cost);
  if (!Number.isFinite(pct) || !Number.isFinite(unit)) return 0;
  return round(unit * pct);
}

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
  const finishing = finishingCost(costRow);

  return {
    unit,
    finishing,
    inbound,
    outbound,
    packaging,
    readyToHang: finishing > 0 || !costRow?.finishing_pct,
    total: round(unit + finishing + inbound + outbound + packaging),
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
        // A bare print and a mounted one are not the same product, and neither
        // is an unverified lab. Both belong next to the number.
        readyToHang: cost.readyToHang,
        qualityChecked: !!vendor?.quality_checked_on,
      };
    })
    .sort((a, b) => a.cost.total - b.cost.total);
}

/**
 * Look for lab prices that cannot both be right.
 *
 * A meaningfully larger print costing meaningfully less is either a promotion
 * that will expire or a typo, and both are worth knowing before a retail price
 * is built on top of one. The thresholds matter: a size ladder is lumpy, so a
 * 12 × 24 costing 49¢ more than a 16 × 20 is just granularity, not an error.
 */
const AREA_RATIO = 1.10;   // the larger print must be at least 10% bigger
const PRICE_DROP = 0.10;   // and at least 10% cheaper

export function costAnomalies(rows) {
  const out = [];
  const byLine = new Map();
  for (const row of rows) {
    if (!(Number(row.unit_cost) > 0) || !row.width_in || !row.height_in) continue;
    if (!byLine.has(row.line)) byLine.set(row.line, []);
    byLine.get(row.line).push({ ...row, area: row.width_in * row.height_in });
  }

  for (const [line, set] of byLine) {
    if (set.length < 3) continue;
    set.sort((a, b) => a.area - b.area);

    for (let i = 0; i < set.length; i += 1) {
      for (let j = i + 1; j < set.length; j += 1) {
        const bigger = set[j].area / set[i].area >= AREA_RATIO;
        const cheaper = (set[i].unit_cost - set[j].unit_cost) / set[i].unit_cost >= PRICE_DROP;
        if (bigger && cheaper) {
          out.push({
            line,
            id: set[i].id,
            kind: 'inverted',
            message: `${sizeLabel(set[i])} costs $${set[i].unit_cost.toFixed(2)} but the larger `
              + `${sizeLabel(set[j])} is only $${set[j].unit_cost.toFixed(2)}. One of the two is a `
              + 'promotion that will expire, or a typo.',
          });
          j = set.length;
        }
      }
    }

    // A loose guard for a misplaced decimal point. Small sizes genuinely cost
    // far more per square inch, so anything tighter than this is all noise.
    const psi = set.map((r) => r.unit_cost / r.area).sort((a, b) => a - b);
    const median = psi[Math.floor(psi.length / 2)];
    for (const row of set) {
      const ratio = (row.unit_cost / row.area) / median;
      if (ratio > 3 || ratio < 0.34) {
        out.push({
          line,
          id: row.id,
          kind: 'outlier',
          message: `${sizeLabel(row)} at $${row.unit_cost.toFixed(2)} is `
            + `${ratio > 1 ? 'far dearer' : 'far cheaper'} per square inch than everything else in `
            + 'this line. Check the decimal point.',
        });
      }
    }
  }
  const seen = new Set();
  return out.filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));
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
