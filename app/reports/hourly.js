// Effective hourly (SPEC §6.4, §1.1).
//
// "Invisible hourly rate" is listed in §1.1 as one of the five problems this
// app exists to prevent: portraits sold at about $150 for 25–50 hours of work
// without that number ever being seen. This is where it gets seen.

import { saleNet } from '../store/sales.js';
import { label } from '../ui/dom.js';

/** Only sales with hours recorded can say anything about a rate. */
export function ratedSales(sales, artworks, settings) {
  const byId = new Map(artworks.map((a) => [a.id, a]));
  return sales
    .map((sale) => {
      const artwork = sale.artwork_id ? byId.get(sale.artwork_id) : null;
      const hours = Number(sale.hours) || Number(artwork?.hours) || 0;
      if (!hours) return null;
      const net = saleNet({ ...sale, hours }, settings);
      return { sale, artwork, hours, net, hourly: round(net / hours) };
    })
    .filter(Boolean);
}

function group(rows, keyOf, labelOf = label) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([key, set]) => {
      const hours = set.reduce((t, r) => t + r.hours, 0);
      const net = set.reduce((t, r) => t + r.net, 0);
      return {
        key,
        label: labelOf(key),
        sales: set.length,
        hours: round(hours),
        net: round(net),
        // Pooled, not an average of averages: one 40-hour piece should not
        // count the same as one 10-hour piece.
        hourly: hours ? round(net / hours) : null,
      };
    })
    .sort((a, b) => (b.hourly ?? -Infinity) - (a.hourly ?? -Infinity));
}

export function hourlyByCategory(sales, artworks, settings) {
  return group(ratedSales(sales, artworks, settings), (r) => r.artwork?.category ?? null);
}

/** §5.1: faces take 20–50+ hours regardless of size. This is the proof. */
export function hourlyByFace(sales, artworks, settings) {
  return group(
    ratedSales(sales, artworks, settings),
    (r) => (r.artwork ? (r.artwork.has_face ? 'face' : 'no_face') : null),
    (key) => (key === 'face' ? 'Has a face' : 'No face'),
  );
}

/** §5.6: most portrait sales so far were to friends, which distorts the price signal. */
export function hourlyByRelationship(sales, artworks, settings) {
  return group(ratedSales(sales, artworks, settings), (r) => r.sale.relationship ?? null);
}

export function hourlyBySource(sales, artworks, settings) {
  return group(ratedSales(sales, artworks, settings), (r) => r.sale.source ?? null);
}

/** The headline: what an hour at the bench has actually paid. */
export function overallHourly(sales, artworks, settings) {
  const rows = ratedSales(sales, artworks, settings);
  const hours = rows.reduce((t, r) => t + r.hours, 0);
  const net = rows.reduce((t, r) => t + r.net, 0);
  return {
    sales: rows.length,
    hours: round(hours),
    net: round(net),
    hourly: hours ? round(net / hours) : null,
    unrated: sales.length - rows.length,
  };
}

/**
 * What is worth making more of. A category needs at least two sales before it
 * is worth reading as a signal rather than an anecdote.
 */
export function whatPays(sales, artworks, settings, { minSales = 2 } = {}) {
  const rows = hourlyByCategory(sales, artworks, settings).filter((r) => r.sales >= minSales);
  if (rows.length < 2) return null;
  return { best: rows[0], worst: rows[rows.length - 1], rows };
}

function round(value) { return Math.round(value * 100) / 100; }
