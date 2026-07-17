import { daysBetween } from '../app/format.js';
import { canonicalSourceKey, normalizeRecurringPlan, recurringError } from './recurringPlanModel.js';
import { deterministicOccurrenceId, occurrenceStatus } from './recurringSchedule.js';
import { deriveRecurringOccurrencePresentation } from './recurringOccurrencePresentation.js';

export function projectObligationPlan(plan, { authenticatedParticipantId = 'participant-me' } = {}) {
  if (plan.planType !== 'recurring_monthly' || !plan.projection?.fixedCenterEligible) return null;
  const otherParticipantId = plan.creditorParticipantId === authenticatedParticipantId ? plan.debtorParticipantId : plan.creditorParticipantId;
  const payable = plan.debtorParticipantId === authenticatedParticipantId;
  const amountMinor = Number(plan.amountMinor);
  return normalizeRecurringPlan({
    id: `obligation-${plan.planId}`,
    planKind: 'recurring_relationship',
    title: plan.title,
    categoryId: 'expense-fallback',
    currency: plan.currency || 'MYR',
    totalAmountMinor: amountMinor,
    schedule: { recurrence: 'monthly', dueDay: plan.dueDay, timezone: 'Asia/Kuala_Lumpur' },
    startDate: plan.startDate,
    endDate: plan.endDate || null,
    status: plan.status === 'completed' ? 'stopped' : plan.status,
    paymentSourceAccountId: plan.defaultAccountId || null,
    provider: { type: 'relationship_obligation', obligationPlanId: plan.planId },
    relationship: {
      ledgerId: plan.ledgerId,
      participantIds: [authenticatedParticipantId, otherParticipantId],
      authenticatedParticipantId,
      payerParticipantId: payable ? otherParticipantId : authenticatedParticipantId,
      splitMode: 'custom',
      shares: payable
        ? [{ participantId: authenticatedParticipantId, amountMinor }, { participantId: otherParticipantId, amountMinor: 0 }]
        : [{ participantId: authenticatedParticipantId, amountMinor: 0 }, { participantId: otherParticipantId, amountMinor }],
      relationshipLabel: null,
    },
    canonicalSource: { sourceType: 'obligation_plan', sourceId: plan.planId },
    recordOnlyDefault: false,
    note: plan.description || null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    revision: plan.revision || 1,
    history: plan.history || [],
  });
}

export function projectObligationOccurrence(plan, instance, referenceDate) {
  const projectedPlan = projectObligationPlan(plan);
  if (!projectedPlan || instance.planId !== plan.planId) return null;
  const paid = Number(instance.amountPaidMinor || 0) >= Number(instance.amountDueMinor);
  const recordedStatus = instance.status === 'skipped' ? 'skipped' : paid ? 'paid' : null;
  const periodKey = instance.periodKey;
  const occurrence = {
    id: deterministicOccurrenceId(projectedPlan, periodKey),
    planId: projectedPlan.id,
    canonicalSource: structuredClone(projectedPlan.canonicalSource),
    periodKey,
    monthKey: instance.dueDate.slice(0, 7),
    dueDate: instance.dueDate,
    totalAmountMinor: instance.amountDueMinor,
    ownShareMinor: instance.amountDueMinor,
    cashOutflowMinor: 0,
    receivableMinor: 0,
    payableMinor: instance.amountDueMinor,
    recordedStatus,
    postedTransactionId: instance.postedTransactionId || null,
    relationshipEntryId: instance.relationshipEntryId || null,
    recurringPostingId: instance.recurringPostingId || null,
    postedAmountMinor: instance.postedAmountMinor || null,
    attachmentIds: structuredClone(instance.attachmentIds || []),
    postingAudit: structuredClone(instance.postingAudit || null),
    reversalAudit: structuredClone(instance.reversalAudit || null),
    generatedAt: instance.generatedAt,
    planRevision: projectedPlan.revision,
    revision: instance.revision || 1,
  };
  return { ...occurrence, status: occurrenceStatus(occurrence, projectedPlan, referenceDate) };
}

export function dedupeCanonicalPlans(plans) {
  const bySource = new Map();
  plans.filter(Boolean).forEach((plan) => {
    const key = canonicalSourceKey(plan.canonicalSource);
    const existing = bySource.get(key);
    if (!existing) bySource.set(key, plan);
    else if (existing.id !== plan.id) recurringError('duplicate_canonical_source', '同一来源出现多个计划投影', { sourceKey: key, planIds: [existing.id, plan.id] });
  });
  return [...bySource.values()].map((plan) => structuredClone(plan));
}

export function dedupeCanonicalOccurrences(occurrences) {
  const byIdentity = new Map();
  occurrences.filter(Boolean).forEach((occurrence) => {
    const key = `${canonicalSourceKey(occurrence.canonicalSource)}:${occurrence.periodKey}`;
    const existing = byIdentity.get(key);
    if (!existing) byIdentity.set(key, occurrence);
    else if (existing.id !== occurrence.id) recurringError('duplicate_occurrence_identity', '同一账期出现重复投影', { periodIdentity: key });
  });
  return [...byIdentity.values()].map((occurrence) => structuredClone(occurrence));
}

export function projectFixedRelationshipsForLedger(plans, ledgerId) {
  return dedupeCanonicalPlans(plans)
    .filter((plan) => !plan.archivedAt && plan.relationship?.ledgerId === ledgerId)
    .map((plan) => ({
      canonicalPlanId: plan.id,
      canonicalSource: structuredClone(plan.canonicalSource),
      ledgerId,
      title: plan.title,
      status: plan.status,
      ownShareMinor: plan.ownShareMinor,
      recurrence: plan.schedule.recurrence,
      projectionOnly: true,
    }));
}

function rowFor(occurrence, plan, referenceDate) {
  const status = occurrence.status || occurrenceStatus(occurrence, plan, referenceDate);
  const normalizedOccurrence = { ...occurrence, status };
  return {
    ...structuredClone(normalizedOccurrence),
    status,
    presentation: deriveRecurringOccurrencePresentation(normalizedOccurrence, plan, referenceDate),
    plan: structuredClone(plan),
    canonicalPlanId: plan.id,
    canonicalSourceKey: canonicalSourceKey(plan.canonicalSource),
  };
}

export function selectRecurringMonth({ plans, occurrences, monthKey, referenceDate, dueSoonDays = 7 }) {
  const canonicalPlans = dedupeCanonicalPlans(plans);
  const visiblePlans = canonicalPlans.filter((plan) => !plan.archivedAt);
  const archivedPlans = canonicalPlans.filter((plan) => Boolean(plan.archivedAt));
  const plansById = new Map(visiblePlans.map((plan) => [plan.id, plan]));
  const rows = dedupeCanonicalOccurrences(occurrences)
    .filter((occurrence) => occurrence.monthKey === monthKey && plansById.has(occurrence.planId))
    .map((occurrence) => rowFor(occurrence, plansById.get(occurrence.planId), referenceDate))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const countable = rows.filter((row) => !['skipped', 'paused', 'stopped', 'not_started'].includes(row.status));
  const paid = countable.filter((row) => row.status === 'paid');
  const overdue = countable.filter((row) => row.status === 'overdue');
  const pending = countable.filter((row) => ['upcoming', 'due_today'].includes(row.status));
  const dueSoon = pending.filter((row) => {
    const days = daysBetween(referenceDate, row.dueDate);
    return days >= 0 && days <= dueSoonDays;
  });
  const planned = pending.filter((row) => !dueSoon.includes(row));
  const variablePending = countable.filter((row) => row.amountMode === 'variable' && row.amountPending);
  const estimatedRows = countable.filter((row) => row.amountMode === 'variable' && row.amountState === 'estimated');
  const pausedPlans = visiblePlans.filter((plan) => plan.status === 'paused');
  const stoppedPlans = visiblePlans.filter((plan) => plan.status === 'stopped');
  const sum = (collection, key) => collection.reduce((total, row) => total + Number(row[key] || 0), 0);
  return {
    monthKey,
    plans: visiblePlans,
    rows,
    sections: { overdue, dueSoon, planned, paid, pausedPlans, stoppedPlans, archivedPlans },
    filters: {
      subscriptions: visiblePlans.filter((plan) => plan.planKind === 'subscription'),
      fixedExpenses: visiblePlans.filter((plan) => plan.planKind === 'fixed_expense'),
      relationshipRecurring: visiblePlans.filter((plan) => plan.planKind === 'recurring_relationship'),
      paused: pausedPlans,
      stopped: stoppedPlans,
      archived: archivedPlans,
    },
    summary: {
      myFixedMinor: sum(countable, 'ownShareMinor'),
      paidOwnShareMinor: sum(paid, 'ownShareMinor'),
      pendingOwnShareMinor: sum(pending, 'ownShareMinor'),
      overdueOwnShareMinor: sum(overdue, 'ownShareMinor'),
      upcomingOwnShareMinor: sum(pending, 'ownShareMinor'),
      plannedCashOutflowMinor: sum(countable, 'cashOutflowMinor'),
      plannedReceivableMinor: sum(countable, 'receivableMinor'),
      plannedPayableMinor: sum(countable, 'payableMinor'),
      estimatedCommitmentMinor: sum(estimatedRows, 'ownShareMinor'),
      variableAmountPendingCount: variablePending.length,
      containsEstimate: estimatedRows.length > 0,
    },
  };
}

export function selectTodayFixed(monthProjection) {
  return {
    myFixedMinor: monthProjection.summary.myFixedMinor,
    estimatedCommitmentMinor: monthProjection.summary.estimatedCommitmentMinor,
    variableAmountPendingCount: monthProjection.summary.variableAmountPendingCount,
    containsEstimate: monthProjection.summary.containsEstimate,
    canonicalPlanIds: monthProjection.rows
      .filter((row) => !['skipped', 'paused', 'stopped', 'not_started'].includes(row.status))
      .map((row) => row.canonicalPlanId),
  };
}
