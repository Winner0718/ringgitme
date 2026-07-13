import { openSheet, toast } from './AppSheet.js';
import { icon } from './Icons.js';
import { data, registerAction } from '../app/state.js';
import { escapeHTML } from '../app/format.js';
import { CATEGORY_ICONS } from '../domain/categoryRepository.js';
import { createReorderSession } from '../domain/reorderSession.js';

const TYPE_LABEL = { expense: '支出', income: '收入', transfer: '转账' };
const PICKER_TITLE = { expense: '选择支出类别', income: '选择收入类别', transfer: '选择转账用途' };
const ICON_LABEL = {
  food: '餐饮', car: '交通', cart: '购物', receipt: '账单', home: '住房', heart: '医疗',
  ticket: '娱乐', salary: '薪资', gift: '礼金', refund: '退款', interest: '利息', aa: 'AA',
  savings: '储蓄', repayment: '还款', investment: '投资', note: '其他', transfer: '转账',
  wallet: '钱包', arrowDown: '提现',
};

let picker = null;
let managerType = 'expense';
let managerReturn = null;
let editId = null;

function categoryItem(item, selectedId) {
  return `<button class="habit-picker-item" data-action="habit-pick" data-cat="${item.id}">
    <span class="habit-icon theme-${item.themeToken}">${icon(item.icon, 18)}</span>
    <span class="habit-name">${escapeHTML(item.name)}</span>
    ${item.id === selectedId ? `<span class="habit-check">${icon('check', 18)}</span>` : ''}
  </button>`;
}

function renderPicker(query = '') {
  const active = data.getCategories(picker.type).filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pinned = active.filter((item) => item.isPinned);
  const rest = active.filter((item) => !item.isPinned);
  const optional = picker.type === 'transfer' ? `<button class="habit-picker-item" data-action="habit-pick" data-cat=""><span class="habit-icon theme-slate">${icon('transfer', 18)}</span><span class="habit-name">无用途</span>${!picker.selectedId ? `<span class="habit-check">${icon('check', 18)}</span>` : ''}</button>` : '';
  const sheet = openSheet({
    title: PICKER_TITLE[picker.type], className: 'habit-picker-sheet',
    contentHTML: `<label class="habit-search">${icon('search', 16)}<input type="search" placeholder="搜索" data-habit-search value="${escapeHTML(query)}" /></label>
      <div class="habit-picker-list">
        ${optional}
        ${pinned.length ? `<div class="caption habit-section-title">常用</div>${pinned.map((item) => categoryItem(item, picker.selectedId)).join('')}` : ''}
        <div class="caption habit-section-title">全部</div>
        ${(pinned.length ? rest : active).map((item) => categoryItem(item, picker.selectedId)).join('') || '<div class="empty caption">没有符合条件的类别</div>'}
      </div>
      <button class="habit-manage-link" data-action="habit-manage">管理类别 ${icon('chevronRight', 15)}</button>`,
  });
  const search = sheet.querySelector('[data-habit-search]');
  search?.addEventListener('input', () => renderPicker(search.value));
  if (query) { const next = sheet.querySelector('[data-habit-search]'); next?.focus(); next?.setSelectionRange(query.length, query.length); }
}

export function openCategoryPicker(options) {
  picker = { ...options };
  renderPicker();
}

function managerRow(item, draggable = true) {
  return `<div class="habit-manage-row${item.isArchived ? ' archived' : ''}">
    ${draggable ? `<button class="habit-drag" data-drag-handle data-cat="${item.id}" aria-label="排列 ${escapeHTML(item.name)}" aria-pressed="false">≡</button>` : '<span class="habit-drag-spacer" aria-hidden="true"></span>'}
    <span class="habit-icon theme-${item.themeToken}">${icon(item.icon, 18)}</span>
    <button class="habit-row-main" data-action="habit-edit" data-cat="${item.id}">
      <span>${escapeHTML(item.name)}</span>
      <span class="caption">${item.isArchived ? '已隐藏' : [item.isPinned ? '常用' : '', data.getDefaultCategoryId(item.transactionType) === item.id ? '默认' : ''].filter(Boolean).join(' · ')}</span>
    </button>
    ${!item.isSystemFallback ? `<button class="habit-mini${item.isPinned ? ' active' : ''}" data-action="habit-pin" data-cat="${item.id}" aria-label="置顶">${icon('pin', 15)}</button>` : ''}
    <button class="habit-mini" data-action="habit-edit" data-cat="${item.id}" aria-label="编辑">${icon('chevronRight', 16)}</button>
  </div>`;
}

function renderManager() {
  const items = data.getCategories(managerType, { includeArchived: true, includeFallback: true });
  const active = items.filter((item) => !item.isArchived);
  const archived = items.filter((item) => item.isArchived && !item.isSystemFallback);
  const sheet = openSheet({
    title: '管理类别', className: 'habit-manager-sheet',
    contentHTML: `<div class="segmented habit-type-segments">${Object.entries(TYPE_LABEL).map(([type, label]) => `<button class="seg-item${type === managerType ? ' active' : ''}" data-action="habit-manager-type" data-type="${type}">${label}</button>`).join('')}</div>
      <div class="habit-manager-list" data-active-manager-list>${active.map((item) => managerRow(item, true)).join('')}</div>
      ${archived.length ? `<div class="caption habit-section-title">隐藏项目</div><div class="habit-manager-list">${archived.map((item) => managerRow(item, false)).join('')}</div>` : ''}
      <button class="sheet-primary" data-action="habit-add">添加${managerType === 'transfer' ? '用途' : '类别'}</button>
      <button class="sheet-secondary" data-action="habit-reset-type">恢复${TYPE_LABEL[managerType]}默认</button>
      <button class="sheet-secondary" data-action="habit-manager-done">完成</button>`,
  });
  bindManagerReorder(sheet);
}

export function openCategoryManager({ initialType = 'expense', onDone = null } = {}) {
  managerType = initialType;
  managerReturn = onDone;
  renderManager();
}

export function categoryEditorHTML(item = null, type = managerType, isDefault = false) {
  return `<div class="transaction-form" data-habit-edit-form>
    <label class="cap-field"><span class="caption">名称</span><input type="text" maxlength="12" data-habit-name value="${escapeHTML(item?.name || '')}" placeholder="输入名称" /></label>
    <div><div class="caption habit-field-title">图标</div><div class="habit-icon-grid">${CATEGORY_ICONS.map((name) => `<button class="habit-icon-choice${(item?.icon || 'note') === name ? ' active' : ''}" data-action="habit-icon-choice" data-icon="${name}" title="${ICON_LABEL[name] || name}">${icon(name, 19)}</button>`).join('')}</div></div>
    <label class="transaction-check"><input type="checkbox" data-habit-pinned ${item?.isPinned ? 'checked' : ''}/><span>设为常用</span></label>
    ${type === 'transfer' ? '' : `<label class="transaction-check"><input type="checkbox" data-habit-default ${isDefault ? 'checked' : ''}/><span>设为默认</span></label>`}
    <input type="hidden" data-habit-icon value="${item?.icon || 'note'}"/>
    </div>
    <button class="sheet-primary" data-action="habit-edit-save">保存</button>
    ${item && !item.isSystemFallback ? `<button class="sheet-secondary" data-action="${item.isArchived ? 'habit-restore' : 'habit-archive'}" data-cat="${item.id}">${item.isArchived ? '恢复显示' : '隐藏类别'}</button>
      ${item.id.startsWith('custom-') ? `<button class="sheet-danger" data-action="habit-remove" data-cat="${item.id}">删除类别</button>` : ''}` : ''}
    <button class="sheet-secondary" data-action="habit-edit-cancel">取消</button>`;
}

function editSheet(item = null) {
  editId = item?.id || null;
  const isDefault = item && data.getDefaultCategoryId(managerType) === item.id;
  openSheet({
    title: item ? `编辑${managerType === 'transfer' ? '用途' : '类别'}` : `添加${managerType === 'transfer' ? '用途' : '类别'}`,
    className: 'habit-edit-sheet',
    contentHTML: categoryEditorHTML(item, managerType, isDefault),
  });
}

function bindManagerReorder(sheet) {
  const list = sheet.querySelector('[data-active-manager-list]');
  if (!list) return;
  const ids = () => [...list.querySelectorAll('.habit-manage-row')].map((row) => row.querySelector('[data-cat]')?.dataset.cat).filter(Boolean);
  const nodes = new Map([...list.querySelectorAll('.habit-manage-row')].map((row) => [row.querySelector('[data-cat]').dataset.cat, row]));
  const scrollSurface = sheet;
  let pointer = null;
  let keyboard = null;
  let autoScrollFrame = 0;

  const animateOrder = (order) => {
    const before = new Map([...nodes].map(([id, row]) => [id, row.getBoundingClientRect().top]));
    order.forEach((id) => list.appendChild(nodes.get(id)));
    nodes.forEach((row, id) => {
      const delta = before.get(id) - row.getBoundingClientRect().top;
      if (!delta) return;
      row.style.transition = 'none';
      row.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => { row.style.transition = ''; row.style.transform = ''; });
    });
  };

  const stopAutoScroll = () => { cancelAnimationFrame(autoScrollFrame); autoScrollFrame = 0; };
  const autoScroll = () => {
    if (!pointer?.active) return;
    const rect = scrollSurface.getBoundingClientRect();
    const edge = 54;
    const delta = pointer.y < rect.top + edge ? -8 : pointer.y > rect.bottom - edge ? 8 : 0;
    if (delta) scrollSurface.scrollTop += delta;
    autoScrollFrame = requestAnimationFrame(autoScroll);
  };

  const cleanupPointer = () => {
    stopAutoScroll();
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('keydown', onPointerKey);
    document.body.classList.remove('habit-dragging');
    if (pointer?.row) pointer.row.classList.remove('drag-active');
    pointer?.handle?.setAttribute('aria-pressed', 'false');
    pointer = null;
  };

  const finishPointer = (cancelled) => {
    if (!pointer) return;
    if (pointer.active) {
      if (cancelled) animateOrder(pointer.session.cancel());
      else data.reorderCategories(managerType, pointer.session.commit());
    }
    cleanupPointer();
  };

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    pointer.y = event.clientY;
    if (!pointer.active && Math.abs(event.clientY - pointer.startY) >= 8) {
      pointer.active = true;
      pointer.row.classList.add('drag-active');
      pointer.handle.setAttribute('aria-pressed', 'true');
      document.body.classList.add('habit-dragging');
      autoScroll();
    }
    if (!pointer.active) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.habit-manage-row');
    if (!target || target === pointer.row || target.parentElement !== list) return;
    const current = pointer.session.getCurrent();
    const from = current.indexOf(pointer.id);
    const targetIndex = current.indexOf(target.querySelector('[data-cat]').dataset.cat);
    let insertAt = event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2 ? targetIndex : targetIndex + 1;
    if (from < insertAt) insertAt -= 1;
    const next = pointer.session.move(pointer.id, insertAt);
    animateOrder(next);
  }
  function onPointerUp(event) { if (pointer && event.pointerId === pointer.pointerId) finishPointer(false); }
  function onPointerCancel(event) { if (pointer && event.pointerId === pointer.pointerId) finishPointer(true); }
  function onPointerKey(event) { if (event.key === 'Escape') { event.preventDefault(); finishPointer(true); } }

  const startKeyboard = (handle) => {
    const id = handle.dataset.cat;
    keyboard = { id, handle, row: nodes.get(id), session: createReorderSession(ids()) };
    keyboard.row.classList.add('keyboard-reordering');
    handle.setAttribute('aria-pressed', 'true');
  };
  const finishKeyboard = (cancelled) => {
    if (!keyboard) return;
    const order = cancelled ? keyboard.session.cancel() : keyboard.session.commit();
    animateOrder(order);
    if (!cancelled) data.reorderCategories(managerType, order);
    keyboard.row.classList.remove('keyboard-reordering');
    keyboard.handle.setAttribute('aria-pressed', 'false');
    keyboard = null;
  };

  list.querySelectorAll('[data-drag-handle]').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
      if (pointer || keyboard) return;
      const id = handle.dataset.cat;
      pointer = { id, handle, row: nodes.get(id), pointerId: event.pointerId, startY: event.clientY, y: event.clientY, active: false, session: createReorderSession(ids()) };
      try { handle.setPointerCapture?.(event.pointerId); } catch { /* synthetic/legacy pointers can continue via document listeners */ }
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
      document.addEventListener('keydown', onPointerKey);
    });
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (keyboard?.handle === handle) finishKeyboard(false); else if (!keyboard && !pointer) startKeyboard(handle);
      } else if (keyboard?.handle === handle && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const current = keyboard.session.getCurrent();
        const target = current.indexOf(keyboard.id) + (event.key === 'ArrowUp' ? -1 : 1);
        animateOrder(keyboard.session.move(keyboard.id, target));
      } else if (keyboard?.handle === handle && event.key === 'Escape') {
        event.preventDefault(); finishKeyboard(true);
      }
    });
  });
}

export function registerCategorySheetActions() {
  registerAction('habit-pick', (el) => { const id = el.dataset.cat || null; picker.selectedId = id; picker.onSelect?.(id); });
  registerAction('habit-manage', () => openCategoryManager({ initialType: picker.type, onDone: () => renderPicker() }));
  registerAction('habit-manager-type', (el) => { managerType = el.dataset.type; renderManager(); });
  registerAction('habit-manager-done', () => managerReturn ? managerReturn() : picker?.onBack?.());
  registerAction('habit-add', () => editSheet());
  registerAction('habit-edit', (el) => editSheet(data.getCategory(el.dataset.cat)));
  registerAction('habit-edit-cancel', () => renderManager());
  registerAction('habit-icon-choice', (el) => { document.querySelector('[data-habit-icon]').value = el.dataset.icon; document.querySelectorAll('.habit-icon-choice').forEach((node) => node.classList.toggle('active', node === el)); });
  registerAction('habit-edit-save', () => {
    const form = document.querySelector('[data-habit-edit-form]');
    try {
      const values = { name: form.querySelector('[data-habit-name]').value, icon: form.querySelector('[data-habit-icon]').value, isPinned: form.querySelector('[data-habit-pinned]').checked, isDefault: Boolean(form.querySelector('[data-habit-default]')?.checked) };
      if (editId) data.updateCategory(editId, values); else data.createCategory({ transactionType: managerType, ...values });
      toast(editId ? '类别已更新' : '类别已添加'); renderManager();
    } catch (error) { toast(error.message); }
  });
  registerAction('habit-pin', (el) => { try { data.toggleCategoryPin(el.dataset.cat); renderManager(); } catch (error) { toast(error.message); } });
  registerAction('habit-archive', (el) => { try { data.archiveCategory(el.dataset.cat); toast('已隐藏，历史记录仍会保留'); renderManager(); } catch (error) { toast(error.message); } });
  registerAction('habit-restore', (el) => { try { data.restoreCategory(el.dataset.cat); toast('已恢复'); renderManager(); } catch (error) { toast(error.message); } });
  registerAction('habit-remove', (el) => {
    const id = el.dataset.cat;
    openSheet({ title: '删除类别', contentHTML: '<div class="detail-hero"><div class="row-title">确定永久删除？</div><div class="caption">仅未使用的自定义类别可以删除。</div></div><button class="sheet-danger" data-action="habit-remove-confirm" data-cat="' + id + '">确认删除</button><button class="sheet-secondary" data-action="habit-edit-cancel">取消</button>' });
  });
  registerAction('habit-remove-confirm', (el) => { try { data.removeCategory(el.dataset.cat); toast('类别已删除'); renderManager(); } catch (error) { toast(error.message); editSheet(data.getCategory(el.dataset.cat)); } });
  registerAction('habit-reset-type', () => { data.resetCategoryType(managerType); toast(`${TYPE_LABEL[managerType]}类别已恢复默认`); renderManager(); });
}
