// The commission queue (SPEC §5.8). This is what lets Etsy quantity go above 1.

import { el, mount, money, label, dateOnly, field, select, pill, toast, confirmDialog } from '../ui/dom.js';
import {
  listCommissions, createCommission, saveCommission, deleteCommission,
  projectQueue, capacity, isOpen,
} from '../store/commissions.js';
import { loadSettings } from '../store/db.js';
import { COMMISSION_TYPE, COMMISSION_STATUS, RIGHTS_FLAG } from '../store/schema.js';

export async function renderCommissions(host) {
  const [commissions, settings] = await Promise.all([listCommissions(), loadSettings()]);
  const reload = () => renderCommissions(host);
  const { rows, totalHours, hoursPerWeek } = projectQueue(commissions, settings);
  const free = capacity(commissions, settings, { horizon: settings.holiday_cutoff });
  const closed = commissions.filter((c) => !isOpen(c));
  const late = rows.filter((r) => r.late);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Commissions'),
        el('p', { class: 'muted', text: `${rows.length} open · ${Math.round(totalHours)} hours of work booked` })),
      el('div', { class: 'row' },
        el('a', { class: 'btn ghost', href: '#/money' }, 'Money'),
        el('button', { class: 'btn primary', type: 'button', onClick: () => openCommission(null, settings, reload) }, '+ New'))),

    el('section', { class: `panel alert ${late.length ? 'bad' : 'ok'}` },
      el('h2', null, 'Capacity'),
      late.length
        ? el('p', null, el('strong', null, `${late.length} cannot be finished in time. `),
          'At ', String(hoursPerWeek), ' hours a week, the queue runs past their ship dates.')
        : el('p', null, 'Everything in the queue makes its date at ', String(hoursPerWeek), ' hours a week.'),
      free.canAccept === null
        ? el('p', { class: 'hint' }, 'Set a holiday cutoff in Settings to see how many more you can take.')
        : el('p', null,
          el('strong', { text: `Can accept ${free.canAccept} more before ${free.horizon}.` }),
          el('span', { class: 'muted', text: ` ${free.freeHours} free hours of ${free.availableHours}, `
            + `at about ${free.typical} hours a commission.` })),
      el('p', { class: 'hint' }, 'This is the number that lets you raise the Etsy quantity above 1. '
        + 'Holding it at 1 shows “Only 1 left” to every shopper who looks.')),

    rows.length
      ? el('div', { class: 'table-wrap' },
        el('table', { class: 'table' },
          el('thead', null, el('tr', null,
            ['Who / what', 'Status', 'Hours left', 'Finishes', 'Ship by', 'Spare', ''].map((h) => el('th', { text: h })))),
          el('tbody', null, rows.map((row) => el('tr', { class: row.late ? 'row-late' : '' },
            el('td', null,
              el('strong', { text: label(row.commission.type) }),
              row.commission.size ? el('span', { class: 'muted small', text: ` ${row.commission.size}` }) : null,
              row.commission.quoted_price ? el('span', { class: 'muted small', text: ` · ${money(row.commission.quoted_price)}` }) : null),
            el('td', null, pill(label(row.commission.status), row.commission.status === 'in_progress' ? 'ok' : 'muted')),
            el('td', { text: String(Math.round(row.hours)) }),
            el('td', { class: row.late ? 'bad-text' : '', text: dateOnly(row.projectedFinish) }),
            el('td', { text: row.shipBy ? dateOnly(row.shipBy) : '—' }),
            el('td', null, row.daysSpare === null
              ? el('span', { class: 'muted', text: '—' })
              : el('strong', { class: row.late ? 'bad-text' : 'ok-text', text: `${row.daysSpare} days` })),
            el('td', null, el('button', {
              class: 'btn ghost small', type: 'button',
              onClick: () => openCommission(row.commission, settings, reload),
            }, 'Edit'))))))) 
      : el('p', { class: 'empty' }, 'Nothing in the queue.'),

    closed.length
      ? el('details', { class: 'filter-drawer' },
        el('summary', null, `Finished and cancelled (${closed.length})`),
        el('ul', { class: 'link-list' }, closed.map((c) => el('li', null,
          el('button', { class: 'linkish', type: 'button', onClick: () => openCommission(c, settings, reload) },
            `${label(c.type)} — ${label(c.status)}`)))))
      : null);
}

function openCommission(existing, settings, reload) {
  const draft = existing
    ? structuredClone(existing)
    : { type: 'pet', subject_count: 1, status: 'inquiry', estimated_hours: settings.typical_commission_hours };

  const text = (key, labelText, hint) => field(labelText, el('input', {
    type: 'text', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value || null; },
  }), hint);

  const num = (key, labelText, hint) => field(labelText, el('input', {
    type: 'number', step: 'any', inputMode: 'decimal', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value === '' ? null : Number(e.target.value); },
  }), hint);

  const date = (key, labelText, hint) => field(labelText, el('input', {
    type: 'date', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value || null; },
  }), hint);

  const dialog = el('dialog', { class: 'sheet' },
    el('form', { class: 'sheet-body', onSubmit: async (event) => {
      event.preventDefault();
      if (existing) await saveCommission(draft);
      else await createCommission(draft);
      dialog.close();
      toast('Saved', 'ok');
      reload();
    } },
      el('h2', { text: existing ? 'Commission' : 'New commission' }),
      el('div', { class: 'two-up' },
        field('Type', select(COMMISSION_TYPE.map((t) => [t, label(t)]), draft.type, {
          onChange: (e) => { draft.type = e.target.value; },
        })),
        field('Status', select(COMMISSION_STATUS.map((t) => [t, label(t)]), draft.status, {
          onChange: (e) => { draft.status = e.target.value; },
        }))),
      el('div', { class: 'two-up' }, num('subject_count', 'Subjects'), text('size', 'Size')),
      el('div', { class: 'two-up' }, num('quoted_price', 'Quoted ($)'), num('deposit_paid', 'Deposit ($)')),
      el('div', { class: 'two-up' },
        num('estimated_hours', 'Estimated hours', 'Drives the whole queue.'),
        num('actual_hours', 'Hours done so far')),
      el('div', { class: 'two-up' }, date('due_date', 'They need it by'), date('ship_by', 'Ship by')),
      field('Rights flags', el('div', { class: 'chips' }, RIGHTS_FLAG.map((flag) => el('label', { class: 'chip' },
        el('input', {
          type: 'checkbox', checked: (draft.rights_flags ?? []).includes(flag),
          onChange: (e) => {
            const flags = new Set(draft.rights_flags ?? []);
            if (e.target.checked) flags.add(flag); else flags.delete(flag);
            draft.rights_flags = [...flags];
          },
        }),
        el('span', { text: label(flag) })))),
        'A customer’s own athlete is their photo; a professional is a likeness.'),
      field('Reference notes', el('textarea', {
        rows: 2, value: draft.reference_notes ?? '',
        onInput: (e) => { draft.reference_notes = e.target.value || null; },
      }), 'Is the photo good enough to carve?'),
      field('Notes', el('textarea', {
        rows: 2, value: draft.notes ?? '',
        onInput: (e) => { draft.notes = e.target.value || null; },
      })),
      el('div', { class: 'row end' },
        existing ? el('button', { class: 'btn danger ghost', type: 'button', onClick: async () => {
          const ok = await confirmDialog('Delete this commission?', { confirmText: 'Delete' });
          if (!ok) return;
          await deleteCommission(existing.id);
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
