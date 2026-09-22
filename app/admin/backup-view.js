// Export / import screen (SPEC §4.2).

import { el, mount, relativeDays, toast, dateOnly } from '../ui/dom.js';
import {
  exportAll, previewImport, applyImport, loadSettings, patchSettings,
  requestPersistence, storageEstimate,
} from '../store/db.js';
import { exportAge, ImportError } from '../store/backup.js';

export async function renderBackup(host) {
  const settings = await loadSettings();
  const age = exportAge(settings.last_exported_at);
  const estimate = await storageEstimate();
  const report = el('div', { class: 'import-report' });

  mount(host,
    el('div', { class: 'view-head' }, el('div', null,
      el('h1', null, 'Backup'),
      el('p', { class: 'muted' }, 'The private layer never leaves this device except through this screen.'))),

    el('section', { class: `panel alert ${age.stale ? 'warn' : 'ok'}` },
      el('h2', null, 'Export'),
      el('p', null, age.never
        ? 'You have never exported this catalog.'
        : `Last exported ${relativeDays(age.days)} (${dateOnly(settings.last_exported_at)}).`),
      el('p', { class: 'hint' }, 'One JSON file with every artwork, listing, sale, customer, commission, expense and setting. Keep it somewhere that is not this browser.'),
      el('button', { class: 'btn primary', type: 'button', onClick: () => doExport() }, 'Export everything')),

    el('section', { class: 'panel' },
      el('h2', null, 'Import'),
      el('p', { class: 'hint' }, 'Merge keeps whichever copy of each record was edited last and leaves anything this device has that the file does not mention. Replace throws away what is here first.'),
      el('div', { class: 'row' },
        fileButton('Preview a merge', 'merge', report),
        fileButton('Preview a replace', 'replace', report)),
      report),

    el('section', { class: 'panel' },
      el('h2', null, 'This device'),
      el('p', { class: 'hint' }, 'Asking the browser to keep this data makes it much less likely to be evicted. It is not a substitute for exporting.'),
      estimate ? el('p', null, `Using ${(estimate.usage / 1e6).toFixed(1)} MB of about ${(estimate.quota / 1e6).toFixed(0)} MB.`) : null,
      el('button', { class: 'btn ghost', type: 'button', onClick: async () => {
        const result = await requestPersistence();
        if (!result.supported) toast('This browser does not offer persistent storage.', 'warn');
        else if (result.persisted) toast('This browser will keep the data.', 'ok');
        else toast('The browser declined. Add the app to your home screen and try again.', 'warn');
      } }, 'Ask the browser to keep this data')));
}

async function doExport() {
  const { json, filename } = await exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  await patchSettings({ last_exported_at: new Date().toISOString() });
  toast(`Exported ${filename}`, 'ok');
}

function fileButton(text, mode, report) {
  const input = el('input', {
    type: 'file', accept: 'application/json,.json', class: 'visually-hidden',
    onChange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const { plan } = await previewImport(await file.text(), mode);
        mount(report, previewPanel(plan, file.name, report));
      } catch (err) {
        mount(report, el('div', { class: 'alert bad' },
          el('strong', null, 'That file could not be read. '),
          err instanceof ImportError ? err.message : String(err)));
      }
      event.target.value = '';
    },
  });
  return el('label', { class: 'btn ghost' }, text, input);
}

function previewPanel(plan, filename, report) {
  const rows = Object.entries(plan.stores)
    .map(([store, result]) => ({ store, ...result }))
    .filter((r) => r.added.length || r.updated.length || r.conflicts.length);

  return el('div', { class: 'panel inset' },
    el('h3', { text: `${filename} — ${plan.mode}` }),
    rows.length
      ? el('table', { class: 'table' },
        el('thead', null, el('tr', null, ['', 'New', 'Updated', 'Unchanged', 'Conflicts'].map((h) => el('th', { text: h })))),
        el('tbody', null, rows.map((r) => el('tr', null,
          el('td', { text: r.store }),
          el('td', { text: String(r.added.length) }),
          el('td', { text: String(r.updated.length) }),
          el('td', { text: String(r.unchanged.length) }),
          el('td', { class: r.conflicts.length ? 'bad-text' : '', text: String(r.conflicts.length) })))))
      : el('p', { class: 'muted' }, 'Nothing in this file differs from what is already here.'),

    plan.conflicts.length
      ? el('div', { class: 'alert warn' },
        el('strong', null, `${plan.conflicts.length} record${plan.conflicts.length === 1 ? '' : 's'} changed on both devices. `),
        'Importing keeps the copy on this device for those. Sort them out by hand afterwards:',
        el('ul', null, plan.conflicts.slice(0, 10).map((c) =>
          el('li', { text: `${c.store} · ${c.id} — ${c.reason}` }))))
      : null,

    plan.mode === 'replace'
      ? el('div', { class: 'alert bad' }, el('strong', null, 'Replace wipes this device first. '), 'Export before you do this.')
      : null,

    el('div', { class: 'row end' },
      el('button', { class: 'btn ghost', type: 'button', onClick: () => mount(report) }, 'Cancel'),
      el('button', { class: 'btn primary', type: 'button', onClick: async () => {
        await applyImport(plan);
        toast('Imported. Reloading.', 'ok');
        setTimeout(() => location.reload(), 600);
      } }, plan.mode === 'replace' ? 'Replace everything' : 'Merge it in')));
}
