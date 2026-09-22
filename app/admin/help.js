// How this app works, in the app (SPEC §4.2 asks for the storage warning to be
// said plainly once; the rest is here because a README on github.com is not
// where anyone looks while holding a phone in a studio).

import { el, mount } from '../ui/dom.js';

export async function renderHelp(host) {
  mount(host,
    el('div', { class: 'view-head' },
      el('div', null,
        el('h1', null, 'How this works'),
        el('p', { class: 'muted' }, 'The short version of everything.'))),

    section('What this is', [
      p('A catalogue of every piece you have made — what it is, what it cost, '
        + 'what it earned, and whether it can still be printed. It runs entirely '
        + 'in this browser. There is no server and nothing is uploaded anywhere.'),
      p('It is also where Etsy listing copy gets written, so the specs in a '
        + 'description always match the specs in the record.'),
    ]),

    section('Where your photos live', [
      p('When you add a photo, the app makes two copies and keeps them here: a '
        + '2,000 px version for the web and a 600 px thumbnail. Tap any thumbnail '
        + 'to see the full-size copy, or download it back out.'),
      p(el('strong', null, 'The original is not kept.'), ' A phone photo is far too '
        + 'big to store, so the app reads its pixel size and discards it. That size '
        + 'is the important part: it decides how large the piece can ever be printed.'),
      p(el('strong', null, 'The full-resolution master is a record, not a file.'), ' '
        + 'It stays on your drive or in cloud storage. The print-master registry on '
        + 'each piece records where you put it and how many pixels it has, so you can '
        + 'find it and know what it supports.'),
      callout('So: the app holds pictures you can look at, and a note saying where '
        + 'the printable original is.'),
    ]),

    section('Using it on more than one device', [
      p('There is no server, so nothing syncs by itself. What moves between '
        + 'devices is the export file.'),
      steps('Move everything to another device', [
        'Backup → Export everything, with photos. Put the file somewhere both devices can reach — a cloud drive is easiest.',
        'On the other device, open the app, then Backup → Preview a merge and pick the file.',
        'Merge keeps whichever copy of each record was edited last, and tells you about anything that changed on both.',
      ]),
      p('Photographs make the file big, so there is also a records-only export '
        + 'for a quick copy. It never deletes photos on the device you import it '
        + 'into — it simply says nothing about them.'),
      callout('Whichever device you photograph on is the one holding those pictures '
        + 'until you export. Export after a photography session, not before.'),
    ]),

    section('The six sections', [
      el('dl', { class: 'spec-list' },
        row('Home', 'What needs attention right now, and how long since you last backed up.'),
        row('Catalog', 'Every piece. Search, filter, add. Tap a piece for its full record and its photos.'),
        row('Listings', 'Etsy titles, tags and descriptions, with every check running as you type.'),
        row('Money', 'Sales, commissions, expenses, print costs, pricing and what actually pays.'),
        row('Backup', 'Export everything to a file. Import it back.'),
        row('Settings', 'Your hourly rate, Etsy fees, description templates, the trademark blocklist.')),
    ]),

    section('Doing the usual things', [
      steps('Add a piece you just made', [
        'Catalog → Quick add. A title is all it needs.',
        'Fill in the rest whenever — the record shows you what is missing.',
      ]),
      steps('Photograph a piece', [
        'Open the piece, find Photographs, tap Add on the straight-on row.',
        'The app resizes it on this device. Nothing is uploaded.',
        'Say yes when it offers to record the print master — that is the number that decides your maximum print size.',
        'Write the alt text while you are there. Publishing needs it.',
      ]),
      steps('Write an Etsy listing', [
        'Listings → pick one, or + New listing.',
        'Press “Regenerate from the record” for the description. The specs come from the piece, so they cannot drift.',
        'Work the checks at the top until you are happy. None of them stop you.',
        'Copy each field across to Etsy with its copy button.',
      ]),
      steps('Work out what to charge for a print', [
        'Money → Print costs → type what the lab charges into the row for that size.',
        'Money → Pricing then lists every price against what it should be, worst first.',
        'Each suggestion has a button. Nothing changes a price on its own.',
      ]),
      steps('Sell something at a fair', [
        'Money → Sales → Quick sale. Pick the piece, type the price, tap the payment.',
        'It marks the piece sold and takes it off your on-hand list.',
        'Money → Inventory has the pack list for what goes in the van.',
      ]),
      steps('Find out what is worth making', [
        'Record hours on your sales — one number at the end is enough.',
        'Money → What pays shows net divided by hours, by category and by whether the piece has a face.',
        'Only categories with two or more sales are compared. One sale is an anecdote.',
      ]),
      steps('Back up', [
        'Backup → Export everything. Keep the file somewhere that is not this browser.',
        'To restore, or to move to another device: Backup → Preview a merge, pick the file.',
      ]),
    ]),

    section('The one thing that can lose your work', [
      p('Everything lives in this browser’s storage. If you clear site data, or '
        + 'stop opening the app for a long time, a browser is allowed to throw it away. '
        + 'There is no copy on a server, because there is no server.'),
      p(el('strong', null, 'Export regularly.'), ' The exported file is the backup of '
        + 'record. Adding the app to your home screen makes eviction much less likely, '
        + 'but it is not a guarantee.'),
      el('a', { class: 'btn primary', href: '#/backup' }, 'Go and export now'),
    ]),

    section('Not built yet', [
      p('Kiosk mode for a craft-fair tablet, the public portfolio page, publishing '
        + 'to the web, and working offline. Those are the phases still to come.'),
    ]));
}

const p = (...children) => el('p', null, ...children);

function section(title, children) {
  return el('section', { class: 'panel' }, el('h2', { text: title }), ...children);
}

function callout(text) {
  return el('p', { class: 'alert ok callout', text });
}

function row(term, value) {
  return el('div', { class: 'spec-row' }, el('dt', { text: term }), el('dd', { text: value }));
}

function steps(title, items) {
  return el('div', { class: 'howto' },
    el('h3', { text: title }),
    el('ol', null, items.map((i) => el('li', { text: i }))));
}
