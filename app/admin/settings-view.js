// Settings (SPEC §5.10).

import { el, mount, field, toast, label } from '../ui/dom.js';
import { loadSettings, saveSettings } from '../store/db.js';
import { DEFAULT_SETTINGS, feeRate } from '../store/settings.js';

export async function renderSettings(host) {
  const settings = await loadSettings();
  const draft = structuredClone(settings);

  const num = (key, labelText, hint, step = 'any') => field(labelText, el('input', {
    type: 'number', step, inputMode: 'decimal', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value === '' ? null : Number(e.target.value); },
  }), hint);

  const text = (key, labelText, hint) => field(labelText, el('input', {
    type: 'text', value: draft[key] ?? '',
    onInput: (e) => { draft[key] = e.target.value || null; },
  }), hint);

  const bool = (key, labelText) => el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked: !!draft[key], onChange: (e) => { draft[key] = e.target.checked; } }),
    el('span', { text: labelText }));

  mount(host, el('form', { class: 'form',
    onSubmit: async (event) => {
      event.preventDefault();
      await saveSettings(draft);
      toast('Settings saved', 'ok');
    } },

    el('div', { class: 'view-head' },
      el('div', null, el('h1', null, 'Settings')),
      el('button', { class: 'btn primary', type: 'submit' }, 'Save')),

    el('section', { class: 'panel' },
      el('h2', null, 'Your rate'),
      num('target_hourly', 'Target hourly ($)', 'Used for every price floor.'),
      num('hours_per_week', 'Hours a week at the bench', 'Used for commission capacity.'),
      num('default_shipping_estimate', 'Default shipping estimate ($)', 'Part of the price floor. Not in the spec — see DECISIONS.md.')),

    el('section', { class: 'panel' },
      el('h2', null, 'Etsy fees'),
      el('p', { class: 'hint' }, `Defaults reflect Etsy's published schedule as of mid-2026. Etsy changes these.`),
      el('p', null, el('a', {
        href: 'https://www.etsy.com/legal/fees', target: '_blank', rel: 'noopener noreferrer',
      }, 'Verify against Etsy’s current fees →')),
      el('div', { class: 'two-up' },
        num('etsy_transaction_pct', 'Transaction (%)'),
        num('etsy_processing_pct', 'Payment processing (%)')),
      el('div', { class: 'two-up' },
        num('etsy_processing_fixed', 'Processing fixed ($)', null, '0.01'),
        num('etsy_listing_fee', 'Listing fee ($)', null, '0.01')),
      bool('offsite_ads_enrolled', 'Enrolled in Offsite Ads'),
      el('p', { class: 'hint' }, 'Optional while trailing-365-day sales are under $10,000. Above that the rate drops to 12% and enrolment becomes permanent.'),
      el('div', { class: 'two-up' },
        num('offsite_ads_pct', 'Offsite Ads (%)'),
        num('offsite_ads_cap', 'Offsite Ads cap per order ($)')),
      el('p', { class: 'hint' }, `Combined fee rate: ${(feeRate(draft) * 100).toFixed(1)}%, or ${(feeRate(draft, { includeOffsiteAds: true }) * 100).toFixed(1)}% when Offsite Ads take an order.`)),

    el('section', { class: 'panel' },
      el('h2', null, 'Shop'),
      text('shop_url', 'Shop URL'),
      text('custom_listing_url', 'Custom-order listing URL', 'The kiosk commissions screen points its QR code here.')),

    el('section', { class: 'panel' },
      el('h2', null, 'Kiosk'),
      el('p', { class: 'hint' }, 'The PIN is a UI lock to keep fair visitors out of the admin screens. It is not security — anyone with the device and a browser console can read the data behind it.'),
      field('Kiosk PIN', el('input', {
        type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8,
        value: draft.kiosk_pin ?? '',
        onInput: (e) => { draft.kiosk_pin = e.target.value || null; },
      })),
      num('kiosk_idle_seconds', 'Return to home after (seconds)'),
      bool('kiosk_show_sold', 'Show sold pieces in the kiosk')),

    el('section', { class: 'panel' },
      el('h2', null, 'Commission prices'),
      el('table', { class: 'table' },
        el('thead', null, el('tr', null, ['Size', 'Subjects', 'Price'].map((h) => el('th', { text: h })))),
        el('tbody', null, draft.commission_prices.map((row, i) => el('tr', null,
          el('td', null, el('input', { type: 'text', value: row.size, onInput: (e) => { draft.commission_prices[i].size = e.target.value; } })),
          el('td', null, el('input', { type: 'number', value: row.subjects, onInput: (e) => { draft.commission_prices[i].subjects = Number(e.target.value); } })),
          el('td', null, el('input', {
            type: 'number', step: '0.01', value: row.price ?? '', placeholder: 'quote',
            onInput: (e) => { draft.commission_prices[i].price = e.target.value === '' ? null : Number(e.target.value); },
          })))))),
      el('p', { class: 'hint' }, 'Leave a price blank for “quote”. Proposed September 2026 and not yet adopted on Etsy.')),

    el('section', { class: 'panel' },
      el('h2', null, 'Trademark blocklist'),
      el('p', { class: 'hint' }, 'The Phase 2 validators flag any of these in a title, tag, materials list or description. “longhorn” alone is a cattle breed and is fine; “texas longhorns” is the university mark.'),
      field('Terms, one per line', el('textarea', {
        rows: 8, value: draft.trademark_blocklist.join('\n'),
        onInput: (e) => {
          draft.trademark_blocklist = e.target.value.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
        },
      }))),

    el('section', { class: 'panel' },
      el('h2', null, 'Expense categories'),
      field('One per line', el('textarea', {
        rows: 5, value: draft.expense_categories.map(label).join('\n'),
        onInput: (e) => {
          draft.expense_categories = e.target.value.split('\n')
            .map((s) => s.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
        },
      }), 'Used by the budgeting screens in Phase 6.')),

    el('div', { class: 'row end sticky-save' },
      el('button', { class: 'btn ghost', type: 'button', onClick: async () => {
        await saveSettings({ ...DEFAULT_SETTINGS, last_exported_at: draft.last_exported_at });
        toast('Reset to the spec defaults');
        location.reload();
      } }, 'Reset to defaults'),
      el('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
}
