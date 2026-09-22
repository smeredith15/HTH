// Artwork detail and edit form (SPEC §6.1).

import { el, mount, money, label, dimensions, dateOnly, pill, field, select, toast, confirmDialog } from '../ui/dom.js';
import { navigate } from '../router.js';
import { getArtwork, saveArtwork, duplicateArtwork, deleteArtwork } from '../store/artworks.js';
import { loadSettings } from '../store/db.js';
import { priceFloor, impliedHourly } from '../store/settings.js';
import {
  ARTWORK_STATUS, DISPOSITION, VISIBILITY, CATEGORY, SHAPE, SUBSTRATE,
  TECHNIQUE, RIGHTS_FLAG, RIGHTS_ANSWER, PRINT_READY,
  completeness, effectiveRights, printLimits, hasUsableMaster, isGone,
} from '../store/schema.js';

const RIGHTS_TONE = { yes: 'ok', ask_first: 'warn', no: 'bad', unknown: 'muted' };

export async function renderArtwork(host, { params }) {
  const artwork = await getArtwork(params.id);
  if (!artwork) return mount(host, el('p', { class: 'empty' }, `No piece with the id “${params.id}”.`));
  const settings = await loadSettings();
  mount(host, detail(artwork, settings));
}

function detail(artwork, settings) {
  const rights = effectiveRights(artwork.rights);
  const meter = completeness(artwork);
  const limits = printLimits(artwork.print_master);

  return el('article', { class: 'detail' },
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', { text: artwork.title }),
        el('p', { class: 'muted', text: artwork.id })),
      el('div', { class: 'row' },
        el('a', { class: 'btn primary', href: `#/artwork/${artwork.id}/edit` }, 'Edit'),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => duplicate(artwork) }, 'Duplicate as new'))),

    completenessMeter(meter),

    // "Photograph this before it leaves" (§6.2) — the prompt that matters most.
    isGone(artwork) && !artwork.print_master?.exists
      ? el('div', { class: 'alert bad' },
        el('strong', null, 'No print master, and this piece is gone.'),
        ' It can never be printed. If you can borrow it back, photograph it straight on in open shade.')
      : null,

    isGone(artwork) && artwork.print_master?.exists && !hasUsableMaster(artwork)
      ? el('div', { class: 'alert bad' },
        el('strong', null, 'The file for this piece is not good enough to print.'),
        limits ? ` It stops at ${limits.at150.toFixed(1)} in on the long edge at 150 DPI.` : '',
        ' Borrow the piece back and reshoot it.')
      : null,

    artwork.on_hand && !(artwork.images || []).some((i) => i.role === 'straight_on')
      ? el('div', { class: 'alert warn' },
        el('strong', null, 'Photograph this before it leaves.'),
        ' It is still on hand and has no straight-on photo, so there is no print master yet.')
      : null,

    section('Specs', [
      row('Status', label(artwork.status)),
      row('Disposition', label(artwork.disposition)),
      row('On hand', artwork.on_hand ? `Yes — ${artwork.location_stored || 'location not recorded'}` : 'No'),
      row('Visibility', artwork.visibility === 'public'
        ? pill('Public catalog', 'ok') : pill('Private', 'muted')),
      row('Category', label(artwork.category)),
      row('Series', artwork.series || '—'),
      row('Subject', [artwork.subject_name, artwork.subject_location].filter(Boolean).join(' · ') || '—'),
      row('Year', artwork.year || '—'),
      row('Size', dimensions(artwork) || '—'),
      row('Shape', label(artwork.shape)),
      row('Substrate', [label(artwork.substrate), artwork.substrate_note].filter((v) => v && v !== '—').join(' — ') || '—'),
      row('Frame', artwork.framed ? (artwork.frame_material || 'framed') : 'unframed'),
      row('Hanging', artwork.hanging_hardware || '—'),
      row('Finish', artwork.finish || '—'),
      row('Techniques', (artwork.techniques || []).map(label).join(', ') || '—'),
      row('Colours', (artwork.colors || []).join(', ') || 'monochrome'),
    ]),

    section('Effort and money', [
      row('Hours', artwork.hours ?? '—'),
      row('Materials', money(artwork.materials_cost)),
      row('Asking price', money(artwork.asking_price)),
      row('Price floor', floorLine(artwork, settings)),
      row('At this price', hourlyLine(artwork, settings)),
      row('Has a face', artwork.has_face ? `Yes — ${artwork.subject_count ?? 1} subject(s)` : 'No'),
    ]),

    section('Rights', [
      row('Flags', (artwork.rights.flags || []).map(label).join(', ') || 'none recorded'),
      row('OK to list', el('span', null,
        pill(label(rights.listing_ok), RIGHTS_TONE[rights.listing_ok]),
        rights.listing_ok_derived ? el('span', { class: 'muted', text: ' (derived from the flags)' }) : null)),
      row('OK to print', el('span', null,
        pill(label(rights.print_ok), RIGHTS_TONE[rights.print_ok]),
        rights.print_ok_derived ? el('span', { class: 'muted', text: ' (derived from the flags)' }) : null)),
      row('Edits required', artwork.rights.edits_required || '—'),
      row('Consent', artwork.rights.consent_obtained
        ? `${artwork.rights.consent_obtained.from ?? '—'} · ${dateOnly(artwork.rights.consent_obtained.date)}`
        : '—'),
      row('Notes', artwork.rights.notes || '—'),
    ], 'Advisory only. The app warns; it never blocks.'),

    section('Print master', [
      row('Exists', artwork.print_master?.exists ? 'Yes' : 'No'),
      row('Where', artwork.print_master?.location || '— (never in this repo)'),
      row('Pixels', artwork.print_master?.long_edge_px
        ? `${artwork.print_master.long_edge_px} × ${artwork.print_master.short_edge_px ?? '?'}` : '—'),
      row('Max print size', limits
        ? el('span', null,
          `${limits.at150.toFixed(1)} in at 150 DPI`,
          el('span', { class: 'muted', text: ` · ${limits.at100.toFixed(1)} in at 100 DPI (floor for large pieces)` }))
        : '—'),
      row('Print ready', label(artwork.print_master?.print_ready)),
      row('Retouch notes', artwork.print_master?.retouch_notes || '—'),
    ]),

    artwork.notes ? section('Notes', [el('p', { class: 'notes', text: artwork.notes })]) : null,
    artwork.blurb ? section('Kiosk blurb', [el('p', { class: 'notes', text: artwork.blurb })]) : null,

    el('div', { class: 'row end danger-zone' },
      el('button', { class: 'btn danger ghost', type: 'button', onClick: () => remove(artwork) }, 'Delete')));
}

function floorLine(artwork, settings) {
  const floor = priceFloor(artwork, settings);
  if (floor === null) return el('span', { class: 'muted' }, 'needs hours');
  const worst = priceFloor(artwork, settings, { includeOffsiteAds: true });
  const under = artwork.asking_price !== null && artwork.asking_price < floor;
  return el('span', null,
    el('strong', { class: under ? 'bad-text' : '', text: money(floor) }),
    el('span', { class: 'muted', text: ` · ${money(worst)} if Offsite Ads take the order` }),
    under ? pill('below floor', 'bad') : null);
}

function hourlyLine(artwork, settings) {
  const hourly = impliedHourly(artwork, settings);
  if (hourly === null) return el('span', { class: 'muted' }, 'needs hours and a price');
  const tone = hourly < settings.target_hourly ? 'bad-text' : 'ok-text';
  return el('strong', { class: tone, text: `${money(hourly)} an hour` });
}

function completenessMeter(meter) {
  return el('div', { class: 'meter-block' },
    el('div', { class: 'meter', role: 'img', 'aria-label': `${meter.pct}% of the fields that matter are filled in` },
      el('div', { class: 'meter-fill', style: { width: `${meter.pct}%` } })),
    el('ul', { class: 'meter-list' }, meter.checks.map((check) =>
      el('li', { class: check.ok ? 'ok' : 'todo' },
        el('span', { class: 'tick', 'aria-hidden': 'true', text: check.ok ? '✓' : '○' }),
        check.label))));
}

function section(title, rows, hint) {
  return el('section', { class: 'panel' },
    el('h2', { text: title }),
    hint ? el('p', { class: 'hint', text: hint }) : null,
    el('dl', { class: 'spec-list' }, rows));
}

function row(term, value) {
  return el('div', { class: 'spec-row' },
    el('dt', { text: term }),
    el('dd', null, value instanceof Node ? value : String(value)));
}

async function duplicate(source) {
  const title = prompt(
    'Title for the new piece?\n\nOnly category, series, substrate, frame, hardware, finish and techniques carry over — never dimensions, price, photos, hours or rights.',
    '',
  );
  if (title === null) return;
  const copy = await duplicateArtwork(source.id, title.trim() || `${source.title} (copy)`);
  toast('Duplicated. Dimensions and rights start blank on purpose.', 'ok');
  navigate(`/artwork/${copy.id}/edit`);
}

async function remove(artwork) {
  const ok = await confirmDialog(`Delete “${artwork.title}”? This cannot be undone from inside the app — only by importing an export.`, { confirmText: 'Delete' });
  if (!ok) return;
  await deleteArtwork(artwork.id);
  toast('Deleted');
  navigate('/catalog');
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

export async function renderArtworkEdit(host, { params }) {
  const artwork = await getArtwork(params.id);
  if (!artwork) return mount(host, el('p', { class: 'empty' }, `No piece with the id “${params.id}”.`));
  const settings = await loadSettings();
  const draft = structuredClone(artwork);

  // Reassigned by the two live-hint blocks further down.
  let refreshDerived = () => {};
  let refreshLimits = () => {};

  const num = (key, labelText, hint) => field(labelText, el('input', {
    type: 'number', step: 'any', inputMode: 'decimal', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value === '' ? null : Number(e.target.value); },
  }), hint);

  const text = (key, labelText, hint) => field(labelText, el('input', {
    type: 'text', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value || null; },
  }), hint);

  const bool = (key, labelText, onChange) => el('label', { class: 'check' },
    el('input', {
      type: 'checkbox', checked: !!draft[key],
      onChange: (e) => { draft[key] = e.target.checked; onChange?.(e.target.checked); },
    }), el('span', { text: labelText }));

  const enumField = (key, labelText, values, { blank = '—' } = {}) => field(labelText,
    select([['', blank], ...values.map((v) => [v, label(v)])], draft[key], {
      onChange: (e) => { draft[key] = e.target.value || null; },
    }));

  const checkboxSet = (values, selected, onChange) => el('div', { class: 'chips' },
    values.map((value) => el('label', { class: 'chip' },
      el('input', {
        type: 'checkbox', checked: selected.includes(value),
        onChange: (e) => {
          const next = e.target.checked
            ? [...selected, value]
            : selected.filter((v) => v !== value);
          selected.length = 0;
          selected.push(...next);
          onChange?.(next);
        },
      }),
      el('span', { text: label(value) }))));

  const priceHint = el('p', { class: 'hint' });
  const refreshPriceHint = () => {
    const floor = priceFloor(draft, settings);
    const hourly = impliedHourly(draft, settings);
    priceHint.textContent = floor === null
      ? `Enter hours to see the price floor (target $${settings.target_hourly}/h).`
      : `Floor ${money(floor)}${hourly !== null ? ` · this price pays ${money(hourly)} an hour` : ''}.`;
  };

  const form = el('form', { class: 'form',
    onSubmit: async (event) => {
      event.preventDefault();
      await saveArtwork(draft);
      toast('Saved', 'ok');
      navigate(`/artwork/${draft.id}`);
    } },

    el('div', { class: 'view-head' },
      el('div', null, el('h1', null, 'Edit'), el('p', { class: 'muted', text: draft.id })),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: `#/artwork/${draft.id}` }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Save'))),

    el('section', { class: 'panel' },
      el('h2', null, 'Identity'),
      field('Title', el('input', {
        type: 'text', value: draft.title, required: true,
        onInput: (e) => { draft.title = e.target.value; },
      }), 'The only field this app insists on.'),
      el('div', { class: 'two-up' },
        enumField('status', 'Status', ARTWORK_STATUS),
        enumField('disposition', 'Disposition', DISPOSITION)),
      el('div', { class: 'two-up' },
        enumField('category', 'Category', CATEGORY),
        text('series', 'Series')),
      el('div', { class: 'two-up' },
        text('subject_name', 'Subject'),
        text('subject_location', 'Subject location')),
      el('div', { class: 'two-up' }, num('year', 'Year'), enumField('visibility', 'Visibility', VISIBILITY, { blank: 'private' })),
      el('p', { class: 'hint' }, 'Only pieces set to public are written into data/catalog.json, and only their public fields.')),

    el('section', { class: 'panel' },
      el('h2', null, 'Physical'),
      el('div', { class: 'three-up' },
        num('width_in', 'Width (in)'), num('height_in', 'Height (in)'), num('depth_in', 'Depth (in)')),
      el('div', { class: 'two-up' }, enumField('shape', 'Shape', SHAPE), enumField('substrate', 'Substrate', SUBSTRATE)),
      text('substrate_note', 'Substrate note'),
      bool('framed', 'Framed'),
      el('div', { class: 'two-up' }, text('frame_material', 'Frame material'), text('hanging_hardware', 'Hanging hardware')),
      text('finish', 'Finish'),
      field('Techniques', checkboxSet(TECHNIQUE, draft.techniques)),
      field('Colours', el('input', {
        type: 'text', value: (draft.colors || []).join(', '),
        placeholder: 'red stain, blue stain',
        onInput: (e) => { draft.colors = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); },
      }), 'Leave blank for monochrome. Colour pieces have drawn far more interest.')),

    el('section', { class: 'panel' },
      el('h2', null, 'Where it is'),
      bool('on_hand', 'Physically on hand'),
      text('location_stored', 'Stored at', 'e.g. studio shelf 2, fair bin A')),

    el('section', { class: 'panel' },
      el('h2', null, 'Effort and money'),
      el('div', { class: 'two-up' },
        field('Hours', el('input', {
          type: 'number', step: 'any', inputMode: 'decimal', value: draft.hours ?? '',
          onInput: (e) => { draft.hours = e.target.value === '' ? null : Number(e.target.value); refreshPriceHint(); },
        }), 'One number at the end is fine. Never required.'),
        num('materials_cost', 'Materials cost ($)')),
      field('Asking price ($)', el('input', {
        type: 'number', step: '0.01', inputMode: 'decimal', value: draft.asking_price ?? '',
        onInput: (e) => { draft.asking_price = e.target.value === '' ? null : Number(e.target.value); refreshPriceHint(); },
      })),
      priceHint,
      bool('has_face', 'Has a face'),
      num('subject_count', 'Subjects')),

    el('section', { class: 'panel' },
      el('h2', null, 'Rights'),
      el('p', { class: 'hint' }, 'Advisory. Leave the two answers blank to let the flags decide.'),
      field('Flags', checkboxSet(RIGHTS_FLAG, draft.rights.flags, () => refreshDerived())),
      el('div', { class: 'two-up' },
        field('OK to list', select([['', 'derive from flags'], ...RIGHTS_ANSWER.map((v) => [v, label(v)])], draft.rights.listing_ok, {
          onChange: (e) => { draft.rights.listing_ok = e.target.value || null; refreshDerived(); },
        })),
        field('OK to print', select([['', 'derive from flags'], ...RIGHTS_ANSWER.map((v) => [v, label(v)])], draft.rights.print_ok, {
          onChange: (e) => { draft.rights.print_ok = e.target.value || null; refreshDerived(); },
        }))),
      (() => {
        const line = el('p', { class: 'hint' });
        refreshDerived = () => {
          const r = effectiveRights(draft.rights);
          line.textContent = `Currently: list ${label(r.listing_ok)}, print ${label(r.print_ok)}.`;
        };
        refreshDerived();
        return line;
      })(),
      field('Edits required', el('input', {
        type: 'text', value: draft.rights.edits_required ?? '',
        placeholder: 'e.g. Paint VW roundel out of print file',
        onInput: (e) => { draft.rights.edits_required = e.target.value || null; },
      })),
      field('Rights notes', el('textarea', {
        rows: 2, value: draft.rights.notes ?? '',
        onInput: (e) => { draft.rights.notes = e.target.value || null; },
      }))),

    el('section', { class: 'panel' },
      el('h2', null, 'Print master'),
      el('p', { class: 'hint' }, 'Masters live outside this repo — on a drive or in cloud storage. Only the location is recorded here.'),
      el('label', { class: 'check' },
        el('input', {
          type: 'checkbox', checked: !!draft.print_master.exists,
          onChange: (e) => { draft.print_master.exists = e.target.checked; refreshLimits(); },
        }), el('span', null, 'A usable master exists')),
      field('Where it lives', el('input', {
        type: 'text', value: draft.print_master.location ?? '',
        placeholder: 'Google Drive / Art masters / hooper-strait.tif',
        onInput: (e) => { draft.print_master.location = e.target.value || null; },
      })),
      el('div', { class: 'two-up' },
        field('Long edge (px)', el('input', {
          type: 'number', inputMode: 'numeric', value: draft.print_master.long_edge_px ?? '',
          onInput: (e) => { draft.print_master.long_edge_px = e.target.value === '' ? null : Number(e.target.value); refreshLimits(); },
        })),
        field('Short edge (px)', el('input', {
          type: 'number', inputMode: 'numeric', value: draft.print_master.short_edge_px ?? '',
          onInput: (e) => { draft.print_master.short_edge_px = e.target.value === '' ? null : Number(e.target.value); },
        }))),
      (() => {
        const line = el('p', { class: 'hint' });
        refreshLimits = () => {
          const limits = printLimits(draft.print_master);
          line.textContent = limits
            ? `Prints to ${limits.at150.toFixed(1)} in on the long edge at 150 DPI, ${limits.at100.toFixed(1)} in at 100 DPI.`
            : 'Enter the long edge in pixels to see the biggest print this file supports.';
        };
        refreshLimits();
        return line;
      })(),
      el('div', { class: 'two-up' },
        field('Print ready', select([['', '—'], ...PRINT_READY.map((v) => [v, label(v)])], draft.print_master.print_ready, {
          onChange: (e) => { draft.print_master.print_ready = e.target.value || null; },
        })),
        field('Captured on', el('input', {
          type: 'date', value: draft.print_master.captured_on ?? '',
          onInput: (e) => { draft.print_master.captured_on = e.target.value || null; },
        }))),
      field('Retouch notes', el('input', {
        type: 'text', value: draft.print_master.retouch_notes ?? '',
        onInput: (e) => { draft.print_master.retouch_notes = e.target.value || null; },
      }))),

    el('section', { class: 'panel' },
      el('h2', null, 'Words'),
      field('Kiosk blurb', el('textarea', {
        rows: 2, value: draft.blurb ?? '',
        onInput: (e) => { draft.blurb = e.target.value || null; },
      }), 'One or two sentences. Shown on the kiosk and the portfolio.'),
      field('Private notes', el('textarea', {
        rows: 4, value: draft.notes ?? '',
        onInput: (e) => { draft.notes = e.target.value || null; },
      })),
      field('Reference source', el('input', {
        type: 'text', value: draft.reference_source ?? '',
        onInput: (e) => { draft.reference_source = e.target.value || null; },
      })),
      field('Etsy listing URL', el('input', {
        type: 'url', value: draft.primary_listing_url ?? '',
        onInput: (e) => { draft.primary_listing_url = e.target.value || null; },
      }), 'Used for the kiosk QR code.')),

    el('div', { class: 'row end sticky-save' },
      el('a', { class: 'btn ghost', href: `#/artwork/${draft.id}` }, 'Cancel'),
      el('button', { class: 'btn primary', type: 'submit' }, 'Save')));

  refreshPriceHint();
  mount(host, form);
}
