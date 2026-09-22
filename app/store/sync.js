// Encrypted sync between devices, with GitHub as the only storage (Phase 7).
//
// There is no backend. Every device holds the whole private layer in its own
// IndexedDB; this module encrypts that layer and commits it to the repository,
// and pulls what the other devices committed. GitHub never sees plaintext.
//
// Two things are split apart because of size. Records — every store except the
// photographs — are one file, a couple of hundred KB for the whole catalog.
// Photographs are a bundle per artwork, pushed only when that piece's photos
// changed, because one file holding all of them would be well over a hundred
// megabytes and would be rewritten every time a price changed.
//
// The functions above the fold are pure and are what the tests drive. The
// orchestration below takes its I/O as an argument for the same reason.

import { STORES, BLOB_STORES, buildExport, planImport } from './backup.js';
import { encryptJSON, decryptJSON, isEnvelope } from './crypto.js';
import { ConflictError } from './github.js';

export const SYNC_DIR = 'data/sync';
export const KEYFILE_PATH = `${SYNC_DIR}/keyfile.json`;
export const RECORDS_PATH = `${SYNC_DIR}/records.enc.json`;
export const photosPath = (artworkId) => `${SYNC_DIR}/photos/${artworkId}.enc.json`;

/** A bundle this big is a sign something has gone wrong, not a photo set. */
export const BUNDLE_WARN_BYTES = 40 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * A short, stable fingerprint of an artwork's photographs. Editing a price must
 * not re-upload 12 MB of pixels, so a push compares this against what it last
 * pushed and skips the bundle when they match. Deliberately not a hash of the
 * bytes: the app never holds the originals, and id + when it was added + how
 * big it was is enough to tell one photo set from another.
 */
export function photoDigest(artwork) {
  const images = artwork?.images ?? [];
  if (!images.length) return null;
  return images
    .map((i) => `${i.id}:${i.added_at ?? ''}:${i.original_bytes ?? ''}`)
    .sort()
    .join('|');
}

/** The blob ids an artwork's images need in order to be viewable. */
export function blobIdsFor(artwork) {
  return (artwork?.images ?? []).flatMap((i) => [`${i.id}-web`, `${i.id}-thumb`]);
}

/** Artworks whose photos have changed since this device last pushed them. */
export function bundlesToPush(artworks, pushed = {}) {
  const out = [];
  for (const artwork of artworks ?? []) {
    const digest = photoDigest(artwork);
    if (!digest) continue;
    if (pushed[artwork.id] === digest) continue;
    out.push({ id: artwork.id, digest });
  }
  return out;
}

/**
 * Artworks this device is missing pixels for. A record can arrive from another
 * device long before its bundle is fetched, and a card with a broken thumbnail
 * is the visible symptom, so this drives the second half of a pull.
 */
export function bundlesToPull(artworks, localBlobIds = []) {
  const have = localBlobIds instanceof Set ? localBlobIds : new Set(localBlobIds);
  const out = [];
  for (const artwork of artworks ?? []) {
    const needed = blobIdsFor(artwork);
    if (!needed.length) continue;
    if (needed.some((id) => !have.has(id))) out.push({ id: artwork.id, missing: needed.filter((i) => !have.has(i)) });
  }
  return out;
}

/** The records half: everything but the pixels. */
export function recordsPayload(data, { exported_at } = {}) {
  return buildExport(data, { photos: false, exported_at });
}

/** One artwork's encoded blob rows, ready to encrypt. */
export function bundlePayload(artworkId, blobRows) {
  return {
    artwork_id: artworkId,
    blobs: (blobRows ?? []).filter((row) => row.artwork_id === artworkId),
  };
}

/**
 * What a pull would do, with the photos left alone. planImport's newest-wins
 * merge is reused wholesale; the only thing added here is that a records file
 * must never be read as "the other device deleted every photograph".
 */
export function planPull(current, incoming) {
  const plan = planImport(current, { ...incoming, photos: false }, { mode: 'merge' });
  return plan;
}

/** A one-line summary for the UI, and for the commit message. */
export function summarisePull(plan) {
  let added = 0;
  let updated = 0;
  for (const store of STORES) {
    if (BLOB_STORES.includes(store)) continue;
    added += plan.stores[store]?.added?.length ?? 0;
    updated += plan.stores[store]?.updated?.length ?? 0;
  }
  return { added, updated, conflicts: plan.conflicts ?? [] };
}

export function commitMessage(kind, detail) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `Sync: ${kind}${detail ? ` (${detail})` : ''} — ${stamp} UTC`;
}

// ---------------------------------------------------------------------------
// Orchestration
//
// `io` is the whole of the outside world: the GitHub client, the derived key,
// and the handful of reads and writes this needs. Passing it in is what makes
// the round trip testable with no network, no token and no browser.
// ---------------------------------------------------------------------------

/**
 * Pull, merge, then push the merged result.
 *
 * Always in that order. Pushing first would overwrite whatever the other
 * device committed since this one last looked, and a lost afternoon of edits
 * is exactly the failure this is meant to prevent.
 */
export async function sync(io, { pushPhotos = true, onProgress = () => {} } = {}) {
  const pulled = await pull(io, { onProgress });
  const pushed = await push(io, { pushPhotos, onProgress });
  return { pulled, pushed };
}

export async function pull(io, { onProgress = () => {} } = {}) {
  const { client, key } = io;
  onProgress('Reading the records file…');
  const remote = await client.read(RECORDS_PATH);
  if (remote.missing) {
    return { records: null, bundles: [], summary: { added: 0, updated: 0, conflicts: [] }, empty: true };
  }

  const envelope = JSON.parse(remote.text);
  if (!isEnvelope(envelope)) throw new Error('The records file on GitHub is not a High Tide sync file.');
  const incoming = await decryptJSON(key, envelope);

  const current = await io.readEverything();
  const plan = planPull(current, incoming);
  const summary = summarisePull(plan);
  await io.applyImport(plan);
  await io.writeState({ records_sha: remote.sha, last_pulled_at: new Date().toISOString() });

  // Records can arrive ahead of pixels. Fetch the bundles this device has no
  // blobs for, so a piece another device photographed shows its photograph.
  const after = await io.readEverything();
  const wanted = bundlesToPull(after.artworks, await io.localBlobIds());
  const fetched = [];
  for (const { id } of wanted) {
    onProgress(`Fetching photos for ${id}…`);
    const file = await client.read(photosPath(id));
    if (file.missing) continue;
    const bundle = await decryptJSON(key, JSON.parse(file.text));
    await io.putBlobs(bundle.blobs ?? []);
    fetched.push({ id, blobs: (bundle.blobs ?? []).length, sha: file.sha });
  }
  if (fetched.length) {
    const shas = { ...(await io.readState()).photo_sha ?? {} };
    for (const f of fetched) shas[f.id] = f.sha;
    await io.writeState({ photo_sha: shas });
  }

  return { records: remote.sha, bundles: fetched, summary, empty: false };
}

export async function push(io, { pushPhotos = true, onProgress = () => {} } = {}) {
  const { client, key } = io;
  const state = await io.readState();

  onProgress('Encrypting the records…');
  const data = await io.readEverything();
  const payload = recordsPayload(data);
  const envelope = await encryptJSON(key, payload);
  const counts = `${(data.artworks ?? []).length} pieces`;

  const records = await writeWithRetry(
    client, RECORDS_PATH, JSON.stringify(envelope), state.records_sha,
    commitMessage('records', counts),
  );
  await io.writeState({ records_sha: records.sha, last_pushed_at: new Date().toISOString() });

  if (!pushPhotos) return { records: records.sha, bundles: [], skipped: 'photos' };

  const pending = bundlesToPush(data.artworks, state.pushed ?? {});
  const pushedDigests = { ...(state.pushed ?? {}) };
  const shas = { ...(state.photo_sha ?? {}) };
  const sent = [];
  const skipped = [];

  for (const { id, digest } of pending) {
    onProgress(`Encrypting photos for ${id}…`);
    const blobs = await io.readBlobs(id);
    if (!blobs.length) continue;
    const bundle = await encryptJSON(key, bundlePayload(id, blobs));
    const text = JSON.stringify(bundle);
    if (text.length > BUNDLE_WARN_BYTES) {
      skipped.push({ id, bytes: text.length, reason: 'too large to commit' });
      continue;
    }
    const written = await writeWithRetry(client, photosPath(id), text, shas[id], commitMessage('photos', id));
    shas[id] = written.sha;
    pushedDigests[id] = digest;
    sent.push({ id, bytes: text.length });
  }

  await io.writeState({ pushed: pushedDigests, photo_sha: shas });
  return { records: records.sha, bundles: sent, skipped };
}

/**
 * A stale sha means the file moved on between reading and writing — usually
 * this device's own record of it is simply old. Re-read and try once more;
 * a second failure is a real conflict and the caller should pull.
 */
async function writeWithRetry(client, path, text, sha, message) {
  try {
    return await client.write(path, text, { sha, message });
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    const fresh = await client.read(path);
    return client.write(path, text, { sha: fresh.missing ? null : fresh.sha, message });
  }
}
