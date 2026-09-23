// Export / import of the whole private layer (SPEC §4.2).
//
// Pure functions only, so the round trip is testable under Node. db.js reads
// the stores and hands the object here; the browser turns the string into a
// download named hightide-private-YYYY-MM-DD.json.

export const EXPORT_FORMAT = 'hightide-private';
export const EXPORT_VERSION = 2;

/**
 * Photographs are Blobs, and `JSON.stringify(blob)` is `{}` — silently, with
 * no error. An export written without this carried every photo's id and none
 * of its pixels, which made the backup of record a backup of everything except
 * the irreplaceable part. Blobs travel as base64 and are rebuilt on import.
 */
export const BLOB_MARKER = '__blob_base64';
export const BLOB_STORES = ['images_blobs'];

/**
 * How much of the photographs an export carries.
 *
 * `all` is the backup of record. `none` is the records, when you only want
 * the numbers. `thumbs` is the middle one that did not exist and turned out
 * to be the useful one: the 600 px thumbnails without the 2,000 px web
 * copies, which is about a tenth of the bytes and still enough to see how a
 * piece is framed, lit and cropped. A full catalog that will not fit through
 * an upload is not much of a backup to send anyone.
 */
export const PHOTO_MODES = ['all', 'thumbs', 'none'];

/** The two suffixes blob ids end in. A thumb is `<artwork>/<image>-thumb`. */
export const isThumbRow = (row) => typeof row?.id === 'string' && row.id.endsWith('-thumb');

export function photoRowsFor(mode, rows = []) {
  if (mode === 'none') return [];
  if (mode === 'thumbs') return rows.filter(isThumbRow);
  return rows;
}

/** Old exports said `photos: true | false`; both still read correctly. */
export function photoModeOf(payload) {
  if (payload?.photos === true) return 'all';
  if (payload?.photos === false) return 'none';
  return PHOTO_MODES.includes(payload?.photos) ? payload.photos : 'all';
}

/** Every store that export/import must carry. Adding one here is enough. */
export const STORES = [
  'artworks', 'listings', 'sales', 'customers', 'commissions',
  'expenses', 'snapshots', 'backlog', 'images_blobs',
  'print_costs', 'print_vendors',
];

export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000; // String.fromCharCode has an argument-count limit.
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeBlobRows(rows = []) {
  return Promise.all(rows.map(async (row) => {
    if (typeof Blob === 'undefined' || !(row?.blob instanceof Blob)) return row;
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    return {
      ...row,
      blob: {
        [BLOB_MARKER]: true,
        type: row.blob.type || 'application/octet-stream',
        size: row.blob.size,
        data: bytesToBase64(bytes),
      },
    };
  }));
}

export function decodeBlobRows(rows = []) {
  return rows.map((row) => {
    const encoded = row?.blob;
    if (!encoded || typeof encoded !== 'object' || !encoded[BLOB_MARKER]) return row;
    return { ...row, blob: new Blob([base64ToBytes(encoded.data)], { type: encoded.type }) };
  });
}

/** Rows whose image data did not survive being written — see BLOB_MARKER. */
export function hollowBlobRows(rows = []) {
  return rows.filter((row) => {
    const b = row?.blob;
    if (!b) return true;
    if (typeof Blob !== 'undefined' && b instanceof Blob) return false;
    return !b[BLOB_MARKER];
  });
}

export function exportFilename(date = new Date(), { photos = 'all' } = {}) {
  const mode = photos === true ? 'all' : photos === false ? 'none' : photos;
  const suffix = { all: '', thumbs: '-thumbnails', none: '-records-only' }[mode] ?? '';
  return `hightide-private-${date.toISOString().slice(0, 10)}${suffix}.json`;
}

export function buildExport(data, { exported_at = new Date().toISOString(), photos = 'all' } = {}) {
  const mode = photos === true ? 'all' : photos === false ? 'none' : photos;
  const payload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at,
    // `true`/`false` on the wire for the two old modes, so a file written here
    // still imports into a build that predates thumbnails.
    photos: mode === 'all' ? true : mode === 'none' ? false : mode,
    settings: data.settings ?? {},
  };
  for (const store of STORES) {
    payload[store] = BLOB_STORES.includes(store)
      ? photoRowsFor(mode, data[store] ?? [])
      : (data[store] ?? []);
  }
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
  // Keep the photo mode, do not flatten it to a boolean. `photos !== false`
  // turned "thumbs" into true, so every guard downstream believed a
  // thumbnails file was a complete export — and a replace from one would have
  // swapped every 2,000 px photograph for its 600 px thumbnail. The tests for
  // that guard passed because they called planImport directly; the path a
  // real file takes goes through here first.
  const mode = photoModeOf(parsed);
  const out = {
    settings: parsed.settings ?? {},
    exported_at: parsed.exported_at ?? null,
    photos: mode === 'all' ? true : mode === 'none' ? false : mode,
  };
  for (const store of STORES) {
    const rows = parsed[store];
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new ImportError(`"${store}" should be a list but is ${typeof rows}.`);
    }
    out[store] = BLOB_STORES.includes(store) ? decodeBlobRows(rows ?? []) : (rows ?? []);
  }
  // A file written before version 2 carries photo rows with no pixels in them.
  // Say so rather than importing hollow records over working ones.
  out.hollowPhotos = BLOB_STORES.flatMap((store) => hollowBlobRows(parsed[store] ?? []));
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
  const photoMode = photoModeOf(incoming);
  const plan = { mode, stores: {}, conflicts: [], photos: photoMode !== 'none', photoMode };
  for (const store of STORES) {
    // Only a full export knows about every photograph. A records-only or
    // thumbnails-only file is an incomplete picture of them, so a replace from
    // one must never be read as "delete the photographs it does not mention" —
    // that would trade the 2,000 px copies for the 600 px ones.
    if (BLOB_STORES.includes(store) && photoMode !== 'all') {
      const kept = current[store] ?? [];
      if (!(incoming[store] ?? []).length) {
        plan.stores[store] = { rows: kept, added: [], updated: [], unchanged: kept.map((r) => r.id), conflicts: [] };
      } else {
        plan.stores[store] = mergeStore(kept, incoming[store]);
      }
      continue;
    }
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
