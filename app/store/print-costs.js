// What each lab charges for each print (SPEC §8, extending it — see DECISIONS).
//
// §8.1 prices an original from hours. A print costs what the lab charges, so
// it needs its own numbers. This is the template Scott fills in, and the
// source the price recommendations read.

import { getAll, put, putMany, remove, count } from './db.js';
import { slugify } from './schema.js';

export const SEED_AT = '2026-09-22T00:00:00.000Z';

/**
 * The vendors under consideration. `fulfilment` decides which shipping legs
 * Scott actually pays for — see app/listing/print-pricing.js.
 */
export const SEED_VENDORS = [
  {
    id: 'canvaschamp',
    name: 'CanvasChamp',
    url: 'https://www.canvaschamp.com/',
    // Both labs drop-ship, so Scott never handles a print or pays postage.
    fulfilment: 'dropship',
    local: false,
    quality_checked_on: '2026-09-22',
    notes: 'Canvas is poly-cotton with UV-resistant solvent-free latex inks. '
      + 'Wood prints are permanent UV ink direct to MDF composite. Neither is giclée. '
      + 'Quoted price includes proofing and hanging hardware, so nothing is added '
      + 'to make it ready to hang. Has produced good work for Scott before.',
    checked_on: '2026-10-01',
  },
  {
    id: 'nations-photo-lab',
    name: 'Nations Photo Lab',
    url: 'https://www.nationsphotolab.com/',
    // Local, but their site offers no in-person collection, and their postage
    // is likely cheaper than Scott's anyway — so they ship to the buyer.
    fulfilment: 'dropship',
    local: true,
    quality_checked_on: null,
    notes: 'Quality assumed good pending a proof — order one and check before this '
      + 'becomes the official workflow. Genuine giclée. Price quoted is for the print alone: mounting is a '
      + 'separate 3/16 in white foamcore backing at roughly 50% of the base price. '
      + 'Local, but no in-person collection is offered, so they ship direct to the buyer.',
    checked_on: null,
  },
];

/**
 * One row per vendor product line. These are the columns of the template.
 *
 * `includes` is what the quoted price already covers, and `finishing` is what
 * has to be added before the piece is ready to hang. The two labs differ
 * exactly here: CanvasChamp quotes a finished piece, Nations quotes a bare
 * print. Comparing their headline prices without this is comparing two
 * different products.
 */
export const PRODUCT_LINES = [
  {
    key: 'cc-canvas', vendor: 'CanvasChamp', product: 'Canvas',
    substrate: 'canvas', process: 'digital',
    includes: ['proofing', 'hanging hardware'],
    finishing: null,
  },
  {
    key: 'cc-wood', vendor: 'CanvasChamp', product: 'Wood / MDF',
    substrate: 'mdf', process: 'uv_direct',
    includes: ['proofing', 'hanging hardware'],
    finishing: null,
  },
  {
    key: 'npl-paper', vendor: 'Nations Photo Lab', product: 'Giclée on fine-art paper',
    substrate: 'paper', process: 'giclee',
    includes: [],
    finishing: { label: '3/16 in white foamcore mount', pct: 0.5 },
  },
  {
    key: 'npl-canvas', vendor: 'Nations Photo Lab', product: 'Giclée on canvas',
    substrate: 'canvas', process: 'giclee',
    includes: [],
    finishing: { label: '3/16 in white foamcore mount', pct: 0.5 },
  },
];

export const lineFor = (key) => PRODUCT_LINES.find((l) => l.key === key) ?? null;

/**
 * The sizes to quote. The first four are sizes the live listings already sell;
 * the rest are the common ladder. Delete any row that is not worth offering.
 */
export const SEED_SIZES = [
  { width_in: 8, height_in: 12, live: true },   // the cactus print's 12 × 8
  { width_in: 12, height_in: 12, live: true },  // the surf van
  { width_in: 12, height_in: 18, live: true },  // the cactus print's 18 × 12
  { width_in: 16, height_in: 24, live: true },  // the cactus print's 24 × 16
  { width_in: 24, height_in: 24, live: true },  // the surf van original size
  { width_in: 8, height_in: 10 },
  { width_in: 11, height_in: 14 },
  { width_in: 12, height_in: 16 },
  { width_in: 16, height_in: 20 },
  { width_in: 18, height_in: 24 },
  { width_in: 20, height_in: 30 },
  { width_in: 24, height_in: 36 },
];

export function costRowId(line, size) {
  return `pc-${line.key}-${size.width_in}x${size.height_in}`;
}

export function buildTemplate() {
  const rows = [];
  for (const line of PRODUCT_LINES) {
    for (const size of SEED_SIZES) {
      rows.push({
        id: costRowId(line, size),
        line: line.key,
        vendor: line.vendor,
        product: line.product,
        substrate: line.substrate,
        process: line.process,
        width_in: size.width_in,
        height_in: size.height_in,
        unit_cost: null,   // what the lab charges for one, print only
        ship_each: null,   // shipping, per print — inbound, or the lab's charge to drop-ship
        // Finishing: what it takes to make the print ready to hang. Nations
        // quotes a bare print; CanvasChamp's price already includes hardware.
        finishing_label: line.finishing?.label ?? null,
        finishing_pct: line.finishing?.pct ?? null,
        finishing_cost: null,  // a flat figure, when the percentage is wrong
        mounted: !!line.finishing,
        lead_days: null,
        note: null,
        checked_on: null,  // lab prices move; record when you last looked
        created_at: SEED_AT,
        updated_at: SEED_AT,
      });
    }
  }
  return rows;
}

// --- persistence ----------------------------------------------------------

export const listPrintCosts = () => getAll('print_costs');
export const listPrintVendors = () => getAll('print_vendors');

export async function savePrintCost(row) {
  const record = { ...row, updated_at: new Date().toISOString() };
  await put('print_costs', record);
  return record;
}

export async function savePrintVendor(vendor) {
  const record = { ...vendor, updated_at: new Date().toISOString() };
  await put('print_vendors', record);
  return record;
}

export const deletePrintCost = (id) => remove('print_costs', id);

export async function addPrintCostRow(lineKey, width_in, height_in) {
  const line = lineFor(lineKey)
    ?? { key: lineKey, vendor: lineKey, product: lineKey, substrate: null, process: null };
  return savePrintCost({
    id: `pc-${line.key}-${width_in}x${height_in}-${slugify(String(Date.now())).slice(-4)}`,
    line: line.key,
    vendor: line.vendor,
    product: line.product,
    substrate: line.substrate,
    process: line.process,
    width_in, height_in,
    unit_cost: null, ship_each: null, lead_days: null, note: null, checked_on: null,
    finishing_label: line.finishing?.label ?? null,
    finishing_pct: line.finishing?.pct ?? null,
    finishing_cost: null,
    mounted: !!line.finishing,
    created_at: new Date().toISOString(),
  });
}

/** Lay the template down once, and top it up on later versions. */
export async function seedPrintCosts() {
  const report = { vendors: 0, rows: 0 };
  if (await count('print_vendors') === 0) {
    await putMany('print_vendors', SEED_VENDORS.map((v) => ({ ...v, updated_at: SEED_AT })));
    report.vendors = SEED_VENDORS.length;
  }
  const existing = new Set((await listPrintCosts()).map((r) => r.id));
  const missing = buildTemplate().filter((row) => !existing.has(row.id));
  if (missing.length) {
    await putMany('print_costs', missing);
    report.rows = missing.length;
  }
  return report;
}

/**
 * Bring rows saved by an earlier build up to the current shape.
 *
 * Unlike the seed refresh elsewhere, this runs on rows Scott has already
 * filled in — so it only ever fills fields that are *absent*, and never
 * overwrites a cost, a note or a toggle he has set.
 */
export async function migratePrintCosts() {
  const report = { rows: 0, vendors: 0 };

  const rows = await listPrintCosts();
  const patched = [];
  for (const row of rows) {
    const line = lineFor(row.line);
    const patch = {};
    if (row.finishing_pct === undefined) patch.finishing_pct = line?.finishing?.pct ?? null;
    if (row.finishing_label === undefined) patch.finishing_label = line?.finishing?.label ?? null;
    if (row.finishing_cost === undefined) patch.finishing_cost = null;
    if (row.mounted === undefined) patch.mounted = !!line?.finishing;
    if (Object.keys(patch).length) patched.push({ ...row, ...patch });
  }
  if (patched.length) {
    await putMany('print_costs', patched);
    report.rows = patched.length;
  }

  const vendors = await listPrintVendors();
  const vendorPatches = [];
  for (const vendor of vendors) {
    const patch = {};
    if (vendor.quality_checked_on === undefined) patch.quality_checked_on = null;
    // Nations offers no in-person collection, so a seeded local_pickup is
    // simply wrong. Only correct it while the row is untouched.
    if (vendor.id === 'nations-photo-lab'
      && vendor.fulfilment === 'local_pickup'
      && vendor.updated_at === SEED_AT) {
      patch.fulfilment = 'dropship';
    }
    if (Object.keys(patch).length) vendorPatches.push({ ...vendor, ...patch });
  }
  if (vendorPatches.length) {
    await putMany('print_vendors', vendorPatches);
    report.vendors = vendorPatches.length;
  }
  return report;
}

// --- CSV, so the template can be filled in a spreadsheet ------------------

export const CSV_COLUMNS = [
  'id', 'vendor', 'product', 'substrate', 'process',
  'width_in', 'height_in', 'unit_cost', 'ship_each',
  'finishing_cost', 'mounted', 'lead_days', 'checked_on', 'note',
];

export function toCSV(rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((key) => escape(row[key])).join(','));
  return lines.join('\n');
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { value += '"'; i += 1; } else { quoted = false; }
      } else value += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(value); value = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = []; value = '';
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

const NUMERIC = new Set([
  'width_in', 'height_in', 'unit_cost', 'ship_each', 'finishing_cost', 'lead_days',
]);
const BOOLEAN = new Set(['mounted']);

/**
 * Work out which product line a row belongs to, for a row this device has
 * never seen. The id carries it (`pc-<line>-<w>x<h>`), and the vendor and
 * product columns are the fallback.
 */
export function lineForRow(row) {
  const fromId = PRODUCT_LINES.find((l) => String(row.id ?? '').startsWith(`pc-${l.key}-`));
  if (fromId) return fromId;
  return PRODUCT_LINES.find((l) => l.vendor === row.vendor && l.product === row.product) ?? null;
}

/**
 * Read a filled-in CSV back. Only the columns present are touched, so a
 * spreadsheet that carries just id and unit_cost updates only the price —
 * which is the whole point of the round trip.
 *
 * A row whose id this device has never seen is *created* rather than skipped,
 * as long as it carries a size and a line we can place it in. Sizes added on
 * one device have to survive the trip to another, and an export has to be able
 * to rebuild a catalogue that browser storage has thrown away.
 */
export function applyCSV(text, current) {
  const table = parseCSV(text);
  if (!table.length) throw new Error('That file has no rows in it.');

  const header = table[0].map((h) => h.trim());
  if (!header.includes('id')) {
    throw new Error('The first row must be the column names, and must include "id".');
  }
  const byId = new Map(current.map((r) => [r.id, r]));
  const result = { updated: [], created: [], unknown: [], unchanged: 0 };

  for (const cells of table.slice(1)) {
    const incoming = Object.fromEntries(header.map((key, i) => [key, (cells[i] ?? '').trim()]));
    let existing = byId.get(incoming.id);

    if (!existing) {
      const line = lineForRow(incoming);
      const width = Number(incoming.width_in);
      const height = Number(incoming.height_in);
      if (!line || !incoming.id || !Number.isFinite(width) || !Number.isFinite(height)
        || width <= 0 || height <= 0) {
        result.unknown.push(incoming.id || '(no id)');
        continue;
      }
      existing = {
        id: incoming.id,
        line: line.key,
        vendor: line.vendor,
        product: line.product,
        substrate: line.substrate,
        process: line.process,
        width_in: width,
        height_in: height,
        unit_cost: null, ship_each: null, lead_days: null, note: null, checked_on: null,
        finishing_label: line.finishing?.label ?? null,
        finishing_pct: line.finishing?.pct ?? null,
        finishing_cost: null,
        mounted: !!line.finishing,
        created_at: new Date().toISOString(),
        updated_at: SEED_AT,
      };
      result.created.push(incoming.id);
    }

    const patch = {};
    for (const [key, raw] of Object.entries(incoming)) {
      if (key === 'id' || !CSV_COLUMNS.includes(key)) continue;
      let value = raw === '' ? null : raw;
      if (value !== null && NUMERIC.has(key)) value = Number(value);
      if (value !== null && BOOLEAN.has(key)) value = /^(true|yes|y|1)$/i.test(raw);
      if (NUMERIC.has(key) && value !== null && !Number.isFinite(value)) continue;
      if (existing[key] !== value) patch[key] = value;
    }
    if (result.created.includes(existing.id)) result.updated.push({ ...existing, ...patch });
    else if (Object.keys(patch).length) result.updated.push({ ...existing, ...patch });
    else result.unchanged += 1;
  }
  return result;
}
