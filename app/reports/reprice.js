// Pricing recommendations (SPEC §8).
//
// Everything needed is already recorded: hours and materials for an original,
// lab quotes for a print. This puts every live price next to what it should be
// and sorts by how much is being left on the table — so the decision is one
// list rather than forty pieces of arithmetic.

import { priceFloor, impliedHourly, withDefaults } from '../store/settings.js';
import {
  landedCost, breakEven, priceForMargin, marginAt, costForVariant, sameSize, sizeLabel,
} from '../listing/print-pricing.js';

export const SEVERITY = { losing: 3, thin: 2, under: 1, ok: 0 };

/**
 * An original is priced from hours (§8.1). Without hours there is no floor and
 * the app says so rather than inventing one.
 */
export function repriceOriginals(artworks, settings) {
  const s = withDefaults(settings);
  return artworks
    .filter((a) => a.asking_price && ['available', 'unknown'].includes(a.disposition))
    .map((artwork) => {
      const price = Number(artwork.asking_price);
      const floor = priceFloor(artwork, s);
      const hourly = impliedHourly(artwork, s);
      if (floor === null) {
        return {
          kind: 'original', artwork, price, suggested: null, gap: 0, severity: 'ok',
          reason: `No hours recorded, so there is no floor. ${artwork.title} could be priced on a guess.`,
          needsHours: true,
        };
      }
      const gap = round(floor - price);
      return {
        kind: 'original', artwork, price, floor, hourly,
        suggested: gap > 0 ? floor : null,
        gap: Math.max(0, gap),
        severity: gap > 0 ? (hourly !== null && hourly < s.target_hourly / 2 ? 'losing' : 'thin') : 'ok',
        reason: gap > 0
          ? `$${price.toFixed(2)} pays ${hourly === null ? 'an unknown rate' : `$${hourly.toFixed(2)} an hour`} `
            + `against your $${s.target_hourly} target. The floor is $${floor.toFixed(2)}.`
          : `$${price.toFixed(2)} clears the $${floor.toFixed(2)} floor at $${hourly?.toFixed(2)} an hour.`,
      };
    });
}

/**
 * A print is priced from what the lab charges, not from hours. Each variant is
 * judged on its own, because a listing can be healthy at one size and losing
 * money at another — which is exactly what the MDF line turned out to be.
 */
export function repricePrints(listings, artworks, costRows, vendors, settings) {
  const s = withDefaults(settings);
  const byArtwork = new Map(artworks.map((a) => [a.id, a]));
  const byVendor = new Map(vendors.map((v) => [v.name, v]));
  const rows = [];

  for (const listing of listings) {
    if (listing.listing_type !== 'print') continue;
    if (['deleted', 'relisted'].includes(listing.status)) continue;

    for (const variant of listing.variants ?? []) {
      const price = Number(variant.price);
      if (!price) continue;
      const costRow = costForVariant(variant, listing, costRows);
      if (!costRow || !(Number(costRow.unit_cost) > 0)) continue;

      const cost = landedCost(costRow, byVendor.get(costRow.vendor), s);
      if (!cost) continue;

      const floor = breakEven(cost, s);
      const target = priceForMargin(cost, s, Number(s.target_print_margin));
      const at = marginAt(price, cost, s);
      const cheaper = cheaperOption(costRow, costRows, byVendor, s);

      let severity = 'ok';
      let reason = `$${price.toFixed(2)} leaves ${pct(at.margin)} after a $${cost.total.toFixed(2)} landed cost.`;
      let suggested = null;

      if (price < floor) {
        severity = 'losing';
        suggested = target;
        reason = `$${price.toFixed(2)} does not cover the $${cost.total.toFixed(2)} it costs to make. `
          + `Every sale loses $${Math.abs(at.profit).toFixed(2)}.`;
      } else if (target && price < target) {
        severity = at.margin < 0.2 ? 'thin' : 'under';
        suggested = target;
        reason = `$${price.toFixed(2)} leaves ${pct(at.margin)} — $${at.profit.toFixed(2)} a sale. `
          + `Your ${pct(s.target_print_margin)} target wants $${target.toFixed(2)}.`;
      }

      rows.push({
        kind: 'print',
        listing,
        artwork: listing.artwork_id ? byArtwork.get(listing.artwork_id) : null,
        variant,
        costRow,
        cost,
        price,
        floor,
        target,
        margin: at.margin,
        profit: at.profit,
        suggested,
        gap: suggested ? round(suggested - price) : 0,
        severity,
        reason,
        cheaper,
      });
    }
  }
  return rows;
}

/**
 * The same size, cheaper, somewhere else. This is the finding that matters
 * most on the wood prints: the identical image on canvas costs a third as much
 * and no shopper is paying $330 for a print.
 */
function cheaperOption(costRow, costRows, byVendor, settings) {
  const mine = landedCost(costRow, byVendor.get(costRow.vendor), settings);
  if (!mine) return null;

  const options = costRows
    .filter((row) => row.id !== costRow.id && sameSize(row, costRow) && Number(row.unit_cost) > 0)
    .map((row) => ({ row, cost: landedCost(row, byVendor.get(row.vendor), settings) }))
    .filter((o) => o.cost && o.cost.total < mine.total * 0.75) // worth switching for
    .sort((a, b) => a.cost.total - b.cost.total);

  if (!options.length) return null;
  const best = options[0];
  return {
    row: best.row,
    cost: best.cost,
    saves: round(mine.total - best.cost.total),
    text: `${best.row.product} at this size lands at $${best.cost.total.toFixed(2)} — `
      + `$${round(mine.total - best.cost.total).toFixed(2)} less than ${costRow.product}.`,
  };
}

/** Everything, worst first. */
export function recommendations({ artworks = [], listings = [], costRows = [], vendors = [], settings }) {
  const rows = [
    ...repricePrints(listings, artworks, costRows, vendors, settings),
    ...repriceOriginals(artworks, settings),
  ];
  return rows.sort((a, b) => (SEVERITY[b.severity] - SEVERITY[a.severity]) || (b.gap - a.gap));
}

export function summarise(rows) {
  const counts = { losing: 0, thin: 0, under: 0, ok: 0 };
  for (const row of rows) counts[row.severity] += 1;
  return {
    ...counts,
    total: rows.length,
    needsAttention: counts.losing + counts.thin + counts.under,
    // What raising every under-priced item to its suggestion would add per sale.
    perSale: round(rows.reduce((t, r) => t + (r.gap || 0), 0)),
  };
}

const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;
function round(value) { return Math.round(value * 100) / 100; }

export { sizeLabel };
