// Listings index (SPEC §5.5, §6.4).

import { el, mount, label, money, pill, toast } from '../ui/dom.js';
import { navigate } from '../router.js';
import { listListings, createListing, listingsNeedingAttention } from '../store/listings.js';
import { listArtworks } from '../store/artworks.js';
import { loadSettings } from '../store/db.js';

const TONE = { stop: 'bad', warn: 'warn', note: 'muted' };

export async function renderListings(host) {
  const [listings, artworks, settings] = await Promise.all([
    listListings(), listArtworks(), loadSettings(),
  ]);
  const rows = listingsNeedingAttention(listings, artworks, settings);
  const flagged = new Map(rows.map((r) => [r.listing.id, r]));
  const byArtwork = new Map(artworks.map((a) => [a.id, a]));

  const live = listings.filter((l) => l.status !== 'relisted' && l.status !== 'deleted');
  const archived = listings.filter((l) => l.status === 'relisted' || l.status === 'deleted');

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Listings'),
        el('p', { class: 'muted', text: `${live.length} live and draft · ${rows.length} need attention` })),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: '#/print-costs' }, 'Print costs'),
        el('button', { class: 'btn primary', type: 'button', onClick: () => addListing(artworks) }, '+ New listing'))),

    rows.length
      ? el('section', { class: 'panel alert warn' },
        el('h2', null, 'Needing attention'),
        el('ul', { class: 'link-list' }, rows.slice(0, 6).map((row) =>
          el('li', null,
            el('a', { href: `#/listing/${row.listing.id}`, text: row.listing.title || row.listing.id }),
            ' ',
            countPills(row.counts)))))
      : null,

    group('Live and draft', live, flagged, byArtwork),
    archived.length ? group('Relisted and deleted', archived, flagged, byArtwork) : null);
}

function countPills(counts) {
  return el('span', { class: 'badges inline' },
    counts.stop ? pill(`${counts.stop} serious`, 'bad') : null,
    counts.warn ? pill(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`, 'warn') : null,
    counts.note ? pill(`${counts.note} note${counts.note === 1 ? '' : 's'}`, 'muted') : null);
}

function group(heading, listings, flagged, byArtwork) {
  if (!listings.length) return null;
  return el('section', { class: 'panel' },
    el('h2', { text: heading }),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', null, el('tr', null,
          ['Listing', 'Type', 'Piece', 'Price', 'Status', 'Checks'].map((h) => el('th', { text: h })))),
        el('tbody', null, listings.map((listing) => {
          const row = flagged.get(listing.id);
          const artwork = listing.artwork_id ? byArtwork.get(listing.artwork_id) : null;
          const prices = (listing.variants ?? []).map((v) => v.price).filter((p) => typeof p === 'number');
          return el('tr', null,
            el('td', null, el('a', { href: `#/listing/${listing.id}`, text: listing.title || listing.id })),
            el('td', { text: label(listing.listing_type) }),
            el('td', null, artwork
              ? el('a', { href: `#/artwork/${artwork.id}`, text: artwork.title })
              : el('span', { class: 'muted', text: '—' })),
            el('td', { text: prices.length ? `${money(Math.min(...prices))}${prices.length > 1 ? '+' : ''}` : '—' }),
            el('td', null, pill(label(listing.status), listing.status === 'active' ? 'ok' : 'muted')),
            el('td', null, row ? countPills(row.counts) : pill('clean', 'ok')));
        })))));
}

async function addListing(artworks) {
  const select = el('select', null,
    el('option', { value: '', text: 'No piece (custom listing)' }),
    artworks.slice().sort((a, b) => a.title.localeCompare(b.title))
      .map((a) => el('option', { value: a.id, text: a.title })));
  const type = el('select', null,
    ['original', 'print', 'custom'].map((t) => el('option', { value: t, text: label(t) })));

  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body',
      onSubmit: async (event) => {
        event.preventDefault();
        const artwork = artworks.find((a) => a.id === select.value);
        const listing = await createListing({
          artwork_id: select.value || null,
          listing_type: type.value,
          title: artwork ? `${artwork.title} listing` : 'Custom listing',
          status: 'draft',
        });
        dialog.close();
        toast('Draft created', 'ok');
        navigate(`/listing/${listing.id}`);
      } },
      el('h2', null, 'New listing'),
      el('div', { class: 'field' }, el('span', null, 'Piece'), select),
      el('div', { class: 'field' }, el('span', null, 'Type'), type),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Create'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
