import { openSheet, closeSheet, toast } from './AppSheet.js';
import { icon } from './Icons.js';
import { fmtRM, escapeHTML } from '../app/format.js';
import { data, update, registerAction } from '../app/state.js';
import { navigate } from '../app/router.js';
import { openCategoryPicker, registerCategorySheetActions } from './CategorySheets.js';
import { nativeDateTimeFieldsHTML, bindNativeDateTimeFields } from './NativeDateTimeFields.js';
import { attachmentMetadata, attachmentSizeLabel } from '../domain/attachmentSession.js';

const MODES = [
  { id: 'expense', label: '支出' }, { id: 'income', label: '收入' }, { id: 'transfer', label: '转账' },
];

const cap = {
  mode: 'expense', amount: '', catId: null, accountId: 'sv-mbb', destinationAccountId: 'ew-tng',
  recordOnly: false, attachment: null, desc: '', date: '', time: '',
  submissionKey: '',
};
let sheetEl = null;
let saving = false;
let advancedDraft = null;
let advancedSheet = null;

function defaultCategoryId(type) {
  return type === 'transfer' ? null : data.getDefaultCategoryId(type) || data.getDefaultCategory(type)?.id || null;
}

export function openCaptureSheet({ preserve = false } = {}) {
  const now = new Date();
  if (!preserve) {
    Object.assign(cap, {
      mode: 'expense', amount: '', catId: defaultCategoryId('expense'), accountId: 'sv-mbb', destinationAccountId: 'ew-tng',
      recordOnly: false, attachment: null, desc: '', date: data.today,
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      submissionKey: `capture-${now.getTime()}-${Math.random().toString(36).slice(2)}`,
    });
  }
  saving = false;
  sheetEl = openSheet({ title: '', className: 'capture-sheet', contentHTML: captureHTML(), onClose: () => (sheetEl = null) });
  bindCapturePickers();
}

function syncForm() {
  if (!sheetEl) return;
  const get = (selector) => sheetEl.querySelector(selector)?.value;
  if (get('[data-cap-desc]') !== undefined) cap.desc = get('[data-cap-desc]');
}

function rerender() {
  if (!sheetEl) return;
  syncForm();
  sheetEl.querySelector('.sheet-body').innerHTML = captureHTML();
  bindCapturePickers();
}

function bindCapturePickers() {
  bindNativeDateTimeFields(sheetEl, { onDateChange: (value) => { cap.date = value; }, onTimeChange: (value) => { cap.time = value; } });
}

function detailsSummary() {
  const parts = [];
  if (cap.attachment) parts.push('1个附件');
  if (cap.recordOnly) parts.push('只记录');
  return parts.join(' · ');
}

function quickRow(type) {
  const items = data.getQuickCategories(type);
  const title = type === 'transfer' ? '用途（可选）' : type === 'income' ? '收入类别' : '支出类别';
  return `<div class="caption cap-account-label">${title}</div><div class="cap-cats" role="listbox" aria-label="${title}">
    ${type === 'transfer' ? `<button class="cap-cat${!cap.catId ? ' active' : ''}" data-action="cap-cat" data-cat="">无用途</button>` : ''}
    ${items.map((item) => `<button class="cap-cat${cap.catId === item.id ? ' active' : ''}" data-action="cap-cat" data-cat="${item.id}" role="option" aria-selected="${cap.catId === item.id}">${icon(item.icon, 16)}<span>${escapeHTML(item.name)}</span></button>`).join('')}
    <button class="cap-cat cap-cat-more" data-action="cap-category-more">更多 ${icon('chevronRight', 13)}</button>
  </div>`;
}

function amountDisplay() { return cap.amount || '0.00'; }

function captureHTML() {
  const accounts = data.getAccounts();
  return `<div class="segmented capture-modes" role="radiogroup" aria-label="记账模式">${MODES.map((mode) => `<button class="seg-item${cap.mode === mode.id ? ' active' : ''}" data-action="cap-mode" data-mode="${mode.id}" role="radio" aria-checked="${cap.mode === mode.id}">${mode.label}</button>`).join('')}</div>
    <div class="cap-amount num" aria-live="polite">RM <span>${amountDisplay()}</span></div>
    ${cap.mode === 'transfer' ? '' : quickRow(cap.mode)}
    ${accountsHTML(accounts)}
    ${cap.mode === 'transfer' ? quickRow('transfer') : ''}
    <button class="cap-more-entry" data-action="cap-open-details"><span>更多资料${detailsSummary() ? `<small>${detailsSummary()}</small>` : ''}</span>${icon('chevronRight', 16)}</button>
    <div class="cap-keypad" role="group" aria-label="数字键盘">${['1','2','3','4','5','6','7','8','9','.','0','back'].map((key) => key === 'back' ? `<button class="key" data-action="cap-key" data-key="back" aria-label="退格">${icon('backspace', 20)}</button>` : `<button class="key num" data-action="cap-key" data-key="${key}">${key}</button>`).join('')}</div>
    <div class="cap-save-wrap"><button class="cap-save" data-action="cap-save">保存</button></div>`;
}

function accountButtons(accounts, selectedId, action, label) {
  return `<div class="caption cap-account-label">${label}</div><div class="cap-accounts" role="listbox" aria-label="${label}">${accounts.map((account) => `<button class="cap-acc${selectedId === account.id ? ' active' : ''}" data-action="${action}" data-acc="${account.id}" role="option" aria-selected="${selectedId === account.id}">${escapeHTML(account.short || account.name)}</button>`).join('')}</div>`;
}

function accountSummary(account) {
  if (!account) return '';
  return account.type === 'cc' ? `可用 ${fmtRM(account.limit - account.outstanding)} · 欠 ${fmtRM(account.outstanding)}` : `余额 ${fmtRM(account.balance)}`;
}

function accountsHTML(accounts) {
  if (cap.mode === 'transfer') {
    const eligible = accounts.filter((account) => account.type !== 'cc');
    const source = data.getAccount(cap.accountId), destination = data.getAccount(cap.destinationAccountId);
    return `${accountButtons(eligible, cap.accountId, 'cap-source', '转出账户')}${accountButtons(eligible, cap.destinationAccountId, 'cap-destination', '转入账户')}<div class="cap-transfer-summary"><span>${escapeHTML(source?.short || source?.name || '')}</span>${icon('transfer', 15)}<span>${escapeHTML(destination?.short || destination?.name || '')}</span></div>`;
  }
  const eligible = cap.mode === 'income' ? accounts.filter((account) => account.type !== 'cc') : accounts;
  const account = data.getAccount(cap.accountId);
  return `${accountButtons(eligible, cap.accountId, 'cap-acc', cap.mode === 'income' ? '入账账户' : '支出账户')}<div class="caption cap-acc-summary">${escapeHTML(account?.name || '')} · ${accountSummary(account)}</div>`;
}

function attachmentHTML(attachment) {
  if (!attachment) return `<div class="attachment-empty caption">尚未添加附件</div><button class="sheet-secondary" data-action="advanced-attachment-pick">选择图片或文件</button>`;
  return `<div class="attachment-card">
    ${attachment.kind === 'photo' && attachment.dataUrl ? `<img src="${escapeHTML(attachment.dataUrl)}" alt="附件预览" />` : `<span class="attachment-file-icon">${icon('paperclip', 20)}</span>`}
    <div class="row-main"><div class="row-title">${escapeHTML(attachment.name)}</div><div class="caption">${escapeHTML(attachment.type)} · ${attachmentSizeLabel(attachment.size)}</div></div>
  </div><div class="attachment-actions"><button class="sheet-secondary" data-action="advanced-attachment-pick">替换</button><button class="sheet-danger" data-action="advanced-attachment-remove">移除</button></div>`;
}

function advancedDetailsHTML() {
  return `<div class="advanced-details" data-advanced-details>
    <label class="cap-field"><span class="caption">描述</span><input type="text" data-advanced-desc placeholder="例如 KFC 午餐" value="${escapeHTML(advancedDraft.desc)}" maxlength="40" /></label>
    ${nativeDateTimeFieldsHTML({ prefix: 'advanced', date: advancedDraft.date, time: advancedDraft.time })}
    <div class="sheet-group attachment-section"><div class="caption sheet-group-label">附件</div><div data-attachment-content>${attachmentHTML(advancedDraft.attachment)}</div><input type="file" data-attachment-input hidden /></div>
    <label class="transaction-check advanced-record"><input type="checkbox" data-advanced-record-only ${advancedDraft.recordOnly ? 'checked' : ''} /><span><strong>只记录</strong><small>只记录，不影响账户余额</small></span></label>
  </div>
  <button class="sheet-primary" data-action="advanced-details-save">完成</button>
  <button class="sheet-secondary" data-action="advanced-details-cancel">取消</button>`;
}

function bindAttachmentInput() {
  const input = advancedSheet?.querySelector('[data-attachment-input]');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      advancedDraft.attachment = attachmentMetadata(file, typeof reader.result === 'string' ? reader.result : '');
      const content = advancedSheet?.querySelector('[data-attachment-content]');
      if (content) content.innerHTML = attachmentHTML(advancedDraft.attachment);
    };
    reader.readAsDataURL(file);
  });
}

function openAdvancedDetails() {
  syncForm();
  advancedDraft = structuredClone({ desc: cap.desc, date: cap.date, time: cap.time, attachment: cap.attachment, recordOnly: cap.recordOnly });
  advancedSheet = openSheet({ title: '更多资料', className: 'advanced-details-sheet', contentHTML: advancedDetailsHTML(), onClose: () => { advancedSheet = null; } });
  bindNativeDateTimeFields(advancedSheet, { onDateChange: (value) => { advancedDraft.date = value; }, onTimeChange: (value) => { advancedDraft.time = value; } });
  bindAttachmentInput();
}

function pressKey(key) {
  if (key === 'back') cap.amount = cap.amount.slice(0, -1);
  else if (key === '.') { if (!cap.amount.includes('.')) cap.amount = (cap.amount || '0') + '.'; }
  else {
    const [, decimal] = cap.amount.split('.');
    if (decimal !== undefined && decimal.length >= 2) return;
    if (cap.amount.replace('.', '').length >= 9) return;
    cap.amount = cap.amount === '0' ? key : cap.amount + key;
  }
  const el = sheetEl?.querySelector('.cap-amount span'); if (el) el.textContent = amountDisplay();
}

function save() {
  const amount = parseFloat(cap.amount);
  if (!amount || amount <= 0) return toast('先输入金额');
  if (saving) return;
  syncForm();
  if (cap.mode === 'transfer' && cap.accountId === cap.destinationAccountId) return toast('转出和转入账户不能相同');
  saving = true;
  const saveButton = sheetEl.querySelector('[data-action="cap-save"]'); if (saveButton) saveButton.disabled = true;
  const category = cap.catId ? data.getCategory(cap.catId) : null;
  let item;
  try {
    item = data.addTransaction({
      kind: cap.mode, amount, catId: cap.catId || (cap.mode === 'transfer' ? 'transfer-fallback' : defaultCategoryId(cap.mode)),
      catLabel: cap.mode === 'transfer' && !cap.catId ? '转账' : category?.name,
      sourceAccountId: cap.mode === 'income' ? null : cap.accountId,
      destinationAccountId: cap.mode === 'income' ? cap.accountId : cap.mode === 'transfer' ? cap.destinationAccountId : null,
      desc: cap.desc.trim() || (cap.mode === 'transfer' ? '账户转账' : category?.name), date: cap.date, time: cap.time,
      recordOnly: cap.recordOnly, aa: false,
      attachment: cap.attachment, submissionKey: cap.submissionKey,
    });
  } catch (error) { saving = false; if (saveButton) saveButton.disabled = false; return toast(error.message || '无法保存这笔记录'); }
  const overlay = document.createElement('div'); overlay.className = 'cap-success'; overlay.innerHTML = `<div class="cap-success-ring">${icon('check', 34)}</div><div class="caption">已记一笔 ${fmtRM(amount)}</div>`; sheetEl.appendChild(overlay); requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => { closeSheet(); update({ highlightActivityId: item.id, activityMonth: item.date.slice(0, 7), activityFilter: 'all', activityQuery: '' }); navigate('activity'); toast(`已记一笔 ${fmtRM(amount)} · ${item.desc}`); }, 620);
}

export function registerCaptureActions() {
  registerCategorySheetActions();
  registerAction('open-capture', () => openCaptureSheet());
  registerAction('cap-mode', (el) => {
    syncForm(); cap.mode = el.dataset.mode; cap.catId = defaultCategoryId(cap.mode);
    const cash = data.getAccounts().filter((account) => account.type !== 'cc');
    if (cap.mode !== 'expense' && data.getAccount(cap.accountId)?.type === 'cc') cap.accountId = cash[0].id;
    if (cap.mode === 'income') cap.accountId = cash[0].id;
    if (cap.destinationAccountId === cap.accountId) cap.destinationAccountId = cash.find((account) => account.id !== cap.accountId)?.id;
    rerender();
  });
  registerAction('cap-cat', (el) => { cap.catId = el.dataset.cat || null; rerender(); });
  registerAction('cap-category-more', () => { syncForm(); openCategoryPicker({ type: cap.mode, selectedId: cap.catId, onSelect: (id) => { cap.catId = id; openCaptureSheet({ preserve: true }); }, onBack: () => openCaptureSheet({ preserve: true }) }); });
  registerAction('cap-acc', (el) => { cap.accountId = el.dataset.acc; rerender(); });
  registerAction('cap-source', (el) => { cap.accountId = el.dataset.acc; if (cap.destinationAccountId === cap.accountId) cap.destinationAccountId = data.getAccounts().find((account) => account.type !== 'cc' && account.id !== cap.accountId)?.id; rerender(); });
  registerAction('cap-destination', (el) => { if (el.dataset.acc === cap.accountId) return toast('转出和转入账户不能相同'); cap.destinationAccountId = el.dataset.acc; rerender(); });
  registerAction('cap-open-details', openAdvancedDetails);
  registerAction('advanced-attachment-pick', () => advancedSheet?.querySelector('[data-attachment-input]')?.click());
  registerAction('advanced-attachment-remove', () => {
    advancedDraft.attachment = null;
    const content = advancedSheet?.querySelector('[data-attachment-content]');
    if (content) content.innerHTML = attachmentHTML(null);
  });
  registerAction('advanced-details-save', () => {
    advancedDraft.desc = advancedSheet?.querySelector('[data-advanced-desc]')?.value || '';
    advancedDraft.recordOnly = Boolean(advancedSheet?.querySelector('[data-advanced-record-only]')?.checked);
    Object.assign(cap, advancedDraft);
    openCaptureSheet({ preserve: true });
  });
  registerAction('advanced-details-cancel', () => openCaptureSheet({ preserve: true }));
  registerAction('cap-key', (el) => pressKey(el.dataset.key));
  registerAction('cap-save', save);
}
