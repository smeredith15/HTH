// The private layer (SPEC §4.2): IndexedDB in the admin browser.
//
// Nothing in app/kiosk/ or app/public/ may import this module. §9.2 requires
// that separation and tests/kiosk-isolation.test.js enforces it.

import { STORES, buildExport, parseImport, planImport, exportFilename } from './backup.js';
import { DEFAULT_SETTINGS, withDefaults } from './settings.js';

const DB_NAME = 'hightide-private';
const DB_VERSION = 1;
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
  return record;
}

export async function putMany(store, records) {
  if (!records.length) return 0;
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  const os = t.objectStore(store);
  for (const record of records) os.put(record);
  await done(t);
  return records.length;
}

export async function remove(store, id) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
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

export async function readEverything() {
  const data = { settings: await loadSettings() };
  for (const store of STORES) data[store] = await getAll(store);
  return data;
}

export async function exportAll() {
  const data = await readEverything();
  const payload = buildExport(data);
  return { payload, filename: exportFilename(new Date()), json: JSON.stringify(payload, null, 2) };
}

/** Read a file and work out what importing it would do — no writes. */
export async function previewImport(text, mode = 'merge') {
  const incoming = parseImport(text);
  const current = await readEverything();
  return { incoming, plan: planImport(current, incoming, { mode }) };
}

export async function applyImport(plan) {
  for (const store of STORES) {
    const rows = plan.stores[store]?.rows ?? [];
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

export { DEFAULT_SETTINGS };
