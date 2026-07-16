// ============================================================
// AppSheet — G2 bottom-sheet manager with real nested layers.
// ============================================================

import { ensureModalPortalRoot, isTopModal, modalDepth, mountModalLayer, pushModalLayer } from '../app/modalStack.js';
import { dispatchAction } from '../app/state.js';

let host = null;
const sheets = [];

export function mountSheetHost(parent) {
  // `parent` is retained for API compatibility. Every sheet now belongs to
  // the one body-level portal so iOS stacking contexts cannot split parents
  // and children into competing z-index worlds.
  host = ensureModalPortalRoot();
  return host;
}

export function openSheet({ title, contentHTML, className = '', onClose, onOpen, stacked = false, id, parentId, trigger = document.activeElement }) {
  // Every layer is ultimately mounted beneath document.body by modalStack.
  // Compatibility contract: pushModalLayer(layer) is enriched with metadata below.
  if (!stacked) while (sheets.length) closeSheet(true);
  const layer = document.createElement('div');
  layer.className = `sheet-layer modal-layer${stacked ? ' sheet-layer-stacked' : ''}`;
  const scrim = document.createElement('div');
  scrim.className = `sheet-scrim${stacked ? ' stacked-sheet-scrim' : ''}`;
  const sheet = document.createElement('section');
  sheet.className = `sheet glass-sheet ${className}${stacked ? ' stacked-sheet' : ''}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.tabIndex = -1;
  if (title) sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `
    <div class="sheet-grabber" data-action="sheet-close-drag"><span></span></div>
    ${title ? `<header class="sheet-title">${title}</header>` : ''}
    <div class="sheet-body">${contentHTML}</div>
  `;
  scrim.setAttribute('data-modal-backdrop', '');
  sheet.setAttribute('data-modal-surface', '');
  layer.append(scrim, sheet);
  attachActionDelegation(layer);
  mountModalLayer(layer);
  const releaseModal = pushModalLayer(layer, { id, parentId, kind: className.includes('capture-relationship-sheet') ? 'relationship' : className.includes('capture-sheet') ? 'capture' : 'sheet', trigger, surface: sheet, backdrop: scrim });
  const entry = { layer, scrim, sheet, onClose, releaseModal };
  sheets.push(entry);
  syncCaptureOpen();

  requestAnimationFrame(() => {
    scrim.classList.add('open');
    sheet.classList.add('open');
    sheet.focus({ preventScroll: true });
  });

  scrim.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (sheets.at(-1) === entry && isTopModal(layer)) closeSheet();
  });
  attachDragToClose(sheet, entry);
  if (sheets.length === 1) document.addEventListener('keydown', escHandler);
  onOpen?.(sheet);
  return sheet;
}

function escHandler(event) {
  if (event.key === 'Escape' && !event.defaultPrevented) {
    const entry = sheets.at(-1);
    if (!entry || !isTopModal(entry.layer)) return;
    event.preventDefault();
    event.stopPropagation();
    closeSheet();
  }
}

function syncCaptureOpen() {
  document.getElementById('app')?.classList.toggle('capture-open', sheets.some(({ sheet }) => sheet.classList.contains('capture-sheet')));
}

export function closeSheet(instant = false) {
  const entry = sheets.at(-1);
  if (!entry) return;
  if (!instant && !isTopModal(entry.layer)) return false;
  sheets.pop();
  const { layer, scrim, sheet, onClose, releaseModal } = entry;
  releaseModal();
  onClose?.();
  syncCaptureOpen();
  if (!sheets.length) document.removeEventListener('keydown', escHandler);
  if (instant) {
    layer.remove();
    return;
  }
  layer.style.pointerEvents = 'none';
  scrim.classList.remove('open');
  sheet.classList.remove('open');
  setTimeout(() => layer.remove(), 300);
}

export function closeAllSheets({ instant = true } = {}) {
  while (sheets.length) closeSheet(instant);
  return sheets.length;
}

export function appSheetStackSnapshot() {
  return sheets.map(({ layer, sheet }) => ({
    id: layer.dataset.sheetId || '',
    kind: layer.dataset.modalKind || '',
    className: sheet.className,
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
    if (sheets.at(-1) !== entry || !isTopModal(entry.layer)) return;
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

let toastTimer = null;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast glass-sheet';
    document.getElementById('app').appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
