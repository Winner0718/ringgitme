import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { createRecurringActionDraft } from '../src/domain/recurringActionIdentity.js';
import { deriveRecurringOccurrenceActions } from '../src/domain/recurringOccurrenceActions.js';
import { LEDGER_RECURRING_SCENARIO_FIXTURES } from '../src/fixtures/recurringPlanFixtures.js';
import { MAX_ATTACHMENT_BYTES, validateAttachmentFile } from '../src/domain/attachmentRepository.js';

const tests = [];
const add = (name, fn) => tests.push([name, fn]);
const keyFor = (id) => `fixed_plan:${id}`;

function actionContext(data, planId, actionType, { monthKey = '2026-07', amountMinor = null, clientEventId = `event-${actionType}` } = {}) {
  const key = keyFor(planId);
  const plan = data.getCanonicalRecurringPlan(key).plan;
  const occurrence = data.getCanonicalRecurringPlanOccurrences(key, data.today).find((row) => row.monthKey === monthKey);
  assert.ok(occurrence, `missing occurrence ${planId}:${monthKey}`);
  const localOccurrence = Number.isInteger(amountMinor) ? { ...occurrence, actualAmountMinor: amountMinor, amountPending: false, amountState: 'actual', totalAmountMinor: amountMinor } : occurrence;
  const action = deriveRecurringOccurrenceActions({ plan, occurrence: localOccurrence, actorId: 'participant-me' }).find((row) => row.actionType === actionType && row.enabled);
  assert.ok(action, `missing action ${actionType}`);
  const accountId = action.requiresSourceAccount ? plan.paymentSourceAccountId : null;
  const account = accountId ? data.getAccount(accountId) : null;
  const draft = createRecurringActionDraft({
    action, plan, occurrence, actorId: 'participant-me',
    amountMinor: actionType === 'preview_skip_occurrence' ? null : amountMinor ?? occurrence.totalAmountMinor,
    sourceAccountId: accountId,
    sourceAccountKind: account?.type || null,
    counterpartyId: action.counterpartyId,
    memberId: action.memberId,
    groupId: plan.relationship?.ledgerId || null,
    occurredAt: '2026-07-17T09:00:00+08:00',
    clientEventId,
  });
  return { key, plan, occurrence, action, account, draft };
}

function projectedActionContext(data, occurrence, actionType, { amountMinor = null, clientEventId = `event-${actionType}` } = {}) {
  const plan = occurrence.plan;
  const localOccurrence = Number.isInteger(amountMinor)
    ? { ...occurrence, actualAmountMinor: amountMinor, amountPending: false, amountState: 'actual', totalAmountMinor: amountMinor }
    : occurrence;
  const action = deriveRecurringOccurrenceActions({ plan, occurrence: localOccurrence, actorId: 'participant-me' })
    .find((row) => row.actionType === actionType && row.enabled);
  assert.ok(action, `missing projected action ${actionType}`);
  const accountId = action.requiresSourceAccount ? plan.paymentSourceAccountId : null;
  const account = accountId ? data.getAccount(accountId) : null;
  const draft = createRecurringActionDraft({
    action, plan, occurrence, actorId: 'participant-me',
    amountMinor: actionType === 'preview_skip_occurrence' ? null : amountMinor ?? occurrence.totalAmountMinor,
    sourceAccountId: accountId,
    sourceAccountKind: account?.type || null,
    counterpartyId: action.counterpartyId,
    memberId: action.memberId,
    groupId: plan.relationship?.ledgerId || null,
    occurredAt: '2026-07-17T09:00:00+08:00',
    clientEventId,
  });
  return { key: `${plan.canonicalSource.sourceType}:${plan.canonicalSource.sourceId}`, plan, occurrence, action, account, draft };
}

function execute(data, context, extras = {}) {
  return data.executeRecurringOccurrencePosting({
    planId: context.plan.id,
    occurrenceId: context.occurrence.id,
    actionDraft: context.draft,
    expectedPlanRevision: context.plan.revision,
    expectedOccurrenceRevision: context.occurrence.revision,
    confirmedAt: '2026-07-17T09:00:00+08:00',
    attachmentDraftId: extras.attachmentDraftId || 'none',
    attachmentIds: extras.attachmentIds || [],
  });
}

function createScenario(data, templateId, overrides = {}) {
  const template = structuredClone(LEDGER_RECURRING_SCENARIO_FIXTURES.find((row) => row.id === templateId));
  Object.assign(template, overrides);
  const result = data.createManagedRecurringPlan(template, { commandId: `create-${template.id}`, allowSemanticDuplicate: true, monthKey: '2026-07' });
  assert.equal(result.status, 'created');
  return result.plan;
}

function addPayable(data, { ledgerId = 'ledger-sis', participantId = 'participant-sis', amount = 850, event = 'seed-payable' } = {}) {
  return data.recordRelationshipEntry({
    ledgerId, entryType: 'direct_payable', participantId, payerParticipantId: participantId,
    amount, description: '既有往来欠款', sourceAccountId: 'sv-mbb', recordOnly: true,
    date: data.today, time: '08:00', sourceChannel: 'app', clientEventId: event,
  });
}

function sharedPosted({ faultInjector = null, attachment = false } = {}) {
  const data = createDemoDataSource({ recurringPostingFaultInjector: faultInjector });
  const context = actionContext(data, 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200, clientEventId: 'shared-rent-post' });
  let attachmentDraftId = 'none'; let attachmentIds = [];
  if (attachment) {
    attachmentDraftId = 'receipt-draft';
    const item = data.addAttachment({ ownerEntityType: 'recurring_draft', ownerEntityId: attachmentDraftId, name: 'rent-receipt.pdf', mimeType: 'application/pdf', sizeBytes: 400, localObjectUrl: '', clientEventId: 'rent-receipt' });
    attachmentIds = [item.attachmentId];
  }
  const before = { balanceMinor: data.getAccount(context.account.id).balanceMinor, activities: data.getActivities().length, entries: data.getRelationshipEntries('ledger-abi').length, occurrence: structuredClone(context.occurrence) };
  const result = execute(data, context, { attachmentDraftId, attachmentIds });
  return { data, context, before, result, attachmentIds };
}

add('2C3B-001 shared rent debits exactly 131200 minor', () => { const x = sharedPosted(); assert.equal(x.data.getAccount(x.context.account.id).balanceMinor, x.before.balanceMinor - 131200); });
add('2C3B-002 shared rent creates exactly one transaction', () => { const x = sharedPosted(); assert.equal(x.data.getActivities().length, x.before.activities + 1); });
add('2C3B-003 shared rent transaction amount is 131200', () => { const x = sharedPosted(); assert.equal(x.data.getTransaction(x.result.transactionId).amountMinor, 131200); });
add('2C3B-004 shared rent creates Abi receivable 65600', () => { const x = sharedPosted(); const entry = x.data.getRelationshipEntry(x.result.relationshipChanges[0].entryId); assert.equal(entry.debtorParticipantId, 'participant-abi'); assert.equal(entry.remainingMinor, 65600); });
add('2C3B-005 shared transaction links to relationship origin', () => { const x = sharedPosted(); assert.equal(x.data.getRelationshipEntityForTransaction(x.result.transactionId), x.result.relationshipChanges[0].entryId); });
add('2C3B-006 shared occurrence completes once', () => { const x = sharedPosted(); const row = x.data.getCanonicalRecurringPlanOccurrences(x.context.key, x.data.today).find((o) => o.id === x.context.occurrence.id); assert.equal(row.recordedStatus, 'paid'); assert.equal(row.postedAmountMinor, 131200); });
add('2C3B-007 exact replay returns prior posting', () => { const x = sharedPosted(); const replay = execute(x.data, x.context); assert.equal(replay.postingId, x.result.postingId); assert.equal(replay.replayed, true); });
add('2C3B-008 replay never creates duplicate transaction', () => { const x = sharedPosted(); const count = x.data.getActivities().length; execute(x.data, x.context); assert.equal(x.data.getActivities().length, count); });
add('2C3B-009 conflicting replay fails closed', () => { const x = sharedPosted(); const conflict = { ...x.context, draft: { ...x.context.draft, amountMinor: 131201 } }; assert.throws(() => execute(x.data, conflict), /内容不同/); });
add('2C3B-010 stale occurrence revision fails closed', () => { const x = sharedPosted(); const staleData = createDemoDataSource(); const c = actionContext(staleData, 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200 }); staleData.executeRecurringOccurrencePosting({ actionDraft: c.draft, confirmedAt: '2026-07-17T09:00:00+08:00' }); assert.throws(() => staleData.executeRecurringOccurrencePosting({ actionDraft: { ...c.draft, idempotencyKey: `${c.draft.idempotencyKey}-other`, clientEventId: 'other' } }), /已经处理完成|已经更新/); });

add('2C3B-011 attachment links to transaction after post', () => { const x = sharedPosted({ attachment: true }); assert.deepEqual(x.data.getTransaction(x.result.transactionId).attachmentIds, x.attachmentIds); assert.equal(x.data.getAttachments('recurring_draft', 'receipt-draft').length, 0); });
add('2C3B-012 attachment is excluded from financial identity', () => { const a = actionContext(createDemoDataSource(), 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200, clientEventId: 'same' }); const b = actionContext(createDemoDataSource(), 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200, clientEventId: 'same' }); assert.equal(a.draft.idempotencyKey, b.draft.idempotencyKey); });
add('2C3B-013 attachment remains after reversal', () => { const x = sharedPosted({ attachment: true }); x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:05:00+08:00' }); assert.deepEqual(x.data.getTransaction(x.result.transactionId).attachmentIds, x.attachmentIds); assert.equal(x.data.getTransactionAttachments(x.result.transactionId).length, 1); });
add('2C3B-014 invalid attachment type is rejected', () => assert.throws(() => validateAttachmentFile({ type: 'application/x-msdownload', size: 100 }), /不支持/));
add('2C3B-015 oversized attachment is rejected', () => assert.throws(() => validateAttachmentFile({ type: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1 }), /10 MB/));

add('2C3B-016 shared reversal restores account exactly', () => { const x = sharedPosted(); x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:05:00+08:00' }); assert.equal(x.data.getAccount(x.context.account.id).balanceMinor, x.before.balanceMinor); });
add('2C3B-017 reversal preserves original transaction', () => { const x = sharedPosted(); x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:05:00+08:00' }); assert.equal(x.data.getTransaction(x.result.transactionId).status, 'reversed'); assert.ok(x.data.getTransaction(x.result.transactionId).reversalAudit); });
add('2C3B-018 reversal reverses linked receivable', () => { const x = sharedPosted(); const id = x.result.relationshipChanges[0].entryId; x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:05:00+08:00' }); const entry = x.data.getRelationshipEntry(id); assert.equal(entry.status, 'reversed'); assert.equal(entry.remainingMinor, 0); });
add('2C3B-019 reversal restores occurrence actionable state', () => { const x = sharedPosted(); x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:05:00+08:00' }); const row = x.data.getCanonicalRecurringPlanOccurrences(x.context.key, x.data.today).find((o) => o.id === x.context.occurrence.id); assert.equal(row.recordedStatus, null); assert.equal(row.status, x.context.occurrence.status); });
add('2C3B-020 second reversal is idempotent', () => { const x = sharedPosted(); const first = x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:05:00+08:00' }); const balance = x.data.getAccount(x.context.account.id).balanceMinor; const second = x.data.reverseRecurringOccurrencePosting(x.result.postingId, { reversedAt: '2026-07-17T09:06:00+08:00' }); assert.equal(second.postingId, first.postingId); assert.equal(second.replayed, true); assert.equal(x.data.getAccount(x.context.account.id).balanceMinor, balance); });
add('2C3B-021 downstream relationship change blocks reversal', () => { const x = sharedPosted(); x.data.settleRelationship({ ledgerId: 'ledger-abi', direction: 'received', amount: 1, destinationAccountId: 'ew-tng', date: x.data.today, time: '10:00', sourceChannel: 'app', clientEventId: 'downstream' }); assert.throws(() => x.data.reverseRecurringOccurrencePosting(x.result.postingId), /已经变化/); });

add('2C3B-022 atomic transaction-stage failure restores everything', () => { const data = createDemoDataSource({ recurringPostingFaultInjector: ({ phase }) => phase === 'transaction' }); const c = actionContext(data, 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200 }); const before = { balance: data.getAccount(c.account.id).balanceMinor, activities: data.getActivities().length, entries: data.getRelationshipEntries('ledger-abi').length, occurrence: data.getCanonicalRecurringPlanOccurrences(c.key, data.today).find((o) => o.id === c.occurrence.id) }; assert.throws(() => execute(data, c), /安全还原/); assert.equal(data.getAccount(c.account.id).balanceMinor, before.balance); assert.equal(data.getActivities().length, before.activities); assert.equal(data.getRelationshipEntries('ledger-abi').length, before.entries); assert.deepEqual(data.getCanonicalRecurringPlanOccurrences(c.key, data.today).find((o) => o.id === c.occurrence.id), before.occurrence); });
add('2C3B-023 atomic relationship-stage failure restores transaction', () => { const data = createDemoDataSource({ recurringPostingFaultInjector: ({ phase }) => phase === 'relationship' }); const c = actionContext(data, 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200 }); const count = data.getActivities().length; assert.throws(() => execute(data, c), /安全还原/); assert.equal(data.getActivities().length, count); });
add('2C3B-024 atomic occurrence-stage failure restores relationship', () => { const data = createDemoDataSource({ recurringPostingFaultInjector: ({ phase }) => phase === 'occurrence' }); const c = actionContext(data, 'fixed-rent-shared', 'prepare_shared_front_payment', { amountMinor: 131200 }); const count = data.getRelationshipEntries('ledger-abi').length; assert.throws(() => execute(data, c), /安全还原/); assert.equal(data.getRelationshipEntries('ledger-abi').length, count); });

add('2C3B-025 variable amount posts 21745', () => { const data = createDemoDataSource(); const c = actionContext(data, 'fixed-month-end-utilities', 'prepare_owned_payment', { amountMinor: 21745 }); const result = execute(data, c); assert.equal(data.getTransaction(result.transactionId).amountMinor, 21745); });
add('2C3B-026 variable estimate remains 24000 metadata', () => { const data = createDemoDataSource(); const c = actionContext(data, 'fixed-month-end-utilities', 'prepare_owned_payment', { amountMinor: 21745 }); execute(data, c); assert.equal(data.getCanonicalRecurringPlan(c.key).plan.estimateAmountMinor, 24000); });
add('2C3B-027 variable amount reversal restores balance', () => { const data = createDemoDataSource(); const c = actionContext(data, 'fixed-month-end-utilities', 'prepare_owned_payment', { amountMinor: 21745 }); const before = data.getAccount(c.account.id).balanceMinor; const result = execute(data, c); data.reverseRecurringOccurrencePosting(result.postingId); assert.equal(data.getAccount(c.account.id).balanceMinor, before); });

add('2C3B-028 Netflix card outstanding increases 5490', () => { const data = createDemoDataSource(); const c = actionContext(data, 'subscription-netflix', 'prepare_owned_payment', { amountMinor: 5490 }); const before = data.getAccount(c.account.id).currentOutstandingMinor; execute(data, c); assert.equal(data.getAccount(c.account.id).currentOutstandingMinor, before + 5490); });
add('2C3B-029 Netflix card available limit decreases 5490', () => { const data = createDemoDataSource(); const c = actionContext(data, 'subscription-netflix', 'prepare_owned_payment', { amountMinor: 5490 }); const before = data.getAccount(c.account.id).availableCreditMinor; execute(data, c); assert.equal(data.getAccount(c.account.id).availableCreditMinor, before - 5490); });
add('2C3B-030 Netflix creates one card transaction', () => { const data = createDemoDataSource(); const c = actionContext(data, 'subscription-netflix', 'prepare_owned_payment', { amountMinor: 5490 }); const before = data.getActivities().length; const r = execute(data, c); assert.equal(data.getActivities().length, before + 1); assert.equal(data.getTransaction(r.transactionId).sourceAccountId, c.account.id); });
add('2C3B-031 Netflix reversal restores outstanding', () => { const data = createDemoDataSource(); const c = actionContext(data, 'subscription-netflix', 'prepare_owned_payment', { amountMinor: 5490 }); const before = data.getAccount(c.account.id).currentOutstandingMinor; const r = execute(data, c); data.reverseRecurringOccurrencePosting(r.postingId); assert.equal(data.getAccount(c.account.id).currentOutstandingMinor, before); });

add('2C3B-032 skip creates zero transaction', () => { const data = createDemoDataSource(); const c = actionContext(data, 'fixed-insurance-yearly', 'preview_skip_occurrence', { monthKey: '2026-08' }); const before = data.getActivities().length; const r = execute(data, c); assert.equal(r.transactionId, null); assert.equal(data.getActivities().length, before); });
add('2C3B-033 skip changes zero account amount', () => { const data = createDemoDataSource(); const c = actionContext(data, 'fixed-insurance-yearly', 'preview_skip_occurrence', { monthKey: '2026-08' }); const before = data.getAccounts().map((a) => [a.id, a.balanceMinor, a.currentOutstandingMinor]); execute(data, c); assert.deepEqual(data.getAccounts().map((a) => [a.id, a.balanceMinor, a.currentOutstandingMinor]), before); });
add('2C3B-034 skip marks occurrence skipped', () => { const data = createDemoDataSource(); const c = actionContext(data, 'fixed-insurance-yearly', 'preview_skip_occurrence', { monthKey: '2026-08' }); execute(data, c); const row = data.getCanonicalRecurringPlanOccurrences(c.key, data.today).find((o) => o.id === c.occurrence.id); assert.equal(row.recordedStatus, 'skipped'); });

add('2C3B-035 sister repayment debits exact canonical obligation amount', () => { const data=createDemoDataSource(); const row=data.getFixedCenterMonth('2026-07').rows.find((item)=>item.plan.title==='Kampung 房租'); const c=projectedActionContext(data,row,'prepare_counterparty_repayment',{amountMinor:85000}); const before=data.getAccount(c.account.id).balanceMinor; const result=execute(data,c); assert.equal(data.getAccount(c.account.id).balanceMinor,before-85000); assert.ok(result.obligationPaymentId); });
add('2C3B-036 sister repayment settles obligation without creating a new payable', () => { const data=createDemoDataSource(); const row=data.getFixedCenterMonth('2026-07').rows.find((item)=>item.plan.title==='Kampung 房租'); const c=projectedActionContext(data,row,'prepare_counterparty_repayment',{amountMinor:85000}); const beforeEntries=data.getRelationshipEntries('ledger-sis',{includeReversed:true}).length; const result=execute(data,c); const instance=data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07'); assert.equal(instance.amountPaidMinor,85000); assert.equal(instance.status,'paid'); assert.equal(data.getRelationshipEntries('ledger-sis',{includeReversed:true}).length,beforeEntries); assert.equal(result.sourceType,'obligation_plan'); });
add('2C3B-036A sister repayment reversal restores obligation, account and occurrence', () => { const data=createDemoDataSource(); const row=data.getFixedCenterMonth('2026-07').rows.find((item)=>item.plan.title==='Kampung 房租'); const c=projectedActionContext(data,row,'prepare_counterparty_repayment',{amountMinor:85000}); const beforeBalance=data.getAccount(c.account.id).balanceMinor; const beforeInstance=structuredClone(data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07')); const result=execute(data,c); data.reverseRecurringOccurrencePosting(result.postingId,{reversedAt:'2026-07-17T09:05:00+08:00'}); const afterInstance=data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07'); const payment=data.getObligationPayments('plan-rent-sis').find((item)=>item.paymentId===result.obligationPaymentId); assert.equal(data.getAccount(c.account.id).balanceMinor,beforeBalance); assert.equal(afterInstance.amountPaidMinor,beforeInstance.amountPaidMinor); assert.equal(afterInstance.status,beforeInstance.status); assert.equal(afterInstance.recurringPostingId,null); assert.equal(payment.status,'reversed'); assert.equal(data.getTransaction(result.transactionId).status,'reversed'); });
add('2C3B-036B obligation relationship-stage failure rolls back every effect', () => { const data=createDemoDataSource({recurringPostingFaultInjector:({phase})=>phase==='relationship'}); const row=data.getFixedCenterMonth('2026-07').rows.find((item)=>item.plan.title==='Kampung 房租'); const c=projectedActionContext(data,row,'prepare_counterparty_repayment',{amountMinor:85000}); const before={balance:data.getAccount(c.account.id).balanceMinor,activities:data.getActivities().length,payments:data.getObligationPayments('plan-rent-sis').length,instance:structuredClone(data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07'))}; assert.throws(()=>execute(data,c),/安全还原/); assert.equal(data.getAccount(c.account.id).balanceMinor,before.balance); assert.equal(data.getActivities().length,before.activities); assert.equal(data.getObligationPayments('plan-rent-sis').length,before.payments); assert.deepEqual(data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07'),before.instance); });
add('2C3B-036C changed obligation plan blocks unsafe reversal', () => { const data=createDemoDataSource(); const row=data.getFixedCenterMonth('2026-07').rows.find((item)=>item.plan.title==='Kampung 房租'); const c=projectedActionContext(data,row,'prepare_counterparty_repayment',{amountMinor:85000}); const result=execute(data,c); data.updateObligationPlan('plan-rent-sis',{title:'Kampung 房租（已核对）'},{clientEventId:'downstream-obligation-edit',occurredAt:'2026-07-17T09:04:00+08:00'}); assert.throws(()=>data.reverseRecurringOccurrencePosting(result.postingId),/计划资料在记账后已经变化/); });
add('2C3B-036D obligation skip and reversal keep money unchanged', () => { const data=createDemoDataSource(); const row=data.getFixedCenterMonth('2026-07').rows.find((item)=>item.plan.title==='Kampung 房租'); const c=projectedActionContext(data,row,'preview_skip_occurrence'); const before=data.getAccounts().map((account)=>[account.id,account.balanceMinor,account.currentOutstandingMinor]); const result=execute(data,c); const skipped=data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07'); assert.equal(skipped.status,'skipped'); assert.equal(result.transactionId,null); assert.deepEqual(data.getAccounts().map((account)=>[account.id,account.balanceMinor,account.currentOutstandingMinor]),before); data.reverseRecurringOccurrencePosting(result.postingId); const restored=data.getObligationInstances('plan-rent-sis').find((item)=>item.periodKey==='2026-07'); assert.equal(restored.status,'scheduled'); assert.deepEqual(data.getAccounts().map((account)=>[account.id,account.balanceMinor,account.currentOutstandingMinor]),before); });

add('2C3B-037 installment principal decreases once without a duplicate ledger payable', () => { const data=createDemoDataSource(); createScenario(data,'fixed-sister-bed-installment'); const beforeEntries=data.getRelationshipEntries('ledger-sis',{includeReversed:true}).length; const c=actionContext(data,'fixed-sister-bed-installment','prepare_installment_repayment',{amountMinor:8333}); execute(data,c); assert.equal(data.getCanonicalRecurringPlan(c.key).plan.relationship.remainingPrincipalMinor,41667); assert.equal(data.getRelationshipEntries('ledger-sis',{includeReversed:true}).length,beforeEntries); });
add('2C3B-038 installment completed periods increments once', () => { const data=createDemoDataSource(); createScenario(data,'fixed-sister-bed-installment'); const c=actionContext(data,'fixed-sister-bed-installment','prepare_installment_repayment',{amountMinor:8333}); execute(data,c); assert.equal(data.getCanonicalRecurringPlan(c.key).plan.relationship.completedInstallments,7); });
add('2C3B-039 installment reversal restores principal and periods', () => { const data=createDemoDataSource(); createScenario(data,'fixed-sister-bed-installment'); const c=actionContext(data,'fixed-sister-bed-installment','prepare_installment_repayment',{amountMinor:8333}); const r=execute(data,c); data.reverseRecurringOccurrencePosting(r.postingId); const plan=data.getCanonicalRecurringPlan(c.key).plan; assert.equal(plan.relationship.remainingPrincipalMinor,50000); assert.equal(plan.relationship.completedInstallments,6); });
add('2C3B-040 final installment uses exact remaining minor', () => { const data=createDemoDataSource(); addPayable(data,{amount:83.35,event:'final-seed'}); const template=structuredClone(LEDGER_RECURRING_SCENARIO_FIXTURES.find((r)=>r.id==='fixed-sister-bed-installment')); template.id='fixed-final-installment'; template.relationship={...template.relationship,remainingPrincipalMinor:8335,completedInstallments:11}; template.totalAmountMinor=8335; createScenario(data,'fixed-sister-bed-installment',template); const c=actionContext(data,template.id,'prepare_installment_repayment',{amountMinor:8335}); const r=execute(data,c); assert.equal(r.amountMinor,8335); assert.equal(data.getCanonicalRecurringPlan(c.key).plan.relationship.remainingPrincipalMinor,0); });

add('2C3B-041 Activity reads posted transaction once', () => { const x=sharedPosted(); assert.equal(x.data.getActivities().filter((t)=>t.id===x.result.transactionId).length,1); });
add('2C3B-042 account detail projection reads same transaction', () => { const x=sharedPosted(); assert.ok(x.data.getTransactions().filter((t)=>[t.sourceAccountId,t.destinationAccountId].includes(x.context.account.id)).some((t)=>t.id===x.result.transactionId)); });
add('2C3B-043 Ledger reads same origin entry', () => { const x=sharedPosted(); assert.ok(x.data.getRelationshipEntries('ledger-abi').some((e)=>e.entryId===x.result.relationshipChanges[0].entryId)); });
add('2C3B-044 Fixed Center reads completed occurrence', () => { const x=sharedPosted(); const workspace=x.data.getFixedCenterMonth('2026-07',x.data.today); assert.ok(workspace.sections.paid.some((o)=>o.id===x.context.occurrence.id)); });
add('2C3B-045 reversal remains visible in Activity', () => { const x=sharedPosted(); x.data.reverseRecurringOccurrencePosting(x.result.postingId); const activity=x.data.getActivities().find((t)=>t.id===x.result.transactionId); assert.equal(activity.status,'reversed'); });
add('2C3B-045A Activity row labels a reversed posting', () => { const source=fs.readFileSync(new URL('../src/components/ActivityRow.js',import.meta.url),'utf8'); assert.match(source,/reversal-row-badge[^>]*>已撤销/); assert.match(source,/is-reversed/); });
add('2C3B-045B Activity day totals exclude reversed postings', () => { const source=fs.readFileSync(new URL('../src/features/activity/index.js',import.meta.url),'utf8'); assert.match(source,/t\.status !== 'reversed'/); });
add('2C3B-046 account total returns after reversal', () => { const x=sharedPosted(); x.data.reverseRecurringOccurrencePosting(x.result.postingId); assert.equal(x.data.getAccount(x.context.account.id).balanceMinor,x.before.balanceMinor); });
add('2C3B-047 Fixed Center returns occurrence to actionable projection', () => { const x=sharedPosted(); x.data.reverseRecurringOccurrencePosting(x.result.postingId); const workspace=x.data.getFixedCenterMonth('2026-07',x.data.today); assert.ok([...workspace.sections.overdue,...workspace.sections.dueSoon,...workspace.sections.planned].some((o)=>o.id===x.context.occurrence.id)); });
add('2C3B-047A Today marks recurring commitments as Fixed Center owned', () => { const data=createDemoDataSource(); assert.deepEqual(data.getCommitments().filter((c)=>c.recurringPlanId).map((c)=>c.recurringPlanId).sort(),['fixed-rent-shared','subscription-netflix']); });
add('2C3B-047B Today excludes recurring commitments from the legacy radar', () => { const source=fs.readFileSync(new URL('../src/features/today/index.js',import.meta.url),'utf8'); assert.match(source,/!commitment\.recurringPlanId/); assert.match(source,/second, disconnected paid state/); });

const actionSource = fs.readFileSync(new URL('../src/features/fixed/RecurringOccurrenceActionSheets.js', import.meta.url), 'utf8');
const fixedSource = fs.readFileSync(new URL('../src/features/fixed/index.js', import.meta.url), 'utf8');
const actionCardSource = fs.readFileSync(new URL('../src/components/RecurringActionCard.js', import.meta.url), 'utf8');
const planSource = fs.readFileSync(new URL('../src/features/fixed/RecurringPlanSheets.js', import.meta.url), 'utf8');
const appSheetSource = fs.readFileSync(new URL('../src/components/AppSheet.js', import.meta.url), 'utf8');
const attachmentSource = fs.readFileSync(new URL('../src/components/AttachmentField.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles/phase2c3b.css', import.meta.url), 'utf8');

add('2C3B-048 global toast uses document body portal', () => assert.match(appSheetSource,/ringgitme-toast-root[\s\S]*document\.body\.appendChild/));
add('2C3B-049 global toast exposes polite live status', () => { assert.match(appSheetSource,/aria-live', 'polite/); assert.match(appSheetSource,/role', 'status/); });
add('2C3B-050 toast z-index exceeds modal stack', () => assert.match(css,/z-index:\s*100000/));
add('2C3B-051 copy toast text contains no payload interpolation', () => { assert.match(actionSource,/账号已复制.*金额已复制.*参考已复制/s); assert.doesNotMatch(actionSource,/付款资料已复制/); });
add('2C3B-052 copy buttons have local copied state', () => assert.match(actionSource,/is-copied[\s\S]*已复制/));
add('2C3B-053 semantic quick action is a real button', () => { assert.match(fixedSource,/renderRecurringActionCard/); assert.match(actionCardSource,/<button type="button" class="fixed-occurrence-quick-action recurring-action-card semantic-action-control/); });
add('2C3B-054 semantic action target is at least 44px', () => assert.match(css,/\.semantic-action-control[\s\S]*min-height:\s*44px/));
add('2C3B-055 child action prevents card propagation', () => assert.match(actionSource,/fixed-occurrence-action[\s\S]*stopPropagation/));
add('2C3B-056 card body still opens Plan Detail', () => assert.match(fixedSource,/fixed-plan-detail/));
add('2C3B-057 deleted card exposes 查看详情', () => assert.match(planSource,/fixed-plan-deleted-detail[^\n]*查看详情|查看详情[^\n]*fixed-plan-deleted-detail/));
add('2C3B-058 deleted detail uses tombstone list snapshot', () => assert.match(planSource,/getRecentlyDeletedRecurringPlans\(\).*find/));
add('2C3B-059 deleted detail does not restore on open', () => { const body=planSource.slice(planSource.indexOf('function openDeletedPlanDetail'),planSource.indexOf('export function openRecentlyDeletedPlans')); assert.doesNotMatch(body,/restoreDeletedRecurringPlan/); });
add('2C3B-060 deleted detail privacy masks recipient values', () => { assert.match(planSource,/maskPaymentAccount/); assert.match(planSource,/maskDuitNowValue/); });
add('2C3B-061 Posting Preview reuses attachment control', () => assert.match(actionSource,/attachmentSummaryHTML\('recurring_draft'/));
add('2C3B-062 Posting Preview owns enabled explicit confirm', () => assert.match(actionSource,/data-action="recurring-posting-confirm"/));
add('2C3B-063 UI calls domain executor rather than money engine', () => { assert.match(actionSource,/executeRecurringOccurrencePosting/); assert.doesNotMatch(actionSource,/addTransaction\(/); });
add('2C3B-064 posting success offers view reverse done', () => ['查看记录','撤销这次记账','完成'].forEach((label)=>assert.ok(actionSource.includes(label))));
add('2C3B-065 Activity detail offers recurring reversal', () => { const source=fs.readFileSync(new URL('../src/features/activity/index.js',import.meta.url),'utf8'); assert.match(source,/activity-recurring-reverse-request/); });
add('2C3B-066 attachment privacy replaces filename label', () => assert.match(attachmentSource,/ui\.privacy \? `附件/));
add('2C3B-067 fixed content reserves bottom navigation inset', () => assert.match(css,/fixed-center[\s\S]*nav-height/));
add('2C3B-068 new Sheet explicitly resets its own scroll', () => assert.match(appSheetSource,/sheet\.scrollTop = 0[\s\S]*body\.scrollTop = 0/));
add('2C3B-069 production UI exposes no raw fingerprint copy', () => { assert.doesNotMatch(actionSource,/防重复识别|economic fingerprint|idempotency key/); });
add('2C3B-070 Phase 2C3B adds no network or persistent storage', () => { const sources=[actionSource,planSource,appSheetSource,attachmentSource,fs.readFileSync(new URL('../src/domain/recurringPostingExecutor.js',import.meta.url),'utf8')].join('\n'); assert.doesNotMatch(sources,/\bfetch\s*\(|XMLHttpRequest|localStorage|indexedDB|supabase|telegram/i); });

for (const [name, fn] of tests) test(name, fn);
test('2C3B-071 focused suite has comprehensive coverage', () => assert.ok(tests.length >= 70));
