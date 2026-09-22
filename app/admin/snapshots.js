// The monthly shop snapshot (SPEC §5.9), which exists to make the §C.4 review
// easy: search views first, then favourites, then orders.

import { el, mount, money, field, toast, confirmDialog } from '../ui/dom.js';
import { getAll, put, remove } from '../store/db.js';
import { newSnapshot } from '../store/schema.js';

export async function renderSnapshots(host) {
  const rows = (await getAll('snapshots')).sort((a, b) => String(b.month).localeCompare(String(a.month)));
  const reload = () => renderSnapshots(host);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Monthly shop figures'),
        el('p', { class: 'muted' }, 'Typed in once a month from the Etsy stats page.')),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: '#/money' }, 'Money'),
        el('button', { class: 'btn primary', type: 'button', onClick: () => openSnapshot(null, reload) }, '+ Add a month'))),

    el('section', { class: 'panel' },
      el('p', { class: 'hint' }, 'Expect no movement for two or three weeks after a listing change — Etsy has to '
        + 're-index. At 30 days look at search views, at 60 at favourites, at 90 at orders. '
        + 'If search views are flat everywhere at 90 days, stop tuning Etsy and put the hours into commissions.')),

    rows.length >= 2 ? trend(rows) : null,

    rows.length
      ? el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null,
            ['Month', 'Visits', 'Views', 'Orders', 'Revenue', 'Conversion', 'Favourites', ''].map((h) => el('th', { text: h })))),
          el('tbody', null, rows.map((row) => el('tr', null,
            el('td', { text: row.month ?? '—' }),
            el('td', { text: num(row.visits) }),
            el('td', { text: num(row.views) }),
            el('td', { text: num(row.orders) }),
            el('td', { text: money(row.revenue) }),
            el('td', { text: row.conversion_pct === null || row.conversion_pct === undefined ? '—' : `${row.conversion_pct}%` }),
            el('td', { text: num(row.favorites) }),
            el('td', null, el('button', {
              class: 'btn ghost small', type: 'button', onClick: () => openSnapshot(row, reload),
            }, 'Edit')))))))
      : el('p', { class: 'empty' }, 'No months recorded yet.'));
}

const num = (value) => (value === null || value === undefined ? '—' : String(value));

/** A plain bar chart — no library, because §3 says anything third-party is vendored. */
function trend(rows) {
  const ordered = [...rows].reverse();
  const max = Math.max(...ordered.map((r) => Number(r.visits) || 0), 1);
  return el('section', { class: 'panel' },
    el('h2', null, 'Visits'),
    el('ul', { class: 'bars' }, ordered.map((row) => el('li', null,
      el('span', { class: 'bar-label', text: row.month ?? '—' }),
      el('span', { class: 'bar' }, el('span', {
        class: 'bar-fill', style: { width: `${((Number(row.visits) || 0) / max) * 100}%` },
      })),
      el('span', { class: 'bar-n', text: num(row.visits) })))));
}

function openSnapshot(existing, reload) {
  const draft = existing ? structuredClone(existing) : newSnapshot({
    month: new Date().toISOString().slice(0, 7),
  });

  const number = (key, labelText) => field(labelText, el('input', {
    type: 'number', step: 'any', inputMode: 'decimal', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value === '' ? null : Number(e.target.value); },
  }));

  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body', onSubmit: async (event) => {
      event.preventDefault();
      const record = { ...draft, id: draft.id ?? draft.month, updated_at: new Date().toISOString() };
      await put('snapshots', record);
      dialog.close();
      toast('Saved', 'ok');
      reload();
    } },
      el('h2', { text: existing ? 'Month' : 'Add a month' }),
      field('Month', el('input', {
        type: 'month', value: draft.month ?? '', required: true,
        onInput: (e) => { draft.month = e.target.value; },
      })),
      el('div', { class: 'two-up' }, number('visits', 'Visits'), number('views', 'Views')),
      el('div', { class: 'two-up' }, number('orders', 'Orders'), number('revenue', 'Revenue ($)')),
      el('div', { class: 'two-up' }, number('conversion_pct', 'Conversion (%)'), number('favorites', 'Item favourites')),
      number('followers', 'Followers'),
      field('Note', el('input', { type: 'text', value: draft.note ?? '', onInput: (e) => { draft.note = e.target.value || null; } })),
      el('div', { class: 'row end' },
        existing ? el('button', { class: 'btn danger ghost', type: 'button', onClick: async () => {
          const ok = await confirmDialog('Delete this month?', { confirmText: 'Delete' });
          if (!ok) return;
          await remove('snapshots', existing.id);
          dialog.close();
          reload();
        } }, 'Delete') : null,
        el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Save'))));

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
