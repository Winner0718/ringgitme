// In-memory command repository for canonical fixed/subscription plans.
// Obligation-owned plans are projected into this read model and are never
// copied into repository state.

import { canonicalSourceKey, normalizeRecurringPlan, RecurringPlanError, recurringError } from './recurringPlanModel.js';
import { buildOccurrenceSnapshot, occurrenceStatus } from './recurringSchedule.js';
import { getRecurringRemovalEligibility } from './recurringPlanUsability.js';
import {
  createRecurringPlanTombstone,
  frozenDeletedPlanHistory,
  isHistoricalRecurringOccurrence,
  restorePlanFromTombstone,
} from './recurringPlanDeletionLifecycle.js';

function sameFinancialSnapshot(a, b) {
  return ['dueDate', 'amountMode', 'amountState', 'fixedPlannedAmountMinor', 'estimatedAmountMinor', 'amountPending', 'totalAmountMinor', 'ownShareMinor', 'cashOutflowMinor', 'receivableMinor', 'payableMinor']
    .every((key) => a[key] === b[key]);
}

export function createRecurringPlanRepository({
  plans = [],
  occurrences = [],
  accountExists,
  participantExists,
  ledgerExists,
  clock = () => new Date().toISOString(),
} = {}) {
  const validation = { accountExists, participantExists, ledgerExists };
  const normalizedPlans = plans.map((plan) => normalizeRecurringPlan(plan, validation));
  const planIds = new Set();
  const sourceKeys = new Set();
  normalizedPlans.forEach((plan) => {
    if (planIds.has(plan.id)) recurringError('duplicate_plan_id', '计划 ID 已存在', { planId: plan.id });
    const sourceKey = canonicalSourceKey(plan.canonicalSource);
    if (sourceKeys.has(sourceKey)) recurringError('duplicate_canonical_source', '同一来源只能建立一个计划', { sourceKey });
    planIds.add(plan.id);
    sourceKeys.add(sourceKey);
  });
  const occurrenceIds = new Set();
  occurrences.forEach((occurrence) => {
    if (occurrenceIds.has(occurrence.id)) recurringError('duplicate_occurrence_identity', '账期 ID 重复', { occurrenceId: occurrence.id });
    occurrenceIds.add(occurrence.id);
  });
  const seed = structuredClone({ plans: normalizedPlans, occurrences, deletedPlans: [], preservedDeletedHistory: [] });
  let state = structuredClone(seed);

  const findPlan = (id) => state.plans.find((plan) => plan.id === id);
  const findOccurrence = (id) => state.occurrences.find((occurrence) => occurrence.id === id);
  const planSourceTaken = (source, exceptId = null) => [
    ...state.plans,
    ...state.deletedPlans.map((entry) => entry.plan),
  ].some((plan) => plan.id !== exceptId && canonicalSourceKey(plan.canonicalSource) === canonicalSourceKey(source));

  function createPlan(input) {
    if (findPlan(input.id)) recurringError('duplicate_plan_id', '计划 ID 已存在', { planId: input.id });
    const now = input.createdAt || clock();
    const plan = normalizeRecurringPlan({ ...input, createdAt: now, updatedAt: input.updatedAt || now, revision: 1, history: [] }, validation);
    if (planSourceTaken(plan.canonicalSource)) recurringError('duplicate_canonical_source', '同一来源只能建立一个计划', { sourceKey: canonicalSourceKey(plan.canonicalSource) });
    state.plans.push(plan);
    return structuredClone(plan);
  }

  function updatePlan(id, changes, { occurredAt = clock() } = {}) {
    const index = state.plans.findIndex((plan) => plan.id === id);
    if (index < 0) recurringError('unknown_plan', '计划不存在', { planId: id });
    const previous = state.plans[index];
    if (previous.status === 'stopped') recurringError('stopped_plan_immutable', '已结束的计划不能修改');
    const protectedKeys = new Set(['id', 'createdAt', 'revision', 'history', 'canonicalSource']);
    const safeChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => !protectedKeys.has(key)));
    // Phase 2C1 callers updated the canonical total directly. Keep that API
    // compatible while fixedAmountMinor is now the explicit FIX1 source.
    if ('totalAmountMinor' in safeChanges && !('fixedAmountMinor' in safeChanges) && previous.amountMode === 'fixed') {
      safeChanges.fixedAmountMinor = safeChanges.totalAmountMinor;
    }
    const candidate = normalizeRecurringPlan({
      ...previous,
      ...structuredClone(safeChanges),
      id,
      canonicalSource: previous.canonicalSource,
      createdAt: previous.createdAt,
      updatedAt: occurredAt,
      revision: previous.revision + 1,
      history: [...previous.history, {
        revision: previous.revision + 1,
        occurredAt,
        changes: Object.keys(safeChanges),
        before: Object.fromEntries(Object.keys(safeChanges).map((key) => [key, previous[key]])),
      }],
    }, validation);
    state.plans[index] = candidate;
    return structuredClone(candidate);
  }

  function transition(id, target, { occurredAt = clock() } = {}) {
    const plan = findPlan(id);
    if (!plan) recurringError('unknown_plan', '计划不存在', { planId: id });
    if (plan.status === target) return structuredClone(plan);
    const allowed = target === 'paused' ? ['active'] : target === 'active' ? ['paused'] : ['active', 'paused'];
    if (!allowed.includes(plan.status)) recurringError('invalid_plan_transition', '当前计划状态不允许此操作', { from: plan.status, to: target });
    return updatePlan(id, { status: target, ...(target === 'stopped' ? { stoppedAt: occurredAt } : {}) }, { occurredAt });
  }

  function archivePlan(id, { occurredAt = clock(), reason = null, actor = 'session-user' } = {}) {
    const index = state.plans.findIndex((plan) => plan.id === id);
    if (index < 0) recurringError('unknown_plan', '计划不存在', { planId: id });
    const previous = state.plans[index];
    if (previous.archivedAt) return structuredClone(previous);
    const candidate = normalizeRecurringPlan({
      ...previous,
      status: 'stopped',
      stoppedAt: previous.stoppedAt || occurredAt,
      archivedAt: occurredAt,
      archivedReason: reason,
      archivedBy: actor,
      updatedAt: occurredAt,
      revision: previous.revision + 1,
      history: [...previous.history, { revision: previous.revision + 1, occurredAt, changes: ['status', 'archivedAt'], before: { status: previous.status, archivedAt: previous.archivedAt || null } }],
    }, validation);
    state.plans[index] = candidate;
    return structuredClone(candidate);
  }

  function unarchivePlan(id, { occurredAt = clock() } = {}) {
    const index = state.plans.findIndex((plan) => plan.id === id);
    if (index < 0) recurringError('unknown_plan', '计划不存在', { planId: id });
    const previous = state.plans[index];
    if (!previous.archivedAt) return structuredClone(previous);
    const candidate = normalizeRecurringPlan({
      ...previous,
      status: 'stopped',
      archivedAt: null,
      archivedReason: null,
      archivedBy: null,
      updatedAt: occurredAt,
      revision: previous.revision + 1,
      history: [...previous.history, { revision: previous.revision + 1, occurredAt, changes: ['archivedAt'], before: { archivedAt: previous.archivedAt } }],
    }, validation);
    state.plans[index] = candidate;
    return structuredClone(candidate);
  }

  function removeUnusedPlan(id) {
    const index = state.plans.findIndex((plan) => plan.id === id);
    if (index < 0) return { removed: false, planId: id, removedOccurrenceIds: [] };
    const plan = state.plans[index];
    const rows = state.occurrences.filter((row) => row.planId === id);
    const eligibility = getRecurringRemovalEligibility(plan, rows);
    if (!eligibility.eligible) recurringError('plan_delete_blocked', '这项计划已有账期或记录', eligibility);
    const removedOccurrenceIds = rows.map((row) => row.id);
    state.plans.splice(index, 1);
    state.occurrences = state.occurrences.filter((row) => row.planId !== id);
    return { removed: true, planId: id, removedOccurrenceIds, eligibility };
  }

  function softDeletePlan(id, {
    deletedAt = clock(),
    deletedByActorId = 'participant-me',
  } = {}) {
    const existing = state.deletedPlans.find((entry) => entry.plan.id === id);
    if (existing) return structuredClone(existing);
    const index = state.plans.findIndex((plan) => plan.id === id);
    if (index < 0) recurringError('unknown_plan', '计划不存在', { planId: id });
    const plan = state.plans[index];
    const tombstone = createRecurringPlanTombstone(plan, {
      deletedAt,
      deletedByActorId,
      deletionRevision: 1,
    });
    const entry = {
      plan: structuredClone(plan),
      tombstone: structuredClone(tombstone),
      occurrenceSnapshot: structuredClone(state.occurrences.filter((row) => row.planId === id)),
    };
    state.plans.splice(index, 1);
    state.deletedPlans.push(entry);
    return structuredClone(entry);
  }

  function restoreDeletedPlan(id, { restoredAt = clock() } = {}) {
    const index = state.deletedPlans.findIndex((entry) => entry.plan.id === id);
    if (index < 0) recurringError('deleted_plan_not_found', '最近删除中没有这项计划', { planId: id });
    const entry = state.deletedPlans[index];
    if (findPlan(id)) recurringError('duplicate_plan_id', '计划 ID 已存在', { planId: id });
    const restored = normalizeRecurringPlan(
      restorePlanFromTombstone(entry, { restoredAt }),
      validation,
    );
    state.plans.push(restored);
    state.deletedPlans.splice(index, 1);
    return structuredClone(restored);
  }

  function permanentlyDeletePlan(id) {
    const index = state.deletedPlans.findIndex((entry) => entry.plan.id === id);
    if (index < 0) recurringError('deleted_plan_not_found', '最近删除中没有这项计划', { planId: id });
    const [entry] = state.deletedPlans.splice(index, 1);
    const rows = state.occurrences.filter((row) => row.planId === id);
    const preserved = frozenDeletedPlanHistory(entry.plan, rows);
    const preservedIds = new Set(preserved.map((snapshot) => snapshot.occurrence.id));
    state.preservedDeletedHistory.push(...preserved.filter((snapshot) => !state.preservedDeletedHistory.some((existing) => existing.occurrence.id === snapshot.occurrence.id)));
    state.occurrences = state.occurrences.filter((row) => row.planId !== id || preservedIds.has(row.id) || isHistoricalRecurringOccurrence(row));
    return {
      planId: id,
      permanentlyDeleted: true,
      preservedHistoryCount: preserved.length,
      removedUnresolvedOccurrenceIds: rows.filter((row) => !isHistoricalRecurringOccurrence(row)).map((row) => row.id),
    };
  }

  function clearRecentlyDeleted() {
    const ids = state.deletedPlans.map((entry) => entry.plan.id);
    const results = ids.map((id) => permanentlyDeletePlan(id));
    return { clearedCount: results.length, planIds: ids, results };
  }

  function generateOccurrence(planId, monthKey, options = {}) {
    const plan = findPlan(planId);
    if (!plan) recurringError('unknown_plan', '计划不存在', { planId });
    if (!options.referenceDate) recurringError('invalid_reference_date', '生成账期需要明确参考日期');
    if (plan.status !== 'active') return { occurrence: null, created: false, reason: plan.status };
    const proposed = buildOccurrenceSnapshot(plan, monthKey, options);
    if (!proposed) return { occurrence: null, created: false, reason: 'out_of_range' };
    const existing = findOccurrence(proposed.id);
    if (!existing) {
      state.occurrences.push(proposed);
      return { occurrence: structuredClone(proposed), created: true, refreshed: false };
    }
    const currentStatus = occurrenceStatus(existing, plan, options.referenceDate);
    const current = { ...existing, status: currentStatus };
    if (['paid', 'skipped'].includes(currentStatus)) return { occurrence: structuredClone(current), created: false, refreshed: false };
    if (sameFinancialSnapshot(existing, proposed)) return { occurrence: structuredClone(current), created: false, refreshed: false };
    if (existing.dueDate <= options.referenceDate) {
      if (options.preserveLocked) return { occurrence: structuredClone(current), created: false, refreshed: false, locked: true };
      recurringError('unsafe_historical_occurrence_rewrite', '已到期账期不能被计划更新静默改写', { occurrenceId: existing.id });
    }
    const index = state.occurrences.findIndex((occurrence) => occurrence.id === existing.id);
    const refreshed = { ...existing, ...proposed, recordedStatus: existing.recordedStatus || null, revision: existing.revision + 1 };
    state.occurrences[index] = refreshed;
    return { occurrence: structuredClone(refreshed), created: false, refreshed: true };
  }

  function listOccurrencesForMonth(monthKey, referenceDate) {
    return state.occurrences
      .filter((occurrence) => occurrence.monthKey === monthKey)
      .map((occurrence) => {
        const plan = findPlan(occurrence.planId);
        return { ...structuredClone(occurrence), status: plan ? occurrenceStatus(occurrence, plan, referenceDate) : occurrence.status };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  }

  function updateOccurrence(id, changes, { expectedRevision = null, occurredAt = clock() } = {}) {
    const index = state.occurrences.findIndex((occurrence) => occurrence.id === id);
    if (index < 0) recurringError('unknown_occurrence', '本期账期不存在', { occurrenceId: id });
    const previous = state.occurrences[index];
    if (expectedRevision != null && previous.revision !== expectedRevision) recurringError('stale_occurrence', '本期资料已经更新', { occurrenceId: id });
    const protectedKeys = new Set(['id', 'planId', 'canonicalSource', 'periodKey', 'monthKey', 'generatedAt']);
    const safe = Object.fromEntries(Object.entries(changes || {}).filter(([key]) => !protectedKeys.has(key)));
    const next = { ...previous, ...structuredClone(safe), revision: previous.revision + 1, updatedAt: occurredAt };
    state.occurrences[index] = next;
    return structuredClone(next);
  }

  return Object.freeze({
    createPlan,
    updatePlan,
    pausePlan: (id, options) => transition(id, 'paused', options),
    resumePlan: (id, options) => transition(id, 'active', options),
    stopPlan: (id, options) => transition(id, 'stopped', options),
    archivePlan,
    unarchivePlan,
    softDeletePlan,
    restoreDeletedPlan,
    permanentlyDeletePlan,
    clearRecentlyDeleted,
    listRecentlyDeleted: () => structuredClone(state.deletedPlans)
      .sort((a, b) => b.tombstone.deletedAt.localeCompare(a.tombstone.deletedAt)),
    getPreservedDeletedHistory: () => structuredClone(state.preservedDeletedHistory),
    removeUnusedPlan,
    getDeleteEligibility: (id) => {
      const plan = findPlan(id);
      return getRecurringRemovalEligibility(plan, state.occurrences.filter((row) => row.planId === id));
    },
    getPlan: (id) => structuredClone(findPlan(id) || null),
    listPlans: () => structuredClone(state.plans),
    generateOccurrence,
    getOccurrence: (id) => structuredClone(findOccurrence(id) || null),
    updateOccurrence,
    listOccurrencesForMonth,
    listOccurrencesForPlan: (planId, referenceDate) => state.occurrences
      .filter((occurrence) => occurrence.planId === planId)
      .map((occurrence) => {
        const plan = findPlan(planId);
        return { ...structuredClone(occurrence), status: plan ? occurrenceStatus(occurrence, plan, referenceDate) : occurrence.recordedStatus || occurrence.status };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    getSnapshot: () => structuredClone(state),
    createCheckpoint: () => structuredClone(state),
    restoreCheckpoint(checkpoint) {
      if (!checkpoint?.plans || !checkpoint?.occurrences) throw new Error('无效的固定计划检查点');
      state = structuredClone(checkpoint);
    },
    reset() { state = structuredClone(seed); },
  });
}

export function isRecurringPlanError(error, code = null) {
  return error instanceof RecurringPlanError && (!code || error.code === code);
}
