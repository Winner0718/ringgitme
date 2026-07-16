// In-memory repository for the unified obligation domain: one canonical plan
// per commitment (recurring monthly relationship account or interpersonal
// instalment), idempotent per-period instances, and payment records that
// reference the settlement transactions they created.

export const PLAN_TYPES = new Set(['recurring_monthly', 'installment']);
export const PLAN_STATUSES = new Set(['active', 'paused', 'stopped', 'completed']);

export function createObligationRepository({ plans = [], instances = [], payments = [] } = {}) {
  const seed = structuredClone({ plans, instances, payments });
  let state = structuredClone(seed);
  let planSequence = state.plans.length;
  let instanceSequence = state.instances.length;
  let paymentSequence = state.payments.length;

  const plan = (id) => state.plans.find((item) => item.planId === id);
  const instance = (id) => state.instances.find((item) => item.instanceId === id);
  const payment = (id) => state.payments.find((item) => item.paymentId === id);

  return {
    getPlans: ({ ledgerId, planType, status } = {}) => structuredClone(state.plans.filter((item) =>
      (!ledgerId || item.ledgerId === ledgerId) && (!planType || item.planType === planType) && (!status || item.status === status))),
    getPlan: (id) => structuredClone(plan(id) || null),
    addPlan(input) {
      const created = { ...structuredClone(input), planId: input.planId || `plan-${String(++planSequence).padStart(4, '0')}`, revision: 1, history: [] };
      state.plans.push(created);
      return structuredClone(created);
    },
    updatePlan(id, changes, historyNote = null) {
      const index = state.plans.findIndex((item) => item.planId === id);
      if (index < 0) throw new Error('计划不存在');
      const previous = state.plans[index];
      const history = historyNote ? [...previous.history, { ...historyNote, revision: previous.revision + 1, at: new Date().toISOString() }] : previous.history;
      state.plans[index] = { ...previous, ...structuredClone(changes), history, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      return structuredClone(state.plans[index]);
    },
    getInstances: (planId) => structuredClone(state.instances.filter((item) => item.planId === planId).sort((a, b) => a.dueDate.localeCompare(b.dueDate))),
    getInstance: (id) => structuredClone(instance(id) || null),
    findInstance: (planId, periodKey) => structuredClone(state.instances.find((item) => item.planId === planId && item.periodKey === periodKey) || null),
    addInstance(input) {
      const existing = state.instances.find((item) => item.planId === input.planId && item.periodKey === input.periodKey);
      if (existing) return structuredClone(existing);
      const created = { ...structuredClone(input), instanceId: input.instanceId || `inst-${String(++instanceSequence).padStart(4, '0')}`, revision: 1 };
      state.instances.push(created);
      return structuredClone(created);
    },
    updateInstance(id, changes) {
      const index = state.instances.findIndex((item) => item.instanceId === id);
      if (index < 0) throw new Error('账期不存在');
      state.instances[index] = { ...state.instances[index], ...structuredClone(changes), revision: state.instances[index].revision + 1, updatedAt: new Date().toISOString() };
      return structuredClone(state.instances[index]);
    },
    getPayments: (planId) => structuredClone(state.payments.filter((item) => item.planId === planId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))),
    getPayment: (id) => structuredClone(payment(id) || null),
    addPayment(input) {
      const created = { ...structuredClone(input), paymentId: input.paymentId || `oblpay-${String(++paymentSequence).padStart(4, '0')}`, status: 'active' };
      state.payments.push(created);
      return structuredClone(created);
    },
    updatePayment(id, changes) {
      const index = state.payments.findIndex((item) => item.paymentId === id);
      if (index < 0) throw new Error('付款记录不存在');
      state.payments[index] = { ...state.payments[index], ...structuredClone(changes) };
      return structuredClone(state.payments[index]);
    },
    getSnapshot: () => structuredClone(state),
    reset() {
      state = structuredClone(seed);
      planSequence = state.plans.length;
      instanceSequence = state.instances.length;
      paymentSequence = state.payments.length;
    },
  };
}
