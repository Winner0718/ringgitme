import { escapeHTML } from '../app/format.js';
import { icon } from './Icons.js';
import { data, ui } from '../app/state.js';
import { toast } from './AppSheet.js';
import { attachmentSizeLabel } from '../domain/attachmentSession.js';
import { MAX_POSTING_EVIDENCE_ATTACHMENTS, validateAttachmentFile, validatePostingEvidenceFile } from '../domain/attachmentRepository.js';
import { isTopModal, mountModalLayer, pushModalLayer } from '../app/modalStack.js';

// Shared multi-attachment control. The attachment store is authoritative;
// this component renders the compact strip (up to 3 previews then +N), a
// manager layer (preview / replace / remove / reorder / add more) and a
// swipeable gallery layer. A hidden designed file input powers add/replace —
// the raw browser control is never visible UI.

const STRIP_LIMIT = 3;
let activeAttachmentManagerClose = null;

function attachmentDisplayName(item, index = 0) {
  return ui.privacy ? `附件 ${index + 1}` : item.name;
}

function thumbHTML(item) {
  if (item.kind === 'photo' && item.localObjectUrl) return `<span class="attachment-thumb${ui.privacy ? ' is-private' : ''}"><img src="${escapeHTML(item.localObjectUrl)}" alt="${ui.privacy ? '附件' : escapeHTML(item.name)}" /></span>`;
  return `<span class="attachment-thumb attachment-thumb-file"><span>${escapeHTML(item.thumbnail?.label || 'FILE')}</span></span>`;
}

export function attachmentSummaryHTML(ownerType, ownerId, { label = '附件', evidenceOnly = false } = {}) {
  const items = data.getAttachments(ownerType, ownerId);
  return `<div class="attachment-field" data-attachment-field data-owner-type="${escapeHTML(ownerType)}" data-owner-id="${escapeHTML(ownerId)}" data-attachment-label="${escapeHTML(label)}" ${evidenceOnly ? 'data-evidence-only="true"' : ''}>
    <button type="button" class="attachment-summary" data-attachment-manage>
      <span class="caption">${escapeHTML(label)}</span>
      <span class="attachment-summary-count">${items.length ? `${items.length} 个` : '添加'} ${icon('chevronRight', 14)}</span>
    </button>
    ${items.length ? `<div class="attachment-strip" data-attachment-strip>
      ${items.slice(0, STRIP_LIMIT).map((item, index) => `<button type="button" class="attachment-strip-item" data-attachment-preview="${index}" aria-label="预览 ${ui.privacy ? `附件 ${index + 1}` : escapeHTML(item.name)}">${thumbHTML(item)}</button>`).join('')}
      ${items.length > STRIP_LIMIT ? `<button type="button" class="attachment-strip-item attachment-strip-more" data-attachment-manage>+${items.length - STRIP_LIMIT}</button>` : ''}
      <button type="button" class="attachment-strip-item attachment-strip-add" data-attachment-add aria-label="添加附件">${icon('plus', 16)}</button>
    </div>` : ''}
    <input type="file" data-attachment-input hidden multiple accept="${evidenceOnly ? 'image/jpeg,image/png,image/webp,application/pdf' : 'image/*,.pdf,.doc,.docx,.txt'}" />
  </div>`;
}

function readFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name || '附件',
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size || 0,
      localObjectUrl: typeof reader.result === 'string' ? reader.result : '',
    });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function bindAttachmentField(root, { onChange } = {}) {
  const field = root.querySelector('[data-attachment-field]');
  if (!field) return;
  const ownerType = field.dataset.ownerType;
  const ownerId = field.dataset.ownerId;
  const evidenceOnly = field.dataset.evidenceOnly === 'true';
  const label = field.dataset.attachmentLabel || '附件';
  const input = field.querySelector('[data-attachment-input]');
  let pendingReplaceId = null;
  const ownerChanged = (event) => {
    const detail = event.detail || {};
    if (!field.isConnected) { document.removeEventListener('ringgitme:attachment-changed', ownerChanged); return; }
    if (detail.ownerType === ownerType && detail.ownerId === ownerId) rerender();
  };

  const rerender = () => {
    document.removeEventListener('ringgitme:attachment-changed', ownerChanged);
    const fresh = document.createElement('div');
    fresh.innerHTML = attachmentSummaryHTML(ownerType, ownerId, { label, evidenceOnly });
    field.replaceWith(fresh.firstElementChild);
    bindAttachmentField(root, { onChange });
    onChange?.(data.getAttachments(ownerType, ownerId));
  };
  document.addEventListener('ringgitme:attachment-changed', ownerChanged);

  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    pendingReplaceId = input.dataset.pendingReplaceId || pendingReplaceId;
    delete input.dataset.pendingReplaceId;
    try {
      const selected = pendingReplaceId ? files.slice(0, 1) : files;
      if (!pendingReplaceId && evidenceOnly && data.getAttachments(ownerType, ownerId).length + selected.length > MAX_POSTING_EVIDENCE_ATTACHMENTS) throw new Error(`最多只能添加 ${MAX_POSTING_EVIDENCE_ATTACHMENTS} 个付款凭证`);
      for (const file of selected) {
        (evidenceOnly ? validatePostingEvidenceFile : validateAttachmentFile)(file);
        const meta = await readFile(file);
        if (!meta) continue;
        if (pendingReplaceId) data.replaceAttachment(pendingReplaceId, meta, `att-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        else data.addAttachment({ ...meta, source: 'file', category: evidenceOnly ? 'transfer-proof' : 'other', ownerEntityType: ownerType, ownerEntityId: ownerId, clientEventId: `att-add-${Date.now()}-${Math.random().toString(36).slice(2)}` });
      }
    } catch (error) {
      toast(error.message || '无法添加附件');
    }
    pendingReplaceId = null;
    activeAttachmentManagerClose?.();
    rerender();
  });

  field.addEventListener('click', (event) => {
    if (event.target.closest('[data-attachment-add]')) { pendingReplaceId = null; input.click(); return; }
    if (event.target.closest('[data-attachment-manage]')) {
      openAttachmentManager({
        ownerType,
        ownerId,
        evidenceOnly,
        requestFile: (replaceId) => {
          // The compact field can rerender while its manager remains open.
          // Resolve the current input so remove-then-readd of the same file
          // never targets a detached browser input.
          const liveField = root.querySelector(`[data-attachment-field][data-owner-type="${CSS.escape(ownerType)}"][data-owner-id="${CSS.escape(ownerId)}"]`);
          const liveInput = liveField?.querySelector('[data-attachment-input]') || input;
          liveInput.dataset.pendingReplaceId = replaceId || '';
          liveInput.value = '';
          liveInput.click();
        },
        onChange: rerender,
      });
      return;
    }
    const preview = event.target.closest('[data-attachment-preview]');
    if (preview) openAttachmentGallery(data.getAttachments(ownerType, ownerId), Number(preview.dataset.attachmentPreview));
  });
}

export function openAttachmentManager({ ownerType, ownerId, evidenceOnly = false, requestFile, onChange }) {
  if (activeAttachmentManagerClose && !activeAttachmentManagerClose()) return null;
  const trigger = document.activeElement;
  const layer = document.createElement('div');
  layer.className = 'picker-layer attachment-manager-layer modal-layer';
  const render = () => {
    const items = data.getAttachments(ownerType, ownerId);
    const attachmentLimit = evidenceOnly ? MAX_POSTING_EVIDENCE_ATTACHMENTS : data.getAttachmentLimit();
    layer.innerHTML = `<button class="picker-scrim" data-manager-close aria-label="完成"></button>
      <section class="picker-sheet glass-sheet" data-modal-surface role="dialog" aria-modal="true" aria-label="附件管理" tabindex="-1">
        <div class="time-picker-grabber"><span></span></div>
        <header class="time-picker-title">附件 · ${items.length}/${attachmentLimit}</header>
        <div class="attachment-manager-list">
          ${items.map((item, index) => `<div class="attachment-manager-row" data-attachment-id="${item.attachmentId}">
            <button type="button" class="attachment-manager-thumb" data-manager-preview="${index}" aria-label="预览 ${escapeHTML(attachmentDisplayName(item, index))}">${thumbHTML(item)}</button>
            <div class="row-main"><div class="row-title attachment-name">${escapeHTML(attachmentDisplayName(item, index))}</div><div class="caption">${ui.privacy ? '附件资料已隐藏' : `${escapeHTML(item.mimeType)} · ${attachmentSizeLabel(item.sizeBytes)}`}</div></div>
            <div class="attachment-manager-actions">
              <button type="button" data-manager-up ${index === 0 ? 'disabled' : ''} aria-label="上移">${icon('chevronLeft', 14)}</button>
              <button type="button" data-manager-down ${index === items.length - 1 ? 'disabled' : ''} aria-label="下移">${icon('chevronRight', 14)}</button>
              <button type="button" data-manager-replace aria-label="替换">${icon('transfer', 14)}</button>
              <button type="button" data-manager-rename aria-label="重命名">${icon('note', 14)}</button>
              <button type="button" class="danger" data-manager-remove aria-label="移除">${icon('x', 14)}</button>
            </div>
          </div>`).join('') || '<div class="caption picker-empty">尚未添加附件</div>'}
        </div>
        ${items.length < attachmentLimit ? '<button class="sheet-secondary" data-manager-add>添加附件</button>' : ''}
        <button class="sheet-primary" data-manager-close>完成</button>
      </section>`;
  };
  render();
  const surface = layer.querySelector('.picker-sheet');
  const backdrop = layer.querySelector('.picker-scrim');
  backdrop?.setAttribute('data-modal-backdrop', '');
  mountModalLayer(layer);
  const releaseModal = pushModalLayer(layer, { kind: 'attachment-manager', trigger, surface, backdrop });
  requestAnimationFrame(() => layer.classList.add('open'));
  const close = () => {
    if (!isTopModal(layer)) return false;
    releaseModal();
    activeAttachmentManagerClose = null;
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 200);
    return true;
  };
  activeAttachmentManagerClose = close;
  requestAnimationFrame(() => surface?.focus?.({ preventScroll: true }));

  layer.addEventListener('click', (event) => {
    if (!isTopModal(layer)) return;
    if (event.target.closest('[data-manager-close]')) { close(); return; }
    if (event.target.closest('[data-manager-add]')) { requestFile?.(null); return; }
    const row = event.target.closest('[data-attachment-id]');
    if (!row) return;
    const id = row.dataset.attachmentId;
    const items = data.getAttachments(ownerType, ownerId);
    const index = items.findIndex((item) => item.attachmentId === id);
    if (event.target.closest('[data-manager-preview]')) { openAttachmentGallery(items, index); return; }
    if (event.target.closest('[data-manager-remove]')) {
      if (ownerType === 'transaction' && !window.confirm('从这笔记录移除这个附件？金额与余额不会改变。')) return;
      data.removeAttachment(id);
      document.dispatchEvent(new CustomEvent('ringgitme:attachment-changed', { detail: { ownerType, ownerId } }));
      onChange?.(data.getAttachments(ownerType, ownerId));
      render();
      return;
    }
    if (event.target.closest('[data-manager-replace]')) { requestFile?.(id); return; }
    if (event.target.closest('[data-manager-rename]')) {
      const item = items[index];
      const requested = window.prompt('重命名附件', item.name);
      if (requested == null) return;
      try { data.renameAttachment(id, requested); render(); onChange?.(); } catch (error) { toast(error.message); }
      return;
    }
    const direction = event.target.closest('[data-manager-up]') ? -1 : event.target.closest('[data-manager-down]') ? 1 : 0;
    if (!direction) return;
    const order = items.map((item) => item.attachmentId);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    data.reorderAttachments(ownerType, ownerId, order, `att-reorder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    render();
  });
  layer.addEventListener('keydown', (event) => { if (event.key === 'Escape' && isTopModal(layer)) { event.preventDefault(); event.stopPropagation(); close(); } });
  return { close };
}

export function openAttachmentGallery(items, startIndex = 0) {
  if (!items.length) return;
  document.querySelector('.attachment-gallery-layer')?.remove();
  const layer = document.createElement('div');
  layer.className = 'picker-layer attachment-gallery-layer';
  let index = Math.min(Math.max(0, startIndex), items.length - 1);
  let renaming = false;
  const refreshItem = () => {
    const current = items[index];
    if (!current || current.attachmentId === 'legacy') return current;
    const fresh = data.getAttachment(current.attachmentId);
    if (fresh) items[index] = fresh;
    return fresh || current;
  };
  const render = () => {
    const item = refreshItem();
    const canDownload = attachmentCanDownload(item);
    const canShare = attachmentCanShare(item);
    layer.innerHTML = `<button class="picker-scrim" data-gallery-close aria-label="关闭预览"></button>
      <section class="picker-sheet glass-sheet attachment-gallery" role="dialog" aria-modal="true" aria-label="附件预览">
        <header class="attachment-gallery-header"><strong>附件 ${index + 1} / ${items.length}</strong><span class="attachment-name" title="${escapeHTML(attachmentDisplayName(item, index))}">${escapeHTML(attachmentDisplayName(item, index))}</span></header>
        <div class="attachment-gallery-stage">
          ${item.kind === 'photo' && item.localObjectUrl
            ? `<button type="button" class="attachment-gallery-image${ui.privacy ? ' is-private' : ''}" data-gallery-lightbox aria-label="全屏查看 ${escapeHTML(attachmentDisplayName(item, index))}"><img src="${escapeHTML(item.localObjectUrl)}" alt="${escapeHTML(attachmentDisplayName(item, index))}" /></button>`
            : `<div class="attachment-gallery-file">${icon('paperclip', 30)}<div class="row-title attachment-name">${escapeHTML(attachmentDisplayName(item, index))}</div><div class="caption">${ui.privacy ? '附件资料已隐藏' : `${escapeHTML(item.mimeType)} · ${attachmentSizeLabel(item.sizeBytes)}`}</div></div>`}
        </div>
        <div class="attachment-gallery-nav">
          <button type="button" data-gallery-prev ${index === 0 ? 'disabled' : ''} aria-label="上一个">${icon('chevronLeft', 18)}</button>
          <span class="caption num">${index + 1} / ${items.length}</span>
          <button type="button" data-gallery-next ${index === items.length - 1 ? 'disabled' : ''} aria-label="下一个">${icon('chevronRight', 18)}</button>
        </div>
        ${renaming ? `<div class="attachment-rename"><label class="cap-field"><span class="caption">新名称</span><input data-gallery-rename-input maxlength="120" value="${escapeHTML(item.name)}" /></label><div><button class="sheet-secondary" data-gallery-rename-cancel>取消</button><button class="sheet-primary" data-gallery-rename-save>保存</button></div></div>` : `<div class="attachment-gallery-actions">
          ${canDownload ? `<button type="button" data-gallery-download>${icon('arrowDown', 16)} 下载</button>` : ''}
          ${canShare ? `<button type="button" data-gallery-share>${icon('transfer', 16)} 分享</button>` : ''}
          ${item.attachmentId !== 'legacy' ? `<button type="button" data-gallery-rename>${icon('note', 16)} 重命名</button><button type="button" class="danger" data-gallery-delete>${icon('x', 16)} 删除</button>` : ''}
        </div>`}
        <button class="sheet-primary" data-gallery-close>完成</button>
      </section>`;
  };
  render();
  document.getElementById('app').appendChild(layer);
  const releaseModal = pushModalLayer(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  const close = () => { releaseModal(); layer.classList.remove('open'); setTimeout(() => layer.remove(), 200); };
  let touchStartX = null;
  layer.addEventListener('click', (event) => {
    if (event.target.closest('[data-gallery-close]')) return close();
    const item = refreshItem();
    if (event.target.closest('[data-gallery-lightbox]')) {
      return openAttachmentLightbox(items, index, { onClose: (nextIndex) => { index = nextIndex; render(); } });
    }
    if (event.target.closest('[data-gallery-download]')) { downloadAttachment(item); return; }
    if (event.target.closest('[data-gallery-share]')) { shareAttachment(item); return; }
    if (event.target.closest('[data-gallery-rename]')) { renaming = true; render(); layer.querySelector('[data-gallery-rename-input]')?.focus(); return; }
    if (event.target.closest('[data-gallery-rename-cancel]')) { renaming = false; render(); return; }
    if (event.target.closest('[data-gallery-rename-save]')) {
      try { items[index] = data.renameAttachment(item.attachmentId, layer.querySelector('[data-gallery-rename-input]')?.value); renaming = false; render(); } catch (error) { toast(error.message); }
      return;
    }
    if (event.target.closest('[data-gallery-delete]')) {
      data.removeAttachment(item.attachmentId);
      document.dispatchEvent(new CustomEvent('ringgitme:attachment-changed', { detail: { ownerType: item.ownerEntityType, ownerId: item.ownerEntityId } }));
      items.splice(index, 1);
      if (!items.length) return close();
      index = Math.min(index, items.length - 1);
      render(); return;
    }
    if (event.target.closest('[data-gallery-prev]') && index > 0) { index -= 1; render(); }
    if (event.target.closest('[data-gallery-next]') && index < items.length - 1) { index += 1; render(); }
  });
  layer.addEventListener('touchstart', (event) => { touchStartX = event.touches[0]?.clientX ?? null; }, { passive: true });
  layer.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    touchStartX = null;
    if (delta < -40 && index < items.length - 1) { index += 1; render(); }
    if (delta > 40 && index > 0) { index -= 1; render(); }
  });
  layer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
  return { close };
}

export function clampLightboxScale(value) {
  return Math.min(5, Math.max(1, Number(value) || 1));
}

export function openAttachmentLightbox(items, startIndex = 0, { onClose } = {}) {
  const photos = items;
  if (!photos.length) return null;
  const layer = document.createElement('div');
  layer.className = 'attachment-lightbox';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', '全屏附件预览');
  layer.tabIndex = -1;
  let index = Math.min(Math.max(0, startIndex), photos.length - 1);
  let scale = 1;
  let x = 0;
  let y = 0;
  let lastTap = 0;
  const pointers = new Map();
  let pinchStart = null;
  const current = () => photos[index];
  const reset = () => { scale = 1; x = 0; y = 0; updateTransform(); };
  const updateTransform = () => {
    const image = layer.querySelector('[data-lightbox-image]');
    if (image) image.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    layer.querySelector('[data-lightbox-reset]')?.toggleAttribute('disabled', scale === 1 && x === 0 && y === 0);
  };
  const render = () => {
    const item = current();
    layer.innerHTML = `<div class="lightbox-top"><button type="button" data-lightbox-close aria-label="关闭">${icon('x', 22)}</button><strong class="num">${index + 1} / ${photos.length}</strong><div><button type="button" data-lightbox-download aria-label="下载">${icon('arrowDown', 19)}</button>${attachmentCanShare(item) ? `<button type="button" data-lightbox-share aria-label="分享">${icon('transfer', 19)}</button>` : ''}</div></div>
      <div class="lightbox-stage" data-lightbox-stage>${item?.kind === 'photo' && item.localObjectUrl ? `<img src="${escapeHTML(item.localObjectUrl)}" alt="${escapeHTML(item.name)}" draggable="false" data-lightbox-image />` : `<div class="attachment-gallery-file">${icon('paperclip', 32)}<strong>${escapeHTML(item?.name || '附件')}</strong></div>`}</div>
      <div class="lightbox-bottom"><button type="button" data-lightbox-prev ${index === 0 || scale > 1 ? 'disabled' : ''}>${icon('chevronLeft', 20)}</button><button type="button" data-lightbox-reset disabled>重置缩放</button><button type="button" data-lightbox-next ${index === photos.length - 1 || scale > 1 ? 'disabled' : ''}>${icon('chevronRight', 20)}</button></div>`;
    updateTransform();
  };
  render();
  document.getElementById('app').appendChild(layer);
  const releaseModal = pushModalLayer(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
  layer.focus();
  const close = () => { releaseModal(); layer.classList.remove('open'); setTimeout(() => layer.remove(), 180); onClose?.(index); };
  const moveIndex = (delta) => {
    if (scale > 1) return;
    const next = Math.max(0, Math.min(photos.length - 1, index + delta));
    if (next === index) return;
    index = next; scale = 1; x = 0; y = 0; render();
  };
  layer.addEventListener('click', (event) => {
    if (event.target.closest('[data-lightbox-close]')) return close();
    if (event.target.closest('[data-lightbox-reset]')) return reset();
    if (event.target.closest('[data-lightbox-prev]')) return moveIndex(-1);
    if (event.target.closest('[data-lightbox-next]')) return moveIndex(1);
    if (event.target.closest('[data-lightbox-download]')) return downloadAttachment(current());
    if (event.target.closest('[data-lightbox-share]')) return shareAttachment(current());
  });
  layer.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('[data-lightbox-stage]')) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, previousX: event.clientX, previousY: event.clientY });
    event.target.setPointerCapture?.(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale };
    }
  });
  layer.addEventListener('pointermove', (event) => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX; point.y = event.clientY;
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      scale = clampLightboxScale(pinchStart.scale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinchStart.distance));
    } else if (scale > 1) {
      x += point.x - point.previousX; y += point.y - point.previousY;
    }
    point.previousX = point.x; point.previousY = point.y;
    updateTransform();
  });
  const finishPointer = (event) => {
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    pinchStart = null;
    if (!point) return;
    if (scale <= 1) {
      const dx = point.x - point.startX;
      if (Math.abs(dx) > 48) moveIndex(dx < 0 ? 1 : -1);
    }
  };
  layer.addEventListener('pointerup', finishPointer);
  layer.addEventListener('pointercancel', finishPointer);
  layer.addEventListener('dblclick', (event) => { if (event.target.closest('[data-lightbox-stage]')) { scale = scale > 1 ? 1 : 2.5; x = 0; y = 0; updateTransform(); } });
  layer.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTap < 300 && event.target.closest('[data-lightbox-stage]')) { scale = scale > 1 ? 1 : 2.5; x = 0; y = 0; updateTransform(); }
    lastTap = now;
  }, { passive: true });
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowLeft') moveIndex(-1);
    if (event.key === 'ArrowRight') moveIndex(1);
  });
  return { close, getIndex: () => index, getScale: () => scale, reset };
}

export function attachmentCanDownload(item) {
  return Boolean(item?.localObjectUrl && /^(?:blob:|data:)/.test(item.localObjectUrl));
}

function dataURLFile(item) {
  if (!String(item.localObjectUrl || '').startsWith('data:') || typeof File === 'undefined') return null;
  const [header, encoded = ''] = item.localObjectUrl.split(',', 2);
  const mimeType = /data:([^;,]+)/.exec(header)?.[1] || item.mimeType || 'application/octet-stream';
  const binary = header.includes(';base64') ? atob(encoded) : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], item.name, { type: mimeType });
}

export function attachmentCanShare(item) {
  if (!attachmentCanDownload(item) || typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    const file = dataURLFile(item);
    return Boolean(file && navigator.canShare({ files: [file] }));
  } catch { return false; }
}

export function downloadAttachment(item) {
  if (!attachmentCanDownload(item)) return false;
  const anchor = document.createElement('a');
  anchor.href = item.localObjectUrl;
  anchor.download = item.name;
  anchor.rel = 'noopener';
  anchor.click();
  data.recordAttachmentDownloaded?.(item.attachmentId);
  return true;
}

export async function shareAttachment(item) {
  if (!attachmentCanShare(item)) return false;
  try {
    const file = dataURLFile(item);
    await navigator.share({ files: [file], title: item.name });
    data.recordAttachmentShared?.(item.attachmentId);
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') toast('无法分享，已保留下载选项');
    return false;
  }
}
