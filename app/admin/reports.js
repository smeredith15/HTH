// What actually pays (SPEC §6.4, §C.2).

import { el, mount, money, label } from '../ui/dom.js';
import { listSales } from '../store/sales.js';
import { listArtworks } from '../store/artworks.js';
import { loadSettings } from '../store/db.js';
import {
  hourlyByCategory, hourlyByFace, hourlyByRelationship, hourlyBySource,
  overallHourly, whatPays,
} from '../reports/hourly.js';

export async function renderReports(host) {
  const [sales, artworks, settings] = await Promise.all([listSales(), listArtworks(), loadSettings()]);
  const overall = overallHourly(sales, artworks, settings);
  const verdict = whatPays(sales, artworks, settings);

  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'What pays'),
        el('p', { class: 'muted' }, 'Net, divided by hours. The number §1.1 says was never visible.')),
      el('a', { class: 'btn ghost', href: '#/money' }, 'Money')),

    overall.hourly === null
      ? el('section', { class: 'panel' },
        el('h2', null, 'Not enough recorded yet'),
        el('p', null, 'Every figure here is net divided by hours, so a sale with no hours on it '
          + 'cannot be counted. Record hours on the pieces you have already sold — one number at the end is enough.'),
        overall.unrated
          ? el('p', { class: 'hint', text: `${overall.unrated} sale${overall.unrated === 1 ? '' : 's'} recorded, none with hours.` })
          : el('a', { class: 'btn primary', href: '#/sales' }, 'Record a sale'))
      : el('section', { class: 'panel alert ok' },
        el('h2', null, 'All in'),
        el('p', null,
          el('strong', { class: overall.hourly < settings.target_hourly ? 'bad-text' : 'ok-text', text: money(overall.hourly) }),
          ` an hour across ${overall.hours} hours and ${overall.sales} sales, `,
          `against a $${settings.target_hourly} target.`),
        overall.unrated
          ? el('p', { class: 'hint', text: `${overall.unrated} more sale${overall.unrated === 1 ? '' : 's'} had no hours recorded and are not counted.` })
          : null),

    verdict
      ? el('section', { class: 'panel alert warn' },
        el('h2', null, 'The difference'),
        el('p', null,
          el('strong', { text: verdict.best.label }), ' pays ',
          el('strong', { class: 'ok-text', text: money(verdict.best.hourly) }), ' an hour. ',
          el('strong', { text: verdict.worst.label }), ' pays ',
          el('strong', { class: 'bad-text', text: money(verdict.worst.hourly) }), '.',
          verdict.best.hourly && verdict.worst.hourly > 0
            ? ` That is ${(verdict.best.hourly / verdict.worst.hourly).toFixed(1)}× the rate for the same hour at the bench.`
            : ''),
        el('p', { class: 'hint' }, 'Only categories with two or more sales are compared — one sale is an anecdote.'))
      : null,

    chart('By category', hourlyByCategory(sales, artworks, settings), settings),
    chart('Faces against everything else', hourlyByFace(sales, artworks, settings), settings),
    chart('By who bought it', hourlyByRelationship(sales, artworks, settings), settings,
      'Most portrait sales so far were to friends, which flatters nothing and distorts the price signal.'),
    chart('By where they came from', hourlyBySource(sales, artworks, settings), settings));
}

function chart(title, rows, settings, hint) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.hourly ?? 0)), settings.target_hourly, 1);
  return el('section', { class: 'panel' },
    el('h2', { text: title }),
    hint ? el('p', { class: 'hint', text: hint }) : null,
    el('ul', { class: 'bars rate-bars' }, rows.map((row) => el('li', null,
      el('span', { class: 'bar-label', text: row.label }),
      el('span', { class: 'bar' },
        el('span', {
          class: `bar-fill ${row.hourly < settings.target_hourly ? 'under' : 'over'}`,
          style: { width: `${Math.max(2, (Math.max(0, row.hourly) / max) * 100)}%` },
        }),
        el('span', { class: 'bar-target', style: { left: `${(settings.target_hourly / max) * 100}%` } })),
      el('span', { class: 'bar-n', text: money(row.hourly) }),
      el('span', { class: 'muted small bar-note', text: `${row.sales} sale${row.sales === 1 ? '' : 's'} · ${row.hours} h` })))),
    el('p', { class: 'hint', text: `The line marks your $${settings.target_hourly} target.` }));
}
