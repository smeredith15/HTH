// Listing generator (SPEC §7). Builds Etsy copy from the artwork record so the
// specs in a description cannot drift away from the specs in the catalog.

import { SEED_TEMPLATES, PROCESS_SHORT, SPORTS_CUSTOM_LINE, render, missingPlaceholders } from './templates.js';
import { withDefaults } from '../store/settings.js';

// Human words for the enums. Used in descriptions and by the substrate
// validator, so the two always agree on what a word means.
export const SUBSTRATE_WORDS = {
  pine: 'pine', birch: 'birch', birch_plywood: 'birch plywood', mdf: 'MDF',
  live_edge_round: 'a live-edge wood round', skateboard_deck: 'a skateboard deck',
  other: 'wood',
};

export const PRINT_SUBSTRATE_WORDS = {
  canvas: 'canvas', mdf: 'MDF', wood_panel: 'wood panel', paper: 'fine-art paper', metal: 'metal',
};

const PRINT_SUBSTRATE_SENTENCES = {
  canvas: 'Printed on canvas and stretched over a wooden frame.',
  mdf: 'Printed directly onto an MDF panel.',
  wood_panel: 'Printed directly onto a wood panel.',
  paper: 'Printed on heavyweight fine-art paper.',
  metal: 'Printed on brushed aluminium.',
};

const CATEGORY_WORDS = {
  lighthouse: 'coastal', coastal: 'coastal', wildlife: 'wildlife', landscape: 'landscape',
  architecture: 'architectural', portrait_person: 'portrait', portrait_pet: 'pet',
  sports: 'sports', music: 'music', seasonal: 'seasonal', still_life: 'still life',
  fantasy: 'fantasy', other: 'wall',
};

const num = (value) => (value === null || value === undefined ? null : value);

// --- derived sentences -----------------------------------------------------

export function subjectLine(artwork) {
  const subject = artwork.subject_name || artwork.title || '';
  return artwork.subject_location ? `${subject}, ${artwork.subject_location}` : subject;
}

function framedPhrase(artwork) {
  if (!artwork.framed) return 'ready to hang';
  return artwork.frame_material ? `framed in ${artwork.frame_material}` : 'framed';
}

function frameSentence(artwork) {
  if (!artwork.framed) return '';
  return artwork.frame_material
    ? `Framed in ${artwork.frame_material}.`
    : 'Comes framed.';
}

function hardwareSentence(artwork) {
  const hardware = artwork.hanging_hardware;
  if (!hardware || hardware.toLowerCase() === 'none') return '';
  return `Hanging hardware is already fitted: ${hardware}.`;
}

/** "Measures 18.5 × 31 × 1 in." — or nothing, when no dimensions are recorded. */
export function measuresSentence(artwork) {
  const { width_in: w, height_in: h, depth_in: d } = artwork;
  if (!w || !h) return '';
  return d ? `Measures ${w} × ${h} × ${d} in.` : `Measures ${w} × ${h} in.`;
}

function substrateNoteSentence(artwork) {
  const note = (artwork.substrate_note ?? '').trim();
  if (!note) return '';
  return /[.!?]$/.test(note) ? note : `${note}.`;
}

/** The print template's "The original measured … and took about … hours." */
export function originalSizeSentence(artwork) {
  const { width_in: w, height_in: h, hours } = artwork;
  const size = w && h ? `The original measured ${w} × ${h} in` : 'The original was carved by hand';
  return hours ? `${size} and took about ${hours} hours.` : `${size}.`;
}

function originalStatusSentence(artwork) {
  switch (artwork.disposition) {
    case 'sold': case 'gifted': case 'commission_delivered':
      return 'The original has sold; this is a reproduction.';
    case 'available':
      return 'The original is still available — message me if you would rather have it.';
    default:
      return '';
  }
}

export function variantLines(variants = []) {
  return variants.map((v) => {
    const size = v.width_in && v.height_in ? `${v.width_in} × ${v.height_in} in` : (v.label || '');
    const price = v.price === null || v.price === undefined ? 'message me' : `$${Number(v.price).toFixed(2)}`;
    return `${size} — ${price}`;
  }).join('\n');
}

export function commissionPriceLines(settings) {
  return withDefaults(settings).commission_prices.map((row) => {
    const subjects = row.subjects >= 3 ? '3 or more subjects' : `${row.subjects} subject${row.subjects === 1 ? '' : 's'}`;
    const size = row.size === 'any' ? 'any size' : `${row.size} in`;
    const price = row.price === null ? 'quote' : `$${Number(row.price).toFixed(0)}`;
    return `${size}, ${subjects} — ${price}`;
  }).join('\n');
}

/** An ISO date reads as machine output in listing copy. "October 23" does not. */
export function formatCutoff(iso) {
  if (!iso) return '';
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// --- template context ------------------------------------------------------

export function buildContext(listing, artwork, settings) {
  const s = withDefaults(settings);
  const [min, max] = listing.processing_weeks ?? s.processing_weeks ?? [6, 8];
  const art = artwork ?? {};

  return {
    process_short: PROCESS_SHORT,
    subject_line: subjectLine(art),
    substrate: SUBSTRATE_WORDS[art.substrate] ?? '',
    substrate_note: art.substrate_note ?? '',
    substrate_note_sentence: substrateNoteSentence(art),
    measures_sentence: measuresSentence(art),
    original_size_sentence: originalSizeSentence(art),
    framed_phrase: framedPhrase(art),
    frame_sentence: frameSentence(art),
    hardware_sentence: hardwareSentence(art),
    history_paragraph: art.history ?? '',
    width_in: num(art.width_in),
    height_in: num(art.height_in),
    depth_in: num(art.depth_in),
    orig_width: num(art.width_in),
    orig_height: num(art.height_in),
    hours: num(art.hours),
    original_status_sentence: originalStatusSentence(art),
    print_substrate: PRINT_SUBSTRATE_WORDS[listing.print_substrate] ?? '',
    print_substrate_sentence: PRINT_SUBSTRATE_SENTENCES[listing.print_substrate] ?? '',
    variant_lines: variantLines(listing.variants),
    commission_price_lines: commissionPriceLines(s),
    processing_min: min,
    processing_max: max,
    holiday_cutoff: formatCutoff(s.holiday_cutoff),
    sports_line: listing.custom_kind === 'sports' ? `\n\n${SPORTS_CUSTOM_LINE}` : '',
  };
}

export function templateFor(listing, settings) {
  const templates = { ...SEED_TEMPLATES, ...(withDefaults(settings).templates ?? {}) };
  return templates[listing.listing_type] ?? templates.original;
}

// Placeholders that legitimately resolve to nothing: an unframed piece has no
// frame sentence, and that is not a gap in the record.
const OPTIONAL_PLACEHOLDERS = new Set([
  'history_paragraph', 'substrate_note', 'substrate_note_sentence', 'frame_sentence',
  'hardware_sentence', 'original_status_sentence', 'sports_line', 'depth_in',
]);

export function generateDescription(listing, artwork, settings) {
  const template = templateFor(listing, settings);
  const context = buildContext(listing, artwork, settings);
  return {
    text: render(template, context),
    // §7.3 promises every spec comes from the record. When the record cannot
    // supply one, say which, rather than shipping a sentence with a hole in it.
    missing: missingPlaceholders(template, context).filter((key) => !OPTIONAL_PLACEHOLDERS.has(key)),
  };
}

// --- title, tags, materials, category --------------------------------------

const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'of', 'in', 'on']);

function titleCaseWords(text) {
  return String(text).split(/\s+/).filter(Boolean)
    .map((w) => (STOP.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * A starting point, not a finished title. §B.1: the first ~40 characters carry
 * the search weight, so the subject phrase leads and "Handmade" never does.
 * The hand-drafted titles in B.7 are better than anything generated; this is
 * for pieces that do not have one yet.
 */
export function suggestTitle(artwork, listing) {
  const subject = titleCaseWords(artwork?.subject_name || artwork?.title || 'Wall');
  const category = CATEGORY_WORDS[artwork?.category] ?? 'wall';
  const segments = [`${subject} Wall Art`];

  if (listing?.listing_type === 'print') {
    const substrate = PRINT_SUBSTRATE_WORDS[listing.print_substrate] ?? 'Wood';
    segments.push(`${titleCaseWords(substrate)} Print of Carved Wood Original`);
  } else if (listing?.listing_type === 'custom') {
    segments.push('Hand Carved Pyrography from Your Photo');
  } else {
    segments.push('Original Scorched and Carved Wood');
  }

  segments.push(`${titleCaseWords(category)} Decor`);
  if (artwork?.colors?.length) segments.push(`${titleCaseWords(artwork.colors[0])} Wall Hanging`);
  else segments.push('Rustic Wall Hanging');

  let title = '';
  for (const segment of segments) {
    const next = title ? `${title}, ${segment}` : segment;
    if (next.length > 140) break;
    title = next;
  }
  return title;
}

/**
 * Thirteen multi-word tags, each within Etsy's 20-character limit. Generated
 * tags are a floor, not a strategy — B.7's hand-drafted sets beat these.
 */
export function suggestTags(artwork, listing) {
  const subject = String(artwork?.subject_name || artwork?.title || '').toLowerCase();
  const head = subject.split(/\s+/).slice(0, 2).join(' ');
  const category = CATEGORY_WORDS[artwork?.category] ?? 'wall';
  const isPrint = listing?.listing_type === 'print';

  const candidates = [
    `${head} wall art`,
    `${head} decor`,
    `${category} wall art`,
    `${category} home decor`,
    'wood burning art',
    isPrint ? 'pyrography print' : 'original wood art',
    'carved wood art',
    'rustic wall art',
    artwork?.colors?.length ? `${artwork.colors[0]} wall art` : 'monochrome wall art',
    `${head} gift`,
    'wall art gift',
    artwork?.framed ? 'framed wall art' : 'ready to hang art',
    isPrint ? 'wood print decor' : 'one of a kind art',
    'handcarved wall art',
    'cabin wall decor',
  ];

  const seen = new Set();
  const tags = [];
  for (const raw of candidates) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag.length > 20 || !tag.includes(' ') || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length === 13) break;
  }
  return tags;
}

/**
 * §B.1: up to 13 materials, and a technique such as "pyrography" is not one.
 */
export function suggestMaterials(artwork, listing) {
  const out = [];
  if (listing?.listing_type === 'print') {
    out.push(PRINT_SUBSTRATE_WORDS[listing.print_substrate] ?? 'wood panel');
    out.push('archival ink');
  } else {
    if (artwork?.substrate) out.push(SUBSTRATE_WORDS[artwork.substrate]);
    if (artwork?.framed && artwork.frame_material) out.push(artwork.frame_material);
    if (artwork?.finish) out.push(artwork.finish);
    for (const colour of artwork?.colors ?? []) out.push(colour);
    if (artwork?.hanging_hardware && artwork.hanging_hardware.toLowerCase() !== 'none') {
      out.push(artwork.hanging_hardware);
    }
  }
  const seen = new Set();
  return out
    .filter(Boolean)
    .map((m) => String(m).toLowerCase().replace(/^a /, ''))
    .filter((m) => (seen.has(m) ? false : seen.add(m)))
    .slice(0, 13);
}

/**
 * §B.1: only leaf categories can be selected, and Giclée is only honest once
 * the vendor confirms the process.
 */
export function suggestCategoryPath(listing) {
  if (listing?.listing_type === 'print') {
    return listing.print_process === 'giclee'
      ? 'Art & Collectibles > Prints > Giclée'
      : 'Art & Collectibles > Prints > Digital Prints';
  }
  if (listing?.listing_type === 'custom') {
    return 'Art & Collectibles > Drawing & Illustration > Portraits';
  }
  return 'Art & Collectibles > Mixed Media & Collage';
}

/** §7.2's reminder checklist — the things Etsy asks for that the app cannot fill. */
export function reminderChecklist(listing) {
  return [
    { key: 'attributes', text: 'Every attribute filled — they feed search filters and most sellers skip them' },
    { key: 'photos', text: 'All 10 photo slots used, in the B.2 order (in-room first, not a mockup in every slot)' },
    { key: 'video', text: 'Video uploaded — a slow pan across the surface. Etsy favours listings with one' },
    { key: 'processing', text: `Processing time set${listing?.processing_weeks ? ` to ${listing.processing_weeks[0]}–${listing.processing_weeks[1]} weeks` : ''}` },
    { key: 'quantity', text: `Quantity set${listing?.quantity ? ` to ${listing.quantity}` : ''}` },
    { key: 'shipping', text: 'Free shipping on — US search favours it, so build it into the price' },
  ];
}

/** Everything §7.2 asks the generator to emit, in one call. */
export function generateListing(listing, artwork, settings) {
  const description = generateDescription(listing, artwork, settings);
  return {
    title: listing.title || suggestTitle(artwork, listing),
    tags: listing.tags?.length ? listing.tags : suggestTags(artwork, listing),
    materials: listing.materials?.length ? listing.materials : suggestMaterials(artwork, listing),
    description: description.text,
    missing: description.missing,
    category_path: listing.category_path || suggestCategoryPath(listing),
    checklist: reminderChecklist(listing),
  };
}
