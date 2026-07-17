import { addDaysISO, daysBetween } from '../app/format.js';
import { canonicalSourceKey, isISODate, recurringError } from './recurringPlanModel.js';
import { addMonths, dueDateFor } from './scheduleGenerator.js';

export function isMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

export function monthKeyForDate(dateISO) {
  if (!isISODate(dateISO)) recurringError('invalid_reference_date', '参考日期无效');
  return dateISO.slice(0, 7);
}

export function yearlyPeriodKey(plan, year) {
  return `${year}-Y-${String(plan.schedule.dueMonth).padStart(2, '0')}-${String(plan.schedule.dueDay).padStart(2, '0')}`;
}

export function occurrencePeriodKey(plan, monthKey) {
  if (!isMonthKey(monthKey)) recurringError('invalid_period_key', '月份键无效');
  return plan.schedule.recurrence === 'monthly' ? monthKey : yearlyPeriodKey(plan, monthKey.slice(0, 4));
}

export function dueDateForPlanMonth(plan, monthKey) {
  if (!isMonthKey(monthKey)) recurringError('invalid_period_key', '月份键无效');
  if (plan.schedule.recurrence === 'yearly' && Number(monthKey.slice(5)) !== plan.schedule.dueMonth) return null;
  return dueDateFor(monthKey, plan.schedule.dueDay);
}

export function deterministicOccurrenceId(plan, periodKey) {
  return `occurrence:${canonicalSourceKey(plan.canonicalSource)}:${plan.id}:${periodKey}`;
}

export function occurrenceStatus(occurrence, plan, referenceDate) {
  if (!isISODate(referenceDate)) recurringError('invalid_reference_date', '参考日期无效');
  if (occurrence.recordedStatus === 'paid') return 'paid';
  if (occurrence.recordedStatus === 'skipped') return 'skipped';
  if (occurrence.dueDate < plan.startDate) return 'not_started';
  if (plan.status === 'paused') return 'paused';
  if (plan.status === 'stopped') return 'stopped';
  if (occurrence.dueDate < referenceDate) return 'overdue';
  if (occurrence.dueDate === referenceDate) return 'due_today';
  return 'upcoming';
}

export function buildOccurrenceSnapshot(plan, monthKey, { referenceDate, generatedAt } = {}) {
  if (!isISODate(referenceDate)) recurringError('invalid_reference_date', '生成账期需要明确参考日期');
  const dueDate = dueDateForPlanMonth(plan, monthKey);
  if (!dueDate) return null;
  if (dueDate < plan.startDate) return null;
  if (plan.endDate && dueDate > plan.endDate) return null;
  const periodKey = occurrencePeriodKey(plan, monthKey);
  const occurrence = {
    id: deterministicOccurrenceId(plan, periodKey),
    planId: plan.id,
    canonicalSource: structuredClone(plan.canonicalSource),
    periodKey,
    monthKey,
    dueDate,
    amountMode: plan.amountMode,
    amountState: plan.amountMode === 'fixed' ? 'fixed_planned' : plan.estimateAmountMinor != null ? 'estimated' : 'pending',
    fixedPlannedAmountMinor: plan.fixedAmountMinor,
    estimatedAmountMinor: plan.estimateAmountMinor,
    actualAmountMinor: null,
    amountPending: plan.amountPending,
    totalAmountMinor: plan.totalAmountMinor,
    ownShareMinor: plan.ownShareMinor,
    cashOutflowMinor: plan.cashOutflowMinor,
    receivableMinor: plan.receivableMinor,
    payableMinor: plan.payableMinor,
    paymentSourceAccountId: plan.paymentSourceAccountId,
    relationship: structuredClone(plan.relationship),
    relationshipMode: plan.relationshipMode,
    recordedStatus: null,
    postedTransactionId: null,
    relationshipEntryId: null,
    generatedAt: generatedAt || `${referenceDate}T00:00:00+08:00`,
    planRevision: plan.revision,
    revision: 1,
  };
  return { ...occurrence, status: occurrenceStatus(occurrence, plan, referenceDate) };
}

export function isDueSoon(occurrence, referenceDate, windowDays = 7) {
  if (!Number.isInteger(windowDays) || windowDays < 0) recurringError('invalid_due_window', '到期窗口无效');
  const days = daysBetween(referenceDate, occurrence.dueDate);
  return days >= 0 && days <= windowDays && !['paid', 'skipped', 'paused', 'stopped'].includes(occurrence.status);
}

export function monthRange(startMonth, endMonth) {
  if (!isMonthKey(startMonth) || !isMonthKey(endMonth) || startMonth > endMonth) recurringError('invalid_period_range', '月份范围无效');
  const result = [];
  for (let month = startMonth; month <= endMonth; month = addMonths(month, 1)) result.push(month);
  return result;
}

export function dueSoonReminderIntents(occurrences, referenceDate, windowDays = 7) {
  return occurrences.flatMap((occurrence) => {
    const days = daysBetween(referenceDate, occurrence.dueDate);
    const reminderType = occurrence.status === 'overdue' ? 'overdue' : occurrence.status === 'due_today' ? 'due_today' : isDueSoon(occurrence, referenceDate, windowDays) ? 'due_soon' : null;
    if (!reminderType) return [];
    return [{
      occurrenceId: occurrence.id,
      planId: occurrence.planId,
      reminderType,
      dueDate: occurrence.dueDate,
      ownShareMinor: occurrence.ownShareMinor,
      plannedCashOutflowMinor: occurrence.cashOutflowMinor,
      accountId: occurrence.paymentSourceAccountId || null,
      relationshipId: occurrence.relationship?.ledgerId || null,
      suggestedActionTarget: { surface: 'fixed_center', occurrenceId: occurrence.id },
    }];
  });
}

export function tomorrowISO(referenceDate) {
  return addDaysISO(referenceDate, 1);
}
