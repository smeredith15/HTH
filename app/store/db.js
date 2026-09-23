// The private layer (SPEC §4.2): IndexedDB in the admin browser.
//
// Nothing in app/kiosk/ or app/public/ may import this module. §9.2 requires
// that separation and tests/kiosk-isolation.test.js enforces it.

import {
  STORES, BLOB_STORES, buildExport, parseImport, planImport, exportFilename, encodeBlobRows,
  photoRowsFor, isThumbRow,
} from './backup.js';
import { normaliseBlobRows } from '../images/photos.js';
import { DEFAULT_SETTINGS, withDefaults } from './settings.js';

const DB_NAME = 'hightide-private';
const DB_VERSION = 2; // v2 adds print_costs and print_vendors
const SETTINGS_KEY = 'settings';

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
      if (event.oldVersion < 1) {
        // Indexes the catalog filters lean on.
        const artworks = request.transaction.objectStore('artworks');
        artworks.createIndex('by_status', 'status');
        artworks.createIndex('by_category', 'category');
        artworks.createIndex('by_visibility', 'visibility');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close the app’s other tabs and try again.'));
  });
  return dbPromise;
}

function tx(db, names, mode) {
  return db.transaction(names, mode);
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
  });
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(store) {
  const db = await openDB();
  return req(tx(db, store, 'readonly').objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await openDB();
  return req(tx(db, store, 'readonly').objectStore(store).get(id));
}

export async function put(store, record) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  t.objectStore(store).put(record);
  await done(t);
  announceChange(store);
  return record;
}

export async function putMany(store, records) {
  if (!records.length) return 0;
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  const os = t.objectStore(store);
  for (const record of records) os.put(record);
  await done(t);
  announceChange(store);
  return records.length;
}

export async function remove(store, id) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
  announceChange(store);
}

export async function clearStore(store) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  t.objectStore(store).clear();
  await done(t);
}

export async function count(store) {
  const db = await openDB();
  return req(tx(db, store, 'readonly').objectStore(store).count());
}

// --- change notification ---------------------------------------------------
//
// Auto-sync needs to know when something was edited. Subscribers are told the
// store's name and nothing else; the debounce and the deciding live in sync.
// Writes made *by* a pull are suppressed, or applying one would immediately
// schedule a push of what was just pulled.

const changeListeners = new Set();
let suppressed = 0;

export function onChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function announceChange(store) {
  if (suppressed > 0) return;
  for (const listener of changeListeners) {
    try { listener(store); } catch (err) { console.error(err); }
  }
}

/** Run a write that must not count as a local edit. */
export async function withoutChangeEvents(fn) {
  suppressed += 1;
  try { return await fn(); } finally { suppressed -= 1; }
}

// --- device-local state (`meta`) -------------------------------------------
//
// The `meta` store is not in STORES, so it is never exported, never merged and
// never synced. That is exactly where the GitHub token belongs: it is this
// device's credential, and pushing it to the repository would commit a secret
// to a place designed to be shared.

export async function getMeta(key) {
  const db = await openDB();
  return req(tx(db, 'meta', 'readonly').objectStore('meta').get(key));
}

export async function setMeta(key, value) {
  const db = await openDB();
  const t = tx(db, 'meta', 'readwrite');
  t.objectStore('meta').put(value, key);
  await done(t);
  return value;
}

export async function deleteMeta(key) {
  const db = await openDB();
  const t = tx(db, 'meta', 'readwrite');
  t.objectStore('meta').delete(key);
  await done(t);
}

// --- settings -------------------------------------------------------------

export async function loadSettings() {
  const db = await openDB();
  const stored = await req(tx(db, 'meta', 'readonly').objectStore('meta').get(SETTINGS_KEY));
  return withDefaults(stored ?? {});
}

export async function saveSettings(settings) {
  const db = await openDB();
  const t = tx(db, 'meta', 'readwrite');
  t.objectStore('meta').put(settings, SETTINGS_KEY);
  await done(t);
  return settings;
}

export async function patchSettings(patch) {
  const current = await loadSettings();
  return saveSettings({ ...current, ...patch });
}

// --- persistence (§4.2) ---------------------------------------------------

export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  const already = await navigator.storage.persisted?.();
  if (already) return { supported: true, persisted: true, alreadyGranted: true };
  const persisted = await navigator.storage.persist();
  return { supported: true, persisted };
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota, pct: quota ? Math.round((usage / quota) * 100) : null };
}

// --- export / import ------------------------------------------------------

export async function readEverything({ encodePhotos = false, photos = 'all' } = {}) {
  const data = { settings: await loadSettings() };
  for (const store of STORES) {
    const rows = await getAll(store);
    if (!BLOB_STORES.includes(store)) { data[store] = rows; continue; }
    // Narrow before encoding, not after: base64'ing megabytes only to throw
    // them away is the difference between a slow export and a stalled tab.
    const wanted = photoRowsFor(photos, rows);
    data[store] = encodePhotos ? await encodeBlobRows(wanted) : wanted;
  }
  return data;
}

export async function exportAll({ photos = 'all' } = {}) {
  const mode = photos === true ? 'all' : photos === false ? 'none' : photos;
  const data = await readEverything({ encodePhotos: mode !== 'none', photos: mode });
  const payload = buildExport(data, { photos: mode });
  const json = JSON.stringify(payload, null, 2);
  return {
    payload,
    filename: exportFilename(new Date(), { photos: mode }),
    json,
    bytes: new Blob([json]).size,
  };
}

/** What an export would weigh, without writing one. */
export async function exportSize() {
  const blobs = await getAll('images_blobs');
  const bytes = (rows) => Math.round(rows.reduce((t, r) => t + (r.blob?.size ?? 0), 0) * 4 / 3);
  const thumbs = blobs.filter(isThumbRow);
  return {
    // One photograph is two rows, a web copy and a thumbnail.
    photos: thumbs.length,
    rows: blobs.length,
    // base64 costs about a third again on top of the raw bytes.
    photoBytes: bytes(blobs),
    thumbBytes: bytes(thumbs),
  };
}

/** Read a file and work out what importing it would do — no writes. */
export async function previewImport(text, mode = 'merge') {
  const incoming = parseImport(text);
  const current = await readEverything();
  return { incoming, plan: planImport(current, incoming, { mode }) };
}

export async function applyImport(plan) {
  return withoutChangeEvents(() => applyImportNow(plan));
}

async function applyImportNow(plan) {
  for (const store of STORES) {
    let rows = plan.stores[store]?.rows ?? [];
    // An export written before blob ids were namespaced is still a valid
    // backup. Each row says which artwork it belongs to, so the right key can
    // be rebuilt on the way in — which is what lets an old file restore a
    // piece whose pixels a collision overwrote.
    if (BLOB_STORES.includes(store)) rows = normaliseBlobRows(rows);
    if (plan.mode === 'replace') await clearStore(store);
    await putMany(store, rows);
  }
  if (plan.settings) await saveSettings(withDefaults(plan.settings));
  return plan;
}

// --- seeding --------------------------------------------------------------

/**
 * Load Appendix A. Only fills empty stores, so it can never overwrite real
 * work — re-running it on a populated catalog is a no-op.
 */
export async function seedIfEmpty() {
  const { SEED_ARTWORKS, SEED_LISTINGS, SEED_BACKLOG } = await import('./seed.js');
  const existing = await count('artworks');
  if (existing > 0) return { seeded: false, existing };
  await putMany('artworks', SEED_ARTWORKS);
  await putMany('listings', SEED_LISTINGS);
  await putMany('backlog', SEED_BACKLOG);
  await patchSettings({ seeded_at: new Date().toISOString() });
  return { seeded: true, artworks: SEED_ARTWORKS.length, listings: SEED_LISTINGS.length };
}

/**
 * Bring a device seeded by an earlier version up to the current Appendix A.
 *
 * A row is safe to refresh only while its `updated_at` is still SEED_AT — that
 * is the seed exactly as it was loaded, never touched. Anything Scott has
 * edited keeps his version and is counted as kept, not overwritten.
 */
export async function refreshSeed() {
  const { SEED_ARTWORKS, SEED_LISTINGS, SEED_BACKLOG, SEED_AT } = await import('./seed.js');
  const report = { added: 0, refreshed: 0, kept: 0 };

  for (const [store, rows] of [
    ['artworks', SEED_ARTWORKS], ['listings', SEED_LISTINGS], ['backlog', SEED_BACKLOG],
  ]) {
    const current = new Map((await getAll(store)).map((row) => [row.id, row]));
    const writes = [];
    for (const row of rows) {
      const mine = current.get(row.id);
      if (!mine) { writes.push(row); report.added += 1; continue; }
      if (mine.updated_at === SEED_AT) {
        if (JSON.stringify(mine) !== JSON.stringify(row)) { writes.push(row); report.refreshed += 1; }
      } else {
        report.kept += 1;
      }
    }
    await putMany(store, writes);
  }
  return report;
}

export { DEFAULT_SETTINGS };
