// Service worker registration and the update path (SPEC §10).
//
// The worker is network-first, so a deploy is picked up by any online load
// without ceremony. What this adds is the part a phone cannot do for itself:
// saying which version is running, forcing a check, and — the one that matters
// — unregistering everything when something has gone wrong, from a screen
// rather than from developer tools nobody has on a phone.

export const SUPPORTED = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/**
 * The off switch, per device.
 *
 * Unregistering is not enough on its own: boot registers the worker again on
 * the very next load, so the escape hatch hands back exactly what it was asked
 * to remove. If someone has had to reach for it, the worker stays gone until
 * they say otherwise. localStorage is right for this — it is a per-device
 * preference about this device's browser, and it must survive the reload that
 * immediately follows.
 */
const OFF_KEY = 'hightide-offline-off';

export function isDisabled() {
  try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; }
}

function setDisabled(off) {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch { /* private mode: the switch just does not persist */ }
}

let registration = null;

export async function registerWorker() {
  if (!SUPPORTED) return null;
  if (isDisabled()) return null;
  // A file: page has no origin a worker can claim, and failing there is noise.
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  try {
    registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
    return registration;
  } catch (err) {
    console.error('Service worker did not register:', err);
    return null;
  }
}

export async function currentRegistration() {
  if (!SUPPORTED) return null;
  if (registration) return registration;
  registration = (await navigator.serviceWorker.getRegistration()) ?? null;
  return registration;
}

export async function status() {
  const reg = await currentRegistration();
  if (!SUPPORTED) return { supported: false, installed: false };
  return {
    supported: true,
    disabled: isDisabled(),
    installed: !!reg?.active,
    waiting: !!reg?.waiting,
    scope: reg?.scope ?? null,
    version: await workerVersion(),
  };
}

/** Ask the running worker what version it is. Never hangs the screen. */
function workerVersion() {
  return new Promise((resolve) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) { resolve(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data?.version ?? null); };
    worker.postMessage({ type: 'version' }, [channel.port2]);
  });
}

export async function checkForUpdate() {
  const reg = await currentRegistration();
  if (!reg) return { checked: false };
  await reg.update();
  return { checked: true, waiting: !!reg.waiting };
}

/**
 * Unregister and delete every cache, then reload.
 *
 * This is the recovery path, and it has to work even when the worker is the
 * thing that is broken — so it does not rely on the worker answering. It
 * clears the caches from the page, unregisters directly, and reloads.
 */
export async function forgetWorker({ keepOff = true } = {}) {
  if (!SUPPORTED) return { cleared: 0 };
  setDisabled(keepOff);
  let cleared = 0;
  if (typeof caches !== 'undefined') {
    for (const name of await caches.keys()) {
      if (await caches.delete(name)) cleared += 1;
    }
  }
  for (const reg of await navigator.serviceWorker.getRegistrations()) {
    await reg.unregister().catch(() => {});
  }
  registration = null;
  return { cleared };
}

/** Turn offline mode back on after it was switched off. */
export async function enableWorker() {
  setDisabled(false);
  return registerWorker();
}

/** Whether the browser currently believes it has a network. */
export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
