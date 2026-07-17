// Pure lifecycle helpers for soft-deleted recurring plans. Financial records
// and completed occurrence snapshots are intentionally outside deletion scope.

const TERMINAL = new Set(['paid', 'charged', 'received', 'repaid', 'completed', 'skipped']);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createRecurringPlanTombstone(plan, {
  deletedAt,
  deletedByActorId = 'participant-me',
  deletionRevision = 1,
} = {}) {
  if (!plan?.id || !deletedAt) {
    const error = new Error('INVALID_RECURRING_PLAN_TOMBSTONE');
    error.code = 'INVALID_RECURRING_PLAN_TOMBSTONE';
    throw error;
  }
  return Object.freeze({
    planId: plan.id,
    deletedAt,
    deletedByActorId,
    previousLifecycleStatus: plan.status,
    planRevisionAtDelete: plan.revision,
    deletionRevision,
  });
}

export function isHistoricalRecurringOccurrence(occurrence) {
  return Boolean(
    occurrence?.recordedStatus
    || occurrence?.postedTransactionId
    || occurrence?.relationshipEntryId
    || TERMINAL.has(occurrence?.status),
  );
}

export function frozenDeletedPlanHistory(plan, occurrences = []) {
  return occurrences.filter(isHistoricalRecurringOccurrence).map((occurrence) => Object.freeze({
    planId: plan.id,
    planTitle: `已删除计划 · ${plan.title}`,
    planKind: plan.planKind,
    canonicalSource: clone(plan.canonicalSource),
    occurrence: clone(occurrence),
  }));
}

export function restorePlanFromTombstone(entry, { restoredAt } = {}) {
  const { plan, tombstone } = entry || {};
  if (!plan || !tombstone || !restoredAt) {
    const error = new Error('INVALID_RECURRING_PLAN_RESTORE');
    error.code = 'INVALID_RECURRING_PLAN_RESTORE';
    throw error;
  }
  return {
    ...clone(plan),
    status: tombstone.previousLifecycleStatus,
    updatedAt: restoredAt,
    revision: Number(plan.revision || 1) + 1,
    history: [...(plan.history || []), {
      revision: Number(plan.revision || 1) + 1,
      occurredAt: restoredAt,
      changes: ['deletedAt'],
      before: { deletedAt: tombstone.deletedAt },
    }],
  };
}

export const recurringPlanDeletionLifecycleTestHooks = Object.freeze({ TERMINAL });
