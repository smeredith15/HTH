// Data model for the private layer (SPEC §5).
//
// This module is pure: no IndexedDB, no DOM. It is imported by the store, by
// the admin UI, and by the Node tests. Everything that decides what is public
// and what is private lives here, so there is exactly one place to audit.

export const ARTWORK_STATUS = ['idea', 'in_progress', 'finished', 'archived'];
export const DISPOSITION = [
  'available', 'sold', 'gifted', 'commission_delivered', 'kept', 'lost', 'unknown',
];
export const VISIBILITY = ['public', 'private'];
export const CATEGORY = [
  'lighthouse', 'coastal', 'wildlife', 'landscape', 'architecture',
  'portrait_person', 'portrait_pet', 'sports', 'music', 'seasonal',
  'still_life', 'fantasy', 'other',
];
export const SHAPE = ['rect', 'square', 'round', 'oval', 'live_edge', 'other'];
export const SUBSTRATE = [
  'pine', 'birch', 'birch_plywood', 'mdf', 'live_edge_round', 'skateboard_deck', 'other',
];
export const TECHNIQUE = [
  'scorch_and_carve', 'pyrography_line', 'stain', 'paint', 'gold_leaf', 'relief_carve',
];
export const RIGHTS_FLAG = [
  'own_design', 'own_photo_reference', 'public_domain_reference', 'customer_photo',
  'family_personal', 'public_figure_likeness', 'trademark_or_logo',
  'third_party_photo', 'third_party_artwork',
];
export const RIGHTS_ANSWER = ['yes', 'ask_first', 'no', 'unknown'];
export const IMAGE_ROLE = [
  'primary', 'straight_on', 'detail_raking', 'in_room', 'scale',
  'back_hardware', 'signature', 'process', 'mockup', 'group',
];
export const QUALITY_FLAG = [
  'warm_cast', 'angled', 'low_res', 'compressed', 'blurry', 'watermark',
  'broken_composite', 'cluttered_background',
];
export const PRINT_READY = ['yes', 'needs_retouch', 'no'];

// ---------------------------------------------------------------------------
// Public / private field split (SPEC §5.1, §5.3)
//
// PUBLIC_ARTWORK_FIELDS is an allow-list, not a deny-list. The catalog builder
// (Phase 4) copies only these names, so a field added later is private until
// someone deliberately adds it here. Same for images.
// ---------------------------------------------------------------------------

export const PUBLIC_ARTWORK_FIELDS = [
  'id', 'title', 'status', 'disposition', 'category', 'series', 'subject_name',
  'subject_location', 'year', 'width_in', 'height_in', 'depth_in', 'shape',
  'substrate', 'substrate_note', 'framed', 'frame_material', 'hanging_hardware',
  'finish', 'techniques', 'colors', 'asking_price', 'blurb', 'images',
  'primary_listing_url',
];

export const PUBLIC_IMAGE_FIELDS = [
  'id', 'role', 'is_mockup', 'web_path', 'thumb_path', 'width_px', 'height_px',
  'alt', 'kiosk_order', 'in_kiosk',
];

/** Every artwork field name that must never reach data/catalog.json. */
export const PRIVATE_ARTWORK_FIELDS = [
  'on_hand', 'location_stored', 'visibility', 'date_finished', 'has_face',
  'subject_count', 'hours', 'hours_sessions', 'materials_cost',
  'show_price_in_kiosk', 'notes', 'reference_source', 'rights', 'print_master',
  'commission_id', 'created_at', 'updated_at',
];

export const PRIVATE_IMAGE_FIELDS = ['quality_flags', 'original_blob_id'];

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function newRights() {
  return {
    flags: [],
    print_ok: null,
    listing_ok: null,
    edits_required: null,
    consent_obtained: null,
    notes: null,
  };
}

export function newPrintMaster() {
  return {
    exists: false,
    location: null,
    filename: null,
    long_edge_px: null,
    short_edge_px: null,
    captured_on: null,
    capture_notes: null,
    print_ready: null,
    retouch_notes: null,
  };
}

/**
 * A blank artwork. §2.1: title is the only required field, so every other
 * value here is null/empty and the UI never insists on one.
 */
export function newArtwork(patch = {}) {
  const now = new Date().toISOString();
  const base = {
    id: null,
    title: '',
    status: 'idea',
    disposition: 'unknown',
    on_hand: false,
    location_stored: null,
    visibility: 'private', // §5.1 default — nothing publishes by accident
    category: null,
    series: null,
    subject_name: null,
    subject_location: null,
    year: null,
    date_finished: null,
    width_in: null,
    height_in: null,
    depth_in: null,
    shape: null,
    substrate: null,
    substrate_note: null,
    framed: false,
    frame_material: null,
    hanging_hardware: null,
    finish: null,
    techniques: [],
    colors: [],
    has_face: false,
    subject_count: null,
    hours: null,
    hours_sessions: [],
    materials_cost: null,
    asking_price: null,
    show_price_in_kiosk: true,
    blurb: null,
    notes: null,
    reference_source: null,
    rights: newRights(),
    print_master: newPrintMaster(),
    images: [],
    primary_listing_url: null,
    commission_id: null,
    created_at: now,
    updated_at: now,
  };
  const art = { ...base, ...patch };
  if (patch.rights) art.rights = { ...newRights(), ...patch.rights };
  if (patch.print_master) art.print_master = { ...newPrintMaster(), ...patch.print_master };
  if (!art.id) art.id = slugify(art.title);
  return art;
}

/** Readable slug ids (§5). Immutable once created. */
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

/** Append -2, -3 … until the id is free. */
export function uniqueId(base, taken) {
  const has = taken instanceof Set ? (k) => taken.has(k) : (k) => taken.includes(k);
  if (!has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Duplicate as new (§6.1)
//
// The moose inherited the golf bag's dimensions because someone copied a whole
// listing. So this copies a deliberately short list and nothing else. The
// forbidden list is asserted by tests/duplicate.test.js.
// ---------------------------------------------------------------------------

export const DUPLICABLE_FIELDS = [
  'category', 'series', 'substrate', 'substrate_note', 'framed',
  'frame_material', 'hanging_hardware', 'finish', 'techniques',
];

export const NEVER_DUPLICATED_FIELDS = [
  'id', 'title', 'width_in', 'height_in', 'depth_in', 'blurb', 'notes',
  'asking_price', 'images', 'hours', 'hours_sessions', 'rights',
  'print_master', 'materials_cost', 'primary_listing_url', 'subject_name',
  'subject_location', 'year', 'date_finished', 'commission_id', 'colors',
];

export function duplicateAsNew(source, title = '') {
  const copied = {};
  for (const field of DUPLICABLE_FIELDS) {
    const value = source[field];
    copied[field] = Array.isArray(value) ? [...value] : value;
  }
  return newArtwork({ ...copied, title, id: null });
}

// ---------------------------------------------------------------------------
// Rights default derivation (§5.2). Advisory: the app warns, never blocks.
// ---------------------------------------------------------------------------

const CLEAN_FLAGS = ['own_design', 'own_photo_reference', 'public_domain_reference'];
const ASK_FLAGS = ['customer_photo', 'family_personal'];
const NO_FLAGS = [
  'public_figure_likeness', 'trademark_or_logo', 'third_party_photo', 'third_party_artwork',
];

export function deriveRightsAnswer(flags = []) {
  if (flags.some((f) => NO_FLAGS.includes(f))) return 'no';
  if (flags.some((f) => ASK_FLAGS.includes(f))) return 'ask_first';
  if (flags.length && flags.every((f) => CLEAN_FLAGS.includes(f))) return 'yes';
  return 'unknown';
}

/** Owner-set values win; derivation only fills a blank. */
export function effectiveRights(rights = newRights()) {
  const derived = deriveRightsAnswer(rights.flags || []);
  return {
    ...rights,
    print_ok: rights.print_ok || derived,
    listing_ok: rights.listing_ok || derived,
    print_ok_derived: !rights.print_ok,
    listing_ok_derived: !rights.listing_ok,
  };
}

// ---------------------------------------------------------------------------
// Print size limits (§5.4)
// ---------------------------------------------------------------------------

export function printLimits(printMaster) {
  const px = printMaster?.long_edge_px;
  if (!px) return null;
  return {
    at150: px / 150,
    at100: px / 100,
  };
}

/**
 * §6.4 counts "a usable master". A file can exist and still be no good: the
 * Hooper Strait lighthouse has one, at 1,440 px, which prints to 9.6 in and is
 * marked print_ready `no`. That is not coverage.
 */
export function hasUsableMaster(artwork) {
  const master = artwork?.print_master;
  return !!master?.exists && master.print_ready !== 'no';
}

/** Gone from the studio, so it can only ever be reproduced from a file. */
export function isGone(artwork) {
  return ['sold', 'gifted', 'commission_delivered'].includes(artwork?.disposition);
}

// ---------------------------------------------------------------------------
// Completeness meter (§6.1) — only the fields that actually matter.
// ---------------------------------------------------------------------------

export function completeness(artwork) {
  const images = artwork.images || [];
  const hasRole = (role) => images.some((img) => img.role === role);
  const checks = [
    { key: 'dimensions', label: 'Dimensions', ok: !!(artwork.width_in && artwork.height_in) },
    { key: 'substrate', label: 'Substrate', ok: !!artwork.substrate },
    { key: 'straight_on', label: 'Straight-on photo', ok: hasRole('straight_on') },
    { key: 'detail_raking', label: 'Raking-light detail', ok: hasRole('detail_raking') },
    { key: 'print_master', label: 'Print master', ok: hasUsableMaster(artwork) },
    { key: 'alt', label: 'Alt text on every image', ok: images.length > 0 && images.every((i) => !!i.alt) },
    { key: 'rights', label: 'Rights reviewed', ok: (artwork.rights?.flags || []).length > 0 },
  ];
  const done = checks.filter((c) => c.ok).length;
  return { checks, done, total: checks.length, pct: Math.round((done / checks.length) * 100) };
}
