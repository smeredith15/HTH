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
  landedCost, finishingCost, breakEven, priceForMargin, compareVendors, costAnomalies,
  sizeLabel, sameSize, FULFILMENT, FULFILMENT_LABELS,
} from '../listing/print-pricing.js';

const state = { hideUnpriced: false };

/**
 * Typing into a cost cell used to rebuild the entire screen, which threw the
 * page back to the top and took the cursor with it. Edits now update only the
 * figures that depend on them; the screen is rebuilt only when rows are added
 * or removed, and even then the scroll position is kept.
 */
let live = null;

function refreshDependents() {
  if (!live) return;
  const priced = live.rows.filter((r) => Number(r.unit_cost) > 0).length;
  mount(live.count, `${priced} of ${live.rows.length} sizes priced`);
  mount(live.anomalies, anomalyPanel(live.rows, live.host));
  mount(live.comparison, comparisonPanel(live.rows, live.vendors, live.settings));
}

function refreshEveryRow() {
  if (!live) return;
  for (const refresh of live.rowRefreshers) refresh();
  refreshDependents();
}

/** Rebuilding is only for structural changes, and it should not lose your place. */
async function rebuild(host) {
  const top = window.scrollY;
  await renderPrintCosts(host);
  requestAnimationFrame(() => window.scrollTo(0, top));
}

export async function renderPrintCosts(host) {
  const [rows, vendors, settings] = await Promise.all([
    listPrintCosts(), listPrintVendors(), loadSettings(),
  ]);
  const byName = new Map(vendors.map((v) => [v.name, v]));
  const priced = rows.filter((r) => Number(r.unit_cost) > 0);

  const count = el('p', { class: 'muted', text: `${priced.length} of ${rows.length} sizes priced` });
  const anomalies = el('div');
  const comparison = el('div');
  live = { rows, vendors, settings, byName, host, count, anomalies, comparison, rowRefreshers: [] };

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Print costs'),
        count),
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
          onChange: (e) => { state.hideUnpriced = e.target.checked; rebuild(host); } }),
        el('span', null, 'Hide the sizes I have not priced'))),

    anomalies,

    assumptionsPanel(settings, host),

    ...PRODUCT_LINES.map((line) => linePanel(line, rows, byName.get(line.vendor), settings, host)),

    vendorPanel(vendors, host),

    comparison);

  mount(anomalies, anomalyPanel(rows, host));
  mount(comparison, comparisonPanel(rows, vendors, settings));
}

function anomalyPanel(rows, host) {
  const anomalies = costAnomalies(rows);
  if (!anomalies.length) return null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  return el('section', { class: 'panel alert warn' },
    el('h2', null, 'Worth a second look'),
    el('p', { class: 'hint' }, 'Uncommon sizes often cost more than the standard size above them. If that is what this is, say so and it stops asking.'),
    el('ul', { class: 'findings-list' }, anomalies.map((a) => el('li', null,
      el('span', { text: a.message }),
      el('button', {
        class: 'btn ghost small', type: 'button',
        onClick: async () => {
          const target = byId.get(a.id);
          Object.assign(target, { cost_confirmed_on: new Date().toISOString().slice(0, 10) });
          await savePrintCost(target);
          refreshDependents();
        },
      }, 'That price is right')))));
}

function assumptionsPanel(settings, host) {
  const num = (key, labelText, hint, step = '0.01') => field(labelText, el('input', {
    type: 'number', step, inputMode: 'decimal', value: settings[key] ?? '',
    onInput: (e) => {
      // Every landed cost depends on these, so the table follows as you type.
      settings[key] = e.target.value === '' ? null : Number(e.target.value);
      refreshEveryRow();
    },
    onChange: async () => { await saveSettings(settings); },
  }), hint);

  return el('section', { class: 'panel' },
    el('h2', null, 'What else a print costs you'),
    el('div', { class: 'three-up' },
      num('print_shipping_estimate', 'Postage to the buyer ($)', 'Free shipping is inside the price.'),
      num('packaging_cost', 'Packaging ($)', 'Tube or mailer, corners, tape.'),
      field('Target margin (%)', el('input', {
        type: 'number', step: '1', min: '0', max: '90', inputMode: 'numeric',
        value: Math.round((settings.target_print_margin ?? 0) * 100),
        onInput: (e) => {
          settings.target_print_margin = Number(e.target.value) / 100;
          refreshEveryRow();
        },
        onChange: async () => { await saveSettings(settings); },
      }), 'Profit as a share of the sale price.')));
}

function linePanel(line, rows, vendor, settings, host) {
  let lineRows = rows.filter((r) => r.line === line.key)
    .sort((a, b) => (a.width_in * a.height_in) - (b.width_in * b.height_in));
  if (state.hideUnpriced) lineRows = lineRows.filter((r) => Number(r.unit_cost) > 0);
  if (!lineRows.length) return null;

  const body = el('tbody', null, lineRows.map((row) => costRow(row, vendor, settings, host)));

  return el('section', { class: 'panel' },
    el('h2', null, `${line.vendor} — ${line.product}`),
    el('p', { class: 'hint' },
      label(line.substrate), ' · ', label(line.process),
      vendor ? ` · ${FULFILMENT_LABELS[vendor.fulfilment] ?? ''}` : '',
      line.process === 'giclee' ? null : el('span', null, ' · ', pill('not giclée', 'muted'))),
    el('p', { class: 'hint' },
      line.includes?.length
        ? el('span', null, el('strong', null, 'Price includes: '), line.includes.join(', '), '. ')
        : el('span', null, el('strong', null, 'Price is for the print alone. '))),
      line.finishing
        ? el('p', { class: 'hint' },
          `Ready to hang needs a ${line.finishing.label}, about `
          + `${Math.round(line.finishing.pct * 100)}% of the base price again. `
          + 'Untick Mount to price a bare print instead, or type a flat figure over it.')
        : null,
    el('div', { class: 'table-wrap' },
      el('table', { class: 'table costs' },
        el('thead', null, el('tr', null,
          ['Size', 'Lab charges', 'Ship', 'Mount', 'Landed', 'Break even', 'Target', 'Lead', ''].map((h) => el('th', { text: h })))),
        body)),
    el('button', { class: 'btn ghost small', type: 'button', onClick: () => addSize(line, host) }, '+ Add a size'));
}

/**
 * One size. The three derived cells refresh in place as you type, and saving
 * happens on blur without touching the DOM you are standing in.
 */
function costRow(row, vendor, settings, host) {
  const mountText = el('span', { class: 'muted small' });
  const landedCell = el('td');
  const breakEvenCell = el('td', { class: 'muted' });
  const targetCell = el('td');

  const refresh = () => {
    const cost = landedCost(row, vendor, settings);
    const target = cost ? priceForMargin(cost, settings, Number(settings.target_print_margin)) : null;
    mount(landedCell, cost ? money(cost.total) : el('span', { class: 'muted', text: '—' }));
    mount(breakEvenCell, cost ? money(breakEven(cost, settings)) : '—');
    mount(targetCell, target
      ? el('strong', { text: money(target) })
      : el('span', { class: 'muted', text: '—' }));
    mountText.textContent = row.mounted ? money(finishingCost(row)) : 'bare';
  };
  live?.rowRefreshers.push(refresh);

  const save = async (patch = {}) => {
    Object.assign(row, patch);
    await savePrintCost({ ...row, checked_on: row.checked_on ?? new Date().toISOString().slice(0, 10) });
    refreshDependents();
  };

  const numberCell = (key, step = '0.01') => el('td', null, el('input', {
    type: 'number', step, inputMode: 'decimal', value: row[key] ?? '',
    'aria-label': `${key} for ${sizeLabel(row)}`,
    onInput: (e) => { row[key] = e.target.value === '' ? null : Number(e.target.value); refresh(); },
    onChange: () => save(),
  }));

  const cells = el('tr', null,
    el('td', null,
      el('span', { text: sizeLabel(row) }),
      row.note ? el('span', { class: 'muted small', text: ` ${row.note}` }) : null),
    numberCell('unit_cost'),
    numberCell('ship_each'),
    el('td', null, mountCell(row, mountText, refresh, save)),
    landedCell,
    breakEvenCell,
    targetCell,
    el('td', null, el('input', {
      type: 'number', step: '1', inputMode: 'numeric', value: row.lead_days ?? '',
      'aria-label': `Lead days for ${sizeLabel(row)}`,
      onChange: (e) => save({ lead_days: e.target.value === '' ? null : Number(e.target.value) }),
    })),
    el('td', null, el('button', {
      class: 'btn ghost small', type: 'button', 'aria-label': `Remove ${sizeLabel(row)}`,
      onClick: async () => {
        await deletePrintCost(row.id);
        rebuild(host); // structural, so a rebuild is right
      },
    }, '×')));

  refresh();
  return cells;
}

/**
 * Mounting is derived from the base price, so it moves when the price does.
 * The checkbox is the useful control; the number beside it is what that rule
 * currently works out to, and can be typed over when the rule is wrong.
 */
function mountCell(row, mountText, refresh, save) {
  if (!row.finishing_pct && row.finishing_cost === null) {
    return el('span', { class: 'muted small', text: 'included' });
  }
  return el('div', { class: 'mount-cell' },
    el('label', { class: 'check tight' },
      el('input', {
        type: 'checkbox', checked: !!row.mounted,
        'aria-label': `Mount the ${sizeLabel(row)} print`,
        onChange: async (e) => {
          row.mounted = e.target.checked;
          refresh();
          await save();
        },
      }),
      mountText),
    el('input', {
      type: 'number', step: '0.01', inputMode: 'decimal',
      value: row.finishing_cost ?? '',
      placeholder: row.finishing_pct ? `${Math.round(row.finishing_pct * 100)}%` : '',
      'aria-label': `Flat mounting cost for ${sizeLabel(row)}`,
      onInput: (e) => {
        row.finishing_cost = e.target.value === '' ? null : Number(e.target.value);
        refresh();
      },
      onChange: () => save(),
    }));
}

function vendorPanel(vendors, host) {
  return el('section', { class: 'panel' },
    el('h2', null, 'Labs'),
    ...vendors.map((vendor) => el('div', { class: 'panel inset' },
      el('h3', null, vendor.name),
      vendor.url ? el('p', null, el('a', { href: vendor.url, target: '_blank', rel: 'noopener noreferrer', text: vendor.url })) : null,
      field('How it reaches the buyer', select(
        FULFILMENT.map((f) => [f, FULFILMENT_LABELS[f]]), vendor.fulfilment,
        { onChange: async (e) => {
          // Fulfilment changes which postage legs apply, so every row moves.
          vendor.fulfilment = e.target.value;
          await savePrintVendor(vendor);
          refreshEveryRow();
        } },
      ), 'Decides which postage you actually pay for.'),
      field('Notes', el('textarea', {
        rows: 3, value: vendor.notes ?? '',
        onChange: async (e) => { await savePrintVendor({ ...vendor, notes: e.target.value || null }); },
      })),
      el('div', { class: 'two-up' },
        field('Prices last checked', el('input', {
          type: 'date', value: vendor.checked_on ?? '',
          onChange: async (e) => { await savePrintVendor({ ...vendor, checked_on: e.target.value || null }); },
        }), 'Lab prices move. This is the date you last looked.'),
        field('Proof approved', el('input', {
          type: 'date', value: vendor.quality_checked_on ?? '',
          onChange: async (e) => {
            vendor.quality_checked_on = e.target.value || null;
            await savePrintVendor(vendor);
            refreshDependents();
          },
        }), 'The date you held one of their prints and were happy with it. Until then the comparison says so.')),
      vendor.quality_checked_on
        ? pill(`proofed ${vendor.quality_checked_on}`, 'ok')
        : pill('not proofed yet', 'warn'))));
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
    el('p', { class: 'hint' }, 'Cheapest first, ready-to-hang against ready-to-hang. “Target” is the price that leaves your target margin, so the difference between two rows is what genuine giclée costs the buyer.'),
    ...comparable.map(({ size, options }) => el('div', { class: 'panel inset' },
      el('h3', { text: sizeLabel(size) }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null, ['Lab', 'Process', 'Ready to hang', 'Landed', 'Break even', 'Target price', 'vs cheapest'].map((h) => el('th', { text: h })))),
          el('tbody', null, options.map((option, i) => el('tr', null,
            el('td', null,
              el('span', { text: option.row.vendor }),
              option.qualityChecked ? null : el('span', { class: 'muted small', text: ' · not proofed' })),
            el('td', null, option.row.process === 'giclee' ? pill('giclée', 'ok') : label(option.row.process)),
            el('td', null, option.readyToHang
              ? el('span', { class: 'muted small', text: option.cost.finishing ? `+${money(option.cost.finishing)} mount` : 'included' })
              : pill('bare print', 'warn')),
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
          const changed = result.updated.length - result.created.length;
          const parts = [];
          if (changed) parts.push(`update ${changed} row${changed === 1 ? '' : 's'}`);
          if (result.created.length) parts.push(`add ${result.created.length} size${result.created.length === 1 ? '' : 's'} this device has not seen`);
          const ok = await confirmDialog(
            `From ${file.name}: ${parts.join(', and ')}?`
            + (result.unknown.length ? ` ${result.unknown.length} row(s) carried no usable size and will be skipped.` : ''),
            { confirmText: 'Import', tone: 'primary' },
          );
          if (ok) {
            await putMany('print_costs', result.updated.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
            toast(`Updated ${result.updated.length} rows.`, 'ok');
            rebuild(host);
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
      rebuild(host);
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
