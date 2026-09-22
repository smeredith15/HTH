// Encryption for the optional sync file (SPEC §4.5).
//
// The private layer never leaves the device in the clear. It is encrypted in
// the browser with AES-GCM under a key derived from a passphrase, and only the
// ciphertext is committed. There is no server and no key escrow: **if the
// passphrase is lost the synced data is unrecoverable**, and anyone who learns
// it can read everything. Security here is exactly as good as the passphrase.
//
// WebCrypto is available in Node 18+ as well as every target browser, so this
// module is testable under `node --test` with no shims.

import { bytesToBase64, base64ToBytes } from './backup.js';

export const SYNC_FORMAT = 'hightide-sync';
export const SYNC_VERSION = 1;

/** §4.5 says no fewer than 600,000. Raising it later is a keyfile rewrite. */
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/** What the keyfile's verifier decrypts to when the passphrase is right. */
const VERIFIER_PLAINTEXT = 'hightide-sync-verifier-v1';

export class WrongPassphraseError extends Error {}

const subtle = () => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('This browser has no WebCrypto, so sync cannot encrypt anything.');
  return c.subtle;
};

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Derive the AES key. This is deliberately slow — 600,000 PBKDF2 rounds is
 * around a second on a phone — so it happens once per session and the key is
 * passed around, never the passphrase.
 */
export async function deriveKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  if (!passphrase) throw new Error('A passphrase is required.');
  const material = await subtle().importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: toBytes(salt), iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  return base64ToBytes(value);
}

/** Encrypt any JSON-serialisable value. A fresh IV every time — GCM demands it. */
export async function encryptJSON(key, value) {
  const iv = randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const buffer = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    cipher: 'AES-GCM',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(buffer)),
  };
}

export async function decryptJSON(key, envelope) {
  if (!isEnvelope(envelope)) throw new Error('That file is not a High Tide sync file.');
  if (envelope.version > SYNC_VERSION) {
    throw new Error(`That sync file was written by a newer version (${envelope.version}). Update this device first.`);
  }
  let buffer;
  try {
    buffer = await subtle().decrypt(
      { name: 'AES-GCM', iv: toBytes(envelope.iv) }, key, toBytes(envelope.ciphertext),
    );
  } catch {
    // GCM fails closed: a wrong key and a tampered file are indistinguishable,
    // and both mean the same thing here — do not trust these bytes.
    throw new WrongPassphraseError('Wrong passphrase, or the file has been altered.');
  }
  return JSON.parse(new TextDecoder().decode(buffer));
}

export function isEnvelope(value) {
  return !!value && typeof value === 'object'
    && value.format === SYNC_FORMAT && typeof value.ciphertext === 'string';
}

/**
 * The keyfile holds the salt — which is not secret — and a verifier, so a
 * mistyped passphrase fails in a second instead of halfway through a merge.
 * One salt for the whole repo means one key derivation per session, however
 * many photo bundles get pushed.
 */
export async function newKeyfile(passphrase, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt, iterations);
  return {
    keyfile: {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      kdf: 'PBKDF2-SHA-256',
      iterations,
      salt: bytesToBase64(salt),
      verifier: await encryptJSON(key, VERIFIER_PLAINTEXT),
      created_at: new Date().toISOString(),
    },
    key,
  };
}

/** Derive the key for an existing keyfile, and prove the passphrase is right. */
export async function unlock(passphrase, keyfile) {
  if (!keyfile?.salt) throw new Error('That keyfile is unreadable. Set sync up again.');
  const key = await deriveKey(passphrase, keyfile.salt, keyfile.iterations ?? PBKDF2_ITERATIONS);
  const proof = await decryptJSON(key, keyfile.verifier);
  if (proof !== VERIFIER_PLAINTEXT) throw new WrongPassphraseError('Wrong passphrase.');
  return key;
}
