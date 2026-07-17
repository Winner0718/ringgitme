import { escapeHTML } from '../../app/format.js';
import { data, registerAction } from '../../app/state.js';
import { closeSheet, openSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';
import {
  MALAYSIA_PAYMENT_BANKS,
  RECIPIENT_PAYMENT_METHOD_TYPES,
  paymentMethodDestination,
} from '../../domain/recipientPaymentProfiles.js';

const BANKS = MALAYSIA_PAYMENT_BANKS;
const DUITNOW_TYPES = Object.freeze(['手机号码', 'NRIC / 护照', '商业注册号码', '其他']);
let editor = null;
let manager = null;
let picker = null;
let sequence = 0;

function methodLabel(profile) {
  if (profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW) return `DuitNow · ${profile.duitNowType}`;
  return profile.bankDisplayName || '银行账号';
}

function methodIcon(profile) {
  return profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? 'phone' : 'wallet';
}

function managementHTML(recipientId, displayName) {
  const methods = data.getRecipientPaymentProfiles({ recipientId });
  return `<div class="recipient-payment-manager" data-recipient-payment-owner="${escapeHTML(recipientId || '')}">
    <section class="recipient-payment-manager-hero surface"><span>${icon('wallet', 22)}</span><div><strong>${escapeHTML(displayName || '收款对象')}</strong><small>付款时可选择其中一个收款方式</small></div></section>
    ${methods.length ? `<div class="recipient-payment-method-list">${methods.map((method) => `<article class="recipient-payment-method-row surface${method.isDefaultForParticipant ? ' is-default' : ''}">
      <span class="recipient-payment-method-icon">${icon(methodIcon(method), 19)}</span>
      <button type="button" class="recipient-payment-method-main" data-action="recipient-profile-edit" data-profile-id="${escapeHTML(method.profileId)}">
        <strong>${escapeHTML(method.nickname || methodLabel(method))}${method.isDefaultForParticipant ? '<em>默认</em>' : ''}</strong>
        <small>${escapeHTML(methodLabel(method))} · ${escapeHTML(paymentMethodDestination(method, { hidden: true }))}</small>
      </button>
      <button type="button" class="recipient-payment-method-more" data-action="recipient-profile-edit" data-profile-id="${escapeHTML(method.profileId)}" aria-label="编辑${escapeHTML(method.nickname || methodLabel(method))}">${icon('chevronRight', 16)}</button>
      <div class="recipient-payment-method-actions">
        ${method.isDefaultForParticipant ? '' : `<button type="button" data-action="recipient-profile-set-default" data-profile-id="${escapeHTML(method.profileId)}">设为默认</button>`}
        <button type="button" data-action="recipient-profile-delete-request" data-profile-id="${escapeHTML(method.profileId)}">删除</button>
      </div>
    </article>`).join('')}</div>` : `<section class="recipient-payment-empty surface"><span>${icon('wallet', 24)}</span><strong>尚未添加收款资料</strong><small>加入银行账号或 DuitNow，付款时便可直接复制。</small></section>`}
    <div class="recipient-payment-add-actions">
      <button type="button" class="sheet-primary" data-action="recipient-profile-add-bank">添加银行账号</button>
      <button type="button" class="sheet-secondary" data-action="recipient-profile-add-duitnow">添加 DuitNow</button>
    </div>
    <button type="button" class="sheet-secondary" data-action="sheet-close">完成</button>
  </div>`;
}

function rerenderManager() {
  const body = manager?.layer?.querySelector('.sheet-body');
  if (body) body.innerHTML = managementHTML(manager.recipientId, manager.displayName);
}

function field(label, name, value = '', { optional = false, inputMode = null, readOnly = false, placeholder = '' } = {}) {
  return `<label class="recipient-profile-field"><span>${escapeHTML(label)}${optional ? '<small>可选</small>' : ''}</span><input name="${name}" value="${escapeHTML(value || '')}" ${placeholder ? `placeholder="${escapeHTML(placeholder)}"` : ''} ${inputMode ? `inputmode="${inputMode}"` : ''} ${readOnly ? 'readonly' : ''} autocomplete="off" /></label>`;
}

function bankFor(profile) {
  return BANKS.find((bank) => bank.code === profile.bankCode) || null;
}

function editorHTML(profile) {
  const bank = bankFor(profile);
  const isDuitNow = profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW;
  return `<form class="recipient-profile-editor" data-recipient-profile-form>
    <section class="recipient-profile-identity surface"><span>${icon(methodIcon(profile), 22)}</span><div><strong>${isDuitNow ? 'DuitNow' : '银行账号'}</strong><small>只用于你主动付款时复制资料</small></div></section>
    ${field('收款人', 'displayName', profile.displayName)}
    ${field('名称', 'nickname', profile.nickname, { optional: true, placeholder: '例如 主要账号、房租账号' })}
    ${field('户名', 'accountHolderName', profile.accountHolderName, { placeholder: '例如 TAN SZE WEI' })}
    <label class="recipient-profile-field"><span>银行${isDuitNow ? '<small>可选</small>' : ''}</span><button type="button" class="recipient-profile-picker-field" data-action="recipient-profile-bank-picker"><strong data-selected-bank-name>${escapeHTML(profile.bankDisplayName || (isDuitNow ? '未指定' : '选择银行'))}</strong>${icon('chevronRight', 16)}</button><input type="hidden" name="bankCode" value="${escapeHTML(profile.bankCode || '')}"/><input type="hidden" name="bankDisplayName" value="${escapeHTML(profile.bankDisplayName || '')}"/><input type="hidden" name="launchCapabilityId" value="${escapeHTML(profile.launchCapabilityId || bank?.launchCapabilityId || '')}"/></label>
    <div data-custom-bank-field ${profile.bankCode === 'OTHER' ? '' : 'hidden'}>${field('自定义银行名称', 'customBankName', profile.customBankName || (profile.bankCode === 'OTHER' ? profile.bankDisplayName : ''))}</div>
    ${isDuitNow ? `<label class="recipient-profile-field"><span>DuitNow 类型</span><button type="button" class="recipient-profile-picker-field" data-action="recipient-profile-duitnow-type-picker"><strong data-selected-duitnow-type>${escapeHTML(profile.duitNowType || DUITNOW_TYPES[0])}</strong>${icon('chevronRight', 16)}</button><input type="hidden" name="duitNowType" value="${escapeHTML(profile.duitNowType || DUITNOW_TYPES[0])}"/></label>${field('DuitNow 资料', 'duitNowValue', profile.duitNowValue, { inputMode: 'numeric', placeholder: profile.duitNowType === 'NRIC / 护照' ? '请输入证件号码' : '例如 60123456789' })}` : field('银行账号', 'accountNumber', profile.accountNumber, { inputMode: 'numeric', placeholder: '请输入账号' })}
    ${field('默认付款参考', 'defaultReferenceTemplate', profile.defaultReferenceTemplate, { optional: true, placeholder: '例如 Rent 07/2026' })}
    ${profile.ownerParticipantId ? `<label class="recipient-profile-default"><input type="checkbox" name="isDefaultForParticipant" ${profile.isDefaultForParticipant ? 'checked' : ''}/><span><strong>设为该对象默认收款资料</strong><small>其他计划也可复用</small></span></label>` : ''}
    <p class="recipient-profile-error" data-recipient-profile-error role="alert"></p>
    <footer class="recipient-profile-editor-footer"><button type="button" class="sheet-primary" data-action="recipient-profile-save">保存</button><button type="button" class="sheet-secondary" data-action="sheet-close">取消</button></footer>
  </form>`;
}

function bankPickerHTML(selectedCode, { optional = false } = {}) {
  return `<div class="recipient-bank-picker" role="listbox" aria-label="选择银行">${optional ? `<button type="button" data-action="recipient-profile-bank-select" data-bank-code="" role="option" aria-selected="${!selectedCode}"><span>${icon('wallet', 18)}</span><strong>未指定</strong>${!selectedCode ? icon('check', 17) : ''}</button>` : ''}${BANKS.map((bank) => `<button type="button" data-action="recipient-profile-bank-select" data-bank-code="${bank.code}" role="option" aria-selected="${bank.code === selectedCode}"><span>${icon('wallet', 18)}</span><strong>${escapeHTML(bank.name)}</strong>${bank.code === selectedCode ? icon('check', 17) : ''}</button>`).join('')}</div>`;
}

function duitNowTypePickerHTML(selectedType) {
  return `<div class="recipient-bank-picker" role="listbox" aria-label="选择 DuitNow 类型">${DUITNOW_TYPES.map((type) => `<button type="button" data-action="recipient-profile-duitnow-type-select" data-duitnow-type="${escapeHTML(type)}" role="option" aria-selected="${type === selectedType}"><span>${icon('phone', 18)}</span><strong>${escapeHTML(type)}</strong>${type === selectedType ? icon('check', 17) : ''}</button>`).join('')}</div>`;
}

function value(form, name) {
  return String(form.elements.namedItem(name)?.value || '').trim();
}

function markDirty() {
  if (editor) editor.dirty = true;
}

function requestEditorClose() {
  if (!editor?.dirty || editor.permitClose || editor.confirmOpen) return true;
  editor.confirmOpen = true;
  openSheet({
    id: `${editor.id}:discard`, parentId: editor.id, title: '舍弃未保存的修改？', stacked: true,
    className: 'recipient-profile-discard-sheet',
    contentHTML: '<p class="recipient-profile-discard-copy">离开后，这次修改不会保存。</p><button type="button" class="sheet-danger" data-action="recipient-profile-discard">舍弃修改</button><button type="button" class="sheet-secondary" data-action="recipient-profile-discard-keep">继续编辑</button>',
    onClose: () => { if (editor) editor.confirmOpen = false; },
  });
  return false;
}

export function openRecipientPaymentProfileEditor({
  profileId = null,
  ownerParticipantId = null,
  recipientId = ownerParticipantId,
  displayName = '',
  paymentMethodType = RECIPIENT_PAYMENT_METHOD_TYPES.BANK_ACCOUNT,
  parentId = null,
  trigger = document.activeElement,
  onSave = null,
} = {}) {
  const existing = profileId ? data.getRecipientPaymentProfile(profileId) : null;
  const profile = existing || {
    profileId: null,
    paymentMethodType,
    recipientId,
    ownerParticipantId: recipientId,
    displayName,
    accountHolderName: '',
    nickname: '',
    bankCode: '',
    bankDisplayName: '',
    customBankName: '',
    accountNumber: '',
    duitNowType: DUITNOW_TYPES[0],
    duitNowValue: '',
    defaultReferenceTemplate: '',
    launchCapabilityId: '',
    isDefaultForParticipant: Boolean(recipientId && !data.getRecipientPaymentProfiles({ recipientId }).length),
  };
  const id = `recipient-profile-editor:${profile.profileId || 'new'}:${++sequence}`;
  const sheet = openSheet({
    id, parentId, title: existing ? '编辑收款资料' : paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? '添加 DuitNow' : '添加银行账号',
    className: 'recipient-profile-editor-sheet', stacked: true, trigger, contentHTML: editorHTML(profile),
    onRequestClose: requestEditorClose,
    onClose: () => { if (editor?.id === id) editor = null; },
  });
  editor = { id, layer: sheet.closest('.modal-layer'), profile, existing: Boolean(existing), onSave, dirty: false, permitClose: false, confirmOpen: false };
  const form = sheet.querySelector('[data-recipient-profile-form]');
  form?.addEventListener('input', markDirty);
  form?.addEventListener('change', markDirty);
  return sheet;
}

export function openRecipientPaymentProfileManager({ recipientId = null, ownerParticipantId = recipientId, displayName = '', parentId = null, trigger = document.activeElement, onChange = null } = {}) {
  const ownerId = recipientId || ownerParticipantId;
  const id = `recipient-profile-manager:${ownerId}:${++sequence}`;
  const sheet = openSheet({
    id, parentId, title: '收款资料', className: 'recipient-profile-manager-sheet', stacked: true, trigger,
    contentHTML: managementHTML(ownerId, displayName),
    onClose: () => { if (manager?.id === id) manager = null; },
  });
  manager = { id, layer: sheet.closest('.modal-layer'), recipientId: ownerId, ownerParticipantId: ownerId, displayName, onChange };
  return sheet;
}

export function openRecipientPaymentMethodPicker({ recipientId = null, ownerParticipantId = recipientId, selectedProfileId = null, parentId = null, trigger = document.activeElement, onSelect = null } = {}) {
  const ownerId = recipientId || ownerParticipantId;
  const methods = data.getRecipientPaymentProfiles({ recipientId: ownerId });
  const id = `recipient-method-picker:${ownerId}:${++sequence}`;
  const sheet = openSheet({
    id, parentId, title: '选择收款方式', className: 'recipient-payment-picker-sheet', stacked: true, trigger,
    contentHTML: `<div class="recipient-payment-picker-list">${methods.map((method) => `<button type="button" data-action="recipient-payment-method-select" data-profile-id="${escapeHTML(method.profileId)}" aria-pressed="${method.profileId === selectedProfileId}"><span>${icon(methodIcon(method), 19)}</span><div><strong>${escapeHTML(method.nickname || methodLabel(method))}${method.isDefaultForParticipant ? '<em>默认</em>' : ''}</strong><small>${escapeHTML(methodLabel(method))} · ${escapeHTML(paymentMethodDestination(method, { hidden: true }))}</small></div>${method.profileId === selectedProfileId ? icon('check', 17) : icon('chevronRight', 16)}</button>`).join('')}</div><button type="button" class="sheet-secondary" data-action="recipient-payment-manage-from-picker">管理收款资料</button>`,
    onClose: () => { if (picker?.id === id) picker = null; },
  });
  picker = { id, layer: sheet.closest('.modal-layer'), recipientId: ownerId, ownerParticipantId: ownerId, selectedProfileId, onSelect };
  return sheet;
}

function openEditorFromManager(type, trigger) {
  if (!manager) return;
  openRecipientPaymentProfileEditor({
    recipientId: manager.recipientId,
    ownerParticipantId: manager.recipientId,
    displayName: manager.displayName,
    paymentMethodType: type,
    parentId: manager.id,
    trigger,
    onSave: (saved) => { rerenderManager(); manager?.onChange?.(saved); },
  });
}

export function registerRecipientPaymentProfileSheets() {
  registerAction('recipient-profile-add-bank', (el) => openEditorFromManager(RECIPIENT_PAYMENT_METHOD_TYPES.BANK_ACCOUNT, el));
  registerAction('recipient-profile-add-duitnow', (el) => openEditorFromManager(RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW, el));
  registerAction('recipient-profile-edit', (el) => {
    const profile = data.getRecipientPaymentProfile(el.dataset.profileId);
    if (!profile) return;
    openRecipientPaymentProfileEditor({
      profileId: profile.profileId, parentId: manager?.id || el.closest('.modal-layer')?.dataset.sheetId, trigger: el,
      onSave: (saved) => { rerenderManager(); manager?.onChange?.(saved); },
    });
  });
  registerAction('recipient-profile-bank-picker', (el) => {
    if (!editor) return;
    const form = el.closest('form');
    openSheet({
      id: `${editor.id}:bank`, parentId: editor.id, title: '选择银行', stacked: true, className: 'recipient-bank-picker-sheet', trigger: el,
      contentHTML: bankPickerHTML(value(form, 'bankCode'), { optional: editor.profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW }),
    });
  });
  registerAction('recipient-profile-bank-select', (el) => {
    if (!editor) return;
    const bank = BANKS.find((row) => row.code === el.dataset.bankCode) || null;
    const form = editor.layer.querySelector('form');
    form.elements.bankCode.value = bank?.code || '';
    form.elements.bankDisplayName.value = bank?.name || '';
    form.elements.launchCapabilityId.value = bank?.launchCapabilityId || '';
    form.querySelector('[data-selected-bank-name]').textContent = bank?.name || '未指定';
    form.querySelector('[data-custom-bank-field]').hidden = bank?.code !== 'OTHER';
    editor.dirty = true;
    closeSheet();
  });
  registerAction('recipient-profile-duitnow-type-picker', (el) => {
    if (!editor) return;
    const form = el.closest('form');
    openSheet({
      id: `${editor.id}:duitnow-type`, parentId: editor.id, title: '选择 DuitNow 类型', stacked: true,
      className: 'recipient-bank-picker-sheet', trigger: el,
      contentHTML: duitNowTypePickerHTML(value(form, 'duitNowType')),
    });
  });
  registerAction('recipient-profile-duitnow-type-select', (el) => {
    if (!editor) return;
    const form = editor.layer.querySelector('form');
    form.elements.duitNowType.value = el.dataset.duitnowType;
    form.querySelector('[data-selected-duitnow-type]').textContent = el.dataset.duitnowType;
    editor.dirty = true;
    closeSheet();
  });
  registerAction('recipient-profile-save', (el) => {
    if (!editor) return;
    const form = el.closest('form');
    const type = editor.profile.paymentMethodType;
    const customBankName = value(form, 'customBankName');
    const payload = {
      paymentMethodType: type,
      recipientId: editor.profile.recipientId || editor.profile.ownerParticipantId,
      ownerParticipantId: editor.profile.ownerParticipantId,
      displayName: value(form, 'displayName'),
      nickname: value(form, 'nickname'),
      accountHolderName: value(form, 'accountHolderName'),
      bankCode: value(form, 'bankCode'),
      bankDisplayName: value(form, 'bankCode') === 'OTHER' ? customBankName : value(form, 'bankDisplayName'),
      customBankName: value(form, 'bankCode') === 'OTHER' ? customBankName : null,
      accountNumber: type === RECIPIENT_PAYMENT_METHOD_TYPES.BANK_ACCOUNT ? value(form, 'accountNumber') : null,
      duitNowType: type === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? value(form, 'duitNowType') : null,
      duitNowValue: type === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? value(form, 'duitNowValue') : null,
      defaultReferenceTemplate: value(form, 'defaultReferenceTemplate'),
      launchCapabilityId: value(form, 'launchCapabilityId'),
      isDefaultForParticipant: Boolean(form.elements.namedItem('isDefaultForParticipant')?.checked),
      updatedAt: `${data.today}T09:00:00+08:00`,
    };
    try {
      const saved = editor.existing
        ? data.updateRecipientPaymentProfile(editor.profile.profileId, payload)
        : data.createRecipientPaymentProfile({ ...payload, createdAt: `${data.today}T09:00:00+08:00` });
      const callback = editor.onSave;
      editor.permitClose = true;
      closeSheet();
      toast('收款资料已保存');
      callback?.(saved);
    } catch (error) {
      const target = form.querySelector('[data-recipient-profile-error]');
      if (target) target.textContent = error.code === 'BANK_DISPLAY_NAME_REQUIRED' ? '请填写自定义银行名称。' : '请填写收款人、户名和有效的收款资料。';
    }
  });
  registerAction('recipient-profile-set-default', (el) => {
    const saved = data.setDefaultRecipientPaymentProfile(el.dataset.profileId);
    rerenderManager();
    manager?.onChange?.(saved);
    toast('默认收款资料已更新');
  });
  registerAction('recipient-profile-delete-request', (el) => {
    const profile = data.getRecipientPaymentProfile(el.dataset.profileId);
    if (!profile) return;
    openSheet({
      id: `recipient-profile-delete:${profile.profileId}:${++sequence}`, parentId: manager?.id, title: '删除收款资料？', stacked: true,
      className: 'recipient-profile-delete-sheet',
      contentHTML: `<p class="recipient-profile-delete-copy">将删除“${escapeHTML(profile.nickname || methodLabel(profile))}”。已完成记账中的历史快照会保留。</p><button type="button" class="sheet-danger" data-action="recipient-profile-delete-confirm" data-profile-id="${escapeHTML(profile.profileId)}">确认删除</button><button type="button" class="sheet-secondary" data-action="sheet-close">取消</button>`,
    });
  });
  registerAction('recipient-profile-delete-confirm', (el) => {
    const removed = data.deleteRecipientPaymentProfile(el.dataset.profileId);
    closeSheet(true);
    rerenderManager();
    manager?.onChange?.(removed);
    toast(removed.isDefaultForParticipant ? '已删除，并自动更新默认收款资料' : '收款资料已删除');
  });
  registerAction('recipient-profile-discard', () => {
    if (!editor) return;
    closeSheet(true);
    editor.permitClose = true;
    closeSheet();
  });
  registerAction('recipient-profile-discard-keep', () => closeSheet());
  registerAction('recipient-payment-method-select', (el) => {
    if (!picker) return;
    const selected = data.getRecipientPaymentProfile(el.dataset.profileId);
    const callback = picker.onSelect;
    closeSheet();
    callback?.(selected);
  });
  registerAction('recipient-payment-manage-from-picker', (el) => {
    if (!picker) return;
    const participant = data.getParticipant(picker.recipientId);
    const identity = data.getRecipientDirectory().find((row) => row.recipientId === picker.recipientId);
    openRecipientPaymentProfileManager({
      recipientId: picker.recipientId,
      displayName: participant?.displayName || identity?.displayName || '收款对象',
      parentId: picker.id,
      trigger: el,
      onChange: () => {},
    });
  });
}

export const recipientPaymentProfileSheetsTestHooks = Object.freeze({ BANKS, DUITNOW_TYPES, editorHTML, managementHTML, bankPickerHTML, duitNowTypePickerHTML });
