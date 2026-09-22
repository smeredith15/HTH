// Settings defaults (SPEC §5.10) plus the commission price table (§8.2)
// and the trademark blocklist (Appendix B.4).

export const DEFAULT_SETTINGS = {
  target_hourly: 25,
  hours_per_week: 8,
  etsy_transaction_pct: 6.5,
  etsy_processing_pct: 3.0,
  etsy_processing_fixed: 0.25,
  etsy_listing_fee: 0.20,
  offsite_ads_enrolled: true,
  offsite_ads_pct: 15,
  offsite_ads_cap: 100,
  // Not in §5.10, but §8.1's price-floor formula needs an estimated_shipping
  // term and no field supplies one. See DECISIONS.md.
  default_shipping_estimate: 20,
  // Prints have their own economics: they cost what the lab charges, not what
  // the original took in hours. See app/listing/print-pricing.js.
  print_shipping_estimate: 12,   // posting one print to a US buyer
  packaging_cost: 2.5,           // tube or flat mailer, corners, tape
  target_print_margin: 0.55,     // profit as a share of the sale price
  kiosk_pin: null,
  kiosk_idle_seconds: 90,
  kiosk_show_sold: true,
  shop_url: 'https://www.etsy.com/shop/HighTideHandmade25',
  custom_listing_url: null,
  processing_weeks: [6, 8],
  // Christmas minus the 8-week worst case, minus a shipping week. Assumed, not
  // given by the spec — see DECISIONS.md.
  holiday_cutoff: '2026-10-23',
  last_exported_at: null,
  storage_notice_seen: false,
  trademark_blocklist: [
    'vw', 'volkswagen', 'vw bus', 'nfl', 'mlb', 'nba', 'ncaa',
    'texas longhorns', 'topps', 'peanuts', 'snoopy', 'disney', 'marvel',
    'packers', 'patriots', 'bills', 'seahawks', 'rams', 'chargers',
    'ravens', 'orioles', 'terrapins', 'terps', 'green bay',
    // Player names from Appendix A.3
    'tom brady', 'len bias', 'puka nacua', 'aaron rodgers', 'jordan love',
    'ladainian tomlinson', 'russell wilson', 'josh allen', 'gunnar henderson',
    'jerry garcia', 'jimi hendrix',
  ],
  commission_prices: [
    { size: '8 × 10', subjects: 1, price: 400 },
    { size: '11 × 14', subjects: 1, price: 500 },
    { size: '11 × 14', subjects: 2, price: 650 },
    { size: '16 × 20', subjects: 1, price: 650 },
    { size: '16 × 20', subjects: 2, price: 800 },
    { size: 'any', subjects: 3, price: null }, // quote
  ],
  expense_categories: [
    'wood', 'stain_and_finish', 'tools', 'frames_and_hardware',
    'shipping_supplies', 'fair_fees', 'etsy_fees', 'software', 'other',
  ],
};

export function withDefaults(stored = {}) {
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Combined Etsy fee rate as a fraction, for the §8.1 price floor. */
export function feeRate(settings, { includeOffsiteAds = false } = {}) {
  const s = withDefaults(settings);
  let pct = s.etsy_transaction_pct + s.etsy_processing_pct;
  if (includeOffsiteAds && s.offsite_ads_enrolled) pct += s.offsite_ads_pct;
  return pct / 100;
}

/**
 * Price floor for an original or commission (§8.1):
 *   (hours × target_hourly + materials + shipping) ÷ (1 − fee_rate)
 * plus the fixed processing and listing fees.
 * Returns null when hours are unknown — a floor built on a guess is worse
 * than no floor.
 */
export function priceFloor(artwork, settings, { includeOffsiteAds = false } = {}) {
  const s = withDefaults(settings);
  const hours = Number(artwork?.hours);
  if (!hours) return null;
  const materials = Number(artwork?.materials_cost) || 0;
  const shipping = Number(artwork?.estimated_shipping ?? s.default_shipping_estimate) || 0;
  const rate = feeRate(s, { includeOffsiteAds });
  const base = hours * s.target_hourly + materials + shipping;
  const floor = base / (1 - rate) + s.etsy_processing_fixed + s.etsy_listing_fee;
  return Math.round(floor * 100) / 100;
}

/** What the current asking price actually pays per hour (§8.1). */
export function impliedHourly(artwork, settings, { includeOffsiteAds = false } = {}) {
  const s = withDefaults(settings);
  const hours = Number(artwork?.hours);
  const price = Number(artwork?.asking_price);
  if (!hours || !price) return null;
  const materials = Number(artwork?.materials_cost) || 0;
  const shipping = Number(artwork?.estimated_shipping ?? s.default_shipping_estimate) || 0;
  const fees = price * feeRate(s, { includeOffsiteAds })
    + s.etsy_processing_fixed + s.etsy_listing_fee;
  return Math.round(((price - fees - materials - shipping) / hours) * 100) / 100;
}
