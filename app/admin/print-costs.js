// The print cost template (SPEC §8, extended — see DECISIONS.md).
//
// Blank is the normal state here. Fill in only the sizes worth offering; a row
// with no cost simply does not guide anything.

import { el, mount, money, label, field, select, pill, toast, confirmDialog } from '../ui/dom.js';
import {
  listPrintCosts, listPrintVendors, savePrintCost, savePrintVendor, deletePrintCost,
  addPrintCostRow, PRODUCT_LINES, toCSV, applyCSV,
} from '../store/print-costs.js';
import { putMany, loadSettings, saveSettings } from '../store/db.js';
import {
  landedCost, breakEven, priceForMargin, compareVendors, sizeLabel, sameSize,
  FULFILMENT, FULFILMENT_LABELS,
} from '../listing/print-pricing.js';

const state = { hideUnpriced: false };

export async function renderPrintCosts(host) {
  const [rows, vendors, settings] = await Promise.all([
    listPrintCosts(), listPrintVendors(), loadSettings(),
  ]);
  const byName = new Map(vendors.map((v) => [v.name, v]));
  const priced = rows.filter((r) => Number(r.unit_cost) > 0);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Print costs'),
        el('p', { class: 'muted', text: `${priced.length} of ${rows.length} sizes priced` })),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', onClick: () => downloadCSV(rows) }, 'Download CSV'),
        csvUploadButton(host))),

    el('section', { class: 'panel' },
      el('h2', null, 'How to fill this in'),
      el('p', null, 'Put in the ', el('strong', null, 'nominal price you pay the lab'),
        ' for one print at that size, before any shipping. Leave a row blank if you would not offer it. '
        + 'Nothing here is guessed for you — a margin built on an invented cost is worse than no margin.'),
      el('p', { class: 'hint' }, 'Faster on a desktop: download the CSV, fill the unit_cost column in a spreadsheet, and upload it again. Only the columns you send are changed.'),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: state.hideUnpriced,
          onChange: (e) => { state.hideUnpriced = e.target.checked; renderPrintCosts(host); } }),
        el('span', null, 'Hide the sizes I have not priced'))),

    assumptionsPanel(settings, host),

    ...PRODUCT_LINES.map((line) => linePanel(line, rows, byName.get(line.vendor), settings, host)),

    vendorPanel(vendors, host),

    priced.length ? comparisonPanel(rows, vendors, settings) : null);
}

function assumptionsPanel(settings, host) {
  const num = (key, labelText, hint, step = '0.01') => field(labelText, el('input', {
    type: 'number', step, inputMode: 'decimal', value: settings[key] ?? '',
    onChange: async (e) => {
      await saveSettings({ ...settings, [key]: e.target.value === '' ? null : Number(e.target.value) });
      renderPrintCosts(host);
    },
  }), hint);

  return el('section', { class: 'panel' },
    el('h2', null, 'What else a print costs you'),
    el('div', { class: 'three-up' },
      num('print_shipping_estimate', 'Postage to the buyer ($)', 'Free shipping is inside the price.'),
      num('packaging_cost', 'Packaging ($)', 'Tube or mailer, corners, tape.'),
      field('Target margin (%)', el('input', {
        type: 'number', step: '1', min: '0', max: '90', inputMode: 'numeric',
        value: Math.round((settings.target_print_margin ?? 0) * 100),
        onChange: async (e) => {
          await saveSettings({ ...settings, target_print_margin: Number(e.target.value) / 100 });
          renderPrintCosts(host);
        },
      }), 'Profit as a share of the sale price.')));
}

function linePanel(line, rows, vendor, settings, host) {
  let lineRows = rows.filter((r) => r.line === line.key)
    .sort((a, b) => (a.width_in * a.height_in) - (b.width_in * b.height_in));
  if (state.hideUnpriced) lineRows = lineRows.filter((r) => Number(r.unit_cost) > 0);
  if (!lineRows.length) return null;

  const body = el('tbody');
  const fill = () => mount(body, lineRows.map((row) => costRow(row, vendor, settings, host, fill)));
  fill();

  return el('section', { class: 'panel' },
    el('h2', null, `${line.vendor} — ${line.product}`),
    el('p', { class: 'hint' },
      label(line.substrate), ' · ', label(line.process),
      vendor ? ` · ${FULFILMENT_LABELS[vendor.fulfilment] ?? ''}` : '',
      line.process === 'giclee' ? null : el('span', null, ' · ', pill('not giclée', 'muted'))),
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table costs' },
        el('thead', null, el('tr', null,
          ['Size', 'Lab charges', 'Ship in', 'Landed', 'Break even', `Target`, 'Lead', ''].map((h) => el('th', { text: h })))),
        body)),
    el('button', { class: 'btn ghost small', type: 'button', onClick: () => addSize(line, host) }, '+ Add a size'));
}

function costRow(row, vendor, settings, host, refill) {
  const cells = el('tr');
  const derived = el('span');

  const recompute = () => {
    const cost = landedCost(row, vendor, settings);
    if (!cost) return mount(derived, el('span', { class: 'muted', text: '—' }));
    return mount(derived, el('span', { text: money(cost.total) }));
  };

  const numberCell = (key, step = '0.01') => el('td', null, el('input', {
    type: 'number', step, inputMode: 'decimal', value: row[key] ?? '',
    'aria-label': `${key} for ${sizeLabel(row)}`,
    onInput: (e) => { row[key] = e.target.value === '' ? null : Number(e.target.value); recompute(); },
    onChange: async () => {
      await savePrintCost({ ...row, checked_on: row.checked_on ?? new Date().toISOString().slice(0, 10) });
      renderPrintCosts(host);
    },
  }));

  const cost = landedCost(row, vendor, settings);
  const target = priceForMargin(cost, settings, Number(settings.target_print_margin));

  cells.append(
    el('td', null,
      el('span', { text: sizeLabel(row) }),
      row.note ? el('span', { class: 'muted small', text: ` ${row.note}` }) : null),
    numberCell('unit_cost'),
    numberCell('ship_each'),
    el('td', null, recompute() || derived),
    el('td', { class: 'muted', text: cost ? money(breakEven(cost, settings)) : '—' }),
    el('td', null, target ? el('strong', { text: money(target) }) : el('span', { class: 'muted', text: '—' })),
    el('td', null, el('input', {
      type: 'number', step: '1', inputMode: 'numeric', value: row.lead_days ?? '',
      'aria-label': `Lead days for ${sizeLabel(row)}`,
      onChange: async (e) => {
        await savePrintCost({ ...row, lead_days: e.target.value === '' ? null : Number(e.target.value) });
      },
    })),
    el('td', null, el('button', {
      class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${sizeLabel(row)}`,
      onClick: async () => {
        await deletePrintCost(row.id);
        renderPrintCosts(host);
      },
    }, '×')));
  return cells;
}

function vendorPanel(vendors, host) {
  return el('section', { class: 'panel' },
    el('h2', null, 'Labs'),
    ...vendors.map((vendor) => el('div', { class: 'panel inset' },
      el('h3', null, vendor.name),
      vendor.url ? el('p', null, el('a', { href: vendor.url, target: '_blank', rel: 'noopener noreferrer', text: vendor.url })) : null,
      field('How it reaches the buyer', select(
        FULFILMENT.map((f) => [f, FULFILMENT_LABELS[f]]), vendor.fulfilment,
        { onChange: async (e) => { await savePrintVendor({ ...vendor, fulfilment: e.target.value }); renderPrintCosts(host); } },
      ), 'Decides which postage you actually pay for.'),
      field('Notes', el('textarea', {
        rows: 3, value: vendor.notes ?? '',
        onChange: async (e) => { await savePrintVendor({ ...vendor, notes: e.target.value || null }); },
      })),
      field('Prices last checked', el('input', {
        type: 'date', value: vendor.checked_on ?? '',
        onChange: async (e) => { await savePrintVendor({ ...vendor, checked_on: e.target.value || null }); },
      }), 'Lab prices move. This is the date you last looked.'))));
}

/**
 * The same size from every lab that quotes it. This is what answers "is real
 * giclée worth the difference" — as a table, not a feeling.
 */
function comparisonPanel(rows, vendors, settings) {
  const sizes = [];
  for (const row of rows.filter((r) => Number(r.unit_cost) > 0)) {
    if (!sizes.some((s) => sameSize(s, row))) sizes.push({ width_in: row.width_in, height_in: row.height_in });
  }
  sizes.sort((a, b) => (a.width_in * a.height_in) - (b.width_in * b.height_in));

  const comparable = sizes
    .map((size) => ({ size, options: compareVendors(rows, vendors, settings, size) }))
    .filter((entry) => entry.options.length > 1);

  if (!comparable.length) {
    return el('section', { class: 'panel' },
      el('h2', null, 'Lab comparison'),
      el('p', { class: 'muted' }, 'Price the same size at two labs and the comparison appears here.'));
  }

  return el('section', { class: 'panel' },
    el('h2', null, 'Lab comparison'),
    el('p', { class: 'hint' }, 'Cheapest first. “Target” is the price that leaves your target margin — the difference between two rows is what genuine giclée costs the buyer.'),
    ...comparable.map(({ size, options }) => el('div', { class: 'panel inset' },
      el('h3', { text: sizeLabel(size) }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null, ['Lab', 'Process', 'Landed', 'Break even', 'Target price', 'vs cheapest'].map((h) => el('th', { text: h })))),
          el('tbody', null, options.map((option, i) => el('tr', null,
            el('td', { text: option.row.vendor }),
            el('td', null, option.row.process === 'giclee' ? pill('giclée', 'ok') : label(option.row.process)),
            el('td', { text: money(option.cost.total) }),
            el('td', { class: 'muted', text: money(option.breakEven) }),
            el('td', null, el('strong', { text: money(option.target) })),
            el('td', { class: i === 0 ? 'muted' : '' , text: i === 0 ? 'cheapest' : `+${money(option.target - options[0].target)}` }))))))))); 
}

// --- CSV ------------------------------------------------------------------

function downloadCSV(rows) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `hightide-print-costs-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('Downloaded. Fill in the unit_cost column and upload it again.', 'ok');
}

function csvUploadButton(host) {
  const input = el('input', {
    type: 'file', accept: '.csv,text/csv', class: 'visually-hidden',
    onChange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const current = await listPrintCosts();
        const result = applyCSV(await file.text(), current);
        if (!result.updated.length) {
          toast(`Nothing changed. ${result.unchanged} rows matched what is already here.`, 'warn');
        } else {
          const ok = await confirmDialog(
            `Update ${result.updated.length} row${result.updated.length === 1 ? '' : 's'} from ${file.name}?`
            + (result.unknown.length ? ` ${result.unknown.length} row(s) had an id this app does not know and will be skipped.` : ''),
            { confirmText: 'Update', tone: 'primary' },
          );
          if (ok) {
            await putMany('print_costs', result.updated.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
            toast(`Updated ${result.updated.length} rows.`, 'ok');
            renderPrintCosts(host);
          }
        }
      } catch (err) {
        toast(err.message, 'warn');
      }
      event.target.value = '';
    },
  });
  return el('label', { class: 'btn ghost' }, 'Upload CSV', input);
}

async function addSize(line, host) {
  const w = el('input', { type: 'number', step: 'any', inputMode: 'decimal', placeholder: 'Width', required: true });
  const h = el('input', { type: 'number', step: 'any', inputMode: 'decimal', placeholder: 'Height', required: true });
  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body', onSubmit: async (event) => {
      event.preventDefault();
      await addPrintCostRow(line.key, Number(w.value), Number(h.value));
      dialog.close();
      renderPrintCosts(host);
    } },
      el('h2', { text: `Add a size to ${line.product}` }),
      el('div', { class: 'two-up' },
        el('div', { class: 'field' }, el('span', null, 'Width (in)'), w),
        el('div', { class: 'field' }, el('span', null, 'Height (in)'), h)),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Add'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  w.focus();
}
