// Catalog: grid and list views, filters, search, quick add (SPEC §6.1).

import { el, mount, money, label, dimensions, pill, select, toast } from '../ui/dom.js';
import { navigate } from '../router.js';
import {
  listArtworks, filterArtworks, seriesIn, quickAdd, BLANK_FILTERS, SORTS,
} from '../store/artworks.js';
import {
  ARTWORK_STATUS, DISPOSITION, CATEGORY, VISIBILITY, effectiveRights, completeness,
  hasUsableMaster, isGone,
} from '../store/schema.js';

const state = { filters: { ...BLANK_FILTERS }, sort: 'updated', view: 'grid' };

const RIGHTS_TONE = { yes: 'ok', ask_first: 'warn', no: 'bad', unknown: 'muted' };

export async function renderCatalog(host, { query } = {}) {
  if (query?.get('q')) state.filters.q = query.get('q');
  const all = await listArtworks();
  const draw = () => {
    const shown = filterArtworks(all, state.filters, state.sort);
    mount(host,
      header(all, shown, draw),
      filterBar(all, draw),
      shown.length
        ? (state.view === 'grid' ? grid(shown) : table(shown))
        : el('p', { class: 'empty' }, 'Nothing matches those filters.'));
  };
  draw();
}

function header(all, shown, draw) {
  return el('div', { class: 'view-head' },
    el('div', null,
      el('h1', null, 'Catalog'),
      el('p', { class: 'muted', text: `${shown.length} of ${all.length} pieces` })),
    el('div', { class: 'row' },
      el('button', {
        class: 'btn ghost', type: 'button',
        'aria-pressed': String(state.view === 'list'),
        onClick: () => { state.view = state.view === 'grid' ? 'list' : 'grid'; draw(); },
      }, state.view === 'grid' ? 'List view' : 'Grid view'),
      el('button', { class: 'btn primary', type: 'button', onClick: () => promptQuickAdd() }, '+ Quick add')));
}

function filterBar(all, draw) {
  const set = (key) => (event) => { state.filters[key] = event.target.value; draw(); };
  const opt = (values, blank) => [['', blank], ...values.map((v) => [v, label(v)])];

  const search = el('input', {
    type: 'search', class: 'search', placeholder: 'Search title, subject, place, notes',
    value: state.filters.q, autocomplete: 'off',
    onInput: (e) => { state.filters.q = e.target.value; draw(); },
  });

  const active = Object.entries(state.filters).filter(([, v]) => v).length;

  return el('div', { class: 'filters' },
    search,
    el('details', { class: 'filter-drawer', open: active > (state.filters.q ? 1 : 0) },
      el('summary', null, `Filters${active ? ` (${active})` : ''}`),
      el('div', { class: 'filter-grid' },
        wrap('Status', select(opt(ARTWORK_STATUS, 'Any status'), state.filters.status, { onChange: set('status') })),
        wrap('Disposition', select(opt(DISPOSITION, 'Any disposition'), state.filters.disposition, { onChange: set('disposition') })),
        wrap('Category', select(opt(CATEGORY, 'Any category'), state.filters.category, { onChange: set('category') })),
        wrap('Series', select(opt(seriesIn(all), 'Any series'), state.filters.series, { onChange: set('series') })),
        wrap('On hand', select([['', 'Either'], ['yes', 'On hand'], ['no', 'Not on hand']], state.filters.on_hand, { onChange: set('on_hand') })),
        wrap('Colour', select([['', 'Either'], ['color', 'Colour'], ['mono', 'Monochrome']], state.filters.color, { onChange: set('color') })),
        wrap('Faces', select([['', 'Either'], ['yes', 'Has a face'], ['no', 'No face']], state.filters.has_face, { onChange: set('has_face') })),
        wrap('OK to list', select([['', 'Any'], ['yes', 'Yes'], ['ask_first', 'Ask first'], ['no', 'No'], ['unknown', 'Unknown']], state.filters.listing_ok, { onChange: set('listing_ok') })),
        wrap('Print master', select([['', 'Either'], ['yes', 'Has a master'], ['no', 'No master']], state.filters.print_master, { onChange: set('print_master') })),
        wrap('Visibility', select(opt(VISIBILITY, 'Any'), state.filters.visibility, { onChange: set('visibility') })),
        wrap('Sort', select(Object.entries(SORTS).map(([k, v]) => [k, v.label]), state.sort, {
          onChange: (e) => { state.sort = e.target.value; draw(); },
        })),
        el('div', { class: 'field end' },
          el('button', {
            class: 'btn ghost', type: 'button',
            onClick: () => { Object.assign(state.filters, BLANK_FILTERS); draw(); },
          }, 'Clear filters')))));
}

function wrap(text, control) {
  return el('label', { class: 'field' }, el('span', { text }), control);
}

function thumb(artwork) {
  const image = (artwork.images || [])[0];
  if (image?.thumb_path || image?.web_path) {
    return el('img', {
      class: 'thumb', loading: 'lazy',
      src: image.thumb_path || image.web_path,
      alt: image.alt || artwork.title,
    });
  }
  // No photo yet. §6.2 exists to turn these into real ones.
  return el('div', { class: 'thumb empty', 'aria-hidden': 'true' },
    el('span', { text: (artwork.title || '?').slice(0, 1).toUpperCase() }));
}

function badges(artwork) {
  const rights = effectiveRights(artwork.rights);
  const meter = completeness(artwork);
  return el('div', { class: 'badges' },
    pill(label(artwork.status), `status-${artwork.status}`),
    artwork.disposition !== 'unknown' ? pill(label(artwork.disposition)) : null,
    artwork.visibility === 'public' ? pill('Public', 'ok') : null,
    rights.listing_ok !== 'yes' ? pill(`List: ${label(rights.listing_ok)}`, RIGHTS_TONE[rights.listing_ok]) : null,
    isGone(artwork) && !hasUsableMaster(artwork) ? pill('No master', 'bad') : null,
    pill(`${meter.pct}%`, 'muted'));
}

function grid(artworks) {
  return el('ul', { class: 'grid' }, artworks.map((artwork) =>
    el('li', null,
      el('a', { class: 'card', href: `#/artwork/${artwork.id}` },
        thumb(artwork),
        el('div', { class: 'card-body' },
          el('h3', { text: artwork.title }),
          el('p', { class: 'muted', text: [label(artwork.category), dimensions(artwork), money(artwork.asking_price) === '—' ? null : money(artwork.asking_price)].filter(Boolean).join(' · ') }),
          badges(artwork))))));
}

function table(artworks) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'table' },
      el('thead', null, el('tr', null,
        ['Title', 'Category', 'Size', 'Status', 'Price', 'Rights'].map((h) => el('th', { text: h })))),
      el('tbody', null, artworks.map((artwork) => {
        const rights = effectiveRights(artwork.rights);
        return el('tr', { class: 'row-link', tabIndex: 0,
          onClick: () => navigate(`/artwork/${artwork.id}`),
          onKeydown: (e) => { if (e.key === 'Enter') navigate(`/artwork/${artwork.id}`); } },
          el('td', null, el('a', { href: `#/artwork/${artwork.id}`, text: artwork.title })),
          el('td', { text: label(artwork.category) }),
          el('td', { text: dimensions(artwork) || '—' }),
          el('td', { text: label(artwork.status) }),
          el('td', { text: money(artwork.asking_price) }),
          el('td', null, pill(label(rights.listing_ok), RIGHTS_TONE[rights.listing_ok])));
      }))));
}

/**
 * §2.1: adding a piece must take under a minute. A title is the whole form.
 */
export function promptQuickAdd() {
  const input = el('input', { type: 'text', class: 'big', placeholder: 'Title', required: true, autocomplete: 'off' });
  const form = el('form', { class: 'sheet-body',
    onSubmit: async (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      const artwork = await quickAdd(title);
      dialog.close();
      toast(`Added “${artwork.title}”`, 'ok');
      navigate(`/artwork/${artwork.id}/edit`);
    } },
    el('h2', null, 'Quick add'),
    el('p', { class: 'hint' }, 'A title is all this needs. Everything else can wait.'),
    input,
    el('div', { class: 'row end' },
      el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
      el('button', { class: 'btn primary', type: 'submit' }, 'Add')));

  const dialog = el('dialog', { class: 'sheet' }, form);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}
