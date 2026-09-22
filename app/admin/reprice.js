// Pricing recommendations (SPEC §8). Every live price against what the record
// says it should be, worst first.

import { el, mount, money, pill, toast } from '../ui/dom.js';
import { listArtworks, saveArtwork } from '../store/artworks.js';
import { listListings, saveListing } from '../store/listings.js';
import { listPrintCosts, listPrintVendors } from '../store/print-costs.js';
import { loadSettings } from '../store/db.js';
import { recommendations, summarise, sizeLabel } from '../reports/reprice.js';

const TONE = { losing: 'bad', thin: 'warn', under: 'muted', ok: 'ok' };
const HEADING = {
  losing: 'Losing money',
  thin: 'Barely clearing cost',
  under: 'Under your target',
  ok: 'Priced fine',
};

export async function renderReprice(host) {
  const [artworks, listings, costRows, vendors, settings] = await Promise.all([
    listArtworks(), listListings(), listPrintCosts(), listPrintVendors(), loadSettings(),
  ]);
  const reload = () => renderReprice(host);
  const rows = recommendations({ artworks, listings, costRows, vendors, settings });
  const counts = summarise(rows);

  const groups = ['losing', 'thin', 'under', 'ok']
    .map((severity) => ({ severity, rows: rows.filter((r) => r.severity === severity) }))
    .filter((g) => g.rows.length);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Pricing'),
        el('p', { class: 'muted', text: rows.length
          ? `${counts.needsAttention} of ${counts.total} prices need attention`
          : 'Nothing priced yet' })),
      el('a', { class: 'btn ghost', href: '#/money' }, 'Money')),

    rows.length
      ? el('section', { class: `panel alert ${counts.losing ? 'bad' : counts.needsAttention ? 'warn' : 'ok'}` },
        counts.losing
          ? el('p', null, el('strong', { text: `${counts.losing} price${counts.losing === 1 ? '' : 's'} sell below what it costs to make. ` }),
            'Every one of those sales takes money out.')
          : counts.needsAttention
            ? el('p', null, `Raising everything here to its target would add `,
              el('strong', { text: money(counts.perSale) }), ' per sale across ',
              String(counts.needsAttention), ' prices.')
            : el('p', null, 'Everything clears your target margin.'),
        el('p', { class: 'hint' }, 'Nothing here changes a price by itself. Each suggestion has a button, and you decide.'))
      : el('section', { class: 'panel' },
        el('h2', null, 'Nothing to work with yet'),
        el('p', null, 'Prices are judged against what a print costs at the lab, or what an original took in hours. '
          + 'Fill in either and the recommendations appear.'),
        el('div', { class: 'row' },
          el('a', { class: 'btn primary', href: '#/print-costs' }, 'Print costs'),
          el('a', { class: 'btn ghost', href: '#/catalog' }, 'Record hours on a piece'))),

    ...groups.map((group) => el('section', { class: 'panel' },
      el('h2', null, HEADING[group.severity], ' ', pill(String(group.rows.length), TONE[group.severity])),
      el('ul', { class: 'reprice-list' }, group.rows.map((row) => rowView(row, settings, reload))))));
}

function rowView(row, settings, reload) {
  const name = row.kind === 'print'
    ? `${row.artwork?.title ?? row.listing.title ?? row.listing.id} · ${row.variant.label || sizeLabel(row.variant)}`
    : row.artwork.title;

  return el('li', null,
    el('div', { class: 'reprice-head' },
      el('strong', { text: name }),
      el('span', { class: 'muted small', text: row.kind === 'print' ? row.costRow.product : 'Original' })),

    el('div', { class: 'reprice-numbers' },
      figure('Now', money(row.price)),
      row.kind === 'print'
        ? figure('Costs', money(row.cost.total))
        : figure('Floor', row.floor ? money(row.floor) : '—'),
      row.kind === 'print'
        ? figure('Keeps', row.profit === undefined ? '—' : money(row.profit),
          row.margin < 0 ? 'bad-text' : row.margin < 0.2 ? 'warn-text' : 'ok-text')
        : figure('An hour', row.hourly === null ? '—' : money(row.hourly),
          row.hourly !== null && row.hourly < settings.target_hourly ? 'bad-text' : 'ok-text'),
      row.suggested ? figure('Target', money(row.suggested), 'ok-text') : null),

    el('p', { class: 'hint', text: row.reason }),

    row.cheaper
      ? el('p', { class: 'alert warn callout' },
        el('strong', null, 'Cheaper the same size: '), row.cheaper.text,
        ' Nobody pays a print price that covers the dearer stock.')
      : null,

    row.suggested
      ? el('div', { class: 'row' },
        el('button', {
          class: 'btn ghost small', type: 'button',
          onClick: () => apply(row, row.suggested, reload),
        }, `Set to ${money(row.suggested)}`),
        row.kind === 'print' && row.floor
          ? el('button', {
            class: 'btn ghost small', type: 'button',
            onClick: () => apply(row, Math.ceil(row.floor), reload),
          }, `Or just clear cost, ${money(Math.ceil(row.floor))}`)
          : null)
      : null);
}

function figure(term, value, tone = '') {
  return el('div', { class: 'figure' },
    el('span', { class: 'muted small', text: term }),
    el('strong', { class: tone, text: String(value) }));
}

async function apply(row, price, reload) {
  const rounded = Math.round(price * 100) / 100;
  if (row.kind === 'print') {
    const variants = row.listing.variants.map((v) => (v === row.variant || v.label === row.variant.label
      ? { ...v, price: rounded } : v));
    await saveListing({ ...row.listing, variants });
    toast(`${row.variant.label || 'That size'} set to ${money(rounded)}. Change it on Etsy too.`, 'ok');
  } else {
    await saveArtwork({ ...row.artwork, asking_price: rounded });
    toast(`${row.artwork.title} set to ${money(rounded)}.`, 'ok');
  }
  reload();
}
