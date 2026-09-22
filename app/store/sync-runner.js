// The browser half of sync: credentials, the io adapter, and the auto-push
// timer. Everything decidable lives in sync.js; this is the wiring.
//
// Never imported by app/kiosk/ or app/public/ — it reaches into the private
// layer, and tests/kiosk-isolation.test.js enforces that.

import {
  getMeta, setMeta, deleteMeta, readEverything, applyImport, getAll, putMany, onChange,
} from './db.js';
import { encodeBlobRows, decodeBlobRows } from './backup.js';
import { normaliseBlobRows } from '../images/photos.js';
import { createClient } from './github.js';
import { newKeyfile, unlock, WrongPassphraseError } from './crypto.js';
import { sync as runSync, pull as runPull, push as runPush, KEYFILE_PATH } from './sync.js';

const CONFIG_KEY = 'sync_config';
const STATE_KEY = 'sync_state';

/**
 * The derived key lives in memory and nowhere else. §4.5 says the passphrase
 * is never stored; a key sitting in localStorage would be the same thing with
 * an extra step. The cost is re-entering it once per session, which is the
 * right trade for the only secret protecting the whole private layer.
 */
let liveKey = null;
let liveKeyfile = null;

export const BLANK_CONFIG = {
  owner: '', repo: '', branch: 'main', token: '', auto: true,
};

export async function loadConfig() {
  return { ...BLANK_CONFIG, ...(await getMeta(CONFIG_KEY) ?? {}) };
}

export async function saveConfig(patch) {
  const next = { ...(await loadConfig()), ...patch };
  await setMeta(CONFIG_KEY, next);
  return next;
}

export async function forgetConfig() {
  await deleteMeta(CONFIG_KEY);
  await deleteMeta(STATE_KEY);
  lock();
}

export async function readState() {
  return (await getMeta(STATE_KEY)) ?? {};
}

/**
 * Force the next sync to re-upload every photo bundle. The blob ids inside the
 * bundles already on GitHub are the pre-namespace ones; the digests that decide
 * what to send are computed from the records, which did not change, so without
 * this nothing would ever be resent.
 */
export async function writeStateForMigration(patch) {
  return writeState(patch);
}

async function writeState(patch) {
  const next = { ...(await readState()), ...patch };
  await setMeta(STATE_KEY, next);
  return next;
}

export function isUnlocked() {
  return !!liveKey;
}

export function lock() {
  liveKey = null;
  liveKeyfile = null;
}

export async function isConfigured() {
  const config = await loadConfig();
  return !!(config.owner && config.repo && config.token);
}

async function clientFor(config = null) {
  const cfg = config ?? await loadConfig();
  return createClient({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch || 'main', token: cfg.token });
}

/**
 * Unlock this device against the keyfile already in the repository, or write a
 * new one if this is the first device. A new keyfile is written only when there
 * is none: overwriting one would strand every other device's data behind a key
 * nothing can derive any more.
 */
export async function unlockWithPassphrase(passphrase, { create = false } = {}) {
  const client = await clientFor();
  const existing = await client.read(KEYFILE_PATH);

  if (!existing.missing) {
    liveKeyfile = JSON.parse(existing.text);
    liveKey = await unlock(passphrase, liveKeyfile);
    return { created: false };
  }

  if (!create) {
    throw new Error('No keyfile in that repository yet. Set sync up as the first device to create one.');
  }
  const { keyfile, key } = await newKeyfile(passphrase);
  await client.write(KEYFILE_PATH, JSON.stringify(keyfile, null, 2), {
    sha: null,
    message: 'Sync: create the keyfile (salt and verifier only — no private data)',
  });
  liveKeyfile = keyfile;
  liveKey = key;
  return { created: true };
}

/** Whether the repository already has a keyfile, so the UI can ask the right question. */
export async function hasRemoteKeyfile(config = null) {
  const client = await clientFor(config);
  const existing = await client.read(KEYFILE_PATH);
  return !existing.missing;
}

async function io() {
  if (!liveKey) throw new WrongPassphraseError('Enter the sync passphrase first.');
  const client = await clientFor();
  return {
    client,
    key: liveKey,
    readEverything: () => readEverything(),
    applyImport: (plan) => applyImport(plan),
    readState,
    writeState,
    localBlobIds: async () => new Set((await getAll('images_blobs')).map((row) => row.id)),
    readBlobs: async (artworkId) => encodeBlobRows(
      (await getAll('images_blobs')).filter((row) => row.artwork_id === artworkId),
    ),
    // Bundles pushed before the namespace carry flat ids; repair them on the
    // way in rather than letting two pieces fight over one key.
    putBlobs: async (rows) => putMany('images_blobs', normaliseBlobRows(decodeBlobRows(rows))),
  };
}

export async function syncNow(options = {}) {
  return runSync(await io(), options);
}

export async function pullNow(options = {}) {
  return runPull(await io(), options);
}

export async function pushNow(options = {}) {
  return runPush(await io(), options);
}

// --- auto-sync -------------------------------------------------------------
//
// A push per keystroke would be a commit per keystroke. Edits are allowed to
// settle first, and a push already in flight is never doubled up.

export const SETTLE_MS = 20_000;

let timer = null;
let inFlight = false;
let queued = false;
let unsubscribe = null;
const statusListeners = new Set();

export function onSyncStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function announce(status) {
  for (const listener of statusListeners) {
    try { listener(status); } catch (err) { console.error(err); }
  }
}

async function runQueued() {
  if (inFlight) { queued = true; return; }
  inFlight = true;
  announce({ state: 'syncing' });
  try {
    const result = await syncNow();
    await writeState({ last_error: null });
    announce({ state: 'idle', at: new Date().toISOString(), result });
  } catch (err) {
    console.error(err);
    await writeState({ last_error: err.message }).catch(() => {});
    announce({ state: 'error', message: err.message });
  } finally {
    inFlight = false;
    if (queued) { queued = false; schedule(); }
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(runQueued, SETTLE_MS);
  announce({ state: 'pending', dueInMs: SETTLE_MS });
}

/**
 * Start watching for edits. Safe to call more than once — a second call
 * replaces the first subscription rather than stacking another one.
 */
export function startAutoSync() {
  stopAutoSync();
  unsubscribe = onChange(() => { if (liveKey) schedule(); });
  // A push the timer never got to is still owed when the tab goes away.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide);
  }
}

export function stopAutoSync() {
  clearTimeout(timer);
  timer = null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
}

function onHide() {
  if (document.visibilityState === 'hidden' && timer && liveKey) {
    clearTimeout(timer);
    timer = null;
    runQueued();
  }
}

export { WrongPassphraseError };
