import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveRecurringOccurrenceActions, RECURRING_ACTION_TYPES } from '../src/domain/recurringOccurrenceActions.js';
import {
  canonicalizeRecurringActionDraft,
  compareIdempotentAttempt,
  createRecurringActionDraft,
  createRecurringActionIdempotencyKey,
  fingerprintRecurringActionDraft,
  stableRecurringActionJSON,
} from '../src/domain/recurringActionIdentity.js';
import { buildRecurringPostingPreview, RECURRING_PREVIEW_VALIDATION_CODES } from '../src/domain/recurringPostingPreview.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ME = 'participant-me';
const SIS = 'participant-sis';
const ABI = 'participant-abi';
const JASON = 'participant-jason';

const accounts = [
  { id: 'sv-mbb', type: 'saving', name: 'Maybank 储蓄卡', balanceMinor: 200000, owned: true },
  { id: 'cc-mbb', type: 'cc', name: 'Maybank Visa', currentOutstandingMinor: 320000, owned: true },
  { id: 'sv-foreign', type: 'saving', name: '他人账户', balanceMinor: 50000, owned: false },
];

function plan(overrides = {}) {
  return {
    id: 'plan-own', planKind: 'fixed_expense', title: '固定账单', categoryId: 'bill',
    amountMode: 'fixed', totalAmountMinor: 5490, fixedAmountMinor: 5490,
    estimateAmountMinor: null, status: 'active', archivedAt: null, revision: 3,
    paymentSourceAccountId: 'sv-mbb', recordOnlyDefault: false,
    relationshipMode: null, relationship: null, subscriptionFundingMode: null,
    ...structuredClone(overrides),
  };
}

function occurrence(owner = plan(), overrides = {}) {
  return {
    id: `occurrence:${owner.id}:2026-07`, planId: owner.id, dueDate: '2026-07-20',
    status: 'upcoming', recordedStatus: null, revision: 2, planRevision: owner.revision,
    amountMode: owner.amountMode, amountState: owner.amountMode === 'variable' ? 'estimated' : 'fixed_planned',
    amountPending: owner.amountMode === 'variable', actualAmountMinor: null,
    totalAmountMinor: owner.totalAmountMinor, ownShareMinor: owner.totalAmountMinor,
    cashOutflowMinor: owner.totalAmountMinor, receivableMinor: 0, payableMinor: 0,
    ...structuredClone(overrides),
  };
}

function sharedPlan({ payer = ME, id = 'plan-shared', amount = 131200 } = {}) {
  return plan({
    id, title: '房租', totalAmountMinor: amount, fixedAmountMinor: amount,
    relationshipMode: 'shared_bill',
    relationship: {
      ledgerId: 'ledger-sis', participantIds: [ME, SIS], authenticatedParticipantId: ME,
      payerParticipantId: payer, splitMode: 'custom', paymentMode: 'full_bill',
      shares: [{ participantId: ME, amountMinor: Math.floor(amount / 2) }, { participantId: SIS, amountMinor: amount - Math.floor(amount / 2) }],
    },
  });
}

function partnerSubscription() {
  return plan({
    id: 'plan-spotify', planKind: 'subscription', title: 'Spotify Family',
    totalAmountMinor: 2390, fixedAmountMinor: 2390, subscriptionFundingMode: 'other_pays',
    relationshipMode: 'shared_bill', relationship: {
      ledgerId: 'ledger-abi', participantIds: [ME, ABI], authenticatedParticipantId: ME,
      payerParticipantId: ABI, splitMode: 'custom', paymentMode: 'full_bill',
      shares: [{ participantId: ME, amountMinor: 1195 }, { participantId: ABI, amountMinor: 1195 }],
    },
  });
}

function installmentPlan(remaining = 50000, installment = 8333) {
  return plan({
    id: 'plan-installment', planKind: 'recurring_relationship', title: '床架分期',
    totalAmountMinor: Math.min(remaining, installment), fixedAmountMinor: Math.min(remaining, installment),
    relationshipMode: 'installment_repayment', relationship: {
      ledgerId: 'ledger-sis', participantIds: [ME, SIS], authenticatedParticipantId: ME,
      creditorParticipantId: SIS, debtorParticipantId: ME,
      originalPrincipalMinor: 100000, remainingPrincipalMinor: remaining,
      installmentAmountMinor: installment, completedInstallments: 6, plannedInstallmentCount: 12,
    },
  });
}

function variablePlan() {
  return plan({
    id: 'plan-water', title: '月末水电预算', amountMode: 'variable',
    totalAmountMinor: 24000, fixedAmountMinor: null, estimateAmountMinor: 24000,
  });
}

function centralPlan() {
  return plan({
    id: 'plan-family', planKind: 'recurring_relationship', title: '家庭房租',
    totalAmountMinor: 25000, fixedAmountMinor: 25000, relationshipMode: 'central_collection',
    relationship: {
      ledgerId: 'ledger-family', participantIds: [ME, SIS, JASON], authenticatedParticipantId: ME,
      collectorParticipantId: ME, externalPayerParticipantId: ME, splitMode: 'custom',
      shares: [{ participantId: ME, amountMinor: 8334 }, { participantId: SIS, amountMinor: 8333 }, { participantId: JASON, amountMinor: 8333 }],
    },
  });
}

function actions(owner, row = occurrence(owner), options = {}) {
  return deriveRecurringOccurrenceActions({ plan: owner, occurrence: row, actorId: ME, ...options });
}

function actionOf(owner, row, type, memberId = null) {
  return actions(owner, row).find((action) => action.actionType === type && (memberId == null || action.memberId === memberId));
}

function draftFor(owner, row, type, overrides = {}) {
  const localRow = owner.amountMode === 'variable' && Number.isInteger(overrides.amountMinor)
    ? { ...row, actualAmountMinor: overrides.amountMinor, amountPending: false, amountState: 'actual' }
    : row;
  const action = actionOf(owner, localRow, type, overrides.memberId);
  return createRecurringActionDraft({
    action, plan: owner, occurrence: row, actorId: ME,
    amountMinor: Object.hasOwn(overrides, 'amountMinor') ? overrides.amountMinor : row.totalAmountMinor,
    sourceAccountId: overrides.sourceAccountId === undefined ? 'sv-mbb' : overrides.sourceAccountId,
    sourceAccountKind: overrides.sourceAccountKind === undefined ? 'saving' : overrides.sourceAccountKind,
    counterpartyId: overrides.counterpartyId ?? action?.counterpartyId,
    memberId: overrides.memberId ?? action?.memberId,
    groupId: overrides.groupId ?? owner.relationship?.ledgerId,
    occurredAt: overrides.occurredAt ?? '2026-07-17T09:00:00+08:00',
    clientEventId: overrides.clientEventId ?? `event-${type}`,
    note: overrides.note ?? null,
  });
}

function preview(owner, row, type, overrides = {}) {
  const actionDraft = overrides.actionDraft || draftFor(owner, row, type, overrides);
  return buildRecurringPostingPreview({ actionDraft, plan: overrides.plan === undefined ? owner : overrides.plan, occurrence: overrides.occurrence === undefined ? row : overrides.occurrence, accounts: overrides.accounts || accounts, actorId: ME, previousAttempt: overrides.previousAttempt || null });
}

// Action availability — 46 focused cases.
const availabilityCases = [
  ['own fixed', plan(), 'prepare_owned_payment', true, 'outflow'],
  ['own subscription', plan({ id: 'plan-netflix', planKind: 'subscription', title: 'Netflix', subscriptionFundingMode: 'self' }), 'prepare_owned_payment', true, 'outflow'],
  ['shared user fronts', sharedPlan(), 'prepare_shared_front_payment', true, 'outflow_and_receivable'],
  ['shared counterparty fronts', sharedPlan({ payer: SIS }), 'prepare_counterparty_repayment', true, 'outflow'],
  ['partner subscription', partnerSubscription(), 'prepare_subscription_repayment', true, 'outflow'],
  ['installment', installmentPlan(), 'prepare_installment_repayment', true, 'outflow'],
  ['variable missing amount fill', variablePlan(), 'fill_occurrence_amount', true, 'none'],
  ['variable missing payment disabled', variablePlan(), 'prepare_owned_payment', false, 'outflow'],
  ['central member sister', centralPlan(), 'prepare_member_receipt', true, 'inflow'],
  ['central outward', centralPlan(), 'prepare_central_outward_payment', true, 'outflow'],
];

availabilityCases.forEach(([name, owner, type, enabled, direction], index) => {
  const row = occurrence(owner, owner.amountMode === 'variable' ? { totalAmountMinor: 24000, ownShareMinor: 24000, cashOutflowMinor: 24000 } : {});
  test(`2C3A-${String(index + 1).padStart(3, '0')}: ${name} exposes ${type}`, () => {
    const item = actions(owner, row).find((action) => action.actionType === type);
    assert.ok(item);
    assert.equal(item.enabled, enabled);
    assert.equal(item.expectedMoneyDirection, direction);
  });
});

const actionFieldChecks = [
  ['actionId'], ['actionType'], ['occurrenceId'], ['planId'], ['label'], ['description'], ['tone'], ['enabled'],
  ['disabledReason'], ['requiresAmount'], ['requiresSourceAccount'], ['requiresCounterparty'], ['requiresMember'],
  ['expectedMoneyDirection'], ['postingIntent'],
];
actionFieldChecks.forEach(([field], index) => test(`2C3A-${String(11 + index).padStart(3, '0')}: action descriptor owns ${field}`, () => {
  assert.ok(Object.hasOwn(actions(plan())[0], field));
}));

[
  ['paid', 'OCCURRENCE_ALREADY_COMPLETED'],
  ['charged', 'OCCURRENCE_ALREADY_COMPLETED'],
  ['received', 'OCCURRENCE_ALREADY_COMPLETED'],
  ['repaid', 'OCCURRENCE_ALREADY_COMPLETED'],
  ['completed', 'OCCURRENCE_ALREADY_COMPLETED'],
  ['skipped', 'OCCURRENCE_SKIPPED'],
].forEach(([status, reason], index) => test(`2C3A-${String(26 + index).padStart(3, '0')}: ${status} has no enabled financial action`, () => {
  const owner = plan();
  const row = occurrence(owner, { status, recordedStatus: status });
  const payment = actionOf(owner, row, 'prepare_owned_payment');
  assert.equal(payment.enabled, false);
  assert.equal(payment.disabledReason, reason);
}));

[
  ['paused', { status: 'paused' }],
  ['stopped', { status: 'stopped' }],
  ['archived', { archivedAt: '2026-07-01T00:00:00+08:00' }],
].forEach(([name, changes], index) => test(`2C3A-${String(32 + index).padStart(3, '0')}: ${name} plan fails closed`, () => {
  const owner = plan(changes);
  assert.equal(actionOf(owner, occurrence(owner), 'prepare_owned_payment').enabled, false);
}));

test('2C3A-035: record-only payment is disabled', () => {
  const owner = plan({ recordOnlyDefault: true });
  assert.equal(actionOf(owner, occurrence(owner), 'prepare_owned_payment').enabled, false);
});
test('2C3A-036: invalid relationship fails closed', () => {
  const owner = sharedPlan(); owner.relationship.ledgerId = null;
  assert.equal(actionOf(owner, occurrence(owner), 'prepare_shared_front_payment').enabled, false);
});
test('2C3A-037: installment with zero principal is unavailable', () => {
  const owner = installmentPlan(0);
  assert.equal(actionOf(owner, occurrence(owner), 'prepare_installment_repayment').enabled, false);
});
test('2C3A-038: central collection creates one receipt action per other member', () => {
  const owner = centralPlan();
  assert.deepEqual(actions(owner, occurrence(owner)).filter((item) => item.actionType === 'prepare_member_receipt').map((item) => item.memberId), [SIS, JASON]);
});
test('2C3A-039: unpaid member filter keeps only eligible member', () => {
  const owner = centralPlan();
  const rows = actions(owner, occurrence(owner), { unpaidMemberIds: [JASON] });
  assert.deepEqual(rows.filter((item) => item.actionType === 'prepare_member_receipt').map((item) => item.memberId), [JASON]);
});
test('2C3A-040: action selection never mutates plan', () => {
  const owner = sharedPlan(); const before = structuredClone(owner); actions(owner, occurrence(owner)); assert.deepEqual(owner, before);
});
test('2C3A-041: action selection never mutates occurrence', () => {
  const owner = sharedPlan(); const row = occurrence(owner); const before = structuredClone(row); actions(owner, row); assert.deepEqual(row, before);
});
test('2C3A-042: action IDs are stable across repeated selection', () => {
  const owner = centralPlan(); const row = occurrence(owner); assert.deepEqual(actions(owner, row).map((item) => item.actionId), actions(owner, row).map((item) => item.actionId));
});
test('2C3A-043: canonical action type list contains nine unique values', () => {
  assert.equal(RECURRING_ACTION_TYPES.length, 9); assert.equal(new Set(RECURRING_ACTION_TYPES).size, 9);
});
test('2C3A-044: action descriptors are frozen', () => assert.equal(Object.isFrozen(actions(plan())[0]), true));
test('2C3A-045: skip is available for active pending occurrence', () => assert.equal(actionOf(plan(), occurrence(plan()), 'preview_skip_occurrence').enabled, true));
test('2C3A-046: variable reference estimate is never treated as confirmed amount', () => assert.equal(actionOf(variablePlan(), occurrence(variablePlan()), 'prepare_owned_payment').enabled, false));

// Canonical draft and idempotency — 48 cases.
const draftFields = ['version','actionType','actorId','planId','occurrenceId','occurrenceRevision','planRevision','amountMinor','sourceAccountId','sourceAccountKind','counterpartyId','groupId','memberId','note','occurredAt','clientEventId','idempotencyKey'];
draftFields.forEach((field, index) => test(`2C3A-${String(47 + index).padStart(3, '0')}: canonical draft owns ${field}`, () => {
  const owner = plan(); const row = occurrence(owner); assert.ok(Object.hasOwn(draftFor(owner, row, 'prepare_owned_payment'), field));
}));

test('2C3A-064: canonical draft is frozen', () => {
  const owner = plan(); assert.equal(Object.isFrozen(draftFor(owner, occurrence(owner), 'prepare_owned_payment')), true);
});
test('2C3A-065: amount remains integer minor units', () => {
  const owner = plan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_owned_payment').amountMinor, 5490);
});
test('2C3A-066: missing amount never falls back from variable estimate', () => {
  const owner = variablePlan(); const row = occurrence(owner); assert.equal(draftFor(owner, row, 'fill_occurrence_amount', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }).amountMinor, null);
});
test('2C3A-067: plan revision captured', () => { const owner = plan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_owned_payment').planRevision, 3); });
test('2C3A-068: occurrence revision captured', () => { const owner = plan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_owned_payment').occurrenceRevision, 2); });
test('2C3A-069: key contains actor identity', () => assert.match(createRecurringActionIdempotencyKey({ actorId: ME, occurrenceId: 'occ', actionType: 'pay', clientEventId: 'evt' }), /participant-me/));
test('2C3A-070: key contains occurrence identity', () => assert.match(createRecurringActionIdempotencyKey({ actorId: ME, occurrenceId: 'occ-7', actionType: 'pay', clientEventId: 'evt' }), /occ-7/));
test('2C3A-071: key contains action identity', () => assert.match(createRecurringActionIdempotencyKey({ actorId: ME, occurrenceId: 'occ', actionType: 'pay-owned', clientEventId: 'evt' }), /pay-owned/));
test('2C3A-072: key contains explicit client event', () => assert.match(createRecurringActionIdempotencyKey({ actorId: ME, occurrenceId: 'occ', actionType: 'pay', clientEventId: 'tap-2' }), /tap-2/));
test('2C3A-073: repeated explicit event produces same key', () => {
  const input = { actorId: ME, occurrenceId: 'occ', actionType: 'pay', clientEventId: 'tap' }; assert.equal(createRecurringActionIdempotencyKey(input), createRecurringActionIdempotencyKey(input));
});
test('2C3A-074: different client event produces different key', () => {
  const base = { actorId: ME, occurrenceId: 'occ', actionType: 'pay' }; assert.notEqual(createRecurringActionIdempotencyKey({ ...base, clientEventId: 'a' }), createRecurringActionIdempotencyKey({ ...base, clientEventId: 'b' }));
});
test('2C3A-075: fingerprint stable across object key ordering', () => {
  const a = canonicalizeRecurringActionDraft({ actionType: 'x', actorId: ME, planId: 'p', occurrenceId: 'o', amountMinor: 1, clientEventId: 'e' });
  const b = canonicalizeRecurringActionDraft({ clientEventId: 'e', amountMinor: 1, occurrenceId: 'o', planId: 'p', actorId: ME, actionType: 'x' });
  assert.equal(fingerprintRecurringActionDraft(a), fingerprintRecurringActionDraft(b));
});
test('2C3A-076: fingerprint changes with one cent', () => {
  const owner = plan(); const row = occurrence(owner); const a = draftFor(owner, row, 'prepare_owned_payment'); const b = canonicalizeRecurringActionDraft({ ...a, amountMinor: a.amountMinor + 1 }); assert.notEqual(fingerprintRecurringActionDraft(a), fingerprintRecurringActionDraft(b));
});
test('2C3A-077: note does not change financial fingerprint', () => {
  const owner = plan(); const row = occurrence(owner); const a = draftFor(owner, row, 'prepare_owned_payment'); const b = canonicalizeRecurringActionDraft({ ...a, note: 'human note' }); assert.equal(fingerprintRecurringActionDraft(a), fingerprintRecurringActionDraft(b));
});
test('2C3A-078: same key same fingerprint is safe replay', () => {
  const owner = plan(); const row = occurrence(owner); const value = draftFor(owner, row, 'prepare_owned_payment'); assert.equal(compareIdempotentAttempt(value, value).status, 'safe_replay');
});
test('2C3A-079: same key different fingerprint conflicts', () => {
  const owner = plan(); const row = occurrence(owner); const a = draftFor(owner, row, 'prepare_owned_payment'); const b = canonicalizeRecurringActionDraft({ ...a, amountMinor: 5491 }); assert.equal(compareIdempotentAttempt(a, b).code, 'IDEMPOTENCY_CONFLICT');
});
test('2C3A-080: different key is a new attempt', () => {
  const owner = plan(); const row = occurrence(owner); const a = draftFor(owner, row, 'prepare_owned_payment'); const b = draftFor(owner, row, 'prepare_owned_payment', { clientEventId: 'another' }); assert.equal(compareIdempotentAttempt(a, b).status, 'new_attempt');
});
test('2C3A-081: missing key comparison fails closed', () => {
  const owner = plan(); const row = occurrence(owner); const a = draftFor(owner, row, 'prepare_owned_payment'); const b = canonicalizeRecurringActionDraft({ ...a, idempotencyKey: null }); assert.equal(compareIdempotentAttempt(a, b).code, 'IDEMPOTENCY_KEY_REQUIRED');
});
test('2C3A-082: stable JSON sorts nested keys', () => assert.equal(stableRecurringActionJSON({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}'));
test('2C3A-083: undefined canonical values become null', () => assert.equal(canonicalizeRecurringActionDraft({}).amountMinor, null));
test('2C3A-084: whitespace IDs are normalized', () => assert.equal(canonicalizeRecurringActionDraft({ actorId: '  participant-me  ' }).actorId, ME));
test('2C3A-085: non-integer amount canonicalizes to null', () => assert.equal(canonicalizeRecurringActionDraft({ amountMinor: 1.2 }).amountMinor, null));
test('2C3A-086: fingerprint has versioned short prefix', () => assert.match(fingerprintRecurringActionDraft({ actionType: 'x' }), /^rafp1-[0-9a-f]{16}$/));
test('2C3A-087: draft is serializable', () => { const owner = plan(); assert.doesNotThrow(() => JSON.stringify(draftFor(owner, occurrence(owner), 'prepare_owned_payment'))); });
test('2C3A-088: source account kind is explicit', () => { const owner = plan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_owned_payment').sourceAccountKind, 'saving'); });
test('2C3A-089: relationship group identity is explicit', () => { const owner = sharedPlan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_shared_front_payment').groupId, 'ledger-sis'); });
test('2C3A-090: counterparty identity is explicit', () => { const owner = sharedPlan({ payer: SIS }); assert.equal(draftFor(owner, occurrence(owner), 'prepare_counterparty_repayment').counterpartyId, SIS); });
test('2C3A-091: member identity is explicit', () => { const owner = centralPlan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }).memberId, SIS); });
test('2C3A-092: canonical timestamp is retained exactly', () => { const owner = plan(); assert.equal(draftFor(owner, occurrence(owner), 'prepare_owned_payment').occurredAt, '2026-07-17T09:00:00+08:00'); });
test('2C3A-093: no random UUID appears in deterministic draft', () => { const owner = plan(); assert.doesNotMatch(JSON.stringify(draftFor(owner, occurrence(owner), 'prepare_owned_payment')), /randomUUID|Math\.random/); });
test('2C3A-094: canonical key ignores note but not account', () => { const owner = plan(); const row = occurrence(owner); const a = draftFor(owner, row, 'prepare_owned_payment'); const b = canonicalizeRecurringActionDraft({ ...a, sourceAccountId: 'cc-mbb' }); assert.notEqual(fingerprintRecurringActionDraft(a), fingerprintRecurringActionDraft(b)); });

// Posting preview money semantics — 70 cases.
test('2C3A-095: owned expense preview is valid', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').validation.valid, true); });
test('2C3A-096: owned savings debit is RM54.90', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.accounts[0].amountMinor, 5490); });
test('2C3A-097: owned before balance is real RM2,000', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.accounts[0].beforeMinor, 200000); });
test('2C3A-098: owned after balance is RM1,945.10', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.accounts[0].afterMinor, 194510); });
test('2C3A-099: owned creates expense transaction draft', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.transactions[0].transactionKind, 'expense'); });
test('2C3A-100: owned occurrence proposes paid', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.occurrences[0].toStatus, 'paid'); });

test('2C3A-101: subscription card effect increases outstanding', () => {
  const owner = plan({ id: 'sub', planKind: 'subscription', subscriptionFundingMode: 'self' }); const row = occurrence(owner);
  const value = preview(owner, row, 'prepare_owned_payment', { sourceAccountId: 'cc-mbb', sourceAccountKind: 'cc' });
  assert.equal(value.effects.accounts[0].effectType, 'credit_outstanding_change'); assert.equal(value.effects.accounts[0].afterMinor, 325490);
});
test('2C3A-102: subscription proposes charged', () => { const owner = plan({ id: 'sub', planKind: 'subscription', subscriptionFundingMode: 'self' }); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.occurrences[0].toStatus, 'charged'); });

test('2C3A-103: shared front debits full RM1,312', () => { const owner = sharedPlan(); assert.equal(preview(owner, occurrence(owner, { ownShareMinor: 65600, cashOutflowMinor: 131200, receivableMinor: 65600 }), 'prepare_shared_front_payment').effects.accounts[0].amountMinor, 131200); });
test('2C3A-104: shared front economic burden is RM656', () => { const owner = sharedPlan(); assert.equal(preview(owner, occurrence(owner, { ownShareMinor: 65600, cashOutflowMinor: 131200, receivableMinor: 65600 }), 'prepare_shared_front_payment').effects.transactions[0].economicBurdenMinor, 65600); });
test('2C3A-105: shared front creates RM656 receivable', () => { const owner = sharedPlan(); assert.equal(preview(owner, occurrence(owner, { ownShareMinor: 65600, cashOutflowMinor: 131200, receivableMinor: 65600 }), 'prepare_shared_front_payment').effects.relationships[0].amountMinor, 65600); });
test('2C3A-106: shared front creates no future income', () => { const owner = sharedPlan(); assert.equal(preview(owner, occurrence(owner), 'prepare_shared_front_payment').effects.transactions.some((entry) => entry.transactionKind === 'income'), false); });

test('2C3A-107: sister repayment uses RM83.33', () => {
  const owner = sharedPlan({ payer: SIS, amount: 16666 }); const row = occurrence(owner, { totalAmountMinor: 16666, ownShareMinor: 8333, cashOutflowMinor: 0, payableMinor: 8333 });
  assert.equal(preview(owner, row, 'prepare_counterparty_repayment', { amountMinor: 8333 }).effects.accounts[0].amountMinor, 8333);
});
test('2C3A-108: sister repayment reduces payable', () => {
  const owner = sharedPlan({ payer: SIS, amount: 16666 }); const row = occurrence(owner, { totalAmountMinor: 16666, ownShareMinor: 8333, cashOutflowMinor: 0, payableMinor: 8333 });
  assert.equal(preview(owner, row, 'prepare_counterparty_repayment', { amountMinor: 8333 }).effects.relationships[0].effectType, 'payable_reduction');
});
test('2C3A-109: sister repayment is not external bill expense semantic', () => {
  const owner = sharedPlan({ payer: SIS, amount: 16666 }); const row = occurrence(owner, { payableMinor: 8333, ownShareMinor: 8333 });
  assert.equal(preview(owner, row, 'prepare_counterparty_repayment', { amountMinor: 8333 }).effects.transactions[0].semantic, 'relationship_repayment');
});

test('2C3A-110: partner subscription retains subscription repayment semantic', () => { const owner = partnerSubscription(); assert.equal(preview(owner, occurrence(owner, { payableMinor: 1195, ownShareMinor: 1195 }), 'prepare_subscription_repayment', { amountMinor: 1195 }).effects.transactions[0].semantic, 'subscription_repayment'); });
test('2C3A-111: partner subscription reduces Abi payable', () => { const owner = partnerSubscription(); assert.equal(preview(owner, occurrence(owner, { payableMinor: 1195, ownShareMinor: 1195 }), 'prepare_subscription_repayment', { amountMinor: 1195 }).effects.relationships[0].counterpartyId, ABI); });
test('2C3A-112: partner subscription never presents original owned source', () => { const owner = partnerSubscription(); assert.equal(actionOf(owner, occurrence(owner), 'prepare_subscription_repayment').postingIntent.subscriptionIdentity, 'Spotify Family'); });

test('2C3A-113: installment payment exact RM83.33', () => { const owner = installmentPlan(); assert.equal(preview(owner, occurrence(owner), 'prepare_installment_repayment', { amountMinor: 8333 }).effects.installments[0].reductionMinor, 8333); });
test('2C3A-114: installment remaining becomes RM416.67', () => { const owner = installmentPlan(); assert.equal(preview(owner, occurrence(owner), 'prepare_installment_repayment', { amountMinor: 8333 }).effects.installments[0].afterPrincipalMinor, 41667); });
test('2C3A-115: final installment exact RM83.35', () => { const owner = installmentPlan(8335, 8333); const row = occurrence(owner, { totalAmountMinor: 8335 }); assert.equal(preview(owner, row, 'prepare_installment_repayment', { amountMinor: 8335 }).effects.installments[0].afterPrincipalMinor, 0); });
test('2C3A-116: installment principal never negative', () => { const owner = installmentPlan(8335, 8333); const row = occurrence(owner, { totalAmountMinor: 8335 }); assert.ok(preview(owner, row, 'prepare_installment_repayment', { amountMinor: 8335 }).effects.installments[0].afterPrincipalMinor >= 0); });

test('2C3A-117: variable missing amount produces no effects', () => { const owner = variablePlan(); const row = occurrence(owner); const value = preview(owner, row, 'fill_occurrence_amount', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }); assert.equal(value.validation.valid, false); assert.deepEqual(value.effects.transactions, []); });
test('2C3A-118: variable exact RM217.45 preview', () => { const owner = variablePlan(); const row = occurrence(owner); assert.equal(preview(owner, row, 'prepare_owned_payment', { amountMinor: 21745 }).effects.transactions[0].amountMinor, 21745); });
test('2C3A-119: variable reference budget remains RM240 metadata', () => { const owner = variablePlan(); const row = occurrence(owner); const value = preview(owner, row, 'prepare_owned_payment', { amountMinor: 21745 }); assert.equal(value.snapshots.plan.estimateAmountMinor, 24000); });
test('2C3A-120: variable plan amount is not overwritten', () => { const owner = variablePlan(); const row = occurrence(owner); preview(owner, row, 'prepare_owned_payment', { amountMinor: 21745 }); assert.equal(owner.estimateAmountMinor, 24000); });

test('2C3A-121: central sister receipt is RM83.33', () => { const owner = centralPlan(); const row = occurrence(owner); assert.equal(preview(owner, row, 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }).effects.accounts[0].amountMinor, 8333); });
test('2C3A-122: central receipt reduces one member obligation', () => { const owner = centralPlan(); const row = occurrence(owner); assert.equal(preview(owner, row, 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }).effects.relationships[0].memberId, SIS); });
test('2C3A-123: central receipt does not auto-complete occurrence', () => { const owner = centralPlan(); const row = occurrence(owner); assert.deepEqual(preview(owner, row, 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }).effects.occurrences, []); });
test('2C3A-124: central receipt is classified relationship receipt not income', () => { const owner = centralPlan(); const row = occurrence(owner); assert.equal(preview(owner, row, 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }).effects.transactions[0].incomeClassification, 'relationship_receipt_not_income'); });
test('2C3A-125: central outward pays full RM250', () => { const owner = centralPlan(); assert.equal(preview(owner, occurrence(owner), 'prepare_central_outward_payment', { amountMinor: 25000 }).effects.accounts[0].amountMinor, 25000); });
test('2C3A-126: central outward preserves member collections', () => { const owner = centralPlan(); assert.equal(preview(owner, occurrence(owner), 'prepare_central_outward_payment', { amountMinor: 25000 }).effects.relationships[0].effectType, 'member_collection_state_unchanged'); });
test('2C3A-127: central outward proposes paid separately', () => { const owner = centralPlan(); assert.equal(preview(owner, occurrence(owner), 'prepare_central_outward_payment', { amountMinor: 25000 }).effects.occurrences[0].toStatus, 'paid'); });

test('2C3A-128: skip has no account effects', () => { const owner = plan(); assert.deepEqual(preview(owner, occurrence(owner), 'preview_skip_occurrence', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }).effects.accounts, []); });
test('2C3A-129: skip has no transaction effects', () => { const owner = plan(); assert.deepEqual(preview(owner, occurrence(owner), 'preview_skip_occurrence', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }).effects.transactions, []); });
test('2C3A-130: skip proposes skipped state only', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'preview_skip_occurrence', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }).effects.occurrences[0].toStatus, 'skipped'); });

const moneyValues = [1, 5490, 8333, 8335, 21745, 65600, 131200, 999999, 1000000, 987654321];
moneyValues.forEach((amountMinor, index) => test(`2C3A-${String(131 + index).padStart(3, '0')}: integer money ${amountMinor} remains exact`, () => {
  const owner = plan({ totalAmountMinor: amountMinor, fixedAmountMinor: amountMinor }); const row = occurrence(owner, { totalAmountMinor: amountMinor, ownShareMinor: amountMinor, cashOutflowMinor: amountMinor });
  assert.equal(preview(owner, row, 'prepare_owned_payment', { amountMinor }).effects.transactions[0].amountMinor, amountMinor);
}));

const zeroMutationScenarios = [
  ['own', plan(), 'prepare_owned_payment', {}],
  ['shared', sharedPlan(), 'prepare_shared_front_payment', {}],
  ['repayment', sharedPlan({ payer: SIS }), 'prepare_counterparty_repayment', { amountMinor: 65600 }],
  ['subscription', partnerSubscription(), 'prepare_subscription_repayment', { amountMinor: 1195 }],
  ['installment', installmentPlan(), 'prepare_installment_repayment', { amountMinor: 8333 }],
  ['variable', variablePlan(), 'prepare_owned_payment', { amountMinor: 21745 }],
  ['central receipt', centralPlan(), 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }],
  ['central outward', centralPlan(), 'prepare_central_outward_payment', { amountMinor: 25000 }],
  ['skip', plan({ id: 'skip-plan' }), 'preview_skip_occurrence', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }],
];
zeroMutationScenarios.forEach(([name, owner, type, overrides], index) => test(`2C3A-${String(141 + index).padStart(3, '0')}: ${name} preview performs zero mutation`, () => {
  const row = occurrence(owner); const before = structuredClone({ owner, row, accounts }); preview(owner, row, type, overrides); assert.deepEqual({ owner, row, accounts }, before);
}));

test('2C3A-150: valid preview is deeply frozen at root', () => { const owner = plan(); assert.equal(Object.isFrozen(preview(owner, occurrence(owner), 'prepare_owned_payment')), true); });
test('2C3A-151: valid preview effects are frozen', () => { const owner = plan(); assert.equal(Object.isFrozen(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.accounts), true); });
test('2C3A-152: audit explicitly says no mutation performed', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').audit.financialMutationPerformed, false); });
test('2C3A-153: preview carries plan snapshot', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').snapshots.plan.id, owner.id); });
test('2C3A-154: preview carries occurrence snapshot', () => { const owner = plan(); const row = occurrence(owner); assert.equal(preview(owner, row, 'prepare_owned_payment').snapshots.occurrence.id, row.id); });
test('2C3A-155: preview version is explicit', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').previewVersion, 1); });
test('2C3A-156: preview fingerprint matches draft fingerprint', () => { const owner = plan(); const row = occurrence(owner); const value = preview(owner, row, 'prepare_owned_payment'); assert.equal(value.fingerprint, fingerprintRecurringActionDraft(value.action)); });
test('2C3A-157: missing before balance remains null instead of fake', () => { const owner = plan(); const row = occurrence(owner); const value = preview(owner, row, 'prepare_owned_payment', { accounts: [{ id: 'sv-mbb', type: 'saving', owned: true }] }); assert.equal(value.effects.accounts[0].beforeMinor, null); assert.equal(value.effects.accounts[0].afterMinor, null); });
test('2C3A-158: preview uses MYR', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.transactions[0].currency, 'MYR'); });
test('2C3A-159: preview transaction references plan ID', () => { const owner = plan(); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').effects.transactions[0].recurringPlanId, owner.id); });
test('2C3A-160: preview transaction references occurrence ID', () => { const owner = plan(); const row = occurrence(owner); assert.equal(preview(owner, row, 'prepare_owned_payment').effects.transactions[0].recurringOccurrenceId, row.id); });
test('2C3A-161: preview has no executor method', () => { const owner = plan(); assert.equal(Object.hasOwn(preview(owner, occurrence(owner), 'prepare_owned_payment'), 'execute'), false); });
test('2C3A-162: preview has no success animation state', () => { const owner = plan(); assert.doesNotMatch(JSON.stringify(preview(owner, occurrence(owner), 'prepare_owned_payment')), /confirmationAnimation|successMotion/); });
test('2C3A-163: record-only has no valid balance preview', () => { const owner = plan({ recordOnlyDefault: true }); assert.equal(preview(owner, occurrence(owner), 'prepare_owned_payment').validation.valid, false); });
test('2C3A-164: credit preview uses outstanding rather than balance', () => { const owner = plan(); const value = preview(owner, occurrence(owner), 'prepare_owned_payment', { sourceAccountId: 'cc-mbb', sourceAccountKind: 'cc' }); assert.equal(value.effects.accounts[0].beforeMinor, 320000); });

// Fail-closed validation — 28 cases.
const validationCases = [
  ['PLAN_NOT_FOUND', { plan: null }],
  ['OCCURRENCE_NOT_FOUND', { occurrence: null }],
  ['OCCURRENCE_REVISION_STALE', { mutateDraft: (draft) => ({ ...draft, occurrenceRevision: 999 }) }],
  ['PLAN_REVISION_STALE', { mutateDraft: (draft) => ({ ...draft, planRevision: 999 }) }],
  ['AMOUNT_REQUIRED', { mutateDraft: (draft) => ({ ...draft, amountMinor: null }) }],
  ['AMOUNT_INVALID', { mutateDraft: (draft) => ({ ...draft, amountMinor: -1 }) }],
  ['SOURCE_ACCOUNT_REQUIRED', { mutateDraft: (draft) => ({ ...draft, sourceAccountId: null }) }],
  ['SOURCE_ACCOUNT_NOT_OWNED', { mutateDraft: (draft) => ({ ...draft, sourceAccountId: 'sv-foreign' }) }],
  ['IDEMPOTENCY_KEY_REQUIRED', { mutateDraft: (draft) => ({ ...draft, idempotencyKey: null }) }],
];
validationCases.forEach(([code, config], index) => test(`2C3A-${String(165 + index).padStart(3, '0')}: validation emits ${code}`, () => {
  const owner = plan(); const row = occurrence(owner); let draft = draftFor(owner, row, 'prepare_owned_payment'); if (config.mutateDraft) draft = canonicalizeRecurringActionDraft(config.mutateDraft(draft));
  const value = buildRecurringPostingPreview({ actionDraft: draft, plan: config.plan === null ? null : owner, occurrence: config.occurrence === null ? null : row, accounts, actorId: ME });
  assert.ok(value.validation.errors.some((entry) => entry.code === code)); assert.deepEqual(value.effects.transactions, []);
}));

test('2C3A-174: completed occurrence validation code', () => { const owner = plan(); const row = occurrence(owner, { status: 'paid', recordedStatus: 'paid' }); const value = preview(owner, row, 'prepare_owned_payment'); assert.ok(value.validation.errors.some((entry) => entry.code === 'OCCURRENCE_ALREADY_COMPLETED')); });
test('2C3A-175: skipped occurrence validation code', () => { const owner = plan(); const row = occurrence(owner, { status: 'skipped', recordedStatus: 'skipped' }); const value = preview(owner, row, 'prepare_owned_payment'); assert.ok(value.validation.errors.some((entry) => entry.code === 'OCCURRENCE_SKIPPED')); });
test('2C3A-176: counterparty required', () => { const owner = sharedPlan({ payer: SIS }); const row = occurrence(owner, { payableMinor: 65600 }); const actionDraft = canonicalizeRecurringActionDraft({ ...draftFor(owner, row, 'prepare_counterparty_repayment'), counterpartyId: null }); const value = buildRecurringPostingPreview({ actionDraft, plan: owner, occurrence: row, accounts, actorId: ME }); assert.ok(value.validation.errors.some((entry) => entry.code === 'COUNTERPARTY_REQUIRED')); });
test('2C3A-177: member required', () => { const owner = centralPlan(); const row = occurrence(owner); const source = draftFor(owner, row, 'prepare_member_receipt', { memberId: SIS, amountMinor: 8333 }); const actionDraft = canonicalizeRecurringActionDraft({ ...source, memberId: null }); const value = buildRecurringPostingPreview({ actionDraft, plan: owner, occurrence: row, accounts, actorId: ME }); assert.ok(value.validation.errors.some((entry) => ['MEMBER_REQUIRED','ACTION_NOT_AVAILABLE'].includes(entry.code))); });
test('2C3A-178: invalid relationship context', () => { const owner = sharedPlan(); owner.relationship.ledgerId = null; const row = occurrence(owner); assert.ok(preview(owner, row, 'prepare_shared_front_payment').validation.errors.some((entry) => entry.code === 'RELATIONSHIP_CONTEXT_INVALID')); });
test('2C3A-179: variable unconfirmed validation', () => { const owner = variablePlan(); const row = occurrence(owner); const value = preview(owner, row, 'fill_occurrence_amount', { amountMinor: null, sourceAccountId: null, sourceAccountKind: null }); assert.ok(value.validation.errors.some((entry) => entry.code === 'VARIABLE_AMOUNT_UNCONFIRMED')); });
test('2C3A-180: installment over remaining validation', () => { const owner = installmentPlan(8335); const row = occurrence(owner, { totalAmountMinor: 8335 }); const value = preview(owner, row, 'prepare_installment_repayment', { amountMinor: 8336 }); assert.ok(value.validation.errors.some((entry) => entry.code === 'AMOUNT_EXCEEDS_REMAINING_PRINCIPAL')); });
test('2C3A-181: unavailable action cannot be forced', () => { const owner = plan({ status: 'stopped' }); assert.ok(preview(owner, occurrence(owner), 'prepare_owned_payment').validation.errors.some((entry) => entry.code === 'ACTION_NOT_AVAILABLE')); });
test('2C3A-182: idempotency conflict validation', () => { const owner = plan(); const row = occurrence(owner); const first = draftFor(owner, row, 'prepare_owned_payment'); const changed = canonicalizeRecurringActionDraft({ ...first, amountMinor: 5491 }); const value = buildRecurringPostingPreview({ actionDraft: changed, plan: owner, occurrence: row, accounts, actorId: ME, previousAttempt: first }); assert.ok(value.validation.errors.some((entry) => entry.code === 'IDEMPOTENCY_CONFLICT')); });
test('2C3A-183: invalid preview has no account effects', () => { const owner = plan(); const row = occurrence(owner); const actionDraft = canonicalizeRecurringActionDraft({ ...draftFor(owner, row, 'prepare_owned_payment'), planRevision: 99 }); assert.deepEqual(buildRecurringPostingPreview({ actionDraft, plan: owner, occurrence: row, accounts, actorId: ME }).effects.accounts, []); });
test('2C3A-184: invalid preview has no relationship effects', () => { const owner = sharedPlan(); const row = occurrence(owner); const actionDraft = canonicalizeRecurringActionDraft({ ...draftFor(owner, row, 'prepare_shared_front_payment'), occurrenceRevision: 99 }); assert.deepEqual(buildRecurringPostingPreview({ actionDraft, plan: owner, occurrence: row, accounts, actorId: ME }).effects.relationships, []); });
test('2C3A-185: invalid preview has no installment effects', () => { const owner = installmentPlan(); const row = occurrence(owner); const actionDraft = canonicalizeRecurringActionDraft({ ...draftFor(owner, row, 'prepare_installment_repayment'), amountMinor: 60000 }); assert.deepEqual(buildRecurringPostingPreview({ actionDraft, plan: owner, occurrence: row, accounts, actorId: ME }).effects.installments, []); });
test('2C3A-186: invalid preview has no occurrence effects', () => { const owner = plan(); const row = occurrence(owner); const actionDraft = canonicalizeRecurringActionDraft({ ...draftFor(owner, row, 'prepare_owned_payment'), sourceAccountId: null }); assert.deepEqual(buildRecurringPostingPreview({ actionDraft, plan: owner, occurrence: row, accounts, actorId: ME }).effects.occurrences, []); });
test('2C3A-187: all required validation codes are unique', () => assert.equal(new Set(RECURRING_PREVIEW_VALIDATION_CODES).size, RECURRING_PREVIEW_VALIDATION_CODES.length));
test('2C3A-188: validation code set includes all 18 contract values', () => assert.equal(RECURRING_PREVIEW_VALIDATION_CODES.length, 18));

// UI, router, modal, accessibility, and protected-scope source guards — 22 cases.
const uiSource = read('src/features/fixed/RecurringOccurrenceActionSheets.js');
const detailSource = read('src/features/fixed/RecurringPlanSheets.js');
const cssSource = read('src/styles/phase2c3a.css');
const indexSource = read('index.html');
[
  ['2C3A-189', uiSource, '本期处理'],
  ['2C3A-190', uiSource, '确认记账'],
  ['2C3A-191', uiSource, '记账预览'],
  ['2C3A-192', uiSource, '这次会记录什么'],
  ['2C3A-193', uiSource, '账户变化'],
  ['2C3A-194', uiSource, '关系账变化'],
  ['2C3A-195', uiSource, '分期变化'],
  ['2C3A-196', uiSource, '本期状态'],
  ['2C3A-197', uiSource, '确认前不会改变账户余额'],
  ['2C3A-198', uiSource, '附件 / 凭证（可选）'],
  ['2C3A-199', uiSource, 'recurring-posting-confirm'],
  ['2C3A-200', uiSource, '返回本期处理'],
  ['2C3A-201', detailSource, 'fixed-occurrence-action'],
  ['2C3A-202', uiSource, 'openMoneyCalculatorSheet'],
  ['2C3A-203', uiSource, 'openPickerSheet'],
  ['2C3A-204', uiSource, 'onRequestClose'],
  ['2C3A-205', uiSource, '舍弃本期处理草稿？'],
  ['2C3A-206', cssSource, 'env(safe-area-inset-bottom)'],
  ['2C3A-207', cssSource, 'prefers-reduced-motion'],
  ['2C3A-208', indexSource, 'phase2c3a.css'],
].forEach(([id, source, token]) => test(`${id}: source contains ${token}`, () => assert.ok(source.includes(token))));

test('2C3A-209: Phase 2C3A domain adds no executable network or persistence client', () => {
  const source = [read('src/domain/recurringOccurrenceActions.js'), read('src/domain/recurringActionIdentity.js'), read('src/domain/recurringPostingPreview.js')].join('\n');
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\s*[.(]/);
});
test('2C3A-210: Phase 2C3A UI exposes no real posting command', () => {
  assert.doesNotMatch(uiSource, /data\.(addTransaction|editTransaction|reverseTransaction|settle|postFixedExpense)\s*\(/);
});
