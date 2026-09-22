// The expense ledger — added at the owner's request; see DECISIONS.md.

import { el, mount, money, label, dateOnly, field, select, toast, confirmDialog, rerender } from '../ui/dom.js';
import {
  listExpenses, createExpense, saveExpense, deleteExpense,
  yearSummary, yearsPresent, yearOf,
} from '../store/expenses.js';
import { listSales } from '../store/sales.js';
import { listArtworks } from '../store/artworks.js';
import { loadSettings } from '../store/db.js';

const state = { year: null };

export async function renderExpenses(host) {
  const [expenses, sales, artworks, settings] = await Promise.all([
    listExpenses(), listSales(), listArtworks(), loadSettings(),
  ]);
  // Switching year rebuilds the table, so keep the reader's place.
  const reload = () => rerender(() => renderExpenses(host));
  const years = yearsPresent(sales, expenses);
  const year = state.year ?? years[0] ?? String(new Date().getFullYear());
  const summary = yearSummary(sales, expenses, settings, year);
  const rows = expenses
    .filter((e) => yearOf(e.date) === String(year))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Expenses'),
        el('p', { class: 'muted' }, 'Everything the business spends that is not inside a single piece.')),
      el('div', { class: 'row' },
        years.length > 1
          ? select(years.map((y) => [y, y]), year, { onChange: (e) => { state.year = e.target.value; reload(); } })
          : null,
        el('a', { class: 'btn ghost', href: '#/money' }, 'Money'),
        el('button', { class: 'btn primary', type: 'button', onClick: () => openExpense(null, artworks, settings, reload) }, '+ Add'))),

    el('section', { class: 'panel' },
      el('h2', { text: `${year} in one line` }),
      el('div', { class: 'stat-row' },
        stat(money(summary.gross), 'taken'),
        stat(money(summary.net), 'after fees and materials'),
        stat(money(summary.expenses), 'spent'),
        stat(money(summary.profit), 'profit')),
      summary.hourly !== null
        ? el('p', { class: 'hint' },
          `Across ${summary.hours} recorded hours that is ${money(summary.hourly)} an hour, once everything is paid.`)
        : el('p', { class: 'hint' }, 'Record hours on your sales and this becomes an hourly figure.'),
      el('p', { class: 'hint' }, 'A sale’s own materials are already subtracted from its net, so only log a '
        + 'materials expense here when it is not in that piece’s materials cost — otherwise it counts twice.')),

    summary.byCategory.length
      ? el('section', { class: 'panel' },
        el('h2', null, 'Where it went'),
        el('ul', { class: 'bars' }, summary.byCategory.map((entry) => {
          const max = summary.byCategory[0].amount || 1;
          return el('li', null,
            el('span', { class: 'bar-label', text: label(entry.category) }),
            el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: { width: `${(entry.amount / max) * 100}%` } })),
            el('span', { class: 'bar-n', text: money(entry.amount) }));
        })))
      : null,

    rows.length
      ? el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null, ['Date', 'What', 'Category', 'Amount', ''].map((h) => el('th', { text: h })))),
          el('tbody', null, rows.map((expense) => el('tr', null,
            el('td', { text: dateOnly(expense.date) }),
            el('td', { text: [expense.vendor, expense.note].filter(Boolean).join(' — ') || '—' }),
            el('td', { text: label(expense.category) }),
            el('td', null, el('strong', { text: money(expense.amount) })),
            el('td', null, el('button', {
              class: 'btn ghost small', type: 'button',
              onClick: () => openExpense(expense, artworks, settings, reload),
            }, 'Edit')))))))
      : el('p', { class: 'empty' }, `Nothing recorded for ${year}.`));
}

function stat(value, text) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-value', text: String(value) }),
    el('span', { class: 'stat-label', text }));
}

function openExpense(existing, artworks, settings, reload) {
  const draft = existing
    ? structuredClone(existing)
    : { date: new Date().toISOString().slice(0, 10), category: settings.expense_categories?.[0] ?? 'other' };

  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body', onSubmit: async (event) => {
      event.preventDefault();
      if (existing) await saveExpense(draft);
      else await createExpense(draft);
      dialog.close();
      toast('Saved', 'ok');
      reload();
    } },
      el('h2', { text: existing ? 'Expense' : 'New expense' }),
      field('Date', el('input', { type: 'date', value: draft.date ?? '', onInput: (e) => { draft.date = e.target.value; } })),
      field('Amount', el('input', {
        type: 'number', step: '0.01', inputMode: 'decimal', class: 'big', required: true, value: draft.amount ?? '',
        onInput: (e) => { draft.amount = e.target.value === '' ? null : Number(e.target.value); },
      })),
      field('Category', select(
        (settings.expense_categories ?? ['other']).map((c) => [c, label(c)]), draft.category,
        { onChange: (e) => { draft.category = e.target.value; } },
      )),
      field('Vendor', el('input', { type: 'text', value: draft.vendor ?? '', onInput: (e) => { draft.vendor = e.target.value || null; } })),
      field('Note', el('input', { type: 'text', value: draft.note ?? '', onInput: (e) => { draft.note = e.target.value || null; } })),
      field('For one piece', select(
        [['', 'No — general'], ...artworks.map((a) => [a.id, a.title])], draft.artwork_id ?? '',
        { onChange: (e) => { draft.artwork_id = e.target.value || null; } },
      ), 'Only if it is not already in that piece’s materials cost.'),
      el('div', { class: 'row end' },
        existing ? el('button', { class: 'btn danger ghost', type: 'button', onClick: async () => {
          const ok = await confirmDialog('Delete this expense?', { confirmText: 'Delete' });
          if (!ok) return;
          await deleteExpense(existing.id);
          dialog.close();
          toast('Deleted');
          reload();
        } }, 'Delete') : null,
        el('button', { class: 'btn ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn primary', type: 'submit' }, 'Save'))));

  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
