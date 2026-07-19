import { data, update } from '../../app/state.js';

const DRAG_THRESHOLD = 8;

function rowIds(list) {
  return [...list.querySelectorAll('.asset-manage-row[data-active="true"]')].map((row) => row.dataset.id);
}

function restoreOrder(list, ids) {
  ids.forEach((id) => {
    const row = list.querySelector(`.asset-manage-row[data-id="${CSS.escape(id)}"]`);
    if (row) list.appendChild(row);
  });
}

export function bindAssetDragReorder(sheet, type) {
  const list = sheet.querySelector('.asset-manager-list');
  if (!list) return () => {};
  let drag = null;
  let keyboard = null;
  let frame = null;

  function commit(ids) {
    data.reorderAssets(type, ids);
    // Keep the accepted stack/carousel views in sync as soon as the user
    // releases the handle; the manager Sheet itself keeps its live DOM order.
    update({});
  }

  function finishPointer({ cancelled = false } = {}) {
    if (!drag) return;
    cancelAnimationFrame(frame);
    document.documentElement.classList.remove('asset-reorder-active');
    drag.row.classList.remove('is-dragging');
    drag.handle.releasePointerCapture?.(drag.pointerId);
    if (cancelled || !drag.started) restoreOrder(list, drag.originalIds);
    else commit(rowIds(list));
    drag = null;
  }

  function autoScroll(clientY) {
    const body = sheet.querySelector('.sheet-body');
    const rect = body?.getBoundingClientRect();
    if (!body || !rect) return;
    const edge = 72;
    const speed = clientY < rect.top + edge ? -10 : clientY > rect.bottom - edge ? 10 : 0;
    if (!speed) return;
    body.scrollTop += speed;
    frame = requestAnimationFrame(() => autoScroll(clientY));
  }

  const pointerDown = (event) => {
    const handle = event.target.closest('.asset-reorder-handle');
    if (!handle || event.button !== 0) return;
    const row = handle.closest('.asset-manage-row[data-active="true"]');
    if (!row) return;
    drag = { handle, row, pointerId: event.pointerId, startY: event.clientY, started: false, originalIds: rowIds(list) };
    handle.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.started && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.started) {
      drag.started = true;
      drag.row.classList.add('is-dragging');
      document.documentElement.classList.add('asset-reorder-active');
    }
    event.preventDefault();
    cancelAnimationFrame(frame);
    autoScroll(event.clientY);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.asset-manage-row[data-active="true"]');
    if (!target || target === drag.row || target.parentElement !== list) return;
    const rect = target.getBoundingClientRect();
    list.insertBefore(drag.row, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
  };

  const pointerUp = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishPointer();
  };
  const pointerCancel = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishPointer({ cancelled: true });
  };

  const keydown = (event) => {
    const handle = event.target.closest('.asset-reorder-handle');
    if (!handle) return;
    const row = handle.closest('.asset-manage-row[data-active="true"]');
    if (!row) return;
    if ((event.key === 'Enter' || event.key === ' ') && !keyboard) {
      event.preventDefault();
      keyboard = { row, handle, originalIds: rowIds(list) };
      row.classList.add('is-dragging', 'is-keyboard-reordering');
      handle.setAttribute('aria-pressed', 'true');
      return;
    }
    if (!keyboard || keyboard.row !== row) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (sibling?.dataset.active === 'true') list.insertBefore(row, event.key === 'ArrowUp' ? sibling : sibling.nextSibling);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      restoreOrder(list, keyboard.originalIds);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(rowIds(list));
    } else return;
    row.classList.remove('is-dragging', 'is-keyboard-reordering');
    handle.setAttribute('aria-pressed', 'false');
    keyboard = null;
  };

  list.addEventListener('pointerdown', pointerDown);
  list.addEventListener('pointermove', pointerMove, { passive: false });
  list.addEventListener('pointerup', pointerUp);
  list.addEventListener('pointercancel', pointerCancel);
  list.addEventListener('keydown', keydown);
  return () => {
    finishPointer({ cancelled: true });
    list.removeEventListener('pointerdown', pointerDown);
    list.removeEventListener('pointermove', pointerMove);
    list.removeEventListener('pointerup', pointerUp);
    list.removeEventListener('pointercancel', pointerCancel);
    list.removeEventListener('keydown', keydown);
  };
}
