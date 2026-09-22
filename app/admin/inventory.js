// On hand, and the fair pack list (SPEC §6.3).

import { el, mount, money, dimensions, toast, rerender } from '../ui/dom.js';
import { listArtworks } from '../store/artworks.js';
import { loadSettings, patchSettings } from '../store/db.js';
import { quickSale } from '../store/sales.js';

export async function renderInventory(host) {
  const [artworks, settings] = await Promise.all([listArtworks(), loadSettings()]);
  // Ticking a box changes the totals above the table, so the view is rebuilt —
  // with the scroll position kept, because this list is long.
  const reload = () => rerender(() => renderInventory(host));
  const onHand = artworks.filter((a) => a.on_hand).sort((a, b) => a.title.localeCompare(b.title));
  const packed = new Set(settings.fair_pack ?? []);
  const packedPieces = onHand.filter((a) => packed.has(a.id));

  const total = (list) => list.reduce((t, a) => t + (Number(a.asking_price) || 0), 0);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'On hand'),
        el('p', { class: 'muted', text: `${onHand.length} pieces · ${money(total(onHand))} at asking prices` })),
      el('div', { class: 'row' },
        packedPieces.length ? el('button', { class: 'btn ghost', type: 'button', onClick: () => window.print() }, 'Print pack list') : null,
        el('a', { class: 'btn ghost', href: '#/catalog' }, 'Catalog'))),

    el('section', { class: 'panel no-print' },
      el('h2', null, 'Fair pack list'),
      el('p', { class: 'hint' }, 'Tick what is going in the van. After the fair, anything not sold stays on hand — '
        + 'sell one through Quick sale and it comes off this list by itself.'),
      packedPieces.length
        ? el('p', null, el('strong', { text: `${packedPieces.length} packed` }), ` · ${money(total(packedPieces))} of stock`)
        : el('p', { class: 'muted' }, 'Nothing packed yet.')),

    onHand.length
      ? el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null,
            ['Pack', 'Piece', 'Size', 'Price', 'Where it is', ''].map((h) => el('th', { text: h })))),
          el('tbody', null, onHand.map((artwork) => el('tr', { class: packed.has(artwork.id) ? 'row-packed' : '' },
            el('td', null, el('label', { class: 'check tight' }, el('input', {
              type: 'checkbox', checked: packed.has(artwork.id),
              'aria-label': `Pack ${artwork.title}`,
              onChange: async (e) => {
                const next = new Set(packed);
                if (e.target.checked) next.add(artwork.id); else next.delete(artwork.id);
                await patchSettings({ fair_pack: [...next] });
                reload();
              },
            }))),
            el('td', null, el('a', { href: `#/artwork/${artwork.id}`, text: artwork.title })),
            el('td', { text: dimensions(artwork) || '—' }),
            el('td', { text: money(artwork.asking_price) }),
            el('td', { text: artwork.location_stored || '—' }),
            el('td', { class: 'no-print' }, el('button', {
              class: 'btn ghost small', type: 'button',
              onClick: async () => {
                const price = prompt(`Sold ${artwork.title} for how much?`, artwork.asking_price ?? '');
                if (price === null) return;
                await quickSale({ artwork, price: Number(price), payment_method: 'cash', channel: 'fair' });
                const next = new Set(packed);
                next.delete(artwork.id);
                await patchSettings({ fair_pack: [...next] });
                toast(`Sold: ${artwork.title}`, 'ok');
                reload();
              },
            }, 'Sold'))))))) 
      : el('p', { class: 'empty' }, 'Nothing is marked as on hand. Open a piece and tick “Physically on hand”.'));
}
