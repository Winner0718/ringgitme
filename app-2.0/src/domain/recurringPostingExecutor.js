// Phase 2C3B canonical recurring financial command boundary. UI modules never
// mutate accounts, transactions, relationship entries or occurrences directly.

import { buildRecurringPostingPreview } from './recurringPostingPreview.js';
import { canonicalizeRecurringActionDraft, fingerprintRecurringActionDraft } from './recurringActionIdentity.js';
import { resolveSourceAccountAppCapability } from './paymentHandoff.js';

const TERMINAL = new Set(['paid', 'charged', 'received', 'repaid', 'completed', 'skipped']);

export class RecurringPostingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecurringPostingError';
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new RecurringPostingError(code, message, details);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function dateTime(iso) {
  const value = String(iso || '');
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) fail('CONFIRMED_TIME_INVALID', '确认时间无效');
  return { date, time };
}

function entryStatus(remainingMinor) {
  return remainingMinor === 0 ? 'settled' : 'open';
}

function snapshot(adapter) {
  return {
    money: adapter.money.createCheckpoint(),
    recurring: adapter.recurring.createCheckpoint(),
    relationship: adapter.relationship.createCheckpoint(),
    attachments: adapter.attachments.createCheckpoint(),
    obligation: adapter.obligation?.createCheckpoint?.() || null,
    outbox: adapter.outbox?.createCheckpoint?.() || null,
  };
}

function restore(adapter, checkpoint) {
  if (checkpoint.outbox) adapter.outbox.restoreCheckpoint(checkpoint.outbox);
  if (checkpoint.obligation) adapter.obligation.restoreCheckpoint(checkpoint.obligation);
  adapter.attachments.restoreCheckpoint(checkpoint.attachments);
  adapter.relationship.restoreCheckpoint(checkpoint.relationship);
  adapter.recurring.restoreCheckpoint(checkpoint.recurring);
  adapter.money.restoreCheckpoint(checkpoint.money);
}

function contextFor(adapter, draft) {
  const plan = adapter.recurring.getPlan(draft.planId);
  const occurrence = adapter.recurring.getOccurrence(draft.occurrenceId);
  if (plan && occurrence) return { plan, occurrence, sourceType: plan.canonicalSource?.sourceType || 'fixed_plan' };
  return adapter.obligation?.resolveContext?.(draft.planId, draft.occurrenceId) || { plan: null, occurrence: null, sourceType: null };
}

function openRelationshipEntries(repository, ledgerId, creditorParticipantId, debtorParticipantId) {
  return repository.getEntries(ledgerId, { includeReversed: true })
    .filter((entry) => entry.status !== 'reversed'
      && entry.creditorParticipantId === creditorParticipantId
      && entry.debtorParticipantId === debtorParticipantId
      && Number(entry.remainingMinor || 0) > 0)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.entryId.localeCompare(b.entryId));
}

function reduceRelationship(repository, { ledgerId, creditorParticipantId, debtorParticipantId, amountMinor, postingId, transactionId, occurredAt }) {
  const candidates = openRelationshipEntries(repository, ledgerId, creditorParticipantId, debtorParticipantId);
  const available = candidates.reduce((sum, entry) => sum + Number(entry.remainingMinor || 0), 0);
  if (available < amountMinor) fail('RELATIONSHIP_BALANCE_INSUFFICIENT', '这笔往来余额不足，无法安全记录本次还款。', { availableMinor: available, requiredMinor: amountMinor });
  let remaining = amountMinor;
  const allocations = [];
  for (const entry of candidates) {
    if (!remaining) break;
    const beforeMinor = Number(entry.remainingMinor || 0);
    const appliedMinor = Math.min(beforeMinor, remaining);
    remaining -= appliedMinor;
    const afterMinor = beforeMinor - appliedMinor;
    const updated = repository.updateEntry(entry.entryId, {
      remainingMinor: afterMinor,
      status: entryStatus(afterMinor),
      recurringSettlement: { postingId, transactionId, amountMinor: appliedMinor, occurredAt },
    });
    allocations.push({ entryId: entry.entryId, beforeMinor, afterMinor, appliedMinor, afterRevision: updated.revision });
  }
  return allocations;
}

function addReceivable(repository, { effect, draft, plan, postingId, transactionId, occurredAt, attachmentIds }) {
  const ledger = repository.getLedger(effect.ledgerId);
  if (!ledger) fail('RELATIONSHIP_LEDGER_NOT_FOUND', '关系账本不存在');
  const counterpartyId = effect.counterpartyId;
  if (!counterpartyId || !ledger.participantIds.includes(counterpartyId)) fail('RELATIONSHIP_COUNTERPARTY_INVALID', '关系对象资料不完整');
  return repository.addEntry({
    ledgerId: effect.ledgerId,
    entryType: 'split_expense',
    transactionId,
    actorParticipantId: draft.actorId,
    payerParticipantId: draft.actorId,
    creditorParticipantId: draft.actorId,
    debtorParticipantId: counterpartyId,
    participants: clone(ledger.participantIds),
    splitParticipantIds: clone(plan.relationship?.participantIds || ledger.participantIds),
    shares: clone(plan.relationship?.shares || []),
    memberBreakdown: [{ participantId: counterpartyId, amountMinor: effect.amountMinor }],
    amountMinor: effect.amountMinor,
    remainingMinor: effect.amountMinor,
    totalAmountMinor: draft.amountMinor,
    relationshipRatioNumeratorMinor: effect.amountMinor,
    relationshipRatioDenominatorMinor: draft.amountMinor,
    sourceChannel: 'app',
    clientEventId: `${postingId}:receivable`,
    occurredAt,
    description: plan.title,
    catId: plan.categoryId || 'expense-fallback',
    attachmentIds: clone(attachmentIds),
    recurringPlanId: plan.id,
    recurringOccurrenceId: draft.occurrenceId,
    recurringPostingId: postingId,
  });
}

function safePaymentMethodSnapshot(value) {
  if (!value) return null;
  return {
    recipientId: value.recipientId || null,
    recipientDisplayName: value.recipientDisplayName || null,
    paymentMethodId: value.paymentMethodId || null,
    paymentMethodType: value.paymentMethodType || null,
    bankName: value.bankName || null,
    accountHolder: value.accountHolder || null,
    maskedDestination: value.maskedDestination || null,
    lastFour: value.lastFour || null,
    paymentReference: value.paymentReference || null,
  };
}

function safePayerAccountSnapshot(account) {
  if (!account) return null;
  const capability = resolveSourceAccountAppCapability(account);
  return {
    payerAccountId: account.id,
    payerAccountName: account.name,
    payerAccountType: account.type,
    appActionLabel: capability.actionLabel || null,
  };
}

function transactionDraft(preview, plan, postingId, confirmedAt, attachmentIds, paymentMethodSnapshot = null, payerAccountSnapshot = null) {
  const effect = preview.effects.transactions[0];
  if (!effect) return null;
  const { date, time } = dateTime(confirmedAt);
  return {
    kind: effect.transactionKind,
    amountMinor: effect.amountMinor,
    desc: plan.title,
    catId: effect.categoryId || (effect.transactionKind === 'income' ? 'income-fallback' : 'expense-fallback'),
    catLabel: plan.title,
    sourceAccountId: effect.sourceAccountId,
    destinationAccountId: effect.destinationAccountId,
    date,
    time,
    accountEffect: 'posted',
    attachmentIds: clone(attachmentIds),
    lockedReason: '这笔记录来自固定计划，请在本期记录详情中撤销。',
    submissionKey: `recurring:${preview.action.idempotencyKey}`,
    recurringPlanId: plan.id,
    recurringOccurrenceId: preview.action.occurrenceId,
    recurringPostingId: postingId,
    recipientPaymentSnapshot: safePaymentMethodSnapshot(paymentMethodSnapshot),
    payerAccountSnapshot: clone(payerAccountSnapshot),
  };
}

function occurrenceStatusFor(preview) {
  return preview.effects.occurrences.find((effect) => effect.effectType === 'occurrence_state_preview')?.toStatus || null;
}

export function createRecurringPostingExecutor({ adapter, actorId = 'participant-me', clock = () => new Date().toISOString(), faultInjector = null } = {}) {
  if (!adapter?.money || !adapter?.recurring || !adapter?.relationship || !adapter?.attachments) throw new Error('RECURRING_POSTING_ADAPTER_REQUIRED');
  const postings = new Map();
  const byIdempotency = new Map();
  let sequence = 0;
  let effectIndex = 0;
  const maybeFail = (phase) => {
    effectIndex += 1;
    if (faultInjector?.({ phase, effectIndex })) fail('ATOMIC_EFFECT_FAILURE', '记账未完成，所有变化已安全还原。', { phase });
  };

  function execute(command = {}) {
    const draft = canonicalizeRecurringActionDraft(command.actionDraft);
    const fingerprint = fingerprintRecurringActionDraft(draft);
    const previousId = byIdempotency.get(draft.idempotencyKey);
    if (previousId) {
      const previous = postings.get(previousId);
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', '这次确认与之前的内容不同，请返回检查。');
      return clone({ ...previous, replayed: true });
    }
    const context = contextFor(adapter, draft);
    const { plan, occurrence } = context;
    if (!plan || !occurrence) fail('RECURRING_CONTEXT_NOT_FOUND', '计划或本期记录不存在');
    if (plan.revision !== draft.planRevision) fail('PLAN_REVISION_STALE', '计划资料已经更新，请重新确认。');
    if (occurrence.revision !== draft.occurrenceRevision) fail('OCCURRENCE_REVISION_STALE', '本期资料已经更新，请重新确认。');
    if (TERMINAL.has(occurrence.recordedStatus)) fail('OCCURRENCE_ALREADY_COMPLETED', '本期已经处理完成。');
    const payerAccountId = command.payerAccountId || command.selectedAccountId || draft.sourceAccountId || null;
    if (payerAccountId !== (draft.sourceAccountId || null)) fail('PAYER_ACCOUNT_MISMATCH', '付款来源已经变化，请重新确认。');
    const recipientPaymentMethodId = command.recipientPaymentMethodId || command.paymentMethodSnapshot?.paymentMethodId || null;
    if (recipientPaymentMethodId && command.paymentMethodSnapshot?.paymentMethodId && recipientPaymentMethodId !== command.paymentMethodSnapshot.paymentMethodId) fail('RECIPIENT_METHOD_MISMATCH', '收款方式已经变化，请重新确认。');
    const preview = buildRecurringPostingPreview({
      actionDraft: draft,
      plan,
      occurrence,
      accounts: adapter.money.getAccounts(),
      actorId,
      participants: adapter.participants?.() || [],
      participantName: adapter.participantName,
    });
    if (!preview.validation.valid) fail(preview.validation.errors[0]?.code || 'POSTING_VALIDATION_FAILED', preview.validation.errors[0]?.message || '无法确认这次记账');
    const confirmedAt = command.confirmedAt || clock();
    const attachmentIds = [...new Set(command.attachmentIds || [])];
    if (!attachmentIds.every((id) => adapter.attachments.get(id))) fail('ATTACHMENT_NOT_FOUND', '附件资料已经变化，请重新选择。');
    const checkpoint = snapshot(adapter);
    const postingId = `recurring-posting-${String(++sequence).padStart(4, '0')}`;
    effectIndex = 0;
    try {
      const paymentSnapshot = safePaymentMethodSnapshot(command.paymentMethodSnapshot);
      const payerSnapshot = safePayerAccountSnapshot(payerAccountId ? adapter.money.getAccount(payerAccountId) : null);
      const draftTransaction = transactionDraft(preview, plan, postingId, confirmedAt, attachmentIds, paymentSnapshot, payerSnapshot);
      if (draftTransaction) adapter.money.assertTransactionCapacity(draftTransaction);
      maybeFail('validated');
      let obligationPayment = null;
      let obligationPlanAfter = null;
      let transaction = null;
      if (context.sourceType === 'obligation_plan' && draft.actionType !== 'preview_skip_occurrence') {
        const { date, time } = dateTime(confirmedAt);
        const recorded = adapter.obligation.recordPayment({
          planId: context.sourcePlan.planId,
          instanceId: context.sourceInstance.instanceId,
          amountMinor: draft.amountMinor,
          sourceAccountId: draft.sourceAccountId,
          destinationAccountId: draft.sourceAccountId,
          date,
          time,
          occurredAt: confirmedAt,
          description: plan.title,
          attachmentIds,
          clientEventId: `${postingId}:obligation-payment`,
          recurringPlanId: plan.id,
          recurringOccurrenceId: occurrence.id,
          recurringPostingId: postingId,
          sourceChannel: 'app',
          recipientPaymentSnapshot: paymentSnapshot,
          payerAccountSnapshot: payerSnapshot,
        });
        obligationPayment = recorded.payment;
        obligationPlanAfter = recorded.plan;
        transaction = recorded.transaction;
      } else if (context.sourceType !== 'obligation_plan') {
        transaction = draftTransaction ? adapter.money.addTransaction(draftTransaction) : null;
      }
      maybeFail('transaction');
      const relationshipChanges = [];
      let relationshipEntry = null;
      const planOwnedInstallment = draft.actionType === 'prepare_installment_repayment'
        && context.sourceType !== 'obligation_plan';
      for (const effect of context.sourceType === 'obligation_plan' || planOwnedInstallment ? [] : preview.effects.relationships) {
        if (effect.effectType === 'receivable_increase') {
          relationshipEntry = addReceivable(adapter.relationship, { effect, draft, plan, postingId, transactionId: transaction?.id || null, occurredAt: confirmedAt, attachmentIds });
          relationshipChanges.push({ kind: 'created_entry', entryId: relationshipEntry.entryId, afterRevision: relationshipEntry.revision });
        } else if (effect.effectType === 'payable_reduction') {
          relationshipChanges.push(...reduceRelationship(adapter.relationship, {
            ledgerId: effect.ledgerId,
            creditorParticipantId: effect.counterpartyId,
            debtorParticipantId: draft.actorId,
            amountMinor: effect.amountMinor,
            postingId,
            transactionId: transaction?.id || null,
            occurredAt: confirmedAt,
          }).map((entry) => ({ kind: 'reduced_entry', ...entry })));
        } else if (effect.effectType === 'receivable_reduction') {
          relationshipChanges.push(...reduceRelationship(adapter.relationship, {
            ledgerId: effect.ledgerId,
            creditorParticipantId: draft.actorId,
            debtorParticipantId: effect.counterpartyId,
            amountMinor: effect.amountMinor,
            postingId,
            transactionId: transaction?.id || null,
            occurredAt: confirmedAt,
          }).map((entry) => ({ kind: 'reduced_entry', ...entry })));
        }
      }
      if (obligationPayment) relationshipChanges.push({
        kind: 'obligation_payment',
        paymentId: obligationPayment.paymentId,
        sourcePlanId: context.sourcePlan.planId,
        sourceInstanceId: context.sourceInstance.instanceId,
        amountMinor: obligationPayment.amountMinor,
      });
      if (planOwnedInstallment) relationshipChanges.push({
        kind: 'installment_principal_reduction',
        amountMinor: preview.effects.installments[0]?.reductionMinor || draft.amountMinor,
        counterpartyId: draft.counterpartyId,
      });
      maybeFail('relationship');
      let updatedPlan = plan;
      const installmentEffect = preview.effects.installments[0];
      if (installmentEffect && context.sourceType !== 'obligation_plan') {
        updatedPlan = adapter.recurring.updatePlan(plan.id, {
          relationship: {
            ...plan.relationship,
            remainingPrincipalMinor: installmentEffect.afterPrincipalMinor,
            completedInstallments: Number(plan.relationship?.completedInstallments || 0) + 1,
          },
        }, { occurredAt: confirmedAt });
      }
      maybeFail('installment');
      const toStatus = occurrenceStatusFor(preview);
      const actualAmountMinor = plan.amountMode === 'variable' ? draft.amountMinor : occurrence.actualAmountMinor;
      let updatedOccurrence;
      if (context.sourceType === 'obligation_plan') {
        if (draft.actionType === 'preview_skip_occurrence') {
          adapter.obligation.skipOccurrence(context.sourceInstance.instanceId, {
            postingId, confirmedAt, amountMinor: 0, attachmentCount: 0,
          });
        }
        updatedOccurrence = adapter.obligation.resolveContext(plan.id, occurrence.id).occurrence;
      } else updatedOccurrence = adapter.recurring.updateOccurrence(occurrence.id, {
        recordedStatus: toStatus,
        status: toStatus,
        actualAmountMinor,
        amountPending: false,
        postedTransactionId: transaction?.id || null,
        relationshipEntryId: relationshipEntry?.entryId || relationshipChanges[0]?.entryId || null,
        recurringPostingId: postingId,
        postedAmountMinor: draft.amountMinor,
        attachmentIds,
        postingAudit: { postingId, confirmedAt, amountMinor: draft.amountMinor, attachmentCount: attachmentIds.length, paymentMethodSnapshot: paymentSnapshot, payerAccountSnapshot: payerSnapshot },
      }, { expectedRevision: occurrence.revision, occurredAt: confirmedAt });
      maybeFail('occurrence');
      if (attachmentIds.length) adapter.attachments.assignOwner(
        'recurring_draft', command.attachmentDraftId,
        transaction ? 'transaction' : 'recurring_occurrence',
        transaction?.id || occurrence.id,
      );
      adapter.linkTransaction?.(transaction?.id, relationshipEntry?.entryId || relationshipChanges[0]?.entryId || null, postingId);
      maybeFail('attachments');
      if (transaction?.confirmation) {
        transaction.confirmation = {
          ...transaction.confirmation,
          relationship: relationshipEntry ? {
          entryType: relationshipEntry.entryType,
          ledgerTitle: adapter.relationship.getLedger(relationshipEntry.ledgerId)?.title || '关系账',
          afterMinor: relationshipEntry.remainingMinor,
          payerName: '我',
          } : null,
          plan: installmentEffect ? {
          planId: plan.id,
          title: plan.title,
          beforePaidMinor: Number(plan.relationship?.originalPrincipalMinor || 0) - installmentEffect.beforePrincipalMinor,
          afterPaidMinor: Number(plan.relationship?.originalPrincipalMinor || 0) - installmentEffect.afterPrincipalMinor,
          remainingMinor: installmentEffect.afterPrincipalMinor,
          } : null,
          recurring: { planId: plan.id, occurrenceId: occurrence.id, postingId, status: toStatus, attachmentCount: attachmentIds.length },
        };
      }
      const after = snapshot(adapter);
      const result = {
        postingId,
        idempotencyKey: draft.idempotencyKey,
        fingerprint,
        planId: plan.id,
        occurrenceId: occurrence.id,
        actionType: draft.actionType,
        amountMinor: draft.amountMinor,
        confirmedAt,
        status: 'posted',
        transactionId: transaction?.id || null,
        relationshipChanges,
        sourceType: context.sourceType,
        obligationPaymentId: obligationPayment?.paymentId || null,
        sourceObligationPlanId: context.sourcePlan?.planId || null,
        sourceObligationInstanceId: context.sourceInstance?.instanceId || null,
        sourceObligationInstanceBefore: clone(context.sourceInstance),
        sourceObligationPlanRevisionAfter: obligationPlanAfter?.revision || context.sourcePlan?.revision || null,
        installmentChange: installmentEffect ? { before: clone(plan.relationship), after: clone(updatedPlan.relationship) } : null,
        occurrenceBefore: occurrence,
        occurrenceAfter: updatedOccurrence,
        attachmentIds,
        attachmentCount: attachmentIds.length,
        paymentMethodSnapshot: paymentSnapshot,
        payerAccountId,
        recipientPaymentMethodId,
        payerAccountSnapshot: payerSnapshot,
        preview: clone(preview),
        before: checkpoint,
        after,
        replayed: false,
      };
      postings.set(postingId, result);
      byIdempotency.set(draft.idempotencyKey, postingId);
      return clone(result);
    } catch (error) {
      restore(adapter, checkpoint);
      if (error instanceof RecurringPostingError) throw error;
      fail('POSTING_ATOMIC_FAILURE', error.message || '记账未完成，所有变化已安全还原。');
    }
  }

  function reverse(postingId, { reason = '用户撤销', reversedAt = clock() } = {}) {
    const posting = postings.get(postingId);
    if (!posting) fail('POSTING_NOT_FOUND', '找不到这次记账。');
    if (posting.status === 'reversed') return clone({ ...posting, replayed: true });
    const context = contextFor(adapter, { planId: posting.planId, occurrenceId: posting.occurrenceId });
    const occurrence = context.occurrence;
    if (occurrence?.recurringPostingId !== postingId || occurrence.revision !== posting.occurrenceAfter.revision) fail('REVERSAL_DOWNSTREAM_CONFLICT', '本期资料在记账后已经变化，无法直接撤销。');
    if (posting.sourceType === 'obligation_plan'
      && context.sourcePlan?.revision !== posting.sourceObligationPlanRevisionAfter) fail('REVERSAL_DOWNSTREAM_CONFLICT', '计划资料在记账后已经变化，无法直接撤销。');
    const transaction = posting.transactionId ? adapter.money.getTransaction(posting.transactionId) : null;
    if (posting.transactionId && transaction?.status !== 'active') fail('REVERSAL_DOWNSTREAM_CONFLICT', '原始记录已经变化，无法再次撤销。');
    for (const change of posting.relationshipChanges.filter((item) => !['obligation_payment', 'installment_principal_reduction'].includes(item.kind))) {
      const entry = adapter.relationship.getEntry(change.entryId);
      if (!entry || entry.revision !== change.afterRevision || (change.kind === 'reduced_entry' && entry.remainingMinor !== change.afterMinor)) fail('REVERSAL_DOWNSTREAM_CONFLICT', '关系账在记账后已经变化，无法直接撤销。');
    }
    const checkpoint = snapshot(adapter);
    try {
      if (posting.sourceType === 'obligation_plan' && posting.obligationPaymentId) {
        adapter.obligation.reversePayment(posting.obligationPaymentId, {
          clientEventId: `${postingId}:obligation-reversal`,
          occurredAt: reversedAt,
          reason,
          sourceChannel: 'app',
        });
      } else if (posting.sourceType === 'obligation_plan') {
        adapter.obligation.restoreOccurrence(
          posting.sourceObligationInstanceId,
          posting.sourceObligationInstanceBefore,
          { postingId, reversedAt, reason },
        );
      } else if (transaction) adapter.money.reverseTransaction(transaction.id, { force: true });
      for (const change of posting.relationshipChanges.filter((item) => !['obligation_payment', 'installment_principal_reduction'].includes(item.kind))) {
        if (change.kind === 'created_entry') adapter.relationship.updateEntry(change.entryId, { status: 'reversed', remainingMinor: 0, reversedAt, reversalReason: reason });
        else adapter.relationship.updateEntry(change.entryId, { status: entryStatus(change.beforeMinor), remainingMinor: change.beforeMinor, reversedAt: null, recurringSettlement: null });
      }
      if (posting.installmentChange && posting.sourceType !== 'obligation_plan') adapter.recurring.updatePlan(posting.planId, { relationship: clone(posting.installmentChange.before) }, { occurredAt: reversedAt });
      const restoredOccurrence = posting.sourceType === 'obligation_plan'
        ? adapter.obligation.resolveContext(posting.planId, posting.occurrenceId).occurrence
        : adapter.recurring.updateOccurrence(posting.occurrenceId, {
        recordedStatus: posting.occurrenceBefore.recordedStatus || null,
        status: posting.occurrenceBefore.status,
        actualAmountMinor: posting.occurrenceBefore.actualAmountMinor || null,
        amountPending: posting.occurrenceBefore.amountPending,
        postedTransactionId: posting.occurrenceBefore.postedTransactionId || null,
        relationshipEntryId: posting.occurrenceBefore.relationshipEntryId || null,
        recurringPostingId: null,
        postedAmountMinor: posting.occurrenceBefore.postedAmountMinor || null,
        attachmentIds: posting.occurrenceBefore.attachmentIds || [],
        reversalAudit: { postingId, reversedAt, reason },
      }, { expectedRevision: occurrence.revision, occurredAt: reversedAt });
      if (transaction) adapter.money.markTransactionReversalAudit(transaction.id, { reason, postingId, reversedAt, compensatingEffect: true });
      posting.status = 'reversed';
      posting.reversedAt = reversedAt;
      posting.reversalReason = reason;
      posting.reversalOccurrence = restoredOccurrence;
      posting.reversalSnapshot = snapshot(adapter);
      return clone(posting);
    } catch (error) {
      restore(adapter, checkpoint);
      if (error instanceof RecurringPostingError) throw error;
      fail('REVERSAL_ATOMIC_FAILURE', error.message || '撤销未完成，所有变化已安全还原。');
    }
  }

  return Object.freeze({
    executeRecurringOccurrencePosting: execute,
    reverseRecurringOccurrencePosting: reverse,
    getPosting: (id) => clone(postings.get(id) || null),
    listPostings: () => [...postings.values()].map(clone),
    reset() { postings.clear(); byIdempotency.clear(); sequence = 0; },
  });
}

export const recurringPostingExecutorTestHooks = Object.freeze({ dateTime, entryStatus, openRelationshipEntries, reduceRelationship });
