// Phase 2C3A pure posting preview. The returned effects are proposals only;
// this module deliberately has no repository, transaction-engine, or balance
// mutation dependency.

import { deriveRecurringOccurrenceActions } from './recurringOccurrenceActions.js';
import { canonicalizeRecurringActionDraft, fingerprintRecurringActionDraft } from './recurringActionIdentity.js';

export const RECURRING_PREVIEW_VALIDATION_CODES = Object.freeze([
  'OCCURRENCE_NOT_FOUND', 'PLAN_NOT_FOUND', 'ACTION_NOT_AVAILABLE',
  'OCCURRENCE_ALREADY_COMPLETED', 'OCCURRENCE_SKIPPED',
  'OCCURRENCE_REVISION_STALE', 'PLAN_REVISION_STALE', 'AMOUNT_REQUIRED',
  'AMOUNT_INVALID', 'AMOUNT_EXCEEDS_REMAINING_PRINCIPAL',
  'SOURCE_ACCOUNT_REQUIRED', 'SOURCE_ACCOUNT_NOT_OWNED', 'COUNTERPARTY_REQUIRED',
  'MEMBER_REQUIRED', 'RELATIONSHIP_CONTEXT_INVALID', 'VARIABLE_AMOUNT_UNCONFIRMED',
  'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_CONFLICT',
]);

const TERMINAL = new Set(['paid', 'charged', 'received', 'repaid', 'completed']);

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
  return value;
}

function emptyPreview(draft, plan, occurrence, errors) {
  const fingerprint = fingerprintRecurringActionDraft(draft);
  return frozen({
    previewVersion: 1,
    action: draft,
    fingerprint,
    snapshots: { plan: plan ? structuredClone(plan) : null, occurrence: occurrence ? structuredClone(occurrence) : null },
    validation: { valid: false, errors },
    effects: { accounts: [], transactions: [], relationships: [], installments: [], occurrences: [] },
    audit: { idempotencyKey: draft.idempotencyKey, fingerprint, financialMutationPerformed: false },
    summary: { title: '无法生成记账预览', amountMinor: draft.amountMinor, direction: 'none' },
  });
}

function accountById(accounts, id) {
  return (accounts || []).find((account) => account.id === id) || null;
}

function minorBalance(account) {
  if (!account) return null;
  if (account.type === 'cc' && Number.isInteger(account.currentOutstandingMinor)) return account.currentOutstandingMinor;
  if (Number.isInteger(account.balanceMinor)) return account.balanceMinor;
  if (Number.isInteger(account.outstandingMinor)) return account.outstandingMinor;
  return null;
}

function accountKind(account, draft) {
  const kind = draft.sourceAccountKind || account?.type || null;
  if (kind === 'cc') return 'credit_card';
  if (kind === 'ew') return 'ewallet';
  if (kind === 'saving') return 'saving';
  if (kind === 'cash' || kind === 'record_only' || kind === 'reference_only') return 'record_only';
  return kind;
}

function validate({ draft, plan, occurrence, accounts, previousAttempt, actorId, participants, participantName, unpaidMemberIds }) {
  const errors = [];
  const add = (code, message) => { if (!errors.some((entry) => entry.code === code)) errors.push({ code, message }); };
  if (!plan) add('PLAN_NOT_FOUND', '计划不存在');
  if (!occurrence) add('OCCURRENCE_NOT_FOUND', '本期账期不存在');
  if (!plan || !occurrence) return errors;
  const status = occurrence.recordedStatus || occurrence.status;
  if (TERMINAL.has(status)) add('OCCURRENCE_ALREADY_COMPLETED', '本期已经处理完成');
  if (status === 'skipped') add('OCCURRENCE_SKIPPED', '本期已经跳过');
  if (draft.occurrenceRevision !== occurrence.revision) add('OCCURRENCE_REVISION_STALE', '本期资料已经更新');
  if (draft.planRevision !== plan.revision) add('PLAN_REVISION_STALE', '计划资料已经更新');
  if (!draft.idempotencyKey) add('IDEMPOTENCY_KEY_REQUIRED', '缺少防重复识别');
  if (!Number.isInteger(draft.amountMinor) && draft.actionType !== 'preview_skip_occurrence') add('AMOUNT_REQUIRED', '请输入本期金额');
  if (draft.amountMinor != null && (!Number.isInteger(draft.amountMinor) || draft.amountMinor <= 0)) add('AMOUNT_INVALID', '金额必须使用大于零的整数分单位');
  if (plan.amountMode === 'variable' && !Number.isInteger(draft.amountMinor)) add('VARIABLE_AMOUNT_UNCONFIRMED', '请先填写本期实际金额');

  const action = deriveRecurringOccurrenceActions({ plan, occurrence, actorId, participants, participantName, unpaidMemberIds })
    .find((item) => item.actionType === draft.actionType && (item.memberId || null) === (draft.memberId || null));
  // A locally confirmed variable amount unlocks its semantic payment action.
  const localOccurrence = plan.amountMode === 'variable' && Number.isInteger(draft.amountMinor)
    ? { ...occurrence, actualAmountMinor: draft.amountMinor, amountPending: false, amountState: 'actual' }
    : occurrence;
  const locallyDerivedAction = deriveRecurringOccurrenceActions({ plan, occurrence: localOccurrence, actorId, participants, participantName, unpaidMemberIds })
    .find((item) => item.actionType === draft.actionType && (item.memberId || null) === (draft.memberId || null));
  const localAction = locallyDerivedAction?.enabled ? locallyDerivedAction : action || locallyDerivedAction;
  if (!localAction?.enabled) add('ACTION_NOT_AVAILABLE', localAction?.disabledReason || '当前操作不可用');
  if (localAction?.requiresSourceAccount) {
    if (!draft.sourceAccountId) add('SOURCE_ACCOUNT_REQUIRED', '请选择账户');
    else {
      const account = accountById(accounts, draft.sourceAccountId);
      if (!account || account.owned === false) add('SOURCE_ACCOUNT_NOT_OWNED', '所选账户不属于当前用户');
    }
  }
  if (localAction?.requiresCounterparty && !draft.counterpartyId) add('COUNTERPARTY_REQUIRED', '请选择关系对象');
  if (localAction?.requiresMember && !draft.memberId) add('MEMBER_REQUIRED', '请选择成员');
  if (plan.relationshipMode && !plan.relationship?.ledgerId) add('RELATIONSHIP_CONTEXT_INVALID', '关系资料不完整');
  if (draft.actionType === 'prepare_installment_repayment') {
    const remaining = Number(plan.relationship?.remainingPrincipalMinor || 0);
    if (Number.isInteger(draft.amountMinor) && draft.amountMinor > remaining) add('AMOUNT_EXCEEDS_REMAINING_PRINCIPAL', '金额超过剩余本金');
  }
  if (previousAttempt?.idempotencyKey === draft.idempotencyKey
    && fingerprintRecurringActionDraft(previousAttempt) !== fingerprintRecurringActionDraft(draft)) add('IDEMPOTENCY_CONFLICT', '同一防重复识别对应了不同内容');
  return errors;
}

function transactionEffect(draft, plan, kind, amountMinor, extra = {}) {
  return {
    effectType: 'transaction_draft',
    transactionKind: kind,
    amountMinor,
    currency: 'MYR',
    sourceAccountId: kind === 'income' ? null : draft.sourceAccountId,
    destinationAccountId: kind === 'income' ? draft.sourceAccountId : null,
    categoryId: plan.categoryId || null,
    title: plan.title,
    occurredAt: draft.occurredAt,
    recurringPlanId: plan.id,
    recurringOccurrenceId: draft.occurrenceId,
    ...extra,
  };
}

function accountEffect(draft, account, amountMinor, direction) {
  const kind = accountKind(account, draft);
  if (kind === 'record_only') return null;
  const beforeMinor = minorBalance(account);
  const credit = kind === 'credit_card';
  const deltaMinor = direction === 'inflow' ? amountMinor : -amountMinor;
  const afterMinor = beforeMinor == null ? null : credit
    ? beforeMinor + (direction === 'outflow' ? amountMinor : -amountMinor)
    : beforeMinor + deltaMinor;
  return {
    accountId: draft.sourceAccountId,
    accountKind: kind,
    effectType: credit ? 'credit_outstanding_change' : direction === 'inflow' ? 'credit_balance' : 'debit_balance',
    direction,
    amountMinor,
    beforeMinor,
    afterMinor,
  };
}

function shareFor(plan, participantId) {
  return Number(plan.relationship?.shares?.find((share) => share.participantId === participantId)?.amountMinor || 0);
}

function buildEffects(draft, plan, occurrence, accounts) {
  const effects = { accounts: [], transactions: [], relationships: [], installments: [], occurrences: [] };
  const account = accountById(accounts, draft.sourceAccountId);
  const amount = draft.amountMinor;
  const addAccount = (direction, value = amount) => {
    const effect = accountEffect(draft, account, value, direction);
    if (effect) effects.accounts.push(effect);
  };
  const complete = (recordedStatus = 'paid') => effects.occurrences.push({
    effectType: 'occurrence_state_preview', occurrenceId: occurrence.id,
    fromStatus: occurrence.recordedStatus || occurrence.status || null,
    toStatus: recordedStatus, expectedRevision: occurrence.revision,
  });

  if (draft.actionType === 'preview_skip_occurrence') {
    complete('skipped');
    return effects;
  }
  if (draft.actionType === 'fill_occurrence_amount') {
    effects.occurrences.push({ effectType: 'occurrence_amount_preview', occurrenceId: occurrence.id, actualAmountMinor: amount, referenceEstimateMinor: plan.estimateAmountMinor || null, expectedRevision: occurrence.revision });
    return effects;
  }
  if (draft.actionType === 'prepare_owned_payment') {
    addAccount('outflow');
    effects.transactions.push(transactionEffect(draft, plan, 'expense', amount, { semantic: plan.planKind === 'subscription' ? 'subscription_charge' : 'owned_recurring_expense' }));
    complete(plan.planKind === 'subscription' ? 'charged' : 'paid');
  } else if (draft.actionType === 'prepare_shared_front_payment') {
    addAccount('outflow');
    const ownShare = shareFor(plan, draft.actorId) || Number(occurrence.ownShareMinor || 0);
    const receivable = Math.max(0, amount - ownShare);
    effects.transactions.push(transactionEffect(draft, plan, 'expense', amount, { semantic: 'shared_bill_front_payment', economicBurdenMinor: ownShare }));
    if (receivable) effects.relationships.push({ effectType: 'receivable_increase', ledgerId: draft.groupId, counterpartyId: plan.relationship?.participantIds?.find((id) => id !== draft.actorId) || null, amountMinor: receivable, economicBurdenMinor: ownShare });
    complete('paid');
  } else if (['prepare_counterparty_repayment', 'prepare_subscription_repayment'].includes(draft.actionType)) {
    addAccount('outflow');
    effects.transactions.push(transactionEffect(draft, plan, 'expense', amount, { semantic: draft.actionType === 'prepare_subscription_repayment' ? 'subscription_repayment' : 'relationship_repayment', counterpartyId: draft.counterpartyId }));
    effects.relationships.push({ effectType: 'payable_reduction', ledgerId: draft.groupId, counterpartyId: draft.counterpartyId, amountMinor: amount });
    complete('repaid');
  } else if (draft.actionType === 'prepare_installment_repayment') {
    const remaining = Number(plan.relationship.remainingPrincipalMinor);
    const exact = Math.min(amount, remaining);
    const incoming = plan.relationship.creditorParticipantId === draft.actorId;
    addAccount(incoming ? 'inflow' : 'outflow', exact);
    effects.transactions.push(transactionEffect(draft, plan, incoming ? 'income' : 'expense', exact, { semantic: 'installment_repayment', counterpartyId: draft.counterpartyId }));
    effects.relationships.push({ effectType: incoming ? 'receivable_reduction' : 'payable_reduction', ledgerId: draft.groupId, counterpartyId: draft.counterpartyId, amountMinor: exact });
    effects.installments.push({ effectType: 'principal_reduction', planId: plan.id, beforePrincipalMinor: remaining, reductionMinor: exact, afterPrincipalMinor: remaining - exact });
    complete('repaid');
  } else if (draft.actionType === 'prepare_member_receipt') {
    addAccount('inflow');
    effects.transactions.push(transactionEffect(draft, plan, 'income', amount, { semantic: 'central_member_receipt', memberId: draft.memberId, incomeClassification: 'relationship_receipt_not_income' }));
    effects.relationships.push({ effectType: 'member_obligation_reduction', ledgerId: draft.groupId, memberId: draft.memberId, amountMinor: amount, externalBillStatusUnchanged: true });
  } else if (draft.actionType === 'prepare_central_outward_payment') {
    addAccount('outflow');
    effects.transactions.push(transactionEffect(draft, plan, 'expense', amount, { semantic: 'central_external_bill_payment' }));
    effects.relationships.push({ effectType: 'member_collection_state_unchanged', ledgerId: draft.groupId, amountMinor: 0 });
    complete('paid');
  }
  return effects;
}

function summaryFor(draft, effects) {
  const direction = effects.accounts[0]?.direction || 'none';
  const title = draft.actionType === 'preview_skip_occurrence' ? '跳过本期'
    : draft.actionType === 'prepare_member_receipt' ? '记录成员付款'
      : draft.actionType.includes('repayment') ? '记录关系还款' : '生成记账预览';
  return { title, amountMinor: draft.amountMinor, direction };
}

export function buildRecurringPostingPreview({ actionDraft, plan = null, occurrence = null, accounts = [],
  previousAttempt = null, actorId = 'participant-me', participants = [], participantName = null,
  unpaidMemberIds = null } = {}) {
  const draft = canonicalizeRecurringActionDraft(actionDraft);
  const errors = validate({ draft, plan, occurrence, accounts, previousAttempt, actorId, participants, participantName, unpaidMemberIds });
  if (errors.length) return emptyPreview(draft, plan, occurrence, errors);
  const effects = buildEffects(draft, plan, occurrence, accounts);
  const fingerprint = fingerprintRecurringActionDraft(draft);
  return frozen({
    previewVersion: 1,
    action: draft,
    fingerprint,
    snapshots: { plan: structuredClone(plan), occurrence: structuredClone(occurrence) },
    validation: { valid: true, errors: [] },
    effects,
    audit: { idempotencyKey: draft.idempotencyKey, fingerprint, financialMutationPerformed: false },
    summary: summaryFor(draft, effects),
  });
}

export const recurringPostingPreviewTestHooks = Object.freeze({ accountKind, minorBalance, shareFor, buildEffects });
