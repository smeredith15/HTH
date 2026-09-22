// Sync screen (SPEC §4.5 and Phase 7).
//
// Setup is deliberately a form and not a wizard: four fields, one passphrase,
// and a plain statement of what is being trusted to what. The two warnings on
// this screen — lose the passphrase and the data is gone, learn the passphrase
// and you have everything — are the whole security model, so neither of them
// is tucked into a details drawer.

import { el, mount, field, toast, confirmDialog, relativeDays, dateOnly } from '../ui/dom.js';
import {
  loadConfig, saveConfig, forgetConfig, readState, isConfigured, isUnlocked, lock,
  unlockWithPassphrase, hasRemoteKeyfile, syncNow, pullNow, pushNow, onSyncStatus,
  startAutoSync, stopAutoSync, SETTLE_MS, WrongPassphraseError,
} from '../store/sync-runner.js';
import { checkPassphrase } from '../store/crypto.js';
import { readableBytes } from '../images/resize.js';
import { exportSize } from '../store/db.js';

export async function renderSync(host) {
  const config = await loadConfig();
  const state = await readState();
  const configured = await isConfigured();
  const photos = await exportSize();
  const log = el('div', { class: 'sync-log' });

  const reload = () => renderSync(host);

  mount(host,
    el('div', { class: 'view-head' }, el('div', null,
      el('h1', null, 'Sync'),
      el('p', { class: 'muted' },
        'Every device keeps its own copy. This commits an encrypted copy to GitHub so they agree.'))),

    el('section', { class: 'panel alert warn' },
      el('strong', null, 'Read this once. '),
      'The passphrase is the only thing protecting this. There is no reset and no recovery: '
      + 'lose it and the synced copy is unreadable forever, and anyone who learns it has every '
      + 'price, customer and photograph. Use a long one you do not use anywhere else, and keep '
      + 'exporting to a file as well.'),

    el('section', { class: 'panel alert warn' },
      el('strong', null, 'Sync into a second, private repository. '),
      'Not the one serving the portfolio. That one is public, so anything committed to it can be '
      + 'downloaded by anyone — encrypted, but downloaded, and then guessed at offline for as long '
      + 'as they like. It would also put a commit in the portfolio’s history every time you edited '
      + 'a price, and rebuild the site each time. '),
    el('section', { class: 'panel filter-drawer' },
      el('details', null,
        el('summary', null, 'How to make the sync repository'),
        el('ol', { class: 'guide-list' },
          el('li', null, 'On GitHub: New repository, named something like ', el('code', null, 'hth-sync'), '.'),
          el('li', null, el('strong', null, 'Private'), '. Private repositories are free and unlimited.'),
          el('li', null, el('strong', null, 'Tick “Add a README file.”'),
            ' A repository with no commits has no branch, and there is nothing for sync to write onto.'),
          el('li', null, 'Then make the token above, with Repository access: only select repositories → this new one.')),
        el('p', { class: 'hint' },
          'This changes nothing about the portfolio. It stays public, Pages keeps deploying from it, '
          + 'and none of that needs a paid plan. The sync repository is never served to anyone — the '
          + 'app reads and writes it through the API with your token.'))),

    statusPanel(config, state, configured, log, reload),
    unlockPanel(config, configured, log, reload),
    setupPanel(config, configured, reload),
    whatItCosts(photos),
    dangerPanel(configured, reload));

  startStatusFeed(log);
}

// --- what is happening right now -------------------------------------------

function statusPanel(config, state, configured, log, reload) {
  if (!configured) return null;
  const unlocked = isUnlocked();

  // Refreshed in place after a sync. Rebuilding the panel would take the log
  // with it, and the log is the only record of what just happened.
  const when = el('p', { class: 'hint' });
  const refresh = async () => {
    const now = await readState();
    when.textContent = (now.last_pushed_at
      ? `Last pushed ${relativeDays(daysSince(now.last_pushed_at))} (${dateOnly(now.last_pushed_at)}).`
      : 'Nothing has been pushed from this device yet.')
      + (now.last_pulled_at ? ` Last pulled ${dateOnly(now.last_pulled_at)}.` : '');
  };
  when.textContent = (state.last_pushed_at
    ? `Last pushed ${relativeDays(daysSince(state.last_pushed_at))} (${dateOnly(state.last_pushed_at)}).`
    : 'Nothing has been pushed from this device yet.')
    + (state.last_pulled_at ? ` Last pulled ${dateOnly(state.last_pulled_at)}.` : '');

  return el('section', { class: `panel alert ${state.last_error ? 'bad' : unlocked ? 'ok' : 'warn'}` },
    el('h2', null, 'Status'),
    el('p', null,
      `${config.owner}/${config.repo}`,
      el('span', { class: 'muted', text: ` · ${config.branch || 'main'}` })),
    when,
    state.last_error ? el('p', { class: 'warn-text', text: state.last_error }) : null,

    unlocked
      ? el('div', { class: 'row' },
        el('button', { class: 'btn primary', type: 'button', onClick: () => run(log, 'Syncing', () => syncNow(progress(log)), refresh) }, 'Sync now'),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => run(log, 'Pulling', () => pullNow(progress(log)), refresh) }, 'Pull only'),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => run(log, 'Pushing', () => pushNow(progress(log)), refresh) }, 'Push only'),
        el('button', { class: 'btn ghost', type: 'button', onClick: () => { lock(); stopAutoSync(); toast('Locked. The key is out of memory.'); reload(); } }, 'Lock'))
      : null,

    unlocked
      ? el('p', { class: 'hint' },
        config.auto
          ? `Auto-sync is on: edits are pushed about ${Math.round(SETTLE_MS / 1000)} seconds after you stop making them, and when the tab is hidden.`
          : 'Auto-sync is off. Nothing leaves this device until you press Sync now.')
      : null,
    log);
}

// --- the passphrase ---------------------------------------------------------

function unlockPanel(config, configured, log, reload) {
  if (!configured || isUnlocked()) return null;

  const input = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Sync passphrase' });
  const advice = el('p', { class: 'hint' });
  // Only shown while choosing one. A device joining an existing keyfile has to
  // type what was already used, and being told it is too short would be both
  // wrong and useless.
  input.addEventListener('input', () => {
    const verdict = checkPassphrase(input.value);
    advice.className = verdict.ok ? 'hint' : 'hint warn-text';
    advice.textContent = input.value ? (verdict.reason ?? `${input.value.length} characters. Good.`) : '';
  });

  const submit = async (event) => {
    event?.preventDefault();
    const passphrase = input.value;
    if (!passphrase) return;
    const busy = toast('Deriving the key…');
    try {
      const remote = await hasRemoteKeyfile(config);
      if (!remote) {
        const verdict = checkPassphrase(passphrase);
        if (!verdict.ok) { toast(verdict.reason, 'warn'); return; }
        const ok = await confirmDialog(
          'That repository has no keyfile yet, so this device would be the first one, and this '
          + 'passphrase becomes the one every other device has to use.\n\n'
          + 'Write it down somewhere that is not this app before you continue. There is no reset: '
          + 'lose it and the synced copy cannot be opened by anyone, including me.',
          { confirmText: 'I have written it down', tone: 'primary' },
        );
        if (!ok) return;
      }
      await unlockWithPassphrase(passphrase, { create: !remote });
      input.value = '';
      if (config.auto) startAutoSync();
      toast(remote ? 'Unlocked.' : 'Keyfile written. This device is now the first.', 'ok');
      reload();
    } catch (err) {
      toast(err instanceof WrongPassphraseError ? 'Wrong passphrase.' : err.message, 'warn');
    } finally {
      busy?.remove?.();
    }
  };

  return el('form', { class: 'panel', onSubmit: submit },
    el('h2', null, 'Unlock'),
    el('p', { class: 'hint' },
      'The passphrase is never stored, so it is asked for once each time the app is opened. '
      + 'Deriving the key takes a second on purpose — that is what makes it expensive to guess.'),
    field('Passphrase', input),
    advice,
    el('div', { class: 'row' }, el('button', { class: 'btn primary', type: 'submit' }, 'Unlock')));
}

// --- setup ------------------------------------------------------------------

function setupPanel(config, configured, reload) {
  const draft = { ...config };
  const text = (key, labelText, hint, type = 'text') => field(labelText, el('input', {
    type, value: draft[key] ?? '', autocomplete: 'off',
    onInput: (e) => { draft[key] = e.target.value.trim(); },
  }), hint);

  return el('details', { class: 'panel filter-drawer', open: !configured },
    el('summary', null, configured ? 'Change the repository or token' : 'Set sync up'),

    el('p', { class: 'hint' },
      'The token is a fine-grained personal access token, scoped to this one repository, '
      + 'with Contents: read and write and nothing else. It is kept in this browser and is '
      + 'never exported, never synced and never committed.'),
    el('p', { class: 'hint' },
      el('a', {
        href: 'https://github.com/settings/personal-access-tokens/new',
        target: '_blank', rel: 'noopener noreferrer',
      }, 'Make one on GitHub ↗'),
      ' — Repository access: only select repositories; Permissions: Contents → Read and write.'),

    el('div', { class: 'two-up' },
      text('owner', 'Owner', 'The GitHub account, e.g. smeredith15'),
      text('repo', 'Repository', 'A private one, e.g. hth-sync — not the public HTH')),
    el('div', { class: 'two-up' },
      text('branch', 'Branch', 'Usually main'),
      text('token', 'Token', 'github_pat_…', 'password')),

    el('label', { class: 'check' },
      el('input', {
        type: 'checkbox', checked: draft.auto !== false,
        onChange: (e) => { draft.auto = e.target.checked; },
      }),
      el('span', null, 'Push automatically after edits settle')),

    el('div', { class: 'row' },
      el('button', {
        class: 'btn primary', type: 'button',
        onClick: async () => {
          if (!draft.owner || !draft.repo || !draft.token) {
            toast('Owner, repository and token are all needed.', 'warn');
            return;
          }
          try {
            await hasRemoteKeyfile(draft);
          } catch (err) {
            toast(err.message, 'warn');
            return;
          }
          await saveConfig(draft);
          toast('Saved. Now unlock with your passphrase.', 'ok');
          reload();
        },
      }, 'Save')));
}

// --- what it will cost -------------------------------------------------------

function whatItCosts(photos) {
  return el('details', { class: 'panel filter-drawer' },
    el('summary', null, 'What gets committed'),
    el('ul', { class: 'guide-list' },
      el('li', null, el('strong', null, 'data/sync/keyfile.json'),
        ' — the salt and a verifier. Not secret, and not enough to read anything.'),
      el('li', null, el('strong', null, 'data/sync/records.enc.json'),
        ' — every artwork, listing, sale, customer, commission and expense, encrypted. '
        + 'Rewritten on every sync; a couple of hundred KB.'),
      el('li', null, el('strong', null, 'data/sync/photos/<piece>.enc.json'),
        ' — one file per piece that has photographs, encrypted, written only when that '
        + 'piece’s photos change. '
        + (photos.photos
          ? `About ${readableBytes(Math.round(photos.photoBytes * 4 / 3))} in total from this device today.`
          : 'Nothing yet — no photographs on this device.'))),
    el('p', { class: 'hint' },
      'GitHub sees ciphertext and file sizes. It never sees a title, a price, a customer or a photograph. '
      + 'What it can tell from the outside is how many pieces have photos and roughly how big they are.'),
    el('p', { class: 'hint' },
      'A piece deleted on one device is not deleted on the others. Merging keeps whichever record is newer '
      + 'and never removes one, because a sync bug that deletes work is worse than a stale row.'));
}

function dangerPanel(configured, reload) {
  if (!configured) return null;
  return el('section', { class: 'panel' },
    el('h2', null, 'Disconnect'),
    el('p', { class: 'hint' },
      'Forgets the token and this device’s sync state. Nothing on GitHub is touched, and nothing '
      + 'in this browser’s catalog is touched.'),
    el('div', { class: 'row end' },
      el('button', {
        class: 'btn danger ghost', type: 'button',
        onClick: async () => {
          const ok = await confirmDialog('Forget the token and stop syncing this device?', { confirmText: 'Disconnect' });
          if (!ok) return;
          stopAutoSync();
          await forgetConfig();
          toast('Disconnected.');
          reload();
        },
      }, 'Disconnect this device')));
}

// --- plumbing ----------------------------------------------------------------

const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

const progress = (log) => ({ onProgress: (message) => line(log, message) });

function line(log, message) {
  log.prepend(el('p', { class: 'muted small', text: message }));
  while (log.childElementCount > 8) log.lastElementChild.remove();
}

async function run(log, verb, fn, refresh = () => {}) {
  line(log, `${verb}…`);
  try {
    const result = await fn();
    const pulled = result.pulled ?? result;
    const pushed = result.pushed ?? result;
    const parts = [];
    if (pulled.summary) {
      const { added, updated } = pulled.summary;
      parts.push(added || updated ? `pulled ${added} new and ${updated} updated` : 'nothing new to pull');
    }
    if (pushed.records) {
      const bundles = (pushed.bundles ?? []).length;
      parts.push(bundles
        ? `pushed the records and ${bundles} photo bundle${bundles === 1 ? '' : 's'}`
        : 'pushed the records');
    }
    line(log, `Done — ${parts.join(', ')}.`);
    for (const skip of pushed.skipped ?? []) {
      line(log, `Skipped ${skip.id}: ${skip.reason} (${Math.round(skip.bytes / 1e6)} MB).`);
    }
    for (const conflict of pulled.summary?.conflicts ?? []) {
      line(log, `Conflict on ${conflict.store}/${conflict.id}: ${conflict.reason}. Kept this device's copy.`);
    }
    await refresh();
    toast('Synced.', 'ok');
  } catch (err) {
    console.error(err);
    line(log, err.message);
    toast(err.message, 'warn');
  }
}

let stopFeed = null;
function startStatusFeed(log) {
  stopFeed?.();
  stopFeed = onSyncStatus((status) => {
    if (status.state === 'syncing') line(log, 'Auto-sync: pushing…');
    if (status.state === 'error') line(log, `Auto-sync failed: ${status.message}`);
    if (status.state === 'idle') line(log, 'Auto-sync: up to date.');
  });
}
