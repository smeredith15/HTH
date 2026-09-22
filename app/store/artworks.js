// Artwork repository: CRUD plus the catalog filters (SPEC §6.1).
// The filter and sort functions are pure so the tests can exercise them.

import { getAll, get, put, remove } from './db.js';
import { newArtwork, slugify, uniqueId, duplicateAsNew, effectiveRights } from './schema.js';

export const BLANK_FILTERS = {
  q: '',
  status: '',
  disposition: '',
  on_hand: '',
  category: '',
  series: '',
  color: '',        // 'color' | 'mono'
  has_face: '',
  listing_ok: '',
  print_master: '',
  visibility: '',
};

export const SORTS = {
  updated: { label: 'Recently updated', fn: (a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) },
  title: { label: 'Title', fn: (a, b) => a.title.localeCompare(b.title) },
  price: { label: 'Price', fn: (a, b) => (b.asking_price ?? -1) - (a.asking_price ?? -1) },
  category: { label: 'Category', fn: (a, b) => String(a.category).localeCompare(String(b.category)) || a.title.localeCompare(b.title) },
};

const TRUTHY = (v) => v === 'yes' || v === true;

export function matchesFilters(artwork, filters = {}) {
  const f = { ...BLANK_FILTERS, ...filters };

  if (f.q) {
    const needle = f.q.toLowerCase();
    const haystack = [
      artwork.title, artwork.subject_name, artwork.subject_location,
      artwork.notes, artwork.blurb, artwork.series, artwork.id,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (f.status && artwork.status !== f.status) return false;
  if (f.disposition && artwork.disposition !== f.disposition) return false;
  if (f.category && artwork.category !== f.category) return false;
  if (f.series && artwork.series !== f.series) return false;
  if (f.visibility && artwork.visibility !== f.visibility) return false;
  if (f.on_hand && TRUTHY(f.on_hand) !== !!artwork.on_hand) return false;
  if (f.has_face && TRUTHY(f.has_face) !== !!artwork.has_face) return false;
  if (f.color) {
    const hasColor = (artwork.colors || []).length > 0;
    if (f.color === 'color' && !hasColor) return false;
    if (f.color === 'mono' && hasColor) return false;
  }
  if (f.print_master) {
    const has = !!artwork.print_master?.exists;
    if (TRUTHY(f.print_master) !== has) return false;
  }
  if (f.listing_ok && effectiveRights(artwork.rights).listing_ok !== f.listing_ok) return false;
  return true;
}

export function filterArtworks(artworks, filters, sort = 'updated') {
  const out = artworks.filter((a) => matchesFilters(a, filters));
  const sorter = SORTS[sort] ?? SORTS.updated;
  return out.sort(sorter.fn);
}

// --- persistence ----------------------------------------------------------

export function listArtworks() {
  return getAll('artworks');
}

export function getArtwork(id) {
  return get('artworks', id);
}

export async function saveArtwork(artwork) {
  const record = { ...artwork, updated_at: new Date().toISOString() };
  if (!record.title?.trim()) record.title = 'Untitled';
  await put('artworks', record);
  return record;
}

export async function createArtwork(patch = {}) {
  const existing = new Set((await listArtworks()).map((a) => a.id));
  const art = newArtwork(patch);
  art.id = uniqueId(art.id || slugify(art.title), existing);
  return saveArtwork(art);
}

/**
 * §6.1 quick add: a title, and that's all it takes.
 *
 * The record it creates is not empty, though. Technique, and whatever
 * substrate and finish the last few pieces used, are filled in — those are
 * facts about the workshop, not about this piece. Nothing that describes the
 * object itself is guessed; see app/store/autofill.js.
 */
export async function quickAdd(title) {
  const { defaultsForNew } = await import('./autofill.js');
  const existing = await listArtworks();
  const filled = defaultsForNew(title, existing);
  const artwork = await createArtwork({ title, status: 'in_progress', ...filled });
  return { artwork, filled };
}

/**
 * §6.1 duplicate-as-new. Copies category, substrate, frame, techniques and
 * series only — never dimensions, title, description, price, images, hours or
 * rights. That copy-everything habit is how the moose inherited the golf
 * bag's dimensions.
 */
export async function duplicateArtwork(sourceId, title) {
  const source = await getArtwork(sourceId);
  if (!source) throw new Error(`No artwork with id ${sourceId}`);
  const copy = duplicateAsNew(source, title || `${source.title} (copy)`);
  const existing = new Set((await listArtworks()).map((a) => a.id));
  copy.id = uniqueId(slugify(copy.title), existing);
  return saveArtwork(copy);
}

export function deleteArtwork(id) {
  return remove('artworks', id);
}

/** Distinct series names already in use, for the filter menu. */
export function seriesIn(artworks) {
  return [...new Set(artworks.map((a) => a.series).filter(Boolean))].sort();
}
