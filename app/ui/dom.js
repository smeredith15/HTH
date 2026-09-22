// Tiny DOM helpers. No framework (SPEC §3) and no template strings holding
// user data — everything goes in as a text node, so a title with an angle
// bracket in it stays a title.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') node.textContent = value;
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

// --- formatting -----------------------------------------------------------

export function money(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function label(enumValue) {
  if (!enumValue) return '—';
  return String(enumValue).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function dimensions(artwork) {
  const { width_in: w, height_in: h, depth_in: d } = artwork;
  if (!w && !h) return null;
  const base = [w, h].filter((n) => n !== null && n !== undefined).join(' × ');
  return d ? `${base} × ${d} in` : `${base} in`;
}

export function dateOnly(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeDays(days) {
  if (days === null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// --- small components -----------------------------------------------------

export function pill(text, tone = '') {
  return el('span', { class: `pill ${tone}`.trim(), text });
}

export function field(labelText, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return el('div', { class: 'field' },
    el('label', { for: id, text: labelText }),
    control,
    hint ? el('p', { class: 'hint', text: hint }) : null);
}

export function select(options, value, props = {}) {
  const node = el('select', props);
  for (const opt of options) {
    const [val, text] = Array.isArray(opt) ? opt : [opt, label(opt)];
    node.append(el('option', { value: val, text, selected: String(val) === String(value ?? '') }));
  }
  return node;
}

let toastTimer = null;
export function toast(message, tone = '') {
  let host = document.querySelector('.toast');
  if (!host) {
    host = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  host.className = `toast show ${tone}`.trim();
  host.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.className = 'toast'; }, 4000);
}

export function confirmDialog(message, { confirmText = 'Confirm', tone = 'danger' } = {}) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'sheet' },
      el('p', { text: message }),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', type: 'button', onClick: () => { dialog.close(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn ${tone}`, type: 'button', onClick: () => { dialog.close(); resolve(true); } }, confirmText)));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  });
}
