// The expense ledger — not in the spec, added at the owner's request so the
// app can answer "did this year make money" rather than only "what did this
// one sale make".

import { getAll, get, put, remove } from './db.js';
import { newExpense, uniqueId } from './schema.js';
import { saleNet } from './sales.js';

export const listExpenses = () => getAll('expenses');
export const getExpense = (id) => get('expenses', id);
export const deleteExpense = (id) => remove('expenses', id);

export async function saveExpense(expense) {
  const record = { ...expense, updated_at: new Date().toISOString() };
  await put('expenses', record);
  return record;
}

export async function createExpense(patch = {}) {
  const taken = new Set((await listExpenses()).map((e) => e.id));
  const expense = newExpense(patch);
  expense.id = uniqueId(expense.id || `exp-${expense.date}-${Date.now().toString(36)}`, taken);
  return saveExpense(expense);
}

export const yearOf = (isoDate) => String(isoDate ?? '').slice(0, 4);

export function totalsByCategory(expenses, year = null) {
  const totals = new Map();
  for (const expense of expenses) {
    if (year && yearOf(expense.date) !== String(year)) continue;
    const amount = Number(expense.amount) || 0;
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + amount);
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount: round(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * The year in one line. Sale net already has that sale's own materials and
 * fees taken out, so counting a materials expense here as well would charge it
 * twice — link an expense to an artwork only when it is *not* in that piece's
 * materials_cost.
 */
export function yearSummary(sales, expenses, settings, year) {
  const inYear = (d) => yearOf(d) === String(year);
  const yearSales = sales.filter((s) => inYear(s.date));
  const yearExpenses = expenses.filter((e) => inYear(e.date));

  const gross = yearSales.reduce((t, s) => t + (Number(s.gross_price) || 0), 0);
  const net = yearSales.reduce((t, s) => t + saleNet(s, settings), 0);
  const spent = yearExpenses.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const hours = yearSales.reduce((t, s) => t + (Number(s.hours) || 0), 0);

  return {
    year: String(year),
    orders: yearSales.length,
    gross: round(gross),
    net: round(net),
    expenses: round(spent),
    profit: round(net - spent),
    hours: round(hours),
    hourly: hours ? round((net - spent) / hours) : null,
    byCategory: totalsByCategory(yearExpenses),
  };
}

export function yearsPresent(sales, expenses) {
  const years = new Set();
  for (const row of [...sales, ...expenses]) {
    const year = yearOf(row.date);
    if (year) years.add(year);
  }
  return [...years].sort().reverse();
}

function round(value) { return Math.round(value * 100) / 100; }
