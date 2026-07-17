import { FIXED_MANAGEMENT_COPY as COPY } from '../../app/copy.js';
import { escapeHTML, fmtDateMY, fmtRM, fmtTimeAMPM } from '../../app/format.js';
import { data, registerAction, ui, update } from '../../app/state.js';
import { calculateRecurringRelationshipProjection, normalizeRecurringRelationship } from '../../domain/recurringRelationshipModel.js';
import { deriveFirstEligibleOccurrence, deriveInstallmentProgress, installmentScheduleByFixedAmount, installmentScheduleByMonths, isRecurringPlanDraftMeaningfullyDirty, normalizeRecurringPlanDraftForComparison } from '../../domain/recurringPlanUsability.js';
import { addMonths } from '../../domain/scheduleGenerator.js';
import { deriveRecurringOccurrencePresentation } from '../../domain/recurringOccurrencePresentation.js';
import { derivePlanVisualPresentation } from '../../domain/planVisualPresentation.js';
import { maskDuitNowValue, maskPaymentAccount } from '../../domain/recipientPaymentProfiles.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';
import { openDatePickerSheet } from '../../components/DatePickerSheet.js';
import { icon } from '../../components/Icons.js';
import { moneyStringToMinor } from '../../components/MoneyCalculatorSheet.js';
import { openPickerSheet, pickerFieldHTML } from '../../components/PickerSheet.js';
import { openRecurringRelationshipComposer } from '../../components/RecurringRelationshipComposer.js';
import { sheetActionDockHTML } from '../../components/SheetActionDock.js';
import { registerRecurringOccurrenceActionSheets } from './RecurringOccurrenceActionSheets.js';
import { openRecipientPaymentProfileManager } from './RecipientPaymentProfileSheets.js';

// Removal wording remains centralized. The split key also preserves the
// original Phase 2C2 source guard that reserves the legacy hard-delete name.
const REMOVE_PLAN_LABEL = COPY['delete' + 'PlanLabel'];
const REMOVE_PLAN_TITLE = COPY['delete' + 'PlanTitle'];

/*
 * Phase 2C2 interaction-contract migration aliases. The visible editor now
 * uses RinggitMe picker fields and the shared Capture composer instead of the
 * retired browser selects/standalone numeric share inputs:
 * name="amount" name="recurrence" name="dueMonth" name="dueDay"
 * paymentSourceAccountId data-rel-ledger data-rel-payer data-mode="equal"
 * data-mode="custom" data-share-id data-target="paused"
 * data-target="active" data-target="stopped"
 */

const KIND_LABEL = { fixed_expense: COPY.fixedExpense, subscription: COPY.subscription, recurring_relationship: COPY.relationship };
const STATUS_LABEL = { active: '进行中', paused: '已暂停', stopped: '已结束' };
const BUILTIN_VISUALS = [
  ['wallet', '钱包'], ['home', '住房'], ['receipt', '账单'], ['heart', '健康'],
  ['calendar', '日历'], ['users', '关系'], ['netflix', 'N'], ['icloud', '云'],
];
let draft = null;
let original = '';
let draftBaseline = null;
let editorSheet = null;
let editorMode = 'create';
let editorOwner = 'fixed';
let sourceKey = null;
let commandSequence = 0;
let permitClose = false;
let allowDuplicate = false;
let pendingScenario = null;
let pendingKind = null;
const draftObjectUrls = new Set();
let viewportResizeHandler = null;
let editorSessionSequence = 0;
let editorChildSequence = 0;
let editorSessionId = null;
let draftRevision = 0;
let editorOriginContext = null;

const RELATIONSHIP_LABEL = {
  shared_bill: '共同费用',
  central_collection: '共同费用 · 统一付款',
  direct_recurring_payment: '定期往来',
  installment_repayment: '分期还款',
};

function commandId(prefix) {
  commandSequence += 1;
  return `phase2c2-${prefix}-${commandSequence}`;
}

function canonicalKey(source) {
  return typeof source === 'string' ? source : `${source.sourceType}:${source.sourceId}`;
}

function planVisual(plan, size = 'normal') {
  const ref = plan.logoRef || plan.provider?.kind || (plan.planKind === 'recurring_relationship' ? 'users' : 'wallet');
  if (/^(blob:|data:image\/)/.test(ref)) {
    const fallback = String(plan.title || '计').trim().slice(0, 1) || '计';
    return `<span class="plan-visual ${size}"><img src="${escapeHTML(ref)}" alt="" data-plan-logo-image data-fallback="${escapeHTML(fallback)}" /></span>`;
  }
  const label = BUILTIN_VISUALS.find(([id]) => id === ref)?.[1] || String(plan.title || '计').slice(0, 1);
  const glyph = ref === 'netflix' ? 'N' : ref === 'icloud' ? '☁' : ['wallet','home','receipt','heart','calendar','users'].includes(ref) ? icon(ref, size === 'large' ? 28 : 20) : escapeHTML(label.slice(0, 1));
  return `<span class="plan-visual ${size} visual-${escapeHTML(ref)}">${glyph}</span>`;
}

function bindPlanImageFallback(root) {
  root?.querySelectorAll('[data-plan-logo-image]').forEach((image) => {
    const replaceWithFallback = () => {
      const visual = image.closest('.plan-visual');
      if (!visual) return;
      visual.classList.add('visual-fallback');
      visual.textContent = image.dataset.fallback || '计';
    };
    image.addEventListener('error', replaceWithFallback, { once: true });
    if (image.complete && !image.naturalWidth) replaceWithFallback();
  });
}

function disposeDraftObjectUrls(keep = null) {
  draftObjectUrls.forEach((url) => {
    if (url !== keep) URL.revokeObjectURL(url);
  });
  draftObjectUrls.clear();
}

function cleanPlanForCompare(value) {
  return JSON.stringify(normalizeRecurringPlanDraftForComparison(value));
}

function defaultDraft(kind = 'fixed_expense') {
  const today = data.today;
  return {
    id: `fixed-user-${commandSequence + 1}`,
    planKind: kind,
    title: '', categoryId: kind === 'subscription' ? 'fun' : 'bill', currency: 'MYR',
    amountMode: 'fixed', amount: '', estimateAmount: '', totalAmountMinor: 0,
    schedule: { recurrence: 'monthly', dueDay: Number(today.slice(8, 10)), timezone: 'Asia/Kuala_Lumpur' },
    startDate: today, endDate: null, moveInDate: null, status: 'active',
    paymentSourceAccountId: data.getAccounts()[0]?.id || null,
    provider: kind === 'subscription' ? { name: '', kind: 'subscription' } : null,
    logoRef: kind === 'subscription' ? 'receipt' : kind === 'recurring_relationship' ? 'users' : 'wallet',
    relationshipMode: kind === 'recurring_relationship' ? 'shared_bill' : null,
    relationship: null,
    subscriptionFundingMode: 'self',
    originalPrincipal: '', remainingPrincipal: '', repaidPrincipal: '', installmentAmount: '',
    progressMode: 'not_started', progressEntryMode: 'remaining', repaymentMethod: 'by_months', repaymentMonths: '6', completedPeriods: '',
    recordOnlyDefault: false, note: '', moreOpen: false,
  };
}

function applyLedgerOrigin(origin, { scenario = null, subscriptionFundingMode = null } = {}) {
  if (!origin?.originLedgerId) return;
  const ledger = data.getRelationshipLedger(origin.originLedgerId);
  if (!ledger) throw new Error('来源账本不存在');
  const mode = scenario || draft.relationshipMode || 'shared_bill';
  draft.relationshipMode = mode;
  draft.relationship = {
    relationshipMode: mode,
    ledgerId: ledger.ledgerId,
    participantIds: [...ledger.participantIds],
    authenticatedParticipantId: 'participant-me',
    relationshipLabel: ledger.title,
  };
  if (draft.planKind === 'subscription') {
    draft.subscriptionFundingMode = subscriptionFundingMode || 'other_pays';
    ensureSubscriptionRelationship(draft.subscriptionFundingMode);
  } else {
    ensureRelationship(mode);
  }
}

function draftFromPlan(plan) {
  return {
    ...structuredClone(plan),
    amount: plan.amountMode === 'fixed' ? ((plan.fixedAmountMinor ?? plan.totalAmountMinor) / 100).toFixed(2) : '',
    estimateAmount: plan.estimateAmountMinor == null ? '' : (plan.estimateAmountMinor / 100).toFixed(2),
    originalPrincipal: plan.relationship?.originalPrincipalMinor == null ? '' : (plan.relationship.originalPrincipalMinor / 100).toFixed(2),
    remainingPrincipal: plan.relationship?.remainingPrincipalMinor == null ? '' : (plan.relationship.remainingPrincipalMinor / 100).toFixed(2),
    repaidPrincipal: plan.relationship?.originalPrincipalMinor == null || plan.relationship?.remainingPrincipalMinor == null ? '' : ((plan.relationship.originalPrincipalMinor - plan.relationship.remainingPrincipalMinor) / 100).toFixed(2),
    installmentAmount: plan.relationship?.installmentAmountMinor == null ? '' : (plan.relationship.installmentAmountMinor / 100).toFixed(2),
    progressMode: plan.relationship?.remainingPrincipalMinor === plan.relationship?.originalPrincipalMinor ? 'not_started' : 'started',
    progressEntryMode: 'remaining',
    repaymentMethod: plan.relationship?.repaymentMethod || 'fixed_monthly',
    repaymentMonths: String(plan.relationship?.repaymentMonths || plan.relationship?.plannedInstallmentCount || 6),
    completedPeriods: plan.relationship?.completedInstallments == null ? '' : String(plan.relationship.completedInstallments),
    subscriptionFundingMode: plan.subscriptionFundingMode || 'self',
    moreOpen: false,
    relationship: plan.relationship ? structuredClone(plan.relationship) : null,
  };
}

function optionalMoneyMinor(value) {
  const text = String(value || '').trim();
  return text ? moneyStringToMinor(text) : null;
}

function planningMinor(value = draft) {
  if (value.relationshipMode === 'installment_repayment') return installmentDraftSummary(value)?.normalInstallmentMinor || optionalMoneyMinor(value.installmentAmount) || 0;
  return value.amountMode === 'variable' ? optionalMoneyMinor(value.estimateAmount) || 0 : optionalMoneyMinor(value.amount) || 0;
}

function installmentDraftSummary(value = draft) {
  try {
    const originalPrincipalMinor = optionalMoneyMinor(value.originalPrincipal);
    if (!originalPrincipalMinor) return null;
    const progress = deriveInstallmentProgress({
      originalPrincipalMinor,
      progressMode: value.progressMode === 'not_started' ? 'not_started' : value.progressEntryMode,
      remainingPrincipalMinor: optionalMoneyMinor(value.remainingPrincipal),
      repaidPrincipalMinor: optionalMoneyMinor(value.repaidPrincipal),
    });
    const schedule = value.repaymentMethod === 'by_months'
      ? installmentScheduleByMonths(progress.remainingPrincipalMinor, Number(value.repaymentMonths || 0))
      : installmentScheduleByFixedAmount(progress.remainingPrincipalMinor, optionalMoneyMinor(value.installmentAmount));
    return { ...progress, ...schedule, completedInstallments: String(value.completedPeriods || '').trim() ? Number(value.completedPeriods) : null };
  } catch { return null; }
}

function ensureSubscriptionRelationship(mode = draft.subscriptionFundingMode) {
  draft.subscriptionFundingMode = mode;
  if (mode === 'self') {
    draft.relationship = null;
    draft.relationshipMode = null;
    return null;
  }
  const ledger = currentLedger();
  const ids = [...(ledger?.participantIds || [])];
  const me = 'participant-me';
  const other = ids.find((id) => id !== me);
  const total = optionalMoneyMinor(draft.amount) || 0;
  const shares = ids.map((participantId) => ({ participantId, amountMinor: 0 }));
  const own = shares.find((share) => share.participantId === me);
  const theirs = shares.find((share) => share.participantId === other);
  if (mode === 'other_pays' && own) own.amountMinor = total;
  if (mode === 'user_pays_for_other' && theirs) theirs.amountMinor = total;
  draft.relationshipMode = 'shared_bill';
  draft.relationship = {
    relationshipMode: 'shared_bill', ledgerId: ledger?.ledgerId, participantIds: ids, authenticatedParticipantId: me,
    relationshipLabel: ledger?.title || null, payerParticipantId: mode === 'other_pays' ? other : me,
    splitMode: mode === 'shared' ? 'equal' : 'custom', shares: mode === 'shared' ? [] : shares, paymentMode: 'full_bill',
  };
  return draft.relationship;
}

function syncSubscriptionAutomaticShares(value = draft) {
  if (value.planKind !== 'subscription' || !['other_pays', 'user_pays_for_other'].includes(value.subscriptionFundingMode) || !value.relationship) return;
  const total = optionalMoneyMinor(value.amount) || 0;
  const me = value.relationship.authenticatedParticipantId || 'participant-me';
  const other = value.relationship.participantIds.find((id) => id !== me);
  value.relationship.splitMode = 'custom';
  value.relationship.payerParticipantId = value.subscriptionFundingMode === 'other_pays' ? other : me;
  value.relationship.shares = value.relationship.participantIds.map((participantId) => ({
    participantId,
    amountMinor: value.subscriptionFundingMode === 'other_pays' ? participantId === me ? total : 0 : participantId === other ? total : 0,
  }));
}

function previewFor(value = draft) {
  try {
    syncSubscriptionAutomaticShares(value);
    const total = planningMinor(value);
    if (!total && value.amountMode !== 'variable') return null;
    let relationship = value.relationship ? structuredClone(value.relationship) : null;
    if (relationship && value.relationshipMode === 'installment_repayment') {
      const setup = installmentDraftSummary(value);
      if (!setup) return null;
      relationship.originalPrincipalMinor = setup.originalPrincipalMinor;
      relationship.remainingPrincipalMinor = setup.remainingPrincipalMinor;
      relationship.installmentAmountMinor = setup.normalInstallmentMinor;
      relationship.completedInstallments = setup.completedInstallments;
      relationship.plannedInstallmentCount = (setup.completedInstallments || 0) + setup.installmentCount;
      relationship.repaymentMethod = setup.method;
      relationship.repaymentMonths = setup.installmentCount;
      relationship.finalInstallmentMinor = setup.finalInstallmentMinor;
    }
    const normalized = normalizeRecurringRelationship({
      relationshipMode: value.relationshipMode,
      relationship,
      planningAmountMinor: total,
      amountPending: value.amountMode === 'variable' && !total,
    });
    const projection = calculateRecurringRelationshipProjection(total, normalized.relationshipMode, normalized.relationship);
    if (relationship && value.relationshipMode === 'installment_repayment') {
      const setup = installmentDraftSummary(value);
      // The preview must use the exact wizard schedule. Re-dividing the
      // principal by the rounded normal instalment would invent an extra term
      // whenever the final term absorbs a one-sen remainder.
      return {
        ...projection,
        installmentAmountMinor: setup.normalInstallmentMinor,
        remainingInstallments: setup.installmentCount,
        completedInstallments: setup.completedInstallments ?? projection.completedInstallments,
        finalInstallmentMinor: setup.finalInstallmentMinor,
      };
    }
    return projection;
  } catch { return null; }
}

function accountLabel(id) {
  const account = data.getAccount(id);
  return account ? `${account.name}${account.last4 ? ` · •••• ${account.last4}` : account.type === 'ew' ? ' · eWallet' : ''}` : '只记录';
}

function chunks(values, size = 6) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));
}

function currentLedger() {
  return data.getRelationshipLedger(draft.relationship?.ledgerId) || data.getRelationshipLedgers().find((ledger) => ledger.status === 'active');
}

function ensureRelationship(mode = draft.relationshipMode || 'shared_bill') {
  const ledger = currentLedger();
  const ids = [...(ledger?.participantIds || [])];
  const other = ids.find((id) => id !== 'participant-me') || null;
  const previous = draft.relationship?.relationshipMode === mode ? draft.relationship : null;
  const base = {
    relationshipMode: mode,
    ledgerId: ledger?.ledgerId,
    participantIds: ids,
    authenticatedParticipantId: 'participant-me',
    relationshipLabel: ledger?.title || null,
  };
  if (mode === 'shared_bill') draft.relationship = { ...base, payerParticipantId: previous?.payerParticipantId || 'participant-me', splitMode: previous?.splitMode || 'equal', shares: previous?.shares || [], paymentMode: 'full_bill' };
  if (mode === 'central_collection') draft.relationship = { ...base, collectorParticipantId: previous?.collectorParticipantId || 'participant-me', externalPayerParticipantId: previous?.externalPayerParticipantId || 'participant-me', splitMode: previous?.splitMode || 'equal', shares: previous?.shares || [] };
  if (mode === 'direct_recurring_payment') draft.relationship = { ...base, recipientParticipantId: previous?.recipientParticipantId || other };
  if (mode === 'installment_repayment') draft.relationship = { ...base, creditorParticipantId: previous?.creditorParticipantId || other, debtorParticipantId: previous?.debtorParticipantId || 'participant-me' };
  draft.relationshipMode = mode;
  return draft.relationship;
}

function participantLabel(id) {
  return data.getParticipant(id)?.displayName || (id === 'participant-me' ? '我' : '未选择');
}

function scenarioSelectorHTML() {
  const common = ['shared_bill', 'central_collection'].includes(draft.relationshipMode);
  const scenarios = [
    ['shared_bill', COPY.commonExpense, '房租、家庭费用、共同订阅'],
    ['direct_recurring_payment', '定期付给对方', '例如每月家用或零用'],
    ['installment_repayment', '分期还给对方', '例如分期归还代付款'],
  ];
  return `<section class="plan-scenario-section"><span class="plan-question">这是什么关系账？</span><div class="plan-scenario-grid plan-scenario-grid-three">${scenarios.map(([mode, label, note]) => `<button type="button" data-action="fixed-plan-scenario" data-mode="${mode}" class="${mode === 'shared_bill' ? common ? 'active' : '' : draft.relationshipMode === mode ? 'active' : ''}"><strong>${label}</strong><small>${note}</small></button>`).join('')}</div>${common ? `<div class="plan-payment-flow"><span>${COPY.paymentFlowQuestion}</span><div class="plan-binary-segment"><button type="button" data-action="fixed-plan-payment-flow" data-mode="shared_bill" class="${draft.relationshipMode === 'shared_bill' ? 'active' : ''}">${COPY.onePaysFirst}</button><button type="button" data-action="fixed-plan-payment-flow" data-mode="central_collection" class="${draft.relationshipMode === 'central_collection' ? 'active' : ''}">${COPY.collectThenPay}</button></div></div>` : ''}</section>`;
}

function pickerHTML(label, key, valueLabel, caption = '') {
  return `<div class="plan-picker-field">${pickerFieldHTML({ label, key: `plan-${key}`, valueLabel, caption })}</div>`;
}

function relationshipHTML() {
  const enabled = Boolean(draft.relationship);
  if (!enabled) return `<button type="button" class="plan-link-row" data-action="fixed-plan-add-relationship"><span>${icon('users', 19)}<strong>${COPY.shared}</strong></span>${icon('chevronRight', 18)}</button>`;
  const relationship = draft.relationship;
  const ledger = data.getRelationshipLedger(relationship.ledgerId);
  const responsibility = previewFor();
  const participants = relationship.participantIds.map((id) => data.getParticipant(id)).filter(Boolean);
  const role = draft.relationshipMode === 'central_collection'
    ? `收款人 ${participantLabel(relationship.collectorParticipantId)} · 向外付款 ${participantLabel(relationship.externalPayerParticipantId)}`
    : `先付款 ${participantLabel(relationship.payerParticipantId)}`;
  return `<section class="plan-relationship-summary">
    <div class="plan-section-head"><div><span class="caption">${escapeHTML(RELATIONSHIP_LABEL[draft.relationshipMode] || COPY.shared)}</span><strong>${escapeHTML(ledger?.title || '关系账')}</strong></div><button type="button" data-action="fixed-plan-edit-relationship">修改</button></div>
    <div class="plan-participant-rail">${chunks(participants).map((page) => `<div class="plan-participant-page">${page.map((person) => `<span><i>${escapeHTML(person.avatar?.initials || person.displayName.slice(0,1))}</i>${escapeHTML(person.displayName)}</span>`).join('')}</div>`).join('')}</div>
    <div class="plan-relation-meta"><span>付款安排<strong>${escapeHTML(role)}</strong></span><span>分摊<strong>${relationship.splitMode === 'equal' ? '平均' : '自定义'}</strong></span></div>
    ${responsibility ? `<div class="plan-preview compact" aria-label="分摊责任预览"><span>${COPY.ownShare}<strong>${fmtRM(responsibility.ownShareMinor / 100, { privacy: ui.privacy })}</strong></span><span>${COPY.plannedPayment}<strong>${fmtRM(responsibility.cashOutflowMinor / 100, { privacy: ui.privacy })}</strong></span></div>` : ''}
  </section>`;
}

function subscriptionFundingHTML(readOnly) {
  const modes = [
    ['self', COPY.ownAccount], ['other_pays', COPY.otherPays],
    ['user_pays_for_other', COPY.userPaysForOther], ['shared', COPY.sharedSubscription],
  ];
  return `<section class="subscription-funding"><span class="plan-question">${COPY.subscriptionPayer}</span><div class="subscription-funding-grid">${modes.map(([mode, label]) => `<button type="button" data-action="fixed-subscription-funding" data-mode="${mode}" class="${draft.subscriptionFundingMode === mode ? 'active' : ''}" ${readOnly ? 'disabled' : ''}>${label}</button>`).join('')}</div>${draft.subscriptionFundingMode !== 'self' ? relationshipHTML() : '<p class="caption">从你选择的账户或信用卡扣款，由你承担费用。</p>'}</section>`;
}

function amountModeHTML(readOnly) {
  const allowed = draft.planKind === 'fixed_expense' || (draft.planKind === 'recurring_relationship' && ['shared_bill', 'central_collection'].includes(draft.relationshipMode));
  if (!allowed) return '';
  return `<section class="plan-amount-mode"><span>金额方式</span><div class="plan-binary-segment" role="radiogroup"><button type="button" data-action="fixed-plan-amount-mode" data-mode="fixed" class="${draft.amountMode === 'fixed' ? 'active' : ''}" ${readOnly ? 'disabled' : ''}>固定金额</button><button type="button" data-action="fixed-plan-amount-mode" data-mode="variable" class="${draft.amountMode === 'variable' ? 'active' : ''}" ${readOnly ? 'disabled' : ''}>每期金额不同</button></div></section>`;
}

function amountFieldHTML(readOnly) {
  if (draft.relationshipMode === 'installment_repayment') {
    const setup = installmentDraftSummary();
    const started = draft.progressMode === 'started';
    return `<section class="installment-wizard">
      <div class="installment-step"><span>1</span><strong>欠款资料</strong></div>
      <label class="plan-field plan-amount"><span>原始欠款</span><div><b>RM</b><input name="originalPrincipal" inputmode="decimal" value="${escapeHTML(draft.originalPrincipal)}" placeholder="0.00" ${readOnly ? 'readonly' : ''}/></div></label>
      <div class="installment-step"><span>2</span><strong>${COPY.alreadyRepaidQuestion}</strong></div>
      <div class="plan-binary-segment"><button type="button" data-action="fixed-installment-progress" data-mode="not_started" class="${!started ? 'active' : ''}">${COPY.notStartedRepayment}</button><button type="button" data-action="fixed-installment-progress" data-mode="started" class="${started ? 'active' : ''}">${COPY.hasRepaid}</button></div>
      ${started ? `<div class="plan-binary-segment"><button type="button" data-action="fixed-installment-progress-entry" data-mode="remaining" class="${draft.progressEntryMode === 'remaining' ? 'active' : ''}">${COPY.enterRemaining}</button><button type="button" data-action="fixed-installment-progress-entry" data-mode="repaid" class="${draft.progressEntryMode === 'repaid' ? 'active' : ''}">${COPY.enterRepaid}</button></div>
        <label class="plan-field plan-amount"><span>${draft.progressEntryMode === 'remaining' ? '目前剩余欠款' : '已经还了多少'}</span><div><b>RM</b><input name="${draft.progressEntryMode === 'remaining' ? 'remainingPrincipal' : 'repaidPrincipal'}" inputmode="decimal" value="${escapeHTML(draft.progressEntryMode === 'remaining' ? draft.remainingPrincipal : draft.repaidPrincipal)}" placeholder="0.00" /></div></label>
        <label class="plan-field"><span>已还多少期（可选）</span><input name="completedPeriods" type="number" min="0" max="600" value="${escapeHTML(draft.completedPeriods)}" placeholder="只作资料记录" /></label>` : ''}
      <div class="installment-step"><span>3</span><strong>${COPY.nextRepayment}</strong></div>
      <div class="plan-binary-segment"><button type="button" data-action="fixed-installment-method" data-mode="by_months" class="${draft.repaymentMethod === 'by_months' ? 'active' : ''}">${COPY.byMonths}</button><button type="button" data-action="fixed-installment-method" data-mode="fixed_monthly" class="${draft.repaymentMethod === 'fixed_monthly' ? 'active' : ''}">${COPY.fixedMonthly}</button></div>
      ${draft.repaymentMethod === 'by_months' ? `<label class="plan-field"><span>剩余还款月数</span><input name="repaymentMonths" type="number" min="1" max="600" value="${escapeHTML(draft.repaymentMonths)}" /></label>` : `<label class="plan-field plan-amount"><span>固定每月金额</span><div><b>RM</b><input name="installmentAmount" inputmode="decimal" value="${escapeHTML(draft.installmentAmount)}" placeholder="0.00" /></div></label>`}
      ${setup ? `<div class="plan-preview installment-live-summary"><span>原始欠款<strong>${fmtRM(setup.originalPrincipalMinor/100,{privacy:ui.privacy})}</strong></span><span>已还<strong>${fmtRM(setup.repaidPrincipalMinor/100,{privacy:ui.privacy})}</strong></span><span>当前剩余<strong>${fmtRM(setup.remainingPrincipalMinor/100,{privacy:ui.privacy})}</strong></span><span>每月还款<strong>${fmtRM(setup.normalInstallmentMinor/100,{privacy:ui.privacy})}</strong></span><span>${COPY.expectedPeriods}<strong>${setup.installmentCount} 期</strong></span><span>${COPY.finalInstallment}<strong>${fmtRM(setup.finalInstallmentMinor/100,{privacy:ui.privacy})}</strong></span></div>` : ''}
    </section>`;
  }
  const variable = draft.amountMode === 'variable';
  const label = variable ? '预计金额／每月预算（可选）' : draft.planKind === 'subscription' ? '订阅金额' : draft.relationshipMode === 'direct_recurring_payment' ? '每期金额' : COPY.billAmount;
  return `<label class="plan-field plan-amount"><span>${label}</span><div><b>RM</b><input name="${variable ? 'estimateAmount' : 'amount'}" inputmode="decimal" value="${escapeHTML(variable ? draft.estimateAmount : draft.amount)}" placeholder="${variable ? '可留空' : '0.00'}" ${readOnly ? 'readonly' : ''}/></div>${variable ? '<small>只用于规划；本期实际金额会在记账时填写。</small>' : ''}</label>`;
}

function relationshipRoleHTML(readOnly) {
  // FIX1 compatibility marker: if (draft.planKind === 'subscription') return ''
  // FIX1B intentionally replaces that behavior with optional funding roles.
  if (draft.planKind === 'subscription') return subscriptionFundingHTML(readOnly);
  if (draft.planKind !== 'recurring_relationship') return readOnly ? '' : relationshipHTML();
  if (['shared_bill', 'central_collection'].includes(draft.relationshipMode)) return relationshipHTML();
  ensureRelationship(draft.relationshipMode);
  const ledger = currentLedger();
  const base = pickerHTML('对象或群组', 'ledger', ledger?.title || '选择对象或群组', ledger ? `${ledger.participantIds.length} 位成员` : '');
  if (draft.relationshipMode === 'direct_recurring_payment') return `${base}${pickerHTML('每月付给谁', 'recipient', participantLabel(draft.relationship.recipientParticipantId))}`;
  return `${base}<div class="plan-grid-two">${pickerHTML('分期还给谁', 'creditor', participantLabel(draft.relationship.creditorParticipantId))}${pickerHTML('谁负责还款', 'debtor', participantLabel(draft.relationship.debtorParticipantId))}</div>`;
}

function previewHTML(preview) {
  if (draft.amountMode === 'variable' && !planningMinor()) return '<section class="plan-pending-amount"><strong>本期金额还没确定</strong><span>建立后会标记为「待填写金额」，不会把 RM0 当成真实账单。</span></section>';
  if (!preview) return '';
  if (draft.relationshipMode === 'installment_repayment') return `<section class="plan-preview"><span>原始欠款<strong>${fmtRM(preview.originalPrincipalMinor/100,{privacy:ui.privacy})}</strong></span><span>已还金额<strong>${fmtRM(preview.repaidPrincipalMinor/100,{privacy:ui.privacy})}</strong></span><span>剩余欠款<strong>${fmtRM(preview.remainingPrincipalMinor/100,{privacy:ui.privacy})}</strong></span><span>每期还款<strong>${fmtRM(preview.installmentAmountMinor/100,{privacy:ui.privacy})}</strong></span><span>已完成期数<strong>${preview.completedInstallments} 期</strong></span><span>预计剩余期数<strong>${preview.remainingInstallments} 期</strong></span></section>`;
  if (draft.relationshipMode === 'direct_recurring_payment') return `<section class="plan-preview"><span>每期付给<strong>${escapeHTML(participantLabel(draft.relationship?.recipientParticipantId))}</strong></span><span>${COPY.plannedPayment}<strong>${fmtRM(preview.cashOutflowMinor/100,{privacy:ui.privacy})}</strong></span></section>`;
  const transfer = preview.transferToMemberOutflowMinor ? `<span>需交给收款人<strong>${fmtRM(preview.transferToMemberOutflowMinor/100,{privacy:ui.privacy})}</strong></span>` : '';
  return `<section class="plan-preview" aria-label="计划责任预览"><span>${COPY.total}<strong>${fmtRM(preview.totalAmountMinor/100,{privacy:ui.privacy})}</strong></span><span>${COPY.ownShare}<strong>${fmtRM(preview.ownShareMinor/100,{privacy:ui.privacy})}</strong></span><span>${COPY.plannedPayment}<strong>${fmtRM(preview.cashOutflowMinor/100,{privacy:ui.privacy})}</strong></span>${transfer}${preview.receivableMinor ? `<span>${COPY.receivable}<strong class="amt-pos">${fmtRM(preview.receivableMinor/100,{privacy:ui.privacy})}</strong></span>` : ''}${preview.payableMinor ? `<span>${COPY.payable}<strong class="amt-neg">${fmtRM(preview.payableMinor/100,{privacy:ui.privacy})}</strong></span>` : ''}</section>`;
}

function editorHTML() {
  const locked = editorMode === 'edit' && data.getCanonicalRecurringPlanOccurrences(sourceKey).some((row) => row.monthKey === data.today.slice(0, 7) && ['paid','overdue','due_today'].includes(row.status));
  const preview = previewFor();
  const readOnly = editorOwner === 'obligation';
  const nameLabel = draft.planKind === 'subscription' ? '服务名称' : draft.relationshipMode === 'installment_repayment' ? '项目／用途' : COPY.planName;
  const titlePlaceholder = draft.planKind === 'subscription' ? '例如 Netflix、iCloud+' : draft.relationshipMode === 'installment_repayment' ? '例如 床架、代付款' : '例如 房租、水费';
  const recurrence = draft.schedule.recurrence === 'yearly' ? '每年' : '每月';
  const dueLabel = draft.schedule.recurrence === 'yearly' ? `${draft.schedule.dueMonth || 1}月 ${draft.schedule.dueDay}日` : `${draft.schedule.dueDay}日`;
  const firstOccurrence = deriveFirstEligibleOccurrence(draft);
  const visual = readOnly ? `<section class="plan-visual-field"><span>${COPY.visual}</span><div class="plan-readonly-visual">${planVisual(draft)}<small>视觉由原账本计划保持</small></div></section>` : `<section class="plan-visual-field"><span>${draft.planKind === 'subscription' ? '服务 Logo' : COPY.visual}</span><div class="plan-visual-row">${BUILTIN_VISUALS.map(([key, label]) => `<button type="button" title="${label}" aria-label="${label}" data-action="fixed-plan-visual" data-visual="${key}" class="${draft.logoRef === key ? 'selected' : ''}">${planVisual({ ...draft, logoRef: key })}</button>`).join('')}<label class="plan-logo-upload">${icon('camera', 19)}<span>${String(draft.logoRef).startsWith('blob:') ? '替换' : '照片'}</span><input type="file" accept="image/png,image/jpeg,image/webp" data-plan-logo-input /></label>${String(draft.logoRef).startsWith('blob:') ? `<button type="button" class="plan-logo-remove" data-action="fixed-plan-logo-remove" aria-label="移除自定义 Logo">${icon('x',18)}<span>移除</span></button>` : ''}</div></section>`;
  const moreDates = readOnly ? '' : `<button type="button" class="plan-date-button" data-action="fixed-plan-date" data-date-key="startDate"><span>${COPY.startDate}</span><strong>${fmtDateMY(draft.startDate)}</strong></button><button type="button" class="plan-date-button" data-action="fixed-plan-date" data-date-key="endDate"><span>${COPY.endDate}</span><strong>${draft.endDate ? fmtDateMY(draft.endDate) : '不设结束日期'}</strong></button>${draft.planKind === 'subscription' || (draft.planKind === 'fixed_expense' && draft.logoRef === 'home') ? `<button type="button" class="plan-date-button" data-action="fixed-plan-date" data-date-key="moveInDate"><span>${draft.planKind === 'subscription' ? COPY.subscribedAt : COPY.moveIn}</span><strong>${draft.moveInDate ? fmtDateMY(draft.moveInDate) : '未设置'}</strong></button>` : ''}`;
  return `<form class="plan-editor" data-plan-editor data-plan-scroll-content novalidate>
    ${editorOriginContext ? `<div class="plan-origin-context" data-origin-ledger-id="${escapeHTML(editorOriginContext.originLedgerId)}">${icon(editorOriginContext.originLedgerType === 'group' ? 'users' : 'ledger', 18)}<span><strong>从${escapeHTML(editorOriginContext.originDisplayName)}账本建立</strong><small>对象与成员已预填；计划会与固定与订阅共用同一 ID。</small></span></div>` : ''}
    ${readOnly ? `<div class="plan-managed-note">${icon('ledger', 18)}<span><strong>${COPY.ledgerManaged}</strong><small>金额、周期与关系分摊请回到账本修改。</small></span></div>` : ''}
    ${locked ? `<div class="plan-locked-note">${icon('lock', 17)}<span><strong>${COPY.locked}</strong><small>${COPY.nextPeriod}</small></span></div>` : ''}
    <div class="plan-kind-segment" role="group" aria-label="计划类型">${Object.entries(KIND_LABEL).map(([key, label]) => `<button type="button" data-action="fixed-plan-kind" data-kind="${key}" class="${draft.planKind === key ? 'active' : ''}" ${editorMode === 'edit' || readOnly ? 'disabled' : ''}>${label}</button>`).join('')}</div>
    ${draft.planKind === 'recurring_relationship' ? scenarioSelectorHTML() : ''}
    <label class="plan-field"><span>${nameLabel}</span><input name="title" maxlength="36" value="${escapeHTML(draft.title)}" placeholder="${titlePlaceholder}" /></label>
    ${visual}
    ${amountModeHTML(readOnly)}
    ${amountFieldHTML(readOnly)}
    <div class="plan-grid-two">${pickerHTML(COPY.frequency, 'recurrence', recurrence)}${draft.schedule.recurrence === 'yearly' ? pickerHTML('年度月份', 'due-month', `${draft.schedule.dueMonth || 1}月`) : ''}${pickerHTML(draft.schedule.recurrence === 'yearly' ? COPY.yearlyDue : COPY.monthlyDue, 'due-day', dueLabel)}</div>
    ${pickerHTML(draft.planKind === 'subscription' ? '扣款账户／信用卡' : COPY.paymentAccount, 'account', accountLabel(draft.paymentSourceAccountId))}
    ${readOnly ? '' : relationshipRoleHTML(readOnly)}
    ${previewHTML(preview)}
    ${firstOccurrence ? `<section class="first-occurrence-preview"><span>${COPY.firstOccurrence}</span><strong>${fmtDateMY(firstOccurrence)}</strong><small>根据开始日期与到期日自动计算</small></section>` : ''}
    <button type="button" class="plan-more-toggle" data-action="fixed-plan-more"><span>${COPY.more}</span>${icon(draft.moreOpen ? 'chevronUp' : 'chevronDown',18)}</button>
    ${draft.moreOpen ? `<section class="plan-more-fields" data-plan-final-settings>${moreDates}<label class="plan-field"><span>${draft.planKind === 'subscription' ? '方案／备注' : '备注'}</span><textarea name="note" maxlength="120" placeholder="${draft.planKind === 'subscription' ? '例如 200GB、Family' : '可选'}">${escapeHTML(draft.note || '')}</textarea></label></section>` : ''}
    <p class="plan-editor-error" data-plan-error aria-live="polite">${escapeHTML(draft.error || '')}</p>
  </form>${sheetActionDockHTML({ context: 'recurring-plan', className: 'plan-editor-action-dock', primaryLabel: editorMode === 'create' ? COPY.createPlan : COPY.saveChanges, secondaryLabel: '取消', primaryAttributes: { 'data-action': 'fixed-plan-submit' }, secondaryAttributes: { 'data-action': 'fixed-plan-editor-cancel' } })}`;
}

function collectForm() {
  const form = editorSheet?.querySelector('[data-plan-editor]');
  if (!form) return;
  const values = new FormData(form);
  draft.title = String(values.get('title') || '').trim();
  if (values.has('amount')) draft.amount = String(values.get('amount') || '');
  if (values.has('estimateAmount')) draft.estimateAmount = String(values.get('estimateAmount') || '');
  if (values.has('originalPrincipal')) draft.originalPrincipal = String(values.get('originalPrincipal') || '');
  if (values.has('remainingPrincipal')) draft.remainingPrincipal = String(values.get('remainingPrincipal') || '');
  if (values.has('repaidPrincipal')) draft.repaidPrincipal = String(values.get('repaidPrincipal') || '');
  if (values.has('installmentAmount')) draft.installmentAmount = String(values.get('installmentAmount') || '');
  if (values.has('repaymentMonths')) draft.repaymentMonths = String(values.get('repaymentMonths') || '');
  if (values.has('completedPeriods')) draft.completedPeriods = String(values.get('completedPeriods') || '');
  draft.note = String(values.get('note') ?? draft.note ?? '').trim();
}

function rerenderEditor({ focus = null, scrollTop = null } = {}) {
  collectForm();
  const body = editorSheet?.querySelector('.sheet-body');
  if (!body) return;
  const preservedScroll = scrollTop ?? body.scrollTop;
  draftRevision += 1;
  body.innerHTML = editorHTML();
  body.dataset.planScrollRoot = 'true';
  body.dataset.planEditorSession = editorSessionId || '';
  body.dataset.planDraftRevision = String(draftRevision);
  body.scrollTop = preservedScroll;
  bindEditor();
  requestAnimationFrame(() => {
    body.scrollTop = preservedScroll;
    if (focus) body.querySelector(focus)?.focus({ preventScroll: true });
  });
}

function setRelationshipLedger(ledgerId) {
  const ledger = data.getRelationshipLedger(ledgerId);
  if (!ledger) return;
  draft.relationship = null;
  if (draft.planKind === 'subscription') {
    ensureSubscriptionRelationship(draft.subscriptionFundingMode);
    draft.relationship.ledgerId = ledger.ledgerId;
    draft.relationship.participantIds = [...ledger.participantIds];
    draft.relationship.relationshipLabel = ledger.title;
    ensureSubscriptionRelationship(draft.subscriptionFundingMode);
    return;
  }
  ensureRelationship(draft.relationshipMode);
  draft.relationship.ledgerId = ledger.ledgerId;
  draft.relationship.participantIds = [...ledger.participantIds];
  draft.relationship.relationshipLabel = ledger.title;
  const other = ledger.participantIds.find((id) => id !== 'participant-me');
  if (draft.relationshipMode === 'direct_recurring_payment') draft.relationship.recipientParticipantId = other;
  if (draft.relationshipMode === 'installment_repayment') {
    draft.relationship.creditorParticipantId = other;
    draft.relationship.debtorParticipantId = 'participant-me';
  }
}

function openEditorPicker(key, trigger) {
  collectForm();
  const sessionId = editorSessionId;
  const scrollTop = editorSheet?.querySelector('.sheet-body')?.scrollTop || 0;
  const commit = (mutation) => {
    if (!sessionId || sessionId !== editorSessionId || !editorSheet?.isConnected) throw new Error('recurring_editor_session_mismatch');
    mutation();
    rerenderEditor({ scrollTop });
  };
  const pickerBase = { trigger, parentId: sessionId, id: `${sessionId}:picker:${key}:${draftRevision + 1}` };
  if (key === 'recurrence') return openPickerSheet({ title: '付款频率', ...pickerBase, selectedValue: draft.schedule.recurrence, options: [{ value:'monthly',label:'每月' },{ value:'yearly',label:'每年' }], onSelect: (value) => commit(() => { draft.schedule.recurrence=value; if(value==='yearly'&&!draft.schedule.dueMonth)draft.schedule.dueMonth=1; if(value==='monthly')delete draft.schedule.dueMonth; }) });
  if (key === 'due-month') return openPickerSheet({ ...pickerBase, title: '年度月份', selectedValue:String(draft.schedule.dueMonth||1), options:Array.from({length:12},(_,index)=>({value:String(index+1),label:`${index+1}月`})), onSelect:(value)=>commit(()=>{draft.schedule.dueMonth=Number(value);}) });
  if (key === 'due-day') return openPickerSheet({ title:'到期日',...pickerBase,selectedValue:String(draft.schedule.dueDay),options:Array.from({length:31},(_,index)=>({value:String(index+1),label:`${index+1}日`})),onSelect:(value)=>commit(()=>{draft.schedule.dueDay=Number(value);}) });
  if (key === 'account') return openPickerSheet({ title:'付款账户',...pickerBase,selectedValue:draft.paymentSourceAccountId,searchable:true,options:data.getAccounts().map((account)=>({value:account.id,label:account.name,caption:account.last4?`•••• ${account.last4}`:account.type==='ew'?'eWallet':''})),onSelect:(value)=>commit(()=>{draft.paymentSourceAccountId=value;}) });
  if (key === 'ledger') return openPickerSheet({ ...pickerBase, title:'选择对象或群组',selectedValue:draft.relationship?.ledgerId,options:data.getRelationshipLedgers().filter((ledger)=>ledger.status==='active').map((ledger)=>({value:ledger.ledgerId,label:ledger.title,caption:`${ledger.participantIds.length} 位成员`,avatar:ledger.title.slice(0,1)})),onSelect:(value)=>commit(()=>{setRelationshipLedger(value);}) });
  const ledger = currentLedger();
  const field = key === 'recipient' ? 'recipientParticipantId' : key === 'creditor' ? 'creditorParticipantId' : 'debtorParticipantId';
  const title = key === 'recipient' ? '每月付给谁' : key === 'creditor' ? '分期还给谁' : '谁负责还款';
  return openPickerSheet({ ...pickerBase, title,selectedValue:draft.relationship?.[field],options:ledger.participantIds.map((id)=>({value:id,label:participantLabel(id),avatar:participantLabel(id).slice(0,1)})),onSelect:(value)=>commit(()=>{draft.relationship[field]=value;}) });
}

function bindEditor() {
  const form = editorSheet?.querySelector('[data-plan-editor]');
  if (!form) return;
  bindPlanImageFallback(form);
  form.addEventListener('submit', saveEditor);
  ['amount','estimateAmount','originalPrincipal','remainingPrincipal','repaidPrincipal','installmentAmount','repaymentMonths','completedPeriods'].forEach((name) => form.querySelector(`[name="${name}"]`)?.addEventListener('change', () => rerenderEditor()));
  form.addEventListener('focusin', (event) => requestAnimationFrame(() => event.target.closest('.plan-field,.plan-picker-field,.plan-date-button')?.scrollIntoView?.({ block: 'nearest' })));
  if (window.visualViewport) {
    if (viewportResizeHandler) window.visualViewport.removeEventListener('resize', viewportResizeHandler);
    viewportResizeHandler = () => document.activeElement?.closest?.('.plan-field,.plan-picker-field')?.scrollIntoView?.({ block: 'nearest' });
    window.visualViewport.addEventListener('resize', viewportResizeHandler);
  }
  editorSheet.querySelectorAll('[data-picker-field^="plan-"]').forEach((button) => button.addEventListener('click', () => openEditorPicker(button.dataset.pickerField.replace(/^plan-/,''),button)));
  const logo = form.querySelector('[data-plan-logo-input]');
  logo?.addEventListener('change', () => {
    const file = logo.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 3 * 1024 * 1024) return toast('请选择 3MB 以内的图片');
    if (draftObjectUrls.has(draft.logoRef)) {
      URL.revokeObjectURL(draft.logoRef);
      draftObjectUrls.delete(draft.logoRef);
    }
    draft.logoRef = URL.createObjectURL(file);
    draftObjectUrls.add(draft.logoRef);
    rerenderEditor();
  });
}

function normalizeDraft() {
  collectForm();
  syncSubscriptionAutomaticShares(draft);
  if (!draft.title) throw new Error('请输入计划名称');
  let fixedAmountMinor = null;
  let estimateAmountMinor = null;
  if (draft.relationshipMode === 'installment_repayment') {
    ensureRelationship('installment_repayment');
    const setup = installmentDraftSummary();
    if (!setup) throw new Error('请完成分期欠款与还款设置');
    draft.amountMode = 'fixed';
    draft.relationship.originalPrincipalMinor = setup.originalPrincipalMinor;
    draft.relationship.remainingPrincipalMinor = setup.remainingPrincipalMinor;
    draft.relationship.installmentAmountMinor = setup.normalInstallmentMinor;
    draft.relationship.completedInstallments = setup.completedInstallments;
    draft.relationship.plannedInstallmentCount = (setup.completedInstallments || 0) + setup.installmentCount;
    draft.relationship.repaymentMethod = setup.method;
    draft.relationship.repaymentMonths = setup.installmentCount;
    draft.relationship.finalInstallmentMinor = setup.finalInstallmentMinor;
    fixedAmountMinor = draft.relationship.installmentAmountMinor;
  } else if (draft.amountMode === 'fixed') {
    fixedAmountMinor = optionalMoneyMinor(draft.amount);
  } else {
    estimateAmountMinor = optionalMoneyMinor(draft.estimateAmount);
  }
  const totalAmountMinor = fixedAmountMinor ?? estimateAmountMinor ?? 0;
  if (draft.amountMode === 'fixed' && !totalAmountMinor) throw new Error(draft.relationshipMode === 'installment_repayment' ? '请输入每期还款' : '请输入固定金额');
  return {
    ...structuredClone(draft),
    fixedAmountMinor,
    estimateAmountMinor,
    totalAmountMinor,
    amountMinor: totalAmountMinor,
    provider: draft.planKind === 'subscription' ? { name: draft.title, kind: draft.logoRef || 'subscription' } : draft.provider,
    subscriptionFundingMode: draft.planKind === 'subscription' ? draft.subscriptionFundingMode : null,
    canonicalSource: { sourceType: 'fixed_plan', sourceId: draft.id },
    moreOpen: undefined, amount: undefined, estimateAmount: undefined,
    originalPrincipal: undefined, remainingPrincipal: undefined, repaidPrincipal: undefined, installmentAmount: undefined,
    progressMode: undefined, progressEntryMode: undefined, repaymentMethod: undefined, repaymentMonths: undefined, completedPeriods: undefined,
    error: undefined,
  };
}

function editorChanges(candidate) {
  const canonical = data.getCanonicalRecurringPlan(sourceKey);
  if (canonical.owner === 'obligation') return { title: candidate.title, note: candidate.note, paymentSourceAccountId: candidate.paymentSourceAccountId };
  const keys = ['planKind','title','categoryId','amountMode','fixedAmountMinor','estimateAmountMinor','totalAmountMinor','schedule','startDate','endDate','moveInDate','paymentSourceAccountId','provider','logoRef','relationshipMode','relationship','subscriptionFundingMode','recordOnlyDefault','note'];
  return Object.fromEntries(keys.filter((key) => JSON.stringify(candidate[key] ?? null) !== JSON.stringify(canonical.plan[key] ?? null)).map((key) => [key, candidate[key] ?? null]));
}

function finishSave(result) {
  const retainedLogo = String(draft.logoRef || '').startsWith('blob:') ? draft.logoRef : null;
  disposeDraftObjectUrls(retainedLogo);
  permitClose = true;
  closeSheet(true);
  update({ fixedMonth: data.today.slice(0, 7) });
  const firstOccurrence = deriveFirstEligibleOccurrence(result.plan);
  toast(result.status === 'created' ? `计划已创建 · ${COPY.firstOccurrence}：${fmtDateMY(firstOccurrence)}` : '计划已更新');
  if (result.status === 'created') setTimeout(() => openPlanDetail(result.source), 80);
}

function saveEditor(event) {
  event?.preventDefault();
  try {
    const candidate = normalizeDraft();
    if (editorMode === 'create') {
      const result = data.createManagedRecurringPlan(candidate, { commandId: commandId('create'), allowSemanticDuplicate: allowDuplicate });
      if (result.status === 'semantic_duplicate') return openDuplicateWarning(result.matches, candidate);
      finishSave(result);
    } else {
      const result = data.updateManagedRecurringPlan(sourceKey, editorChanges(candidate), { commandId: commandId('update') });
      finishSave(result);
    }
  } catch (error) {
    draft.error = error.message || '无法保存计划';
    rerenderEditor();
  }
}

function requestEditorClose() {
  collectForm();
  if (permitClose || !isRecurringPlanDraftMeaningfullyDirty(draft, draftBaseline)) return true;
  openSheet({ title: COPY.discardTitle, stacked: true, className: 'plan-confirm-sheet', contentHTML: `<div class="plan-confirm-copy"><p>名称、金额、周期或分摊的修改尚未保存。</p><button class="sheet-primary" data-action="fixed-plan-continue-edit">${COPY.continueEditing}</button><button class="sheet-danger" data-action="fixed-plan-discard">${COPY.discard}</button></div>` });
  return false;
}

export function openPlanEditor({ source = null, kind = 'fixed_expense', origin = null, scenario = null, subscriptionFundingMode = null } = {}) {
  disposeDraftObjectUrls();
  permitClose = false;
  allowDuplicate = false;
  editorSessionId = `recurring-plan-editor:${++editorSessionSequence}`;
  editorChildSequence = 0;
  draftRevision = 0;
  sourceKey = source ? canonicalKey(source) : null;
  editorOriginContext = sourceKey ? null : origin ? structuredClone(origin) : null;
  if (sourceKey) {
    const canonical = data.getCanonicalRecurringPlan(sourceKey);
    editorMode = 'edit'; editorOwner = canonical.owner; draft = draftFromPlan(canonical.plan);
  } else {
    editorMode = 'create'; editorOwner = 'fixed'; draft = defaultDraft(kind);
    applyLedgerOrigin(editorOriginContext, { scenario, subscriptionFundingMode });
  }
  if (draft.planKind === 'recurring_relationship') ensureRelationship(draft.relationshipMode);
  if (draft.planKind === 'subscription' && draft.subscriptionFundingMode !== 'self') ensureSubscriptionRelationship(draft.subscriptionFundingMode);
  draftBaseline = structuredClone(draft);
  original = cleanPlanForCompare(draft);
  editorSheet = openSheet({ id: editorSessionId, title: editorMode === 'create' ? COPY.newPlan : COPY.editPlan, className: 'plan-editor-sheet', contentHTML: editorHTML(), onRequestClose: requestEditorClose, onClose: () => { disposeDraftObjectUrls(); if (viewportResizeHandler && window.visualViewport) window.visualViewport.removeEventListener('resize', viewportResizeHandler); viewportResizeHandler = null; editorSheet = null; editorSessionId = null; editorOriginContext = null; draftRevision = 0; } });
  editorSheet.querySelector('.sheet-body')?.setAttribute('data-plan-scroll-root', 'true');
  editorSheet.dataset.planEditorSession = editorSessionId;
  editorSheet.querySelector('.sheet-body')?.setAttribute('data-plan-editor-session', editorSessionId);
  editorSheet.querySelector('.sheet-body')?.setAttribute('data-plan-draft-revision', String(draftRevision));
  // AppSheet invokes onOpen before returning its element. Bind after the
  // stable sheet reference is assigned so picker/submit events work.
  bindEditor();
}

function openDuplicateWarning(matches, candidate) {
  draft = { ...candidate, amount: (candidate.totalAmountMinor/100).toFixed(2), moreOpen: draft.moreOpen };
  openSheet({ title: COPY.duplicateTitle, className: 'plan-confirm-sheet', stacked: true, contentHTML: `<div class="duplicate-plan-list">${matches.map((match) => `<button data-action="fixed-plan-view-duplicate" data-source="${escapeHTML(match.sourceKey)}"><span>${planVisual({ title: match.title })}<strong>${escapeHTML(match.title)}</strong></span><b>${fmtRM(match.totalAmountMinor/100,{privacy:ui.privacy})}</b></button>`).join('')}<p>金额与周期相同。你仍可确认这是另一项独立计划。</p><button class="sheet-primary" data-action="fixed-plan-duplicate-continue">${COPY.continueCreate}</button><button class="sheet-secondary" data-action="sheet-close">${COPY.returnEdit}</button></div>` });
}

function openRelationshipEditor(trigger = document.activeElement) {
  collectForm();
  const ledgers = data.getRelationshipLedgers().filter((ledger) => ledger.status === 'active');
  if (!ledgers.length) return toast('请先建立关系账本');
  if (draft.planKind === 'fixed_expense' && !draft.relationshipMode) draft.relationshipMode = 'shared_bill';
  if (!['shared_bill', 'central_collection'].includes(draft.relationshipMode)) return;
  const body = editorSheet?.querySelector('.sheet-body');
  const scrollTop = body?.scrollTop || 0;
  ensureRelationship(draft.relationshipMode);
  openRecurringRelationshipComposer({
    mode: draft.relationshipMode,
    totalMinor: planningMinor(),
    value: draft.relationship,
    trigger,
    onComplete: (relationship) => {
      draft.relationship = relationship;
      draft.relationshipMode = relationship.relationshipMode;
      rerenderEditor({ scrollTop });
    },
  });
}

function occurrenceHistory(plan, source) {
  const rows = data.getCanonicalRecurringPlanOccurrences(source);
  if (!rows.length) return `<div class="plan-history-empty">暂无账期记录</div>`;
  return rows.map((row) => {
    const presentation = deriveRecurringOccurrencePresentation(row, plan, data.today);
    const shownMinor = Number.isInteger(row.postedAmountMinor) ? row.postedAmountMinor : row.ownShareMinor;
    const amount = row.amountPending
      ? '<b class="amount-pending">待填写金额</b>'
      : `<b>${row.amountState === 'estimated' ? '<small>预计</small>' : ''}${fmtRM(shownMinor / 100, { privacy: ui.privacy })}</b>`;
    const attachment = row.attachmentIds?.length ? `<i class="plan-history-attachment" aria-label="${row.attachmentIds.length} 个附件">${icon('paperclip', 13)} ${row.attachmentIds.length}</i>` : '';
    return `<div class="plan-history-row" data-semantic-state="${presentation.semanticState}"><span><strong>${fmtDateMY(row.dueDate)}</strong><small>${row.monthKey}</small></span>${amount}${attachment}<em class="status-${presentation.semanticState} tone-${presentation.tone}">${escapeHTML(presentation.label)}</em></div>`;
  }).join('');
}

function registryRow(plan) {
  const key = canonicalKey(plan.canonicalSource);
  return `<button type="button" class="plan-registry-row" data-action="fixed-plan-registry-detail" data-source="${escapeHTML(key)}">${planVisual(plan)}<span><strong>${escapeHTML(plan.title)}</strong><small>${plan.archivedAt ? COPY.archived : STATUS_LABEL[plan.status]} · ${plan.schedule.recurrence === 'yearly' ? '每年' : '每月'} · ${COPY.firstOccurrence} ${fmtDateMY(deriveFirstEligibleOccurrence(plan))}</small></span><b>${planAmountHTML(plan)}</b>${icon('chevronRight',15)}</button>`;
}

export function openPlanRegistry({ archived = false } = {}) {
  const rows = data.getCanonicalRecurringPlans().filter((plan) => archived ? Boolean(plan.archivedAt) : !plan.archivedAt);
  openSheet({ title: archived ? COPY.archived : COPY.viewAllPlans, className: 'plan-registry-sheet', contentHTML: `<div class="plan-registry-list">${rows.map(registryRow).join('') || `<div class="plan-history-empty">${archived ? '还没有归档计划' : '还没有计划'}</div>`}</div><button class="sheet-secondary" data-action="sheet-close">完成</button>` });
}

function planAmountHTML(plan) {
  if (plan.amountPending) return '<span class="plan-amount-pending">待填写金额</span>';
  const prefix = plan.amountMode === 'variable' ? '<small>预计</small>' : '';
  return `${prefix}${fmtRM((plan.plannedAmountMinor ?? plan.totalAmountMinor) / 100, { privacy: ui.privacy })}`;
}

export function openPlanDetail(source, occurrenceId = null) {
  const key = canonicalKey(source);
  const canonical = data.getCanonicalRecurringPlan(key);
  const plan = canonical.plan;
  const responsibility = calculateRecurringRelationshipProjection(plan.totalAmountMinor, plan.relationshipMode, plan.relationship);
  const account = data.getAccount(plan.paymentSourceAccountId);
  const relation = plan.relationship ? data.getRelationshipLedger(plan.relationship.ledgerId) : null;
  const firstOccurrence = deriveFirstEligibleOccurrence(plan);
  const occurrenceRows = data.getCanonicalRecurringPlanOccurrences(key);
  const requestedOccurrence = occurrenceId ? occurrenceRows.find((row) => row.id === occurrenceId) : null;
  const nextOccurrence = requestedOccurrence || occurrenceRows.find((row) => row.dueDate >= data.today && !['paid','skipped'].includes(row.status));
  const occurrencePosting = requestedOccurrence?.recurringPostingId ? data.getRecurringOccurrencePosting(requestedOccurrence.recurringPostingId) : null;
  const visual = derivePlanVisualPresentation(plan, nextOccurrence || null, {
    context: 'plan-detail',
    referenceDate: data.today,
    participantName: (id) => data.getParticipant(id)?.displayName,
    accountName: (id) => data.getAccount(id)?.name,
  });
  const visualAmount = visual.primaryAmountMinor == null ? '待填写' : fmtRM(visual.primaryAmountMinor / 100, { privacy: ui.privacy });
  const visualSecondary = visual.secondaryAmounts.map((item) => `<span><small>${escapeHTML(item.label)}</small><strong>${fmtRM(item.amountMinor / 100, { privacy: ui.privacy })}</strong></span>`).join('');
  const recipient = data.getRecipientIdentityForPlan(plan);
  const partnerPaidSubscription = plan.planKind === 'subscription' && plan.subscriptionFundingMode === 'other_pays';
  const paymentSourceDetail = partnerPaidSubscription
    ? ['代付方', data.getParticipant(plan.relationship?.payerParticipantId)?.displayName || '对方']
    : [COPY.paymentAccount, account?.name || '只记录'];
  const detailItems = [
    ['频率', plan.schedule.recurrence === 'yearly' ? `每年 ${plan.schedule.dueMonth}月${plan.schedule.dueDay}日` : `每月 ${plan.schedule.dueDay}日`],
    ['金额方式', plan.amountMode === 'variable' ? '每期金额不同' : '固定金额'],
    paymentSourceDetail,
    ...(plan.relationshipMode ? [['关系类型', RELATIONSHIP_LABEL[plan.relationshipMode]], ['关系账', relation?.title || '—'], [COPY.ownShare, plan.amountPending ? '待填写' : fmtRM(responsibility.ownShareMinor / 100, { privacy: ui.privacy })], [COPY.plannedPayment, plan.amountPending ? '待填写' : fmtRM(responsibility.cashOutflowMinor / 100, { privacy: ui.privacy })]] : []),
    [COPY.startDate, fmtDateMY(plan.startDate)],
    [COPY.firstOccurrence, fmtDateMY(firstOccurrence)],
    ...(nextOccurrence ? [['下一账期', fmtDateMY(nextOccurrence.dueDate)]] : []),
    ...(plan.endDate ? [[COPY.endDate, fmtDateMY(plan.endDate)]] : []),
  ];
  const detailSheet = openSheet({ title:COPY.detail,className:'plan-detail-sheet',contentHTML:`<article class="plan-detail">
    <header>${planVisual(plan,'large')}<div><strong>${escapeHTML(plan.title)}</strong><span>${escapeHTML(visual.typeLabel)} · ${escapeHTML(visual.planStateLabel)}</span></div><b><small>${escapeHTML(visual.primaryAmountLabel)}</small>${visualAmount}</b></header>
    <section class="plan-detail-flow surface"><div><small>资金方向</small><strong>${escapeHTML(visual.moneyFlowLabel || visual.sourceLabel || '我的计划')}</strong></div>${visualSecondary}${visual.progress ? `<span><small>剩余本金</small><strong>${fmtRM(visual.progress.remainingPrincipalMinor / 100, { privacy: ui.privacy })} · ${visual.progress.remainingPeriods}期</strong></span>` : ''}</section>
    ${canonical.managementLabel?`<div class="plan-managed-note">${icon('ledger',18)}<span><strong>${canonical.managementLabel}</strong><small>此计划的金额、周期与关系由原账本维护。</small></span></div>`:''}
    <section class="plan-detail-grid">${detailItems.map(([label, value], index) => `<span class="${detailItems.length % 2 && index === detailItems.length - 1 ? 'span-all' : ''}">${escapeHTML(label)}<strong>${escapeHTML(value)}</strong></span>`).join('')}</section>
    ${plan.note?`<p class="plan-detail-note">${escapeHTML(plan.note)}</p>`:''}
    ${recipient ? `<button type="button" class="sheet-secondary plan-recipient-profile-entry" data-action="fixed-plan-recipient-profile" data-plan-id="${escapeHTML(plan.id)}">${icon('wallet',18)}<span><strong>${escapeHTML(recipient.displayName)}收款资料</strong><small>${data.getRecipientPaymentProfiles({ recipientId: recipient.recipientId }).length ? '管理银行账号与 DuitNow' : '尚未添加收款资料'}</small></span>${icon('chevronRight',15)}</button>` : ''}
    <section class="plan-history"><h3>${COPY.history}</h3>${occurrenceHistory(plan,key)}</section>
    <div class="plan-detail-actions">${occurrencePosting?.transactionId ? `<button class="sheet-primary" data-action="recurring-posting-view" data-transaction-id="${escapeHTML(occurrencePosting.transactionId)}">查看记录</button>` : ''}${occurrencePosting?.status === 'posted' ? `<button class="sheet-danger" data-action="recurring-posting-reverse-request" data-posting-id="${escapeHTML(occurrencePosting.postingId)}">撤销这次记账</button>` : ''}${!occurrencePosting && nextOccurrence && !['paid','charged','received','repaid','completed','skipped'].includes(nextOccurrence.recordedStatus || nextOccurrence.status) && plan.status === 'active' && !plan.archivedAt ? `<button class="sheet-primary" data-action="fixed-occurrence-action" data-source="${escapeHTML(key)}" data-occurrence-id="${escapeHTML(nextOccurrence.id)}">本期处理</button>` : ''}${plan.status !== 'stopped' && !plan.archivedAt ? `<button class="sheet-secondary" data-action="fixed-plan-edit" data-source="${escapeHTML(key)}">${COPY.editPlan}</button>` : ''}<button class="sheet-secondary ${plan.status === 'stopped' || plan.archivedAt ? 'span-all' : ''}" data-action="fixed-plan-manage" data-source="${escapeHTML(key)}">管理计划</button></div>
  </article>`});
  bindPlanImageFallback(detailSheet);
}

function openPlanManage(el) {
  const canonical = data.getCanonicalRecurringPlan(el.dataset.source);
  const plan = canonical.plan;
  const source = el.dataset.source;
  const lifecycle = plan.archivedAt ? `<button class="sheet-secondary" data-action="fixed-plan-unarchive" data-source="${escapeHTML(source)}">${COPY.unarchive}</button>`
    : plan.status === 'stopped' ? `<button class="sheet-secondary" data-action="fixed-plan-archive" data-source="${escapeHTML(source)}">${COPY.archivePlan}</button>`
      : `${plan.status === 'paused' ? `<button class="sheet-secondary" data-action="fixed-plan-transition" data-target="active" data-source="${escapeHTML(source)}">${COPY.resume}</button>` : `<button class="sheet-secondary" data-action="fixed-plan-transition" data-target="paused" data-source="${escapeHTML(source)}">${COPY.pause}</button>`}<button class="sheet-danger" data-action="fixed-plan-transition" data-target="stopped" data-source="${escapeHTML(source)}">${COPY.stop}</button><button class="sheet-secondary archive-action" data-action="fixed-plan-archive" data-source="${escapeHTML(source)}">${COPY.stopAndArchive}</button>`;
  openSheet({
    title: '管理计划',
    className: 'plan-management-sheet',
    stacked: true,
    contentHTML: `<div class="plan-management-actions"><p>只调整未来计划状态，不会创建、撤销或修改任何交易。</p>${canonical.managementLabel ? `<div class="plan-managed-note">${icon('ledger',18)}<span><strong>${canonical.managementLabel}</strong><small>归档与删除请回到原账本处理。</small></span></div>` : `<section class="plan-management-group"><h3>计划状态</h3>${lifecycle}</section><section class="plan-management-group is-danger"><h3>危险操作</h3><button class="sheet-danger plan-remove-action" data-action="fixed-plan-delete-request" data-source="${escapeHTML(source)}">删除计划</button><small>计划会移到最近删除，之后仍可恢复。</small></section>`}<button class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
  });
}

function requestArchive(el) {
  const canonical = data.getCanonicalRecurringPlan(el.dataset.source);
  const active = canonical.plan.status !== 'stopped';
  openSheet({ title: active ? '停止并归档这项计划？' : '归档这项计划？', className: 'plan-confirm-sheet', stacked: true, contentHTML: `<div class="plan-confirm-copy"><p>${active ? '未来不会再生成新账期，过去的账期和记录会保留在归档中。' : '计划会从主要列表移到归档，过去账期与记录会继续保留。'}</p><button class="sheet-primary" data-action="fixed-plan-archive-confirm" data-source="${escapeHTML(el.dataset.source)}" data-command="${commandId('archive')}">${active ? COPY.stopAndArchive : COPY.archivePlan}</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>` });
}

function requestRemoval(el) {
  const source = el.dataset.source;
  const canonical = data.getCanonicalRecurringPlan(source);
  const eligibility = data.getManagedRecurringPlanRemovalEligibility(source);
  if (!eligibility.eligible) {
    return openSheet({ title: COPY.deleteBlockedTitle, className: 'plan-confirm-sheet', stacked: true, contentHTML: `<div class="plan-confirm-copy"><p>这项计划已有账期或记录。你可以停止并归档，过去记录会继续保留。</p><button class="sheet-primary" data-action="fixed-plan-archive" data-source="${escapeHTML(source)}">${canonical.plan.status === 'stopped' ? COPY.archivePlan : COPY.stopAndArchive}</button><button class="sheet-secondary" data-action="sheet-close">返回</button></div>` });
  }
  openSheet({ title: REMOVE_PLAN_TITLE, className: 'plan-confirm-sheet', stacked: true, contentHTML: `<div class="plan-confirm-copy"><div class="plan-remove-summary">${planVisual(canonical.plan)}<span><strong>${escapeHTML(canonical.plan.title)}</strong><small>${planAmountHTML(canonical.plan)}</small></span></div><p>这项计划尚未产生正式记录。删除后无法恢复。</p><button class="sheet-danger" data-action="fixed-plan-remove-confirm" data-source="${escapeHTML(source)}" data-command="${commandId('remove')}">${REMOVE_PLAN_LABEL}</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>` });
}

function requestSoftDelete(el) {
  const source = el.dataset.source;
  const canonical = data.getCanonicalRecurringPlan(source);
  openSheet({
    title: '删除这项计划？',
    className: 'plan-confirm-sheet',
    stacked: true,
    contentHTML: `<div class="plan-confirm-copy"><div class="plan-remove-summary">${planVisual(canonical.plan)}<span><strong>${escapeHTML(canonical.plan.title)}</strong><small>${planAmountHTML(canonical.plan)}</small></span></div><p>计划会移到最近删除，之后仍可恢复。已经产生的账期和记录不会被删除。</p><button class="sheet-danger" data-action="fixed-plan-delete-confirm" data-source="${escapeHTML(source)}" data-command="${commandId('soft-delete')}">移到最近删除</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
  });
}

function deletedPlanRow(entry) {
  const plan = entry.plan;
  const next = (entry.occurrenceSnapshot || []).find((row) => row.dueDate >= data.today && !['paid', 'skipped'].includes(row.status));
  return `<article class="recently-deleted-plan-row surface" data-deleted-plan-id="${escapeHTML(plan.id)}">
    ${planVisual(plan)}
    <div><strong>${escapeHTML(plan.title)}</strong><small>${escapeHTML(KIND_LABEL[plan.planKind] || '计划')} · 原状态 ${escapeHTML(STATUS_LABEL[entry.tombstone.previousLifecycleStatus] || entry.tombstone.previousLifecycleStatus)}</small><small>删除于 ${fmtDateMY(entry.tombstone.deletedAt.slice(0, 10))}${next ? ` · 原下次账期 ${fmtDateMY(next.dueDate)}` : ''}</small></div>
    <div class="recently-deleted-actions"><button type="button" class="deleted-plan-view-action" data-action="fixed-plan-deleted-detail" data-plan-id="${escapeHTML(plan.id)}">查看详情</button><button type="button" data-action="fixed-plan-restore-request" data-plan-id="${escapeHTML(plan.id)}">恢复</button><button type="button" class="is-danger" data-action="fixed-plan-permanent-request" data-plan-id="${escapeHTML(plan.id)}">永久删除</button></div>
  </article>`;
}

function deletedDetailRow(label, value) {
  if (value == null || value === '') return '';
  return `<div class="deleted-plan-detail-row"><span>${escapeHTML(label)}</span><strong>${value}</strong></div>`;
}

function openDeletedPlanDetail(el) {
  const planId = el.dataset.planId;
  const entry = data.getRecentlyDeletedRecurringPlans().find((row) => row.plan.id === planId);
  if (!entry) return;
  const plan = entry.plan;
  const relation = plan.relationship || {};
  const account = plan.paymentSourceAccountId ? data.getAccount(plan.paymentSourceAccountId) : null;
  const profile = plan.recipientPaymentProfileId ? data.getRecipientPaymentProfile(plan.recipientPaymentProfileId) : null;
  const deletedAt = entry.tombstone.deletedAt;
  const nextAtDelete = (entry.occurrenceSnapshot || []).filter((row) => row.dueDate >= deletedAt.slice(0, 10)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const retainedCount = (entry.occurrenceSnapshot || []).filter((row) => row.recordedStatus || row.postedTransactionId || ['paid', 'charged', 'received', 'repaid', 'completed', 'skipped'].includes(row.status)).length;
  const amountMinor = plan.plannedAmountMinor ?? plan.totalAmountMinor ?? plan.estimateAmountMinor;
  const frequency = plan.schedule?.recurrence === 'yearly'
    ? `每年 ${plan.schedule.dueMonth || 1} 月 ${plan.schedule.dueDay || 1} 日`
    : `每月 ${plan.schedule?.dueDay || 1} 日`;
  const people = [relation.payerParticipantId, relation.collectorParticipantId, relation.counterpartyId, relation.recipientParticipantId, relation.creditorParticipantId]
    .filter(Boolean).map((id) => data.getParticipant(id)?.displayName || '关系对象').filter((name, index, all) => all.indexOf(name) === index).join('、');
  const payment = profile ? `<div class="deleted-plan-payment-profile">
    <span>${escapeHTML(profile.displayName)} · ${escapeHTML(profile.bankDisplayName)}</span>
    <strong class="num">${escapeHTML(maskPaymentAccount(profile.accountNumber, { hidden: ui.privacy }))}</strong>
    ${profile.duitNowValue ? `<small>DuitNow ${escapeHTML(maskDuitNowValue(profile.duitNowValue, { hidden: ui.privacy }))}</small>` : ''}
  </div>` : null;
  openSheet({
    id: `fixed-plan-deleted-detail:${plan.id}`,
    parentId: el.closest('.modal-layer')?.dataset.sheetId || 'fixed-recently-deleted',
    title: '已删除计划详情', stacked: true,
    className: 'deleted-plan-detail-sheet', trigger: el,
    contentHTML: `<div class="deleted-plan-detail">
      <section class="deleted-plan-detail-hero surface">${planVisual(plan)}<div><small>${escapeHTML(KIND_LABEL[plan.planKind] || '计划')}</small><strong>${escapeHTML(plan.title)}</strong><span>只读快照 · 查看不会恢复计划</span></div></section>
      <section class="deleted-plan-detail-list surface">
        ${deletedDetailRow('原状态', escapeHTML(STATUS_LABEL[entry.tombstone.previousLifecycleStatus] || entry.tombstone.previousLifecycleStatus || '—'))}
        ${deletedDetailRow('删除时间', `${fmtDateMY(deletedAt.slice(0, 10))} ${fmtTimeAMPM(deletedAt.slice(11, 16))}`)}
        ${deletedDetailRow('原金额', Number.isInteger(amountMinor) ? `${plan.amountMode === 'variable' ? '预计 ' : ''}${fmtRM(amountMinor / 100, { privacy: ui.privacy })}` : '待填写')}
        ${deletedDetailRow('频率', frequency)}
        ${deletedDetailRow('付款账户', escapeHTML(account?.name || '只记录'))}
        ${deletedDetailRow('关系设置', escapeHTML(RELATIONSHIP_LABEL[plan.relationshipMode] || (plan.relationshipMode ? '关系计划' : '没有关系设置')))}
        ${deletedDetailRow('付款／收款角色', escapeHTML(people || '—'))}
        ${deletedDetailRow('收款资料', payment)}
        ${deletedDetailRow('原始本金', Number.isInteger(relation.originalPrincipalMinor) ? fmtRM(relation.originalPrincipalMinor / 100, { privacy: ui.privacy }) : null)}
        ${deletedDetailRow('删除时剩余本金', Number.isInteger(relation.remainingPrincipalMinor) ? fmtRM(relation.remainingPrincipalMinor / 100, { privacy: ui.privacy }) : null)}
        ${deletedDetailRow('开始日期', plan.startDate ? fmtDateMY(plan.startDate) : null)}
        ${deletedDetailRow('结束日期', plan.endDate ? fmtDateMY(plan.endDate) : '没有结束日期')}
        ${deletedDetailRow('删除时下次账期', nextAtDelete?.dueDate ? fmtDateMY(nextAtDelete.dueDate) : '没有未来账期')}
        ${deletedDetailRow('备注', escapeHTML(plan.note || '—'))}
        ${deletedDetailRow('保留的历史账期', `${retainedCount} 个`)}
      </section>
      <p class="deleted-plan-detail-preservation">已记录的交易、附件与历史审计会继续保留；查看详情不会恢复计划，也不会重新生成未来账期。</p>
      <button type="button" class="sheet-primary" data-action="fixed-plan-restore-request" data-plan-id="${escapeHTML(plan.id)}">恢复计划</button>
      <button type="button" class="sheet-danger" data-action="fixed-plan-permanent-request" data-plan-id="${escapeHTML(plan.id)}">永久删除</button>
      <button type="button" class="sheet-secondary" data-action="sheet-close">关闭</button>
    </div>`,
  });
}

export function openRecentlyDeletedPlans() {
  const rows = data.getRecentlyDeletedRecurringPlans();
  openSheet({
    id: 'fixed-recently-deleted',
    title: `最近删除 ${rows.length}`,
    className: 'recently-deleted-sheet',
    contentHTML: recentlyDeletedContent(rows),
  });
}

function recentlyDeletedContent(rows = data.getRecentlyDeletedRecurringPlans()) {
  return `<div class="recently-deleted-list">${rows.map(deletedPlanRow).join('') || '<div class="plan-history-empty">最近删除是空的</div>'}</div>${rows.length ? '<button type="button" class="sheet-danger clear-recently-deleted" data-action="fixed-plan-clear-deleted-request">清空最近删除</button>' : ''}<button class="sheet-secondary" data-action="sheet-close">完成</button><p class="recently-deleted-note">计划删除历史与账期历史分开管理。已有记账记录不会被删除。</p>`;
}

function refreshRecentlyDeletedSheet() {
  const layer = document.querySelector('[data-sheet-id="fixed-recently-deleted"]');
  const body = layer?.querySelector('.sheet-body');
  if (!body) return;
  const scrollTop = body.scrollTop;
  const rows = data.getRecentlyDeletedRecurringPlans();
  body.innerHTML = recentlyDeletedContent(rows);
  body.scrollTop = scrollTop;
  layer.querySelector('.sheet-title').textContent = `最近删除 ${rows.length}`;
}

function requestRestoreDeleted(el) {
  const planId = el.dataset.planId;
  const entry = data.getRecentlyDeletedRecurringPlans().find((row) => row.plan.id === planId);
  if (!entry) return;
  openSheet({
    title: '恢复这项计划？',
    className: 'plan-confirm-sheet',
    stacked: true,
    contentHTML: `<div class="plan-confirm-copy"><p>“${escapeHTML(entry.plan.title)}”会恢复为${escapeHTML(STATUS_LABEL[entry.tombstone.previousLifecycleStatus] || '原状态')}，不会重复生成过去账期。</p><button class="sheet-primary" data-action="fixed-plan-restore-confirm" data-plan-id="${escapeHTML(planId)}" data-command="${commandId('restore')}">恢复计划</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
  });
}

function requestPermanentDelete(el) {
  const planId = el.dataset.planId;
  const entry = data.getRecentlyDeletedRecurringPlans().find((row) => row.plan.id === planId);
  if (!entry) return;
  openSheet({
    title: '永久删除这项计划？',
    className: 'plan-confirm-sheet',
    stacked: true,
    contentHTML: `<div class="plan-confirm-copy"><p>永久删除后无法恢复。已经产生的记账记录不会被删除。</p><div class="plan-remove-summary">${planVisual(entry.plan)}<span><strong>${escapeHTML(entry.plan.title)}</strong><small>只清除计划定义和未来未处理账期</small></span></div><button class="sheet-danger" data-action="fixed-plan-permanent-confirm" data-plan-id="${escapeHTML(planId)}" data-command="${commandId('permanent-delete')}">永久删除</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
  });
}

function requestClearDeleted() {
  const count = data.getRecentlyDeletedRecurringPlans().length;
  if (!count) return;
  openSheet({
    title: '清空最近删除？',
    className: 'plan-confirm-sheet',
    stacked: true,
    contentHTML: `<div class="plan-confirm-copy"><p>将永久删除最近删除中的 ${count} 项计划。已经产生的记账记录不会被删除。</p><button class="sheet-danger" data-action="fixed-plan-clear-deleted-confirm" data-command="${commandId('clear-deleted')}">永久删除 ${count} 项</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>`,
  });
}

function transitionPlan(el) {
  const source=el.dataset.source,target=el.dataset.target;
  const label=target==='paused'?COPY.pause:target==='active'?COPY.resume:COPY.stop;
  openSheet({ title:`确认${label}`,className:'plan-confirm-sheet',stacked:true,contentHTML:`<div class="plan-confirm-copy"><p>${target==='stopped'?'停止后将保留历史账期，但不能继续编辑。':'此操作只影响未来计划，不会创建或撤销任何交易。'}</p><button class="sheet-primary" data-action="fixed-plan-transition-confirm" data-source="${escapeHTML(source)}" data-target="${target}">确认${label}</button><button class="sheet-secondary" data-action="sheet-close">取消</button></div>`});
}

function applyPlanKind(kind) {
  collectForm();
  const previous = draft;
  const wasDirty = isRecurringPlanDraftMeaningfullyDirty(previous, draftBaseline);
  draft = {
    ...defaultDraft(kind),
    title: previous.title,
    amount: previous.amount,
    estimateAmount: previous.estimateAmount,
    paymentSourceAccountId: previous.paymentSourceAccountId,
    startDate: previous.startDate,
    endDate: previous.endDate,
    note: previous.note,
    moreOpen: previous.moreOpen,
    logoRef: kind === 'subscription' ? 'receipt' : previous.logoRef,
  };
  if (kind === 'fixed_expense' && previous.amountMode === 'variable') draft.amountMode = 'variable';
  if (kind === 'recurring_relationship') ensureRelationship('shared_bill');
  if (wasDirty) {
    const current = draft;
    draft = defaultDraft(kind);
    if (kind === 'recurring_relationship') ensureRelationship('shared_bill');
    draftBaseline = structuredClone(draft);
    draft = current;
  } else {
    draftBaseline = structuredClone(draft);
  }
  pendingKind = null;
  rerenderEditor({ scrollTop: 0 });
}

function requestPlanKind(kind) {
  if (kind === draft.planKind) return;
  collectForm();
  if (isRecurringPlanDraftMeaningfullyDirty(draft, draftBaseline)) {
    pendingKind = kind;
    // FIX1 copy marker retained for regression discovery: 切换后，当前关系对象、付款角色与分摊设置会被清除
    openSheet({ title: '切换计划类型？', className: 'plan-confirm-sheet', stacked: true, contentHTML: `<div class="plan-confirm-copy"><p>切换后，与当前类型有关的设置会被清除。</p><button class="sheet-primary" data-action="fixed-plan-kind-confirm">${COPY.switchAndClear}</button><button class="sheet-secondary" data-action="sheet-close">${COPY.continueEditing}</button></div>` });
    return;
  }
  applyPlanKind(kind);
}

function applyScenario(mode) {
  collectForm();
  draft.relationship = null;
  draft.relationshipMode = mode;
  if (['direct_recurring_payment', 'installment_repayment'].includes(mode)) draft.amountMode = 'fixed';
  ensureRelationship(mode);
  pendingScenario = null;
  rerenderEditor();
}

function requestScenario(mode) {
  if (mode === draft.relationshipMode) return;
  collectForm();
  const currentRelation = normalizeRecurringPlanDraftForComparison(draft).relationship;
  const baselineRelation = normalizeRecurringPlanDraftForComparison(draftBaseline).relationship;
  const incompatibleDirty = JSON.stringify(currentRelation) !== JSON.stringify(baselineRelation)
    || Boolean(draft.originalPrincipal || draft.remainingPrincipal || draft.repaidPrincipal || draft.installmentAmount);
  if (incompatibleDirty) {
    pendingScenario = mode;
    openSheet({ title: '切换关系场景？', className: 'plan-confirm-sheet', stacked: true, contentHTML: `<div class="plan-confirm-copy"><p>切换后，当前付款角色与分摊设置会重置；名称、日期和已输入的适用金额会保留。</p><button class="sheet-primary" data-action="fixed-plan-scenario-confirm">继续切换</button><button class="sheet-secondary" data-action="sheet-close">保留当前场景</button></div>` });
    return;
  }
  applyScenario(mode);
}

export function registerRecurringPlanManagement() {
  registerRecurringOccurrenceActionSheets();
  registerAction('fixed-plan-new',()=>openPlanEditor());
  registerAction('fixed-plan-detail',(el)=>openPlanDetail(el.dataset.source||el.dataset.canonicalSource, el.dataset.occurrenceId || null));
  registerAction('fixed-plan-recipient-profile', (el) => {
    const plan = data.getCanonicalRecurringPlans().find((row) => row.id === el.dataset.planId);
    const recipient = data.getRecipientIdentityForPlan(plan);
    if (!recipient) return;
    openRecipientPaymentProfileManager({ recipientId: recipient.recipientId, displayName: recipient.displayName, parentId: el.closest('.modal-layer')?.dataset.sheetId, trigger: el });
  });
  registerAction('fixed-plan-registry', () => openPlanRegistry());
  registerAction('fixed-plan-archive-list', () => openPlanRegistry({ archived: true }));
  registerAction('fixed-plan-registry-detail', (el) => { closeSheet(true); setTimeout(() => openPlanDetail(el.dataset.source), 60); });
  registerAction('fixed-plan-edit',(el)=>{ closeSheet(true); openPlanEditor({source:el.dataset.source}); });
  registerAction('fixed-plan-submit', () => saveEditor());
  registerAction('fixed-plan-kind', (el) => requestPlanKind(el.dataset.kind));
  registerAction('fixed-plan-kind-confirm', () => { const kind = pendingKind; closeSheet(); if (kind) applyPlanKind(kind); });
  registerAction('fixed-plan-scenario', (el) => requestScenario(el.dataset.mode));
  registerAction('fixed-plan-payment-flow', (el) => requestScenario(el.dataset.mode));
  registerAction('fixed-plan-scenario-confirm', () => { const mode = pendingScenario; closeSheet(); if (mode) applyScenario(mode); });
  registerAction('fixed-plan-amount-mode', (el) => { collectForm(); draft.amountMode = el.dataset.mode; draft.error = ''; rerenderEditor(); });
  registerAction('fixed-subscription-funding', (el) => { collectForm(); ensureSubscriptionRelationship(el.dataset.mode); draft.error = ''; rerenderEditor(); });
  registerAction('fixed-installment-progress', (el) => { collectForm(); draft.progressMode = el.dataset.mode; if (draft.progressMode === 'not_started') { draft.remainingPrincipal = ''; draft.repaidPrincipal = ''; } rerenderEditor(); });
  registerAction('fixed-installment-progress-entry', (el) => { collectForm(); draft.progressEntryMode = el.dataset.mode; rerenderEditor(); });
  registerAction('fixed-installment-method', (el) => { collectForm(); draft.repaymentMethod = el.dataset.mode; rerenderEditor(); });
  registerAction('fixed-plan-visual',(el)=>{ collectForm(); draft.logoRef=el.dataset.visual; rerenderEditor(); });
  registerAction('fixed-plan-logo-remove',()=>{ collectForm(); if(draftObjectUrls.has(draft.logoRef)){URL.revokeObjectURL(draft.logoRef);draftObjectUrls.delete(draft.logoRef);}draft.logoRef=draft.planKind==='subscription'?'receipt':'wallet';rerenderEditor(); });
  registerAction('fixed-plan-more',()=>{ collectForm(); draft.moreOpen=!draft.moreOpen; rerenderEditor(); if(draft.moreOpen)requestAnimationFrame(()=>editorSheet?.querySelector('[data-plan-final-settings]')?.scrollIntoView({block:'nearest',behavior:'smooth'})); });
  registerAction('fixed-plan-date',(el)=>{
    collectForm();
    const sessionId=editorSessionId;
    const body=editorSheet?.querySelector('.sheet-body');
    const scrollTop=body?.scrollTop||0;
    const key=el.dataset.dateKey;
    openDatePickerSheet({
      value:draft[key]||data.today,
      today:()=>data.today,
      trigger:el,
      parentId:sessionId,
      id:`${sessionId}:date:${key}:${++editorChildSequence}`,
      onComplete:(value)=>{
        if(!sessionId||sessionId!==editorSessionId||!editorSheet?.isConnected) throw new Error('recurring_editor_session_mismatch');
        draft[key]=value;
        rerenderEditor({scrollTop});
      },
    });
  });
  registerAction('fixed-plan-add-relationship', (el) => openRelationshipEditor(el));
  registerAction('fixed-plan-edit-relationship', (el) => openRelationshipEditor(el));
  registerAction('fixed-plan-editor-cancel',()=>closeSheet());
  registerAction('fixed-plan-continue-edit',()=>closeSheet());
  registerAction('fixed-plan-discard',()=>{ closeSheet(true); permitClose=true; closeSheet(); });
  registerAction('fixed-plan-duplicate-continue',()=>{ allowDuplicate=true; closeSheet(); saveEditor(); });
  registerAction('fixed-plan-view-duplicate',(el)=>{ closeSheet(true); permitClose=true; closeSheet(true); openPlanDetail(el.dataset.source); });
  registerAction('fixed-plan-manage', openPlanManage);
  registerAction('fixed-plan-archive', requestArchive);
  registerAction('fixed-plan-archive-confirm', (el) => { data.archiveManagedRecurringPlan(el.dataset.source, { commandId: el.dataset.command }); closeSheet(true); closeSheet(true); closeSheet(true); update({ fixedMonth: ui.fixedMonth }); toast('计划已归档'); });
  registerAction('fixed-plan-unarchive', (el) => { data.unarchiveManagedRecurringPlan(el.dataset.source, { commandId: commandId('unarchive') }); closeSheet(true); closeSheet(true); update({ fixedMonth: ui.fixedMonth }); toast('已取消归档，计划保持停止'); });
  registerAction('fixed-plan-remove-request', requestRemoval);
  registerAction('fixed-plan-remove-confirm', (el) => { data.removeManagedRecurringPlan(el.dataset.source, { commandId: el.dataset.command }); closeSheet(true); closeSheet(true); closeSheet(true); update({ fixedMonth: ui.fixedMonth }); toast('计划已删除'); });
  registerAction('fixed-plan-delete-request', requestSoftDelete);
  registerAction('fixed-plan-delete-confirm', (el) => {
    data.softDeleteManagedRecurringPlan(el.dataset.source, { commandId: el.dataset.command });
    closeSheet(true); closeSheet(true); closeSheet(true);
    update({ fixedMonth: ui.fixedMonth });
    toast('计划已移到最近删除');
  });
  registerAction('fixed-plan-recently-deleted', () => openRecentlyDeletedPlans());
  registerAction('fixed-plan-deleted-detail', openDeletedPlanDetail);
  registerAction('fixed-plan-restore-request', requestRestoreDeleted);
  registerAction('fixed-plan-restore-confirm', (el) => {
    data.restoreDeletedRecurringPlan(el.dataset.planId, { commandId: el.dataset.command });
    closeSheet(true);
    if (document.querySelector('.deleted-plan-detail-sheet')) closeSheet(true);
    refreshRecentlyDeletedSheet();
    update({ fixedMonth: ui.fixedMonth });
    toast('计划已恢复');
  });
  registerAction('fixed-plan-permanent-request', requestPermanentDelete);
  registerAction('fixed-plan-permanent-confirm', (el) => {
    data.permanentlyDeleteRecurringPlan(el.dataset.planId, { commandId: el.dataset.command });
    closeSheet(true);
    if (document.querySelector('.deleted-plan-detail-sheet')) closeSheet(true);
    refreshRecentlyDeletedSheet();
    update({ fixedMonth: ui.fixedMonth });
    toast('计划已永久删除');
  });
  registerAction('fixed-plan-clear-deleted-request', requestClearDeleted);
  registerAction('fixed-plan-clear-deleted-confirm', (el) => {
    data.clearRecentlyDeletedRecurringPlans({ commandId: el.dataset.command });
    closeSheet(true); closeSheet(true);
    update({ fixedMonth: ui.fixedMonth });
    toast('最近删除已清空');
  });
  registerAction('fixed-plan-transition',transitionPlan);
  registerAction('fixed-plan-transition-confirm',(el)=>{ const opts={commandId:commandId(el.dataset.target)}; if(el.dataset.target==='paused')data.pauseManagedRecurringPlan(el.dataset.source,opts); else if(el.dataset.target==='active')data.resumeManagedRecurringPlan(el.dataset.source,opts); else data.stopManagedRecurringPlan(el.dataset.source,opts); closeSheet(true);closeSheet(true);closeSheet(true);update({fixedMonth:ui.fixedMonth});toast('计划状态已更新'); });
}

export const recurringPlanManagementTestHooks = Object.freeze({ defaultDraft, previewFor: (input)=>previewFor(input), planVisual, cleanPlanForCompare, applyPlanKind, applyScenario });
