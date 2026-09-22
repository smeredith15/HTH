// Hash router. Hash routes keep the app working from a GitHub Pages subpath
// with no server rewrite rules (SPEC §3).

const routes = [];
let notFound = null;
let current = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(`^${pattern
    .replace(/\//g, '\\/')
    .replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^\\/]+)'; })}$`);
  routes.push({ regex, keys, handler });
}

export function setNotFound(handler) { notFound = handler; }

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  return { path: path.startsWith('/') ? path : `/${path}`, query: new URLSearchParams(queryString) };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) location.replace(target);
  else location.hash = target;
}

export function currentRoute() { return current; }

export async function resolve() {
  const { path, query } = parseHash();
  for (const { regex, keys, handler } of routes) {
    const match = path.match(regex);
    if (!match) continue;
    const params = Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
    current = { path, params, query };
    await handler({ params, query, path });
    return;
  }
  current = { path, params: {}, query };
  if (notFound) await notFound({ path });
}

export function start() {
  window.addEventListener('hashchange', () => { resolve(); });
  return resolve();
}
