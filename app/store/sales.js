// Sales (SPEC §5.6). Private, always.

import { getAll, get, put, remove } from './db.js';
import { newSale, slugify, uniqueId } from './schema.js';
import { withDefaults } from './settings.js';

/**
 * Etsy's cut on one sale. Offsite Ads only apply when that is where the order
 * came from — charging them on every sale would make the shop look worse than
 * it is.
 */
export function etsyFees(sale, settings) {
  const s = withDefaults(settings);
  const gross = Number(sale?.gross_price) || 0;
  const shipping = Number(sale?.shipping_charged) || 0;
  const base = gross + shipping;

  let fees = base * (s.etsy_transaction_pct + s.etsy_processing_pct) / 100;
  fees += s.etsy_processing_fixed + s.etsy_listing_fee;

  if (sale?.source === 'offsite_ads' && s.offsite_ads_enrolled) {
    fees += Math.min(base * s.offsite_ads_pct / 100, s.offsite_ads_cap);
  }
  return round(fees);
}

/** The fee figure to use: whatever was entered, or what Etsy would take. */
export function feesFor(sale, settings) {
  if (sale?.fees !== null && sale?.fees !== undefined) return Number(sale.fees);
  return sale?.channel === 'etsy' ? etsyFees(sale, settings) : 0;
}

/** §5.6: gross + shipping_charged − fees − shipping_cost − materials_cost. */
export function saleNet(sale, settings) {
  const gross = Number(sale?.gross_price) || 0;
  const shippingIn = Number(sale?.shipping_charged) || 0;
  const shippingOut = Number(sale?.shipping_cost) || 0;
  const materials = Number(sale?.materials_cost) || 0;
  return round(gross + shippingIn - feesFor(sale, settings) - shippingOut - materials);
}

/** §5.6: shown only when hours exist. A rate divided by a guess is a guess. */
export function saleHourly(sale, settings) {
  const hours = Number(sale?.hours);
  if (!hours) return null;
  return round(saleNet(sale, settings) / hours);
}

export function breakdown(sale, settings) {
  return {
    gross: Number(sale?.gross_price) || 0,
    shipping_charged: Number(sale?.shipping_charged) || 0,
    fees: feesFor(sale, settings),
    shipping_cost: Number(sale?.shipping_cost) || 0,
    materials_cost: Number(sale?.materials_cost) || 0,
    net: saleNet(sale, settings),
    hourly: saleHourly(sale, settings),
  };
}

// --- persistence ----------------------------------------------------------

export const listSales = () => getAll('sales');
export const getSale = (id) => get('sales', id);
export const deleteSale = (id) => remove('sales', id);

export async function saveSale(sale) {
  const record = { ...sale, updated_at: new Date().toISOString() };
  await put('sales', record);
  return record;
}

export async function createSale(patch = {}) {
  const taken = new Set((await listSales()).map((s) => s.id));
  const sale = newSale(patch);
  sale.id = uniqueId(sale.id || `sale-${sale.date}-${slugify(sale.artwork_id || 'x')}`, taken);
  return saveSale(sale);
}

/**
 * §5.6's quick sale: artwork, price, payment method and nothing else. Records
 * the sale, marks the piece sold and takes it off the fair table.
 */
export async function quickSale({ artwork, price, payment_method = 'cash', channel = 'fair', date = null }) {
  const { saveArtwork } = await import('./artworks.js');
  const sale = await createSale({
    artwork_id: artwork.id,
    channel,
    date: date ?? new Date().toISOString().slice(0, 10),
    gross_price: Number(price),
    payment_method,
    // Carried from the record so the hourly figure works without extra taps.
    materials_cost: artwork.materials_cost ?? null,
    hours: artwork.hours ?? null,
    fees: channel === 'etsy' ? null : 0,
    source: channel === 'fair' ? 'fair' : 'unknown',
  });
  await saveArtwork({ ...artwork, disposition: 'sold', on_hand: false });
  return sale;
}

function round(value) { return Math.round(value * 100) / 100; }
