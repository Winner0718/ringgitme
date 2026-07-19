import { escapeHTML } from '../app/format.js';
import { registerOwnedModalHistory } from '../app/modalHistory.js';
import { icon } from './Icons.js';
import { isTopModal, mountModalLayer, pushModalLayer } from '../app/modalStack.js';
import { attachSheetVisualViewport } from './AppSheet.js';

// RinggitMe picker — replaces raw native <select> in transaction and
// relationship flows. Renders as its own layer (like the time picker) so it
// can overlay an open sheet without dismissing it. Options carry a stable
// value, label, optional caption, and the current selection shows a check.
// Long lists (>8) gain a search field. Esc cancels; CSS caps desktop width.

const SEARCH_THRESHOLD = 8;
let activePickerCancel = null;
let pickerSequence = 0;

function optionRow(option, selectedValue) {
  const active = option.value === selectedValue;
  return `<button type="button" class="picker-option${active ? ' active' : ''}" data-picker-value="${escapeHTML(option.value)}" role="option" aria-selected="${active}">
    ${option.avatar ? `<span class="avatar picker-avatar">${escapeHTML(option.avatar)}</span>` : ''}
    <span class="picker-option-main"><span class="picker-option-label">${escapeHTML(option.label)}</span>${option.caption ? `<span class="caption">${escapeHTML(option.caption)}</span>` : ''}</span>
    ${active ? `<span class="picker-check">${icon('check', 16)}</span>` : ''}
  </button>`;
}

export function openPickerSheet({ title, options, selectedValue = null, onSelect, searchable = options.length > SEARCH_THRESHOLD, trigger = document.activeElement, id = null, parentId = undefined }) {
  if (activePickerCancel && !activePickerCancel()) return null;
  if (activePickerCancel) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<div class="picker-layer modal-layer" data-sheet-detent="medium" role="presentation">
    <button class="picker-scrim" data-modal-backdrop data-picker-cancel aria-label="取消选择"></button>
    <section class="picker-sheet glass-sheet" data-sheet-detent="medium" data-modal-surface role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}" tabindex="-1">
      <div class="time-picker-grabber"><span></span></div>
      <header class="time-picker-title">${escapeHTML(title)}</header>
      ${searchable ? `<label class="search-field surface picker-search">${icon('search', 15)}<input type="search" data-picker-search placeholder="搜索" aria-label="搜索选项" /></label>` : ''}
      <div class="picker-options" data-picker-options role="listbox" aria-label="${escapeHTML(title)}">${options.map((option) => optionRow(option, selectedValue)).join('')}</div>
      <button class="sheet-secondary picker-cancel" data-picker-cancel>取消</button>
    </section>
  </div>`;
  const layer = wrapper.firstElementChild;
  mountModalLayer(layer);
  const viewportCleanup = attachSheetVisualViewport(layer);
  const pickerId = id || `picker:${++pickerSequence}`;
  const releaseModal = pushModalLayer(layer, { id: pickerId, parentId, kind: 'picker', trigger, surface: layer.querySelector('.picker-sheet'), backdrop: layer.querySelector('.picker-scrim') });
  let closed = false;
  let committing = false;
  requestAnimationFrame(() => layer.classList.add('open'));

  const finishClose = () => {
    if (closed) return false;
    if (!isTopModal(layer)) return false;
    releaseModal(pickerId);
    viewportCleanup();
    closed = true;
    activePickerCancel = null;
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 200);
    return true;
  };
  const ownedHistory = registerOwnedModalHistory({ layerId: pickerId, stateKey: 'ringgitmePicker', isTop: () => isTopModal(layer), onPop: finishClose });
  const close = () => ownedHistory.requestClose();
  activePickerCancel = close;
  layer.querySelectorAll('[data-picker-cancel]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); close(); }));
  layer.querySelector('[data-picker-options]').addEventListener('click', (event) => {
    if (!isTopModal(layer)) return;
    const button = event.target.closest('[data-picker-value]');
    if (!button || committing || closed) return;
    event.stopPropagation();
    committing = true;
    layer.style.pointerEvents = 'none';
    try {
      // Commit into the still-mounted parent draft before closing exactly the
      // child layer. This keeps rerendered fields, scroll and focus restorable.
      onSelect?.(button.dataset.pickerValue);
      close();
    } catch (error) {
      committing = false;
      layer.style.pointerEvents = '';
      console.error('picker_commit_failed', error);
      throw error;
    }
  });
  const search = layer.querySelector('[data-picker-search]');
  if (search) {
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      const filtered = query ? options.filter((option) => `${option.label} ${option.caption || ''}`.toLowerCase().includes(query)) : options;
      layer.querySelector('[data-picker-options]').innerHTML = filtered.map((option) => optionRow(option, selectedValue)).join('') || '<div class="caption picker-empty">没有符合的选项</div>';
    });
    search.focus();
  }
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isTopModal(layer)) { event.preventDefault(); event.stopPropagation(); close(); }
  });
  requestAnimationFrame(() => (search || layer.querySelector('.picker-sheet'))?.focus?.({ preventScroll: true }));
  return { cancel: close, layerId: pickerId, parentLayerId: releaseModal.parentSheetId };
}

// Compact display field that opens the picker — shared markup for forms.
export function pickerFieldHTML({ label, key, valueLabel, caption = '' }) {
  return `<div class="cap-field"><span class="caption">${escapeHTML(label)}</span>
    <button type="button" class="native-picker-display picker-field rm-picker-field" data-rm-component="PickerField" data-picker-field="${escapeHTML(key)}" aria-label="${escapeHTML(label)}，当前 ${escapeHTML(valueLabel)}">
      <span class="picker-field-value" data-picker-field-label="${escapeHTML(key)}">${escapeHTML(valueLabel)}</span>${caption ? `<span class="caption">${escapeHTML(caption)}</span>` : ''}${icon('chevronRight', 15)}
    </button>
  </div>`;
}
