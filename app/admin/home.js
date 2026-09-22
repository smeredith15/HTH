// Admin home. Phase 1 shows what the catalog knows plus the backup state
// (SPEC §4.2); the full dashboard (§6.4) lands in Phase 6.

import { el, mount, label, relativeDays, pill } from '../ui/dom.js';
import { listArtworks } from '../store/artworks.js';
import { getAll, loadSettings, storageEstimate } from '../store/db.js';
import { exportAge } from '../store/backup.js';
import { effectiveRights, hasUsableMaster, isGone } from '../store/schema.js';
import { promptQuickAdd } from './catalog.js';

export async function renderHome(host) {
  const [artworks, backlog, settings, estimate] = await Promise.all([
    listArtworks(), getAll('backlog'), loadSettings(), storageEstimate(),
  ]);
  const age = exportAge(settings.last_exported_at);

  const by = (fn) => artworks.reduce((acc, a) => {
    const key = fn(a);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const gone = artworks.filter(isGone);
  const lostCatalog = gone.filter((a) => !hasUsableMaster(a));
  const needsPhoto = artworks.filter((a) => a.on_hand && !(a.images || []).some((i) => i.role === 'straight_on'));
  const withMaster = artworks.filter(hasUsableMaster);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'High Tide Handmade'),
        el('p', { class: 'muted' }, 'Catalog of record')),
      el('button', { class: 'btn primary', type: 'button', onClick: () => promptQuickAdd() }, '+ Quick add')),

    backupBanner(age, settings),

    el('div', { class: 'stat-row' },
      stat(artworks.length, 'pieces'),
      stat(artworks.filter((a) => a.on_hand).length, 'on hand'),
      stat(artworks.filter((a) => a.visibility === 'public').length, 'public'),
      stat(`${Math.round((withMaster.length / Math.max(artworks.length, 1)) * 100)}%`, 'have a print master')),

    lostCatalog.length
      ? el('section', { class: 'panel alert bad' },
        el('h2', null, 'Lost catalog'),
        el('p', null, `${lostCatalog.length} ${lostCatalog.length === 1 ? 'piece has' : 'pieces have'} left without a usable print master and cannot be reproduced.`),
        listOf(lostCatalog.slice(0, 8)),
        lostCatalog.length > 8 ? el('p', { class: 'muted', text: `…and ${lostCatalog.length - 8} more.` }) : null)
      : null,

    needsPhoto.length
      ? el('section', { class: 'panel alert warn' },
        el('h2', null, 'Photograph before they leave'),
        el('p', null, `${needsPhoto.length} on-hand ${needsPhoto.length === 1 ? 'piece has' : 'pieces have'} no straight-on photo.`),
        listOf(needsPhoto))
      : null,

    el('div', { class: 'two-up' },
      countPanel('By status', by((a) => a.status)),
      countPanel('By disposition', by((a) => a.disposition))),

    el('div', { class: 'two-up' },
      countPanel('By category', by((a) => a.category ?? 'uncategorised')),
      rightsPanel(artworks)),

    backlog.length ? el('section', { class: 'panel' },
      el('h2', null, 'Open backlog'),
      el('p', { class: 'hint' }, 'From the September 2026 shop review (Appendix B.8). The listing tools that work these arrive in Phase 2.'),
      el('ul', { class: 'todo-list' }, backlog.map((item) =>
        el('li', { class: item.done ? 'done' : '' }, item.text)))) : null,

    estimate ? el('p', { class: 'muted small' },
      `Browser storage in use: ${(estimate.usage / 1e6).toFixed(1)} MB of about ${(estimate.quota / 1e6).toFixed(0)} MB.`) : null);
}

function backupBanner(age, settings) {
  const tone = age.stale ? 'warn' : 'ok';
  return el('section', { class: `panel alert ${tone}` },
    el('h2', null, 'Backups'),
    el('p', null,
      age.never
        ? 'You have never exported. '
        : `Last exported ${relativeDays(age.days)}. `,
      el('strong', null, 'Exports are the backup of record.'),
      ' Everything lives in this browser, and a browser can clear its own storage. Export regularly and keep the file somewhere else.'),
    el('div', { class: 'row' },
      el('a', { class: 'btn primary', href: '#/backup' }, 'Export now'),
      settings.seeded_at ? pill('Appendix A loaded', 'muted') : null));
}

function stat(value, text) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-value', text: String(value) }),
    el('span', { class: 'stat-label', text }));
}

function countPanel(title, counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return el('section', { class: 'panel' },
    el('h2', { text: title }),
    el('ul', { class: 'bars' }, entries.map(([key, n]) =>
      el('li', null,
        el('span', { class: 'bar-label', text: label(key) }),
        el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: { width: `${(n / max) * 100}%` } })),
        el('span', { class: 'bar-n', text: String(n) })))));
}

function rightsPanel(artworks) {
  const counts = artworks.reduce((acc, a) => {
    const key = effectiveRights(a.rights).listing_ok;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return countPanel('OK to list on Etsy', counts);
}

function listOf(artworks) {
  return el('ul', { class: 'link-list' }, artworks.map((a) =>
    el('li', null, el('a', { href: `#/artwork/${a.id}`, text: a.title }))));
}
