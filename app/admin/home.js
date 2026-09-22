// Admin home. Phase 1 shows what the catalog knows plus the backup state
// (SPEC §4.2); the full dashboard (§6.4) lands in Phase 6.

import { el, mount, label, relativeDays, pill } from '../ui/dom.js';
import { listArtworks } from '../store/artworks.js';
import { getAll, loadSettings, storageEstimate } from '../store/db.js';
import { listListings, listingsNeedingAttention } from '../store/listings.js';
import { listPrintCosts } from '../store/print-costs.js';
import { exportAge } from '../store/backup.js';
import { effectiveRights, hasUsableMaster, isGone, photographBeforeItLeaves } from '../store/schema.js';
import { promptQuickAdd } from './catalog.js';
import { shotList } from '../images/photos.js';

export async function renderHome(host) {
  const [artworks, listings, backlog, settings, estimate, printCosts] = await Promise.all([
    listArtworks(), listListings(), getAll('backlog'), loadSettings(), storageEstimate(),
    listPrintCosts(),
  ]);
  const pricedSizes = printCosts.filter((row) => Number(row.unit_cost) > 0).length;
  const attention = listingsNeedingAttention(listings, artworks, settings);
  const age = exportAge(settings.last_exported_at);

  const by = (fn) => artworks.reduce((acc, a) => {
    const key = fn(a);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const gone = artworks.filter(isGone);
  const lostCatalog = gone.filter((a) => !hasUsableMaster(a));
  // A reminder snoozed on the artwork should be snoozed here too, or the
  // snooze is not a snooze.
  const needsPhoto = artworks.filter((a) => photographBeforeItLeaves(a)?.showing);
  const shots = shotList(artworks);
  const withMaster = artworks.filter(hasUsableMaster);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'High Tide Handmade'),
        el('p', { class: 'muted' }, 'Catalog of record')),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: '#/help' }, 'How this works'),
        el('button', { class: 'btn primary', type: 'button', onClick: () => promptQuickAdd() }, '+ Quick add'))),

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

    // The quieter list: pieces still in the studio with a shot outstanding.
    // "Four of six" is as actionable as "none of six", and working down one
    // screen beats opening sixty records to find out which need what.
    shots.length
      ? el('section', { class: 'panel' },
        el('h2', null, 'Shot list'),
        el('p', { class: 'hint' },
          `${shots.length} piece${shots.length === 1 ? '' : 's'} still in the studio ${shots.length === 1 ? 'has' : 'have'} a shot outstanding. `
          + 'Each row links straight to its photo panel, and any row there takes several files at once.'),
        el('ul', { class: 'shot-list' }, shots.slice(0, 12).map(({ artwork, missing, progress }) =>
          el('li', null,
            el('a', { href: `#/artwork/${artwork.id}`, text: artwork.title }),
            el('span', { class: 'muted small', text: `${progress.done} of ${progress.total}` }),
            el('span', { class: 'shot-missing muted small', text: missing.map((m) => label(m.role)).join(', ') })))),
        shots.length > 12 ? el('p', { class: 'muted', text: `…and ${shots.length - 12} more.` }) : null)
      : null,

    printCosts.length && !pricedSizes
      ? el('section', { class: 'panel alert warn' },
        el('h2', null, 'No print costs entered yet'),
        el('p', null, 'Until a lab price is recorded, the app cannot tell you what a print earns, '
          + 'and the margin columns on every print listing stay blank.'),
        el('a', { class: 'btn primary', href: '#/print-costs' }, 'Open the print cost template'))
      : null,

    attention.length
      ? el('section', { class: `panel alert ${attention.some((r) => r.counts.stop) ? 'bad' : 'warn'}` },
        el('h2', null, 'Listings needing attention'),
        el('ul', { class: 'link-list' }, attention.slice(0, 8).map((row) =>
          el('li', null,
            el('a', { href: `#/listing/${row.listing.id}`, text: row.listing.title || row.listing.id }),
            el('span', { class: 'muted small', text: ` — ${row.findings[0].message.split('.')[0]}.` })))),
        attention.length > 8 ? el('p', { class: 'muted', text: `…and ${attention.length - 8} more.` }) : null)
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
