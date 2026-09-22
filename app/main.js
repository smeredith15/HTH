// App entry. Phase 1: admin only — catalog, storage, backup, settings.
// Kiosk (#/kiosk) and the public portfolio arrive in Phase 4.

import { route, setNotFound, start, parseHash } from './router.js';
import { el, mount, toast } from './ui/dom.js';
import { seedIfEmpty, refreshSeed, requestPersistence, loadSettings, patchSettings } from './store/db.js';
import { renderHome } from './admin/home.js';
import { renderCatalog, promptQuickAdd } from './admin/catalog.js';
import { renderArtwork, renderArtworkEdit } from './admin/artwork.js';
import { renderListings } from './admin/listings.js';
import { renderListingEditor } from './admin/listing-editor.js';
import { renderPrintCosts } from './admin/print-costs.js';
import { renderHelp } from './admin/help.js';
import { renderMoney } from './admin/money.js';
import { renderSales } from './admin/sales.js';
import { renderCommissions } from './admin/commissions.js';
import { renderExpenses } from './admin/expenses.js';
import { renderReprice } from './admin/reprice.js';
import { renderReports } from './admin/reports.js';
import { renderInventory } from './admin/inventory.js';
import { renderSnapshots } from './admin/snapshots.js';
import { renderBackup } from './admin/backup-view.js';
import { renderSettings } from './admin/settings-view.js';

// Short labels because the phone nav is a six-across bottom bar.
const NAV = [
  ['/', 'Home'],
  ['/catalog', 'Catalog'],
  ['/listings', 'Listings'],
  ['/money', 'Money'],
  ['/backup', 'Backup'],
  ['/settings', 'Settings'],
];

const view = document.getElementById('view');

function withChrome(render) {
  return async (context) => {
    document.body.dataset.route = context.path;
    highlightNav();
    view.setAttribute('aria-busy', 'true');
    try {
      await render(view, context);
    } catch (err) {
      console.error(err);
      mount(view, el('div', { class: 'alert bad' },
        el('strong', null, 'Something went wrong. '), String(err?.message ?? err)));
    } finally {
      view.removeAttribute('aria-busy');
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  };
}

// Detail screens belong to the section they came from: an artwork is Catalog,
// a listing is Listings. Without this the nav goes blank the moment you open
// anything.
// Everything about money hangs off the hub, so the nav stays at six.
const NAV_OWNER = {
  '/artwork/': '/catalog',
  '/listing/': '/listings',
  '/inventory': '/catalog',
  '/print-costs': '/money',
  '/sales': '/money',
  '/commissions': '/money',
  '/expenses': '/money',
  '/reprice': '/money',
  '/reports': '/money',
  '/snapshots': '/money',
};

function navTargetFor(path) {
  for (const [prefix, target] of Object.entries(NAV_OWNER)) {
    if (path.startsWith(prefix)) return target;
  }
  if (path === '/') return '/';
  // Longest matching nav path wins, so /listings never claims /listing/:id.
  return NAV.map(([target]) => target)
    .filter((target) => target !== '/' && path.startsWith(target))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

function highlightNav() {
  const active = navTargetFor(parseHash().path);
  for (const link of document.querySelectorAll('.nav a')) {
    const target = link.getAttribute('href').slice(1);
    const isActive = target === active;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function buildNav() {
  const nav = el('nav', { class: 'nav', 'aria-label': 'Main' },
    NAV.map(([path, text]) => el('a', { href: `#${path}`, text })));
  document.getElementById('chrome').append(nav);
}

route('/', withChrome(renderHome));
route('/catalog', withChrome(renderCatalog));
route('/artwork/:id', withChrome(renderArtwork));
route('/artwork/:id/edit', withChrome(renderArtworkEdit));
route('/listings', withChrome(renderListings));
route('/listing/:id', withChrome(renderListingEditor));
route('/money', withChrome(renderMoney));
route('/print-costs', withChrome(renderPrintCosts));
route('/sales', withChrome(renderSales));
route('/commissions', withChrome(renderCommissions));
route('/expenses', withChrome(renderExpenses));
route('/reprice', withChrome(renderReprice));
route('/reports', withChrome(renderReports));
route('/inventory', withChrome(renderInventory));
route('/snapshots', withChrome(renderSnapshots));
route('/backup', withChrome(renderBackup));
route('/help', withChrome(renderHelp));
route('/settings', withChrome(renderSettings));
setNotFound(withChrome(async (host, { path }) => mount(host,
  el('div', { class: 'empty' },
    el('h1', null, 'Not here'),
    el('p', { text: `No screen at ${path}.` }),
    el('a', { class: 'btn ghost', href: '#/' }, 'Back to home')))));

async function boot() {
  buildNav();

  // §4.2: ask for persistent storage on first run.
  const settings = await loadSettings();
  if (!settings.persistence_requested) {
    const result = await requestPersistence().catch(() => ({ supported: false }));
    await patchSettings({ persistence_requested: true, persistence_granted: !!result.persisted });
  }

  // The print-cost template lays itself down once and tops up on later builds.
  const { seedPrintCosts, migratePrintCosts } = await import('./store/print-costs.js');
  await seedPrintCosts();
  await migratePrintCosts();

  const seeded = await seedIfEmpty();
  if (seeded.seeded) {
    toast(`Loaded ${seeded.artworks} pieces from the spec’s Appendix A.`, 'ok');
  } else {
    // A device seeded by an earlier build catches up. Only untouched seed rows
    // are refreshed; anything edited keeps its own version.
    const caught = await refreshSeed();
    if (caught.added || caught.refreshed) {
      toast(`Appendix A updated: ${caught.added} added, ${caught.refreshed} refreshed${caught.kept ? `, ${caught.kept} of your edits kept` : ''}.`, 'ok');
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'n' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      promptQuickAdd();
    }
  });

  await start();
  document.body.classList.remove('booting');
}

boot().catch((err) => {
  console.error(err);
  mount(view, el('div', { class: 'alert bad' },
    el('strong', null, 'The app could not start. '),
    String(err?.message ?? err),
    el('p', { class: 'hint' }, 'If this browser blocks storage for local files, serve the folder over http (npm run serve) instead of opening index.html directly.')));
  document.body.classList.remove('booting');
});
