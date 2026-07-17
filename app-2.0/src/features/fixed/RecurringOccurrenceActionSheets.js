import { escapeHTML, fmtDateMY, fmtRM } from '../../app/format.js';
import { data, registerAction, ui, update } from '../../app/state.js';
import { createRecurringActionDraft } from '../../domain/recurringActionIdentity.js';
import { deriveRecurringOccurrenceActions } from '../../domain/recurringOccurrenceActions.js';
import { buildRecurringPostingPreview } from '../../domain/recurringPostingPreview.js';
import {
  maskDuitNowValue,
  maskPaymentAccount,
  paymentMethodDestination,
  paymentMethodSnapshot,
  RECIPIENT_PAYMENT_METHOD_TYPES,
  selectRecipientPaymentProfile,
} from '../../domain/recipientPaymentProfiles.js';
import {
  PAYMENT_PATHS,
  resolveSourceAccountAppCapability,
  cleanPaymentAmountClipboard,
  createBrowserBankAppLauncher,
  createClipboardAdapter,
  createPaymentHandoffSession,
  createReturnFromBankWatcher,
  paymentReferenceFor,
  presentationMetadataForPath,
} from '../../domain/paymentHandoff.js';
import { closeSheet, openSheet, toast } from '../../components/AppSheet.js';
import { attachmentSummaryHTML, bindAttachmentField } from '../../components/AttachmentField.js';
import { icon } from '../../components/Icons.js';
import { openMoneyFlowConfirmation } from '../../components/MoneyFlowConfirmation.js';
import { openMoneyCalculatorSheet } from '../../components/MoneyCalculatorSheet.js';
import { openPickerSheet } from '../../components/PickerSheet.js';
import { openRecordDetailOverlay } from '../../components/RecordDetailOverlay.js';
import {
  openRecipientPaymentProfileEditor,
  openRecipientPaymentProfileManager,
  openRecipientPaymentMethodPicker,
  registerRecipientPaymentProfileSheets,
} from './RecipientPaymentProfileSheets.js';

let session = null;
let sessionSequence = 0;
const clipboard = createClipboardAdapter();
const bankLauncher = createBrowserBankAppLauncher();

const MANUAL_OUTBOUND_ACTIONS = new Set([
  'prepare_shared_front_payment',
  'prepare_counterparty_repayment',
  'prepare_subscription_repayment',
  'prepare_installment_repayment',
  'prepare_central_outward_payment',
]);

function canonicalKey(source) {
  return typeof source === 'string' ? source : `${source.sourceType}:${source.sourceId}`;
}

function participantName(id) {
  return data.getParticipant(id)?.displayName || (id === 'participant-me' ? '我' : '关系对象');
}

function accountName(id) {
  return data.getAccount(id)?.name || '未选择账户';
}

function occurrenceFor(source, occurrenceId) {
  return data.getCanonicalRecurringPlanOccurrences(source, data.today).find((row) => row.id === occurrenceId) || null;
}

function withLocalAmount(occurrence) {
  if (!session || !Number.isInteger(session.amountMinor)) return occurrence;
  return { ...occurrence, actualAmountMinor: session.amountMinor, amountPending: false, amountState: 'actual', totalAmountMinor: session.amountMinor };
}

function currentActions() {
  const occurrence = withLocalAmount(session.occurrence);
  return deriveRecurringOccurrenceActions({
    plan: session.plan,
    occurrence,
    actorId: session.actorId,
    participantName,
  });
}

function actionAmount(action) {
  if (!action || action.actionType === 'preview_skip_occurrence') return null;
  if (Number.isInteger(session.amountMinor)) return session.amountMinor;
  const { plan, occurrence } = session;
  if (action.actionType === 'prepare_installment_repayment') {
    return Math.min(Number(plan.relationship?.installmentAmountMinor || occurrence.totalAmountMinor || 0), Number(plan.relationship?.remainingPrincipalMinor || 0));
  }
  if (action.actionType === 'prepare_member_receipt' && action.memberId) {
    const share = plan.relationship?.shares?.find((row) => row.participantId === action.memberId)?.amountMinor;
    if (Number.isInteger(share) && share > 0) return share;
  }
  if (['prepare_counterparty_repayment', 'prepare_subscription_repayment'].includes(action.actionType)) {
    return Number(occurrence.payableMinor || occurrence.ownShareMinor || occurrence.totalAmountMinor || 0);
  }
  return Number(occurrence.totalAmountMinor || plan.totalAmountMinor || 0);
}

function selectedAction() {
  const actions = currentActions();
  const exact = actions.find((action) => action.actionId === session.actionId && action.enabled);
  if (exact) return exact;
  const preferred = actions.find((action) => action.enabled && !['fill_occurrence_amount', 'preview_skip_occurrence'].includes(action.actionType));
  return preferred || actions.find((action) => action.enabled) || actions[0] || null;
}

function sourceAccountOptions(action) {
  const incoming = action?.expectedMoneyDirection === 'inflow';
  return data.getAccounts()
    .filter((account) => incoming ? account.type !== 'cc' : true)
    .map((account) => ({
      value: account.id,
      label: account.name,
      caption: account.type === 'cc'
        ? `信用卡 · 当前欠款 ${fmtRM(account.outstanding, { privacy: ui.privacy })}`
        : `可用余额 ${fmtRM(account.balance, { privacy: ui.privacy })}`,
    }));
}

function setDefaultAccount(action) {
  if (!action?.requiresSourceAccount || session.sourceAccountId) return;
  const options = sourceAccountOptions(action);
  const preferred = options.find((option) => option.value === session.plan.paymentSourceAccountId);
  session.sourceAccountId = (preferred || options[0])?.value || null;
  session.payerAccountId = session.sourceAccountId;
}

function recipientProfile(action = selectedAction()) {
  return selectRecipientPaymentProfile({
    plan: session?.plan,
    action,
    profileId: session?.recipientProfileId,
    repository: {
      get: (id) => data.getRecipientPaymentProfile(id),
      findDefault: (participantId) => data.getDefaultRecipientPaymentProfile(participantId),
    },
  });
}

function recipientIdentity(action = selectedAction()) {
  return data.getRecipientIdentityForPlan(session?.plan)
    || (action?.counterpartyId ? { recipientId: action.counterpartyId, displayName: participantName(action.counterpartyId), kind: 'relationship_person' } : null);
}

function isManualOutbound(action, profile = recipientProfile(action)) {
  if (!action || !String(action.expectedMoneyDirection).includes('outflow')) return false;
  if (MANUAL_OUTBOUND_ACTIONS.has(action.actionType)) return true;
  return action.actionType === 'prepare_owned_payment'
    && session?.plan?.planKind !== 'subscription'
    && Boolean(profile);
}

function directActionLabel(action) {
  if (action?.actionType === 'preview_skip_occurrence') return '跳过本期';
  if (action?.actionType === 'prepare_member_receipt' || action?.expectedMoneyDirection === 'inflow') return '已经收到';
  if (session?.plan?.planKind === 'subscription' && action?.actionType === 'prepare_owned_payment') return '已经扣款';
  return '直接记录';
}

function recipientOwnerId(action) {
  return recipientIdentity(action)?.recipientId || null;
}

function recipientMethods(action = selectedAction()) {
  const ownerParticipantId = recipientOwnerId(action);
  if (!ownerParticipantId) return recipientProfile(action) ? [recipientProfile(action)] : [];
  return data.getRecipientPaymentProfiles({ recipientId: ownerParticipantId });
}

function paymentPathHTML(action) {
  const profile = recipientProfile(action);
  if (!isManualOutbound(action, profile)) {
    return `<button type="button" class="sheet-primary occurrence-preview-button" data-action="recurring-action-direct">${directActionLabel(action)}</button>`;
  }
  const missing = !profile;
  return `${missing ? `<section class="recipient-profile-missing surface"><div><strong>尚未设置收款资料</strong><small>添加后可复制账号并尝试打开银行 App。</small></div><button type="button" data-action="recurring-recipient-add">添加收款资料</button></section>` : ''}
    <div class="occurrence-payment-paths" aria-label="选择记录方式">
      ${profile ? '<button type="button" class="sheet-primary" data-action="recurring-action-go-pay">去付款</button>' : ''}
      <button type="button" class="${profile ? 'sheet-secondary' : 'sheet-primary'}" data-action="recurring-action-already-paid">我已经付好了</button>
    </div>`;
}

function amountLabel(action) {
  if (action?.actionType === 'preview_skip_occurrence') return '不涉及金额';
  const amount = actionAmount(action);
  return Number.isInteger(amount) && amount > 0 ? fmtRM(amount / 100, { privacy: ui.privacy }) : '待填写';
}

function actionChoiceHTML(action, selected) {
  const context = action.memberId ? participantName(action.memberId) : action.counterpartyId ? participantName(action.counterpartyId) : '';
  return `<button type="button" class="occurrence-action-choice${selected ? ' active' : ''}${action.enabled ? '' : ' is-disabled'}" data-action="recurring-action-select" data-action-id="${escapeHTML(action.actionId)}" ${action.enabled ? '' : 'disabled'} aria-pressed="${selected}">
    <span>${icon(action.expectedMoneyDirection === 'inflow' ? 'arrowDown' : action.expectedMoneyDirection.includes('outflow') ? 'arrowUp' : 'calendar', 19)}</span>
    <div><strong>${escapeHTML(action.label)}</strong><small>${escapeHTML(action.description)}</small></div>
    ${context ? `<em>${escapeHTML(context)}</em>` : ''}${selected ? icon('check', 17) : ''}
  </button>`;
}

function actionSheetHTML() {
  const actions = currentActions();
  const action = selectedAction();
  if (action && session.actionId !== action.actionId) session.actionId = action.actionId;
  setDefaultAccount(action);
  const amount = actionAmount(action);
  const variable = session.plan.amountMode === 'variable';
  const choices = actions.filter((item) => item.enabled && (item.actionType !== 'fill_occurrence_amount' || !Number.isInteger(session.amountMinor)));
  return `<div class="occurrence-action-sheet-content" data-recurring-action-session="${escapeHTML(session.id)}">
    <section class="occurrence-action-identity surface">
      <span class="occurrence-action-mark">${icon(session.plan.planKind === 'subscription' ? 'receipt' : session.plan.relationshipMode ? 'users' : 'wallet', 24)}</span>
      <div><strong>${escapeHTML(session.plan.title)}</strong><small>${fmtDateMY(session.occurrence.dueDate)} · ${escapeHTML(action?.description || '本期处理')}</small></div>
      <b class="num">${amountLabel(action)}</b>
    </section>
    ${variable ? `<section class="occurrence-variable-amount surface">
      <div><span>本期实际金额</span><strong class="num">${Number.isInteger(session.amountMinor) ? fmtRM(session.amountMinor / 100, { privacy: ui.privacy }) : '待填写'}</strong></div>
      <button type="button" data-action="recurring-action-amount">${Number.isInteger(session.amountMinor) ? '修改金额' : '填写金额'}${icon('chevronRight', 16)}</button>
      ${session.plan.estimateAmountMinor ? `<small>参考预算 ${fmtRM(session.plan.estimateAmountMinor / 100, { privacy: ui.privacy })} · 不会改写计划</small>` : ''}
    </section>` : ''}
    ${choices.length > 1 ? `<section class="occurrence-action-choices" aria-label="本期操作">${choices.map((item) => actionChoiceHTML(item, item.actionId === action?.actionId)).join('')}</section>` : ''}
    ${action?.requiresSourceAccount ? `<section class="occurrence-action-field surface"><span>账户</span><button type="button" data-action="recurring-action-account"><strong>${escapeHTML(accountName(session.sourceAccountId))}</strong><small>${action.expectedMoneyDirection === 'inflow' ? '预计入账账户' : '预计付款账户'}</small>${icon('chevronRight', 16)}</button></section>` : ''}
    ${action?.counterpartyId ? `<section class="occurrence-action-field surface"><span>关系对象</span><div><strong>${escapeHTML(participantName(action.counterpartyId))}</strong><small>来自计划的稳定关系身份</small></div></section>` : ''}
    ${action?.memberId ? `<section class="occurrence-action-field surface"><span>成员</span><div><strong>${escapeHTML(participantName(action.memberId))}</strong><small>只记录这位成员的本期付款</small></div></section>` : ''}
    <section class="occurrence-action-summary surface">
      <span><small>资金方向</small><strong>${action?.expectedMoneyDirection === 'inflow' ? '进入我的账户' : action?.expectedMoneyDirection === 'outflow_and_receivable' ? '完整付款，并形成待收' : action?.expectedMoneyDirection === 'outflow' ? '从我的账户付出' : '不产生金额变化'}</strong></span>
      <span><small>本期金额</small><strong class="num">${action?.actionType === 'preview_skip_occurrence' ? '不涉及金额' : Number.isInteger(amount) ? fmtRM(amount / 100, { privacy: ui.privacy }) : '待填写'}</strong></span>
    </section>
    ${session.error ? `<p class="occurrence-action-error" role="alert">${escapeHTML(session.error)}</p>` : ''}
    ${action && (action.actionType === 'preview_skip_occurrence' || Number.isInteger(amount))
      ? paymentPathHTML(action)
      : '<button type="button" class="sheet-primary occurrence-preview-button" disabled>请先填写本期金额</button>'}
    <button type="button" class="sheet-secondary" data-action="recurring-action-cancel">取消</button>
  </div>`;
}

function rerenderActionSheet() {
  if (!session?.sheet?.isConnected) return;
  const body = session.sheet.querySelector('.sheet-body');
  const scrollTop = body?.scrollTop || 0;
  if (body) body.innerHTML = actionSheetHTML();
  if (body) body.scrollTop = scrollTop;
}

function requestActionClose() {
  if (!session?.dirty || session.permitClose) return true;
  openSheet({
    id: `${session.id}:discard`, parentId: session.id, title: '舍弃本期处理草稿？',
    stacked: true, className: 'occurrence-action-discard-sheet',
    contentHTML: '<div class="occurrence-discard-copy"><p>本期金额或账户选择尚未确认。舍弃后不会改变计划、账期或任何余额。</p><button class="sheet-danger" data-action="recurring-action-discard">舍弃草稿</button><button class="sheet-secondary" data-action="sheet-close">继续编辑</button></div>',
  });
  return false;
}

export function openRecurringOccurrenceActionSheet({ source, occurrenceId, actionId = null, trigger = document.activeElement } = {}) {
  const key = canonicalKey(source);
  const canonical = data.getCanonicalRecurringPlan(key);
  const occurrence = occurrenceFor(key, occurrenceId);
  if (!occurrence) return null;
  const id = `recurring-action:${++sessionSequence}:${occurrence.id}`;
  session = {
    id, source: key, plan: canonical.plan, occurrence, actorId: 'participant-me',
    actionId, amountMinor: Number.isInteger(occurrence.actualAmountMinor) ? occurrence.actualAmountMinor : null,
    sourceAccountId: null, payerAccountId: null,
    recipientProfileId: canonical.plan.recipientPaymentProfileId || null,
    recipientPaymentMethodId: canonical.plan.recipientPaymentProfileId || null,
    dirty: false, permitClose: false, error: '', trigger,
    paymentPath: null, handoff: null, returnWatcher: null, assistantLayer: null,
    attachmentDraftId: `recurring-draft-${occurrence.id}-${sessionSequence}`,
    postingPending: false, posted: false,
    clientEventId: `phase2c3a-preview-${occurrence.id}-${sessionSequence}`,
  };
  const actions = currentActions();
  session.actionId = actionId || actions.find((action) => action.enabled)?.actionId || actions[0]?.actionId || null;
  const sheet = openSheet({
    id, parentId: trigger?.closest?.('.modal-layer')?.dataset.sheetId, title: '本期处理',
    stacked: true, className: 'occurrence-action-sheet', contentHTML: actionSheetHTML(),
    onRequestClose: requestActionClose,
    onClose: () => {
      if (session?.id !== id) return;
      session.returnWatcher?.dispose();
      if (!session.posted) data.getAttachments('recurring_draft', session.attachmentDraftId).forEach((item) => data.removeAttachment(item.attachmentId));
      session = null;
    },
    trigger,
  });
  session.sheet = sheet.closest('.modal-layer');
  return sheet;
}

function paymentContext() {
  const action = selectedAction();
  const profile = recipientProfile(action);
  const account = data.getAccount(session.sourceAccountId);
  const amountMinor = actionAmount(action);
  const reference = paymentReferenceFor(profile, {
    planTitle: session.plan.title,
    monthKey: session.occurrence.monthKey,
  });
  const capability = resolveSourceAccountAppCapability(account);
  return { action, profile, account, amountMinor, reference, capability };
}

function paymentAssistantHTML() {
  const { profile, account, amountMinor, reference, capability } = paymentContext();
  if (!profile) return '<div class="recipient-profile-missing"><strong>尚未设置收款资料</strong><button class="sheet-primary" data-action="recurring-recipient-add">添加收款资料</button></div>';
  const displayAmount = fmtRM(amountMinor / 100, { privacy: ui.privacy });
  const methods = recipientMethods();
  const isDuitNow = profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW;
  const destinationLabel = isDuitNow ? `DuitNow · ${profile.duitNowType}` : '银行账号';
  const destination = isDuitNow ? maskDuitNowValue(profile.duitNowValue, { hidden: ui.privacy }) : maskPaymentAccount(profile.accountNumber, { hidden: ui.privacy });
  return `<div class="payment-assistant-content">
    <section class="payment-assistant-direction surface">
      <span>${icon('arrowUp', 22)}</span><div><small>资金方向</small><strong>${escapeHTML(account?.name || '付款账户')} → ${escapeHTML(profile.displayName)}</strong></div>
    </section>
    <section class="payment-assistant-source surface">
      <span class="payment-assistant-method-icon">${icon('wallet', 20)}</span>
      <span><small>付款来源</small><strong>${escapeHTML(account?.name || '未选择账户')}</strong></span>
      <button type="button" data-action="payment-source-picker" aria-label="切换付款来源">${icon('chevronRight', 16)}</button>
    </section>
    <section class="payment-assistant-recipient surface">
      <button type="button" class="payment-assistant-method span-all" data-action="payment-method-picker" ${methods.length > 1 ? '' : 'aria-disabled="true"'}>
        <span class="payment-assistant-method-icon">${icon(isDuitNow ? 'phone' : 'wallet', 20)}</span>
        <span><small>收款方式${profile.isDefaultForParticipant ? ' · 默认' : ''}</small><strong>${escapeHTML(profile.nickname || profile.bankDisplayName || 'DuitNow')} · ${escapeHTML(profile.accountHolderName)}</strong></span>
        ${methods.length > 1 ? icon('chevronRight', 16) : ''}
      </button>
      <div class="span-all payment-assistant-copy-row"><span><small>${escapeHTML(destinationLabel)}</small><strong class="num">${escapeHTML(destination)}</strong></span><button type="button" data-action="payment-handoff-copy" data-copy-field="account" aria-label="${isDuitNow ? '复制 DuitNow 资料' : '复制银行账号'}">${icon('copy', 17)}</button></div>
      <div class="span-all payment-assistant-copy-row"><span><small>本期金额</small><strong class="num">${displayAmount}</strong></span><button type="button" data-action="payment-handoff-copy" data-copy-field="amount" aria-label="复制金额">${icon('copy', 17)}</button></div>
      ${reference ? `<div class="span-all payment-assistant-reference"><small>付款参考</small><strong>${escapeHTML(reference)}</strong></div>` : ''}
    </section>
    <section class="payment-assistant-evidence surface"><div><strong>付款凭证（可选）</strong><small>转账截图、收据、发票或 PDF</small></div>${attachmentSummaryHTML('recurring_draft', session?.attachmentDraftId || '', { label: '付款凭证', evidenceOnly: true })}</section>
    ${capability.available ? `<button type="button" class="sheet-primary payment-bank-launch" data-action="payment-handoff-launch">${escapeHTML(capability.actionLabel)}</button>` : ''}
    <button type="button" class="sheet-secondary" data-action="payment-handoff-complete">我已经完成付款</button>
    <button type="button" class="sheet-secondary" data-action="payment-handoff-later">稍后记录</button>
    <button type="button" class="payment-profile-edit" data-action="recurring-recipient-manage">管理收款资料</button>
    <button type="button" class="sheet-secondary" data-action="payment-handoff-cancel">取消</button>
    <p class="payment-assistant-note">打开银行 App 不代表付款完成；完成后仍由你亲自确认。</p>
  </div>`;
}

function rerenderPaymentAssistant() {
  const body = session?.assistantLayer?.querySelector('.sheet-body');
  if (body) {
    body.innerHTML = paymentAssistantHTML();
    bindAttachmentField(body, { onChange: () => { if (session) session.dirty = true; } });
  }
}

function openReturnPrompt() {
  if (!session?.handoff?.markReturnPrompt()) return;
  openSheet({
    id: `${session.id}:payment-return`,
    parentId: `${session.id}:payment-assistant`,
    title: '转账完成了吗？',
    className: 'payment-return-sheet',
    stacked: true,
    contentHTML: `<div class="payment-return-content">
      <p>RinggitMe 不会自动判断银行转账结果，请按实际情况选择。</p>
      <button type="button" class="sheet-primary" data-action="payment-return-complete">我已经完成付款</button>
      <button type="button" class="sheet-secondary" data-action="payment-return-incomplete">还没完成</button>
      <button type="button" class="sheet-secondary" data-action="payment-return-later">稍后记录</button>
    </div>`,
  });
}

function openPaymentAssistant(trigger) {
  const context = paymentContext();
  if (!context.profile) {
    session.error = '尚未设置收款资料';
    rerenderActionSheet();
    return;
  }
  session.paymentPath = PAYMENT_PATHS.HANDOFF;
  session.handoff = createPaymentHandoffSession({
    sessionId: `${session.id}:payment-assistant`,
    paymentPath: PAYMENT_PATHS.HANDOFF,
    actionType: context.action.actionType,
    occurrenceId: session.occurrence.id,
    profileId: context.profile.profileId,
    sourceAccountId: session.sourceAccountId,
    recipientPaymentMethodId: context.profile.profileId,
    payerAccountId: session.sourceAccountId,
  });
  session.returnWatcher?.dispose();
  session.returnWatcher = createReturnFromBankWatcher({ onReturn: openReturnPrompt });
  const sheet = openSheet({
    id: `${session.id}:payment-assistant`,
    parentId: session.id,
    title: '付款助手',
    className: 'payment-assistant-sheet',
    stacked: true,
    trigger,
    contentHTML: paymentAssistantHTML(),
    onClose: () => {
      if (!session) return;
      session.assistantLayer = null;
      session.returnWatcher?.dispose();
      session.returnWatcher = null;
    },
  });
  session.assistantLayer = sheet.closest('.modal-layer');
  bindAttachmentField(session.assistantLayer, { onChange: () => { if (session) session.dirty = true; } });
}

function previewSection(title, content, empty = '没有变化') {
  return `<section class="posting-preview-section surface"><h3>${escapeHTML(title)}</h3>${content || `<p class="caption">${escapeHTML(empty)}</p>`}</section>`;
}

function effectAmount(effect) {
  return fmtRM(Number(effect.amountMinor || 0) / 100, { privacy: ui.privacy });
}

function occurrenceTransitionCopy(effect) {
  const from = effect.fromStatus;
  const skipped = effect.toStatus === 'skipped';
  if (from === 'overdue') return skipped
    ? '本期将由“已逾期”变为“已跳过”'
    : '本期将由“已逾期”变为“已完成”';
  return skipped ? '本期将标记为已跳过' : '本期将标记为已完成';
}

function previewValidationMessage(entry) {
  if (entry.code === 'IDEMPOTENCY_CONFLICT') return '这笔记录与之前的操作不一致，请先返回检查。';
  if (entry.code === 'IDEMPOTENCY_REPLAY') return '这笔操作已经处理过，无需重复记账。';
  return entry.message;
}

function previewHTML(preview) {
  const transaction = preview.effects.transactions[0];
  const records = transaction
    ? `<div class="posting-preview-row"><span>${icon(transaction.transactionKind === 'income' ? 'arrowDown' : 'receipt', 18)}<strong>${escapeHTML(transaction.title)}</strong></span><b class="num">${fmtRM(transaction.amountMinor / 100, { privacy: ui.privacy })}</b></div>`
    : preview.action.actionType === 'preview_skip_occurrence' ? '<p>只预览跳过本期，不建立交易。</p>' : '<p>只确认本期金额，不建立交易。</p>';
  const accounts = preview.effects.accounts.map((effect) => {
    const changeLabel = effect.accountKind === 'credit_card'
      ? (effect.direction === 'inflow' ? '预计减少欠款' : '预计增加欠款')
      : (effect.direction === 'inflow' ? '预计增加' : '预计扣除');
    return `<div class="posting-preview-effect posting-preview-account-effect"><strong>${escapeHTML(accountName(effect.accountId))}</strong><div>${effect.beforeMinor != null && effect.afterMinor != null ? `<span class="num">${fmtRM(effect.beforeMinor / 100, { privacy: ui.privacy })} → ${fmtRM(effect.afterMinor / 100, { privacy: ui.privacy })}</span>` : ''}<small>${changeLabel} ${effectAmount(effect)}</small></div></div>`;
  }).join('');
  const relationships = preview.effects.relationships.map((effect) => {
    const who = participantName(effect.memberId || effect.counterpartyId);
    const label = effect.effectType === 'receivable_increase' ? `${who}将欠我`
      : effect.effectType === 'member_obligation_reduction' ? `${who}本期应交减少`
        : effect.effectType === 'member_collection_state_unchanged' ? '成员收款状态保持独立'
          : `${who}的往来余额减少`;
    return `<div class="posting-preview-effect"><strong>${escapeHTML(label)}</strong><span class="num">${effect.amountMinor ? fmtRM(effect.amountMinor / 100, { privacy: ui.privacy }) : '不改变'}</span></div>`;
  }).join('');
  const installments = preview.effects.installments.map((effect) => `<div class="posting-preview-effect"><strong>剩余本金</strong><span class="num">${fmtRM(effect.beforePrincipalMinor / 100, { privacy: ui.privacy })} → ${fmtRM(effect.afterPrincipalMinor / 100, { privacy: ui.privacy })}</span></div>`).join('');
  const occurrence = preview.effects.occurrences.map((effect) => `<div class="posting-preview-effect"><strong>${effect.effectType === 'occurrence_amount_preview' ? '本期实际金额' : '本期状态'}</strong><span>${effect.effectType === 'occurrence_amount_preview' ? fmtRM(effect.actualAmountMinor / 100, { privacy: ui.privacy }) : escapeHTML(occurrenceTransitionCopy(effect))}</span></div>`).join('');
  const error = preview.validation.valid ? '' : `<div class="posting-preview-invalid" role="alert"><strong>无法生成预览</strong>${preview.validation.errors.map((entry) => `<span>${escapeHTML(previewValidationMessage(entry))}</span>`).join('')}</div>`;
  return `<div class="posting-preview-content">
    ${error}
    ${previewSection('这次会记录什么', records)}
    ${previewSection('账户变化', accounts)}
    ${previewSection('关系账变化', relationships)}
    ${previewSection('分期变化', installments)}
    ${previewSection('本期状态', occurrence)}
    <section class="posting-preview-attachments surface">
      <div class="posting-preview-attachments-title"><strong>附件 / 凭证（可选）</strong><small>转账截图、收据、发票或银行确认</small></div>
      ${attachmentSummaryHTML('recurring_draft', session?.attachmentDraftId || '', { label: '附件 / 凭证', evidenceOnly: true })}
    </section>
    <p class="posting-preview-readonly">确认前不会改变账户余额、关系账或本期状态。</p>
    <button type="button" class="sheet-primary" data-action="recurring-posting-confirm" ${session?.postingPending ? 'disabled aria-busy="true"' : ''}>${session?.postingPending ? '正在记账…' : '确认记账'}</button>
    <button type="button" class="sheet-secondary" data-action="sheet-close">返回本期处理</button>
  </div>`;
}

function buildPreview() {
  const action = selectedAction();
  if (!action) return null;
  const amountMinor = actionAmount(action);
  const account = session.sourceAccountId ? data.getAccount(session.sourceAccountId) : null;
  const draft = createRecurringActionDraft({
    action, plan: session.plan, occurrence: session.occurrence, actorId: session.actorId,
    amountMinor, sourceAccountId: action.requiresSourceAccount ? session.sourceAccountId : null,
    sourceAccountKind: action.requiresSourceAccount ? account?.type || null : null,
    counterpartyId: action.counterpartyId, groupId: session.plan.relationship?.ledgerId || null,
    memberId: action.memberId, occurredAt: `${data.today}T09:00:00+08:00`,
    clientEventId: session.clientEventId,
  });
  return buildRecurringPostingPreview({
    actionDraft: draft, plan: session.plan, occurrence: session.occurrence,
    accounts: data.getAccounts(), actorId: session.actorId, participantName,
  });
}

function openPreview(path = PAYMENT_PATHS.ALREADY_PAID) {
  const paymentPath = typeof path === 'string' ? path : PAYMENT_PATHS.ALREADY_PAID;
  const preview = buildPreview();
  if (!preview) return;
  if (!preview.validation.valid) {
    session.error = preview.validation.errors.map((entry) => entry.message).join('；');
    rerenderActionSheet();
    return;
  }
  session.paymentPath = paymentPath;
  session.presentationMetadata = presentationMetadataForPath(paymentPath, session.handoff?.snapshot());
  const context = paymentContext();
  session.paymentMethodSnapshot = paymentMethodSnapshot(context.profile, {
    recipientId: recipientOwnerId(context.action),
    reference: context.reference,
  });
  session.payerAccountId = session.sourceAccountId;
  session.recipientPaymentMethodId = context.profile?.profileId || null;
  session.frozenPreview = preview;
  const sheet = openSheet({
    id: `${session.id}:preview`, parentId: session.id, title: '记账预览', stacked: true,
    className: 'posting-preview-sheet', contentHTML: previewHTML(preview),
  });
  bindAttachmentField(sheet, { onChange: () => { session.dirty = true; } });
}

function postingResultHTML(result, { reversed = false } = {}) {
  const preview = result.preview;
  const transaction = result.transactionId ? data.getTransaction(result.transactionId) : null;
  const account = preview.effects.accounts[0];
  const relationship = preview.effects.relationships[0];
  const installment = preview.effects.installments[0];
  const occurrence = preview.effects.occurrences.find((effect) => effect.effectType === 'occurrence_state_preview');
  const relationCopy = relationship?.effectType === 'receivable_increase'
    ? `新增待收 ${effectAmount(relationship)}`
    : ['payable_reduction', 'receivable_reduction'].includes(relationship?.effectType)
      ? `往来余额减少 ${effectAmount(relationship)}` : '没有关系账变化';
  return `<div class="recurring-posting-result${reversed ? ' is-reversed' : ''}">
    <section class="recurring-posting-result-hero surface">
      <span>${icon(reversed ? 'undo' : 'check', 28)}</span>
      <div><small>${reversed ? '已安全撤销' : '记账成功'}</small><strong>${escapeHTML(preview.snapshots.plan.title)}</strong></div>
      <b class="num">${preview.action.actionType === 'preview_skip_occurrence' ? '无金额变化' : fmtRM(result.amountMinor / 100, { privacy: ui.privacy })}</b>
    </section>
    <section class="recurring-posting-result-list surface">
      <div><span>记录</span><strong>${transaction ? (reversed ? '原记录已标记撤销' : '已建立 1 笔交易') : '没有建立交易'}</strong></div>
      <div><span>账户</span><strong>${account ? (reversed ? '已恢复原余额' : `${account.direction === 'inflow' ? '增加' : '减少'} ${effectAmount(account)}`) : '没有金额变化'}</strong></div>
      <div><span>关系账</span><strong>${reversed && relationship ? '已恢复原往来余额' : relationCopy}</strong></div>
      <div><span>分期</span><strong>${installment ? (reversed ? '剩余本金已恢复' : `剩余 ${fmtRM(installment.afterPrincipalMinor / 100, { privacy: ui.privacy })}`) : '没有分期变化'}</strong></div>
      <div><span>本期</span><strong>${reversed ? '已恢复为可处理状态' : occurrence?.toStatus === 'skipped' ? '已跳过' : '已完成'}</strong></div>
      <div><span>附件</span><strong>${result.attachmentCount ? `${result.attachmentCount} 个凭证` : '没有附件'}</strong></div>
    </section>
    ${transaction ? `<button type="button" class="sheet-secondary" data-action="recurring-posting-view" data-transaction-id="${escapeHTML(transaction.id)}">查看记录</button>` : ''}
    ${!reversed ? `<button type="button" class="sheet-danger" data-action="recurring-posting-reverse-request" data-posting-id="${escapeHTML(result.postingId)}">撤销这次记账</button>` : ''}
    <button type="button" class="sheet-primary" data-action="recurring-posting-done">完成</button>
  </div>`;
}

function openPostingResultSheet(result, options = {}) {
  return openSheet({
    id: `recurring-posting-result:${result.postingId}:${options.reversed ? 'reversed' : 'posted'}`,
    title: options.reversed ? '撤销完成' : '本期已记录',
    className: 'recurring-posting-result-sheet',
    contentHTML: postingResultHTML(result, options),
  });
}

function presentPostingSuccess(result, transaction) {
  const reveal = () => openPostingResultSheet(result);
  if (!transaction?.confirmation) return reveal();
  return openMoneyFlowConfirmation({
    transaction,
    confirmation: transaction.confirmation,
    onPresented: () => data.recordTransactionConfirmationPresented?.(transaction),
    onContinue: reveal,
    onViewRecord: reveal,
    onDone: reveal,
  });
}

function confirmPosting(button) {
  if (!session || session.postingPending || !session.frozenPreview) return;
  session.postingPending = true;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = '正在记账…';
  const activeSession = session;
  const attachmentIds = data.getAttachments('recurring_draft', activeSession.attachmentDraftId).map((item) => item.attachmentId);
  try {
    const result = data.executeRecurringOccurrencePosting({
      planId: activeSession.plan.id,
      occurrenceId: activeSession.occurrence.id,
      actionDraft: activeSession.frozenPreview.action,
      expectedPlanRevision: activeSession.plan.revision,
      expectedOccurrenceRevision: activeSession.occurrence.revision,
      confirmedAt: `${data.today}T09:00:00+08:00`,
      attachmentDraftId: activeSession.attachmentDraftId,
      attachmentIds,
      enteredVariableAmountMinor: activeSession.amountMinor,
      selectedAccountId: activeSession.sourceAccountId,
      payerAccountId: activeSession.sourceAccountId,
      recipientPaymentMethodId: activeSession.recipientProfileId,
      paymentMethodSnapshot: activeSession.paymentMethodSnapshot,
    });
    activeSession.posted = true;
    const transaction = result.transactionId ? data.getTransaction(result.transactionId) : null;
    closeSheet(true);
    activeSession.permitClose = true;
    closeSheet(true);
    update({});
    presentPostingSuccess(result, transaction);
  } catch (error) {
    activeSession.postingPending = false;
    activeSession.error = error.message || '记账未完成，任何余额都没有改变。';
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = '确认记账';
    toast(activeSession.error);
  }
}

export function registerRecurringOccurrenceActionSheets() {
  registerRecipientPaymentProfileSheets();
  registerAction('fixed-occurrence-action', (el, event) => {
    event?.preventDefault();
    event?.stopPropagation();
    openRecurringOccurrenceActionSheet({ source: el.dataset.source, occurrenceId: el.dataset.occurrenceId, actionId: el.dataset.actionId, trigger: el });
  });
  registerAction('recurring-action-select', (el) => { if (!session) return; session.actionId = el.dataset.actionId; session.sourceAccountId = null; session.payerAccountId = null; session.dirty = true; session.error = ''; rerenderActionSheet(); });
  registerAction('recurring-action-account', (el) => {
    if (!session) return;
    const action = selectedAction();
    openPickerSheet({
      id: `${session.id}:account`, parentId: session.id, title: action?.expectedMoneyDirection === 'inflow' ? '选择入账账户' : '选择付款账户',
      options: sourceAccountOptions(action), selectedValue: session.sourceAccountId, trigger: el,
      onSelect: (value) => { session.sourceAccountId = value; session.payerAccountId = value; session.dirty = true; session.error = ''; rerenderActionSheet(); },
    });
  });
  registerAction('recurring-action-amount', (el) => {
    if (!session) return;
    openMoneyCalculatorSheet({
      id: `${session.id}:amount`, parentId: session.id, trigger: el,
      value: Number.isInteger(session.amountMinor) ? (session.amountMinor / 100).toFixed(2) : '',
      onComplete: (_value, result) => {
        session.amountMinor = result.minor;
        session.actionId = null;
        session.sourceAccountId = null;
        session.payerAccountId = null;
        session.dirty = true;
        session.error = '';
        rerenderActionSheet();
      },
    });
  });
  registerAction('recurring-action-preview', () => openPreview(PAYMENT_PATHS.ALREADY_PAID));
  registerAction('recurring-action-direct', () => openPreview(PAYMENT_PATHS.ALREADY_PAID));
  registerAction('recurring-action-already-paid', () => openPreview(PAYMENT_PATHS.ALREADY_PAID));
  registerAction('recurring-action-go-pay', (el) => openPaymentAssistant(el));
  registerAction('payment-source-picker', (el) => {
    if (!session) return;
    const action = selectedAction();
    openPickerSheet({
      id: `${session.id}:payment-source`,
      parentId: el.closest('.modal-layer')?.dataset.sheetId,
      title: '选择付款来源',
      options: sourceAccountOptions(action),
      selectedValue: session.sourceAccountId,
      trigger: el,
      onSelect: (value) => {
        session.sourceAccountId = value;
        session.payerAccountId = value;
        session.handoff?.setRouting({ payerAccountId: value, recipientPaymentMethodId: session.recipientProfileId });
        session.dirty = true;
        rerenderActionSheet();
        rerenderPaymentAssistant();
      },
    });
  });
  registerAction('recurring-posting-confirm', (el) => confirmPosting(el));
  registerAction('recurring-posting-view', (el) => {
    closeSheet(true);
    openRecordDetailOverlay(el.dataset.transactionId, { originView: 'recurring-posting-result' });
  });
  registerAction('recurring-posting-reverse-request', (el) => {
    const posting = data.getRecurringOccurrencePosting(el.dataset.postingId);
    if (!posting || posting.status === 'reversed') return;
    openSheet({
      id: `recurring-posting-reverse:${posting.postingId}`,
      parentId: el.closest('.modal-layer')?.dataset.sheetId,
      title: '撤销这次记账？', stacked: true,
      className: 'recurring-posting-reverse-sheet',
      contentHTML: `<div class="recurring-posting-reverse-copy"><p>账户、关系账、分期与本期状态会按原始记账结果完整恢复。原记录及附件会保留作为审计记录。</p><button type="button" class="sheet-danger" data-action="recurring-posting-reverse-confirm" data-posting-id="${escapeHTML(posting.postingId)}">确认撤销</button><button type="button" class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
    });
  });
  registerAction('recurring-posting-reverse-confirm', (el) => {
    try {
      const result = data.reverseRecurringOccurrencePosting(el.dataset.postingId, { reason: '用户撤销', reversedAt: `${data.today}T09:05:00+08:00` });
      closeSheet(true);
      closeSheet(true);
      update({});
      openPostingResultSheet(result, { reversed: true });
    } catch (error) {
      toast(error.message || '当前状态无法安全撤销。');
    }
  });
  registerAction('recurring-posting-done', () => closeSheet());
  registerAction('recurring-recipient-add', (el) => {
    if (!session) return;
    const action = selectedAction();
    const ownerParticipantId = recipientOwnerId(action);
    const identity = recipientIdentity(action);
    if (ownerParticipantId) {
      openRecipientPaymentProfileManager({
        recipientId: ownerParticipantId,
        displayName: identity?.displayName || participantName(ownerParticipantId),
        parentId: el.closest('.modal-layer')?.dataset.sheetId || session.id,
        trigger: el,
        onChange: (profile) => {
          const selected = data.getDefaultRecipientPaymentProfile(ownerParticipantId) || profile;
          session.recipientProfileId = selected?.profileId || null;
          session.recipientPaymentMethodId = session.recipientProfileId;
          session.handoff?.setRouting({ payerAccountId: session.sourceAccountId, recipientPaymentMethodId: session.recipientProfileId });
          session.dirty = true;
          rerenderActionSheet();
          rerenderPaymentAssistant();
        },
      });
      return;
    }
    openRecipientPaymentProfileEditor({
      recipientId: ownerParticipantId,
      ownerParticipantId,
      displayName: identity?.displayName || (action?.counterpartyId ? participantName(action.counterpartyId) : ''),
      parentId: el.closest('.modal-layer')?.dataset.sheetId || session.id,
      trigger: el,
      onSave: (profile) => {
        session.recipientProfileId = profile.profileId;
        session.recipientPaymentMethodId = profile.profileId;
        session.handoff?.setRouting({ payerAccountId: session.sourceAccountId, recipientPaymentMethodId: profile.profileId });
        session.dirty = true;
        rerenderActionSheet();
        rerenderPaymentAssistant();
      },
    });
  });
  registerAction('recurring-recipient-edit', (el) => {
    if (!session) return;
    const profile = recipientProfile();
    if (!profile) return;
    openRecipientPaymentProfileEditor({
      profileId: profile.profileId,
      parentId: el.closest('.modal-layer')?.dataset.sheetId || session.id,
      trigger: el,
      onSave: () => {
        rerenderActionSheet();
        rerenderPaymentAssistant();
      },
    });
  });
  registerAction('recurring-recipient-manage', (el) => {
    if (!session) return;
    const action = selectedAction();
    const ownerParticipantId = recipientOwnerId(action);
    const identity = recipientIdentity(action);
    if (!ownerParticipantId) return;
    openRecipientPaymentProfileManager({
      recipientId: ownerParticipantId,
      displayName: identity?.displayName || participantName(ownerParticipantId),
      parentId: el.closest('.modal-layer')?.dataset.sheetId || session.id,
      trigger: el,
      onChange: () => {
        const current = data.getRecipientPaymentProfile(session.recipientProfileId);
        const selected = current || data.getDefaultRecipientPaymentProfile(ownerParticipantId);
        session.recipientProfileId = selected?.profileId || null;
        session.recipientPaymentMethodId = session.recipientProfileId;
        session.handoff?.setRouting({ payerAccountId: session.sourceAccountId, recipientPaymentMethodId: session.recipientProfileId });
        rerenderActionSheet();
        rerenderPaymentAssistant();
      },
    });
  });
  registerAction('payment-method-picker', (el) => {
    if (!session) return;
      const action = selectedAction();
    const ownerParticipantId = recipientOwnerId(action);
    if (!ownerParticipantId || recipientMethods(action).length < 2) return;
    openRecipientPaymentMethodPicker({
      recipientId: ownerParticipantId,
      selectedProfileId: recipientProfile(action)?.profileId,
      parentId: el.closest('.modal-layer')?.dataset.sheetId,
      trigger: el,
      onSelect: (profile) => {
        session.recipientProfileId = profile.profileId;
        session.recipientPaymentMethodId = profile.profileId;
        session.handoff?.setRouting({ payerAccountId: session.sourceAccountId, recipientPaymentMethodId: profile.profileId });
        session.dirty = true;
        rerenderPaymentAssistant();
      },
    });
  });
  registerAction('payment-handoff-copy', async (el) => {
    if (!session?.handoff) return;
    const { profile, amountMinor, reference } = paymentContext();
    const field = el.dataset.copyField;
    const payload = field === 'account'
      ? (profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? profile.duitNowValue : profile.accountNumber)
      : field === 'amount' ? cleanPaymentAmountClipboard(amountMinor)
        : reference;
    const result = await clipboard.writeText(payload);
    if (!session?.handoff) return;
    if (result.ok) {
      session.handoff.markCopied(field);
      const original = el.innerHTML;
      const originalLabel = el.getAttribute('aria-label') || '';
      el.classList.add('is-copied');
      el.setAttribute('aria-label', `${originalLabel}，已复制`);
      el.innerHTML = `${icon('check', 15)}<span>已复制</span>`;
      setTimeout(() => {
        if (!el.isConnected) return;
        el.classList.remove('is-copied');
        el.setAttribute('aria-label', originalLabel);
        el.innerHTML = original;
      }, 1300);
      toast(field === 'account'
        ? (profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? 'DuitNow 资料已复制' : '账号已复制')
        : field === 'amount' ? '金额已复制' : '参考已复制');
    } else {
      toast('未能复制，请长按资料手动复制。');
    }
  });
  registerAction('payment-handoff-launch', () => {
    if (!session?.handoff) return;
    const { capability } = paymentContext();
    if (!capability.available) return;
    const result = bankLauncher.launch(capability.capabilityId);
    session.handoff.markLaunch(result, `${data.today}T09:00:00+08:00`);
    session.returnWatcher?.arm({ assumeBackground: false });
    if (!result.opened) {
      toast('未能自动打开，请手动打开银行 App。付款资料已保留。');
      setTimeout(() => session?.returnWatcher?.simulateReturnForTest(), 120);
    }
  });
  registerAction('payment-handoff-complete', () => {
    if (!session?.handoff) return;
    session.handoff.markCompletedByUser();
    closeSheet(true);
    openPreview(PAYMENT_PATHS.HANDOFF);
  });
  registerAction('payment-handoff-later', () => closeSheet());
  registerAction('payment-handoff-cancel', () => closeSheet());
  registerAction('payment-return-complete', () => {
    if (!session?.handoff) return;
    session.handoff.markCompletedByUser();
    closeSheet(true);
    closeSheet(true);
    openPreview(PAYMENT_PATHS.HANDOFF);
  });
  registerAction('payment-return-incomplete', () => closeSheet());
  registerAction('payment-return-later', () => {
    closeSheet(true);
    closeSheet();
  });
  registerAction('recurring-action-cancel', () => closeSheet());
  registerAction('recurring-action-discard', () => {
    if (!session) return;
    closeSheet(true);
    session.permitClose = true;
    closeSheet();
  });
}

export const recurringOccurrenceActionSheetsTestHooks = Object.freeze({
  actionAmount,
  previewHTML,
  actionChoiceHTML,
  occurrenceTransitionCopy,
  previewValidationMessage,
  isManualOutbound,
  directActionLabel,
});
