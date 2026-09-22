// Listing generator and validator screen (SPEC §7).

import { el, mount, label, money, field, select, pill, toast, confirmDialog } from '../ui/dom.js';
import { navigate } from '../router.js';
import { getListing, saveListing, deleteListing, relist } from '../store/listings.js';
import { getArtwork } from '../store/artworks.js';
import { loadSettings } from '../store/db.js';
import { priceFloor, impliedHourly } from '../store/settings.js';
import {
  LISTING_TYPE, LISTING_STATUS, LISTING_CHANNEL, PRINT_SUBSTRATE, PRINT_PROCESS, SHAPE,
} from '../store/schema.js';
import { generateListing, generateDescription, suggestTitle, suggestTags, suggestMaterials, suggestCategoryPath, reminderChecklist } from '../listing/generate.js';
import { validateListing, summarise } from '../listing/validators.js';
import { listPrintCosts, listPrintVendors } from '../store/print-costs.js';
import { priceGuidance, costForVariant, sizeLabel } from '../listing/print-pricing.js';

const TONE = { stop: 'bad', warn: 'warn', note: 'muted' };
const LEVEL_WORD = { stop: 'Serious', warn: 'Warning', note: 'Note' };

export async function renderListingEditor(host, { params }) {
  const listing = await getListing(params.id);
  if (!listing) return mount(host, el('p', { class: 'empty' }, `No listing with the id “${params.id}”.`));
  const artwork = listing.artwork_id ? await getArtwork(listing.artwork_id) : null;
  const settings = await loadSettings();
  const [costRows, vendors] = await Promise.all([listPrintCosts(), listPrintVendors()]);
  const context = { costRows, vendors };
  const draft = structuredClone(listing);

  // Live regions rebuilt on every edit. The form itself stays put so typing
  // never loses focus.
  const findingsPanel = el('div');
  const titleCounter = el('span', { class: 'counter' });
  const tagPanel = el('div', { class: 'tag-panel' });
  const outputPanel = el('div');
  const pricePanel = el('div', { class: 'hint' });

  const refresh = () => {
    const findings = validateListing(draft, artwork, settings, context);
    mount(findingsPanel, findingsView(findings));
    mount(titleCounter, counterFor(draft.title?.length ?? 0, 140));
    mount(tagPanel, tagsView(draft.tags ?? []));
    mount(outputPanel, outputsView(draft, artwork, settings));
    mount(pricePanel, draft.listing_type === 'print'
      ? printPriceView(draft, context, settings)
      : priceView(draft, artwork, settings));
  };

  const text = (key, labelText, hint, onInput) => field(labelText, el('input', {
    type: 'text', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value || null; onInput?.(); refresh(); },
  }), hint);

  const enumField = (key, labelText, values, blank = '—') => field(labelText,
    select([['', blank], ...values.map((v) => [v, label(v)])], draft[key], {
      onChange: (e) => { draft[key] = e.target.value || null; refresh(); },
    }));

  const form = el('form', { class: 'form',
    onSubmit: async (event) => {
      event.preventDefault();
      await saveListing(draft);
      toast('Saved', 'ok');
      navigate('/listings');
    } },

    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', { text: draft.title || 'Listing' }),
        el('p', { class: 'muted' },
          label(draft.listing_type),
          artwork ? el('span', null, ' · ', el('a', { href: `#/artwork/${artwork.id}`, text: artwork.title })) : null)),
      el('div', { class: 'row' },
        draft.etsy_url ? el('a', { class: 'btn ghost', href: draft.etsy_url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on Etsy') : null,
        el('button', { class: 'btn primary', type: 'submit' }, 'Save'))),

    findingsPanel,

    el('section', { class: 'panel' },
      el('h2', null, 'Title'),
      el('div', { class: 'labelled-control' },
        el('textarea', {
          rows: 2, value: draft.title ?? '', class: 'title-input',
          onInput: (e) => { draft.title = e.target.value; refresh(); },
        }),
        titleCounter),
      el('p', { class: 'hint' }, 'The first ~40 characters carry the most search weight. Lead with the phrase buyers type, not with “Handmade”.'),
      el('div', { class: 'row' },
        copyButton('Copy title', () => draft.title ?? ''),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => {
          draft.title = suggestTitle(artwork, draft);
          form.querySelector('.title-input').value = draft.title;
          refresh();
        } }, 'Suggest a title'))),

    el('section', { class: 'panel' },
      el('h2', null, 'Tags'),
      el('p', { class: 'hint' }, '13 tags, each up to 20 characters. Multi-word, no repeats — a single word wastes a slot.'),
      field('One per line', el('textarea', {
        rows: 7, value: (draft.tags ?? []).join('\n'), class: 'tags-input',
        onInput: (e) => {
          draft.tags = e.target.value.split('\n').map((t) => t.trim()).filter(Boolean);
          refresh();
        },
      })),
      tagPanel,
      el('div', { class: 'row' },
        copyButton('Copy tags', () => (draft.tags ?? []).join(', ')),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => {
          draft.tags = suggestTags(artwork, draft);
          form.querySelector('.tags-input').value = draft.tags.join('\n');
          refresh();
        } }, 'Suggest tags'))),

    el('section', { class: 'panel' },
      el('h2', null, 'Materials'),
      el('p', { class: 'hint' }, 'Up to 13. A technique such as pyrography is not a material.'),
      field('Comma separated', el('input', {
        type: 'text', value: (draft.materials ?? []).join(', '), class: 'materials-input',
        onInput: (e) => {
          draft.materials = e.target.value.split(',').map((m) => m.trim()).filter(Boolean);
          refresh();
        },
      })),
      el('div', { class: 'row' },
        copyButton('Copy materials', () => (draft.materials ?? []).join(', ')),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => {
          draft.materials = suggestMaterials(artwork, draft);
          form.querySelector('.materials-input').value = draft.materials.join(', ');
          refresh();
        } }, 'Fill from the record'))),

    el('section', { class: 'panel' },
      el('h2', null, 'Description'),
      el('p', { class: 'hint' }, 'Built from the record, so the specs here cannot drift from the specs in the catalog. Regenerating overwrites anything typed in.'),
      field(null, el('textarea', {
        rows: 14, value: draft.description ?? '', class: 'description-input',
        onInput: (e) => { draft.description = e.target.value; refresh(); },
      })),
      el('div', { class: 'row' },
        copyButton('Copy description', () => draft.description ?? ''),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => regenerate(draft, artwork, settings, form, refresh) },
          'Regenerate from the record'))),

    el('section', { class: 'panel' },
      el('h2', null, 'Variants'),
      variantsTable(draft, refresh),
      pricePanel,
      el('button', { class: 'btn ghost', type: 'button', onClick: () => {
        draft.variants = [...(draft.variants ?? []), { label: '', width_in: null, height_in: null, shape: null, price: null }];
        rerenderVariants(form, draft, refresh);
      } }, '+ Add a size')),

    el('section', { class: 'panel' },
      el('h2', null, 'Etsy'),
      el('div', { class: 'two-up' },
        enumField('listing_type', 'Type', LISTING_TYPE, 'original'),
        enumField('status', 'Status', LISTING_STATUS, 'draft')),
      el('div', { class: 'two-up' },
        enumField('channel', 'Channel', LISTING_CHANNEL, 'etsy'),
        text('etsy_listing_id', 'Etsy listing id')),
      text('etsy_url', 'Etsy URL'),
      text('category_path', 'Category path', 'Only leaf categories can be selected. Type the leaf name into Etsy’s category search.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', onClick: () => {
          draft.category_path = suggestCategoryPath(draft);
          rerender(form, host, params);
        } }, 'Suggest a category')),
      el('div', { class: 'three-up' },
        field('Quantity', el('input', {
          type: 'number', min: '0', inputMode: 'numeric', value: draft.quantity ?? '',
          onInput: (e) => { draft.quantity = e.target.value === '' ? null : Number(e.target.value); refresh(); },
        })),
        field('Processing, min weeks', el('input', {
          type: 'number', min: '0', inputMode: 'numeric', value: draft.processing_weeks?.[0] ?? '',
          onInput: (e) => {
            draft.processing_weeks = [Number(e.target.value) || 0, draft.processing_weeks?.[1] ?? 0];
            refresh();
          },
        })),
        field('Processing, max weeks', el('input', {
          type: 'number', min: '0', inputMode: 'numeric', value: draft.processing_weeks?.[1] ?? '',
          onInput: (e) => {
            draft.processing_weeks = [draft.processing_weeks?.[0] ?? 0, Number(e.target.value) || 0];
            refresh();
          },
        }))),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: !!draft.free_shipping,
          onChange: (e) => { draft.free_shipping = e.target.checked; refresh(); } }),
        el('span', null, 'Free shipping — US search favours it, so build it into the price')),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: !!draft.suppression_suspected,
          onChange: (e) => { draft.suppression_suspected = e.target.checked; refresh(); } }),
        el('span', null, 'Suppression suspected')),
      field('Favourites', el('input', {
        type: 'number', inputMode: 'numeric', value: draft.favorites_snapshot ?? '',
        onInput: (e) => { draft.favorites_snapshot = e.target.value === '' ? null : Number(e.target.value); },
      }), 'Entered by hand from the Etsy listing page.')),

    draft.listing_type === 'print'
      ? el('section', { class: 'panel' },
        el('h2', null, 'Printing'),
        el('div', { class: 'two-up' },
          enumField('print_substrate', 'Print substrate', PRINT_SUBSTRATE),
          enumField('print_process', 'Process', PRINT_PROCESS, 'unknown')),
        text('print_vendor', 'Print vendor'),
        el('p', { class: 'hint' }, 'Use “giclée” only once the vendor confirms the process in writing. Digital Prints is the honest category otherwise.'))
      : null,

    el('section', { class: 'panel' },
      el('h2', null, 'Generated output'),
      outputPanel),

    el('section', { class: 'panel' },
      el('h2', null, 'Before you publish'),
      el('ul', { class: 'todo-list' }, reminderChecklist(draft).map((item) =>
        el('li', null, el('label', { class: 'check' },
          el('input', { type: 'checkbox' }), el('span', { text: item.text })))))),

    el('div', { class: 'row end danger-zone' },
      el('button', { class: 'btn ghost', type: 'button', onClick: async () => {
        const ok = await confirmDialog(
          'Relist? The current listing is kept as the record of what was live and marked “relisted”, and a fresh draft is created. On Etsy this means a new URL and no favourites.',
          { confirmText: 'Relist', tone: 'primary' },
        );
        if (!ok) return;
        const copy = await relist(draft.id);
        toast('Draft created. The old listing is kept.', 'ok');
        navigate(`/listing/${copy.id}`);
      } }, 'Relist'),
      el('button', { class: 'btn danger ghost', type: 'button', onClick: async () => {
        const ok = await confirmDialog(`Delete the record of “${draft.title || draft.id}”?`, { confirmText: 'Delete' });
        if (!ok) return;
        await deleteListing(draft.id);
        toast('Deleted');
        navigate('/listings');
      } }, 'Delete')));

  mount(host, form);
  refresh();
}

function rerender(form, host, params) {
  renderListingEditor(host, { params });
}

// --- live regions ----------------------------------------------------------

function counterFor(used, limit) {
  const over = used > limit;
  return el('span', { class: over ? 'bad-text' : 'muted', text: `${used} / ${limit}` });
}

function tagsView(tags) {
  if (!tags.length) return el('p', { class: 'hint' }, 'No tags yet.');
  return el('div', null,
    el('p', { class: tags.length === 13 ? 'hint ok-text' : 'hint bad-text', text: `${tags.length} of 13` }),
    el('div', { class: 'chips' }, tags.map((tag) => {
      const over = tag.length > 20;
      const single = !tag.includes(' ');
      return el('span', { class: `chip static ${over ? 'over' : ''}`.trim() },
        el('span', { text: tag }),
        el('span', { class: over ? 'counter bad-text' : 'counter muted', text: String(tag.length) }),
        single ? el('span', { class: 'counter warn-text', title: 'single word', text: '·1w' }) : null);
    })));
}

function findingsView(findings) {
  if (!findings.length) {
    return el('div', { class: 'panel alert ok' },
      el('strong', null, 'Every check passes.'),
      ' Nothing here contradicts the record.');
  }
  const counts = summarise(findings);
  return el('section', { class: `panel alert ${counts.stop ? 'bad' : 'warn'}` },
    el('h2', null, 'Checks'),
    el('p', { class: 'hint' }, 'These never stop you publishing — they are what the record says.'),
    el('ul', { class: 'findings' }, findings.map((f) =>
      el('li', { class: f.level },
        pill(LEVEL_WORD[f.level], TONE[f.level]),
        el('span', { class: 'finding-field', text: f.field }),
        el('span', { text: f.message })))),
    el('p', { class: 'muted small', text: `${counts.stop} serious · ${counts.warn} warnings · ${counts.note} notes` }));
}

function outputsView(draft, artwork, settings) {
  const output = generateListing(draft, artwork, settings);
  return el('div', null,
    output.missing.length
      ? el('div', { class: 'alert warn' },
        el('strong', null, 'The record cannot fill: '),
        output.missing.join(', '),
        el('p', { class: 'hint' }, 'Fill these in on the artwork and regenerate, rather than typing them into the description.'))
      : null,
    outputRow('Category path', output.category_path),
    outputRow('Tags, comma separated', (draft.tags ?? []).join(', ')),
    outputRow('Materials', (draft.materials ?? []).join(', ')));
}

function outputRow(title, value) {
  return el('div', { class: 'output-row' },
    el('div', null,
      el('span', { class: 'muted small', text: title }),
      el('p', { class: 'output-value', text: value || '—' })),
    copyButton('Copy', () => value));
}

function priceView(draft, artwork, settings) {
  if (!artwork) return el('span', { class: 'muted' }, 'No piece attached, so there is no price floor to compare against.');
  const floor = priceFloor(artwork, settings);
  if (floor === null) return el('span', { class: 'muted' }, `Record hours on ${artwork.title} to see its price floor.`);
  const worst = priceFloor(artwork, settings, { includeOffsiteAds: true });
  const prices = (draft.variants ?? []).map((v) => v.price).filter((p) => typeof p === 'number');
  const lowest = prices.length ? Math.min(...prices) : artwork.asking_price;
  const hourly = lowest ? impliedHourly({ ...artwork, asking_price: lowest }, settings) : null;
  return el('span', null,
    `Floor ${money(floor)} · ${money(worst)} if Offsite Ads take the order. `,
    hourly !== null
      ? el('strong', { class: hourly < settings.target_hourly ? 'bad-text' : 'ok-text',
        text: `At ${money(lowest)} that pays ${money(hourly)} an hour.` })
      : null);
}

/**
 * For a print, the useful number is not the hours floor — it is what the lab
 * charges. Shows the landed cost and the target price for every variant whose
 * size is priced in the template.
 */
function printPriceView(draft, { costRows, vendors }, settings) {
  const byName = new Map(vendors.map((v) => [v.name, v]));
  const rows = (draft.variants ?? []).map((variant) => {
    const row = costForVariant(variant, draft, costRows);
    const vendor = row ? byName.get(row.vendor) : null;
    return { variant, row, guidance: row ? priceGuidance(variant.price, row, vendor, settings) : { known: false } };
  });

  if (!rows.some((r) => r.guidance.known)) {
    return el('span', null,
      el('span', { class: 'muted' }, 'No lab cost recorded for these sizes. '),
      el('a', { href: '#/print-costs' }, 'Fill in the print cost template'),
      el('span', { class: 'muted' }, ' and the margin on every size appears here.'));
  }

  return el('div', { class: 'table-wrap' },
    el('table', { class: 'table' },
      el('thead', null, el('tr', null,
        ['Size', 'Lab', 'Landed', 'Break even', 'Target', 'Your price', 'Margin'].map((h) => el('th', { text: h })))),
      el('tbody', null, rows.map(({ variant, row, guidance }) => {
        if (!guidance.known) {
          return el('tr', { class: 'muted' },
            el('td', { text: variant.label || sizeLabel(variant) }),
            el('td', { colSpan: 6, text: 'no cost recorded for this size' }));
        }
        const at = guidance.at;
        const tone = !at ? '' : at.profit < 0 ? 'bad-text' : at.margin < guidance.targetMargin ? 'warn-text' : 'ok-text';
        return el('tr', null,
          el('td', { text: variant.label || sizeLabel(variant) }),
          el('td', { class: 'muted small', text: row.vendor }),
          el('td', { text: money(guidance.cost.total) }),
          el('td', { class: 'muted', text: money(guidance.breakEven) }),
          el('td', null, el('strong', { text: money(guidance.target) })),
          el('td', { text: at ? money(at.price) : '—' }),
          el('td', null, at
            ? el('strong', { class: tone, text: `${Math.round(at.margin * 100)}% · ${money(at.profit)}` })
            : el('span', { class: 'muted', text: '—' })));
      }))));
}

// --- variants --------------------------------------------------------------

function variantsTable(draft, refresh) {
  const body = el('tbody');
  const table = el('div', { class: 'table-wrap variants' },
    el('table', { class: 'table' },
      el('thead', null, el('tr', null,
        ['Label', 'Width', 'Height', 'Shape', 'Price', ''].map((h) => el('th', { text: h })))),
      body));
  fillVariants(body, draft, refresh);
  return table;
}

function fillVariants(body, draft, refresh) {
  mount(body, (draft.variants ?? []).map((variant, i) => el('tr', null,
    el('td', null, el('input', { type: 'text', value: variant.label ?? '',
      onInput: (e) => { draft.variants[i].label = e.target.value; refresh(); } })),
    el('td', null, el('input', { type: 'number', step: 'any', inputMode: 'decimal', value: variant.width_in ?? '',
      onInput: (e) => { draft.variants[i].width_in = e.target.value === '' ? null : Number(e.target.value); refresh(); } })),
    el('td', null, el('input', { type: 'number', step: 'any', inputMode: 'decimal', value: variant.height_in ?? '',
      onInput: (e) => { draft.variants[i].height_in = e.target.value === '' ? null : Number(e.target.value); refresh(); } })),
    el('td', null, select([['', '—'], ...SHAPE.map((s) => [s, label(s)])], variant.shape, {
      onChange: (e) => { draft.variants[i].shape = e.target.value || null; refresh(); } })),
    el('td', null, el('input', { type: 'number', step: '0.01', inputMode: 'decimal', value: variant.price ?? '',
      onInput: (e) => { draft.variants[i].price = e.target.value === '' ? null : Number(e.target.value); refresh(); } })),
    el('td', null, el('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${variant.label || 'this size'}`,
      onClick: () => { draft.variants.splice(i, 1); fillVariants(body, draft, refresh); refresh(); } }, '×')))));
}

function rerenderVariants(form, draft, refresh) {
  const body = form.querySelector('.variants tbody');
  if (body) fillVariants(body, draft, refresh);
  refresh();
}

// --- actions ---------------------------------------------------------------

function regenerate(draft, artwork, settings, form, refresh) {
  const { text, missing } = generateDescription(draft, artwork, settings);
  draft.description = text;
  form.querySelector('.description-input').value = text;
  refresh();
  toast(missing.length ? `Regenerated. The record cannot fill: ${missing.join(', ')}.` : 'Regenerated from the record.',
    missing.length ? 'warn' : 'ok');
}

function copyButton(text, getValue) {
  return el('button', { class: 'btn ghost small', type: 'button', onClick: async (event) => {
    const value = getValue();
    try {
      await navigator.clipboard.writeText(value);
      toast('Copied', 'ok');
    } catch {
      // Clipboard access is refused without a user gesture in some browsers,
      // and over plain http. Select the text so it can be copied by hand.
      const area = el('textarea', { value, class: 'visually-hidden' });
      document.body.append(area);
      area.select();
      const ok = document.execCommand?.('copy');
      area.remove();
      toast(ok ? 'Copied' : 'Could not copy — select the text and copy it by hand.', ok ? 'ok' : 'warn');
    }
    event.target.blur();
  } }, text);
}
