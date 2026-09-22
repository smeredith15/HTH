// The money hub. Sales, commissions, expenses, print costs and the pricing
// recommendations all hang off here, so the nav stays at six items.

import { el, mount, money, label, pill } from '../ui/dom.js';
import { listSales, saleNet } from '../store/sales.js';
import { listCommissions, projectQueue, capacity, isOpen } from '../store/commissions.js';
import { listExpenses, yearSummary, yearsPresent } from '../store/expenses.js';
import { listPrintCosts, listPrintVendors } from '../store/print-costs.js';
import { listArtworks } from '../store/artworks.js';
import { listListings } from '../store/listings.js';
import { loadSettings } from '../store/db.js';
import { recommendations, summarise } from '../reports/reprice.js';
import { overallHourly } from '../reports/hourly.js';

export async function renderMoney(host) {
  const [sales, commissions, expenses, costRows, vendors, artworks, listings, settings] = await Promise.all([
    listSales(), listCommissions(), listExpenses(), listPrintCosts(), listPrintVendors(),
    listArtworks(), listListings(), loadSettings(),
  ]);

  const years = yearsPresent(sales, expenses);
  const thisYear = years[0] ?? String(new Date().getFullYear());
  const year = yearSummary(sales, expenses, settings, thisYear);
  const queue = projectQueue(commissions, settings);
  const free = capacity(commissions, settings, { horizon: settings.holiday_cutoff });
  const priced = summarise(recommendations({ artworks, listings, costRows, vendors, settings }));
  const hourly = overallHourly(sales, artworks, settings);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'Money'),
        el('p', { class: 'muted', text: sales.length ? `${year.year} so far` : 'Nothing recorded yet' }))),

    sales.length
      ? el('div', { class: 'stat-row' },
        stat(money(year.gross), 'taken'),
        stat(money(year.profit), 'after fees and costs'),
        stat(hourly.hourly === null ? '—' : money(hourly.hourly), 'an hour at the bench'),
        stat(String(year.orders), 'orders'))
      : el('section', { class: 'panel' },
        el('h2', null, 'Start here'),
        el('p', null, 'Record the sales you have already made and the app can tell you which '
          + 'kind of work actually pays — which is the question §C of the spec is really asking.'),
        el('a', { class: 'btn primary', href: '#/sales' }, 'Record a sale')),

    priced.needsAttention
      ? card('Pricing', `${priced.needsAttention} price${priced.needsAttention === 1 ? '' : 's'} need attention`,
        priced.losing ? `${priced.losing} losing money on every sale` : `${money(priced.perSale)} a sale left on the table`,
        '#/reprice', priced.losing ? 'bad' : 'warn')
      : null,

    el('div', { class: 'two-up' },
      card('Sales', `${sales.length} recorded`,
        sales.length ? `${money(sales.reduce((t, s) => t + saleNet(s, settings), 0))} net, all time` : 'Quick sale takes three taps',
        '#/sales'),
      card('Commissions', `${commissions.filter(isOpen).length} open`,
        capacityLine(free, queue), '#/commissions')),

    el('div', { class: 'two-up' },
      card('Expenses', `${money(year.expenses)} in ${year.year}`,
        expenses.length ? `${year.byCategory[0]?.category ? label(year.byCategory[0].category) : ''} is the biggest` : 'Wood, stain, frames, booth fees',
        '#/expenses'),
      card('Print costs', `${costRows.filter((r) => Number(r.unit_cost) > 0).length} sizes priced`,
        'What each lab charges, and what you have to charge', '#/print-costs')),

    card('What pays', hourly.hourly === null ? 'Needs hours on your sales' : `${money(hourly.hourly)} an hour, pooled`,
      hourly.unrated ? `${hourly.unrated} sale${hourly.unrated === 1 ? '' : 's'} without hours cannot be counted` : 'By category, by faces, by who bought it',
      '#/reports'));
}

function capacityLine(free, queue) {
  const late = queue.rows.filter((r) => r.late).length;
  if (late) return `${late} cannot finish in time`;
  if (free.canAccept === null) return 'Set a holiday cutoff to see capacity';
  return `Can accept ${free.canAccept} more before ${free.horizon}`;
}

function stat(value, text) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-value', text: String(value) }),
    el('span', { class: 'stat-label', text }));
}

function card(title, headline, sub, href, tone = '') {
  return el('a', { class: `panel hub-card ${tone}`.trim(), href },
    el('h2', { text: title }),
    el('p', { class: 'hub-headline', text: headline }),
    el('p', { class: 'muted small', text: sub }),
    tone ? pill(tone === 'bad' ? 'needs doing' : 'worth a look', tone) : null);
}
