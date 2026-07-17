// Phase 2C2-FIX1B pure editor/domain helpers. These functions compare drafts,
// preview dates and installment schedules only; they never post money.

import { dueDateFor } from './scheduleGenerator.js';
import { addMonths } from './scheduleGenerator.js';

function emptyToNull(value) {
  return value === '' || value === undefined ? null : value;
}

function normalizedMoney(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : text;
}

function normalizedShares(relationship) {
  if (!relationship) return null;
  const ids = [...new Set(relationship.participantIds || [])].sort();
  // Equal shares are generated presentation state. Stable participants and
  // roles remain meaningful, but generated minor-unit rows are not edits.
  const shares = relationship.splitMode === 'custom'
    ? (relationship.shares || []).map((share) => ({ participantId: share.participantId, amountMinor: Number(share.amountMinor || 0) })).sort((a, b) => a.participantId.localeCompare(b.participantId))
    : null;
  return {
    relationshipMode: relationship.relationshipMode || null,
    ledgerId: relationship.ledgerId || null,
    participantIds: ids,
    authenticatedParticipantId: relationship.authenticatedParticipantId || null,
    payerParticipantId: relationship.payerParticipantId || null,
    collectorParticipantId: relationship.collectorParticipantId || null,
    externalPayerParticipantId: relationship.externalPayerParticipantId || null,
    recipientParticipantId: relationship.recipientParticipantId || null,
    creditorParticipantId: relationship.creditorParticipantId || null,
    debtorParticipantId: relationship.debtorParticipantId || null,
    splitMode: relationship.splitMode || null,
    shares,
    originalPrincipalMinor: emptyToNull(relationship.originalPrincipalMinor),
    remainingPrincipalMinor: emptyToNull(relationship.remainingPrincipalMinor),
    installmentAmountMinor: emptyToNull(relationship.installmentAmountMinor),
    repaymentMethod: relationship.repaymentMethod || null,
    repaymentMonths: emptyToNull(relationship.repaymentMonths),
    completedInstallments: emptyToNull(relationship.completedInstallments),
  };
}

export function normalizeRecurringPlanDraftForComparison(value = {}) {
  return {
    planKind: value.planKind || null,
    title: String(value.title || '').trim() || null,
    categoryId: value.categoryId || null,
    amountMode: value.amountMode || 'fixed',
    amountMinor: normalizedMoney(value.amount),
    estimateAmountMinor: normalizedMoney(value.estimateAmount),
    schedule: {
      recurrence: value.schedule?.recurrence || 'monthly',
      dueDay: Number(value.schedule?.dueDay || 0),
      dueMonth: value.schedule?.recurrence === 'yearly' ? Number(value.schedule?.dueMonth || 0) : null,
    },
    startDate: value.startDate || null,
    endDate: emptyToNull(value.endDate),
    moveInDate: emptyToNull(value.moveInDate),
    paymentSourceAccountId: emptyToNull(value.paymentSourceAccountId),
    logoRef: emptyToNull(value.logoRef),
    relationshipMode: emptyToNull(value.relationshipMode),
    relationship: normalizedShares(value.relationship),
    subscriptionFundingMode: value.subscriptionFundingMode || 'self',
    originalPrincipalMinor: normalizedMoney(value.originalPrincipal),
    remainingPrincipalMinor: normalizedMoney(value.remainingPrincipal),
    repaidPrincipalMinor: normalizedMoney(value.repaidPrincipal),
    installmentAmountMinor: normalizedMoney(value.installmentAmount),
    repaymentMonths: Number(value.repaymentMonths || 0) || null,
    note: String(value.note || '').trim() || null,
  };
}

export function isRecurringPlanDraftMeaningfullyDirty(currentDraft, baselineDraft) {
  return JSON.stringify(normalizeRecurringPlanDraftForComparison(currentDraft))
    !== JSON.stringify(normalizeRecurringPlanDraftForComparison(baselineDraft));
}

export function deriveFirstEligibleOccurrence(plan, referenceContext = {}) {
  const startDate = referenceContext.startDate || plan?.startDate;
  const schedule = referenceContext.schedule || plan?.schedule;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || !schedule) return null;
  const startMonth = startDate.slice(0, 7);
  if (schedule.recurrence === 'yearly') {
    const year = Number(startDate.slice(0, 4));
    const month = String(Number(schedule.dueMonth)).padStart(2, '0');
    const candidate = dueDateFor(`${year}-${month}`, Number(schedule.dueDay));
    if (candidate >= startDate) return candidate;
    return dueDateFor(`${year + 1}-${month}`, Number(schedule.dueDay));
  }
  const current = dueDateFor(startMonth, Number(schedule.dueDay));
  return current >= startDate ? current : dueDateFor(addMonths(startMonth, 1), Number(schedule.dueDay));
}

export function installmentScheduleByMonths(remainingPrincipalMinor, monthCount) {
  const remaining = Number(remainingPrincipalMinor);
  const months = Number(monthCount);
  if (!Number.isInteger(remaining) || remaining <= 0) throw new Error('当前剩余欠款必须大于零');
  if (!Number.isInteger(months) || months <= 0 || months > 600) throw new Error('还款月数无效');
  const normalMinor = Math.floor(remaining / months);
  const amountsMinor = Array.from({ length: months }, (_, index) => index === months - 1 ? remaining - normalMinor * (months - 1) : normalMinor);
  return { method: 'by_months', remainingPrincipalMinor: remaining, installmentCount: months, normalInstallmentMinor: normalMinor, finalInstallmentMinor: amountsMinor.at(-1), amountsMinor };
}

export function installmentScheduleByFixedAmount(remainingPrincipalMinor, monthlyAmountMinor) {
  const remaining = Number(remainingPrincipalMinor);
  const monthly = Number(monthlyAmountMinor);
  if (!Number.isInteger(remaining) || remaining <= 0) throw new Error('当前剩余欠款必须大于零');
  if (!Number.isInteger(monthly) || monthly <= 0 || monthly > remaining) throw new Error('每月还款金额无效');
  const count = Math.ceil(remaining / monthly);
  const amountsMinor = Array.from({ length: count }, (_, index) => index === count - 1 ? remaining - monthly * (count - 1) : monthly);
  return { method: 'fixed_monthly', remainingPrincipalMinor: remaining, installmentCount: count, normalInstallmentMinor: monthly, finalInstallmentMinor: amountsMinor.at(-1), amountsMinor };
}

export function deriveInstallmentProgress({ originalPrincipalMinor, progressMode = 'not_started', remainingPrincipalMinor = null, repaidPrincipalMinor = null } = {}) {
  const original = Number(originalPrincipalMinor);
  if (!Number.isInteger(original) || original <= 0) throw new Error('原始欠款必须大于零');
  let remaining = original;
  if (progressMode === 'remaining') remaining = Number(remainingPrincipalMinor);
  if (progressMode === 'repaid') remaining = original - Number(repaidPrincipalMinor);
  if (!Number.isInteger(remaining) || remaining < 0 || remaining > original) throw new Error('剩余欠款不能大于原始欠款');
  return { originalPrincipalMinor: original, repaidPrincipalMinor: original - remaining, remainingPrincipalMinor: remaining };
}

export function auditRecurringCreateIsolation({ beforePlans, afterPlans, beforeOccurrences = [], afterOccurrences = [], createdPlanId } = {}) {
  const before = new Map((beforePlans || []).map((plan) => [plan.id, JSON.stringify(plan)]));
  const after = new Map((afterPlans || []).map((plan) => [plan.id, JSON.stringify(plan)]));
  const missingPlanIds = [...before.keys()].filter((id) => !after.has(id));
  const changedUnrelatedPlanIds = [...before.keys()].filter((id) => after.has(id) && before.get(id) !== after.get(id));
  const beforeOccurrenceIds = new Set((beforeOccurrences || []).map((row) => row.id));
  const missingOccurrenceIds = [...beforeOccurrenceIds].filter((id) => !(afterOccurrences || []).some((row) => row.id === id));
  const createdCount = (afterPlans || []).filter((plan) => plan.id === createdPlanId).length;
  const ok = !missingPlanIds.length && !changedUnrelatedPlanIds.length && !missingOccurrenceIds.length && createdCount === 1 && after.size === before.size + 1;
  return { ok, createdCount, missingPlanIds, changedUnrelatedPlanIds, missingOccurrenceIds, beforeCount: before.size, afterCount: after.size };
}

export function getPlanDeleteEligibility(canonicalPlan, occurrences = [], { sourceSupported = true } = {}) {
  if (!canonicalPlan) return { eligible: false, reasonCode: 'unknown_plan', occurrenceCount: 0, immutableHistoryCount: 0, postedReferenceCount: 0, attachmentReferenceCount: 0 };
  if (!sourceSupported || canonicalPlan.canonicalSource?.sourceType !== 'fixed_plan') return { eligible: false, reasonCode: 'source_managed', occurrenceCount: occurrences.length, immutableHistoryCount: 0, postedReferenceCount: 0, attachmentReferenceCount: 0 };
  const immutableHistoryCount = occurrences.filter((row) => ['paid', 'skipped'].includes(row.recordedStatus || row.status)).length;
  const postedReferenceCount = occurrences.filter((row) => row.postedTransactionId || row.relationshipEntryId || row.settlementId).length;
  const attachmentReferenceCount = Number(canonicalPlan.attachmentIds?.length || 0) + occurrences.reduce((count, row) => count + Number(row.attachmentIds?.length || 0), 0);
  const eligible = immutableHistoryCount === 0 && postedReferenceCount === 0 && attachmentReferenceCount === 0;
  return { eligible, reasonCode: eligible ? 'unused_plan' : postedReferenceCount ? 'posted_reference' : immutableHistoryCount ? 'immutable_history' : 'attachment_reference', occurrenceCount: occurrences.length, immutableHistoryCount, postedReferenceCount, attachmentReferenceCount };
}

export const getRecurringRemovalEligibility = getPlanDeleteEligibility;
