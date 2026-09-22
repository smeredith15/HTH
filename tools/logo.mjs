// Generate every app icon from the shop's mark.
//
//   node tools/logo.mjs
//
// The master is icons/logo-source.png — a circle on transparency. Everything
// derived from it is flattened onto the artwork's own dark ring: Apple ignores
// transparency, Android composites against whatever the launcher chooses, and
// a transparent favicon vanishes into a light browser theme.
//
// Re-run this after replacing the master, then `node tools/shell-list.mjs
// --write`, and commit both.

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const OUT = '/home/user/HTH/icons';
const src = `data:image/png;base64,${fs.readFileSync(`${OUT}/logo-source.png`).toString('base64')}`;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.setContent('<canvas id="c"></canvas>');

// Sample the corner so the maskable padding matches the artwork's own ground
// rather than sitting the disc on an arbitrary colour.
const ground = await page.evaluate(async (dataUrl) => {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
  });
  const c = document.getElementById('c');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  const mid = Math.round(img.width / 2);
  // The mark is a circle on transparency, so the corners say nothing. Sample
  // the dark ring inside the disc's edge — that is the artwork's own ground.
  const ring = [
    at(mid, Math.round(img.height * 0.05)),
    at(mid, Math.round(img.height * 0.95)),
    at(Math.round(img.width * 0.05), mid),
    at(Math.round(img.width * 0.95), mid),
  ].filter((px) => px[3] > 200);
  const avg = (i) => Math.round(ring.reduce((t, px) => t + px[i], 0) / ring.length);
  return { corner: at(6, 6), centre: at(mid, mid), ring: [avg(0), avg(1), avg(2)], samples: ring.length };
}, src);
console.log('sampled:', JSON.stringify(ground));

const hex = ([r, g, b]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
// The corners are the darkest ground in the mark; that is what a maskable icon
// should bleed to, so a circular crop never shows a seam.
const bg = hex(ground.ring);
console.log('maskable ground:', bg);

async function render(name, size, { scale = 1, background = null, round = false } = {}) {
  await page.evaluate(async ({ dataUrl, size, scale, background, round }) => {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
    });
    const c = document.getElementById('c');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
    if (round) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const drawn = size * scale;
    const offset = (size - drawn) / 2;
    ctx.drawImage(img, offset, offset, drawn, drawn);
    if (round) ctx.restore();
    window.__out = c.toDataURL('image/png');
  }, { dataUrl: src, size, scale, background, round });
  const out = await page.evaluate(() => window.__out);
  fs.writeFileSync(`${OUT}/${name}`, Buffer.from(out.split(',')[1], 'base64'));
  console.log('wrote', name, `${size}px`, scale === 1 ? '' : `scale ${scale}`);
}

// The mark is a circle on transparency. Every one of these sits on the disc's
// own dark ring rather than on nothing: Apple does not honour transparency,
// Android composites against whatever the launcher feels like, and a tab
// favicon with a transparent ground disappears into a light theme.
await render('icon-192.png', 192, { background: bg });
await render('icon-512.png', 512, { background: bg });
await render('apple-touch-icon.png', 180, { background: bg });
await render('favicon-32.png', 32, { background: bg });
await render('favicon-16.png', 16, { background: bg });
// Small enough for the header without shipping a 512 to draw a 22 px mark.
await render('logo-64.png', 64, { background: bg });
// Maskable: Android crops to the inner 80%, so the mark shrinks and the ground
// fills what the crop would otherwise take out of the disc.
await render('icon-maskable-512.png', 512, { scale: 0.78, background: bg });
await browser.close();

fs.rmSync(`${OUT}/icon.svg`, { force: true });
console.log('removed the placeholder icon.svg');
