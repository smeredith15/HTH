// Export / import of the whole private layer (SPEC §4.2).
//
// Pure functions only, so the round trip is testable under Node. db.js reads
// the stores and hands the object here; the browser turns the string into a
// download named hightide-private-YYYY-MM-DD.json.

export const EXPORT_FORMAT = 'hightide-private';
export const EXPORT_VERSION = 1;

/** Every store that export/import must carry. Adding one here is enough. */
export const STORES = [
  'artworks', 'listings', 'sales', 'customers', 'commissions',
  'expenses', 'snapshots', 'backlog', 'images_blobs',
  'print_costs', 'print_vendors',
];

export function exportFilename(date = new Date()) {
  return `hightide-private-${date.toISOString().slice(0, 10)}.json`;
}

export function buildExport(data, { exported_at = new Date().toISOString() } = {}) {
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at,
    settings: data.settings ?? {},
  };
  for (const store of STORES) payload[store] = data[store] ?? [];
  return payload;
}

export function serializeExport(data, opts) {
  return JSON.stringify(buildExport(data, opts), null, 2);
}

export class ImportError extends Error {}

export function parseImport(text) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (err) {
    throw new ImportError(`That file isn't valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ImportError('That file does not look like a High Tide export.');
  }
  if (parsed.format !== EXPORT_FORMAT) {
    throw new ImportError(
      `Expected a ${EXPORT_FORMAT} file but found "${parsed.format ?? 'nothing'}".`,
    );
  }
  if (Number(parsed.version) > EXPORT_VERSION) {
    throw new ImportError(
      `This file was written by a newer version of the app (v${parsed.version}). Update the app first.`,
    );
  }
  const out = { settings: parsed.settings ?? {}, exported_at: parsed.exported_at ?? null };
  for (const store of STORES) {
    const rows = parsed[store];
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new ImportError(`"${store}" should be a list but is ${typeof rows}.`);
    }
    out[store] = rows ?? [];
  }
  return out;
}

/**
 * Merge an incoming export into what is already here.
 *
 * Scott's phone is the device of record and the desktop imports from it, so a
 * blind overwrite would silently discard whichever side was edited second.
 * Per record: newest updated_at wins, and anything that differs with no
 * usable timestamp is reported as a conflict rather than resolved quietly.
 */
export function mergeStore(existing = [], incoming = [], { key = 'id' } = {}) {
  const byId = new Map(existing.map((row) => [row[key], row]));
  const result = { added: [], updated: [], unchanged: [], conflicts: [] };

  for (const row of incoming) {
    const id = row[key];
    const mine = byId.get(id);
    if (!mine) {
      byId.set(id, row);
      result.added.push(id);
      continue;
    }
    if (JSON.stringify(mine) === JSON.stringify(row)) {
      result.unchanged.push(id);
      continue;
    }
    const mineAt = Date.parse(mine.updated_at ?? '');
    const theirsAt = Date.parse(row.updated_at ?? '');
    if (Number.isNaN(mineAt) || Number.isNaN(theirsAt)) {
      result.conflicts.push({ id, reason: 'no timestamp to compare', mine, theirs: row });
      continue;
    }
    if (theirsAt > mineAt) {
      byId.set(id, row);
      result.updated.push(id);
    } else if (theirsAt < mineAt) {
      result.unchanged.push(id);
    } else {
      result.conflicts.push({ id, reason: 'edited at the same moment on both devices', mine, theirs: row });
    }
  }

  result.rows = [...byId.values()];
  return result;
}

/** Plan a whole-file merge without writing anything, so the UI can preview it. */
export function planImport(current, incoming, { mode = 'merge' } = {}) {
  const plan = { mode, stores: {}, conflicts: [] };
  for (const store of STORES) {
    if (mode === 'replace') {
      plan.stores[store] = {
        rows: incoming[store] ?? [],
        added: (incoming[store] ?? []).map((r) => r.id),
        updated: [], unchanged: [], conflicts: [],
      };
      continue;
    }
    const merged = mergeStore(current[store] ?? [], incoming[store] ?? []);
    plan.stores[store] = merged;
    for (const c of merged.conflicts) plan.conflicts.push({ store, ...c });
  }
  plan.settings = mode === 'replace'
    ? incoming.settings
    : { ...(current.settings ?? {}), ...(incoming.settings ?? {}) };
  return plan;
}

/** §4.2: warn when the last export is more than 14 days old. */
export const EXPORT_STALE_DAYS = 14;

export function exportAge(lastExportedAt, now = new Date()) {
  if (!lastExportedAt) return { never: true, days: null, stale: true };
  const days = Math.floor((now - new Date(lastExportedAt)) / 86400000);
  return { never: false, days, stale: days >= EXPORT_STALE_DAYS };
}
