import { openSheet, closeSheet, closeAllSheets, toast } from './AppSheet.js';
import { icon } from './Icons.js';
import { fmtRM, escapeHTML } from '../app/format.js';
import { data, update, registerAction } from '../app/state.js';
import { navigate } from '../app/router.js';
import { openCategoryPicker, registerCategorySheetActions } from './CategorySheets.js';
import { nativeDateTimeFieldsHTML, bindNativeDateTimeFields } from './NativeDateTimeFields.js';
import { attachmentSummaryHTML, bindAttachmentField } from './AttachmentField.js';
import { openPickerSheet } from './PickerSheet.js';
import { openMoneyCalculatorSheet, bindMoneyField, evaluateMoneyExpression, inspectMoneyExpression, moneyStringToMinor, formatMoneyMinor } from './MoneyCalculatorSheet.js';
import { allocationSummary, applyRemainderToLast, equalSplitMinor, rebuildSplitShares, suggestedMissingShare } from '../domain/smartSplit.js';
import { openMoneyFlowConfirmation } from './MoneyFlowConfirmation.js';
import { participantAvatarHTML } from '../domain/avatarResolver.js';
import { CAPTURE_DETAIL_COPY, RELATIONSHIP_COPY } from '../app/copy.js';
import { CAPTURE_MODES, bindCaptureViewportHeight, relationshipTypeLabels, syncCaptureSheetPresentation } from './CapturePresentation.js';
import { bindTapIntent } from './TapIntent.js';
import { openCapacityAlert } from './CapacityAlertSheet.js';
import { isAccountCapacityError } from '../domain/accountCapacity.js';
import {
  commitInlineSplitExpression,
  customAllocationProgress,
  customParticipantPresentation,
  createInlineSplitDraft,
  inlineSplitDrawerHTML,
  pressInlineSplitKey,
  switchInlineSplitParticipant,
} from './SplitAllocationEditorSheet.js';
import { sheetActionDockHTML } from './SheetActionDock.js';

export { resolveCaptureViewportHeight } from './CapturePresentation.js';
const ME = 'participant-me';

const cap = {
  mode: 'expense', amount: '', catId: null, accountId: 'sv-mbb', destinationAccountId: 'ew-tng',
  recordOnly: false, relationship: null, desc: '', date: '', time: '',
  submissionKey: '',
  keypadOpen: true, detailsOpen: false, calculatorFresh: false, completedExpression: '', error: '',
};
let sheetEl = null;
let saving = false;
let relationDraft = null;
let relationSheet = null;
let relationReturn = null;
let captureViewportCleanup = null;
let relationDrawer = null;
let relationKeydownCleanup = null;

function unbindCaptureViewport() {
  captureViewportCleanup?.();
  captureViewportCleanup = null;
}

function bindCaptureViewport(sheet) {
  unbindCaptureViewport();
  captureViewportCleanup = bindCaptureViewportHeight(sheet);
}

function defaultCategoryId(type) { return type === 'transfer' ? null : data.getDefaultCategoryId(type) || data.getDefaultCategory(type)?.id || null; }

export function openCaptureSheet({ preserve = false, preset = null } = {}) {
  const now = new Date();
  if (!preserve) {
    if (cap.submissionKey) data.discardDraftAttachments(cap.submissionKey);
    Object.assign(cap, {
      mode: 'expense', amount: '', catId: defaultCategoryId('expense'), accountId: 'sv-mbb', destinationAccountId: 'ew-tng',
      recordOnly: false, relationship: null, desc: '', date: data.today,
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      submissionKey: `capture-${now.getTime()}-${Math.random().toString(36).slice(2)}`,
      keypadOpen: true, detailsOpen: false, calculatorFresh: false, completedExpression: '', error: '',
    });
  }
  if (preset) {
    const eligible = data.getAccounts().filter((account) => account.status === 'active' && account.type !== 'cc' && !account.isHidden);
    const mode = preset.mode || cap.mode;
    let sourceAccountId = preset.sourceAccountId || cap.accountId;
    let destinationAccountId = preset.destinationAccountId || cap.destinationAccountId;
    if (mode === 'transfer' && sourceAccountId === destinationAccountId) {
      if (preset.destinationAccountId) sourceAccountId = eligible.find((account) => account.id !== destinationAccountId)?.id || sourceAccountId;
      else destinationAccountId = eligible.find((account) => account.id !== sourceAccountId)?.id || destinationAccountId;
    }
    Object.assign(cap, {
      mode,
      catId: mode === 'transfer' ? null : defaultCategoryId(mode),
      accountId: sourceAccountId,
      destinationAccountId,
      error: '',
    });
  }
  saving = false;
  sheetEl = openSheet({
    id: 'capture-root',
    title: '',
    className: 'capture-sheet',
    detent: 'large',
    contentHTML: captureHTML(),
    onClose: () => { unbindCaptureViewport(); sheetEl = null; },
  });
  syncCaptureSheetPresentation(sheetEl, cap.mode);
  bindCaptureViewport(sheetEl);
  bindCapturePickers();
}

function syncForm() {
  if (!sheetEl) return;
  const get = (selector) => sheetEl.querySelector(selector)?.value;
  if (get('[data-cap-desc]') !== undefined) cap.desc = get('[data-cap-desc]');
  const recordOnly = sheetEl.querySelector('[data-cap-record-only]');
  if (recordOnly) cap.recordOnly = Boolean(recordOnly.checked);
}

function rerender() {
  if (!sheetEl) return;
  syncForm();
  sheetEl.querySelector('.sheet-body').innerHTML = captureHTML();
  syncCaptureSheetPresentation(sheetEl, cap.mode);
  bindCapturePickers();
}

function bindCapturePickers() {
  bindNativeDateTimeFields(sheetEl, { onDateChange: (value) => { cap.date = value; }, onTimeChange: (value) => { cap.time = value; } });
  if (cap.detailsOpen) bindAttachmentField(sheetEl, { onChange: () => {} });
  bindTapIntent(sheetEl?.querySelector('[data-action="capture-relationship"]'), openCaptureRelationship);
}

function draftAttachments() {
  return data.getAttachments('draft', cap.submissionKey);
}

function detailsSummary() {
  const parts = [];
  const attachments = draftAttachments();
  if (attachments.length) parts.push(`${attachments.length}个附件`);
  if (cap.recordOnly) parts.push('只记录');
  if (cap.relationship) parts.push(relationshipTypeLabels(data.getRelationshipLedger(cap.relationship.ledgerId))[cap.relationship.entryType]);
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

function amountDisplay() {
  const state = inspectMoneyExpression(cap.amount, { allowZero: true });
  return formatMoneyMinor(state.result?.minor ?? state.currentMinor ?? 0).replace('RM ', '');
}

function amountHeroHTML() {
  const state = inspectMoneyExpression(cap.amount, { allowZero: true });
  const formulaActive = Boolean(!cap.calculatorFresh && state.expression && /[+−×÷]/.test(state.expression));
  const incomplete = formulaActive && Boolean(state.error);
  const result = formatMoneyMinor(state.result?.minor ?? state.currentMinor ?? 0);
  const primary = formulaActive ? state.expression : `RM ${amountDisplay()}`;
  const secondary = formulaActive ? `当前结果 ${result}` : cap.completedExpression || '金额';
  return `<div class="cap-amount num${formulaActive ? ' formula-active' : ''}${primary.length > 14 ? ' formula-long' : ''}" aria-label="输入金额，当前 RM ${amountDisplay()}">
    <span class="cap-amount-value" data-capture-primary>${escapeHTML(primary)}</span>
    <small class="cap-expression-line num" data-capture-expression>${escapeHTML(secondary)}</small>
    <em class="${cap.error === '请先完成算式' ? 'error' : ''}" data-capture-helper>${escapeHTML(cap.error === '请先完成算式' ? cap.error : incomplete ? state.helper : '')}</em>
  </div>`;
}

function compactAmountBarHTML() {
  return `<div class="cap-compact-amount" data-capture-compact-amount><span><small>金额</small><strong class="num">RM ${amountDisplay()}</strong></span><button type="button" data-action="cap-edit-amount">编辑 ${icon('chevronRight', 14)}</button></div>`;
}

function captureHTML() {
  const accounts = data.getAccounts();
  const modes = `<div class="segmented capture-modes" role="radiogroup" aria-label="记账模式">${CAPTURE_MODES.map((mode) => `<button class="seg-item${cap.mode === mode.id ? ' active' : ''}" data-action="cap-mode" data-mode="${mode.id}" role="radio" aria-checked="${cap.mode === mode.id}">${mode.label}</button>`).join('')}</div>`;
  const more = `<button class="cap-more-entry${cap.detailsOpen ? ' open' : ''}" data-action="cap-open-details" aria-expanded="${cap.detailsOpen}"><span>更多资料${detailsSummary() ? `<small>${detailsSummary()}</small>` : ''}</span>${icon('chevronRight', 16)}</button>`;
  const validation = cap.error && cap.error !== '请先完成算式'
    ? `<div class="form-error capture-form-error" data-capture-error role="alert">${icon('alert', 15)}<span>${escapeHTML(cap.error)}</span></div>`
    : '';
  const defaultFlow = `${amountHeroHTML()}${cap.mode === 'transfer' ? '' : quickRow(cap.mode)}${accountsHTML(accounts)}${cap.mode === 'transfer' ? quickRow('transfer') : ''}${more}${validation}${directKeypadHTML()}`;
  const detailFlow = `${compactAmountBarHTML()}${more}${validation}${inlineDetailsHTML()}`;
  return `<div class="capture-main ${cap.detailsOpen ? 'details-mode' : 'calculator-mode'}" data-capture-main>${modes}${cap.detailsOpen ? detailFlow : defaultFlow}</div>
    <footer class="cap-save-wrap"><button class="cap-save" data-action="cap-save">保存</button></footer>`;
}

function directKeypadHTML() {
  const keys = ['C','back','÷','×','7','8','9','−','4','5','6','+','1','2','3','=','0','.'];
  return `<section class="capture-calculator capture-direct-keypad" data-capture-calculator aria-label="金额计算器">
    <div class="capture-calculator-keys" role="group" aria-label="金额计算器键盘">${keys.map((key) => `<button type="button" class="capture-calculator-key${['÷','×','−','+','='].includes(key) ? ' operator' : ''}${key === '0' ? ' zero' : ''}${key === '=' ? ' equals' : ''}" data-action="cap-calculator-key" data-key="${key}" aria-label="${key === 'back' ? '退格' : key === 'C' ? '清除' : key}">${key === 'back' ? icon('backspace', 19) : key}</button>`).join('')}</div>
  </section>`;
}

function refreshAmountUI() {
  if (!sheetEl) return;
  sheetEl.querySelector('[data-capture-error]')?.remove();
  const heroWrapper = document.createElement('div');
  heroWrapper.innerHTML = amountHeroHTML();
  sheetEl.querySelector('.cap-amount')?.replaceWith(heroWrapper.firstElementChild);
  const calculatorWrapper = document.createElement('div');
  calculatorWrapper.innerHTML = directKeypadHTML();
  sheetEl.querySelector('[data-capture-calculator]')?.replaceWith(calculatorWrapper.firstElementChild);
}

export function appendCaptureAmount(value, key) {
  let next = String(value || '');
  if (key === 'back') return next.slice(0, -1);
  if (key === '.') return next.includes('.') ? next : `${next || '0'}.`;
  if (!/^\d$/.test(key)) return next;
  const [whole = '', decimals] = next.split('.');
  if (decimals !== undefined) return decimals.length >= 2 ? next : `${next}${key}`;
  const cleanWhole = whole === '0' ? '' : whole;
  return `${cleanWhole}${key}`.slice(0, 9);
}

function captureError(message, targetSelector = '[data-capture-error]') {
  cap.error = message;
  rerender();
  requestAnimationFrame(() => sheetEl?.querySelector(targetSelector)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
}

function accountButtons(accounts, selectedId, action, label) {
  return `<div class="caption cap-account-label">${label}</div><div class="cap-accounts" role="listbox" aria-label="${label}">${accounts.map((account) => `<button class="cap-acc${selectedId === account.id ? ' active' : ''}" data-action="${action}" data-acc="${account.id}" role="option" aria-selected="${selectedId === account.id}">${escapeHTML(account.short || account.name)}</button>`).join('')}</div>`;
}

function accountSummary(account) {
  if (!account) return '';
  const cardDebt = Number.isFinite(account.totalCardDebt) ? account.totalCardDebt : account.outstanding;
  return account.type === 'cc' ? `${account.limit == null ? '未设信用额度' : account.overLimit > 0 ? `超额 ${fmtRM(account.overLimit)}` : `可用 ${fmtRM(account.availableCredit)}`} · 欠 ${fmtRM(cardDebt)}` : `余额 ${fmtRM(account.balance)}`;
}

function accountsHTML(accounts) {
  const paidByOther = cap.mode === 'expense' && (cap.relationship?.entryType === 'direct_payable' || (cap.relationship?.entryType === 'split_expense' && cap.relationship.payerParticipantId !== ME));
  if (paidByOther) {
    const payerId = cap.relationship.entryType === 'direct_payable' ? cap.relationship.participantId : cap.relationship.payerParticipantId;
    return `<div class="caption cap-account-label">付款方</div><div class="cap-transfer-summary"><span>${escapeHTML(data.getParticipant(payerId)?.displayName || '对方')}</span><span class="caption">由对方付款，不会扣除你的账户余额</span></div>`;
  }
  if (cap.mode === 'transfer') {
    const eligible = accounts.filter((account) => account.type !== 'cc');
    const source = data.getAccount(cap.accountId), destination = data.getAccount(cap.destinationAccountId);
    return `${accountButtons(eligible, cap.accountId, 'cap-source', '转出账户')}${accountButtons(eligible, cap.destinationAccountId, 'cap-destination', '转入账户')}<div class="cap-transfer-summary"><span>${escapeHTML(source?.short || source?.name || '')}</span>${icon('transfer', 15)}<span>${escapeHTML(destination?.short || destination?.name || '')}</span></div>`;
  }
  const eligible = cap.mode === 'income' ? accounts.filter((account) => account.type !== 'cc') : accounts;
  const account = data.getAccount(cap.accountId);
  return `${accountButtons(eligible, cap.accountId, 'cap-acc', cap.mode === 'income' ? '入账账户' : '支出账户')}<div class="caption cap-acc-summary">${escapeHTML(account?.name || '')} · ${accountSummary(account)}</div>`;
}

function inlineDetailsHTML() {
  return `<div class="advanced-details" data-advanced-details>
    <section class="capture-detail-group capture-transaction-details glass-sheet" aria-labelledby="capture-transaction-details-title">
      <h3 id="capture-transaction-details-title">${CAPTURE_DETAIL_COPY.transactionDetails}</h3>
      <label class="capture-detail-row capture-description-row"><span><strong>${CAPTURE_DETAIL_COPY.note}</strong></span><input type="text" data-cap-desc aria-label="${CAPTURE_DETAIL_COPY.note}" placeholder="${CAPTURE_DETAIL_COPY.notePlaceholder}" value="${escapeHTML(cap.desc)}" maxlength="40" /></label>
      <div class="capture-detail-divider"></div>
      <div class="capture-detail-datetime">${nativeDateTimeFieldsHTML({ prefix: 'capture-inline', date: cap.date, time: cap.time })}</div>
      <div class="capture-detail-divider"></div>
      <div class="capture-detail-attachment attachment-section">${attachmentSummaryHTML('draft', cap.submissionKey)}</div>
    </section>
    <section class="capture-detail-group capture-accounting-method glass-sheet" aria-labelledby="capture-accounting-method-title">
      <h3 id="capture-accounting-method-title">${CAPTURE_DETAIL_COPY.accountingMethod}</h3>
      ${cap.mode === 'expense' ? `<button class="capture-detail-row advanced-relation" data-action="capture-relationship"><span><strong>${CAPTURE_DETAIL_COPY.relationship}</strong><small>${cap.relationship ? relationshipTypeLabels(data.getRelationshipLedger(cap.relationship.ledgerId))[cap.relationship.entryType] : '普通支出'}</small></span>${icon('chevronRight', 16)}</button><div class="capture-detail-divider"></div>` : ''}
      <button type="button" class="capture-detail-row capture-record-switch" data-action="cap-toggle-record-only" role="switch" aria-checked="${cap.recordOnly}">
        <span><strong>${CAPTURE_DETAIL_COPY.recordOnly}</strong><small>${CAPTURE_DETAIL_COPY.balanceNeutral}</small></span><i class="ringgit-switch" aria-hidden="true"><b></b></i>
      </button>
    </section>
  </div>`;
}

// ---- Relationship sub-sheet --------------------------------

function relationLedger() {
  return data.getRelationshipLedger(relationDraft.ledgerId) || data.getRelationshipLedgers()[0];
}

// All payer/member/counterparty choices derive from the currently selected
// ledger's participantIds. Switching ledgers clears anything that no longer
// belongs — a payer from the previous ledger can never survive the switch.
function syncRelationLedger(ledgerId) {
  const ledger = data.getRelationshipLedger(ledgerId) || data.getRelationshipLedgers()[0];
  const changedLedger = relationDraft.ledgerId !== ledger?.ledgerId;
  relationDraft.ledgerId = ledger?.ledgerId;
  const members = ledger?.participantIds || [];
  if (!members.includes(relationDraft.payerParticipantId)) relationDraft.payerParticipantId = ME;
  if (!members.includes(relationDraft.participantId) || relationDraft.participantId === ME) relationDraft.participantId = members.find((id) => id !== ME) || null;
  if (changedLedger) {
    relationDraft.splitParticipantIds = [...members];
    relationDraft.customShares = {};
  } else {
    relationDraft.splitParticipantIds = (relationDraft.splitParticipantIds || []).filter((id) => members.includes(id));
    if (!relationDraft.splitParticipantIds.length) relationDraft.splitParticipantIds = [...members];
    relationDraft.customShares = Object.fromEntries(Object.entries(relationDraft.customShares || {}).filter(([id]) => relationDraft.splitParticipantIds.includes(id)));
  }
}

function participantName(id) {
  return data.getParticipant(id)?.displayName || '参与者';
}

function relationshipTypeIcon(type) {
  return { normal: 'note', split_expense: 'aa', direct_receivable: 'arrowDown', direct_payable: 'arrowUp' }[type] || 'note';
}

function relationshipGroupHTML({ className, title, content }) {
  const id = `relationship-${className}-title`;
  return `<section class="relationship-glass-group ${className}" aria-labelledby="${id}"><h3 id="${id}">${escapeHTML(title)}</h3>${content}</section>`;
}

function participantConnectionLabel(participant) {
  if ((participant?.channelBindings || []).length) return 'RinggitMe 已连接';
  return '本地对象';
}

function relationshipPickerRowHTML({ label, key, valueLabel, participant = null, caption = '', avatarText = '' }) {
  const avatar = participant
    ? participantAvatarHTML(participant, 'relationship-row-avatar')
    : `<span class="relationship-row-avatar" aria-hidden="true">${escapeHTML(avatarText || valueLabel.slice(0, 1) || '?')}</span>`;
  return `<button type="button" class="relationship-picker-row" data-picker-field="${escapeHTML(key)}" aria-label="${escapeHTML(label)}，当前 ${escapeHTML(valueLabel)}">
    ${avatar}<span class="relationship-picker-main"><small>${escapeHTML(label)}</small><strong>${escapeHTML(valueLabel)}</strong><span class="caption">${escapeHTML(caption || (participant ? participantConnectionLabel(participant) : ''))}</span></span><span class="relationship-row-chevron">${icon('chevronRight', 17)}</span>
  </button>`;
}

function participantChipHTML(id) {
  const participant = data.getParticipant(id);
  const selected = relationDraft.splitParticipantIds.includes(id);
  return `<button type="button" class="split-member relationship-avatar-chip${selected ? ' active' : ''}" data-action="capture-split-member" data-participant="${escapeHTML(id)}" aria-pressed="${relationDraft.splitParticipantIds.includes(id)}">${participantAvatarHTML(participant, 'relationship-chip-avatar')}<span>${escapeHTML(id === ME ? '我' : participantName(id))}</span>${selected ? icon('check', 12) : ''}</button>`;
}

function customSplitRowHTML(id, shares) {
  const participant = data.getParticipant(id);
  const key = `capture-share-${id}`;
  const value = (Number(shares[id] || 0) / 100).toFixed(2);
  const active = relationDrawer?.activeId === id;
  const presentation = customParticipantPresentation({ amountMinor: shares[id], active, expression: relationDrawer?.expression, fresh: relationDrawer?.fresh });
  const stateClass = presentation.state === 'active' ? ' is-editing' : presentation.state === 'committed' ? ' has-committed' : ' is-untouched';
  const affordance = presentation.hint
    ? escapeHTML(presentation.hint)
    : icon('chevronRight', 12);
  return `<div class="split-participant-row relationship-amount-row-wrap${stateClass}" role="listitem" data-split-participant="${escapeHTML(id)}" data-allocation-state="${presentation.state}">
    <button type="button" class="relationship-amount-row money-field-button has-affordance" data-money-field="${escapeHTML(key)}" data-split-allocation="${escapeHTML(id)}" data-money-label="${escapeHTML(participantName(id))}" aria-label="编辑 ${escapeHTML(participantName(id))} 的分摊金额，当前 ${escapeHTML(presentation.amountLabel)}">${participantAvatarHTML(participant, 'relationship-row-avatar')}<span class="relationship-amount-copy"><span class="relationship-amount-name-line"><span class="relationship-amount-name">${escapeHTML(id === ME ? 'Winner' : participantName(id))}</span></span><span class="relationship-amount-value-line"><strong class="num${presentation.editingExpression ? ' is-expression' : ''}" data-money-field-label="${escapeHTML(key)}">${escapeHTML(presentation.amountLabel)}</strong><small class="custom-card-affordance">${affordance}</small></span></span></button>
    <input type="hidden" data-money-value="${escapeHTML(key)}" value="${escapeHTML(value)}" />
  </div>`;
}

function customSplitPagesHTML(ids, shares) {
  const pages = [];
  for (let index = 0; index < ids.length; index += 6) pages.push(ids.slice(index, index + 6));
  return `<div class="custom-shares relationship-split-pages" role="list" aria-label="自定义分摊对象">${pages.map((page, pageIndex) => `<div class="relationship-split-page" role="presentation" data-split-page="${pageIndex}">${page.map((id) => customSplitRowHTML(id, shares)).join('')}</div>`).join('')}</div>`;
}

function equalSplitRowHTML(id, shares) {
  const participant = data.getParticipant(id);
  return `<div class="split-participant-row relationship-amount-row-wrap is-readonly" role="listitem" data-split-participant="${escapeHTML(id)}">
    <div class="relationship-amount-row">${participantAvatarHTML(participant, 'relationship-row-avatar')}<span class="relationship-amount-name">${escapeHTML(id === ME ? 'Winner' : participantName(id))}</span><strong class="num">${formatMoneyMinor(shares[id])}</strong></div>
  </div>`;
}

function equalSplitPagesHTML(ids, shares) {
  const pages = [];
  for (let index = 0; index < ids.length; index += 6) pages.push(ids.slice(index, index + 6));
  return `<div class="equal-split-preview relationship-equal-list relationship-split-pages" role="list" aria-label="平均分摊对象">${pages.map((page, pageIndex) => `<div class="relationship-split-page" role="presentation" data-split-page="${pageIndex}">${page.map((id) => equalSplitRowHTML(id, shares)).join('')}</div>`).join('')}</div>`;
}
// Custom rows keep the accepted participantAvatarHTML hierarchy while the old
// moneyFieldHTML({ label: participantName(id) wrapper is intentionally replaced
// by one full-width tap row. FIX3 keeps the safe calculator engine but opens
// one continuous allocation editor instead of a separate calculator per row.

function splitPreviewHTML(ledger) {
  let totalMinor = 0;
  try { totalMinor = moneyStringToMinor(cap.amount || '0'); } catch { /* capture validation owns the message */ }
  const selected = relationDraft.splitParticipantIds;
  if (!selected.length) return '<div class="relationship-preview caption">请至少选择一位分摊参与者。</div>';
  if (relationDraft.splitMode === 'custom') {
    const shares = rebuildSplitShares({ totalMinor, participantIds: selected, previous: relationDrawer?.shares || relationDraft.customShares });
    if (relationDrawer) relationDrawer.shares = shares;
    else relationDraft.customShares = shares;
    const summary = allocationSummary(totalMinor, shares, selected);
    const status = customAllocationProgress(totalMinor, shares, selected);
    const suggestion = suggestedMissingShare(totalMinor, selected, shares);
    const progress = totalMinor ? Math.min(100, Math.round(summary.allocatedMinor / totalMinor * 100)) : 0;
    return `<div class="smart-split-heading"><div class="custom-split-heading-copy"><span class="custom-split-title-row"><strong>${RELATIONSHIP_COPY.action.custom}</strong><span class="caption">${RELATIONSHIP_COPY.allocation.total} ${formatMoneyMinor(totalMinor)}</span></span><small class="custom-split-helper">点击成员输入金额</small></div><span class="split-state ${status.state}">${escapeHTML(status.label)}</span></div>
      <div class="smart-split-progress ${summary.overMinor ? 'over' : summary.exact ? 'exact' : ''}"><i style="width:${progress}%"></i></div>
      ${customSplitPagesHTML(selected, shares)}
      <div class="relationship-allocation-status ${status.state}${relationDraft.error ? ' error-emphasis error-shake' : ''}" aria-live="polite" data-split-summary tabindex="-1">
        <span>${RELATIONSHIP_COPY.allocation.total} <strong class="num">${formatMoneyMinor(totalMinor)}</strong></span><i>·</i><span>${RELATIONSHIP_COPY.allocation.allocated} <strong class="num">${formatMoneyMinor(summary.allocatedMinor)}</strong></span><i>·</i><span>${summary.overMinor ? RELATIONSHIP_COPY.allocation.excess : summary.exact ? RELATIONSHIP_COPY.allocation.difference : RELATIONSHIP_COPY.allocation.remaining} <strong class="num">${formatMoneyMinor(summary.overMinor || summary.remainingMinor)}</strong></span>
      </div>
      ${relationDraft.error ? `<div class="form-error relationship-allocation-error" role="alert">${escapeHTML(relationDraft.error)}</div>` : ''}
      ${suggestion ? `<div class="smart-split-suggestion caption">${escapeHTML(participantName(suggestion.participantId))} 可补 ${formatMoneyMinor(suggestion.amountMinor)}</div>` : ''}
      <div class="smart-split-actions"><button type="button" data-action="capture-split-even">${RELATIONSHIP_COPY.action.distributeEvenly}</button><button type="button" data-action="capture-split-remainder" ${summary.remainingMinor ? '' : 'disabled'}>${RELATIONSHIP_COPY.action.fillLast}</button><button type="button" data-action="capture-split-clear">${RELATIONSHIP_COPY.action.clear}</button></div>`;
  }
  const shares = equalSplitMinor(totalMinor, selected);
  const payerNote = relationDraft.payerParticipantId !== ME ? `<br/>由 ${escapeHTML(participantName(relationDraft.payerParticipantId))} 付款，不会扣除你的账户余额` : '';
  return `${equalSplitPagesHTML(selected, shares)}<div class="relationship-preview relationship-inline-note caption">平均分摊 · 最后一位自动吸收分币差额${payerNote}</div>`;
}

function relationshipSheetHTML() {
  const ledgers = data.getRelationshipLedgers();
  const ledger = relationLedger();
  const labels = relationshipTypeLabels(ledger);
  const type = relationDraft.entryType;
  let groups = '';
  if (type !== 'normal') {
    const targetParticipantId = ledger?.derivedType === 'personal' ? ledger.participantIds.find((id) => id !== ME) : null;
    const targetParticipant = targetParticipantId ? data.getParticipant(targetParticipantId) : null;
    groups += relationshipGroupHTML({
      className: 'relationship-target-group',
      title: RELATIONSHIP_COPY.group.target,
      content: `${relationshipPickerRowHTML({ label: RELATIONSHIP_COPY.field.target, key: 'ledger', valueLabel: ledger?.title || '选择账本', participant: targetParticipant, caption: ledger?.derivedType === 'group' ? `${ledger.participantIds.length} 位成员` : '', avatarText: ledger?.title?.slice(0, 1) })}<button class="relationship-secondary-action relation-add-person" data-action="capture-relation-add-person">${icon('plus', 16)}<span>${RELATIONSHIP_COPY.action.addLocalTarget}</span></button>`,
    });
  }
  if (type === 'split_expense' && ledger) {
    const payerParticipant = data.getParticipant(relationDraft.payerParticipantId);
    groups += relationshipGroupHTML({
      className: 'relationship-participants-group',
      title: RELATIONSHIP_COPY.group.payerParticipants,
      content: `${relationshipPickerRowHTML({ label: RELATIONSHIP_COPY.field.payer, key: 'payer', valueLabel: relationDraft.payerParticipantId === ME ? '我付款' : `${participantName(relationDraft.payerParticipantId)} 付款`, participant: payerParticipant })}<div class="relationship-group-divider"></div><div class="caption relationship-field-label">参与者</div><div class="split-members" role="group" aria-label="${RELATIONSHIP_COPY.field.participants}">${ledger.participantIds.map(participantChipHTML).join('')}</div>`,
    });
    groups += relationshipGroupHTML({
      className: 'relationship-split-group',
      title: RELATIONSHIP_COPY.group.splitMethod,
      content: `<div class="segmented relationship-split-segment ${relationDraft.splitMode === 'custom' ? 'is-custom' : 'is-equal'}" role="radiogroup" aria-label="${RELATIONSHIP_COPY.group.splitMethod}"><button class="seg-item${relationDraft.splitMode !== 'custom' ? ' active' : ''}" data-action="capture-split-mode" data-mode="equal" role="radio" aria-checked="${relationDraft.splitMode !== 'custom'}">${RELATIONSHIP_COPY.action.equal}</button><button class="seg-item${relationDraft.splitMode === 'custom' ? ' active' : ''}" data-action="capture-split-mode" data-mode="custom" role="radio" aria-checked="${relationDraft.splitMode === 'custom'}">${RELATIONSHIP_COPY.action.custom}</button></div>${splitPreviewHTML(ledger)}`,
    });
  } else if (type === 'direct_receivable' && ledger) {
    const participant = data.getParticipant(relationDraft.participantId);
    groups += relationshipGroupHTML({ className: 'relationship-direction-group', title: RELATIONSHIP_COPY.group.payerParticipants, content: relationshipPickerRowHTML({ label: ledger.derivedType === 'group' ? '哪位成员欠我' : '谁欠我', key: 'counterparty', valueLabel: participantName(relationDraft.participantId), participant }) });
  } else if (type === 'direct_payable' && ledger) {
    const participant = data.getParticipant(relationDraft.participantId);
    groups += relationshipGroupHTML({ className: 'relationship-direction-group', title: RELATIONSHIP_COPY.group.payerParticipants, content: relationshipPickerRowHTML({ label: ledger.derivedType === 'group' ? '我欠哪位成员' : '我欠谁', key: 'counterparty', valueLabel: participantName(relationDraft.participantId), participant }) });
  }
  let splitValid = true;
  if (type === 'split_expense' && relationDraft.splitMode === 'custom') {
    let totalMinor = 0;
    try { totalMinor = moneyStringToMinor(cap.amount || '0'); } catch { /* disabled below */ }
    splitValid = allocationSummary(totalMinor, relationDraft.customShares, relationDraft.splitParticipantIds).exact;
  }
  const drawer = relationDrawer ? inlineSplitDrawerHTML({
    totalMinor: moneyStringToMinor(cap.amount || '0'),
    participantIds: relationDrawer.ids,
    sharesMinor: relationDrawer.shares,
    activeParticipantId: relationDrawer.activeId,
    expression: relationDrawer.expression,
    error: relationDrawer.error,
    opening: relationDrawer.isOpening,
  }) : '';
  return `<div class="relationship-editor${relationDrawer ? ' has-inline-drawer' : ''}" data-capture-relation>
    <div class="relation-mode-grid relationship-type-grid" role="radiogroup" aria-label="关系类型">${Object.entries(labels).map(([mode, text]) => `<button type="button" class="relationship-type-tile ${type === mode ? 'is-selected active' : 'is-unselected'}" data-action="capture-relation-mode" data-type="${mode}" role="radio" aria-checked="${type === mode}"><span class="relationship-type-icon">${icon(relationshipTypeIcon(mode), 18)}</span><strong>${text}</strong><span class="relationship-type-check">${type === mode ? icon('check', 14) : ''}</span></button>`).join('')}</div>
    <p class="relationship-type-note" data-relationship-explanation role="note">${escapeHTML(RELATIONSHIP_COPY.explanation[type])}</p>
    <div class="relationship-groups">${groups}</div>
  </div>${sheetActionDockHTML({ context: 'relationship', className: 'relationship-action-dock', primaryLabel: '完成', secondaryLabel: '取消', primaryAttributes: { 'data-action': 'capture-relation-save', 'data-disabled-visual': String(!splitValid) }, secondaryAttributes: { 'data-action': 'capture-relation-cancel' }, primaryDisabledVisual: !splitValid })}${drawer}`;
}

function syncRelationShares() {
  return relationDraft.customShares;
}

function bindRelationshipSheet(sheet) {
  const rerenderDrawer = ({ focusSelector = '[data-inline-split-key="7"]', centerActive = false } = {}) => {
    rerenderRelationshipSheet({ focusSelector, centerActive });
  };
  const closeDrawer = ({ apply = false } = {}) => {
    if (!relationDrawer) return false;
    const triggerParticipantId = relationDrawer.triggerParticipantId;
    if (apply) {
      if (!commitInlineSplitExpression(relationDrawer)) {
        rerenderDrawer({ focusSelector: '[data-inline-split-feedback]' });
        return false;
      }
      relationDraft.customShares = { ...relationDrawer.shares };
      relationDraft.error = '';
    }
    relationDrawer = null;
    rerenderRelationshipSheet({ focusSelector: `[data-split-allocation="${CSS.escape(triggerParticipantId)}"]` });
    return true;
  };
  sheet.querySelectorAll('[data-split-allocation]').forEach((button) => {
    button.addEventListener('click', () => {
      const participantId = button.dataset.splitAllocation;
      if (relationDrawer) {
        if (!switchInlineSplitParticipant(relationDrawer, participantId)) {
          rerenderDrawer({ focusSelector: '[data-inline-split-feedback]' });
          return;
        }
        rerenderDrawer({ focusSelector: '[data-inline-split-key="7"]', centerActive: true });
        return;
      }
      let totalMinor = 0;
      try { totalMinor = moneyStringToMinor(cap.amount || '0'); } catch { /* Capture validation remains authoritative. */ }
      relationDrawer = createInlineSplitDraft({
        participantIds: relationDraft.splitParticipantIds,
        sharesMinor: relationDraft.customShares,
        activeParticipantId: participantId,
        triggerParticipantId: participantId,
      });
      relationDrawer.totalMinor = totalMinor;
      relationDrawer.isOpening = true;
      relationDrawer.lockedScrollTop = null;
      rerenderDrawer({ centerActive: true });
    });
  });
  sheet.querySelectorAll('[data-inline-split-key]').forEach((button) => {
    button.addEventListener('click', () => {
      pressInlineSplitKey(relationDrawer, button.dataset.inlineSplitKey);
      rerenderDrawer({ focusSelector: `[data-inline-split-key="${CSS.escape(button.dataset.inlineSplitKey)}"]` });
    });
  });
  sheet.querySelector('[data-inline-split-collapse]')?.addEventListener('click', () => closeDrawer());
  sheet.querySelector('[data-inline-split-apply]')?.addEventListener('click', () => closeDrawer({ apply: true }));

  relationKeydownCleanup?.();
  const keydown = (event) => {
    if (!relationDrawer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      closeDrawer();
      return;
    }
    if (event.target.closest('[data-split-allocation]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const current = relationDrawer.ids.indexOf(relationDrawer.activeId);
      const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      const nextId = relationDrawer.ids[(current + delta + relationDrawer.ids.length) % relationDrawer.ids.length];
      if (!switchInlineSplitParticipant(relationDrawer, nextId)) rerenderDrawer({ focusSelector: '[data-inline-split-feedback]' });
      else rerenderDrawer({ focusSelector: `[data-split-allocation="${CSS.escape(nextId)}"]`, centerActive: true });
    }
  };
  sheet.addEventListener('keydown', keydown);
  relationKeydownCleanup = () => sheet.removeEventListener('keydown', keydown);
  const ledgerRow = sheet.querySelector('[data-picker-field="ledger"]');
  ledgerRow?.addEventListener('click', () => {
    syncRelationShares();
    openPickerSheet({
      title: '对象或群组',
      selectedValue: relationDraft.ledgerId,
      options: data.getRelationshipLedgers().map((ledger) => ({ value: ledger.ledgerId, label: ledger.title, caption: ledger.derivedType === 'group' ? `${ledger.participantIds.length} 位成员` : '个人', avatar: ledger.title.slice(0, 1) })),
      trigger: ledgerRow,
      onSelect: (value) => { syncRelationLedger(value); rerenderRelationshipSheet(); },
    });
  });
  const payerRow = sheet.querySelector('[data-picker-field="payer"]');
  payerRow?.addEventListener('click', () => {
    syncRelationShares();
    const ledger = relationLedger();
    openPickerSheet({
      title: '谁付款',
      selectedValue: relationDraft.payerParticipantId,
      options: ledger.participantIds.map((id) => ({ value: id, label: id === ME ? '我付款' : `${participantName(id)} 付款`, avatar: (id === ME ? '我' : participantName(id)).slice(0, 1) })),
      trigger: payerRow,
      onSelect: (value) => { relationDraft.payerParticipantId = value; rerenderRelationshipSheet(); },
    });
  });
  const counterpartyRow = sheet.querySelector('[data-picker-field="counterparty"]');
  counterpartyRow?.addEventListener('click', () => {
    const ledger = relationLedger();
    openPickerSheet({
      title: relationDraft.entryType === 'direct_receivable' ? '谁欠我' : '我欠谁',
      selectedValue: relationDraft.participantId,
      options: ledger.participantIds.filter((id) => id !== ME).map((id) => ({ value: id, label: participantName(id), avatar: participantName(id).slice(0, 1) })),
      trigger: counterpartyRow,
      onSelect: (value) => { relationDraft.participantId = value; rerenderRelationshipSheet(); },
    });
  });
}

function openCaptureRelationship() {
  if (relationSheet?.isConnected) return;
  syncForm();
  const body = sheetEl?.querySelector('.sheet-body');
  relationReturn = { scrollTop: body?.scrollTop || 0, focus: sheetEl?.querySelector('[data-action="capture-relationship"]') };
  relationDraft = structuredClone(cap.relationship || { entryType: 'normal', ledgerId: data.getRelationshipLedgers()[0]?.ledgerId, payerParticipantId: ME, participantId: null, splitMode: 'equal', splitParticipantIds: [], customShares: {}, error: '' });
  relationDrawer = null;
  relationDraft.error = '';
  syncRelationLedger(relationDraft.ledgerId);
  relationSheet = openSheet({ id: 'capture-relationship', title: '关系账', className: 'capture-relationship-sheet', contentHTML: relationshipSheetHTML(), stacked: true, onClose: () => {
    relationKeydownCleanup?.();
    relationKeydownCleanup = null;
    relationDrawer = null;
    relationSheet = null;
    requestAnimationFrame(() => {
      const parentBody = sheetEl?.querySelector('.sheet-body');
      if (parentBody) parentBody.scrollTop = relationReturn?.scrollTop || 0;
      (sheetEl?.querySelector('[data-action="capture-relationship"]') || relationReturn?.focus)?.focus?.({ preventScroll: true });
    });
  } });
  bindRelationshipSheet(relationSheet);
}

function rerenderRelationshipSheet({ focusSelector = '', centerActive = false } = {}) {
  syncRelationLedger(relationDraft.ledgerId);
  if (!relationSheet?.isConnected) {
    openCaptureRelationship();
  } else {
    const body = relationSheet.querySelector('.sheet-body');
    const scrollTop = body?.scrollTop || 0;
    body.innerHTML = relationshipSheetHTML();
    relationSheet.classList.toggle('has-inline-split-drawer', Boolean(relationDrawer));
    body.scrollTop = relationDrawer?.lockedScrollTop ?? scrollTop;
  }
  bindRelationshipSheet(relationSheet);
  requestAnimationFrame(() => {
    if (relationDrawer && relationDrawer.lockedScrollTop == null) {
      const body = relationSheet?.querySelector('.sheet-body');
      const splitGroup = relationSheet?.querySelector('.relationship-split-group');
      if (body && splitGroup) {
        const targetTop = body.scrollTop + splitGroup.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
        body.scrollTop = Math.max(0, targetTop);
        relationDrawer.lockedScrollTop = body.scrollTop;
      }
    }
    if (centerActive && relationDrawer) {
      relationSheet?.querySelector(`[data-split-allocation="${CSS.escape(relationDrawer.activeId)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
    if (focusSelector) relationSheet?.querySelector(focusSelector)?.focus?.({ preventScroll: true });
    if (relationDrawer) relationDrawer.isOpening = false;
  });
}

function relationShares(amountMinor) {
  const relation = cap.relationship;
  if (relation.entryType !== 'split_expense') return undefined;
  const selected = relation.splitParticipantIds;
  if (relation.splitMode === 'custom') {
    return selected.map((participantId) => ({ participantId, amountMinor: Number(relation.customShares?.[participantId] || 0) }));
  }
  const shares = equalSplitMinor(amountMinor, selected);
  return selected.map((participantId) => ({ participantId, amountMinor: shares[participantId] }));
}

function chooseCapacityAccount() {
  const options = data.getAccounts().filter((account) => cap.mode !== 'transfer' || account.type !== 'cc').map((account) => ({ value: account.id, label: account.name, caption: accountSummary(account) }));
  openPickerSheet({ title: cap.mode === 'transfer' ? '更换转出账户' : '更换支出账户', options, selectedValue: cap.accountId, onSelect: (accountId) => { cap.accountId = accountId; if (cap.destinationAccountId === accountId) cap.destinationAccountId = options.find((option) => option.value !== accountId)?.value; rerender(); } });
}

function save(capacityAuthorization = null) {
  let amountMinor;
  const expressionState = inspectMoneyExpression(cap.amount, { allowZero: true });
  if (expressionState.error && cap.amount) return captureError('请先完成算式', '[data-capture-calculator]');
  try { amountMinor = moneyStringToMinor(cap.amount); } catch (error) { return captureError(error.message || '先输入金额'); }
  if (!amountMinor) return captureError('先输入金额');
  const amount = amountMinor / 100;
  if (saving) return;
  syncForm();
  if (cap.mode === 'transfer' && cap.accountId === cap.destinationAccountId) return captureError('转出和转入账户不能相同');
  saving = true;
  const saveButton = sheetEl.querySelector('[data-action="cap-save"]'); if (saveButton) saveButton.disabled = true;
  const category = cap.catId ? data.getCategory(cap.catId) : null;
  const attachmentIds = draftAttachments().map((attachment) => attachment.attachmentId);
  let item;
  try {
    const draft = {
      kind: cap.mode, amount, catId: cap.catId || (cap.mode === 'transfer' ? 'transfer-fallback' : defaultCategoryId(cap.mode)),
      catLabel: cap.mode === 'transfer' && !cap.catId ? '转账' : category?.name,
      sourceAccountId: cap.mode === 'income' ? null : cap.accountId,
      destinationAccountId: cap.mode === 'income' ? cap.accountId : cap.mode === 'transfer' ? cap.destinationAccountId : null,
      desc: cap.desc.trim() || (cap.mode === 'transfer' ? '账户转账' : category?.name), date: cap.date, time: cap.time,
      recordOnly: cap.recordOnly, aa: false,
      attachmentIds, submissionKey: cap.submissionKey, capacityAuthorization,
    };
    if (cap.mode === 'expense' && cap.relationship) {
      const ledger = data.getRelationshipLedger(cap.relationship.ledgerId);
      item = data.recordRelationshipEntry({
        ledgerId: ledger.ledgerId, entryType: cap.relationship.entryType,
        participantId: cap.relationship.participantId || ledger.participantIds.find((id) => id !== ME),
        payerParticipantId: cap.relationship.payerParticipantId,
        shares: relationShares(amountMinor), amount, description: draft.desc,
        catId: draft.catId, catLabel: draft.catLabel || category?.name,
        sourceAccountId: cap.accountId, recordOnly: cap.recordOnly, capacityAuthorization,
        attachmentIds, date: cap.date, time: cap.time,
        sourceChannel: 'app', clientEventId: cap.submissionKey,
      }).transaction;
    } else item = data.addTransaction(draft);
    if (attachmentIds.length) data.assignAttachmentOwner('draft', cap.submissionKey, 'transaction', item.id);
  } catch (error) {
    saving = false; if (saveButton) saveButton.disabled = false;
    if (isAccountCapacityError(error)) return openCapacityAlert({ capacity: error.capacity, context: cap.mode, onChangeAccount: chooseCapacityAccount, onApprove: (authorization) => save(authorization) });
    return toast(error.message || '无法保存这笔记录');
  }
  // Confirmation is a new presentation root, never a child of Capture. Close
  // and unregister the entire Capture branch before mounting the snapshot.
  closeAllSheets({ instant: true });
  openMoneyFlowConfirmation({
    transaction: item,
    onPresented: () => data.recordTransactionConfirmationPresented(item),
    onContinue: () => openCaptureSheet(),
    onViewRecord: () => { update({ highlightActivityId: item.id, activityMonth: item.date.slice(0, 7), activityFilter: 'all', activityQuery: '' }); navigate('activity'); },
    onDone: () => toast(`已记一笔 ${fmtRM(amount)} · ${item.desc}`),
  });
}

export function registerCaptureActions() {
  registerCategorySheetActions();
  registerAction('open-capture', () => openCaptureSheet());
  registerAction('cap-toggle-keypad', () => {});
  registerAction('cap-clear-amount', () => { cap.amount = ''; cap.completedExpression = ''; cap.error = ''; rerender(); });
  registerAction('cap-amount-key', (el) => { cap.amount = appendCaptureAmount(cap.amount, el.dataset.key); cap.completedExpression = ''; cap.error = ''; rerender(); });
  registerAction('cap-calculator-key', (el) => {
    const key = el.dataset.key;
    syncForm();
    if (key === 'C') { cap.amount = ''; cap.calculatorFresh = false; cap.completedExpression = ''; }
    else if (key === 'back') { cap.amount = cap.amount.slice(0, -1); cap.calculatorFresh = false; cap.completedExpression = ''; }
    else if (key === '=') {
      try { const completed = inspectMoneyExpression(cap.amount).expression; cap.amount = evaluateMoneyExpression(cap.amount).value; cap.calculatorFresh = true; cap.completedExpression = `${completed} =`; }
      catch { cap.error = ''; return refreshAmountUI(); }
    } else if (['+','−','×','÷'].includes(key)) {
      if (!cap.amount || /[+−×÷]$/.test(cap.amount)) return;
      cap.calculatorFresh = false; cap.completedExpression = '';
      cap.amount += key;
    } else {
      if (cap.calculatorFresh) { cap.amount = ''; cap.calculatorFresh = false; }
      cap.completedExpression = '';
      const tail = cap.amount.split(/[+−×÷]/).at(-1) || '';
      if (key === '.' && tail.includes('.')) return;
      if (tail.includes('.') && tail.split('.')[1].length >= 2) return;
      cap.amount += key;
    }
    cap.error = '';
    refreshAmountUI();
  });
  registerAction('cap-open-calculator', () => openMoneyCalculatorSheet({ value: cap.amount, onComplete: (value) => { cap.amount = value; rerender(); } }));
  registerAction('cap-mode', (el) => {
    syncForm(); cap.mode = el.dataset.mode; cap.catId = defaultCategoryId(cap.mode);
    const cash = data.getAccounts().filter((account) => account.type !== 'cc');
    if (cap.mode !== 'expense' && data.getAccount(cap.accountId)?.type === 'cc') cap.accountId = cash[0].id;
    if (cap.mode === 'income') cap.accountId = cash[0].id;
    if (cap.destinationAccountId === cap.accountId) cap.destinationAccountId = cash.find((account) => account.id !== cap.accountId)?.id;
    if (cap.mode !== 'expense') cap.relationship = null;
    rerender();
  });
  registerAction('cap-cat', (el) => { cap.catId = el.dataset.cat || null; rerender(); });
  registerAction('cap-category-more', () => { syncForm(); openCategoryPicker({ type: cap.mode, selectedId: cap.catId, onSelect: (id) => { cap.catId = id; openCaptureSheet({ preserve: true }); }, onBack: () => openCaptureSheet({ preserve: true }) }); });
  registerAction('cap-acc', (el) => { cap.accountId = el.dataset.acc; rerender(); });
  registerAction('cap-source', (el) => { cap.accountId = el.dataset.acc; if (cap.destinationAccountId === cap.accountId) cap.destinationAccountId = data.getAccounts().find((account) => account.type !== 'cc' && account.id !== cap.accountId)?.id; rerender(); });
  registerAction('cap-destination', (el) => { if (el.dataset.acc === cap.accountId) return toast('转出和转入账户不能相同'); cap.destinationAccountId = el.dataset.acc; rerender(); });
  registerAction('cap-open-details', () => { syncForm(); cap.detailsOpen = !cap.detailsOpen; rerender(); });
  registerAction('cap-toggle-record-only', () => { cap.recordOnly = !cap.recordOnly; rerender(); });
  registerAction('cap-edit-amount', () => { syncForm(); cap.detailsOpen = false; rerender(); requestAnimationFrame(() => sheetEl?.querySelector('[data-capture-primary]')?.scrollIntoView?.({ block: 'start' })); });
  registerAction('capture-relationship', openCaptureRelationship);
  registerAction('capture-relation-mode', (el) => { syncRelationShares(); relationDraft.entryType = el.dataset.type; rerenderRelationshipSheet(); });
  registerAction('capture-split-mode', (el) => {
    syncRelationShares(); relationDraft.splitMode = el.dataset.mode; relationDraft.error = '';
    if (relationDraft.splitMode === 'custom') {
      let totalMinor = 0; try { totalMinor = moneyStringToMinor(cap.amount || '0'); } catch { /* handled when saving */ }
      relationDraft.customShares = rebuildSplitShares({ totalMinor, participantIds: relationDraft.splitParticipantIds, previous: relationDraft.customShares, initializeEqual: !Object.keys(relationDraft.customShares || {}).length });
    }
    rerenderRelationshipSheet();
  });
  registerAction('capture-split-member', (el) => {
    syncRelationShares();
    const id = el.dataset.participant;
    const set = new Set(relationDraft.splitParticipantIds);
    if (set.has(id)) { if (set.size <= 1) return toast('至少保留一位分摊参与者'); set.delete(id); } else set.add(id);
    relationDraft.splitParticipantIds = relationLedger().participantIds.filter((memberId) => set.has(memberId));
    relationDraft.customShares = rebuildSplitShares({ totalMinor: moneyStringToMinor(cap.amount || '0'), participantIds: relationDraft.splitParticipantIds, previous: relationDraft.customShares });
    relationDraft.error = '';
    rerenderRelationshipSheet();
  });
  registerAction('capture-split-even', () => { relationDraft.customShares = equalSplitMinor(moneyStringToMinor(cap.amount || '0'), relationDraft.splitParticipantIds); relationDraft.error = ''; rerenderRelationshipSheet(); });
  registerAction('capture-split-remainder', () => { try { relationDraft.customShares = applyRemainderToLast(moneyStringToMinor(cap.amount || '0'), relationDraft.splitParticipantIds, relationDraft.customShares); relationDraft.error = ''; rerenderRelationshipSheet(); } catch (error) { toast(error.message); } });
  registerAction('capture-split-clear', () => { relationDraft.customShares = Object.fromEntries(relationDraft.splitParticipantIds.map((id) => [id, 0])); relationDraft.error = ''; rerenderRelationshipSheet(); });
  registerAction('capture-relation-save', () => {
    syncRelationShares();
    if (relationDraft.entryType === 'split_expense' && !relationDraft.splitParticipantIds.length) return toast('至少选择一位分摊参与者');
    if (relationDraft.entryType === 'split_expense' && relationDraft.splitMode === 'custom') {
      const summary = allocationSummary(moneyStringToMinor(cap.amount || '0'), relationDraft.customShares, relationDraft.splitParticipantIds);
      if (!summary.exact) {
        const acceptedRemainingCopy = `还需分配 ${formatMoneyMinor(summary.remainingMinor)}`;
        const acceptedExcessCopy = `已超出 ${formatMoneyMinor(summary.overMinor)}`;
        relationDraft.error = summary.overMinor
          ? `${acceptedExcessCopy}，请调整金额`
          : `${acceptedRemainingCopy.replace('还需分配', '还差')}，请完成分配`;
        rerenderRelationshipSheet();
        const reduceMotion = document.documentElement.dataset.reducedMotion === 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() => {
          const status = relationSheet?.querySelector('[data-split-summary]');
          status?.focus?.({ preventScroll: true });
          status?.scrollIntoView?.({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
        });
        return;
      }
    }
    cap.relationship = relationDraft.entryType === 'normal' ? null : structuredClone(relationDraft);
    closeSheet(); rerender();
  });
  registerAction('capture-relation-cancel', () => closeSheet());
  registerAction('capture-relation-add-person', () => openSheet({ title: '添加对象', stacked: true, contentHTML: '<label class="cap-field"><span class="caption">名称</span><input data-capture-new-person maxlength="30" placeholder="例如 Alex" /></label><button class="sheet-primary" data-action="capture-relation-add-person-confirm">添加</button><button class="sheet-secondary" data-action="capture-relation-cancel">取消</button>' }));
  registerAction('capture-relation-add-person-confirm', () => { try { const person = data.createManualParticipant({ displayName: document.querySelector('[data-capture-new-person]').value }); const ledger = data.createRelationshipLedger({ title: person.displayName, participantIds: [ME, person.participantId], ownerUserId: 'user-winner' }); syncRelationLedger(ledger.ledgerId); closeSheet(); rerenderRelationshipSheet(); } catch (error) { toast(error.message); } });
  registerAction('cap-save', () => save());
}
