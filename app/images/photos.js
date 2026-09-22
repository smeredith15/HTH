// Photo records on an artwork (SPEC §5.3, §6.2).
//
// The derivatives live as blobs in IndexedDB; the artwork carries only the
// metadata. Phase 4's publish step writes the blobs out to images/<id>/ and
// the paths recorded here are where they will land.

import { put, get, remove, getAll } from '../store/db.js';
import { processPhoto, measureFile, readableBytes } from './resize.js';
import { IMAGE_ROLE, QUALITY_FLAG } from '../store/schema.js';

/**
 * §6.2's checklist, in the order it should be worked through. Every row takes
 * as many photos as you want to give it — the first is the one the checklist
 * counts, the rest sit under it. The process shot is explicitly never
 * required, because §2.1 says documenting process slows the work.
 */
export const PHOTO_CHECKLIST = [
  {
    role: 'straight_on',
    label: 'Straight-on, daylight, plain wall',
    why: 'The reference shot, and what a print gets cropped out of. Without it the piece can never be reproduced.',
    required: true,
  },
  {
    role: 'detail_raking',
    label: 'Raking-light detail',
    why: 'Light across the surface shows the carved depth. Flat light hides the whole technique.',
  },
  {
    role: 'in_room',
    label: 'In a real room',
    why: 'Etsy’s first photo slot. Shoppers need the size in a space they recognise.',
  },
  { role: 'scale', label: 'Scale reference', why: 'Something everyday beside it.' },
  { role: 'back_hardware', label: 'Back and hanging hardware', why: 'Answers “how does it hang?” before it is asked.' },
  { role: 'signature', label: 'Signature', why: 'Evidence it is an original.' },
  {
    role: 'process',
    label: 'Process shot',
    why: 'Only if one already exists. Never go out of your way for this.',
    optional: true,
  },
];

export const SHOOTING_GUIDE = [
  'Open shade or an overcast day. Direct sun blows out the pale wood and fills the carving with hard shadow.',
  'No flash. It flattens the surface and throws the frame’s shadow onto the wall.',
  'Camera square to the centre of the piece, not above or below it.',
  'Use a tripod, or brace the phone against something solid.',
  'Put a sheet of white paper in one frame so the colour can be corrected later.',
  'Move the originals by cable or a cloud drive. Messaging apps recompress them and the resolution is gone for good.',
];

export const QUALITY_FLAG_LABELS = {
  warm_cast: 'Warm colour cast',
  angled: 'Shot at an angle',
  low_res: 'Low resolution',
  compressed: 'Over-compressed',
  blurry: 'Blurry',
  watermark: 'Watermarked',
  broken_composite: 'Broken composite',
  cluttered_background: 'Cluttered background',
};

const blobId = (imageId, kind) => `${imageId}-${kind}`;

export function webPathFor(artworkId, imageId) {
  return `images/${artworkId}/${imageId}.jpg`;
}

export function thumbPathFor(artworkId, imageId) {
  return `images/${artworkId}/${imageId}-thumb.jpg`;
}

/** A readable, stable id: the role, plus a counter when a role repeats. */
export function nextImageId(artwork, role) {
  const base = role || 'photo';
  const taken = new Set((artwork.images ?? []).map((i) => i.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Resize a photo, store the two derivatives, and hand back the image record.
 * The original is never stored — only its pixel dimensions, which are what
 * decide the print-size limit (§5.4).
 */
export async function addPhoto(artwork, file, { role = 'straight_on', alt = null, sourceUrl = null } = {}) {
  const processed = await processPhoto(file);
  const id = nextImageId(artwork, role);

  await put('images_blobs', { id: blobId(id, 'web'), artwork_id: artwork.id, blob: processed.web.blob });
  await put('images_blobs', { id: blobId(id, 'thumb'), artwork_id: artwork.id, blob: processed.thumb.blob });

  const image = {
    id,
    role,
    is_mockup: false,
    web_path: webPathFor(artwork.id, id),
    thumb_path: thumbPathFor(artwork.id, id),
    width_px: processed.web.width,
    height_px: processed.web.height,
    alt,
    // Where the untouched original lives, if anywhere. The app holds a 2,000 px
    // web copy; this is the way back to the file that copy came from.
    source_url: sourceUrl,
    kiosk_order: (artwork.images ?? []).length,
    in_kiosk: true,
    quality_flags: [],
    // Private, and the reason the original's size is worth keeping at all.
    original_width_px: processed.original.width,
    original_height_px: processed.original.height,
    original_bytes: processed.original.bytes,
    original_name: processed.original.name,
    added_at: new Date().toISOString(),
  };

  return { image, processed };
}

export async function removePhoto(artwork, imageId) {
  await remove('images_blobs', blobId(imageId, 'web')).catch(() => {});
  await remove('images_blobs', blobId(imageId, 'thumb')).catch(() => {});
  return { ...artwork, images: (artwork.images ?? []).filter((i) => i.id !== imageId) };
}

export async function blobFor(imageId, kind = 'thumb') {
  const record = await get('images_blobs', blobId(imageId, kind));
  return record?.blob ?? null;
}

/** An object URL for display. The caller revokes it. */
export async function urlFor(imageId, kind = 'thumb') {
  const blob = await blobFor(imageId, kind);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function orphanedBlobs(artworks) {
  const live = new Set();
  for (const artwork of artworks) {
    for (const image of artwork.images ?? []) {
      live.add(blobId(image.id, 'web'));
      live.add(blobId(image.id, 'thumb'));
    }
  }
  return (await getAll('images_blobs')).filter((b) => !live.has(b.id));
}

// --- checklist state -------------------------------------------------------

/**
 * Every checklist row with every photo tagged to it. A role holds as many
 * photos as you give it: three raking details at different angles is a better
 * record than one, and the row counts as done either way. `image` is the first
 * of them, which is what the progress meter and the completeness checks read.
 */
export function checklistFor(artwork) {
  const images = artwork.images ?? [];
  return PHOTO_CHECKLIST.map((item) => {
    const matched = images.filter((i) => i.role === item.role);
    return { ...item, images: matched, image: matched[0] ?? null };
  });
}

/**
 * The one photo that stands for the piece in a list: whatever was deliberately
 * marked primary, else the shot that identifies it fastest. Falls back to the
 * first photo on file, which is only ever an accident of upload order.
 */
const COVER_ORDER = ['primary', 'straight_on', 'in_room', 'scale', 'detail_raking'];

export function coverImage(artwork) {
  const images = artwork?.images ?? [];
  if (!images.length) return null;
  for (const role of COVER_ORDER) {
    const hit = images.find((i) => i.role === role);
    if (hit) return hit;
  }
  return images.find((i) => i.in_kiosk !== false) ?? images[0];
}

/** Photos carrying a role the checklist never asks for — `other` and friends. */
export function unclaimedImages(artwork) {
  const asked = new Set(PHOTO_CHECKLIST.map((c) => c.role));
  return (artwork.images ?? []).filter((i) => !asked.has(i.role));
}

/** Only the shots that matter count towards "done". */
export function checklistProgress(artwork) {
  const rows = checklistFor(artwork).filter((r) => !r.optional);
  const done = rows.filter((r) => r.image).length;
  return { done, total: rows.length, pct: Math.round((done / rows.length) * 100) };
}

export function missingAltText(artwork) {
  return (artwork.images ?? []).filter((i) => !i.alt?.trim());
}

export { readableBytes, measureFile, IMAGE_ROLE, QUALITY_FLAG };
