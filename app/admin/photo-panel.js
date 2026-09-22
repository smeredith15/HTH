// The photo checklist on an artwork (SPEC §6.2).

import { el, mount, label, pill, toast, confirmDialog, field, select } from '../ui/dom.js';
import { saveArtwork } from '../store/artworks.js';
import {
  PHOTO_CHECKLIST, SHOOTING_GUIDE, QUALITY_FLAG_LABELS, checklistFor, checklistProgress,
  addPhoto, removePhoto, urlFor, readableBytes,
} from '../images/photos.js';
import { IMAGE_ROLE, QUALITY_FLAG, printLimits } from '../store/schema.js';

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
  const extras = (artwork.images ?? []).filter((i) => !PHOTO_CHECKLIST.some((c) => c.role === i.role));

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

    el('ul', { class: 'photo-list' },
      rows.map((row) => photoRow(artwork, row, onChange)),
      extras.map((image) => photoRow(artwork, {
        role: image.role, label: label(image.role), why: 'Extra shot.', image, optional: true,
      }, onChange))),

    (artwork.images ?? []).length
      ? el('p', { class: 'hint' }, 'Originals are never kept. Each photo is stored as a 2,000 px web version and a 600 px thumbnail, and the original’s pixel size goes to the print-master registry.')
      : null);
}

function photoRow(artwork, row, onChange) {
  const thumb = el('div', { class: 'photo-thumb' });
  if (row.image) {
    urlFor(row.image.id, 'thumb').then((url) => {
      if (url) mount(thumb, el('img', { src: trackUrl(url), alt: row.image.alt || row.label, loading: 'lazy' }));
      else mount(thumb, el('span', { class: 'muted small' }, 'missing'));
    });
  }

  return el('li', { class: row.image ? 'has-photo' : '' },
    row.image ? thumb : el('div', { class: 'photo-thumb empty', 'aria-hidden': 'true' }),
    el('div', { class: 'photo-body' },
      el('div', { class: 'row tight' },
        el('strong', { text: row.label }),
        row.required ? pill('needed for a print master', 'warn') : null,
        row.optional && !row.image ? pill('never required', 'muted') : null),
      el('p', { class: 'hint', text: row.why }),
      row.image ? imageControls(artwork, row.image, onChange) : null),
    row.image
      ? null
      : el('label', { class: 'btn ghost small' }, 'Add',
        fileInput(artwork, row.role, onChange)));
}

function imageControls(artwork, image, onChange) {
  const altInput = el('input', {
    type: 'text', value: image.alt ?? '', placeholder: 'Describe it for someone who cannot see it',
    onChange: async (e) => {
      await patchImage(artwork, image.id, { alt: e.target.value || null }, onChange);
    },
  });

  return el('div', { class: 'photo-controls' },
    field('Alt text', altInput, image.alt ? null : 'Required before this can be published.'),
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
    el('div', { class: 'row' },
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

async function patchImage(artwork, imageId, patch, onChange) {
  const images = (artwork.images ?? []).map((i) => (i.id === imageId ? { ...i, ...patch } : i));
  await saveArtwork({ ...artwork, images });
  onChange();
}

function fileInput(artwork, role, onChange, replaceId = null) {
  return el('input', {
    type: 'file', accept: 'image/*', capture: undefined, class: 'visually-hidden',
    onChange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      await ingest(artwork, file, role, onChange, replaceId);
    },
  });
}

async function ingest(artwork, file, role, onChange, replaceId) {
  const busy = toast('Resizing…');
  try {
    let base = artwork;
    if (replaceId) base = await removePhoto(artwork, replaceId);
    const { image, processed } = await addPhoto(base, file, { role });

    let next = { ...base, images: [...(base.images ?? []), image] };

    // §5.3: offer to record the original's pixel size in the print-master
    // registry, because that is the number that decides how large it can print.
    const master = next.print_master ?? {};
    const longest = Math.max(processed.original.width, processed.original.height);
    if (role === 'straight_on' && longest > (master.long_edge_px ?? 0)) {
      const limits = printLimits({ long_edge_px: longest });
      const ok = await confirmDialog(
        `That original is ${processed.original.width} × ${processed.original.height} px, which prints to `
        + `${limits.at150.toFixed(1)} in at 150 DPI. Record it as the print master for this piece?`,
        { confirmText: 'Record it', tone: 'primary' },
      );
      if (ok) {
        next = { ...next, print_master: {
          ...master,
          exists: true,
          long_edge_px: longest,
          short_edge_px: Math.min(processed.original.width, processed.original.height),
          captured_on: new Date().toISOString().slice(0, 10),
          filename: processed.original.name ?? master.filename ?? null,
          print_ready: master.print_ready ?? 'yes',
          capture_notes: master.capture_notes
            ?? 'Dimensions read from the photo when it was added. The original itself lives outside this repo.',
        } };
      }
    }

    await saveArtwork(next);
    const note = processed.web.reducedEdge
      ? ` at ${processed.web.width} × ${processed.web.height} px — this one was too densely textured to fit 600 KB at 2,000 px`
      : '';
    toast(
      `Added. Web copy ${readableBytes(processed.web.bytes)}${note}`
      + (processed.web.withinBudget ? '' : ', still over the 600 KB target'),
      processed.web.withinBudget ? 'ok' : 'warn',
    );
    onChange();
  } catch (err) {
    console.error(err);
    toast(err.message, 'warn');
  }
}

/**
 * One photo at a time. Each one may raise the print-master question, and a
 * queue of those behind a batch upload would be worse than the friction it
 * saves. The checklist rows are the faster path anyway — they pick the role.
 */
function addButton(artwork, onChange) {
  return el('label', { class: 'btn primary' }, 'Add a photo',
    el('input', {
      type: 'file', accept: 'image/*', class: 'visually-hidden',
      onChange: async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) await ingest(artwork, file, 'straight_on', onChange, null);
      },
    }));
}

export { releaseUrls };
