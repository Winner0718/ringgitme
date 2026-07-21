import { data, registerAction, ui, update } from '../../app/state.js';
import { closeSheet, openSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';
import { openCaptureSheet } from '../../components/CaptureSheet.js';
import { escapeHTML, fmtRM } from '../../app/format.js';
import { formatBankAccountNumber, formatCardLastFour, validateOptionalBankAccountNumber, validateOptionalLastFour } from '../../domain/assetFinancialModel.js';
import { assetSheetFooterHTML } from './AssetSheetFooter.js';
import { bindAssetDragReorder } from './AssetDragReorder.js';
import { openAssetOperation, registerAssetOperationActions } from './AssetOperationSheets.js';
import { assetIdentityMediaFieldsHTML, assetIdentityPrimaryFieldsHTML, bindAssetIdentityFields, createAssetIdentityDraft, readAssetIdentity } from './AssetIdentitySelector.js';
import { accountBrandVisualHTML } from '../../components/AssetBrandVisual.js';
import { openPickerSheet, pickerFieldHTML } from '../../components/PickerSheet.js';
import { ringgitMeCardComposerHTML } from '../../components/RinggitMeCardComposer.js';

const TYPE_LABEL = { saving: '银行账户', ew: '电子钱包', cc: '信用卡' };
const CREDIT_TIERS = Object.freeze(['', 'Classic', 'Gold', 'Platinum', 'Signature', 'Infinite', 'World', 'Other']);
let editorContext = null;
let editorDirty = false;
let editorIdentityDraft = null;
let managerCleanup = null;
let menuContextId = null;

function activeAndArchived(type = null) {
  return data.getAccounts().filter((account) => !type || account.type === type)
    .sort((a, b) => a.type.localeCompare(b.type) || a.sortOrder - b.sortOrder);
}

function checked(value) { return value ? 'checked' : ''; }

function identifierFor(account) {
  if (account.type === 'cc') return formatCardLastFour(account.creditCardLast4, { privacy: ui.privacy });
  if (account.type === 'ew') return formatBankAccountNumber(account.walletIdentifier, { privacy: ui.privacy });
  return formatBankAccountNumber(account.bankAccountNumber, { privacy: ui.privacy });
}

function switchRow(name, title, helper, value) {
  return `<label class="asset-switch-row"><span><strong>${title}</strong><small>${helper}</small></span><input type="checkbox" name="${name}" ${checked(value)} /><i class="ringgit-switch" aria-hidden="true"><b></b></i></label>`;
}

function creditTierFieldHTML(tier = '', customTierLabel = '') {
  const label = tier === 'Other' ? '其他' : tier || '未指定';
  return `<section class="asset-credit-tier" data-credit-tier-field>${pickerFieldHTML({ label: '等级', key: 'asset-credit-tier', valueLabel: label })}<input type="hidden" name="tier" value="${escapeHTML(tier)}" />${tier === 'Other' ? `<label class="asset-form-field"><span>自定义等级</span><input name="customTierLabel" maxlength="32" value="${escapeHTML(customTierLabel)}" placeholder="例如 World Elite" required /></label>` : ''}</section>`;
}

function refreshIdentityPreview(form, draft) {
  const preview = form.querySelector('[data-asset-card-preview]');
  if (!preview) return;
  const typeLabel = draft.type === 'cc' ? '信用卡' : draft.type === 'ew' ? '电子钱包' : '银行账户';
  preview.innerHTML = ringgitMeCardComposerHTML({
    type: draft.type, brandId: draft.brandId, bank: draft.customBrandName, name: draft.displayName,
    displayName: draft.displayName, networkId: draft.networkId, debitCardLast4: draft.debitCardLast4,
    creditCardLast4: draft.creditCardLast4, customLogo: draft.customLogo, logoPresentationMode: draft.logoPresentationMode,
    resolvedLogoPresentation: draft.resolvedLogoPresentation, cardPalette: draft.cardPalette,
    accountVisualOverride: draft.accountVisualOverride, customCardImage: draft.customCardImage,
    tier: draft.tier, customTierLabel: draft.customTierLabel,
  }, { preview: true, typeLabel });
}

function accountEditorHTML(account, type, identityDraft) {
  const credit = type === 'cc';
  const wallet = type === 'ew';
  const storedTier = String(account?.tier || '').trim();
  const tierValue = CREDIT_TIERS.includes(storedTier) ? storedTier : storedTier ? 'Other' : '';
  const tierCustomValue = tierValue === 'Other' ? (account?.customTierLabel || (storedTier === 'Other' ? '' : storedTier)) : '';
  const identifierFields = credit
    ? `<label class="asset-form-field"><span>信用卡末四位（可不填）</span><input name="creditCardLast4" inputmode="numeric" maxlength="4" value="${escapeHTML(account?.creditCardLast4 || '')}" placeholder="例如 9910" autocomplete="off" /></label>`
    : wallet
      ? `<label class="asset-form-field"><span>手机号码／账户标识（可选）</span><input name="walletIdentifier" maxlength="60" value="${escapeHTML(account?.walletIdentifier || '')}" placeholder="例如 手机号码或钱包用户名" /></label>`
      : `<label class="asset-form-field"><span>银行账号（可不填）</span><input name="bankAccountNumber" inputmode="text" maxlength="80" value="${escapeHTML(account?.bankAccountNumber || '')}" placeholder="请输入账号" autocomplete="off" /></label><label class="asset-form-field"><span>银行卡末四位（ATM／Debit Card，可不填）</span><input name="debitCardLast4" inputmode="numeric" maxlength="4" value="${escapeHTML(account?.debitCardLast4 || '')}" placeholder="例如 0000" autocomplete="off" /></label>`;
  const financial = credit
    ? `<label class="asset-form-field"><span>信用额度</span><div class="asset-money-input"><b>RM</b><input name="limit" inputmode="decimal" value="${account?.limit ?? ''}" placeholder="0.00" required /></div></label>
       ${creditTierFieldHTML(tierValue, tierCustomValue)}
       <label class="asset-form-field"><span>共享额度池</span><select name="sharedLimitPoolId"><option value="">不使用共享额度</option>${data.getSharedLimitPools().filter((pool) => pool.status === 'active').map((pool) => `<option value="${escapeHTML(pool.id)}" ${account?.sharedLimitPoolId === pool.id ? 'selected' : ''}>${escapeHTML(pool.name)}</option>`).join('')}</select></label>
       ${account ? '' : `<label class="asset-form-field"><span>已有历史欠款（只记录）</span><div class="asset-money-input"><b>RM</b><input name="openingRecordOnlyDebt" inputmode="decimal" placeholder="0.00" /></div></label><label class="asset-form-field"><span>已有溢缴余额</span><div class="asset-money-input"><b>RM</b><input name="openingCardCredit" inputmode="decimal" placeholder="0.00" /></div></label>`}`
    : account
      ? `<div class="asset-current-balance-card"><span><strong>当前余额</strong><small>余额由调整记录管理</small></span><b class="num">${fmtRM(account.balance)}</b><button type="button" data-action="asset-editor-adjust" data-id="${escapeHTML(account.id)}">调整余额</button></div>`
      : `<label class="asset-form-field"><span>初始余额</span><div class="asset-money-input"><b>RM</b><input name="balance" inputmode="decimal" placeholder="0.00" /></div></label>`;
  return `<form class="asset-editor-form" data-asset-editor>
    ${assetIdentityPrimaryFieldsHTML(identityDraft)}
    ${identifierFields}${financial}
    ${assetIdentityMediaFieldsHTML(identityDraft)}
    <label class="asset-form-field"><span>备注</span><textarea name="note" maxlength="120" placeholder="可选">${escapeHTML(account?.note || '')}</textarea></label>
    <details class="asset-account-settings"><summary>账户设置 ${icon('chevronRight', 15)}</summary><div class="asset-toggle-list">
      ${switchRow('isDefault', '设为默认', 'Capture 优先选择此账户', account?.isDefault)}
      ${credit ? switchRow('includeInTotalDebt', '计入总负债', '关闭后仅从负债汇总排除', account?.includeInTotalDebt !== false) : `${switchRow('includeInAvailableCash', '计入可用现金', '用于当前现金与付款能力', account?.includeInAvailableCash !== false)}${switchRow('includeInNetWorth', '计入净资产', '控制资产与净值汇总', account?.includeInNetWorth !== false)}`}
      ${switchRow('isActive', '启用账户', '停用后不进入日常选择', account?.status !== 'inactive')}
      ${switchRow('isHidden', '隐藏账户', '保留历史，但不在日常列表显示', account?.isHidden)}
    </div></details>
    ${assetSheetFooterHTML({ primaryAction: 'asset-editor-save', primaryLabel: '保存' })}
  </form>`;
}

export function openAssetEditor({ accountId = null, type = 'saving', stacked = false, returnToManager = false } = {}) {
  const account = accountId ? data.getAccount(accountId) : null;
  editorContext = { accountId, type: account?.type || type, returnToManager };
  editorIdentityDraft = createAssetIdentityDraft(account, editorContext.type);
  editorDirty = false;
  openSheet({
    title: account ? `编辑${TYPE_LABEL[account.type]}` : `添加${TYPE_LABEL[type]}`,
    className: 'asset-editor-sheet', stacked,
    contentHTML: accountEditorHTML(account, editorContext.type, editorIdentityDraft),
    onOpen(sheet) {
      const form = sheet.querySelector('[data-asset-editor]');
      bindAssetIdentityFields(form, editorIdentityDraft, { onDirty: () => { editorDirty = true; } });
      form?.addEventListener('click', (event) => {
        if (event.target.closest('[data-picker-field="asset-credit-tier"]')) {
          event.preventDefault();
          const field = form.querySelector('[data-credit-tier-field]');
          const selectedValue = form.elements.tier?.value || '';
          openPickerSheet({ title: '选择信用卡等级', searchable: false, selectedValue, trigger: event.target.closest('[data-picker-field]'), options: CREDIT_TIERS.map((value) => ({ value, label: value === '' ? '未指定' : value === 'Other' ? '其他' : value })), onSelect(value) {
            editorIdentityDraft.tier = value;
            editorIdentityDraft.customTierLabel = '';
            field.outerHTML = creditTierFieldHTML(value, value === 'Other' ? '' : '');
            refreshIdentityPreview(form, editorIdentityDraft);
            editorDirty = true;
          } });
        }
      });
      form?.addEventListener('input', (event) => { if (event.target.name === 'customTierLabel') { editorIdentityDraft.customTierLabel = event.target.value.trim().slice(0, 32); refreshIdentityPreview(form, editorIdentityDraft); } editorDirty = true; });
      form?.addEventListener('change', () => { editorDirty = true; });
    },
    onRequestClose() {
      if (!editorDirty) return true;
      openSheet({ title: '放弃未保存更改？', stacked: true, contentHTML: `<div class="asset-confirm-copy"><p>当前编辑内容尚未保存。</p></div>${assetSheetFooterHTML({ primaryAction: 'asset-editor-discard', primaryLabel: '放弃更改', danger: true, secondaryLabel: '继续编辑' })}` });
      return false;
    },
  });
}

function managerRows(type) {
  const list = activeAndArchived(type);
  return list.map((account) => {
    const active = account.status === 'active';
    const detail = account.status === 'archived' ? '已归档' : account.isHidden ? '已隐藏' : account.isDefault ? '默认账户' : identifierFor(account) || account.bank || TYPE_LABEL[type];
    return `<div class="asset-manage-row${active ? '' : ' is-archived'}" data-id="${escapeHTML(account.id)}" data-active="${active}">
      ${active ? `<button type="button" class="asset-reorder-handle" aria-label="拖动排列 ${escapeHTML(account.name)}" aria-pressed="false" title="拖动排列"><span aria-hidden="true">≡</span></button>` : ''}
      <button type="button" class="asset-manage-main" data-action="asset-manager-edit" data-id="${escapeHTML(account.id)}">${accountBrandVisualHTML(account, { className: 'asset-manage-icon' })}<span><strong>${escapeHTML(account.name)}</strong><small>${escapeHTML(detail)}</small></span>${icon('chevronRight', 15)}</button>
      ${active ? '' : `<button type="button" class="asset-restore-btn" data-action="asset-manager-restore" data-id="${escapeHTML(account.id)}">恢复</button>`}
    </div>`;
  }).join('');
}

export function openAssetManager(type = 'saving') {
  managerCleanup?.();
  openSheet({
    title: '管理账户', className: 'asset-manager-sheet',
    contentHTML: `<div class="asset-manager-tabs" role="tablist">${Object.entries(TYPE_LABEL).map(([id, label]) => `<button type="button" class="${type === id ? 'active' : ''}" data-action="asset-manager-tab" data-type="${id}">${label}</button>`).join('')}</div><section class="asset-manager-list" data-manager-type="${type}">${managerRows(type) || '<div class="asset-empty-state">尚未添加账户</div>'}</section>${type === 'cc' ? '<button type="button" class="asset-soft-action" data-action="asset-pool-manager">共享额度池 <span>集中管理同一额度下的卡片</span></button>' : ''}<button type="button" class="sheet-primary asset-add-button" data-action="asset-manager-add" data-type="${type}">${icon('plus', 17)} 添加${TYPE_LABEL[type]}</button>${assetSheetFooterHTML({ primaryAction: 'sheet-close', primaryLabel: '完成', secondaryLabel: '关闭' })}`,
    onOpen(sheet) { managerCleanup = bindAssetDragReorder(sheet, type); },
    onClose() { managerCleanup?.(); managerCleanup = null; },
  });
}

function refreshManager(type) { closeSheet(true); openAssetManager(type); }

function menuRow(action, id, iconName, label, danger = false) {
  return `<button type="button" class="asset-menu-row${danger ? ' danger' : ''}" data-action="${action}" data-id="${escapeHTML(id)}"><span>${icon(iconName, 17)}</span><strong>${label}</strong>${icon('chevronRight', 14)}</button>`;
}

function openAssetOverflowMenu(accountId) {
  const account = data.getAccount(accountId);
  if (!account) return;
  menuContextId = account.id;
  const defaultLabel = account.isDefault ? '取消默认' : '设为默认';
  const common = `${menuRow('asset-menu-edit', account.id, 'edit', account.type === 'ew' ? '编辑eWallet' : account.type === 'cc' ? '编辑信用卡' : '编辑账户')}${menuRow('asset-menu-hidden', account.id, 'eye', account.isHidden ? '显示账户' : '隐藏账户')}${menuRow('asset-menu-active', account.id, 'power', account.status === 'inactive' ? '启用账户' : '停用账户')}`;
  const typeRows = account.type === 'cc'
    ? `${menuRow('asset-pool-manager', account.id, 'wallet', '管理共享额度池')}${menuRow('asset-menu-operation', account.id, 'receipt', '记录费用与利息')}${menuRow('asset-menu-opening', account.id, 'note', '导入已有欠款')}`
    : menuRow('asset-menu-default', account.id, 'check', defaultLabel);
  const policy = data.canHardDeleteAsset(account.id);
  openSheet({ title: account.name, className: 'asset-overflow-menu', contentHTML: `<div class="asset-menu-list">${common}${typeRows}${menuRow('asset-menu-archive', account.id, 'archive', '归档账户', true)}${menuRow('asset-menu-delete', account.id, 'trash', account.type === 'ew' ? '删除eWallet' : '删除账户', true)}</div><p class="asset-menu-policy">${policy.allowed ? '此账户没有余额或历史记录，可安全删除。' : escapeHTML(policy.reason)}</p>${assetSheetFooterHTML({ primaryAction: 'sheet-close', primaryLabel: '完成', secondaryLabel: '返回' })}` });
}

function confirmArchive(account) {
  openSheet({ title: '归档账户', stacked: true, contentHTML: `<div class="asset-confirm-copy"><strong>归档“${escapeHTML(account.name)}”？</strong><p>历史记录会保留，账户将从日常列表移除。</p></div>${assetSheetFooterHTML({ primaryAction: 'asset-archive-confirm', primaryLabel: '确认归档', danger: true, secondaryLabel: '取消' })}` });
}

function confirmDelete(account) {
  const policy = data.canHardDeleteAsset(account.id);
  openSheet({ title: policy.allowed ? '删除账户' : '无法删除账户', stacked: true, contentHTML: `<div class="asset-confirm-copy"><strong>${policy.allowed ? `永久删除“${escapeHTML(account.name)}”？` : '账户仍有依赖'}</strong><p>${policy.allowed ? '删除后无法恢复。' : escapeHTML(policy.reason)}</p></div>${assetSheetFooterHTML({ primaryAction: policy.allowed ? 'asset-delete-confirm' : 'sheet-close', primaryLabel: policy.allowed ? '确认删除' : '知道了', danger: policy.allowed, secondaryLabel: '取消' })}` });
}

function openPoolManager() {
  const pools = data.getSharedLimitPools().filter((pool) => pool.status === 'active');
  openSheet({ title: '共享额度池', className: 'asset-pool-sheet', contentHTML: `<div class="asset-pool-list">${pools.map((pool) => `<button type="button" class="asset-pool-card" data-action="asset-pool-edit" data-id="${escapeHTML(pool.id)}"><div><strong>${escapeHTML(pool.name)}</strong><small>${pool.memberIds.length} 张卡 · 合计欠款 ${fmtRM(pool.usedMinor / 100)} · 共享可用 ${fmtRM(pool.availableMinor / 100)}</small></div><span class="num">${fmtRM(pool.limitMinor / 100)}</span>${icon('chevronRight', 15)}</button>`).join('') || '<div class="asset-empty-state">还没有共享额度池</div>'}</div><form data-pool-create><label class="asset-form-field"><span>名称</span><input name="name" placeholder="例如 家庭共享额度" required /></label><label class="asset-form-field"><span>总额度</span><div class="asset-money-input"><b>RM</b><input name="limit" inputmode="decimal" placeholder="0.00" required /></div></label></form>${assetSheetFooterHTML({ primaryAction: 'asset-pool-create', primaryLabel: '添加额度池', secondaryLabel: '返回' })}` });
}

function openPoolEditor(poolId) {
  const pool = data.getSharedLimitPool(poolId);
  if (!pool) return;
  openSheet({ title: '编辑共享额度池', stacked: true, contentHTML: `<form data-pool-edit data-id="${escapeHTML(pool.id)}"><label class="asset-form-field"><span>名称</span><input name="name" value="${escapeHTML(pool.name)}" required /></label><label class="asset-form-field"><span>总额度</span><div class="asset-money-input"><b>RM</b><input name="limit" inputmode="decimal" value="${pool.limitMinor / 100}" required /></div></label><div class="asset-pool-debt-note">当前合计欠款 <strong class="num">${fmtRM(pool.usedMinor / 100)}</strong>${pool.availableMinor < 0 ? '<span class="amt-neg">额度池目前已超额</span>' : ''}</div>${assetSheetFooterHTML({ primaryAction: 'asset-pool-edit-save', primaryLabel: '保存额度池' })}</form><button type="button" class="sheet-danger asset-pool-archive" data-action="asset-pool-archive" data-id="${escapeHTML(pool.id)}">归档额度池</button>` });
}

export function registerAssetManagementActions() {
  registerAssetOperationActions();
  registerAction('assets-manage', () => openAssetManager('saving'));
  registerAction('asset-manager-tab', (el) => refreshManager(el.dataset.type));
  registerAction('asset-manager-add', (el) => openAssetEditor({ type: el.dataset.type, stacked: true, returnToManager: true }));
  registerAction('asset-manager-edit', (el) => openAssetEditor({ accountId: el.dataset.id, stacked: true, returnToManager: true }));
  registerAction('asset-manager-restore', (el) => { data.restoreAsset(el.dataset.id); refreshManager(data.getAccount(el.dataset.id).type); });
  registerAction('asset-editor-save', (el) => {
    const form = el.closest('.sheet-body').querySelector('[data-asset-editor]');
    const values = Object.fromEntries(new FormData(form));
    try {
      const changes = { name: values.name, displayName: values.name, note: values.note, isDefault: form.elements.isDefault.checked, isHidden: form.elements.isHidden.checked, ...readAssetIdentity(form, editorIdentityDraft) };
      if (editorContext.type === 'saving') {
        Object.assign(changes, { bankAccountNumber: validateOptionalBankAccountNumber(values.bankAccountNumber), debitCardLast4: validateOptionalLastFour(values.debitCardLast4, '银行卡末四位') });
      }
      if (editorContext.type === 'ew') changes.walletIdentifier = values.walletIdentifier;
      if (editorContext.type === 'cc') {
        const tier = CREDIT_TIERS.includes(values.tier) ? values.tier : '';
        const customTierLabel = String(values.customTierLabel || '').trim().slice(0, 32);
        if (tier === 'Other' && !customTierLabel) throw new Error('请输入自定义信用卡等级');
        Object.assign(changes, { creditCardLast4: validateOptionalLastFour(values.creditCardLast4, '信用卡末四位'), limit: values.limit, sharedLimitPoolId: values.sharedLimitPoolId || null, tier, customTierLabel: tier === 'Other' ? customTierLabel : '', includeInTotalDebt: form.elements.includeInTotalDebt.checked });
      }
      else Object.assign(changes, { includeInAvailableCash: form.elements.includeInAvailableCash.checked, includeInNetWorth: form.elements.includeInNetWorth.checked, ...(!editorContext.accountId ? { balance: values.balance || 0 } : {}) });
      if (!editorContext.accountId && editorContext.type === 'cc') Object.assign(changes, { openingRecordOnlyDebt: values.openingRecordOnlyDebt || 0, openingCardCredit: values.openingCardCredit || 0 });
      const account = editorContext.accountId ? data.updateAsset(editorContext.accountId, changes) : data.createAsset({ ...changes, type: editorContext.type });
      if (editorContext.accountId && account.status !== 'archived' && form.elements.isActive.checked !== (account.status === 'active')) data.setAssetActive(account.id, form.elements.isActive.checked);
      if (editorContext.type === 'cc') data.assignCardToSharedLimitPool(account.id, values.sharedLimitPoolId || null);
      const returnToManager = editorContext.returnToManager;
      const managerType = editorContext.type;
      editorDirty = false;
      closeSheet(true);
      if (returnToManager) {
        closeSheet(true);
        openAssetManager(managerType);
      }
      toast('账户已保存'); update({});
    } catch (error) { toast(error.message); }
  });
  registerAction('asset-editor-adjust', (el) => openAssetOperation(el.dataset.id, 'adjustment'));
  registerAction('asset-editor-discard', () => { editorDirty = false; closeSheet(true); closeSheet(true); });
  registerAction('asset-detail-edit', (el) => openAssetEditor({ accountId: el.dataset.id }));
  registerAction('asset-detail-menu', () => openAssetOverflowMenu(ui.assetsView.accountId));
  registerAction('asset-menu-edit', (el) => openAssetEditor({ accountId: el.dataset.id, stacked: true }));
  registerAction('asset-menu-default', (el) => { const account = data.getAccount(el.dataset.id); const wasDefault = account.isDefault; data.setDefaultAsset(account.type, wasDefault ? null : account.id); closeSheet(true); toast(wasDefault ? '已取消默认' : '已设为默认'); update({}); });
  registerAction('asset-menu-hidden', (el) => { const account = data.getAccount(el.dataset.id); const wasHidden = account.isHidden; data.setAssetHidden(account.id, !wasHidden); closeSheet(true); toast(wasHidden ? '账户已显示' : '账户已隐藏'); update({}); });
  registerAction('asset-menu-active', (el) => { const account = data.getAccount(el.dataset.id); const wasActive = account.status === 'active'; data.setAssetActive(account.id, !wasActive); closeSheet(true); toast(wasActive ? '账户已停用' : '账户已启用'); update({}); });
  registerAction('asset-menu-operation', (el) => { const id = el.dataset.id; closeSheet(true); openAssetOperation(id, 'fee'); });
  registerAction('asset-menu-opening', (el) => { const id = el.dataset.id; closeSheet(true); openAssetOperation(id, 'opening'); });
  registerAction('asset-menu-archive', (el) => confirmArchive(data.getAccount(el.dataset.id)));
  registerAction('asset-menu-delete', (el) => confirmDelete(data.getAccount(el.dataset.id)));
  registerAction('asset-archive-confirm', () => { const id = menuContextId; data.archiveAsset(id); closeSheet(true); closeSheet(true); toast('账户已归档'); update({ assetsView: { name: 'overview' } }); });
  registerAction('asset-delete-confirm', () => { const id = menuContextId; data.hardDeleteAsset(id); closeSheet(true); closeSheet(true); toast('账户已删除'); update({ assetsView: { name: 'overview' } }); });
  registerAction('asset-transfer-in', (el) => openCaptureSheet({ preset: { mode: 'transfer', destinationAccountId: el.dataset.id } }));
  registerAction('asset-transfer-out', (el) => openCaptureSheet({ preset: { mode: 'transfer', sourceAccountId: el.dataset.id } }));
  registerAction('asset-record-expense', (el) => openCaptureSheet({ preset: { mode: 'expense', accountId: el.dataset.id } }));
  registerAction('asset-pool-manager', openPoolManager);
  registerAction('asset-pool-edit', (el) => openPoolEditor(el.dataset.id));
  registerAction('asset-pool-edit-save', (el) => { const form = el.closest('.sheet-body').querySelector('[data-pool-edit]'); const values = Object.fromEntries(new FormData(form)); try { data.updateSharedLimitPool(form.dataset.id, values); closeSheet(true); closeSheet(true); openPoolManager(); toast('共享额度池已更新'); } catch (error) { toast(error.message); } });
  registerAction('asset-pool-archive', (el) => { try { data.removeSharedLimitPool(el.dataset.id); closeSheet(true); closeSheet(true); openPoolManager(); toast('共享额度池已归档'); } catch (error) { toast(error.message); } });
  registerAction('asset-pool-create', (el) => { const form = el.closest('.sheet-body').querySelector('[data-pool-create]'); const values = Object.fromEntries(new FormData(form)); try { data.createSharedLimitPool(values); closeSheet(true); openPoolManager(); toast('共享额度池已添加'); } catch (error) { toast(error.message); } });
}
