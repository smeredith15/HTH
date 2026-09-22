// Listing repository (SPEC §5.5).

import { getAll, get, put, remove } from './db.js';
import { newListing, slugify, uniqueId } from './schema.js';
import { validateListing, summarise } from '../listing/validators.js';

export function listListings() {
  return getAll('listings');
}

export function getListing(id) {
  return get('listings', id);
}

export async function saveListing(listing) {
  const record = { ...listing, updated_at: new Date().toISOString() };
  await put('listings', record);
  return record;
}

export async function createListing(patch = {}) {
  const taken = new Set((await listListings()).map((l) => l.id));
  const listing = newListing(patch);
  listing.id = uniqueId(listing.id || `lst-${slugify(listing.title || 'untitled')}`, taken);
  return saveListing(listing);
}

export function deleteListing(id) {
  return remove('listings', id);
}

/**
 * §B.1: relisting mints a new Etsy id and discards the old URL and history.
 * The old row stays — it is the record of what was live — and points forward.
 */
export async function relist(sourceId) {
  const source = await getListing(sourceId);
  if (!source) throw new Error(`No listing with id ${sourceId}`);

  const copy = await createListing({
    ...structuredClone(source),
    id: null,
    // A relist is a new Etsy listing: its id, URL and favourites start empty.
    etsy_listing_id: null,
    etsy_url: null,
    favorites_snapshot: null,
    suppression_suspected: false,
    suppression_checked_on: null,
    status: 'draft',
    replaced_by: null,
    created_on: new Date().toISOString().slice(0, 10),
  });
  await saveListing({ ...source, status: 'relisted', replaced_by: copy.id });
  return copy;
}

/** §6.4's "listings needing attention", ranked by how bad the worst finding is. */
export function listingsNeedingAttention(listings, artworks, settings) {
  const byId = new Map(artworks.map((a) => [a.id, a]));
  return listings
    .filter((l) => l.status !== 'deleted' && l.status !== 'relisted')
    .map((listing) => {
      const artwork = listing.artwork_id ? byId.get(listing.artwork_id) : null;
      const findings = validateListing(listing, artwork, settings);
      return { listing, artwork, findings, counts: summarise(findings) };
    })
    .filter((row) => row.counts.total > 0)
    .sort((a, b) => (b.counts.stop - a.counts.stop) || (b.counts.warn - a.counts.warn));
}
