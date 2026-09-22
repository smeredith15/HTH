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

/**
 * The search box and the filters are built once and left alone. Only the
 * results are redrawn — rebuilding the whole view on every keystroke destroyed
 * the input being typed into, which is why search accepted one letter at a
 * time.
 */
export async function renderCatalog(host, { query } = {}) {
  if (query?.get('q')) state.filters.q = query.get('q');
  const all = await listArtworks();

  const count = el('p', { class: 'muted' });
  const results = el('div');
  const viewButton = el('button', {
    class: 'btn ghost', type: 'button',
    onClick: () => { state.view = state.view === 'grid' ? 'list' : 'grid'; redraw(); },
  });

  const redraw = () => {
    const shown = filterArtworks(all, state.filters, state.sort);
    count.textContent = `${shown.length} of ${all.length} pieces`;
    viewButton.textContent = state.view === 'grid' ? 'List view' : 'Grid view';
    viewButton.setAttribute('aria-pressed', String(state.view === 'list'));
    mount(results, shown.length
      ? (state.view === 'grid' ? grid(shown) : table(shown))
      : el('p', { class: 'empty' }, 'Nothing matches those filters.'));
  };

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null, el('h1', null, 'Catalog'), count),
      el('div', { class: 'row' },
        viewButton,
        el('button', { class: 'btn primary', type: 'button', onClick: () => promptQuickAdd() }, '+ Quick add'))),
    filterBar(all, redraw),
    results);

  redraw();
}

function filterBar(all, redraw) {
  const opt = (values, blank) => [['', blank], ...values.map((v) => [v, label(v)])];
  // Kept so "Clear filters" can reset the controls as well as the state —
  // nothing is rebuilt any more, so the controls do not reset themselves.
  const controls = [];

  const set = (key) => (event) => { state.filters[key] = event.target.value; redraw(); };
  const picker = (key, options) => {
    const node = select(options, state.filters[key], { onChange: set(key) });
    controls.push({ node, key });
    return node;
  };

  const search = el('input', {
    type: 'search', class: 'search', placeholder: 'Search title, subject, place, notes',
    value: state.filters.q, autocomplete: 'off',
    onInput: (e) => { state.filters.q = e.target.value; redraw(); },
  });

  const active = Object.entries(state.filters).filter(([, v]) => v).length;

  return el('div', { class: 'filters' },
    search,
    el('details', { class: 'filter-drawer', open: active > (state.filters.q ? 1 : 0) },
      el('summary', null, `Filters${active ? ` (${active})` : ''}`),
      el('div', { class: 'filter-grid' },
        wrap('Status', picker('status', opt(ARTWORK_STATUS, 'Any status'))),
        wrap('Disposition', picker('disposition', opt(DISPOSITION, 'Any disposition'))),
        wrap('Category', picker('category', opt(CATEGORY, 'Any category'))),
        wrap('Series', picker('series', opt(seriesIn(all), 'Any series'))),
        wrap('On hand', picker('on_hand', [['', 'Either'], ['yes', 'On hand'], ['no', 'Not on hand']])),
        wrap('Colour', picker('color', [['', 'Either'], ['color', 'Colour'], ['mono', 'Monochrome']])),
        wrap('Faces', picker('has_face', [['', 'Either'], ['yes', 'Has a face'], ['no', 'No face']])),
        wrap('OK to list', picker('listing_ok', [['', 'Any'], ['yes', 'Yes'], ['ask_first', 'Ask first'], ['no', 'No'], ['unknown', 'Unknown']])),
        wrap('Print master', picker('print_master', [['', 'Either'], ['yes', 'Has a master'], ['no', 'No master']])),
        wrap('Visibility', picker('visibility', opt(VISIBILITY, 'Any'))),
        wrap('Sort', select(Object.entries(SORTS).map(([k, v]) => [k, v.label]), state.sort, {
          onChange: (e) => { state.sort = e.target.value; redraw(); },
        })),
        el('div', { class: 'field end' },
          el('button', {
            class: 'btn ghost', type: 'button',
            onClick: () => {
              Object.assign(state.filters, BLANK_FILTERS);
              search.value = '';
              for (const { node } of controls) node.value = '';
              redraw();
            },
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
      const { artwork, filled } = await quickAdd(title);
      dialog.close();
      // Say what was filled in, so nothing arrives in the record unannounced.
      const named = Object.keys(filled)
        .filter((k) => k !== 'subject_name' && filled[k] !== null && filled[k] !== undefined)
        .map((k) => label(k).toLowerCase());
      toast(named.length
        ? `Added “${artwork.title}”. Filled in ${named.join(', ')} — change any of it.`
        : `Added “${artwork.title}”`, 'ok');
      navigate(`/artwork/${artwork.id}/edit`);
    } },
    el('h2', null, 'Quick add'),
    el('p', { class: 'hint' }, 'A title is all this needs. The technique, and whatever substrate and '
      + 'finish your last few pieces used, get filled in — size, price and hours never are.'),
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
