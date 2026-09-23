// Listing validators (SPEC §7.4).
//
// Every one of these warns and none of them blocks — §7.4 says so explicitly,
// and §5.2 says the same about rights. Scott decides; the app points.
//
// Pure functions: a listing, its artwork and the settings in, a list of
// findings out. Each finding is { id, level, field, message }.

import { effectiveRights, printLimits, printSource, variantLongEdge } from '../store/schema.js';
import { landedCost, breakEven, priceForMargin, costForVariant } from './print-pricing.js';
import { withDefaults, priceFloor } from '../store/settings.js';
import { SUBSTRATE_WORDS, PRINT_SUBSTRATE_WORDS, INK_WORDS } from './generate.js';

export const LEVELS = { stop: 3, warn: 2, note: 1 };

const finding = (id, level, field, message) => ({ id, level, field, message });

// Every substrate word the validators know, mapped to the enum value it means.
// Multi-word entries are matched as phrases.
const SUBSTRATE_VOCABULARY = [
  ['canvas', 'canvas'], ['mdf', 'mdf'], ['medium density fibreboard', 'mdf'],
  ['fine-art paper', 'paper'], ['paper', 'paper'], ['metal', 'metal'],
  ['aluminium', 'metal'], ['aluminum', 'metal'], ['wood panel', 'wood_panel'],
  ['pine', 'pine'], ['birch plywood', 'birch_plywood'], ['plywood', 'birch_plywood'],
  ['birch', 'birch'], ['skateboard deck', 'skateboard_deck'],
];

function wordRegex(term) {
  // Whole-word where sensible (§B.4). Terms with punctuation get a looser edge.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'gi');
}

function textOf(listing) {
  return {
    title: listing.title ?? '',
    description: listing.description ?? '',
    tags: (listing.tags ?? []).join(', '),
    materials: (listing.materials ?? []).join(', '),
  };
}

// --- individual checks -----------------------------------------------------

export function checkTitle(listing) {
  const out = [];
  const title = listing.title ?? '';

  if (title.length > 140) {
    out.push(finding('title_length', 'warn', 'title',
      `Title is ${title.length} characters; Etsy allows 140.`));
  }
  for (const separator of ['|| ', '||', '///', '//']) {
    if (title.includes(separator.trim())) {
      out.push(finding('title_separators', 'warn', 'title',
        `Title contains "${separator.trim()}". Use commas — the pipe and slash separators read as spam.`));
      break;
    }
  }
  if (/^\s*handmade\b/i.test(title)) {
    out.push(finding('title_opener', 'warn', 'title',
      'Title opens with "Handmade". Every item on Etsy is handmade — the first ~40 characters should be the phrase buyers type.'));
  }
  return out;
}

export function checkTags(listing) {
  const out = [];
  const tags = listing.tags ?? [];

  if (tags.length !== 13) {
    out.push(finding('tag_count', tags.length > 13 ? 'warn' : 'note', 'tags',
      tags.length > 13
        ? `${tags.length} tags; Etsy takes 13.`
        : `${tags.length} of 13 tags used. Unused slots are wasted search surface.`));
  }
  const long = tags.filter((t) => t.length > 20);
  if (long.length) {
    out.push(finding('tag_length', 'warn', 'tags',
      `Over 20 characters: ${long.map((t) => `"${t}" (${t.length})`).join(', ')}.`));
  }
  const single = tags.filter((t) => t.trim() && !t.trim().includes(' '));
  if (single.length) {
    out.push(finding('tag_form', 'note', 'tags',
      `Single-word tags waste a slot: ${single.map((t) => `"${t}"`).join(', ')}.`));
  }
  const normalised = tags.map((t) => t.trim().toLowerCase());
  const dupes = [...new Set(normalised.filter((t, i) => normalised.indexOf(t) !== i))];
  if (dupes.length) {
    out.push(finding('tag_duplicates', 'warn', 'tags',
      `Repeated tags: ${dupes.map((t) => `"${t}"`).join(', ')}.`));
  }
  return out;
}

export function checkTrademarks(listing, settings) {
  const blocklist = withDefaults(settings).trademark_blocklist ?? [];
  const text = textOf(listing);
  const hits = [];

  for (const term of blocklist) {
    const where = Object.entries(text)
      .filter(([, value]) => wordRegex(term).test(value))
      .map(([field]) => field);
    if (where.length) hits.push({ term, where });
  }
  if (!hits.length) return [];
  return [finding('trademark', 'warn', 'title',
    `Blocklist terms found: ${hits.map((h) => `"${h.term}" in ${h.where.join(', ')}`).join('; ')}. `
    + 'A mark in a title or URL slug is the kind of thing that gets a listing pulled.')];
}

/**
 * §7.4: the description must not mention a substrate word other than the
 * listing's own. The surf van print is the case that matters — an MDF listing
 * that still says "canvas" somewhere.
 */
/**
 * A frame, hanging hardware and a finish are made of things too — the golf bag
 * is birch in a *pine* frame, and the Cilleyville bridge hangs in a "gold metal
 * float". Neither is a substrate claim, so those phrases come out of the text
 * before the scan rather than being reported as contradictions.
 */
function maskNonSubstrateMentions(description, artwork) {
  const phrases = [artwork?.frame_material, artwork?.hanging_hardware, artwork?.finish]
    .filter(Boolean)
    .map(String)
    .sort((a, b) => b.length - a.length); // longest first, so "gold metal float" wins over "metal"
  let masked = description;
  for (const phrase of phrases) {
    masked = masked.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  return masked;
}

export function checkSubstrateConsistency(listing, artwork) {
  const own = new Set();
  if (listing.print_substrate) own.add(listing.print_substrate);
  if (artwork?.substrate) own.add(artwork.substrate);
  // A print description legitimately describes the original's panel as well as
  // its own stock, so both count as the listing's own.

  const description = maskNonSubstrateMentions(listing.description ?? '', artwork);
  const strays = [];
  for (const [word, substrate] of SUBSTRATE_VOCABULARY) {
    if (own.has(substrate)) continue;
    if (wordRegex(word).test(description)) strays.push({ word, substrate });
  }
  if (!strays.length) return [];

  const ownWords = [...own]
    .map((s) => PRINT_SUBSTRATE_WORDS[s] ?? SUBSTRATE_WORDS[s] ?? s)
    .join(' / ') || 'none recorded';
  return [finding('substrate_consistency', 'warn', 'description',
    `Description mentions ${strays.map((s) => `"${s.word}"`).join(', ')}, but this listing is `
    + `${ownWords}. One listing called its substrate both canvas and MDF — that is how it starts.`)];
}

/** §7.4: any dimensions in the description must match the variants or the artwork. */
export function checkDimensionConsistency(listing, artwork) {
  const description = listing.description ?? '';
  const found = [...description.matchAll(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/gi)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  if (!found.length) return [];

  const known = new Set();
  const add = (w, h) => {
    if (!w || !h) return;
    known.add(`${w}×${h}`);
    known.add(`${h}×${w}`);
  };
  add(artwork?.width_in, artwork?.height_in);
  for (const variant of listing.variants ?? []) add(variant.width_in, variant.height_in);

  const strays = found.filter(([w, h]) => !known.has(`${w}×${h}`));
  if (!strays.length) return [];

  return [finding('dimension_consistency', 'warn', 'description',
    `Description says ${strays.map(([w, h]) => `${w} × ${h}`).join(', ')}, which matches neither the `
    + 'artwork nor any variant. The moose listing said 16 × 12 while its specs said 18.5 × 31.')];
}

export function checkOffsiteRedirects(listing) {
  const description = listing.description ?? '';
  const hits = [];
  if (/\b(instagram|tiktok|facebook)\b/i.test(description)) hits.push('a social platform by name');
  if (/(?:^|\s)@[A-Za-z0-9._]{2,}/.test(description)) hits.push('an @handle');
  if (!hits.length) return [];
  return [finding('offsite_redirect', 'note', 'description',
    `Description contains ${hits.join(' and ')}. Etsy discourages sending shoppers off-site, and it `
    + 'costs you the sale in progress.')];
}

export function checkRoundVariant(listing, artwork) {
  const round = (listing.variants ?? []).filter((v) => v.shape === 'round');
  if (!round.length) return [];
  if (artwork?.shape === 'round') return [];
  return [finding('round_variant', 'warn', 'variants',
    `A round variant is offered for a ${artwork?.shape ?? 'non-round'} composition. `
    + 'The round crop of the ship wheel cut the handles off.')];
}

/**
 * §5.4: a variant larger than the file supports.
 *
 * The master is the right number when it has been measured. Until then the
 * largest reference photo is the best available guess — and a generous one,
 * because cropping a wall and a frame out of it takes pixels off. Saying
 * "12 in, and that is optimistic" beats saying nothing.
 */
export function checkPrintResolution(listing, artwork) {
  if (listing.listing_type !== 'print') return [];
  const source = printSource(artwork);
  const limits = printLimits(source);
  if (!limits) {
    if (!(listing.variants ?? []).length) return [];
    return [finding('print_resolution', 'warn', 'variants',
      'No master measured and no photograph on file, so there is no way to tell whether these sizes will hold up.')];
  }
  const from = source.from === 'master' ? 'the master' : 'the largest photo on file (before cropping)';
  const out = [];
  for (const variant of listing.variants ?? []) {
    const edge = variantLongEdge(variant);
    if (!edge) continue;
    if (edge > limits.at100) {
      out.push(finding('print_resolution', 'stop', 'variants',
        `${variant.label || `${variant.width_in} × ${variant.height_in}`} needs ${edge} in but ${from} `
        + `stops at ${limits.at100.toFixed(1)} in even at 100 DPI. This will look soft in the room.`));
    } else if (edge > limits.at150) {
      out.push(finding('print_resolution', 'warn', 'variants',
        `${variant.label || `${variant.width_in} × ${variant.height_in}`} needs ${edge} in; ${from} `
        + `supports ${limits.at150.toFixed(1)} in at 150 DPI (${limits.at100.toFixed(1)} in at 100 DPI).`));
    }
  }
  if (source.from === 'photo' && out.length === 0 && (listing.variants ?? []).length) {
    out.push(finding('print_resolution', 'note', 'variants',
      `No master measured yet. These sizes are checked against ${from}, which `
      + `reaches ${limits.at150.toFixed(1)} in at 150 DPI. Measure the cropped master to be sure.`));
  }
  return out;
}

export function checkRights(listing, artwork) {
  if (!artwork) return [];
  const rights = effectiveRights(artwork.rights);
  const out = [];
  const derived = (flag) => (flag ? ' (derived from the flags — set it explicitly to silence this)' : '');

  if (rights.listing_ok !== 'yes') {
    out.push(finding('rights_listing', rights.listing_ok === 'no' ? 'stop' : 'warn', 'rights',
      `Listing rights are "${rights.listing_ok}"${derived(rights.listing_ok_derived)}.`));
  }
  if (listing.listing_type === 'print' && rights.print_ok !== 'yes') {
    out.push(finding('rights_print', rights.print_ok === 'no' ? 'stop' : 'warn', 'rights',
      `Print rights are "${rights.print_ok}"${derived(rights.print_ok_derived)}.`));
  }
  if (artwork.rights?.edits_required) {
    out.push(finding('rights_edits', 'warn', 'rights',
      `Edits still required before this ships: ${artwork.rights.edits_required}`));
  }
  return out;
}

/** §8.1: an original priced below the floor. */
export function checkPriceFloor(listing, artwork, settings) {
  if (listing.listing_type !== 'original' || !artwork) return [];
  const floor = priceFloor(artwork, settings);
  if (floor === null) return [];

  const prices = (listing.variants ?? []).map((v) => v.price).filter((p) => typeof p === 'number');
  if (artwork.asking_price) prices.push(artwork.asking_price);
  if (!prices.length) return [];

  const lowest = Math.min(...prices);
  if (lowest >= floor) return [];
  const hourly = withDefaults(settings).target_hourly;
  return [finding('price_floor', 'warn', 'variants',
    `Lowest price is $${lowest.toFixed(2)} against a floor of $${floor.toFixed(2)} at $${hourly} an hour. `
    + 'Portraits sold at about $150 for 25–50 hours of work.')];
}

/** §B.1: made-to-order takes a longer processing time, not a quantity of 1. */
export function checkProcessingVsQuantity(listing) {
  if (listing.listing_type !== 'custom') return [];
  if ((listing.quantity ?? 1) > 1) return [];
  return [finding('processing_quantity', 'warn', 'quantity',
    'A custom listing at quantity 1 shows "Only 1 left" to shoppers. Raise the quantity and lengthen '
    + 'the processing time instead — the commission queue is what tells you how many you can take.')];
}

/** §5.5: giclée is only honest once the vendor confirms the process. */
/**
 * §B.5's description templates say the panel is scorched black and carved
 * back into, because almost every piece is. The toucan is a painting. A
 * listing generated from the stock template would describe it as burned and
 * carved, to a buyer, in the body of the listing.
 *
 * The record already knows: `techniques` says `paint` and the note says
 * "Painted, not scorched." This makes the description answer to it.
 */
const CARVE_WORDS = /\b(scorched|scorch|carved|carve|burned|burnt|char|pyrograph\w*)\b/i;

export function checkTechniqueClaim(listing, artwork) {
  if (listing.listing_type === 'print') return [];
  const techniques = artwork?.techniques ?? [];
  if (!techniques.length) return [];

  const subtractive = ['scorch_and_carve', 'relief_carve', 'pyrography_line']
    .some((t) => techniques.includes(t));
  if (subtractive) return [];

  const text = [listing.title, listing.description, (listing.materials ?? []).join(' ')]
    .filter(Boolean).join(' ');
  const hit = text.match(CARVE_WORDS);
  if (!hit) return [];

  return [finding('technique_claim', 'stop', 'description',
    `This listing says "${hit[0]}" but the record's techniques are ${techniques.join(', ')} — `
    + 'nothing subtractive. The stock description assumes a scorched and carved panel; this piece '
    + 'is not one, and the buyer is being told how it was made.')];
}

export function checkGicleeClaim(listing) {
  const text = [listing.title, listing.description, listing.category_path].filter(Boolean).join(' ');
  if (!/gicl[ée]e/i.test(text)) return [];
  if (listing.print_process === 'giclee') return [];
  return [finding('giclee_claim', 'warn', 'category_path',
    `"Giclée" appears but the print process is "${listing.print_process ?? 'unset'}". `
    + 'Use it only once the print vendor confirms it; Digital Prints is the honest category otherwise.')];
}

/**
 * The giclée rule in §5.5 is really a rule about not claiming what the vendor
 * has not said. "Archival" and "museum quality" are the same kind of claim,
 * and CanvasChamp's canvas line runs latex ink — durable, but not archival
 * pigment on a fine-art substrate.
 */
export function checkUnsupportedPrintClaims(listing) {
  if (listing.listing_type !== 'print') return [];
  const text = [listing.title, listing.description, (listing.materials ?? []).join(' ')]
    .filter(Boolean).join(' ');
  const out = [];
  const ink = INK_WORDS[listing.print_process];

  if (/\barchival\b/i.test(text) && listing.print_process !== 'giclee') {
    out.push(finding('archival_claim', 'warn', 'description',
      `"Archival" appears but the process is "${listing.print_process ?? 'unset'}"`
      + `${ink ? ` (${ink})` : ''}. Archival means pigment ink on a fine-art substrate. `
      + 'Say what the ink actually is instead — UV-resistant and fade-resistant are claims you can stand behind.'));
  }
  if (/museum[- ]quality/i.test(text) && listing.print_process !== 'giclee') {
    out.push(finding('museum_claim', 'note', 'description',
      '"Museum quality" is a print vendor\u2019s marketing phrase, not a property of this listing. '
      + 'It invites a comparison the process will not survive.'));
  }
  return out;
}

/**
 * §8.1's floor is built on hours, which says nothing useful about a print: a
 * print costs what the lab charges. This is the print equivalent — and unlike
 * the hours floor, being under it is not a judgement call. It is a loss on
 * every sale.
 */
export function checkPrintMargin(listing, settings, { costRows = [], vendors = [] } = {}) {
  if (listing.listing_type !== 'print' || !costRows.length) return [];
  const s = withDefaults(settings);
  const byName = new Map(vendors.map((v) => [v.name, v]));
  const out = [];

  for (const variant of listing.variants ?? []) {
    if (typeof variant.price !== 'number') continue;
    const row = costForVariant(variant, listing, costRows);
    if (!row || !(Number(row.unit_cost) > 0)) continue;
    const cost = landedCost(row, byName.get(row.vendor), s);
    if (!cost) continue;

    const floor = breakEven(cost, s);
    const target = priceForMargin(cost, s, Number(s.target_print_margin));
    const name = variant.label || `${variant.width_in} × ${variant.height_in}`;

    if (variant.price < floor) {
      out.push(finding('print_below_cost', 'stop', 'variants',
        `${name} sells at $${variant.price.toFixed(2)} but costs $${cost.total.toFixed(2)} landed and needs `
        + `$${floor.toFixed(2)} just to break even after Etsy's cut. Every one of these loses money.`));
    } else if (target && variant.price < target) {
      const got = Math.round(((variant.price - (variant.price * (s.etsy_transaction_pct + s.etsy_processing_pct) / 100)
        - s.etsy_processing_fixed - s.etsy_listing_fee - cost.total) / variant.price) * 100);
      out.push(finding('print_margin', 'note', 'variants',
        `${name} at $${variant.price.toFixed(2)} leaves about ${got}% margin; your target of `
        + `${Math.round(s.target_print_margin * 100)}% wants $${target.toFixed(2)}.`));
    }
  }
  return out;
}

export function checkSuppression(listing) {
  if (!listing.suppression_suspected) return [];
  return [finding('suppression', 'warn', 'status',
    'Suppression is suspected on this listing. Editing cannot clear a content rating — relisting with a '
    + 'different primary image is the remedy that worked before.')];
}

// --- the whole run ---------------------------------------------------------

export function validateListing(listing, artwork, settings, context = {}) {
  const findings = [
    ...checkTitle(listing),
    ...checkTags(listing),
    ...checkTrademarks(listing, settings),
    ...checkSubstrateConsistency(listing, artwork),
    ...checkDimensionConsistency(listing, artwork),
    ...checkOffsiteRedirects(listing),
    ...checkRoundVariant(listing, artwork),
    ...checkPrintResolution(listing, artwork),
    ...checkRights(listing, artwork),
    ...checkPriceFloor(listing, artwork, settings),
    ...checkProcessingVsQuantity(listing),
    ...checkTechniqueClaim(listing, artwork),
    ...checkGicleeClaim(listing),
    ...checkUnsupportedPrintClaims(listing),
    ...checkPrintMargin(listing, settings, context),
    ...checkSuppression(listing),
  ];
  return findings.sort((a, b) => LEVELS[b.level] - LEVELS[a.level]);
}

export function summarise(findings) {
  return {
    stop: findings.filter((f) => f.level === 'stop').length,
    warn: findings.filter((f) => f.level === 'warn').length,
    note: findings.filter((f) => f.level === 'note').length,
    total: findings.length,
  };
}
