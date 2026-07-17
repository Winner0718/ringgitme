// Unified obligation engine: one canonical plan per commitment. Monthly
// relationship accounts (recurring_monthly) repeat until paused/stopped;
// interpersonal instalments (installment) carry a finite schedule and
// complete at zero remaining. Both share idempotent commands, the settlement
// transaction path and outbox event contracts. No networking, ever.

import { toMinor, fromMinor } from './moneyEngine.js';
import { immutableConfirmationSnapshot } from './confirmationSnapshot.js';
import { PLAN_TYPES } from './obligationRepository.js';
import { installmentSchedule, nextMonthlyPeriod, dueDateFor, periodKeyOf, comparePeriods } from './scheduleGenerator.js';

const PAYMENT_LOCK = '这笔款项属于每月账/分期计划，请从关系账的计划详情管理或撤销。';

export function createObligationEngine({ repository, getLedger, outbox, financial, meId = 'participant-me', actorUserId = 'user-winner', today = () => new Date().toISOString().slice(0, 10) }) {
  const commands = new Map();
  const idempotent = (command, run) => {
    if (!command.clientEventId) throw new Error('缺少客户端事件 ID');
    if (commands.has(command.clientEventId)) return structuredClone(commands.get(command.clientEventId));
    const result = run();
    commands.set(command.clientEventId, result);
    return structuredClone(result);
  };
  const emit = (eventType, command, entityId, payload = {}) => outbox.emit({
    clientEventId: `${command.clientEventId}:${eventType}`,
    eventType,
    sourceChannel: command.sourceChannel || 'app',
    actorUserId,
    participantId: command.participantId || null,
    ledgerId: command.ledgerId || null,
    entityId,
    revision: payload.revision || 1,
    occurredAt: command.occurredAt || new Date().toISOString(),
    payload,
  });
  const isInstallment = (plan) => plan.planType === 'installment';
  const eventName = (plan, suffix) => `${isInstallment(plan) ? 'installment' : 'obligation'}.${suffix}`;
  const remainingOf = (instance) => instance.amountDueMinor - instance.amountPaidMinor;

  function validatePlanParticipants(command) {
    const ledger = getLedger(command.ledgerId);
    if (!ledger) throw new Error('关系账本不存在');
    const { creditorParticipantId, debtorParticipantId } = command;
    if (!creditorParticipantId || !debtorParticipantId || creditorParticipantId === debtorParticipantId) throw new Error('请选择有效的双方参与者');
    if (![creditorParticipantId, debtorParticipantId].every((id) => ledger.participantIds.includes(id))) throw new Error('参与者必须属于所选账本');
    if (creditorParticipantId !== meId && debtorParticipantId !== meId) throw new Error('计划必须包含你自己');
    return ledger;
  }

  function createPlan(command) {
    return idempotent(command, () => {
      if (!PLAN_TYPES.has(command.planType)) throw new Error('计划类型无效');
      validatePlanParticipants(command);
      const title = String(command.title || '').trim();
      if (!title) throw new Error('请输入计划名称');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(command.startDate || ''))) throw new Error('开始日期无效');
      if (command.endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(String(command.endDate)) || command.endDate < command.startDate)) throw new Error('结束日期不能早于开始日期');
      const dueDay = Number(command.dueDay);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error('到期日无效');
      const now = command.occurredAt || new Date().toISOString();
      const base = {
        planType: command.planType,
        ledgerId: command.ledgerId,
        creditorParticipantId: command.creditorParticipantId,
        debtorParticipantId: command.debtorParticipantId,
        direction: command.debtorParticipantId === meId ? 'payable' : 'receivable',
        title,
        description: command.description || '',
        currency: 'MYR',
        dueDay,
        startDate: command.startDate,
        endDate: command.endDate || null,
        status: 'active',
        defaultAccountId: command.defaultAccountId || null,
        attachmentIds: command.attachmentIds || [],
        reminder: command.reminder || null,
        sourceChannel: command.sourceChannel || 'app',
        clientEventId: command.clientEventId,
        createdAt: now,
        updatedAt: now,
        totalPaidMinor: 0,
        projection: { surfaces: ['relationship_ledger', 'activity', 'fixed_center'], fixedCenterEligible: true },
      };
      let plan;
      if (command.planType === 'recurring_monthly') {
        const amountMinor = command.amountMinor ?? toMinor(command.amount);
        if (amountMinor <= 0) throw new Error('金额必须大于零');
        plan = repository.addPlan({ ...base, amountMinor });
        emit('obligation.plan.created', command, plan.planId, { planType: plan.planType, amountMinor });
      } else {
        const providedPrincipalMinor = command.principalMinor ?? (command.principal != null ? toMinor(command.principal) : null);
        const feeMinor = command.feeMinor ?? (command.fee != null ? toMinor(command.fee) : 0);
        const totalRepayableMinor = command.totalRepayableMinor ?? (command.totalRepayable != null ? toMinor(command.totalRepayable) : (providedPrincipalMinor || 0) + feeMinor);
        // Backward-compatible engine callers may provide only totalRepayable;
        // in that case the canonical principal is the total less any fee.
        const principalMinor = providedPrincipalMinor ?? totalRepayableMinor - feeMinor;
        if (principalMinor == null || principalMinor <= 0) throw new Error('本金必须大于零');
        if (feeMinor < 0) throw new Error('费用不能为负数');
        if (totalRepayableMinor !== principalMinor + feeMinor) throw new Error('总应还必须等于本金加费用');
        const schedule = installmentSchedule({ totalRepayableMinor, termCount: command.termCount, startDate: command.startDate, dueDay });
        plan = repository.addPlan({
          ...base,
          merchant: command.merchant || null,
          principalMinor: principalMinor ?? totalRepayableMinor,
          feeMinor,
          totalRepayableMinor,
          termCount: Number(command.termCount),
          amountPerTermMinor: schedule[0].amountDueMinor,
          currentTerm: 1,
          remainingBalanceMinor: totalRepayableMinor,
        });
        schedule.forEach((term) => {
          const instance = repository.addInstance({ planId: plan.planId, termNumber: term.termNumber, periodKey: term.periodKey, dueDate: term.dueDate, amountDueMinor: term.amountDueMinor, amountPaidMinor: 0, status: 'scheduled', settlementIds: [], generatedAt: now });
          emit('obligation.instance.generated', { ...command, clientEventId: `${plan.planId}:${term.periodKey}` }, instance.instanceId, { planId: plan.planId, periodKey: term.periodKey, termNumber: term.termNumber, amountDueMinor: term.amountDueMinor });
        });
        emit('installment.plan.created', command, plan.planId, { planType: plan.planType, totalRepayableMinor, termCount: plan.termCount });
      }
      return repository.getPlan(plan.planId);
    });
  }

  function generateInstance(planId, command = {}) {
    const plan = repository.getPlan(planId);
    if (!plan) throw new Error('计划不存在');
    if (plan.planType !== 'recurring_monthly') throw new Error('分期计划的账期在创建时已生成');
    if (plan.status !== 'active') throw new Error('暂停或已结束的计划不会生成新账期');
    const generated = repository.getInstances(planId).map((instance) => instance.periodKey);
    const periodKey = command.periodKey || nextMonthlyPeriod(plan, generated);
    if (!periodKey) throw new Error('计划已到结束日期，没有新的账期');
    if (comparePeriods(periodKey, periodKeyOf(plan.startDate)) < 0) throw new Error('账期早于计划开始时间');
    if (plan.resumeFromPeriod && comparePeriods(periodKey, plan.resumeFromPeriod) < 0 && !generated.includes(periodKey)) throw new Error('暂停期间的账期不会补生成');
    const existing = repository.findInstance(planId, periodKey);
    if (existing) return existing;
    const instance = repository.addInstance({ planId, periodKey, dueDate: dueDateFor(periodKey, plan.dueDay), amountDueMinor: plan.amountMinor, amountPaidMinor: 0, status: 'scheduled', settlementIds: [], generatedAt: new Date().toISOString() });
    emit('obligation.instance.generated', { clientEventId: `${planId}:${periodKey}`, sourceChannel: command.sourceChannel || 'app', ledgerId: plan.ledgerId }, instance.instanceId, { planId, periodKey, amountDueMinor: plan.amountMinor });
    return instance;
  }

  function syncPlanAfterPayment(plan, command) {
    const instances = repository.getInstances(plan.planId);
    const totalPaidMinor = repository.getPayments(plan.planId).filter((payment) => payment.status === 'active').reduce((sum, payment) => sum + payment.amountMinor, 0);
    const changes = { totalPaidMinor };
    if (isInstallment(plan)) {
      changes.remainingBalanceMinor = plan.totalRepayableMinor - totalPaidMinor;
      const firstOpen = instances.find((instance) => remainingOf(instance) > 0);
      changes.currentTerm = firstOpen ? firstOpen.termNumber : plan.termCount;
      if (changes.remainingBalanceMinor === 0 && plan.status !== 'completed') {
        changes.status = 'completed';
        changes.completedAt = command.occurredAt || new Date().toISOString();
      }
      if (changes.remainingBalanceMinor > 0 && plan.status === 'completed') {
        changes.status = 'active';
        changes.completedAt = null;
      }
    }
    const updated = repository.updatePlan(plan.planId, changes);
    if (changes.status && changes.status !== plan.status) emit(eventName(plan, 'plan.updated'), command, plan.planId, { revision: updated.revision, status: changes.status });
    return updated;
  }

  function recordPayment(command) {
    return idempotent(command, () => {
      const plan = repository.getPlan(command.planId);
      if (!plan) throw new Error('计划不存在');
      if (plan.status === 'completed') throw new Error('计划已完成，无需再付款');
      if (plan.status === 'stopped') throw new Error('计划已结束');
      const amountMinor = command.amountMinor ?? toMinor(command.amount);
      if (amountMinor <= 0) throw new Error('金额必须大于零');
      const open = repository.getInstances(command.planId).filter((instance) => remainingOf(instance) > 0);
      const targets = command.instanceId ? open.filter((instance) => instance.instanceId === command.instanceId) : open;
      const available = targets.reduce((sum, instance) => sum + remainingOf(instance), 0);
      if (!targets.length || amountMinor > available) throw new Error('付款金额超过当前未结余额');
      const payable = plan.direction === 'payable';
      const draft = {
        kind: payable ? 'expense' : 'income',
        amountMinor,
        desc: command.description || `${plan.title} · ${targets[0].periodKey}`,
        catId: command.catId || (payable ? 'expense-fallback' : 'income-fallback'),
        catLabel: command.catLabel || (payable ? '未分类支出' : '未分类收入'),
        sourceAccountId: payable ? command.sourceAccountId || plan.defaultAccountId || financial.defaultAccountId() : null,
        destinationAccountId: payable ? null : command.destinationAccountId || plan.defaultAccountId || financial.defaultAccountId(),
        date: command.date,
        time: command.time,
        recordOnly: Boolean(command.recordOnly),
        attachmentIds: command.attachmentIds || [],
        lockedReason: PAYMENT_LOCK,
        submissionKey: `obligation:${command.clientEventId}`,
        recurringPlanId: command.recurringPlanId || null,
        recurringOccurrenceId: command.recurringOccurrenceId || null,
        recurringPostingId: command.recurringPostingId || null,
        recipientPaymentSnapshot: command.recipientPaymentSnapshot || null,
        payerAccountSnapshot: command.payerAccountSnapshot || null,
      };
      const transaction = financial.addTransaction(draft);
      let remaining = amountMinor;
      const allocations = [];
      targets.forEach((instance) => {
        if (!remaining) return;
        const appliedMinor = Math.min(remaining, remainingOf(instance));
        remaining -= appliedMinor;
        const nextPaid = instance.amountPaidMinor + appliedMinor;
        repository.updateInstance(instance.instanceId, {
          amountPaidMinor: nextPaid,
          status: nextPaid === instance.amountDueMinor ? 'paid' : 'partial',
          settlementIds: [...instance.settlementIds, command.clientEventId],
          recurringPostingId: command.recurringPostingId || null,
          postedTransactionId: transaction.id,
          postedAmountMinor: appliedMinor,
          attachmentIds: command.attachmentIds || [],
          postingAudit: command.recurringPostingId ? {
            postingId: command.recurringPostingId,
            confirmedAt: command.occurredAt || `${command.date}T${command.time}:00+08:00`,
            amountMinor: appliedMinor,
            attachmentCount: (command.attachmentIds || []).length,
          } : null,
        });
        allocations.push({ instanceId: instance.instanceId, periodKey: instance.periodKey, appliedMinor });
      });
      const occurredAt = command.occurredAt || `${command.date}T${command.time}:00+08:00`;
      const payment = repository.addPayment({ planId: plan.planId, amountMinor, allocations, transactionId: transaction.id, recordOnly: Boolean(command.recordOnly), sourceChannel: command.sourceChannel || 'app', clientEventId: command.clientEventId, occurredAt, attachmentIds: command.attachmentIds || [], recurringPlanId: command.recurringPlanId || null, recurringOccurrenceId: command.recurringOccurrenceId || null, recurringPostingId: command.recurringPostingId || null });
      financial.linkTransaction?.(transaction.id, payment.paymentId);
      const updatedPlan = syncPlanAfterPayment(repository.getPlan(plan.planId), { ...command, occurredAt });
      if (transaction.confirmation) transaction.confirmation = immutableConfirmationSnapshot({ ...transaction.confirmation, plan: {
        planId: plan.planId,
        planType: plan.planType,
        title: plan.title,
        beforePaidMinor: plan.totalPaidMinor || 0,
        afterPaidMinor: updatedPlan.totalPaidMinor || 0,
        remainingMinor: isInstallment(updatedPlan)
          ? updatedPlan.remainingBalanceMinor
          : repository.getInstances(plan.planId).reduce((sum, instance) => sum + remainingOf(instance), 0),
      } });
      emit(eventName(plan, 'payment.recorded'), { ...command, occurredAt, ledgerId: plan.ledgerId }, payment.paymentId, { planId: plan.planId, transactionId: transaction.id, amountMinor, allocations });
      return { payment, transaction, plan: updatedPlan };
    });
  }

  function earlySettle(command) {
    if (!command.clientEventId) throw new Error('缺少客户端事件 ID');
    if (commands.has(command.clientEventId)) return structuredClone(commands.get(command.clientEventId));
    const plan = repository.getPlan(command.planId);
    if (!plan) throw new Error('计划不存在');
    if (!isInstallment(plan)) throw new Error('只有分期计划支持提前结清');
    if (plan.remainingBalanceMinor <= 0) throw new Error('计划已结清');
    const result = recordPayment({ ...command, amountMinor: plan.remainingBalanceMinor, amount: undefined, instanceId: null, description: command.description || `${plan.title} · 提前结清` });
    emit('installment.early_settled', { ...command, clientEventId: `${command.clientEventId}:early`, ledgerId: plan.ledgerId }, plan.planId, { paymentId: result.payment.paymentId, amountMinor: result.payment.amountMinor });
    return result;
  }

  function reversePayment(paymentId, command) {
    return idempotent(command, () => {
      const payment = repository.getPayment(paymentId);
      if (!payment || payment.status === 'reversed') return payment;
      const plan = repository.getPlan(payment.planId);
      payment.allocations.forEach((allocation) => {
        const instance = repository.getInstance(allocation.instanceId);
        const nextPaid = instance.amountPaidMinor - allocation.appliedMinor;
        repository.updateInstance(instance.instanceId, {
          amountPaidMinor: nextPaid,
          status: nextPaid === 0 ? 'scheduled' : nextPaid === instance.amountDueMinor ? 'paid' : 'partial',
          recurringPostingId: nextPaid === 0 ? null : instance.recurringPostingId || null,
          postedTransactionId: nextPaid === 0 ? null : instance.postedTransactionId || null,
          postedAmountMinor: nextPaid === 0 ? null : nextPaid,
          attachmentIds: nextPaid === 0 ? [] : instance.attachmentIds || [],
          reversalAudit: payment.recurringPostingId ? {
            postingId: payment.recurringPostingId,
            reversedAt: command.occurredAt || new Date().toISOString(),
            reason: command.reason || '用户撤销',
          } : null,
        });
      });
      if (payment.transactionId) financial.reverseTransaction(payment.transactionId);
      const reversed = repository.updatePayment(paymentId, { status: 'reversed', reversedAt: command.occurredAt || new Date().toISOString(), reversalOf: paymentId });
      syncPlanAfterPayment(repository.getPlan(plan.planId), command);
      emit(eventName(plan, 'payment.reversed'), { ...command, ledgerId: plan.ledgerId }, paymentId, { originalPaymentId: paymentId, planId: plan.planId, transactionId: payment.transactionId });
      return reversed;
    });
  }

  function transition(planId, command, from, to, suffix) {
    return idempotent(command, () => {
      const plan = repository.getPlan(planId);
      if (!plan) throw new Error('计划不存在');
      if (plan.status === to) return plan;
      if (!from.includes(plan.status)) throw new Error('当前状态不允许此操作');
      const changes = { status: to };
      if (to === 'active' && plan.status === 'paused') changes.resumeFromPeriod = periodKeyOf(command.date || today());
      if (to === 'stopped') changes.stoppedAt = command.occurredAt || new Date().toISOString();
      const updated = repository.updatePlan(planId, changes, { action: suffix, from: plan.status, to });
      emit(`obligation.plan.${suffix}`, { ...command, ledgerId: plan.ledgerId }, planId, { revision: updated.revision, status: to });
      return updated;
    });
  }

  function updatePlan(planId, changes, command) {
    return idempotent(command, () => {
      const plan = repository.getPlan(planId);
      if (!plan) throw new Error('计划不存在');
      if (['stopped', 'completed'].includes(plan.status)) throw new Error('已结束的计划不能修改');
      const hasPayments = repository.getPayments(planId).some((payment) => payment.status === 'active');
      if (isInstallment(plan) && hasPayments && (changes.totalRepayableMinor != null || changes.termCount != null)) throw new Error('已有还款的分期不能修改总额或期数，请先撤销相关付款');
      const allowed = {};
      ['title', 'description', 'amountMinor', 'dueDay', 'endDate', 'defaultAccountId', 'reminder'].forEach((key) => { if (changes[key] !== undefined) allowed[key] = changes[key]; });
      const updated = repository.updatePlan(planId, allowed, { action: 'updated', changes: Object.keys(allowed), previous: Object.fromEntries(Object.keys(allowed).map((key) => [key, plan[key]])) });
      if (plan.planType === 'recurring_monthly' && (allowed.amountMinor != null || allowed.dueDay != null)) {
        repository.getInstances(planId)
          .filter((instance) => instance.amountPaidMinor === 0 && comparePeriods(instance.periodKey, periodKeyOf(today())) >= 0)
          .forEach((instance) => repository.updateInstance(instance.instanceId, {
            amountDueMinor: allowed.amountMinor ?? instance.amountDueMinor,
            dueDate: dueDateFor(instance.periodKey, allowed.dueDay ?? updated.dueDay),
          }));
      }
      emit(eventName(plan, 'plan.updated'), { ...command, ledgerId: plan.ledgerId }, planId, { revision: updated.revision, changes: Object.keys(allowed) });
      return updated;
    });
  }

  function discardPlan(planId, command) {
    return idempotent(command, () => {
      const plan = repository.getPlan(planId);
      if (!plan) throw new Error('计划不存在');
      if (plan.totalPaidMinor > 0 || repository.getPayments(planId).length) throw new Error('已有付款历史的计划请使用「结束计划」，历史记录会保留');
      const updated = repository.updatePlan(planId, { status: 'stopped', archived: true, stoppedAt: command.occurredAt || new Date().toISOString() }, { action: 'discarded' });
      emit('obligation.plan.stopped', { ...command, ledgerId: plan.ledgerId }, planId, { revision: updated.revision, discarded: true });
      return updated;
    });
  }

  return {
    createPlan,
    generateInstance,
    recordPayment,
    earlySettle,
    reversePayment,
    updatePlan,
    discardPlan,
    pausePlan: (planId, command) => transition(planId, command, ['active'], 'paused', 'paused'),
    resumePlan: (planId, command) => transition(planId, command, ['paused'], 'active', 'resumed'),
    stopPlan: (planId, command) => transition(planId, command, ['active', 'paused'], 'stopped', 'stopped'),
    getPlans: (filter) => repository.getPlans(filter),
    getPlan: (id) => repository.getPlan(id),
    getInstances: (planId) => repository.getInstances(planId),
    getPayments: (planId) => repository.getPayments(planId),
    getPayment: (paymentId) => repository.getPayment(paymentId),
    getInstance: (instanceId) => repository.getInstance(instanceId),
    createCheckpoint: () => ({ repository: repository.createCheckpoint(), commands: structuredClone(commands) }),
    restoreCheckpoint(checkpoint) {
      if (!checkpoint?.repository) throw new Error('义务执行快照无效');
      repository.restoreCheckpoint(checkpoint.repository);
      commands.clear();
      for (const [key, value] of checkpoint.commands || []) commands.set(key, structuredClone(value));
    },
    reset() { repository.reset(); commands.clear(); },
  };
}
