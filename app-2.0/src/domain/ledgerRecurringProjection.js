// Person/group-oriented projections over the canonical recurring-plan source.
// This module is deliberately read-only: it never posts a transaction, changes
// a relationship balance, or advances installment principal.

import { daysBetween } from '../app/format.js';
import { canonicalSourceKey } from './recurringPlanModel.js';
import { calculateRecurringRelationshipProjection } from './recurringRelationshipModel.js';
import { deriveRecurringOccurrencePresentation } from './recurringOccurrencePresentation.js';
import { derivePlanVisualPresentation } from './planVisualPresentation.js';

const ME = 'participant-me';
const EXCLUDED_ACTION_STATES = new Set(['paid', 'skipped', 'paused', 'stopped', 'not_started']);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function participantMap(participants = []) {
  return new Map(participants.map((participant) => [participant.participantId, participant]));
}

function participantName(id, participantsById) {
  if (id === ME) return '我';
  return participantsById.get(id)?.displayName || '成员';
}

function cadenceLabel(plan) {
  return plan.schedule?.recurrence === 'yearly' ? ' / 年' : ' / 月';
}

function sourceIdentity(value) {
  return canonicalSourceKey(value.canonicalSource);
}

export function selectRecurringPlansForLedger(plans, ledgerId, { includeArchived = false } = {}) {
  const bySource = new Map();
  (plans || []).forEach((plan) => {
    if (plan.relationship?.ledgerId !== ledgerId) return;
    if (!includeArchived && plan.archivedAt) return;
    const key = sourceIdentity(plan);
    const existing = bySource.get(key);
    if (existing && existing.id !== plan.id) throw new Error(`duplicate_ledger_canonical_plan:${key}`);
    bySource.set(key, plan);
  });
  return [...bySource.values()]
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id))
    .map(clone);
}

export function selectRecurringOccurrencesForLedger({ plans, occurrences, ledgerId } = {}) {
  const selectedPlans = selectRecurringPlansForLedger(plans, ledgerId, { includeArchived: true });
  const byPlan = new Map(selectedPlans.map((plan) => [plan.id, plan]));
  const byId = new Map();
  (occurrences || []).forEach((occurrence) => {
    if (!byPlan.has(occurrence.planId)) return;
    const existing = byId.get(occurrence.id);
    if (existing && sourceIdentity(existing) !== sourceIdentity(occurrence)) throw new Error(`duplicate_ledger_occurrence:${occurrence.id}`);
    byId.set(occurrence.id, occurrence);
  });
  return [...byId.values()]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    .map(clone);
}

export function deriveLedgerMoneyFlow(plan, participants = []) {
  const relationship = plan.relationship;
  const mode = plan.relationshipMode || relationship?.relationshipMode;
  const names = participantMap(participants);
  const cadence = cadenceLabel(plan);
  const amountMinor = Number(plan.plannedAmountMinor ?? plan.totalAmountMinor ?? 0);
  const projection = calculateRecurringRelationshipProjection(amountMinor, mode, relationship);
  const result = {
    mode,
    amountMinor,
    cadence,
    sourceParticipantId: null,
    destinationParticipantId: null,
    collectorParticipantId: relationship?.collectorParticipantId || null,
    externalPayerParticipantId: relationship?.externalPayerParticipantId || null,
    payerParticipantId: relationship?.payerParticipantId || null,
    recipientParticipantId: relationship?.recipientParticipantId || null,
    creditorParticipantId: relationship?.creditorParticipantId || null,
    debtorParticipantId: relationship?.debtorParticipantId || null,
    plannedReceivableMinor: Number(projection.receivableMinor || 0),
    plannedPayableMinor: Number(projection.payableMinor || 0),
    primary: '',
    secondary: '',
  };

  if (plan.planKind === 'subscription' && plan.subscriptionFundingMode === 'other_pays') {
    const payer = relationship?.payerParticipantId;
    result.sourceParticipantId = ME;
    result.destinationParticipantId = payer;
    result.primary = `${participantName(payer, names)} 代付 · 我需还`;
    return result;
  }
  if (plan.planKind === 'subscription' && plan.subscriptionFundingMode === 'user_pays_for_other') {
    const other = relationship?.participantIds?.find((id) => id !== ME);
    result.sourceParticipantId = other;
    result.destinationParticipantId = ME;
    result.primary = `我代付 · ${participantName(other, names)}需还`;
    return result;
  }

  if (mode === 'central_collection') {
    const collector = relationship.collectorParticipantId;
    const ownShareMinor = Number(relationship.shares?.find((share) => share.participantId === ME)?.amountMinor || 0);
    result.amountMinor = collector === ME ? Math.max(0, amountMinor - ownShareMinor) : ownShareMinor;
    result.sourceParticipantId = collector === ME ? null : ME;
    result.destinationParticipantId = collector;
    result.primary = collector === ME ? `成员交给我` : `我交给${participantName(collector, names)}`;
    result.secondary = `${participantName(relationship.externalPayerParticipantId, names)}统一付款`;
    return result;
  }

  if (mode === 'shared_bill') {
    const payer = relationship.payerParticipantId;
    if (payer === ME) {
      const otherShares = relationship.shares?.filter((share) => share.participantId !== ME) || [];
      const personalOther = relationship.participantIds.length === 2 ? relationship.participantIds.find((id) => id !== ME) : null;
      result.amountMinor = otherShares.reduce((sum, share) => sum + Number(share.amountMinor || 0), 0);
      result.sourceParticipantId = personalOther;
      result.destinationParticipantId = ME;
      result.primary = personalOther ? `${participantName(personalOther, names)} → 我` : '我先付 · 成员预计归还';
      result.secondary = '我先付款';
    } else {
      const ownShareMinor = Number(relationship.shares?.find((share) => share.participantId === ME)?.amountMinor || 0);
      result.amountMinor = ownShareMinor;
      result.sourceParticipantId = ME;
      result.destinationParticipantId = payer;
      result.primary = `我 → ${participantName(payer, names)}`;
      result.secondary = `${participantName(payer, names)}先付款`;
    }
    return result;
  }

  if (mode === 'direct_recurring_payment') {
    const recipient = relationship.recipientParticipantId;
    const source = recipient === ME ? relationship.participantIds.find((id) => id !== ME) : ME;
    result.sourceParticipantId = source;
    result.destinationParticipantId = recipient;
    result.primary = `${participantName(source, names)} → ${participantName(recipient, names)}`;
    return result;
  }

  if (mode === 'installment_repayment') {
    result.sourceParticipantId = relationship.debtorParticipantId;
    result.destinationParticipantId = relationship.creditorParticipantId;
    result.amountMinor = Math.min(Number(relationship.installmentAmountMinor || amountMinor), Number(relationship.remainingPrincipalMinor || 0));
    result.primary = `${participantName(relationship.debtorParticipantId, names)} → ${participantName(relationship.creditorParticipantId, names)}`;
    const completed = Number(relationship.completedInstallments || 0);
    const planned = Number(relationship.plannedInstallmentCount || 0);
    result.remainingPrincipalMinor = Number(relationship.remainingPrincipalMinor || 0);
    result.remainingPeriods = planned ? Math.max(0, planned - completed) : projection.remainingInstallments;
    result.finalInstallmentMinor = Number(relationship.finalInstallmentMinor || projection.finalInstallmentMinor || 0);
    result.secondary = `剩余本金`;
    return result;
  }

  result.primary = plan.planKind === 'subscription' ? '订阅计划' : '定期计划';
  return result;
}

export function deriveLedgerRecurringPlanPresentation({ plan, occurrences = [], participants = [], referenceDate } = {}) {
  const rows = occurrences.filter((occurrence) => occurrence.planId === plan.id);
  const currentMonth = referenceDate.slice(0, 7);
  const occurrence = rows.find((row) => row.monthKey === currentMonth)
    || rows.find((row) => row.dueDate >= referenceDate)
    || rows.at(-1)
    || null;
  const occurrencePresentation = occurrence ? deriveRecurringOccurrencePresentation(occurrence, plan, referenceDate) : null;
  const visual = derivePlanVisualPresentation(plan, occurrence, { context: 'ledger', referenceDate, participants });
  const flow = deriveLedgerMoneyFlow(plan, participants);
  const scheduledAmountMinor = flow.amountMinor;
  const occurrenceAmountMinor = occurrence
    ? flow.destinationParticipantId === ME && Number(occurrence.receivableMinor || 0) > 0
      ? Number(occurrence.receivableMinor)
      : flow.sourceParticipantId === ME && Number(occurrence.payableMinor || 0) > 0
        ? Number(occurrence.payableMinor)
        : Number(occurrence.ownShareMinor || 0) || scheduledAmountMinor
    : scheduledAmountMinor;
  flow.amountMinor = occurrenceAmountMinor;
  const completedInstallment = plan.relationshipMode === 'installment_repayment'
    && Number(plan.relationship?.remainingPrincipalMinor || 0) === 0;
  const lifecycle = plan.archivedAt ? 'archived' : completedInstallment ? 'completed' : plan.status;
  return {
    planId: plan.id,
    canonicalPlanId: plan.id,
    canonicalSource: clone(plan.canonicalSource),
    canonicalSourceKey: sourceIdentity(plan),
    ledgerId: plan.relationship?.ledgerId,
    planKind: plan.planKind,
    relationshipMode: plan.relationshipMode,
    title: plan.title,
    lifecycle,
    occurrence: clone(occurrence),
    occurrenceId: occurrence?.id || null,
    occurrenceStatus: occurrence?.status || lifecycle,
    semanticState: occurrencePresentation?.semanticState || lifecycle,
    tone: occurrencePresentation?.tone || 'neutral',
    statusLabel: occurrencePresentation?.label || (lifecycle === 'paused' ? '已暂停' : lifecycle === 'stopped' ? '已停止' : lifecycle === 'completed' ? '已完成' : '进行中'),
    dueDate: occurrence?.dueDate || null,
    amountPending: Boolean(plan.amountPending || occurrence?.amountPending),
    visual,
    moneyFlow: flow,
    scheduledAmountMinor,
    occurrenceAmountMinor,
    projectionOnly: true,
  };
}

export function deriveLedgerCurrentAction(presentation, referenceDate, { dueSoonDays = 7 } = {}) {
  const occurrence = presentation.occurrence;
  if (!occurrence || presentation.lifecycle !== 'active' || EXCLUDED_ACTION_STATES.has(occurrence.status)) return null;
  const days = daysBetween(referenceDate, occurrence.dueDate);
  const waiting = Boolean(presentation.amountPending);
  const relevant = occurrence.status === 'overdue' || occurrence.status === 'due_today' || waiting || (days >= 0 && days <= dueSoonDays);
  if (!relevant) return null;
  const priority = occurrence.status === 'overdue' ? 0 : occurrence.status === 'due_today' ? 1 : waiting ? 2 : 3;
  return {
    ...clone(presentation),
    priority,
    daysUntilDue: days,
    actionLabel: waiting ? '填写资料' : '查看本期',
  };
}

export function buildLedgerRecurringProjection({ plans, occurrences, ledgerId, participants = [], referenceDate, dueSoonDays = 7 } = {}) {
  const selectedPlans = selectRecurringPlansForLedger(plans, ledgerId);
  const selectedOccurrences = selectRecurringOccurrencesForLedger({ plans: selectedPlans, occurrences, ledgerId });
  const cards = selectedPlans
    .map((plan) => deriveLedgerRecurringPlanPresentation({ plan, occurrences: selectedOccurrences, participants, referenceDate }));
  const currentActions = cards
    .map((card) => deriveLedgerCurrentAction(card, referenceDate, { dueSoonDays }))
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || a.dueDate.localeCompare(b.dueDate) || a.planId.localeCompare(b.planId));
  const currentMonth = referenceDate.slice(0, 7);
  const currentRows = selectedOccurrences.filter((row) => row.monthKey === currentMonth && !EXCLUDED_ACTION_STATES.has(row.status));
  return {
    ledgerId,
    planIds: selectedPlans.map((plan) => plan.id),
    occurrenceIds: selectedOccurrences.map((row) => row.id),
    cards,
    currentActions,
    summary: {
      label: '本月计划',
      plannedReceivableMinor: currentRows.reduce((sum, row) => sum + Number(row.receivableMinor || 0), 0),
      plannedPayableMinor: currentRows.reduce((sum, row) => sum + Number(row.payableMinor || 0), 0),
      postingCount: 0,
    },
  };
}

export const ledgerRecurringProjectionTestHooks = Object.freeze({ participantName, cadenceLabel });
