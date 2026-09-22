import test from 'node:test';
import assert from 'node:assert/strict';
import {
  photoDigest, blobIdsFor, bundlesToPush, bundlesToPull, recordsPayload, bundlePayload,
  planPull, summarisePull, commitMessage, sync, pull, push,
  RECORDS_PATH, KEYFILE_PATH, photosPath,
} from '../app/store/sync.js';
import {
  newKeyfile, unlock, encryptJSON, decryptJSON, isEnvelope, WrongPassphraseError,
  PBKDF2_ITERATIONS,
} from '../app/store/crypto.js';
import { createClient, encodeBase64, decodeBase64, ConflictError, EmptyRepoError, GitHubError } from '../app/store/github.js';
import { newArtwork } from '../app/store/schema.js';
import { STORES } from '../app/store/backup.js';

// --- crypto (§4.5) ---------------------------------------------------------

test('the spec floor of 600,000 PBKDF2 iterations is the default', () => {
  assert.equal(PBKDF2_ITERATIONS, 600_000);
});

test('a keyfile round-trips the passphrase and rejects the wrong one', async () => {
  const { keyfile, key } = await newKeyfile('a long enough passphrase');
  const envelope = await encryptJSON(key, { secret: 'the golf bag sold for $495' });
  assert.ok(isEnvelope(envelope));
  assert.ok(!JSON.stringify(envelope).includes('golf bag'), 'the plaintext must not survive in the envelope');

  const again = await unlock('a long enough passphrase', keyfile);
  assert.deepEqual(await decryptJSON(again, envelope), { secret: 'the golf bag sold for $495' });

  await assert.rejects(() => unlock('a long enough passphras', keyfile), WrongPassphraseError);
});

// The keyfile is committed to the repository, so it has to be safe to read.
test('the keyfile carries a salt and a verifier and no passphrase', async () => {
  const { keyfile } = await newKeyfile('hunter2 but longer');
  assert.ok(keyfile.salt);
  assert.ok(isEnvelope(keyfile.verifier));
  assert.ok(!JSON.stringify(keyfile).toLowerCase().includes('hunter2'));
});

test('every encryption gets its own IV', async () => {
  const { key } = await newKeyfile('pass phrase for ivs');
  const a = await encryptJSON(key, { same: true });
  const b = await encryptJSON(key, { same: true });
  assert.notEqual(a.iv, b.iv, 'a reused IV breaks AES-GCM outright');
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('a tampered ciphertext is refused, not silently decrypted', async () => {
  const { keyfile, key } = await newKeyfile('another passphrase here');
  const envelope = await encryptJSON(key, { price: 495 });
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 0xff;
  const tampered = { ...envelope, ciphertext: bytes.toString('base64') };
  await assert.rejects(() => decryptJSON(key, tampered), WrongPassphraseError);
  assert.ok(keyfile.iterations >= 600_000);
});

// --- digests and what to send ---------------------------------------------

test('the photo digest changes with the photos and not with anything else', () => {
  const art = newArtwork({ title: 'Vintage golf bag', asking_price: 495, images: [
    { id: 'straight_on', added_at: '2026-09-22T19:11:00.503Z', original_bytes: 151118 },
  ] });
  const before = photoDigest(art);
  assert.equal(photoDigest({ ...art, asking_price: 525, title: 'renamed' }), before,
    'a price edit must not re-upload the pixels');
  assert.notEqual(photoDigest({ ...art, images: [...art.images, { id: 'in_room', added_at: 'x', original_bytes: 1 }] }), before);
  assert.equal(photoDigest(newArtwork({ title: 'no photos' })), null);
});

test('the digest does not depend on the order photos are listed in', () => {
  const a = { images: [{ id: 'a', added_at: '1', original_bytes: 1 }, { id: 'b', added_at: '2', original_bytes: 2 }] };
  const b = { images: [a.images[1], a.images[0]] };
  assert.equal(photoDigest(a), photoDigest(b));
});

test('only artworks whose photos changed are queued for upload', () => {
  const arts = [
    { id: 'golf-bag', images: [{ id: 'x', added_at: '1', original_bytes: 2 }] },
    { id: 'moose', images: [{ id: 'y', added_at: '1', original_bytes: 2 }] },
    { id: 'no-photos', images: [] },
  ];
  const pushed = { 'golf-bag': photoDigest(arts[0]) };
  assert.deepEqual(bundlesToPush(arts, pushed).map((b) => b.id), ['moose']);
  assert.deepEqual(bundlesToPush(arts, {}).map((b) => b.id), ['golf-bag', 'moose']);
});

test('an artwork whose pixels are missing locally is queued for download', () => {
  const arts = [{ id: 'golf-bag', images: [{ id: 'straight_on' }, { id: 'in_room' }] }];
  assert.deepEqual(blobIdsFor(arts[0]), ['straight_on-web', 'straight_on-thumb', 'in_room-web', 'in_room-thumb']);
  assert.deepEqual(bundlesToPull(arts, []).map((b) => b.id), ['golf-bag']);
  assert.deepEqual(bundlesToPull(arts, blobIdsFor(arts[0])), [], 'nothing to fetch once they are all here');
  // A half-fetched bundle still counts as missing.
  assert.equal(bundlesToPull(arts, ['straight_on-web', 'straight_on-thumb']).length, 1);
});

test('the records half carries every store except the pixels', () => {
  const payload = recordsPayload({ artworks: [{ id: 'a' }], images_blobs: [{ id: 'a-web' }] });
  assert.equal(payload.photos, false);
  assert.deepEqual(payload.images_blobs, []);
  assert.deepEqual(payload.artworks, [{ id: 'a' }]);
  for (const store of STORES) assert.ok(store in payload, `${store} is missing from the records file`);
});

test('a bundle carries only its own artwork', () => {
  const rows = [
    { id: 'a-web', artwork_id: 'golf-bag' },
    { id: 'b-web', artwork_id: 'moose' },
  ];
  assert.deepEqual(bundlePayload('golf-bag', rows).blobs, [rows[0]]);
});

// A records-only file says nothing about photographs. Reading it as "they
// deleted everything" would wipe the pixels on every pull.
test('a pull never treats a records file as a photo deletion', () => {
  const current = { artworks: [], images_blobs: [{ id: 'keep-me' }] };
  const plan = planPull(current, recordsPayload({ artworks: [{ id: 'a', updated_at: '2026-01-01T00:00:00Z' }] }));
  assert.deepEqual(plan.stores.images_blobs.rows, [{ id: 'keep-me' }]);
  assert.equal(summarisePull(plan).added, 1);
});

test('the commit message says what it carried', () => {
  assert.match(commitMessage('records', '61 pieces'), /^Sync: records \(61 pieces\) — \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
});

// --- a fake GitHub ---------------------------------------------------------

/** Just enough of the Contents API to drive the round trip, with no network. */
function fakeGitHub({ inlineLimit = Infinity } = {}) {
  const files = new Map();
  let nextSha = 1;
  const repo = {
    files,
    calls: [],
    fetch: async (url, init = {}) => {
      repo.calls.push(`${init.method ?? 'GET'} ${url}`);
      const contents = url.match(/\/contents\/(.+?)(\?|$)/);
      const blob = url.match(/\/git\/blobs\/(.+)$/);
      const json = (status, body) => ({
        ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body),
      });

      if (blob) {
        const found = [...files.values()].find((f) => f.sha === blob[1]);
        if (!found) return json(404, {});
        return json(200, { sha: found.sha, content: encodeBase64(found.text), encoding: 'base64' });
      }

      const path = decodeURIComponent(contents[1]).split('/').map(decodeURIComponent).join('/');
      if ((init.method ?? 'GET') === 'GET') {
        const found = files.get(path);
        if (!found) return json(404, {});
        const big = found.text.length > inlineLimit;
        return json(200, {
          sha: found.sha, size: found.text.length,
          content: big ? '' : encodeBase64(found.text),
          encoding: big ? 'none' : 'base64',
        });
      }

      const body = JSON.parse(init.body);
      const existing = files.get(path);
      if (existing && existing.sha !== body.sha) return json(409, { message: 'sha mismatch' });
      if (!existing && body.sha) return json(422, { message: 'no such file' });
      const sha = `sha${nextSha += 1}`;
      files.set(path, { sha, text: decodeBase64(body.content) });
      repo.lastMessage = body.message;
      return json(200, { content: { sha }, commit: { sha: `commit${nextSha}` } });
    },
  };
  return repo;
}

/** A device: its own IndexedDB-shaped state, and the io adapter over it. */
function fakeDevice(client, key, data = {}) {
  const store = {
    settings: {},
    ...Object.fromEntries(STORES.map((s) => [s, []])),
    ...data,
  };
  let state = {};
  return {
    store,
    io: {
      client,
      key,
      readEverything: async () => structuredClone(store),
      applyImport: async (plan) => {
        for (const s of STORES) store[s] = plan.stores[s]?.rows ?? [];
        if (plan.settings) store.settings = plan.settings;
      },
      readState: async () => state,
      writeState: async (patch) => { state = { ...state, ...patch }; return state; },
      localBlobIds: async () => new Set(store.images_blobs.map((r) => r.id)),
      readBlobs: async (id) => store.images_blobs.filter((r) => r.artwork_id === id),
      putBlobs: async (rows) => {
        const byId = new Map(store.images_blobs.map((r) => [r.id, r]));
        for (const row of rows) byId.set(row.id, row);
        store.images_blobs = [...byId.values()];
      },
    },
  };
}

const art = (id, patch = {}) => newArtwork({
  id, title: id, updated_at: '2026-09-22T12:00:00.000Z', ...patch,
});

// --- the round trip --------------------------------------------------------

test('a piece made on one device arrives on the other', async () => {
  const hub = fakeGitHub();
  const { key } = await newKeyfile('the studio passphrase');
  const mk = () => createClient({ owner: 'smeredith15', repo: 'HTH', token: 'ghp_x', fetch: hub.fetch });

  const phone = fakeDevice(mk(), key, { artworks: [art('golf-bag', { asking_price: 495 })] });
  const desktop = fakeDevice(mk(), key);

  await sync(phone.io);
  assert.ok(hub.files.has(RECORDS_PATH));
  assert.ok(!hub.files.get(RECORDS_PATH).text.includes('golf-bag'), 'GitHub never sees a plaintext id');

  await sync(desktop.io);
  assert.deepEqual(desktop.store.artworks.map((a) => a.id), ['golf-bag']);
  assert.equal(desktop.store.artworks[0].asking_price, 495);
});

test('the newer edit wins, whichever device made it', async () => {
  const hub = fakeGitHub();
  const { key } = await newKeyfile('the studio passphrase');
  const mk = () => createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });

  const phone = fakeDevice(mk(), key, { artworks: [art('golf-bag', { asking_price: 495 })] });
  const desktop = fakeDevice(mk(), key);
  await sync(phone.io);
  await sync(desktop.io);

  desktop.store.artworks = [art('golf-bag', { asking_price: 525, updated_at: '2026-09-23T09:00:00.000Z' })];
  await sync(desktop.io);
  await sync(phone.io);
  assert.equal(phone.store.artworks[0].asking_price, 525, 'the later edit reached the first device');

  // And the older one does not travel backwards.
  phone.store.artworks = [art('golf-bag', { asking_price: 400, updated_at: '2026-09-20T09:00:00.000Z' })];
  await sync(phone.io);
  assert.equal(phone.store.artworks[0].asking_price, 525);
});

test('photographs travel as their own bundle, and only once', async () => {
  const hub = fakeGitHub();
  const { key } = await newKeyfile('the studio passphrase');
  const mk = () => createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });

  const images = [{ id: 'straight_on', added_at: '2026-09-22T19:11:00Z', original_bytes: 151118 }];
  const phone = fakeDevice(mk(), key, {
    artworks: [art('golf-bag', { images })],
    images_blobs: [
      { id: 'straight_on-web', artwork_id: 'golf-bag', blob: { __blob_base64: true, data: 'AAAA', type: 'image/jpeg', size: 3 } },
      { id: 'straight_on-thumb', artwork_id: 'golf-bag', blob: { __blob_base64: true, data: 'BBBB', type: 'image/jpeg', size: 3 } },
    ],
  });

  const first = await push(phone.io);
  assert.deepEqual(first.bundles.map((b) => b.id), ['golf-bag']);
  assert.ok(hub.files.has(photosPath('golf-bag')));

  // Nothing about the photos changed, so nothing is re-uploaded.
  const second = await push(phone.io);
  assert.deepEqual(second.bundles, []);

  // A price edit is still not a photo change.
  phone.store.artworks = [art('golf-bag', { images, asking_price: 525, updated_at: '2026-09-24T00:00:00Z' })];
  assert.deepEqual((await push(phone.io)).bundles, []);

  // The other device gets the records and then goes and fetches the pixels.
  const desktop = fakeDevice(mk(), key);
  await pull(desktop.io);
  assert.equal(desktop.store.images_blobs.length, 2);
  assert.deepEqual(desktop.store.images_blobs.map((r) => r.id).sort(), ['straight_on-thumb', 'straight_on-web']);
});

// Photo bundles run to megabytes, and GitHub stops inlining content at 1 MB.
test('a bundle too big to inline is fetched through the blob API instead', async () => {
  const hub = fakeGitHub({ inlineLimit: 64 });
  const { key } = await newKeyfile('the studio passphrase');
  const mk = () => createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });

  const images = [{ id: 'straight_on', added_at: 'x', original_bytes: 1 }];
  const phone = fakeDevice(mk(), key, {
    artworks: [art('golf-bag', { images })],
    images_blobs: [{ id: 'straight_on-web', artwork_id: 'golf-bag', blob: { __blob_base64: true, data: 'A'.repeat(500), type: 'image/jpeg', size: 300 } }],
  });
  await push(phone.io);

  const desktop = fakeDevice(mk(), key);
  await pull(desktop.io);
  assert.equal(desktop.store.images_blobs.length, 1);
  assert.ok(hub.calls.some((c) => c.includes('/git/blobs/')), 'the blob API was used for the oversized file');
});

test('a push always pulls first, so neither device is clobbered', async () => {
  const hub = fakeGitHub();
  const { key } = await newKeyfile('the studio passphrase');
  const mk = () => createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });

  const phone = fakeDevice(mk(), key, { artworks: [art('golf-bag')] });
  const desktop = fakeDevice(mk(), key, { artworks: [art('moose')] });

  await sync(phone.io);
  await sync(desktop.io);
  // The desktop never saw the golf bag before this sync, and still has it now.
  assert.deepEqual(desktop.store.artworks.map((a) => a.id).sort(), ['golf-bag', 'moose']);

  await sync(phone.io);
  assert.deepEqual(phone.store.artworks.map((a) => a.id).sort(), ['golf-bag', 'moose']);
});

test('a stale sha is retried once against the current file', async () => {
  const hub = fakeGitHub();
  const { key } = await newKeyfile('the studio passphrase');
  const mk = () => createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });

  const phone = fakeDevice(mk(), key, { artworks: [art('golf-bag')] });
  await sync(phone.io);

  // Another device commits behind this one's back, invalidating its sha.
  const other = fakeDevice(mk(), key, { artworks: [art('moose')] });
  await sync(other.io);

  phone.store.artworks = [art('golf-bag', { asking_price: 525, updated_at: '2026-09-25T00:00:00Z' })];
  await push(phone.io);
  assert.ok(hub.calls.filter((c) => c.startsWith('PUT')).length >= 3);
  const desktop = fakeDevice(mk(), key);
  await pull(desktop.io);
  assert.equal(desktop.store.artworks.find((a) => a.id === 'golf-bag').asking_price, 525);
});

test('an empty repository is a clean first run, not an error', async () => {
  const hub = fakeGitHub();
  const { key } = await newKeyfile('the studio passphrase');
  const client = createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });
  const device = fakeDevice(client, key, { artworks: [art('golf-bag')] });
  const result = await pull(device.io);
  assert.equal(result.empty, true);
  assert.deepEqual(device.store.artworks.map((a) => a.id), ['golf-bag'], 'nothing was wiped');
});

test('the wrong passphrase cannot read another device’s file', async () => {
  const hub = fakeGitHub();
  const mk = () => createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });
  const { key } = await newKeyfile('the right passphrase here');
  await push(fakeDevice(mk(), key, { artworks: [art('golf-bag')] }).io);

  const { key: wrong } = await newKeyfile('a completely different one');
  await assert.rejects(() => pull(fakeDevice(mk(), wrong).io), WrongPassphraseError);
});

// --- the client ------------------------------------------------------------

test('a missing file is reported, not thrown', async () => {
  const hub = fakeGitHub();
  const client = createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });
  assert.equal((await client.read(KEYFILE_PATH)).missing, true);
});

test('GitHub’s refusals are turned into something readable', async () => {
  const status = (code) => createClient({
    owner: 'o', repo: 'r', token: 't',
    fetch: async () => ({ ok: false, status: code, text: async () => 'nope', json: async () => ({}) }),
  });
  await assert.rejects(() => status(401).read('x'), /token/i);
  await assert.rejects(() => status(403).read('x'), /Contents: read and write/);
  await assert.rejects(() => status(409).write('x', 'y', { message: 'm' }), ConflictError);
  await assert.rejects(() => status(500).read('x'), GitHubError);
});

test('a path with a space or an accent survives the URL', async () => {
  const hub = fakeGitHub();
  const client = createClient({ owner: 'o', repo: 'r', token: 't', fetch: hub.fetch });
  await client.write('data/sync/photos/café bag.enc.json', 'hello', { message: 'm' });
  assert.equal((await client.read('data/sync/photos/café bag.enc.json')).text, 'hello');
});

// --- the token must never travel -------------------------------------------
//
// The token is this device's credential for the repository sync writes to.
// Committing it there would be handing over the key with the lock.

test('the meta store, where the token lives, is not a synced store', () => {
  assert.ok(!STORES.includes('meta'), 'meta must stay out of export and sync');
});

test('nothing resembling a token can reach the records file', () => {
  // readEverything only reads STORES plus settings, so a token in meta has no
  // path into this payload. Assert the shape rather than trusting that.
  const data = {
    settings: { shop_url: 'https://etsy.com/shop/HighTideHandmade25' },
    artworks: [{ id: 'golf-bag' }],
  };
  const text = JSON.stringify(recordsPayload(data));
  assert.ok(!text.includes('github_pat'));
  assert.ok(!text.includes('token'));
  assert.deepEqual(Object.keys(recordsPayload(data)).filter((k) => /token|meta/i.test(k)), []);
});

test('the sync files all live under one directory', () => {
  assert.ok(RECORDS_PATH.startsWith('data/sync/'));
  assert.ok(KEYFILE_PATH.startsWith('data/sync/'));
  assert.ok(photosPath('golf-bag').startsWith('data/sync/photos/'));
  assert.equal(photosPath('golf-bag'), 'data/sync/photos/golf-bag.enc.json');
});

// The repository you are told to make for sync is brand new, so this is the
// very first thing anyone will hit. GitHub reports it as a 409, the same status
// as a stale sha, and "pull first" is useless advice for an empty repository.
test('an empty repository says what to do about it, not "pull first"', async () => {
  const client = createClient({
    owner: 'o', repo: 'hth-sync', token: 't',
    fetch: async () => ({
      ok: false, status: 409,
      text: async () => JSON.stringify({ message: 'Git Repository is empty.' }),
      json: async () => ({}),
    }),
  });
  await assert.rejects(
    () => client.write(RECORDS_PATH, 'x', { message: 'm' }),
    (err) => {
      assert.ok(err instanceof EmptyRepoError);
      assert.ok(!(err instanceof ConflictError), 'it must not be retried as a conflict');
      assert.match(err.message, /Add a README/);
      return true;
    },
  );
});
