// ============================================================
// AppSheet — G2 bottom-sheet manager with real nested layers.
// ============================================================

import { ensureModalPortalRoot, isTopModal, modalDepth, mountModalLayer, pushModalLayer } from '../app/modalStack.js';
import { dispatchAction } from '../app/state.js';
import { triggerLiquidChromeInteraction } from '../design-system/DesignSystem.js';

let host = null;
const sheets = [];
let sheetHistorySequence = 0;

export const SHEET_DETENTS = Object.freeze(['compact', 'medium', 'large', 'content']);

const COMPACT_SHEET_PATTERN = /(?:confirm|confirmation|discard|delete|reverse|alert|compact-action|确认|删除|归档|撤销|重置|放弃|无法|警告)/;
const LARGE_SHEET_PATTERN = /(?:capture|editor|detail|operation|relationship|settlement|payment-assistant|posting|result|directory|registry|recently-deleted|ledger-create|installment|attachment)/;
const MEDIUM_SHEET_PATTERN = /(?:profile|manager|overflow|picker|participant|menu|habit)/;

export function resolveSheetDetent({ detent, className = '', title = '' } = {}) {
  if (detent != null) {
    if (!SHEET_DETENTS.includes(detent)) throw new Error(`Unsupported sheet detent: ${detent}`);
    return detent;
  }
  const identity = `${className} ${title}`.toLowerCase();
  if (COMPACT_SHEET_PATTERN.test(identity)) return 'compact';
  if (LARGE_SHEET_PATTERN.test(identity)) return 'large';
  if (MEDIUM_SHEET_PATTERN.test(identity)) return 'medium';
  return 'content';
}

function sheetPopstateHandler(event) {
  if (!sheets.length) return;
  const top = sheets.at(-1);
  if (!top || !isTopModal(top.layer)) return;
  event.stopImmediatePropagation();
  // Browser Back follows the same dirty-state contract as Escape/backdrop.
  // A parent editor may open its own discard confirmation and remain mounted.
  closeSheet(false, { fromHistory: true });
}

export function mountSheetHost(parent) {
  // `parent` is retained for API compatibility. Every sheet now belongs to
  // the one body-level portal so iOS stacking contexts cannot split parents
  // and children into competing z-index worlds.
  host = ensureModalPortalRoot();
  return host;
}

export function openSheet({
  title,
  contentHTML,
  className = '',
  detent,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  dismissOnDrag = true,
  onClose,
  onOpen,
  onRequestClose,
  stacked = false,
  id,
  parentId,
  trigger = document.activeElement,
}) {
  // Every layer is ultimately mounted beneath document.body by modalStack.
  // Compatibility contract: pushModalLayer(layer) is enriched with metadata below.
  const replacing = !stacked && sheets.length > 0;
  if (!stacked) while (sheets.length) closeSheet(true, { fromHistory: true });
  const layer = document.createElement('div');
  layer.className = `sheet-layer modal-layer${stacked ? ' sheet-layer-stacked' : ''}`;
  const scrim = document.createElement('div');
  scrim.className = `sheet-scrim rm-scrim${stacked ? ' stacked-sheet-scrim' : ''}`;
  const sheet = document.createElement('section');
  sheet.className = `sheet glass-sheet rm-sheet ${className}${stacked ? ' stacked-sheet' : ''}`;
  const resolvedDetent = resolveSheetDetent({ detent, className, title });
  sheet.dataset.sheetDetent = resolvedDetent;
  layer.dataset.sheetDetent = resolvedDetent;
  layer.dataset.dismissBackdrop = String(Boolean(dismissOnBackdrop));
  layer.dataset.dismissEscape = String(Boolean(dismissOnEscape));
  layer.dataset.dismissDrag = String(Boolean(dismissOnDrag));
  sheet.dataset.rmComponent = 'Sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  if (title) sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `
    <div class="sheet-grabber" data-action="sheet-close-drag"><span></span></div>
    ${title ? `<header class="sheet-title rm-sheet-title">${title}</header>` : ''}
    <div class="sheet-body rm-sheet-body">${contentHTML}</div>
  `;
  scrim.setAttribute('data-modal-backdrop', '');
  sheet.setAttribute('data-modal-surface', '');
  layer.append(scrim, sheet);
  attachActionDelegation(layer);
  mountModalLayer(layer);
  const releaseModal = pushModalLayer(layer, { id, parentId, kind: className.includes('capture-relationship-sheet') ? 'relationship' : className.includes('capture-sheet') ? 'capture' : 'sheet', trigger, surface: sheet, backdrop: scrim });
  const historyToken = `sheet-${++sheetHistorySequence}`;
  history[replacing ? 'replaceState' : 'pushState']({ ...(history.state || {}), ringgitmeSheet: historyToken }, '', location.href);
  const entry = {
    layer,
    scrim,
    sheet,
    onClose,
    onRequestClose,
    releaseModal,
    historyToken,
    detent: resolvedDetent,
    dismissOnBackdrop: Boolean(dismissOnBackdrop),
    dismissOnEscape: Boolean(dismissOnEscape),
    dismissOnDrag: Boolean(dismissOnDrag),
    viewportCleanup: null,
  };
  sheets.push(entry);
  entry.viewportCleanup = attachSheetVisualViewport(layer);
  syncCaptureOpen();

  requestAnimationFrame(() => {
    const body = sheet.querySelector('.sheet-body');
    sheet.scrollTop = 0;
    if (body) body.scrollTop = 0;
    scrim.classList.add('open');
    sheet.classList.add('open');
    sheet.focus({ preventScroll: true });
  });

  scrim.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry.dismissOnBackdrop && sheets.at(-1) === entry && isTopModal(layer)) closeSheet();
  });
  attachDragToClose(sheet, entry);
  if (sheets.length === 1) {
    document.addEventListener('keydown', escHandler);
    window.addEventListener('popstate', sheetPopstateHandler, true);
  }
  onOpen?.(sheet);
  return sheet;
}

function escHandler(event) {
  if (event.key === 'Escape' && !event.defaultPrevented) {
    const entry = sheets.at(-1);
    if (!entry || !entry.dismissOnEscape || !isTopModal(entry.layer)) return;
    event.preventDefault();
    event.stopPropagation();
    closeSheet();
  }
}

function syncCaptureOpen() {
  document.getElementById('app')?.classList.toggle('capture-open', sheets.some(({ sheet }) => sheet.classList.contains('capture-sheet')));
}

export function closeSheet(instant = false, { fromHistory = false } = {}) {
  const entry = sheets.at(-1);
  if (!entry) return;
  if (!instant && !isTopModal(entry.layer)) return false;
  return closeTopSheet(entry.layer.dataset.sheetId, instant, { fromHistory, soft: true });
}

export function closeTopSheet(expectedLayerId, instant = false, { fromHistory = false, soft = false } = {}) {
  const entry = sheets.at(-1);
  if (!entry || entry.layer.dataset.sheetId !== expectedLayerId || !isTopModal(entry.layer)) {
    if (soft) return false;
    const actual = entry?.layer.dataset.sheetId || 'none';
    throw new Error(`sheet_layer_mismatch: expected ${expectedLayerId}, actual ${actual}`);
  }
  if (!instant && entry.onRequestClose?.() === false) return false;
  sheets.pop();
  const { layer, scrim, sheet, onClose, releaseModal, historyToken, viewportCleanup } = entry;
  viewportCleanup?.();
  releaseModal();
  onClose?.();
  syncCaptureOpen();
  if (!sheets.length) {
    document.removeEventListener('keydown', escHandler);
    window.removeEventListener('popstate', sheetPopstateHandler, true);
  }
  if (!fromHistory && historyToken) {
    // UI/Escape dismissal must not navigate the application underneath the
    // modal stack. Browser Back still consumes the pushed entries through the
    // popstate handler, while direct dismissal rewrites only the current token.
    const remainingToken = sheets.at(-1)?.historyToken;
    const nextState = { ...(history.state || {}) };
    if (remainingToken) nextState.ringgitmeSheet = remainingToken;
    else delete nextState.ringgitmeSheet;
    history.replaceState(nextState, '', location.href);
  }
  if (instant) {
    layer.remove();
    return true;
  }
  layer.style.pointerEvents = 'none';
  scrim.classList.remove('open');
  sheet.classList.remove('open');
  setTimeout(() => layer.remove(), 300);
  return true;
}

export function closeAllSheets({ instant = true } = {}) {
  while (sheets.length) closeSheet(instant);
  return sheets.length;
}

export function appSheetStackSnapshot() {
  return sheets.map(({ layer, sheet, detent, dismissOnBackdrop, dismissOnEscape, dismissOnDrag }) => ({
    id: layer.dataset.sheetId || '',
    kind: layer.dataset.modalKind || '',
    className: sheet.className,
    detent,
    dismissOnBackdrop,
    dismissOnEscape,
    dismissOnDrag,
  }));
}

export function isSheetOpen() {
  return sheets.length > 0;
}

export function sheetDepth() {
  return modalDepth();
}

function attachActionDelegation(layer) {
  layer.addEventListener('click', (event) => {
    triggerLiquidChromeInteraction(event.target);
    const element = event.target.closest('[data-action]');
    if (!element || element.disabled) return;
    dispatchAction(element.dataset.action, element, event);
  });
  layer.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = event.target.closest('[data-action][role="button"]');
    if (!element || element.tagName === 'BUTTON' || element.disabled) return;
    event.preventDefault();
    dispatchAction(element.dataset.action, element, event);
  });
}

function attachDragToClose(sheet, entry) {
  const grabber = sheet.querySelector('.sheet-grabber');
  if (!grabber) return;
  let startY = 0;
  let delta = 0;
  let dragging = false;

  grabber.addEventListener('pointerdown', (event) => {
    if (!entry.dismissOnDrag || sheets.at(-1) !== entry || !isTopModal(entry.layer)) return;
    dragging = true;
    startY = event.clientY;
    delta = 0;
    sheet.style.transition = 'none';
    grabber.setPointerCapture(event.pointerId);
  });
  grabber.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    delta = Math.max(0, event.clientY - startY);
    sheet.style.transform = `translateY(${delta}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (delta > 90 && sheets.at(-1) === entry && isTopModal(entry.layer)) closeSheet();
  };
  grabber.addEventListener('pointerup', end);
  grabber.addEventListener('pointercancel', end);
}

export function attachSheetVisualViewport(layer) {
  const viewport = window.visualViewport;
  const sync = () => {
    const top = Math.max(0, viewport?.offsetTop || 0);
    const height = Math.max(240, viewport?.height || window.innerHeight);
    const keyboardInset = Math.max(0, window.innerHeight - height - top);
    layer.style.setProperty('--rm-sheet-viewport-top', `${Math.round(top)}px`);
    layer.style.setProperty('--rm-sheet-viewport-height', `${Math.round(height)}px`);
    layer.style.setProperty('--rm-sheet-keyboard-inset', `${Math.round(keyboardInset)}px`);
    layer.dataset.keyboardOpen = String(keyboardInset > 96);
  };
  sync();
  viewport?.addEventListener('resize', sync, { passive: true });
  viewport?.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });
  return () => {
    viewport?.removeEventListener('resize', sync);
    viewport?.removeEventListener('scroll', sync);
    window.removeEventListener('resize', sync);
  };
}

let toastTimer = null;
export function toast(message) {
  let root = document.getElementById('ringgitme-toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'ringgitme-toast-root';
    root.className = 'toast-portal-root';
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'true');
    document.body.appendChild(root);
  }
  let el = root.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast glass-sheet';
    el.setAttribute('role', 'status');
    root.appendChild(el);
  }
  el.textContent = String(message || '');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  return el;
}
