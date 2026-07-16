// Read-model selectors over the obligation domain. These are projections:
// they reference canonical plan/instance data by id and never copy it into
// separate records, so every surface (relationship ledger, Activity, the
// future Fixed & Subscriptions center) reads the same plan.

import { addMonths, dueDateFor, periodKeyOf, nextMonthlyPeriod, comparePeriods } from './scheduleGenerator.js';

export function instanceState(instance, today) {
  const remaining = instance.amountDueMinor - instance.amountPaidMinor;
  if (remaining === 0) return 'paid';
  if (instance.amountPaidMinor > 0) return instance.dueDate < today ? 'overdue' : 'partial';
  if (instance.dueDate < today) return 'overdue';
  if (instance.periodKey === periodKeyOf(today)) return 'due';
  return 'upcoming';
}

export function instanceRemaining(instance) {
  return instance.amountDueMinor - instance.amountPaidMinor;
}

export function monthlyPlanOverview(plan, instances, today) {
  const currentPeriod = periodKeyOf(today);
  const current = instances.find((instance) => instance.periodKey === currentPeriod) || null;
  const open = instances.filter((instance) => instanceRemaining(instance) > 0);
  const overdue = open.filter((instance) => instance.dueDate < today && instance.periodKey !== currentPeriod);
  const nextPeriod = plan.status === 'active' ? (nextMonthlyPeriod(plan, instances.map((instance) => instance.periodKey)) || addMonths(currentPeriod, 1)) : null;
  return {
    planId: plan.planId,
    current,
    currentState: current ? instanceState(current, today) : null,
    openRemainingMinor: open.reduce((sum, instance) => sum + instanceRemaining(instance), 0),
    overdueCount: overdue.length,
    nextPreview: nextPeriod && (!plan.endDate || comparePeriods(nextPeriod, periodKeyOf(plan.endDate)) <= 0)
      ? { periodKey: nextPeriod, dueDate: dueDateFor(nextPeriod, plan.dueDay), amountMinor: plan.amountMinor }
      : null,
  };
}

export function installmentPlanOverview(plan, instances, today) {
  const open = instances.filter((instance) => instanceRemaining(instance) > 0);
  const nextDue = open[0] || null;
  const currentPeriod = periodKeyOf(today);
  const dueThisMonth = instances
    .filter((instance) => instance.periodKey === currentPeriod)
    .reduce((sum, instance) => sum + instanceRemaining(instance), 0);
  return {
    planId: plan.planId,
    paidMinor: plan.totalPaidMinor,
    remainingMinor: plan.remainingBalanceMinor,
    currentTerm: plan.currentTerm,
    termCount: plan.termCount,
    nextDueDate: nextDue?.dueDate || null,
    nextDueAmountMinor: nextDue ? instanceRemaining(nextDue) : 0,
    dueThisMonthMinor: dueThisMonth,
    completed: plan.status === 'completed',
  };
}

// Metadata for the future Fixed & Subscriptions center: pointers only.
export function planProjection(plan) {
  return {
    planId: plan.planId,
    planType: plan.planType,
    ledgerId: plan.ledgerId,
    direction: plan.direction,
    surfaces: plan.projection?.surfaces || ['relationship_ledger', 'activity'],
    fixedCenterEligible: Boolean(plan.projection?.fixedCenterEligible),
  };
}

export function overduePlans(plans, instancesOf, today) {
  return plans.filter((plan) => ['active', 'paused'].includes(plan.status)
    && instancesOf(plan.planId).some((instance) => instanceRemaining(instance) > 0 && instance.dueDate < today));
}
