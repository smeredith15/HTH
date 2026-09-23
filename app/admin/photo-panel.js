// The photo checklist on an artwork (SPEC §6.2).

import { el, mount, label, pill, toast, confirmDialog, field, select, rerender } from '../ui/dom.js';
import { saveArtwork } from '../store/artworks.js';
import {
  SHOOTING_GUIDE, QUALITY_FLAG_LABELS, checklistFor, checklistProgress,
  addPhoto, removePhoto, urlFor, readableBytes, unclaimedImages,
} from '../images/photos.js';
import { IMAGE_ROLE, QUALITY_FLAG, printLimits, imageLongEdge } from '../store/schema.js';
import { suggestAlt } from '../store/autofill.js';
import { openPhoto } from './photo-viewer.js';

// Object URLs created for the thumbnails on screen, revoked when the panel is
// rebuilt, so a long session does not leak every photo it has ever shown.
let liveUrls = [];
function trackUrl(url) { liveUrls.push(url); return url; }
function releaseUrls() {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls = [];
}

export function photoPanel(artwork, onChange) {
  const host = el('section', { class: 'panel' });
  draw(host, artwork, onChange);
  return host;
}

async function draw(host, artwork, onChange) {
  releaseUrls();
  const progress = checklistProgress(artwork);
  const rows = checklistFor(artwork);
  const extras = unclaimedImages(artwork);

  mount(host,
    el('div', { class: 'view-head tight' },
      el('div', null,
        el('h2', null, 'Photographs'),
        el('p', { class: 'muted', text: `${progress.done} of ${progress.total} shots that matter` })),
      addButton(artwork, onChange)),

    el('div', { class: 'meter' }, el('div', { class: 'meter-fill', style: { width: `${progress.pct}%` } })),

    el('details', { class: 'filter-drawer' },
      el('summary', null, 'How to shoot these'),
      el('ul', { class: 'guide-list' }, SHOOTING_GUIDE.map((line) => el('li', { text: line })))),

    el('ul', { class: 'photo-list' }, rows.map((row) => photoRow(artwork, row, onChange))),

    // Photos tagged with a role the checklist never asks for. Kept apart so
    // the six shots that matter stay readable however many extras pile up —
    // but built by the same function, because hand-rolling a second copy of
    // this markup is exactly how these rows ended up squeezed into the 84 px
    // thumbnail column.
    extras.length
      ? el('div', { class: 'extra-photos' },
        el('h3', null, `Other photographs (${extras.length})`),
        el('ul', { class: 'photo-list' },
          extraRows(extras).map((row) => photoRow(artwork, row, onChange))))
      : null,

    (artwork.images ?? []).length
      ? el('p', { class: 'hint' }, 'Originals are never kept. Each photo is stored as a 2,000 px web version and a 600 px thumbnail, and the original’s pixel size is kept so the app can say how large it prints.')
      : null);
}

/** Extras grouped by their role, so they arrive shaped like a checklist row. */
function extraRows(extras) {
  const byRole = new Map();
  for (const image of extras) {
    if (!byRole.has(image.role)) byRole.set(image.role, []);
    byRole.get(image.role).push(image);
  }
  return [...byRole.entries()].map(([role, images]) => ({
    role,
    label: label(role),
    why: 'Not one of the six shots that matter — kept, and yours to use.',
    images,
    optional: true,
  }));
}

/**
 * One row, with every photo tagged to it. A role is not a single slot: three
 * raking details at different angles are all worth keeping, and the row counts
 * as done as soon as the first one lands.
 *
 * Every row on this screen comes through here, checklist or extra. The two
 * used to be built separately and the extras' li was missing `stacked`, which
 * left a whole photo's controls rendering inside an 84 px column.
 */
function photoRow(artwork, row, onChange) {
  const images = row.images ?? (row.image ? [row.image] : []);
  const heading = el('div', { class: 'row tight' },
    el('strong', { text: row.label }),
    row.required ? pill('needed for a print', 'warn') : null,
    images.length > 1 ? pill(`${images.length} photos`, 'muted') : null,
    row.optional && !images.length ? pill('never required', 'muted') : null);

  if (!images.length) {
    return el('li', null,
      el('div', { class: 'photo-thumb empty', 'aria-hidden': 'true' }),
      el('div', { class: 'photo-body' },
        heading,
        el('p', { class: 'hint', text: row.why })),
      el('label', { class: 'btn ghost small' }, 'Add',
        fileInput(artwork, row.role, onChange)));
  }

  return el('li', { class: 'has-photo stacked' },
    el('div', { class: 'photo-group' },
      heading,
      el('p', { class: 'hint', text: row.why }),
      images.map((image) => imageBlock(artwork, image, row.label, onChange)),
      el('label', { class: 'btn ghost small' }, 'Add more to this shot',
        fileInput(artwork, row.role, onChange))));
}

/** A single photograph: thumbnail, and everything editable about it. */
function imageBlock(artwork, image, rowLabel, onChange) {
  // The thumbnail is a button: 64 px is enough to recognise a photo and not
  // enough to judge one.
  const thumb = el('button', {
    class: 'photo-thumb', type: 'button',
    'aria-label': `View the ${rowLabel.toLowerCase()} photograph full size`,
    onClick: () => openPhoto(artwork, image),
  });
  urlFor(artwork.id, image.id, 'thumb').then((url) => {
    if (url) mount(thumb, el('img', { src: trackUrl(url), alt: image.alt || rowLabel, loading: 'lazy' }));
    else mount(thumb, el('span', { class: 'muted small' }, 'missing'));
  });

  return el('div', { class: 'photo-item' },
    thumb,
    el('div', { class: 'photo-body' }, imageControls(artwork, image, onChange)));
}

function imageControls(artwork, image, onChange) {
  const altInput = el('input', {
    type: 'text', value: image.alt ?? '', placeholder: 'Describe it for someone who cannot see it',
    // The alt-text warning and the completeness meter live outside this panel,
    // so the screen does get rebuilt — but the caret comes back with it.
    'data-focus-key': `alt-${image.id}`,
    onChange: async (e) => {
      await patchImage(artwork, image.id, { alt: e.target.value || null }, onChange);
    },
  });

  return el('div', { class: 'photo-controls' },
    field('Alt text', altInput, image.alt ? null : 'Required before this can be published.'),
    image.alt ? null : el('button', {
      class: 'btn ghost small', type: 'button',
      onClick: async () => {
        const draft = suggestAlt(artwork, image);
        if (!draft) { toast('Give the piece a subject or a substrate first.', 'warn'); return; }
        altInput.value = draft;
        await patchImage(artwork, image.id, { alt: draft }, onChange);
      },
    }, 'Draft it from the record'),
    field('Link to the original',
      el('div', { class: 'row tight' },
        el('input', {
          type: 'url', value: image.source_url ?? '',
          placeholder: 'https://photos.google.com/… or a Drive link',
          'data-focus-key': `src-${image.id}`,
          onChange: async (e) => {
            await patchImage(artwork, image.id, { source_url: e.target.value.trim() || null }, onChange);
          },
        }),
        image.source_url
          ? el('a', {
            class: 'btn ghost small', href: image.source_url,
            target: '_blank', rel: 'noopener noreferrer',
          }, 'Open ↗')
          : null),
      'Private. The app keeps a 2,000 px copy; this is the way back to the full-size file.'),
    el('div', { class: 'two-up' },
      field('Role', select(IMAGE_ROLE.map((r) => [r, label(r)]), image.role, {
        onChange: async (e) => patchImage(artwork, image.id, { role: e.target.value }, onChange),
      })),
      el('div', { class: 'field' },
        el('span', null, 'Shown in kiosk'),
        el('label', { class: 'check' },
          el('input', {
            type: 'checkbox', checked: image.in_kiosk !== false,
            onChange: async (e) => patchImage(artwork, image.id, { in_kiosk: e.target.checked }, onChange),
          }),
          el('span', { class: 'muted small', text: image.is_mockup ? 'digital mockup' : 'photograph' })))),
    el('details', { class: 'filter-drawer' },
      el('summary', null, `Problems with this photo${image.quality_flags?.length ? ` (${image.quality_flags.length})` : ''}`),
      el('div', { class: 'chips' }, QUALITY_FLAG.map((flag) => el('label', { class: 'chip' },
        el('input', {
          type: 'checkbox', checked: (image.quality_flags ?? []).includes(flag),
          onChange: async (e) => {
            const flags = new Set(image.quality_flags ?? []);
            if (e.target.checked) flags.add(flag); else flags.delete(flag);
            await patchImage(artwork, image.id, { quality_flags: [...flags] }, onChange);
          },
        }),
        el('span', { text: QUALITY_FLAG_LABELS[flag] ?? label(flag) }))))),
    el('p', { class: 'muted small' },
      `${image.width_px} × ${image.height_px} px web copy`,
      image.original_width_px
        ? ` · original ${image.original_width_px} × ${image.original_height_px} px (${readableBytes(image.original_bytes)})`
        : null),
    printSizeLine(image),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost small', type: 'button', onClick: () => openPhoto(artwork, image) }, 'View full size'),
      el('label', { class: 'btn ghost small' }, 'Replace', fileInput(artwork, image.role, onChange, image.id)),
      el('button', { class: 'btn ghost small danger', type: 'button', onClick: async () => {
        const ok = await confirmDialog(`Delete the ${label(image.role)} photo? The original was never kept, so it cannot be recovered.`, { confirmText: 'Delete' });
        if (!ok) return;
        const next = await removePhoto(artwork, image.id);
        await saveArtwork(next);
        toast('Photo deleted');
        onChange();
      } }, 'Delete')));
}

/**
 * What this photograph could be printed to, in inches. The number comes from
 * the original the app measured on the way in, so it is an upper bound: a
 * reference shot still has wall and frame in it, and cropping to the art takes
 * those pixels off. 150 DPI is the good number; 100 DPI is the floor, and only
 * survives because a large piece is seen from across a room.
 */
function printSizeLine(image) {
  const limits = printLimits({ long_edge_px: imageLongEdge(image) });
  if (!limits) return null;
  return el('p', { class: limits.at150 < 8 ? 'small warn-text' : 'small' },
    `Prints to ${limits.at150.toFixed(1)} in on the long edge at 150 DPI`,
    el('span', { class: 'muted', text: ` · ${limits.at100.toFixed(1)} in at 100 DPI · before cropping` }));
}

async function patchImage(artwork, imageId, patch, onChange) {
  const images = (artwork.images ?? []).map((i) => (i.id === imageId ? { ...i, ...patch } : i));
  await saveArtwork({ ...artwork, images });
  await rerender(onChange);
}

/**
 * Replacing takes one file. Adding takes as many as you select: a night of
 * photographing is twenty files, and twenty trips through a file picker with a
 * role dropdown each time is the friction that stops a catalog being finished.
 */
function fileInput(artwork, role, onChange, replaceId = null) {
  return el('input', {
    type: 'file', accept: 'image/*', capture: undefined, class: 'visually-hidden',
    multiple: !replaceId,
    onChange: async (event) => {
      const files = [...(event.target.files ?? [])];
      event.target.value = '';
      if (!files.length) return;
      await ingest(artwork, files, role, onChange, replaceId);
    },
  });
}

/**
 * Take one file or twenty. Each is resized and added in turn, carrying the
 * growing record forward so `nextImageId` keeps handing out unique ids, and
 * the whole batch is saved once — a save per file would rebuild the screen
 * twenty times and push a sync commit for each.
 */
async function ingest(artwork, files, role, onChange, replaceId) {
  const list = Array.isArray(files) ? files : [files];
  try {
    let base = artwork;
    // Replacing swaps the file, not the subject. What was written *about* the
    // photograph survives it: the alt text, the link back to the original,
    // whether it shows in the kiosk and where it sits. Losing those on a
    // replace cost the golf bag all five of its descriptions.
    const carried = replaceId
      ? pick(artwork.images?.find((i) => i.id === replaceId), ['alt', 'source_url', 'in_kiosk', 'kiosk_order'])
      : {};
    if (replaceId) base = await removePhoto(artwork, replaceId);

    const added = [];
    const failed = [];
    let webBytes = 0;
    let oversize = 0;
    let reduced = 0;
    let lastWeb = null;

    for (const [index, file] of list.entries()) {
      toast(list.length > 1 ? `Resizing ${index + 1} of ${list.length}…` : 'Resizing…');
      try {
        const { image, processed } = await addPhoto(base, file, { role });
        // Quality flags are deliberately not carried: a new file is exactly
        // how "blurry" or "low resolution" stops being true.
        base = { ...base, images: [...(base.images ?? []), { ...image, ...carried }] };
        added.push(image);
        lastWeb = processed.web;
        webBytes += processed.web.bytes;
        if (!processed.web.withinBudget) oversize += 1;
        if (processed.web.reducedEdge) reduced += 1;
      } catch (err) {
        // One unreadable file must not lose the nineteen that worked.
        console.error(err);
        failed.push(`${file.name ?? 'a file'}: ${err.message}`);
      }
    }

    if (added.length) await saveArtwork(base);
    toast(...report({ list, added, failed, webBytes, oversize, reduced, lastWeb }));
    if (added.length) onChange();
  } catch (err) {
    console.error(err);
    toast(err.message, 'warn');
  }
}

/** The fields of `source` that are actually set, so a spread cannot blank one. */
function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/** What to say afterwards: the counts that matter, and nothing else. */
function report({ list, added, failed, webBytes, oversize, reduced, lastWeb }) {
  if (!added.length) return [failed[0] ?? 'Nothing was added.', 'warn'];
  const tone = oversize ? 'warn' : 'ok';

  if (added.length === 1) {
    const note = lastWeb?.reducedEdge
      ? ` at ${lastWeb.width} × ${lastWeb.height} px — this one was too densely textured to fit 600 KB at 2,000 px`
      : '';
    const over = lastWeb?.withinBudget === false ? ', still over the 600 KB target' : '';
    const line = `Added. Web copy ${readableBytes(webBytes)}${note}${over}`;
    return failed.length ? [`${line} ${failed[0]}`, 'warn'] : [line, tone];
  }

  const extra = [
    reduced ? `${reduced} came down below 2,000 px` : null,
    oversize ? `${oversize} still over the 600 KB target` : null,
  ].filter(Boolean).join(', ');
  const line = `Added ${added.length} photos, ${readableBytes(webBytes)} in all${extra ? ` — ${extra}` : ''}.`;
  return failed.length
    ? [`Added ${added.length} of ${list.length}. ${failed[0]}`, 'warn']
    : [line, tone];
}

/**
 * Everything added here lands as `other` until it is given a role, so a bulk
 * drop never quietly claims the straight-on slot. The checklist rows are still
 * the faster path when you know what a shot is — they set the role, and they
 * take several files too.
 */
function addButton(artwork, onChange) {
  return el('label', { class: 'btn primary' }, 'Add photos',
    el('input', {
      type: 'file', accept: 'image/*', class: 'visually-hidden', multiple: true,
      onChange: async (event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length) await ingest(artwork, files, 'other', onChange, null);
      },
    }));
}

export { releaseUrls };
