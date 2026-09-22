// Commissions and the queue (SPEC §5.8).
//
// The queue exists so Etsy quantity can go above 1 without risking a missed
// deadline — the shop has been holding custom orders at quantity 1, which
// shows "Only 1 left" to every shopper who looks.

import { getAll, get, put, remove } from './db.js';
import { newCommission, uniqueId, slugify, COMMISSION_OPEN } from './schema.js';
import { withDefaults } from './settings.js';

export const listCommissions = () => getAll('commissions');
export const getCommission = (id) => get('commissions', id);
export const deleteCommission = (id) => remove('commissions', id);

export async function saveCommission(commission) {
  const record = { ...commission, updated_at: new Date().toISOString() };
  await put('commissions', record);
  return record;
}

export async function createCommission(patch = {}) {
  const taken = new Set((await listCommissions()).map((c) => c.id));
  const commission = newCommission(patch);
  commission.id = uniqueId(commission.id || `com-${slugify(commission.type)}-${Date.now().toString(36)}`, taken);
  return saveCommission(commission);
}

export const isOpen = (commission) => COMMISSION_OPEN.includes(commission?.status);

/** Hours still to do: what is left of the estimate once actual hours are in. */
export function remainingHours(commission, settings) {
  const s = withDefaults(settings);
  const estimate = Number(commission?.estimated_hours) || Number(s.typical_commission_hours) || 35;
  const done = Number(commission?.actual_hours) || 0;
  return Math.max(0, estimate - done);
}

function addDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

const iso = (date) => date.toISOString().slice(0, 10);

/**
 * §5.8: work the open commissions in ship_by order, spend `hours_per_week` on
 * each in turn, and see where each one lands. Anything finishing after its
 * ship_by is flagged — that is the number that makes a quantity above 1 safe.
 */
export function projectQueue(commissions, settings, now = new Date()) {
  const s = withDefaults(settings);
  const perWeek = Number(s.hours_per_week) || 1;
  const open = commissions
    .filter(isOpen)
    .sort((a, b) => String(a.ship_by ?? '9999').localeCompare(String(b.ship_by ?? '9999')));

  let cursorHours = 0;
  const rows = open.map((commission) => {
    const hours = remainingHours(commission, s);
    cursorHours += hours;
    const finish = addDays(now, Math.ceil((cursorHours / perWeek) * 7));
    const shipBy = commission.ship_by ? new Date(`${commission.ship_by}T23:59:59`) : null;
    return {
      commission,
      hours,
      cumulativeHours: cursorHours,
      projectedFinish: iso(finish),
      shipBy: commission.ship_by ?? null,
      late: !!shipBy && finish > shipBy,
      daysSpare: shipBy ? Math.floor((shipBy - finish) / 86400000) : null,
    };
  });

  return { rows, totalHours: cursorHours, hoursPerWeek: perWeek };
}

/**
 * §5.8: "Capacity: can accept N more before <date>." N is how many more
 * typical commissions fit in the bench time left before the horizon.
 */
export function capacity(commissions, settings, { horizon = null, now = new Date() } = {}) {
  const s = withDefaults(settings);
  const perWeek = Number(s.hours_per_week) || 1;
  const typical = Number(s.typical_commission_hours) || 35;
  const end = horizon ? new Date(`${horizon}T23:59:59`) : null;
  if (!end || Number.isNaN(end.getTime())) return { horizon: null, canAccept: null, freeHours: null, typical };

  const weeks = Math.max(0, (end - now) / (86400000 * 7));
  const available = weeks * perWeek;
  const committed = projectQueue(commissions, s, now).totalHours;
  const free = available - committed;

  return {
    horizon,
    typical,
    availableHours: Math.round(available),
    committedHours: Math.round(committed),
    freeHours: Math.round(free),
    canAccept: Math.max(0, Math.floor(free / typical)),
  };
}

/** §5.7's report: past commission customers not heard from in six months. */
export function goneQuiet(commissions, customers, { months = 6, now = new Date() } = {}) {
  const cutoff = addDays(now, -Math.round(months * 30.4));
  const byCustomer = new Map();
  for (const commission of commissions) {
    if (!commission.customer_id) continue;
    const when = commission.updated_at ?? commission.created_at;
    const prev = byCustomer.get(commission.customer_id);
    if (!prev || String(when) > String(prev)) byCustomer.set(commission.customer_id, when);
  }
  return customers
    .filter((c) => c.ok_to_contact && byCustomer.has(c.id))
    .map((c) => ({ customer: c, lastSeen: byCustomer.get(c.id) }))
    .filter((row) => new Date(row.lastSeen) < cutoff)
    .sort((a, b) => String(a.lastSeen).localeCompare(String(b.lastSeen)));
}
