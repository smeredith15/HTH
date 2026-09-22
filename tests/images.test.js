import test from 'node:test';
import assert from 'node:assert/strict';
import {
  targetSize, qualitySteps, isProcessable, readableBytes, undecodableFormat, measureFile,
  WEB_EDGE, THUMB_EDGE, WEB_TARGET_BYTES, FALLBACK_EDGES, MIN_QUALITY,
} from '../app/images/resize.js';
import {
  PHOTO_CHECKLIST, SHOOTING_GUIDE, checklistFor, checklistProgress, missingAltText,
  nextImageId, webPathFor, thumbPathFor, unclaimedImages,
} from '../app/images/photos.js';
import {
  newArtwork, photographBeforeItLeaves, snoozeUntil, printLimits,
  imageLongEdge, printSource,
  PRIVATE_IMAGE_FIELDS, PUBLIC_IMAGE_FIELDS,
} from '../app/store/schema.js';

// --- resizing (§5.3) -------------------------------------------------------

test('a 4,000 px photo comes down to 2,000 px on the long edge', () => {
  assert.deepEqual(targetSize(4000, 3000, WEB_EDGE), { width: 2000, height: 1500, scaled: true });
  assert.deepEqual(targetSize(3000, 4000, WEB_EDGE), { width: 1500, height: 2000, scaled: true });
  assert.deepEqual(targetSize(4000, 3000, THUMB_EDGE), { width: 600, height: 450, scaled: true });
});

test('a small file is never enlarged', () => {
  // Upscaling Hooper Strait's 1,440 px file would make the print-size warning lie.
  assert.deepEqual(targetSize(1440, 1080, WEB_EDGE), { width: 1440, height: 1080, scaled: false });
  assert.equal(targetSize(2000, 1500, WEB_EDGE).scaled, false, 'exactly at the limit is left alone');
});

test('the aspect ratio survives', () => {
  for (const [w, h] of [[4032, 3024], [3024, 4032], [5000, 1000], [1000, 5000]]) {
    const out = targetSize(w, h, WEB_EDGE);
    assert.ok(Math.abs((out.width / out.height) - (w / h)) < 0.01, `${w}×${h}`);
    assert.equal(Math.max(out.width, out.height), WEB_EDGE);
  }
});

test('a missing dimension yields nothing rather than NaN', () => {
  assert.equal(targetSize(0, 100, WEB_EDGE), null);
  assert.equal(targetSize(undefined, undefined, WEB_EDGE), null);
});

test('the quality ladder descends and stops', () => {
  const steps = qualitySteps();
  assert.equal(steps[0], 0.82);
  assert.ok(steps[steps.length - 1] >= MIN_QUALITY - 0.01);
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] < steps[i - 1]);
});

test('the fallback edges only ever go down, and stay usable', () => {
  assert.ok(FALLBACK_EDGES.every((e) => e < WEB_EDGE));
  for (let i = 1; i < FALLBACK_EDGES.length; i += 1) {
    assert.ok(FALLBACK_EDGES[i] < FALLBACK_EDGES[i - 1]);
  }
  // Below about 1,400 px a web image stops being worth publishing at all.
  assert.ok(Math.min(...FALLBACK_EDGES) >= 1400);
  assert.ok(MIN_QUALITY >= 0.4, 'quality never drops to mush');
});

test('only images this browser can resize are accepted', () => {
  assert.ok(isProcessable({ type: 'image/jpeg' }));
  assert.ok(isProcessable({ type: 'image/heic' }), 'a Pixel or iPhone may hand over HEIC');
  assert.equal(isProcessable({ type: 'application/pdf' }), false);
  assert.equal(isProcessable({ type: 'image/svg+xml' }), false);
  assert.equal(isProcessable(null), false);
});

test('the web budget is the 600 KB the spec asks for', () => {
  assert.equal(WEB_TARGET_BYTES, 600 * 1024);
  assert.equal(readableBytes(600 * 1024), '600 KB');
  assert.equal(readableBytes(12_500_000), '11.9 MB');
  assert.equal(readableBytes(NaN), '—');
});

// --- the checklist (§6.2) --------------------------------------------------

test('the checklist is the seven shots, in order', () => {
  assert.equal(PHOTO_CHECKLIST.length, 7);
  assert.equal(PHOTO_CHECKLIST[0].role, 'straight_on');
  assert.equal(PHOTO_CHECKLIST[0].required, true, 'the print master depends on it');
  const process = PHOTO_CHECKLIST.find((c) => c.role === 'process');
  assert.equal(process.optional, true, '§2.1: never require process documentation');
  assert.ok(SHOOTING_GUIDE.length >= 5);
  assert.ok(SHOOTING_GUIDE.some((l) => /messaging apps/i.test(l)), 'the compression warning matters');
});

test('progress counts only the shots that matter', () => {
  const bare = newArtwork({ title: 'x' });
  assert.deepEqual(checklistProgress(bare), { done: 0, total: 6, pct: 0 });

  const some = newArtwork({ title: 'x', images: [
    { id: 'straight_on', role: 'straight_on' },
    { id: 'process', role: 'process' },
  ] });
  const progress = checklistProgress(some);
  assert.equal(progress.done, 1, 'the process shot is not counted towards done');
  assert.equal(progress.total, 6);
});

test('the checklist pairs each role with its photo', () => {
  const artwork = newArtwork({ title: 'x', images: [{ id: 'in_room', role: 'in_room', alt: 'on a wall' }] });
  const rows = checklistFor(artwork);
  assert.equal(rows.find((r) => r.role === 'in_room').image.alt, 'on a wall');
  assert.equal(rows.find((r) => r.role === 'signature').image, null);
});

// A role is not a single slot. Two photos on one role once made the spare
// disappear from the panel altogether: the row took the first with .find, and
// the extras list only caught roles that were off the checklist. The photo was
// unreachable and the record looked thinner than it was.
test('a role holds as many photos as it is given', () => {
  const artwork = newArtwork({ title: 'x', images: [
    { id: 'straight_on', role: 'straight_on' },
    { id: 'straight_on-2', role: 'straight_on' },
    { id: 'detail_raking', role: 'detail_raking' },
  ] });
  const rows = checklistFor(artwork);
  const straight = rows.find((r) => r.role === 'straight_on');
  assert.deepEqual(straight.images.map((i) => i.id), ['straight_on', 'straight_on-2']);
  assert.equal(straight.image.id, 'straight_on', 'the first is what the meter reads');
  assert.equal(checklistProgress(artwork).done, 2, 'a second photo on a role is not a second shot');
  assert.deepEqual(unclaimedImages(artwork), [], 'neither of them is homeless');
});

test('an off-checklist role is handed back as an extra', () => {
  const artwork = newArtwork({ title: 'x', images: [
    { id: 'packed', role: 'other' },
    { id: 'straight_on', role: 'straight_on' },
  ] });
  assert.deepEqual(unclaimedImages(artwork).map((i) => i.id), ['packed']);
});

test('alt text is tracked because publishing needs it', () => {
  const artwork = newArtwork({ title: 'x', images: [
    { id: 'a', role: 'straight_on', alt: 'a lighthouse' },
    { id: 'b', role: 'in_room', alt: '' },
    { id: 'c', role: 'scale', alt: '   ' },
  ] });
  assert.deepEqual(missingAltText(artwork).map((i) => i.id), ['b', 'c']);
});

test('image ids are readable and never collide', () => {
  const artwork = newArtwork({ title: 'x', images: [{ id: 'straight_on' }, { id: 'straight_on-2' }] });
  assert.equal(nextImageId(artwork, 'straight_on'), 'straight_on-3');
  assert.equal(nextImageId(artwork, 'in_room'), 'in_room');
});

test('paths land under the artwork, ready for Phase 4 to publish', () => {
  assert.equal(webPathFor('hooper-strait-lighthouse', 'straight_on'), 'images/hooper-strait-lighthouse/straight_on.jpg');
  assert.equal(thumbPathFor('hooper-strait-lighthouse', 'straight_on'), 'images/hooper-strait-lighthouse/straight_on-thumb.jpg');
});

// --- the prompt that matters most (§6.2) -----------------------------------

test('a piece on hand with no straight-on photo prompts', () => {
  const artwork = newArtwork({ title: 'Blue crab', on_hand: true });
  assert.equal(photographBeforeItLeaves(artwork).showing, true);
});

test('the prompt goes quiet once the photo exists, or the piece is gone', () => {
  const shot = newArtwork({ title: 'x', on_hand: true, images: [{ id: 'a', role: 'straight_on' }] });
  assert.equal(photographBeforeItLeaves(shot), null);
  const gone = newArtwork({ title: 'x', on_hand: false });
  assert.equal(photographBeforeItLeaves(gone), null);
});

test('snoozing silences it, and only until the date', () => {
  const now = new Date('2026-09-22T00:00:00Z');
  const artwork = newArtwork({
    title: 'x', on_hand: true, photo_prompt_snoozed_until: snoozeUntil(7, now),
  });
  assert.equal(photographBeforeItLeaves(artwork, now).showing, false);
  const later = new Date('2026-10-05T00:00:00Z');
  assert.equal(photographBeforeItLeaves(artwork, later).showing, true, 'it comes back');
});

test('a snoozed reminder is snoozed everywhere, not just on the artwork', () => {
  // The home screen filters on the same helper, so one snooze silences both.
  const now = new Date('2026-09-22T00:00:00Z');
  const onHand = [
    newArtwork({ id: 'a', title: 'a', on_hand: true }),
    newArtwork({ id: 'b', title: 'b', on_hand: true, photo_prompt_snoozed_until: snoozeUntil(30, now) }),
  ];
  const showing = onHand.filter((a) => photographBeforeItLeaves(a, now)?.showing);
  assert.deepEqual(showing.map((a) => a.id), ['a']);
});

test('snoozeUntil counts forward in days', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(snoozeUntil(7, now).slice(0, 10), '2026-09-29');
  assert.equal(snoozeUntil(30, now).slice(0, 10), '2026-10-22');
});

// --- what a photo tells the print-master registry (§5.4) -------------------

test('the original’s pixel size is what decides the print limit', () => {
  // A 4,000 px phone photo supports a 26.7 in print; the web copy never would.
  assert.equal(Math.round(printLimits({ long_edge_px: 4000 }).at150 * 10) / 10, 26.7);
  assert.equal(Math.round(printLimits({ long_edge_px: 2000 }).at150 * 10) / 10, 13.3);
  assert.equal(Math.round(printLimits({ long_edge_px: 1440 }).at150 * 10) / 10, 9.6);
});

test('an original’s details stay private', () => {
  for (const field of ['original_width_px', 'original_height_px', 'original_bytes', 'original_name']) {
    assert.ok(PRIVATE_IMAGE_FIELDS.includes(field), field);
    assert.equal(PUBLIC_IMAGE_FIELDS.includes(field), false, `${field} must not be published`);
  }
  assert.ok(PRIVATE_IMAGE_FIELDS.includes('quality_flags'));
});

// --- what a piece can be printed from (§5.4) -------------------------------

test('a photo is measured by the original, not the web copy the app kept', () => {
  assert.equal(imageLongEdge({ width_px: 2000, height_px: 1500, original_width_px: 4032, original_height_px: 3024 }), 4032);
  // A photo added before the app recorded originals still has to answer.
  assert.equal(imageLongEdge({ width_px: 1440, height_px: 1800 }), 1800);
  assert.equal(imageLongEdge({}), null);
});

test('the print source is the master once it has been measured', () => {
  const artwork = newArtwork({ title: 'x',
    print_master: { exists: true, long_edge_px: 6000, short_edge_px: 4000 },
    images: [{ id: 'a', role: 'straight_on', original_width_px: 4032, original_height_px: 3024 }] });
  const source = printSource(artwork);
  assert.equal(source.from, 'master');
  assert.equal(source.long_edge_px, 6000);
  assert.equal(source.cropped, true);
  assert.equal(printLimits(source).at150, 40);
});

// The golf bag has five photos and no master. Saying nothing about how large
// it prints is worse than saying "12 in, and that is before you crop".
test('with no master it falls back to the largest photo, and says so', () => {
  const artwork = newArtwork({ title: 'x', images: [
    { id: 'a', role: 'process', original_width_px: 864, original_height_px: 1920 },
    { id: 'b', role: 'straight_on', original_width_px: 1440, original_height_px: 1800 },
  ] });
  const source = printSource(artwork);
  assert.equal(source.from, 'photo');
  assert.equal(source.long_edge_px, 1920, 'the biggest file wins, whatever its role');
  assert.equal(source.cropped, false, 'a reference shot still has wall and frame in it');
  assert.equal(printLimits(source).at150, 12.8);
});

test('a master that is only a checkbox is not a measurement', () => {
  const artwork = newArtwork({ title: 'x',
    print_master: { exists: true, long_edge_px: null },
    images: [{ id: 'b', role: 'straight_on', original_width_px: 1440, original_height_px: 1800 }] });
  assert.equal(printSource(artwork).from, 'photo');
  assert.equal(printSource(newArtwork({ title: 'x' })), null);
});

// A link to the original in Drive is the way back to the full-size file. It is
// also a link into a private Google account, so it never reaches the public
// catalog — which the allow-list guarantees, as long as nobody adds it there.
test('the link to the original is private', () => {
  assert.ok(PRIVATE_IMAGE_FIELDS.includes('source_url'));
  assert.ok(!PUBLIC_IMAGE_FIELDS.includes('source_url'));
});

// --- measuring a master (§5.4) ---------------------------------------------
//
// A print master is most likely to be saved as a TIFF, which is precisely the
// format no browser will decode. Failing with "not an image" would be both
// true and useless, because the way round it is two numbers typed by hand.

test('the archival formats are recognised, by type or by extension', () => {
  assert.equal(undecodableFormat({ type: 'image/tiff', name: 'x.tif' }), 'TIFF');
  assert.equal(undecodableFormat({ type: '', name: 'golf-bag-master.TIFF' }), 'TIFF');
  assert.equal(undecodableFormat({ type: '', name: 'golf-bag.psd' }), 'PSD');
  assert.equal(undecodableFormat({ type: 'image/x-adobe-dng', name: 'a.dng' }), 'DNG');
  assert.equal(undecodableFormat({ type: 'image/jpeg', name: 'a.jpg' }), null);
  assert.equal(undecodableFormat({ type: 'image/png', name: 'a.png' }), null);
});

test('measuring a TIFF says what to do instead of just refusing', async () => {
  await assert.rejects(
    () => measureFile({ type: 'image/tiff', name: 'golf-bag-master.tif', size: 1 }),
    (err) => {
      assert.match(err.message, /No browser can read a TIFF/);
      assert.match(err.message, /type them into the two boxes/);
      return true;
    },
  );
});
