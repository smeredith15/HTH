// In-browser image processing (SPEC §5.3).
//
// Photographs never leave the device and the original is never kept: a phone
// photo is 3–12 MB and the repo has a 50 MB per-file ceiling (§3). What is
// kept is a 2,000 px web version under 600 KB and a 600 px thumbnail — plus
// the original's pixel dimensions, because that is what decides how large the
// piece can ever be printed (§5.4).

export const WEB_EDGE = 2000;
export const THUMB_EDGE = 600;
export const WEB_TARGET_BYTES = 600 * 1024;
export const START_QUALITY = 0.82;
export const MIN_QUALITY = 0.45;
export const QUALITY_STEP = 0.06;
// When quality alone cannot reach the budget, the long edge gives way rather
// than the image turning to mush. A densely textured photograph — which is
// exactly what scorched and carved wood is — can miss 600 KB at 2,000 px even
// at the lowest quality worth shipping.
export const FALLBACK_EDGES = [1800, 1600, 1400];
export const FALLBACK_QUALITY = 0.72;

/**
 * Fit within `maxEdge` on the long side, keeping the aspect ratio. An image
 * already smaller is left alone rather than enlarged — upscaling a 1,440 px
 * file to 2,000 px would invent detail and make the print-size warning lie.
 */
export function targetSize(width, height, maxEdge) {
  if (!width || !height) return null;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

/** The quality ladder tried when a first encode comes out too large. */
export function qualitySteps(start = START_QUALITY, min = MIN_QUALITY, step = QUALITY_STEP) {
  const steps = [];
  for (let q = start; q >= min - 1e-9; q -= step) steps.push(Math.round(q * 100) / 100);
  return steps;
}

export function isProcessable(file) {
  return !!file && /^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type || '');
}

/** Bytes to something a person can read. */
export function readableBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- browser-only from here ------------------------------------------------

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), type, quality);
  });
}

async function decode(file) {
  // `from-image` applies the EXIF rotation a phone writes, so a portrait photo
  // does not come out on its side.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari has been known to reject the option rather than ignore it.
      return createImageBitmap(file);
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

async function drawTo(source, { width, height }) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Encode at the best quality that still fits the budget, stepping down until
 * it does. Returns the smallest attempt if none fits, because a slightly
 * oversized file beats no file.
 */
export async function encodeWithin(canvas, targetBytes, steps = qualitySteps()) {
  let best = null;
  for (const quality of steps) {
    const blob = await toBlob(canvas, 'image/jpeg', quality);
    if (!best || blob.size < best.blob.size) best = { blob, quality };
    if (blob.size <= targetBytes) return { blob, quality, withinBudget: true };
  }
  return { ...best, withinBudget: false };
}

/**
 * Turn a photo into the two derivatives the app keeps, and report the
 * original's dimensions so they can go into the print-master registry.
 */
export async function processPhoto(file, {
  webEdge = WEB_EDGE, thumbEdge = THUMB_EDGE, targetBytes = WEB_TARGET_BYTES,
} = {}) {
  if (!isProcessable(file)) {
    throw new Error(`${file?.type || 'That file'} is not an image this browser can resize.`);
  }
  const source = await decode(file);
  const original = {
    width: source.width ?? source.naturalWidth,
    height: source.height ?? source.naturalHeight,
    bytes: file.size,
    name: file.name ?? null,
  };

  let webSize = targetSize(original.width, original.height, webEdge);
  let webCanvas = await drawTo(source, webSize);
  let web = await encodeWithin(webCanvas, targetBytes);
  let reducedEdge = null;

  if (!web.withinBudget) {
    for (const edge of FALLBACK_EDGES) {
      if (edge >= Math.max(webSize.width, webSize.height)) continue;
      const smaller = targetSize(original.width, original.height, edge);
      const canvas = await drawTo(source, smaller);
      const attempt = await encodeWithin(canvas, targetBytes, [FALLBACK_QUALITY, ...qualitySteps()]);
      webSize = smaller;
      webCanvas = canvas;
      web = attempt;
      reducedEdge = edge;
      if (attempt.withinBudget) break;
    }
  }

  const thumbSize = targetSize(original.width, original.height, thumbEdge);
  const thumbCanvas = await drawTo(source, thumbSize);
  const thumb = await toBlob(thumbCanvas, 'image/jpeg', 0.78);

  source.close?.();

  return {
    original,
    web: {
      blob: web.blob, ...webSize, bytes: web.blob.size, quality: web.quality,
      withinBudget: web.withinBudget, reducedEdge,
    },
    thumb: { blob: thumb, ...thumbSize, bytes: thumb.size },
  };
}
