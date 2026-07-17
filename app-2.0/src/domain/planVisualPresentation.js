// Canonical read-only presentation for recurring plans and occurrences.
// It labels financial meaning without posting money or duplicating plan state.

import { deriveRecurringOccurrencePresentation } from './recurringOccurrencePresentation.js';
import { calculateRecurringRelationshipProjection } from './recurringRelationshipModel.js';

const ME = 'participant-me';

const TYPE_LABELS = Object.freeze({
  fixed_expense: '固定支出',
  subscription: '订阅',
  shared_bill: '共同费用',
  central_collection: '统一收款',
  direct_recurring_payment: '定期往来',
  installment_repayment: '分期还款',
});

const PLAN_STATE_LABELS = Object.freeze({
  active: '进行中', paused: '已暂停', stopped: '已停止', archived: '已归档', completed: '已完成',
});

function participantName(id, context) {
  if (!id || id === ME) return '我';
  if (typeof context.participantName === 'function') return context.participantName(id) || '关系对象';
  return context.participants?.find((row) => row.participantId === id)?.displayName || '关系对象';
}

function accountName(plan, context) {
  if (plan.planKind === 'subscription' && plan.subscriptionFundingMode === 'other_pays') return '';
  if (!plan.paymentSourceAccountId) return plan.recordOnlyDefault ? '只记录' : '';
  if (typeof context.accountName === 'function') return context.accountName(plan.paymentSourceAccountId) || '';
  return context.accounts?.find((row) => row.id === plan.paymentSourceAccountId)?.name || '';
}

function planType(plan) {
  if (plan.relationshipMode === 'installment_repayment') return 'installment_repayment';
  if (plan.planKind === 'subscription') return 'subscription';
  if (plan.relationshipMode) return plan.relationshipMode;
  return plan.planKind;
}

function cadenceLabel(plan) {
  return plan.schedule?.recurrence === 'yearly' ? '每年' : '每月';
}

function identityMark(plan) {
  if (plan.logoRef) return plan.logoRef;
  if (plan.relationshipMode === 'installment_repayment') return 'receipt';
  if (plan.planKind === 'recurring_relationship') return 'users';
  if (plan.planKind === 'subscription') return 'receipt';
  return plan.categoryId === 'home' ? 'home' : plan.categoryId === 'health' ? 'heart' : 'wallet';
}

function snapshotAmounts(plan, occurrence) {
  const totalAmountMinor = Number(occurrence?.totalAmountMinor ?? plan.totalAmountMinor ?? 0);
  const projection = calculateRecurringRelationshipProjection(totalAmountMinor, plan.relationshipMode, plan.relationship);
  return {
    totalAmountMinor,
    ownShareMinor: Number(occurrence?.ownShareMinor ?? projection.ownShareMinor ?? totalAmountMinor),
    cashOutflowMinor: Number(occurrence?.cashOutflowMinor ?? projection.cashOutflowMinor ?? totalAmountMinor),
    receivableMinor: Number(occurrence?.receivableMinor ?? projection.receivableMinor ?? 0),
    payableMinor: Number(occurrence?.payableMinor ?? projection.payableMinor ?? 0),
    projection,
  };
}

function relationshipAmounts(plan, occurrence, context) {
  const amounts = snapshotAmounts(plan, occurrence);
  const relationship = plan.relationship;
  const mode = plan.relationshipMode;
  const me = relationship?.authenticatedParticipantId || ME;
  const secondaryAmounts = [];
  let primaryAmountLabel = '本期需付';
  let primaryAmountMinor = amounts.ownShareMinor;
  let moneyFlowLabel = '';

  if (mode === 'shared_bill') {
    const payer = relationship.payerParticipantId;
    const payerName = participantName(payer, context);
    if (payer === me) {
      primaryAmountLabel = '本期先付';
      primaryAmountMinor = amounts.cashOutflowMinor || amounts.totalAmountMinor;
      moneyFlowLabel = '我先付款';
      secondaryAmounts.push({ label: '我的份额', amountMinor: amounts.ownShareMinor });
      if (amounts.receivableMinor) secondaryAmounts.push({ label: '预计收回', amountMinor: amounts.receivableMinor, tone: 'positive' });
    } else {
      primaryAmountLabel = `本期需还 ${payerName}`;
      primaryAmountMinor = amounts.payableMinor || amounts.ownShareMinor;
      moneyFlowLabel = `${payerName} 代付`;
      secondaryAmounts.push({ label: '账单总额', amountMinor: amounts.totalAmountMinor });
    }
  } else if (mode === 'central_collection') {
    const collector = relationship.collectorParticipantId;
    const collectorName = participantName(collector, context);
    if (collector === me) {
      primaryAmountLabel = '预计收成员';
      primaryAmountMinor = amounts.receivableMinor;
      moneyFlowLabel = '我统一收款';
    } else {
      primaryAmountLabel = `本期交给${collectorName}`;
      primaryAmountMinor = amounts.payableMinor || amounts.ownShareMinor;
      moneyFlowLabel = `${collectorName}统一付款`;
    }
    secondaryAmounts.push({ label: '账单总额', amountMinor: amounts.totalAmountMinor });
  } else if (mode === 'direct_recurring_payment') {
    const recipient = relationship.recipientParticipantId;
    const recipientName = participantName(recipient, context);
    const other = relationship.participantIds.find((id) => id !== me);
    if (recipient === me) {
      primaryAmountLabel = `预计收 ${participantName(other, context)}`;
      primaryAmountMinor = amounts.receivableMinor || amounts.totalAmountMinor;
      moneyFlowLabel = `${participantName(other, context)} → 我`;
    } else {
      primaryAmountLabel = `本期付给${recipientName}`;
      primaryAmountMinor = amounts.payableMinor || amounts.cashOutflowMinor || amounts.totalAmountMinor;
      moneyFlowLabel = `我 → ${recipientName}`;
    }
  } else if (mode === 'installment_repayment') {
    const outgoing = relationship.debtorParticipantId === me;
    const other = outgoing ? relationship.creditorParticipantId : relationship.debtorParticipantId;
    primaryAmountLabel = outgoing ? '本期还款' : `预计收 ${participantName(other, context)}`;
    primaryAmountMinor = outgoing ? (amounts.payableMinor || amounts.cashOutflowMinor || amounts.totalAmountMinor) : (amounts.receivableMinor || amounts.totalAmountMinor);
    moneyFlowLabel = outgoing ? `我 → ${participantName(other, context)}` : `${participantName(other, context)} → 我`;
    secondaryAmounts.push({ label: '剩余', amountMinor: Number(relationship.remainingPrincipalMinor || 0) });
  }
  return { ...amounts, primaryAmountLabel, primaryAmountMinor, secondaryAmounts, moneyFlowLabel };
}

function installmentProgress(plan) {
  if (plan.relationshipMode !== 'installment_repayment') return null;
  const relationship = plan.relationship;
  const original = Number(relationship.originalPrincipalMinor || 0);
  const remaining = Number(relationship.remainingPrincipalMinor || 0);
  const repaid = Math.max(0, original - remaining);
  const amount = Number(relationship.installmentAmountMinor || plan.totalAmountMinor || 0);
  const completedPeriods = Number(relationship.completedInstallments ?? Math.floor(repaid / Math.max(1, amount)));
  const plannedPeriods = Number(relationship.plannedInstallmentCount || 0);
  const remainingPeriods = plannedPeriods
    ? Math.max(0, plannedPeriods - completedPeriods)
    : (remaining && amount ? Math.ceil(remaining / amount) : 0);
  return {
    originalPrincipalMinor: original,
    repaidPrincipalMinor: repaid,
    remainingPrincipalMinor: remaining,
    completedPeriods,
    remainingPeriods,
    normalInstallmentMinor: amount,
    finalInstallmentMinor: Number(relationship.finalInstallmentMinor || (remaining % Math.max(1, amount) || amount)),
    ratio: original ? repaid / original : 0,
  };
}

export function derivePlanVisualPresentation(plan, occurrence = null, context = {}) {
  if (!plan?.id) throw new Error('plan_visual_requires_plan');
  const type = planType(plan);
  const archived = Boolean(plan.archivedAt);
  const progress = installmentProgress(plan);
  const completedInstallment = Boolean(progress && progress.remainingPrincipalMinor === 0);
  const planState = archived ? 'archived' : completedInstallment ? 'completed' : plan.status;
  const occurrencePresentation = context.occurrencePresentation || (occurrence
    ? deriveRecurringOccurrencePresentation(occurrence, plan, context.referenceDate)
    : null);
  const relation = plan.relationshipMode ? relationshipAmounts(plan, occurrence, context) : snapshotAmounts(plan, occurrence);
  let primaryAmountLabel = plan.planKind === 'subscription' ? '本期扣款' : '本期需付';
  let primaryAmountMinor = relation.cashOutflowMinor || relation.ownShareMinor;
  let secondaryAmounts = [];
  let moneyFlowLabel = '';

  if (plan.relationshipMode) {
    ({ primaryAmountLabel, primaryAmountMinor, secondaryAmounts, moneyFlowLabel } = relation);
  }
  const variableAwaitingActual = plan.amountMode === 'variable'
    && occurrence?.actualAmountMinor == null
    && (occurrence ? occurrence.amountPending || ['pending', 'estimated'].includes(occurrence.amountState) : context.context === 'plan-detail' || plan.amountPending);
  if (variableAwaitingActual) {
    primaryAmountLabel = '等待填写本期金额';
    primaryAmountMinor = null;
    const estimate = Number(plan.estimateAmountMinor || plan.plannedAmountMinor || 0);
    secondaryAmounts = estimate ? [{ label: '参考预算', amountMinor: estimate, isEstimate: true }] : [];
  }
  if (context.context === 'plan-library' && plan.amountMode === 'variable') {
    primaryAmountLabel = '每期金额不同';
    primaryAmountMinor = null;
    const estimate = Number(plan.estimateAmountMinor || plan.plannedAmountMinor || 0);
    secondaryAmounts = estimate ? [{ label: '参考预算', amountMinor: estimate, isEstimate: true }] : [];
  }

  const status = occurrencePresentation?.semanticState || planState;
  const statusLabel = occurrencePresentation?.label || PLAN_STATE_LABELS[planState] || planState;
  const tone = occurrencePresentation?.tone || (planState === 'completed' ? 'green' : 'neutral');
  return Object.freeze({
    planId: plan.id,
    occurrenceId: occurrence?.id || null,
    canonicalSource: structuredClone(plan.canonicalSource),
    context: context.context || 'month',
    identityMark: identityMark(plan),
    title: plan.title,
    type,
    typeLabel: TYPE_LABELS[type] || '关系固定',
    planState,
    planStateLabel: PLAN_STATE_LABELS[planState] || planState,
    status,
    statusLabel,
    tone,
    primaryAmountLabel,
    primaryAmountMinor,
    secondaryAmounts: Object.freeze(secondaryAmounts.map((value) => Object.freeze(value))),
    dateLabel: occurrencePresentation?.dateLabel || '',
    dueDate: occurrence?.dueDate || context.nextOccurrence?.dueDate || null,
    cadenceLabel: cadenceLabel(plan),
    moneyFlowLabel,
    sourceLabel: accountName(plan, context),
    progress: progress ? Object.freeze(progress) : null,
    attentionPriority: occurrencePresentation?.priority || 0,
    isActionable: Boolean(occurrencePresentation?.attention),
    amountMode: plan.amountMode,
    amountPending: primaryAmountMinor == null,
    totalAmountMinor: relation.totalAmountMinor,
    ownShareMinor: relation.ownShareMinor,
    cashOutflowMinor: relation.cashOutflowMinor,
    receivableMinor: relation.receivableMinor,
    payableMinor: relation.payableMinor,
  });
}

export const planVisualPresentationTestHooks = Object.freeze({ planType, cadenceLabel, installmentProgress, snapshotAmounts });
