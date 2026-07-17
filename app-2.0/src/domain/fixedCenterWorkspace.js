// Pure Fixed Center workspace selectors. Monthly occurrence membership is
// exclusive and derives from the existing canonical status presentation.

const COMPLETED = new Set(['paid', 'charged', 'received', 'repaid', 'completed']);
const EXCLUDED = new Set(['paused', 'stopped', 'archived', 'not_started', 'skipped', 'cancelled']);

function rowState(row) {
  return row.presentation?.semanticState || row.status;
}

export function deriveMonthlyWorkspace(projection) {
  const now = [];
  const next = [];
  const completed = [];
  const seen = new Set();
  projection.rows.forEach((row) => {
    if (seen.has(row.id)) throw new Error(`duplicate_month_occurrence:${row.id}`);
    seen.add(row.id);
    const state = rowState(row);
    if (COMPLETED.has(state)) completed.push(row);
    else if (EXCLUDED.has(state)) return;
    else if (row.presentation?.attention) now.push(row);
    else next.push(row);
  });
  now.sort((a, b) => Number(b.presentation?.priority || 0) - Number(a.presentation?.priority || 0) || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  next.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  completed.sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.id.localeCompare(b.id));
  const relevant = [...now, ...next, ...completed];
  const sum = (key) => relevant.reduce((total, row) => total + Number(row[key] || 0), 0);
  return Object.freeze({
    monthKey: projection.monthKey,
    sections: Object.freeze({ now, next, completed }),
    occurrenceIds: Object.freeze(relevant.map((row) => row.id)),
    duplicateOccurrenceCount: relevant.length - new Set(relevant.map((row) => row.id)).size,
    overview: Object.freeze({
      burdenMinor: sum('ownShareMinor'),
      accountOutflowMinor: sum('cashOutflowMinor'),
      expectedReceiptMinor: sum('receivableMinor'),
      paymentToOtherMinor: sum('payableMinor'),
      completedCount: completed.length,
      totalCount: relevant.length,
      remainingCount: now.length + next.length,
      overdueCount: now.filter((row) => rowState(row) === 'overdue').length,
      attentionCount: now.length,
      awaitingAmountCount: now.filter((row) => rowState(row) === 'awaiting_variable_amount').length,
    }),
  });
}

export function planLibraryType(plan) {
  if (plan.relationshipMode === 'installment_repayment') return 'installment';
  if (plan.planKind === 'recurring_relationship' || plan.relationshipMode) return 'relationship';
  if (plan.planKind === 'subscription') return 'subscription';
  return 'fixed';
}

export function filterPlanLibrary(plans, { status = 'active', type = 'all', occurrencesByPlan = new Map(), referenceDate } = {}) {
  const rows = plans.filter((plan) => {
    const state = plan.archivedAt ? 'archived' : plan.status;
    return state === status && (type === 'all' || planLibraryType(plan) === type);
  });
  const unique = new Map(rows.map((plan) => [plan.id, plan]));
  return [...unique.values()].sort((a, b) => {
    if (status !== 'active') return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id);
    const aNext = (occurrencesByPlan.get(a.id) || []).find((row) => row.dueDate >= referenceDate && !['paid', 'skipped'].includes(row.status));
    const bNext = (occurrencesByPlan.get(b.id) || []).find((row) => row.dueDate >= referenceDate && !['paid', 'skipped'].includes(row.status));
    return Number(!aNext) - Number(!bNext) || String(aNext?.dueDate || '').localeCompare(String(bNext?.dueDate || '')) || a.title.localeCompare(b.title, 'zh-Hans') || a.id.localeCompare(b.id);
  });
}

export function filterHistoryRows(rows, filter = 'all') {
  const unique = new Map(rows.map((row) => [row.id, row]));
  return [...unique.values()].filter((row) => {
    const state = rowState(row);
    if (filter === 'all') return ['paid', 'charged', 'received', 'repaid', 'completed', 'overdue', 'skipped'].includes(state);
    if (filter === 'completed') return COMPLETED.has(state);
    return state === filter;
  }).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || a.id.localeCompare(b.id));
}

export const fixedCenterWorkspaceTestHooks = Object.freeze({ rowState, COMPLETED, EXCLUDED });
