export const MODAL_LAYER_BASE = 1800;
export const MODAL_LAYER_STEP = 20;

const stack = [];
let sequence = 0;
let portalRoot = null;

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function modalLayerOrder(index) {
  const stackIndex = Math.max(0, Number(index) || 0);
  const layerZ = MODAL_LAYER_BASE + stackIndex * MODAL_LAYER_STEP;
  return { stackIndex, layerZ, backdropZ: layerZ, surfaceZ: layerZ + 1 };
}

export function ensureModalPortalRoot() {
  if (portalRoot?.isConnected) return portalRoot;
  portalRoot = document.getElementById('ringgitme-sheet-portal') || document.createElement('div');
  portalRoot.id = 'ringgitme-sheet-portal';
  portalRoot.className = 'sheet-host modal-portal-root';
  if (!portalRoot.isConnected) document.body.appendChild(portalRoot);
  return portalRoot;
}

export function mountModalLayer(layer) {
  ensureModalPortalRoot().appendChild(layer);
  return layer;
}

function focusableElements(layer) {
  return [...(layer?.querySelectorAll?.(focusableSelector) || [])].filter((element) => !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true');
}

function focusTop(entry, preferred = null) {
  const target = preferred?.isConnected && entry.layer.contains(preferred)
    ? preferred
    : focusableElements(entry.layer)[0] || entry.surface || entry.layer;
  target?.focus?.({ preventScroll: true });
}

function triggerIdentity(trigger) {
  if (!trigger?.getAttribute) return null;
  for (const attribute of ['data-picker-field', 'data-recurring-picker', 'data-date-key', 'data-money-field', 'data-action', 'data-attachment-manage']) {
    if (trigger.hasAttribute(attribute)) return { attribute, value: trigger.getAttribute(attribute) || '' };
  }
  return null;
}

function restoredTrigger(entry, parent) {
  if (entry.trigger?.isConnected && parent?.layer.contains(entry.trigger)) return entry.trigger;
  if (!parent || !entry.triggerIdentity) return null;
  return [...parent.layer.querySelectorAll(`[${entry.triggerIdentity.attribute}]`)]
    .find((candidate) => (candidate.getAttribute(entry.triggerIdentity.attribute) || '') === entry.triggerIdentity.value) || null;
}

function trapFocus(event) {
  const entry = stack.at(-1);
  if (!entry) return;
  if (event.type === 'focusin') {
    if (!entry.layer.contains(event.target)) focusTop(entry);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = focusableElements(entry.layer);
  if (!focusable.length) {
    event.preventDefault();
    focusTop(entry);
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function installFocusTrap() {
  if (stack.length !== 1) return;
  document.addEventListener('focusin', trapFocus, true);
  document.addEventListener('keydown', trapFocus, true);
}

function removeFocusTrap() {
  if (stack.length) return;
  document.removeEventListener('focusin', trapFocus, true);
  document.removeEventListener('keydown', trapFocus, true);
}

function sync() {
  stack.forEach((entry, index) => {
    const { layer, surface, backdrop } = entry;
    const child = layer;
    const top = index === stack.length - 1;
    const order = modalLayerOrder(index);
    layer.dataset.sheetId = entry.id;
    layer.dataset.parentSheetId = entry.parentId || '';
    layer.dataset.stackIndex = String(index);
    layer.dataset.modalKind = entry.kind;
    layer.style.setProperty('--modal-depth', String(index));
    layer.style.setProperty('--modal-layer-z', String(order.layerZ));
    layer.style.zIndex = String(order.layerZ);
    if (top) child.removeAttribute('inert');
    else child.setAttribute('inert', '');
    layer.setAttribute('aria-hidden', String(!top));
    layer.classList.toggle('modal-suspended', !top);
    layer.classList.toggle('modal-root-layer', index === 0);
    layer.classList.toggle('modal-child-layer', index > 0);
    backdrop?.classList.toggle('modal-effective-scrim', index === 0);
    backdrop?.classList.toggle('modal-context-backdrop', index > 0);
    surface?.setAttribute('data-modal-surface', '');
    backdrop?.setAttribute('data-modal-backdrop', '');
    if (surface) surface.style.zIndex = '1';
    if (backdrop) backdrop.style.zIndex = '0';
  });
  document.documentElement.classList.toggle('modal-scroll-locked', stack.length > 0);
  document.documentElement.dataset.modalDepth = String(stack.length);
  const app = document.getElementById('app');
  if (app) {
    app.toggleAttribute('inert', stack.length > 0);
    app.setAttribute('aria-hidden', String(stack.length > 0));
    app.classList.toggle('modal-underlay-frozen', stack.length > 0);
  }
}

function freezeParent(entry) {
  if (!entry || entry.frozenState) return;
  const body = entry.surface?.querySelector?.('.sheet-body');
  const rect = entry.surface?.getBoundingClientRect?.();
  entry.frozenState = {
    surfaceScrollTop: entry.surface?.scrollTop || 0,
    bodyScrollTop: body?.scrollTop || 0,
    inlineHeight: entry.surface?.style.height || '',
    height: rect?.height || 0,
  };
  if (entry.surface && rect?.height) entry.surface.style.height = `${rect.height}px`;
  entry.layer.classList.add('modal-parent-frozen');
}

function restoreParent(entry) {
  if (!entry?.frozenState) return;
  const body = entry.surface?.querySelector?.('.sheet-body');
  const frozen = entry.frozenState;
  if (entry.surface) {
    entry.surface.style.height = frozen.inlineHeight;
    entry.surface.scrollTop = frozen.surfaceScrollTop;
  }
  if (body) body.scrollTop = frozen.bodyScrollTop;
  entry.layer.classList.remove('modal-parent-frozen');
  entry.frozenState = null;
}

export function pushModalLayer(layer, { id, parentId, kind = 'sheet', trigger = document.activeElement, surface = layer.querySelector?.('[role="dialog"]'), backdrop = layer.firstElementChild } = {}) {
  // Compatibility boundary: older picker/date/attachment callers may append
  // to #app first. Registration always moves the layer into the authoritative
  // body portal before ordering it.
  if (layer.parentElement !== ensureModalPortalRoot()) mountModalLayer(layer);
  const existing = stack.findIndex((entry) => entry.layer === layer);
  if (existing >= 0) stack.splice(existing, 1);
  const parent = stack.at(-1);
  freezeParent(parent);
  // stack.at(-1) regains focus through focusTop when the trigger disappeared.
  const entry = {
    layer,
    surface,
    backdrop,
    kind,
    id: id || `${kind}-${++sequence}`,
    parentId: parentId === undefined ? parent?.id || null : parentId,
    trigger: trigger?.isConnected ? trigger : null,
    triggerIdentity: triggerIdentity(trigger),
  };
  stack.push(entry);
  installFocusTrap();
  sync();
  let released = false;
  const release = (expectedLayerId = entry.id) => {
    if (released) return false;
    const top = stack.at(-1);
    if (!top || top.id !== expectedLayerId || top.layer !== layer) {
      const actual = top?.id || 'none';
      throw new Error(`modal_layer_mismatch: expected ${expectedLayerId}, actual ${actual}`);
    }
    released = true;
    return popModalLayer(layer);
  };
  release.sheetId = entry.id;
  release.parentSheetId = entry.parentId;
  return release;
}

export function popModalLayer(layer) {
  const index = stack.findIndex((entry) => entry.layer === layer);
  if (index < 0) return false;
  const [entry] = stack.splice(index, 1);
  sync();
  removeFocusTrap();
  const parent = stack.at(-1);
  restoreParent(parent);
  requestAnimationFrame(() => {
    restoreParent(parent);
    if (!parent) entry.trigger?.focus?.({ preventScroll: true });
    else {
      const trigger = restoredTrigger(entry, parent);
      if (trigger) trigger.focus({ preventScroll: true });
      else focusTop(parent);
    }
  });
  return true;
}

export function isTopModal(layer) {
  return stack.at(-1)?.layer === layer;
}

export function topModalLayerId() {
  return stack.at(-1)?.id || null;
}

export function closeTopModalLayer(expectedLayerId) {
  const top = stack.at(-1);
  if (!top || top.id !== expectedLayerId) {
    const actual = top?.id || 'none';
    throw new Error(`modal_layer_mismatch: expected ${expectedLayerId}, actual ${actual}`);
  }
  return popModalLayer(top.layer);
}

export function modalDepth() {
  return stack.length;
}

export function bodyScrollLockCount() {
  return stack.length;
}

export function modalStackSnapshot() {
  return stack.map(({ id, parentId, kind }, index) => ({ id, parentId, kind, ...modalLayerOrder(index) }));
}
