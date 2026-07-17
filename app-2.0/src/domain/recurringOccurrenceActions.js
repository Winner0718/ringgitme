// Phase 2C3A recurring occurrence action availability. This module only
// describes possible intents; it never posts money or mutates plan state.

export const RECURRING_ACTION_TYPES = Object.freeze([
  'fill_occurrence_amount',
  'prepare_owned_payment',
  'prepare_shared_front_payment',
  'prepare_counterparty_repayment',
  'prepare_subscription_repayment',
  'prepare_installment_repayment',
  'prepare_member_receipt',
  'prepare_central_outward_payment',
  'preview_skip_occurrence',
]);

const TERMINAL_OCCURRENCE_STATES = new Set([
  'paid', 'charged', 'received', 'repaid', 'completed', 'skipped', 'cancelled',
]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function participantName(id, context) {
  if (!id) return '关系对象';
  if (id === context.actorId) return '我';
  if (typeof context.participantName === 'function') return context.participantName(id) || '关系对象';
  return context.participants?.find((row) => (row.participantId || row.id) === id)?.displayName || '关系对象';
}

function confirmedAmountMinor(plan, occurrence) {
  if (plan.amountMode === 'variable') {
    return Number.isInteger(occurrence.actualAmountMinor) && occurrence.actualAmountMinor > 0
      ? occurrence.actualAmountMinor
      : null;
  }
  const amount = Number(occurrence.totalAmountMinor ?? plan.totalAmountMinor);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function descriptor({ plan, occurrence, actionType, label, description, tone = 'green', enabled = true,
  disabledReason = null, requiresAmount = false, requiresSourceAccount = false,
  requiresCounterparty = false, requiresMember = false, counterpartyId = null,
  memberId = null, expectedMoneyDirection = 'none', postingIntent = null }) {
  const suffix = memberId || counterpartyId || 'self';
  return Object.freeze({
    actionId: `${occurrence.id}:${actionType}:${suffix}`,
    actionType,
    occurrenceId: occurrence.id,
    planId: plan.id,
    label,
    description,
    tone,
    enabled: Boolean(enabled),
    disabledReason: enabled ? null : disabledReason,
    requiresAmount: Boolean(requiresAmount),
    requiresSourceAccount: Boolean(requiresSourceAccount),
    requiresCounterparty: Boolean(requiresCounterparty),
    requiresMember: Boolean(requiresMember),
    counterpartyId,
    memberId,
    expectedMoneyDirection,
    postingIntent: Object.freeze(clone(postingIntent || { kind: actionType })),
  });
}

function paymentDescriptor(plan, occurrence, context, amountMinor) {
  const relationship = plan.relationship;
  const mode = plan.relationshipMode;
  const actorId = context.actorId;
  const amountReady = Number.isInteger(amountMinor) && amountMinor > 0;
  const common = {
    plan, occurrence,
    requiresAmount: true,
    requiresSourceAccount: !plan.recordOnlyDefault,
    enabled: amountReady && !plan.recordOnlyDefault,
    disabledReason: !amountReady ? 'VARIABLE_AMOUNT_UNCONFIRMED' : 'REFERENCE_ONLY',
  };

  if (mode === 'installment_repayment') {
    const remaining = Number(relationship?.remainingPrincipalMinor || 0);
    const creditorId = relationship?.creditorParticipantId || null;
    const debtorId = relationship?.debtorParticipantId || null;
    const valid = Boolean(creditorId && debtorId && creditorId !== debtorId && [creditorId, debtorId].includes(actorId));
    const outgoing = debtorId === actorId;
    return descriptor({
      ...common,
      actionType: 'prepare_installment_repayment',
      label: outgoing ? '记录本期分期' : '记录收到本期分期',
      description: outgoing ? `还给${participantName(creditorId, context)}` : `收到${participantName(debtorId, context)}的分期`,
      enabled: common.enabled && valid && remaining > 0,
      disabledReason: !valid ? 'RELATIONSHIP_CONTEXT_INVALID' : remaining <= 0 ? 'OCCURRENCE_ALREADY_COMPLETED' : common.disabledReason,
      requiresCounterparty: true,
      counterpartyId: outgoing ? creditorId : debtorId,
      expectedMoneyDirection: outgoing ? 'outflow' : 'inflow',
      postingIntent: { kind: 'installment_repayment', direction: outgoing ? 'outgoing' : 'incoming', remainingPrincipalMinor: remaining },
    });
  }

  if (mode === 'central_collection') return null;

  if (plan.planKind === 'subscription' && plan.subscriptionFundingMode === 'other_pays') {
    const payerId = relationship?.payerParticipantId || relationship?.participantIds?.find((id) => id !== actorId) || null;
    const valid = Boolean(payerId && payerId !== actorId && relationship?.ledgerId);
    return descriptor({
      ...common,
      actionType: 'prepare_subscription_repayment',
      label: `记录还给${participantName(payerId, context)}`,
      description: `偿还由${participantName(payerId, context)}代付的订阅`,
      enabled: common.enabled && valid,
      disabledReason: valid ? common.disabledReason : 'RELATIONSHIP_CONTEXT_INVALID',
      requiresCounterparty: true,
      counterpartyId: payerId,
      expectedMoneyDirection: 'outflow',
      postingIntent: { kind: 'subscription_repayment', subscriptionIdentity: plan.provider?.name || plan.title },
    });
  }

  if (mode === 'shared_bill') {
    const payerId = relationship?.payerParticipantId || null;
    const valid = Boolean(payerId && relationship?.ledgerId && relationship?.participantIds?.includes(actorId));
    if (payerId === actorId) {
      return descriptor({
        ...common,
        actionType: 'prepare_shared_front_payment',
        label: '支付并记录分摊',
        description: '支付完整账单，并记录其他参与者应还份额',
        enabled: common.enabled && valid,
        disabledReason: valid ? common.disabledReason : 'RELATIONSHIP_CONTEXT_INVALID',
        expectedMoneyDirection: 'outflow_and_receivable',
        postingIntent: { kind: 'shared_front_payment', paymentScope: 'full_bill' },
      });
    }
    return descriptor({
      ...common,
      actionType: 'prepare_counterparty_repayment',
      label: `记录还给${participantName(payerId, context)}`,
      description: '偿还对方已代付的我的份额',
      enabled: common.enabled && valid && payerId !== actorId,
      disabledReason: valid && payerId !== actorId ? common.disabledReason : 'RELATIONSHIP_CONTEXT_INVALID',
      requiresCounterparty: true,
      counterpartyId: payerId,
      expectedMoneyDirection: 'outflow',
      postingIntent: { kind: 'counterparty_repayment' },
    });
  }

  if (mode === 'direct_recurring_payment') {
    const recipientId = relationship?.recipientParticipantId || null;
    const otherId = relationship?.participantIds?.find((id) => id !== actorId) || null;
    const incoming = recipientId === actorId;
    const counterpartyId = incoming ? otherId : recipientId;
    const valid = Boolean(counterpartyId && relationship?.ledgerId);
    return descriptor({
      ...common,
      actionType: incoming ? 'prepare_member_receipt' : 'prepare_counterparty_repayment',
      label: incoming ? `记录收到${participantName(counterpartyId, context)}付款` : `记录付给${participantName(counterpartyId, context)}`,
      description: incoming ? '记录关系对象本期付款' : '记录本期定期往来付款',
      enabled: common.enabled && valid,
      disabledReason: valid ? common.disabledReason : 'RELATIONSHIP_CONTEXT_INVALID',
      requiresCounterparty: !incoming,
      requiresMember: incoming,
      counterpartyId: incoming ? null : counterpartyId,
      memberId: incoming ? counterpartyId : null,
      expectedMoneyDirection: incoming ? 'inflow' : 'outflow',
      postingIntent: { kind: incoming ? 'member_receipt' : 'counterparty_repayment' },
    });
  }

  return descriptor({
    ...common,
    actionType: 'prepare_owned_payment',
    label: plan.planKind === 'subscription' ? '记录本期扣款' : '支付本期账单',
    description: plan.planKind === 'subscription' ? '从我的账户记录订阅扣款' : '从我的账户支付并记录本期支出',
    expectedMoneyDirection: 'outflow',
    postingIntent: { kind: 'owned_payment', transactionKind: 'expense' },
  });
}

function centralActions(plan, occurrence, context, amountMinor) {
  const relationship = plan.relationship;
  const actorId = context.actorId;
  const valid = Boolean(relationship?.ledgerId && relationship?.collectorParticipantId && relationship?.externalPayerParticipantId
    && relationship?.participantIds?.includes(actorId));
  if (!valid) {
    return [descriptor({ plan, occurrence, actionType: 'prepare_central_outward_payment', label: '支付外部账单', description: '关系资料不完整', enabled: false, disabledReason: 'RELATIONSHIP_CONTEXT_INVALID', requiresAmount: true, requiresSourceAccount: true })];
  }
  const collector = relationship.collectorParticipantId;
  if (collector !== actorId) {
    return [descriptor({
      plan, occurrence, actionType: 'prepare_counterparty_repayment',
      label: `记录交给${participantName(collector, context)}`,
      description: '把我的份额交给统一收款人', enabled: Boolean(amountMinor),
      disabledReason: amountMinor ? null : 'VARIABLE_AMOUNT_UNCONFIRMED', requiresAmount: true,
      requiresSourceAccount: true, requiresCounterparty: true, counterpartyId: collector,
      expectedMoneyDirection: 'outflow', postingIntent: { kind: 'counterparty_repayment', centralCollection: true },
    })];
  }
  const memberIds = (relationship.participantIds || []).filter((id) => id !== actorId);
  const unpaid = context.unpaidMemberIds ? new Set(context.unpaidMemberIds) : null;
  const receiptActions = memberIds.filter((id) => !unpaid || unpaid.has(id)).map((memberId) => descriptor({
    plan, occurrence, actionType: 'prepare_member_receipt',
    label: `记录${participantName(memberId, context)}付款`,
    description: '记录成员交来的本期份额，不自动标记外部账单已付',
    enabled: Boolean(amountMinor), disabledReason: amountMinor ? null : 'VARIABLE_AMOUNT_UNCONFIRMED',
    requiresAmount: true, requiresSourceAccount: true, requiresMember: true, memberId,
    expectedMoneyDirection: 'inflow', postingIntent: { kind: 'member_receipt', externalBillIndependent: true },
  }));
  receiptActions.push(descriptor({
    plan, occurrence, actionType: 'prepare_central_outward_payment', label: '支付外部账单',
    description: '支付完整外部账单，成员收款状态保持独立',
    enabled: Boolean(amountMinor) && !plan.recordOnlyDefault,
    disabledReason: amountMinor ? 'REFERENCE_ONLY' : 'VARIABLE_AMOUNT_UNCONFIRMED',
    requiresAmount: true, requiresSourceAccount: true,
    expectedMoneyDirection: 'outflow', postingIntent: { kind: 'central_outward_payment', memberCollectionsIndependent: true },
  }));
  return receiptActions;
}

export function deriveRecurringOccurrenceActions({ plan, occurrence, actorId = 'participant-me', participants = [], participantName: nameResolver, unpaidMemberIds = null } = {}) {
  if (!plan?.id || !occurrence?.id || occurrence.planId !== plan.id) return Object.freeze([]);
  const context = { actorId, participants, participantName: nameResolver, unpaidMemberIds };
  const planInactive = plan.status !== 'active' || Boolean(plan.archivedAt);
  const occurrenceState = occurrence.recordedStatus || occurrence.status || null;
  const terminal = TERMINAL_OCCURRENCE_STATES.has(occurrenceState);
  const amountMinor = confirmedAmountMinor(plan, occurrence);
  const actions = [];

  if (plan.amountMode === 'variable' && amountMinor == null) {
    actions.push(descriptor({
      plan, occurrence, actionType: 'fill_occurrence_amount', label: '填写本期金额',
      description: '填写只属于这个账期的实际金额', tone: 'amber',
      enabled: !planInactive && !terminal, disabledReason: planInactive ? 'ACTION_NOT_AVAILABLE' : terminal ? 'OCCURRENCE_ALREADY_COMPLETED' : null,
      requiresAmount: true, expectedMoneyDirection: 'none', postingIntent: { kind: 'confirm_occurrence_amount' },
    }));
  }

  let financialActions = [];
  if (plan.relationshipMode === 'central_collection') financialActions = centralActions(plan, occurrence, context, amountMinor);
  else {
    const action = paymentDescriptor(plan, occurrence, context, amountMinor);
    if (action) financialActions = [action];
  }
  financialActions.forEach((action) => actions.push(Object.freeze({
    ...action,
    enabled: action.enabled && !planInactive && !terminal,
    disabledReason: planInactive ? 'ACTION_NOT_AVAILABLE'
      : occurrenceState === 'skipped' ? 'OCCURRENCE_SKIPPED'
        : terminal ? 'OCCURRENCE_ALREADY_COMPLETED' : action.disabledReason,
  })));

  actions.push(descriptor({
    plan, occurrence, actionType: 'preview_skip_occurrence', label: '跳过本期',
    description: '只预览跳过状态，不产生任何金额或交易', tone: 'neutral',
    enabled: !planInactive && !terminal, disabledReason: planInactive ? 'ACTION_NOT_AVAILABLE' : occurrenceState === 'skipped' ? 'OCCURRENCE_SKIPPED' : terminal ? 'OCCURRENCE_ALREADY_COMPLETED' : null,
    expectedMoneyDirection: 'none', postingIntent: { kind: 'skip_occurrence', financialEffects: 0 },
  }));

  return Object.freeze(actions);
}

export function findRecurringOccurrenceAction(input, actionType, memberId = null) {
  return deriveRecurringOccurrenceActions(input).find((action) => action.actionType === actionType && (memberId == null || action.memberId === memberId)) || null;
}

export const recurringOccurrenceActionsTestHooks = Object.freeze({ confirmedAmountMinor, TERMINAL_OCCURRENCE_STATES });
