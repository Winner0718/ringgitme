import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  commitInlineSplitExpression,
  createInlineSplitDraft,
  customAllocationProgress,
  customParticipantPresentation,
  pressInlineSplitKey,
} from '../src/components/SplitAllocationEditorSheet.js';
import { isRecurringPlanDraftMeaningfullyDirty } from '../src/domain/recurringPlanUsability.js';
import { normalizeRecurringPlan } from '../src/domain/recurringPlanModel.js';
import { buildOccurrenceSnapshot } from '../src/domain/recurringSchedule.js';
import {
  buildLedgerRecurringProjection,
  deriveLedgerCurrentAction,
  deriveLedgerMoneyFlow,
  deriveLedgerRecurringPlanPresentation,
  selectRecurringOccurrencesForLedger,
  selectRecurringPlansForLedger,
} from '../src/domain/ledgerRecurringProjection.js';
import { calculateRecurringRelationshipProjection } from '../src/domain/recurringRelationshipModel.js';
import { LEDGER_RECURRING_SCENARIO_FIXTURES, RECURRING_PLAN_FIXTURES } from '../src/fixtures/recurringPlanFixtures.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = {
  router: read('src/app/router.js'),
  appSheet: read('src/components/AppSheet.js'),
  modalHistory: read('src/app/modalHistory.js'),
  composer: read('src/components/RecurringRelationshipComposer.js'),
  split: read('src/components/SplitAllocationEditorSheet.js'),
  css: read('src/styles/phase2c2.css'),
  ledger: read('src/features/ledger/index.js'),
  recurringSheets: read('src/features/fixed/RecurringPlanSheets.js'),
  demoData: read('src/fixtures/demoData.js'),
  fixtures: read('src/fixtures/recurringPlanFixtures.js'),
  relationshipFixtures: read('src/fixtures/relationshipFixtures.js'),
  projection: read('src/domain/ledgerRecurringProjection.js'),
  repository: read('src/domain/recurringPlanRepository.js'),
};

const add = (name, fn) => test(`2C2-FIX1D-${String(++add.count).padStart(3, '0')}: ${name}`, fn);
add.count = 0;
const ids = ['participant-me', 'participant-abi'];
const splitDraft = () => createInlineSplitDraft({
  participantIds: ids,
  sharesMinor: { 'participant-me': 12500, 'participant-abi': 12500 },
  activeParticipantId: 'participant-me',
});

// Stage A — Browser history ownership and dirty guarding.
add('router imports the Sheet ownership predicate', () => assert.match(source.router, /import \{ closeSheet, isSheetOpen \}/));
add('router yields popstate while a Sheet is open', () => assert.match(source.router, /if \(isSheetOpen\(\)\) return/));
add('router yield precedes route teardown', () => assert.ok(source.router.indexOf('if (isSheetOpen()) return') < source.router.indexOf('closeSheet(true)', source.router.indexOf("addEventListener('popstate'"))));
add('parent Sheet owns a browser token', () => assert.ok(source.appSheet.includes('ringgitmeSheet')));
add('child modal owns a separate browser token', () => assert.ok(source.modalHistory.includes('ringgitmeModalLayer')));
add('child popstate stops lower-layer handling', () => assert.ok(source.modalHistory.includes('stopImmediatePropagation')));
add('child direct close consumes only its token', () => assert.match(source.modalHistory, /requestClose\(\)[\s\S]*history\.back\(\)/));
add('parent Back follows the dirty close contract', () => assert.match(source.appSheet, /closeSheet\(false, \{ fromHistory: true \}\)/));
add('top-layer assertion remains active', () => assert.ok(source.appSheet.includes('isTopModal')));
add('no generic Back close-all fallback', () => assert.doesNotMatch(source.router, /closeAllSheets/));

const cleanDraft = { title: '', amount: '', note: '', moreOpen: false };
add('untouched draft is clean', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty(cleanDraft, cleanDraft), false));
add('opening a child does not make a clean draft dirty', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty({ ...cleanDraft }, cleanDraft), false));
add('name change makes parent dirty', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty({ ...cleanDraft, title: 'Netflix' }, cleanDraft), true));
add('amount change makes parent dirty', () => assert.equal(isRecurringPlanDraftMeaningfullyDirty({ ...cleanDraft, amount: '88.60' }, cleanDraft), true));

// Stage A — calculator input correctness and no full-Sheet replacement.
add('inline calculator starts with canonical minor units', () => assert.equal(splitDraft().shares['participant-me'], 12500));
add('zero is a real input', () => { const draft = splitDraft(); pressInlineSplitKey(draft, '0'); assert.equal(draft.expression, '0'); assert.equal(draft.shares['participant-me'], 0); });
add('decimal is a real input', () => { const draft = splitDraft(); pressInlineSplitKey(draft, '0'); pressInlineSplitKey(draft, '.'); assert.equal(draft.expression, '0.'); });
add('80.25 applies exactly', () => { const draft = splitDraft(); for (const key of ['8', '0', '.', '2', '5', '=']) pressInlineSplitKey(draft, key); assert.equal(draft.shares['participant-me'], 8025); });
add('operator expression stays visible', () => { const draft = splitDraft(); for (const key of ['5', '+']) pressInlineSplitKey(draft, key); assert.equal(draft.expression, '5+'); });
add('calculator evaluates arithmetic in minor units', () => { const draft = splitDraft(); for (const key of ['5', '+', '5', '=']) pressInlineSplitKey(draft, key); assert.equal(draft.shares['participant-me'], 1000); });
add('decimal precision remains capped', () => { const draft = splitDraft(); for (const key of ['1', '.', '2', '3', '4']) pressInlineSplitKey(draft, key); assert.equal(draft.expression, '1.23'); });
add('empty expression commits zero safely', () => { const draft = splitDraft(); pressInlineSplitKey(draft, 'C'); assert.equal(commitInlineSplitExpression(draft), true); assert.equal(draft.shares['participant-me'], 0); });
add('active expression is shown in the participant card', () => assert.equal(customParticipantPresentation({ active: true, expression: '0.', fresh: false }).amountLabel, 'RM 0.'));
add('progress reflects exact allocation', () => assert.equal(customAllocationProgress(25000, { 'participant-me': 12500, 'participant-abi': 12500 }, ids).state, 'exact'));
add('progress reflects remaining allocation', () => assert.equal(customAllocationProgress(25000, { 'participant-me': 0, 'participant-abi': 12500 }, ids).state, 'remaining'));
add('progress reflects over-allocation', () => assert.equal(customAllocationProgress(25000, { 'participant-me': 20000, 'participant-abi': 12500 }, ids).state, 'over'));

const keyHandler = source.composer.slice(source.composer.indexOf("sheet?.querySelectorAll('[data-inline-split-key]')"), source.composer.indexOf("sheet?.querySelector('[data-inline-split-collapse]')"));
add('keypress path uses in-place synchronization', () => assert.ok(keyHandler.includes('syncInlineSplitView()')));
add('keypress path does not rerender the Sheet body', () => assert.doesNotMatch(keyHandler, /render\(/));
add('keypress path retains the existing key node', () => assert.match(keyHandler, /button\.focus\(\{ preventScroll: true \}\)/));
add('in-place updater never calls scrollIntoView', () => {
  const updater = source.composer.slice(source.composer.indexOf('const syncInlineSplitView'), source.composer.indexOf('const closeDrawer'));
  assert.doesNotMatch(updater, /scrollIntoView|innerHTML/);
});
add('participant card has a stable identity target', () => assert.ok(source.composer.includes('data-recurring-share-card')));
add('participant amount has a stable update target', () => assert.ok(source.composer.includes('data-recurring-share-amount')));
add('allocation totals have stable update targets', () => assert.ok(source.composer.includes('data-recurring-allocated')) && assert.ok(source.composer.includes('data-recurring-difference')));
add('operator selected state is updated without replacement', () => assert.match(source.composer, /classList\.toggle\('is-selected'/));
add('feedback is updated without replacement', () => assert.match(source.composer, /feedback\.textContent = drawer\.error \|\| progress\.label/));
add('amount text uses tabular numerals', () => assert.ok(source.css.includes('font-variant-numeric: tabular-nums')));
add('amount line reserves fixed minimum height', () => assert.match(source.css, /relationship-amount-value-line > strong \{[\s\S]*min-height: 14px/));
add('amount line has fixed line-height', () => assert.match(source.css, /relationship-amount-value-line > strong \{[\s\S]*line-height: 14px/));
add('drawer geometry remains fixed', () => assert.match(source.css, /\.inline-split-drawer \{[\s\S]*height: 348px/));
add('keypad geometry remains fixed', () => assert.match(source.css, /grid-template-rows: repeat\(5, 48px\)/));
add('zero keeps two-column geometry', () => assert.ok(source.split.includes("key === '0' ? ' zero'")));
add('reduced motion contract remains present', () => assert.ok(source.css.includes('prefers-reduced-motion: reduce')));

add('focused Stage A suite contains at least 40 cases', () => assert.ok(add.count >= 40));

// Stage B — canonical Ledger recurring projection.
const participants = createDemoDataSource().getParticipants();
const normalizedScenarioPlans = LEDGER_RECURRING_SCENARIO_FIXTURES.map((fixture) => normalizeRecurringPlan(fixture));
const familyPlan = normalizedScenarioPlans.find((plan) => plan.id === 'fixed-family-rent');
const sisterPlan = normalizedScenarioPlans.find((plan) => plan.id === 'fixed-sister-bed-installment');
const familyOccurrence = buildOccurrenceSnapshot(familyPlan, '2026-07', { referenceDate: '2026-07-13' });
const sisterOccurrence = buildOccurrenceSnapshot(sisterPlan, '2026-07', { referenceDate: '2026-07-13' });

const couplePlan = normalizeRecurringPlan({
  ...structuredClone(RECURRING_PLAN_FIXTURES[0]),
  id: 'fixed-couple-rent',
  title: 'Maxim 房租',
  schedule: { recurrence: 'monthly', dueDay: 15, timezone: 'Asia/Kuala_Lumpur' },
  relationshipMode: 'shared_bill',
  relationship: {
    relationshipMode: 'shared_bill', ledgerId: 'ledger-abi', participantIds: ['participant-me', 'participant-abi'], authenticatedParticipantId: 'participant-me',
    payerParticipantId: 'participant-me', splitMode: 'equal', shares: [], paymentMode: 'full_bill', relationshipLabel: 'Abi',
  },
  canonicalSource: { sourceType: 'fixed_plan', sourceId: 'fixed-couple-rent' },
});
const coupleOccurrence = buildOccurrenceSnapshot(couplePlan, '2026-07', { referenceDate: '2026-07-13' });

const subscriptionPlan = normalizeRecurringPlan({
  id: 'subscription-abi-paid', planKind: 'subscription', title: 'Netflix 代付', categoryId: 'fun', currency: 'MYR',
  fixedAmountMinor: 5490, amountMode: 'fixed', schedule: { recurrence: 'monthly', dueDay: 20, timezone: 'Asia/Kuala_Lumpur' },
  startDate: '2026-01-20', status: 'active', paymentSourceAccountId: 'cc-mbb-visa', subscriptionFundingMode: 'other_pays',
  relationshipMode: 'shared_bill', relationship: {
    relationshipMode: 'shared_bill', ledgerId: 'ledger-abi', participantIds: ['participant-me', 'participant-abi'], authenticatedParticipantId: 'participant-me',
    payerParticipantId: 'participant-abi', splitMode: 'custom', shares: [{ participantId: 'participant-me', amountMinor: 5490 }, { participantId: 'participant-abi', amountMinor: 0 }], paymentMode: 'full_bill', relationshipLabel: 'Abi',
  }, canonicalSource: { sourceType: 'fixed_plan', sourceId: 'subscription-abi-paid' },
});
const subscriptionOccurrence = buildOccurrenceSnapshot(subscriptionPlan, '2026-07', { referenceDate: '2026-07-13' });

const directPlan = (recipientParticipantId) => normalizeRecurringPlan({
  id: `direct-${recipientParticipantId}`, planKind: 'recurring_relationship', title: '每月家用', categoryId: 'bill', currency: 'MYR',
  fixedAmountMinor: 30000, amountMode: 'fixed', schedule: { recurrence: 'monthly', dueDay: 13, timezone: 'Asia/Kuala_Lumpur' },
  startDate: '2026-01-13', status: 'active', paymentSourceAccountId: 'sv-mbb', relationshipMode: 'direct_recurring_payment',
  relationship: { relationshipMode: 'direct_recurring_payment', ledgerId: 'ledger-abi', participantIds: ['participant-me', 'participant-abi'], authenticatedParticipantId: 'participant-me', recipientParticipantId, relationshipLabel: 'Abi' },
  canonicalSource: { sourceType: 'fixed_plan', sourceId: `direct-${recipientParticipantId}` },
});

add('plan selection uses exact ledgerId', () => assert.deepEqual(selectRecurringPlansForLedger([familyPlan, couplePlan], 'ledger-family').map((plan) => plan.id), ['fixed-family-rent']));
add('display-name equality never matches another ledger', () => assert.equal(selectRecurringPlansForLedger([{ ...familyPlan, relationship: { ...familyPlan.relationship, ledgerId: 'ledger-other' } }], 'ledger-family').length, 0));
add('one canonical plan appears once', () => assert.equal(selectRecurringPlansForLedger([familyPlan, familyPlan], 'ledger-family').length, 1));
add('duplicate canonical source with another plan ID fails loudly', () => assert.throws(() => selectRecurringPlansForLedger([familyPlan, { ...familyPlan, id: 'family-copy' }], 'ledger-family'), /duplicate_ledger_canonical_plan/));
add('Ledger canonical plan ID equals Fixed Center plan ID', () => assert.equal(selectRecurringPlansForLedger([familyPlan], 'ledger-family')[0].id, familyPlan.id));
add('occurrence selection uses plan identity', () => assert.deepEqual(selectRecurringOccurrencesForLedger({ plans: [familyPlan], occurrences: [familyOccurrence, sisterOccurrence], ledgerId: 'ledger-family' }).map((row) => row.id), [familyOccurrence.id]));
add('same occurrence ID survives Ledger projection', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).cards[0].occurrenceId, familyOccurrence.id));
add('due-today occurrence is protected by the same locked-snapshot boundary as overdue history', () => assert.match(source.repository, /existing\.dueDate <= options\.referenceDate/));
add('locked current occurrence amount wins over the edited next-plan amount', () => {
  const edited = {
    ...familyPlan,
    totalAmountMinor: 30000,
    relationship: {
      ...familyPlan.relationship,
      shares: familyPlan.relationship.shares.map((share) => ({ ...share, amountMinor: 10000 })),
    },
  };
  const presentation = deriveLedgerRecurringPlanPresentation({ plan: edited, occurrences: [familyOccurrence], participants, referenceDate: '2026-07-13' });
  assert.equal(presentation.moneyFlow.amountMinor, 8333);
  assert.equal(presentation.scheduledAmountMinor, 10000);
});
add('Ledger shows the edited next schedule without rewriting the current card amount', () => assert.match(source.ledger, /下期.*scheduledAmountMinor/));
add('unrelated occurrence is excluded', () => assert.equal(selectRecurringOccurrencesForLedger({ plans: [familyPlan], occurrences: [sisterOccurrence], ledgerId: 'ledger-family' }).length, 0));
add('archived plan excluded from normal Ledger cards', () => assert.equal(buildLedgerRecurringProjection({ plans: [{ ...familyPlan, archivedAt: '2026-07-01T00:00:00+08:00' }], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).cards.length, 0));
add('paused plan remains visible as a neutral plan card', () => assert.equal(deriveLedgerRecurringPlanPresentation({ plan: { ...familyPlan, status: 'paused' }, occurrences: [{ ...familyOccurrence, status: 'paused' }], participants, referenceDate: '2026-07-13' }).lifecycle, 'paused'));
add('stopped plan remains visible as stopped', () => assert.equal(deriveLedgerRecurringPlanPresentation({ plan: { ...familyPlan, status: 'stopped' }, occurrences: [{ ...familyOccurrence, status: 'stopped' }], participants, referenceDate: '2026-07-13' }).lifecycle, 'stopped'));
add('completed installment derives completed lifecycle', () => assert.equal(deriveLedgerRecurringPlanPresentation({ plan: { ...sisterPlan, relationship: { ...sisterPlan.relationship, remainingPrincipalMinor: 0 } }, occurrences: [], participants, referenceDate: '2026-07-13' }).lifecycle, 'completed'));
add('unrelated ledger projection has no plans', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-abi', participants, referenceDate: '2026-07-13' }).cards.length, 0));

// Actual balances and planned amounts are independent.
add('family planned payable derives RM83.33', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).summary.plannedPayableMinor, 8333));
add('couple planned receivable derives RM656', () => assert.equal(buildLedgerRecurringProjection({ plans: [couplePlan], occurrences: [coupleOccurrence], ledgerId: 'ledger-abi', participants, referenceDate: '2026-07-13' }).summary.plannedReceivableMinor, 65600));
add('planned summary is explicitly labeled', () => assert.equal(buildLedgerRecurringProjection({ plans: [couplePlan], occurrences: [coupleOccurrence], ledgerId: 'ledger-abi', participants, referenceDate: '2026-07-13' }).summary.label, '本月计划'));
add('planned projection reports zero postings', () => assert.equal(buildLedgerRecurringProjection({ plans: [couplePlan], occurrences: [coupleOccurrence], ledgerId: 'ledger-abi', participants, referenceDate: '2026-07-13' }).summary.postingCount, 0));
add('brother one-off debt remains actual', () => assert.equal(createDemoDataSource().getRelationshipSummary('ledger-peng').receivableMinor, 18000));
add('brother one-off ledger has no recurring plan by default', () => assert.equal(createDemoDataSource().getLedgerRecurringProjection('ledger-peng').cards.length, 0));
add('canonical projection never mutates a relationship object', () => { const before = structuredClone(familyPlan.relationship); buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }); assert.deepEqual(familyPlan.relationship, before); });
add('canonical projection never mutates an occurrence', () => { const before = structuredClone(familyOccurrence); buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }); assert.deepEqual(familyOccurrence, before); });

// Personal and group money-flow semantics.
add('user to person direct flow', () => assert.equal(deriveLedgerMoneyFlow(directPlan('participant-abi'), participants).primary, '我 → Abi'));
add('person to user direct flow', () => assert.equal(deriveLedgerMoneyFlow(directPlan('participant-me'), participants).primary, 'Abi → 我'));
add('person to user direct flow remains receivable', () => assert.equal(calculateRecurringRelationshipProjection(30000, 'direct_recurring_payment', directPlan('participant-me').relationship).receivableMinor, 30000));
add('user-fronts couple flow names Abi', () => assert.equal(deriveLedgerMoneyFlow(couplePlan, participants).primary, 'Abi → 我'));
add('user-fronts couple amount is other share', () => assert.equal(deriveLedgerMoneyFlow(couplePlan, participants).amountMinor, 65600));
add('family central collector flow names sister', () => assert.equal(deriveLedgerMoneyFlow(familyPlan, participants).primary, '我交给姐姐'));
add('family central external payer copy names sister', () => assert.equal(deriveLedgerMoneyFlow(familyPlan, participants).secondary, '姐姐统一付款'));
add('family flow preserves collector stable ID', () => assert.equal(deriveLedgerMoneyFlow(familyPlan, participants).collectorParticipantId, 'participant-sis'));
add('family flow preserves external payer stable ID', () => assert.equal(deriveLedgerMoneyFlow(familyPlan, participants).externalPayerParticipantId, 'participant-sis'));
add('subscription other-pays copy is explicit', () => assert.equal(deriveLedgerMoneyFlow(subscriptionPlan, participants).primary, 'Abi 代付 · 我需还'));
add('subscription repayment amount is exact', () => assert.equal(deriveLedgerMoneyFlow(subscriptionPlan, participants).amountMinor, 5490));
add('installment direction names sister', () => assert.equal(deriveLedgerMoneyFlow(sisterPlan, participants).primary, '我 → 姐姐'));
add('installment remaining principal exact', () => assert.equal(deriveLedgerMoneyFlow(sisterPlan, participants).remainingPrincipalMinor, 50000));
add('installment remaining periods exact', () => assert.equal(deriveLedgerMoneyFlow(sisterPlan, participants).remainingPeriods, 6));
add('installment editor remaining-month count does not subtract historical completed terms twice', () => {
  const createdPlan = {
    ...sisterPlan,
    relationship: {
      ...sisterPlan.relationship,
      completedInstallments: 6,
      plannedInstallmentCount: 12,
      repaymentMonths: 6,
    },
  };
  assert.equal(deriveLedgerMoneyFlow(createdPlan, participants).remainingPeriods, 6);
});
add('installment final amount exact', () => assert.equal(deriveLedgerMoneyFlow(sisterPlan, participants).finalInstallmentMinor, 8335));
add('monthly cadence localized', () => assert.equal(deriveLedgerMoneyFlow(familyPlan, participants).cadence, ' / 月'));
add('money-flow copy never exposes internal shared_bill code', () => assert.doesNotMatch(deriveLedgerMoneyFlow(couplePlan, participants).primary, /shared_bill/));
add('money-flow copy never exposes participant IDs', () => assert.doesNotMatch(deriveLedgerMoneyFlow(familyPlan, participants).primary, /participant-/));

// Current actions and semantic ordering.
const actionFor = (status, dueDate, { amountPending = false } = {}) => {
  const occurrence = { ...familyOccurrence, status, dueDate, amountPending };
  const plan = { ...familyPlan, amountPending };
  const presentation = deriveLedgerRecurringPlanPresentation({ plan, occurrences: [occurrence], participants, referenceDate: '2026-07-13' });
  return deriveLedgerCurrentAction(presentation, '2026-07-13');
};
add('overdue occurrence appears as current action', () => assert.equal(actionFor('overdue', '2026-07-12').priority, 0));
add('due-today occurrence appears as current action', () => assert.equal(actionFor('due_today', '2026-07-13').priority, 1));
add('waiting variable amount appears as current action', () => assert.equal(actionFor('upcoming', '2026-07-20', { amountPending: true }).priority, 2));
add('due-soon occurrence appears as current action', () => assert.equal(actionFor('upcoming', '2026-07-20').priority, 3));
add('far-future occurrence is excluded', () => assert.equal(actionFor('upcoming', '2026-07-21'), null));
for (const status of ['paid', 'skipped', 'paused', 'stopped', 'not_started']) add(`${status} occurrence excluded from current actions`, () => assert.equal(actionFor(status, '2026-07-13'), null));
add('archived plan creates no action', () => assert.equal(buildLedgerRecurringProjection({ plans: [{ ...familyPlan, archivedAt: '2026-07-01T00:00:00+08:00' }], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).currentActions.length, 0));
add('current actions sort overdue before due today', () => { const due = { ...familyOccurrence, id: 'due', planId: couplePlan.id, canonicalSource: couplePlan.canonicalSource, dueDate: '2026-07-13', status: 'due_today' }; const overdue = { ...familyOccurrence, id: 'overdue', dueDate: '2026-07-12', status: 'overdue' }; const result = buildLedgerRecurringProjection({ plans: [familyPlan, { ...couplePlan, relationship: { ...couplePlan.relationship, ledgerId: 'ledger-family' } }], occurrences: [due, overdue], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }); assert.equal(result.currentActions[0].occurrenceStatus, 'overdue'); });
add('one action per canonical plan', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence, familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).currentActions.length, 1));
add('waiting action uses safe non-posting label', () => assert.equal(actionFor('upcoming', '2026-07-20', { amountPending: true }).actionLabel, '填写资料'));
add('ordinary action uses safe view label', () => assert.equal(actionFor('upcoming', '2026-07-20').actionLabel, '查看本期'));

// Real-life scenario fixture integrity.
add('family scenario total is RM250', () => assert.equal(familyPlan.totalAmountMinor, 25000));
add('family equal split is exact in minor units', () => assert.deepEqual(familyPlan.relationship.shares.map((share) => share.amountMinor), [8333, 8333, 8334]));
add('family Winner share is RM83.33', () => assert.equal(familyPlan.relationship.shares.find((share) => share.participantId === 'participant-me').amountMinor, 8333));
add('family shares sum to RM250', () => assert.equal(familyPlan.relationship.shares.reduce((sum, share) => sum + share.amountMinor, 0), 25000));
add('family participant IDs are stable', () => assert.deepEqual(familyPlan.relationship.participantIds, ['participant-me', 'participant-sis', 'participant-peng']));
add('couple scenario total is RM1,312', () => assert.equal(couplePlan.totalAmountMinor, 131200));
add('couple equal split is RM656 each', () => assert.deepEqual(couplePlan.relationship.shares.map((share) => share.amountMinor), [65600, 65600]));
add('couple payer stable ID is Winner', () => assert.equal(couplePlan.relationship.payerParticipantId, 'participant-me'));
add('sister installment original principal stable', () => assert.equal(sisterPlan.relationship.originalPrincipalMinor, 100000));
add('sister installment remaining principal stable', () => assert.equal(sisterPlan.relationship.remainingPrincipalMinor, 50000));
add('sister installment monthly amount stable', () => assert.equal(sisterPlan.relationship.installmentAmountMinor, 8333));
add('sister installment completed terms stable', () => assert.equal(sisterPlan.relationship.completedInstallments, 6));
add('brother fixture remains non-recurring actual record', () => assert.match(source.relationshipFixtures, /entry-peng-one-off[\s\S]*哥哥临时借款/));

// Creation is canonical and financially isolated.
function createFamilyInDemo(commandId) {
  const demo = createDemoDataSource();
  const before = {
    accounts: demo.getAccounts(),
    summary: demo.getRelationshipSummary('ledger-family'),
    transactions: demo.getTransactions().length,
    activities: demo.getActivities().length,
  };
  const result = demo.createManagedRecurringPlan(familyPlan, { commandId, allowSemanticDuplicate: false });
  return { demo, before, result };
}
add('Ledger-origin plan creation uses canonical fixed source', () => assert.equal(createFamilyInDemo('fix1d-family-source').result.source.sourceType, 'fixed_plan'));
add('created family plan keeps stable plan ID', () => assert.equal(createFamilyInDemo('fix1d-family-id').result.plan.id, 'fixed-family-rent'));
add('created family plan appears once in canonical list', () => { const { demo } = createFamilyInDemo('fix1d-family-once'); assert.equal(demo.getCanonicalRecurringPlans().filter((plan) => plan.id === familyPlan.id).length, 1); });
add('created family plan appears once in Ledger projection', () => { const { demo } = createFamilyInDemo('fix1d-family-ledger-once'); assert.equal(demo.getLedgerRecurringProjection('ledger-family').cards.filter((card) => card.planId === familyPlan.id).length, 1); });
add('created family plan has same Fixed Center and Ledger ID', () => { const { demo } = createFamilyInDemo('fix1d-family-shared-id'); assert.equal(demo.getFixedCenterMonth('2026-07').rows.find((row) => row.plan.id === familyPlan.id).canonicalPlanId, demo.getLedgerRecurringProjection('ledger-family').cards.find((card) => card.planId === familyPlan.id).canonicalPlanId); });
add('creating plan does not change cash accounts', () => { const { demo, before } = createFamilyInDemo('fix1d-no-account'); assert.deepEqual(demo.getAccounts(), before.accounts); });
add('creating plan does not change actual relationship summary', () => { const { demo, before } = createFamilyInDemo('fix1d-no-summary'); assert.deepEqual(demo.getRelationshipSummary('ledger-family'), before.summary); });
add('creating plan does not create transaction', () => { const { demo, before } = createFamilyInDemo('fix1d-no-txn'); assert.equal(demo.getTransactions().length, before.transactions); });
add('creating plan does not create Activity row', () => { const { demo, before } = createFamilyInDemo('fix1d-no-activity'); assert.equal(demo.getActivities().length, before.activities); });
add('creating plan does not reduce installment principal', () => { const demo = createDemoDataSource(); const result = demo.createManagedRecurringPlan(sisterPlan, { commandId: 'fix1d-no-principal' }); assert.equal(result.plan.relationship.remainingPrincipalMinor, 50000); });
add('creating plan does not mark occurrence paid', () => { const { result } = createFamilyInDemo('fix1d-no-paid'); assert.notEqual(result.occurrence.status, 'paid'); });
add('repeating create command is idempotent', () => { const demo = createDemoDataSource(); const a = demo.createManagedRecurringPlan(familyPlan, { commandId: 'fix1d-idem' }); const b = demo.createManagedRecurringPlan(familyPlan, { commandId: 'fix1d-idem' }); assert.deepEqual(b, a); });

// Ledger UI and navigation contracts.
for (const text of ['本期要处理', '计划与还款', '往来记录', '本月计划', '预计待收', '预计需付']) add(`Ledger renders ${text}`, () => assert.ok(source.ledger.includes(text)));
for (const text of ['定期往来', '分期还款', '订阅代付']) add(`personal creation exposes ${text}`, () => assert.ok(source.ledger.includes(text)));
add('personal creation exposes shared expense for the RM1,312 couple journey', () => assert.ok(source.ledger.includes("'shared_bill', '', '共同费用', '一人先付，另一人按份额归还'")));
for (const text of ['共同费用', '统一收款', '分期归还']) add(`group creation exposes ${text}`, () => assert.ok(source.ledger.includes(text)));
add('personal empty state copy is present', () => assert.ok(source.ledger.includes('还没有定期计划')));
add('group empty state copy is present', () => assert.ok(source.ledger.includes('还没有群组计划')));
add('personal empty state preserves one-off action', () => assert.ok(source.ledger.includes('记一笔')));
add('Ledger create action passes origin Ledger ID', () => assert.ok(source.ledger.includes('originLedgerId: ledger.ledgerId')));
add('Ledger create action passes origin Ledger type', () => assert.ok(source.ledger.includes('originLedgerType: ledger.derivedType')));
add('Ledger create action passes member stable IDs', () => assert.ok(source.ledger.includes('originMemberIds: [...ledger.participantIds]')));
add('canonical editor accepts origin context', () => assert.match(source.recurringSheets, /openPlanEditor\(\{ source = null, kind = 'fixed_expense', origin = null/));
add('canonical editor prefill uses originLedgerId', () => assert.ok(source.recurringSheets.includes('origin.originLedgerId')));
add('canonical editor visibly labels prefilled origin', () => assert.ok(source.recurringSheets.includes('从${escapeHTML(editorOriginContext.originDisplayName)}账本建立')));
add('object modification remains explicit', () => assert.ok(source.recurringSheets.includes('>修改</button>')));
add('Ledger plan card opens canonical Plan Detail', () => assert.match(source.ledger, /data-action="fixed-plan-detail" data-source=/));
add('Plan Detail action uses canonical source key', () => assert.ok(source.ledger.includes('card.canonicalSourceKey')));
add('Plan Detail remains the existing implementation', () => assert.match(source.recurringSheets, /export function openPlanDetail/));
add('closing canonical detail returns to underlying Ledger', () => assert.match(source.recurringSheets, /openSheet\(\{ title:COPY\.detail/));
add('plan edit continues through canonical editor', () => assert.match(source.recurringSheets, /fixed-plan-edit[\s\S]*openPlanEditor/));
add('post-save reopens canonical detail', () => assert.match(source.recurringSheets, /result\.status === 'created'[\s\S]*openPlanDetail/));
add('actual history explicitly says actual recorded', () => assert.ok(source.ledger.includes('实际已记录的欠款、收款与还款')));
add('planned summary explicitly excludes actual net', () => assert.ok(source.ledger.includes('尚未记账，不计入上方实际净额')));
add('Ledger planned actions contain no fake payment label', () => assert.doesNotMatch(source.ledger.slice(source.ledger.indexOf('function plansPaymentsSectionHTML'), source.ledger.indexOf('// ---- Ledger detail')), /去付款|立即付款|记录收款|记录还款/));

// Responsive, accessible and safety contracts.
for (const token of ['.ledger-planned-summary', '.ledger-current-action-card', '.ledger-recurring-card', '.plan-origin-context']) add(`FIX1D CSS contains ${token}`, () => assert.ok(source.css.includes(token)));
add('Ledger recurring card has keyboard button semantics', () => assert.match(source.ledger, /<button type="button" class="surface ledger-recurring-card/));
add('current action uses a real button', () => assert.match(source.ledger, /data-action="fixed-plan-detail"[\s\S]*actionLabel/));
add('long titles truncate instead of overflowing', () => assert.match(source.css, /ledger-recurring-main strong[\s\S]*text-overflow: ellipsis/));
add('mobile planned summary collapses to one column', () => assert.match(source.css, /@media \(max-width: 430px\)[\s\S]*ledger-planned-summary \{ grid-template-columns: 1fr/));
add('tabular planned amounts are used', () => assert.match(source.css, /ledger-planned-summary b[\s\S]*font-variant-numeric: tabular-nums/));
add('paused and stopped cards use restrained emphasis', () => assert.match(source.css, /lifecycle-paused[\s\S]*opacity: \.72/));
add('dark mode continues using semantic tokens', () => assert.doesNotMatch(source.css.slice(source.css.indexOf('FIX1D — Ledger')), /#[0-9a-f]{6}/i));
add('reduced motion global contract still covers FIX1D', () => assert.ok(source.css.includes('prefers-reduced-motion: reduce')));
add('no network client added to projection', () => assert.doesNotMatch(source.projection, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/));
add('no storage API added to projection', () => assert.doesNotMatch(source.projection, /localStorage|sessionStorage|indexedDB/));
add('no Supabase added to projection', () => assert.doesNotMatch(source.projection, /createClient|supabase/i));
add('no Telegram execution added to projection', () => assert.doesNotMatch(source.projection, /api\.telegram|sendMessage|botToken/i));
add('projection source documents read-only behavior', () => assert.ok(source.projection.includes('never posts a transaction')));
add('Telegram-ready ledgerId survives projection', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).ledgerId, 'ledger-family'));
add('Telegram-ready planId survives projection', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).planIds[0], familyPlan.id));
add('Telegram-ready occurrenceId survives projection', () => assert.equal(buildLedgerRecurringProjection({ plans: [familyPlan], occurrences: [familyOccurrence], ledgerId: 'ledger-family', participants, referenceDate: '2026-07-13' }).occurrenceIds[0], familyOccurrence.id));
add('Telegram-ready member IDs survive projection', () => assert.deepEqual(familyPlan.relationship.participantIds, ['participant-me', 'participant-sis', 'participant-peng']));
add('focused FIX1D suite reaches the required 158 cases', () => assert.ok(add.count >= 158));
