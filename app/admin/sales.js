// Sales, and the three-tap quick sale for a fair table (SPEC §5.6).

import { el, mount, money, label, dateOnly, field, select, pill, toast, confirmDialog } from '../ui/dom.js';
import {
  listSales, createSale, saveSale, deleteSale, quickSale, breakdown, feesFor,
} from '../store/sales.js';
import { listArtworks } from '../store/artworks.js';
import { loadSettings } from '../store/db.js';
import { SALE_CHANNEL, SALE_SOURCE, PAYMENT_METHOD, RELATIONSHIP } from '../store/schema.js';

export async function renderSales(host) {
  const [sales, artworks, settings] = await Promise.all([listSales(), listArtworks(), loadSettings()]);
  const byId = new Map(artworks.map((a) => [a.id, a]));
  const reload = () => renderSales(host);
  const sorted = [...sales].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Sales'),
        el('p', { class: 'muted', text: `${sales.length} recorded` })),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: '#/money' }, 'Money'),
        el('button', { class: 'btn primary', type: 'button', onClick: () => openQuickSale(artworks, reload) }, 'Quick sale'))),

    el('section', { class: 'panel' },
      el('p', { class: 'hint' }, 'Quick sale is for a fair table: pick the piece, type the price, tap the payment. '
        + 'It marks the piece sold and takes it off your on-hand list. Everything else can be filled in later.')),

    sorted.length
      ? el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null,
            ['Date', 'Piece', 'Channel', 'Gross', 'Fees', 'Net', 'Per hour', ''].map((h) => el('th', { text: h })))),
          el('tbody', null, sorted.map((sale) => {
            const b = breakdown(sale, settings);
            const artwork = sale.artwork_id ? byId.get(sale.artwork_id) : null;
            return el('tr', null,
              el('td', { text: dateOnly(sale.date) }),
              el('td', null, artwork
                ? el('a', { href: `#/artwork/${artwork.id}`, text: artwork.title })
                : el('span', { class: 'muted', text: '—' })),
              el('td', null, pill(label(sale.channel), sale.channel === 'etsy' ? '' : 'muted')),
              el('td', { text: money(b.gross) }),
              el('td', { class: 'muted', text: money(b.fees) }),
              el('td', null, el('strong', { text: money(b.net) })),
              el('td', null, b.hourly === null
                ? el('span', { class: 'muted small', text: 'no hours' })
                : el('strong', {
                  class: b.hourly < settings.target_hourly ? 'bad-text' : 'ok-text',
                  text: money(b.hourly),
                })),
              el('td', null, el('button', {
                class: 'btn ghost small', type: 'button',
                onClick: () => openSale(sale, artworks, settings, reload),
              }, 'Edit')));
          }))))
      : el('p', { class: 'empty' }, 'No sales recorded yet.'));
}

/** §5.6: three taps. Piece, price, payment. */
function openQuickSale(artworks, reload) {
  const onHand = artworks
    .filter((a) => a.on_hand || a.disposition === 'available')
    .sort((a, b) => a.title.localeCompare(b.title));
  const pool = onHand.length ? onHand : [...artworks].sort((a, b) => a.title.localeCompare(b.title));

  const artworkSelect = select(pool.map((a) => [a.id, `${a.title}${a.asking_price ? ` — ${money(a.asking_price)}` : ''}`]), pool[0]?.id, {
    class: 'big',
    onChange: () => {
      const picked = pool.find((a) => a.id === artworkSelect.value);
      if (picked?.asking_price && !priceInput.dataset.touched) priceInput.value = picked.asking_price;
    },
  });
  const priceInput = el('input', {
    type: 'number', step: '0.01', inputMode: 'decimal', class: 'big', required: true,
    value: pool[0]?.asking_price ?? '',
    onInput: (e) => { e.target.dataset.touched = '1'; },
  });

  let method = 'cash';
  const methodButtons = el('div', { class: 'chips' }, PAYMENT_METHOD.map((m) => {
    const button = el('button', {
      class: `btn ghost${m === method ? ' primary' : ''}`, type: 'button',
      onClick: () => {
        method = m;
        for (const b of methodButtons.children) b.className = 'btn ghost';
        button.className = 'btn primary';
      },
    }, label(m));
    return button;
  }));

  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body', onSubmit: async (event) => {
      event.preventDefault();
      const artwork = pool.find((a) => a.id === artworkSelect.value);
      if (!artwork) return;
      await quickSale({
        artwork,
        price: Number(priceInput.value),
        payment_method: method,
        channel: method === 'etsy' ? 'etsy' : 'fair',
      });
      dialog.close();
      toast(`Sold: ${artwork.title}. It is off your on-hand list.`, 'ok');
      reload();
    } },
      el('h2', null, 'Quick sale'),
      field('Piece', artworkSelect),
      field('Price', priceInput),
      field('Paid by', methodButtons),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Record it'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/** The full record, for when the detail matters. */
function openSale(sale, artworks, settings, reload) {
  const draft = structuredClone(sale);
  const summary = el('div', { class: 'hint' });
  const refresh = () => {
    const b = breakdown(draft, settings);
    mount(summary, el('span', null,
      `Fees ${money(b.fees)} · net ${money(b.net)}`,
      b.hourly === null ? '' : ` · ${money(b.hourly)} an hour`));
  };

  const num = (key, labelText, hint) => field(labelText, el('input', {
    type: 'number', step: '0.01', inputMode: 'decimal', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value === '' ? null : Number(e.target.value); refresh(); },
  }), hint);

  const enumField = (key, labelText, values) => field(labelText,
    select(values.map((v) => [v, label(v)]), draft[key], {
      onChange: (e) => { draft[key] = e.target.value || null; refresh(); },
    }));

  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body', onSubmit: async (event) => {
      event.preventDefault();
      await saveSale(draft);
      dialog.close();
      toast('Saved', 'ok');
      reload();
    } },
      el('h2', null, 'Sale'),
      field('Date', el('input', { type: 'date', value: draft.date ?? '', onInput: (e) => { draft.date = e.target.value; } })),
      field('Piece', select(
        [['', 'None'], ...artworks.map((a) => [a.id, a.title])], draft.artwork_id,
        { onChange: (e) => { draft.artwork_id = e.target.value || null; } },
      )),
      el('div', { class: 'two-up' }, enumField('channel', 'Channel', SALE_CHANNEL), enumField('source', 'Where they came from', SALE_SOURCE)),
      el('div', { class: 'two-up' }, enumField('relationship', 'Who they are', RELATIONSHIP), enumField('payment_method', 'Paid by', PAYMENT_METHOD)),
      el('div', { class: 'two-up' }, num('gross_price', 'Price'), num('shipping_charged', 'Shipping charged')),
      el('div', { class: 'two-up' }, num('shipping_cost', 'Shipping cost'), num('materials_cost', 'Materials')),
      el('div', { class: 'two-up' },
        num('hours', 'Hours', 'Without this there is no rate.'),
        num('fees', 'Fees', 'Blank means work it out from Settings.')),
      summary,
      el('div', { class: 'row end' },
        el('button', { class: 'btn danger ghost', type: 'button', onClick: async () => {
          const ok = await confirmDialog('Delete this sale?', { confirmText: 'Delete' });
          if (!ok) return;
          await deleteSale(draft.id);
          dialog.close();
          toast('Deleted');
          reload();
        } }, 'Delete'),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Save'))));

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  refresh();
}

export { createSale, feesFor };
