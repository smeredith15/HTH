// Look at a photograph the app is holding (SPEC §5.3).
//
// The web copy is a real image, not a placeholder — this is where it can
// actually be seen, and taken back out. The full-resolution master is not
// here and never was: it lives wherever the print-master registry says.

import { el, label, toast } from '../ui/dom.js';
import { blobFor, readableBytes } from '../images/photos.js';
import { printLimits } from '../store/schema.js';

export async function openPhoto(artwork, image) {
  const blob = await blobFor(image.id, 'web');
  if (!blob) {
    toast('That photo is missing from this device. Import an export to restore it.', 'warn');
    return;
  }
  const url = URL.createObjectURL(blob);
  const master = artwork.print_master ?? {};
  const limits = printLimits(master);

  const dialog = el('dialog', { class: 'sheet viewer' },
    el('div', { class: 'viewer-head' },
      el('div', null,
        el('h2', { text: label(image.role) }),
        el('p', { class: 'muted small', text: image.alt || 'No alt text yet' })),
      el('button', {
        class: 'btn ghost small', type: 'button', 'aria-label': 'Close',
        onClick: () => dialog.close(),
      }, '✕')),

    el('div', { class: 'viewer-image' },
      el('img', { src: url, alt: image.alt || `${label(image.role)} photograph of ${artwork.title}` })),

    el('dl', { class: 'spec-list' },
      row('In the app', `${image.width_px} × ${image.height_px} px · ${readableBytes(blob.size)}`),
      image.original_width_px
        ? row('Original was', `${image.original_width_px} × ${image.original_height_px} px · ${readableBytes(image.original_bytes)}`)
        : null,
      row('Full-resolution master', masterLine(master, limits)),
      (image.quality_flags ?? []).length
        ? row('Flagged', image.quality_flags.map(label).join(', '))
        : null),

    el('div', { class: 'row end' },
      el('a', {
        class: 'btn ghost', href: url, download: `${artwork.id}-${image.id}.jpg`,
      }, 'Download this copy'),
      el('button', { class: 'btn primary', type: 'button', onClick: () => dialog.close() }, 'Done')));

  dialog.addEventListener('close', () => {
    URL.revokeObjectURL(url);
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
}

function masterLine(master, limits) {
  if (!master?.exists) {
    return el('span', { class: 'bad-text' }, 'Not recorded. This piece cannot be printed.');
  }
  return el('span', null,
    master.location
      ? el('span', { text: master.location })
      : el('span', { class: 'muted' }, 'location not recorded — it is not in this app'),
    limits
      ? el('span', { class: 'muted', text: ` · prints to ${limits.at150.toFixed(1)} in at 150 DPI` })
      : null);
}

function row(term, value) {
  return el('div', { class: 'spec-row' },
    el('dt', { text: term }),
    el('dd', null, value instanceof Node ? value : String(value)));
}
