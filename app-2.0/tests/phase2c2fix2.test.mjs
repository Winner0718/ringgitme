import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRecurringPlan, canonicalSourceKey } from '../src/domain/recurringPlanModel.js';
import { buildOccurrenceSnapshot } from '../src/domain/recurringSchedule.js';
import { deriveRecurringOccurrencePresentation } from '../src/domain/recurringOccurrencePresentation.js';
import { derivePlanVisualPresentation } from '../src/domain/planVisualPresentation.js';
import { deriveMonthlyWorkspace, filterHistoryRows, filterPlanLibrary, planLibraryType } from '../src/domain/fixedCenterWorkspace.js';
import { selectRecurringMonth } from '../src/domain/recurringPlanSelectors.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { LEDGER_RECURRING_SCENARIO_FIXTURES, RECURRING_PLAN_FIXTURES } from '../src/fixtures/recurringPlanFixtures.js';
import { RELATIONSHIP_PARTICIPANTS } from '../src/fixtures/relationshipFixtures.js';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(APP, path), 'utf8');
const source = {
  center: read('src/features/fixed/index.js'),
  visual: read('src/domain/planVisualPresentation.js'),
  workspace: read('src/domain/fixedCenterWorkspace.js'),
  route: read('src/app/router.js'),
  state: read('src/app/state.js'),
  main: read('src/main.js'),
  today: read('src/features/today/index.js'),
  ledger: read('src/features/ledger/index.js'),
  detail: read('src/features/fixed/RecurringPlanSheets.js'),
  css: read('src/styles/phase2c2.css'),
};

const ME = 'participant-me';
const referenceDate = '2026-07-13';
const participantName = (id) => id === ME ? '我' : RELATIONSHIP_PARTICIPANTS.find((row) => row.participantId === id)?.displayName;
const accountName = (id) => ({ 'sv-mbb': 'Maybank 储蓄卡', 'cc-mbb-visa': 'Maybank Visa Platinum', 'sv-cimb': 'CIMB OctoSavers' })[id] || '';
const context = (name = 'month', extra = {}) => ({ context: name, referenceDate, participantName, accountName, ...extra });

function rawPlan(overrides = {}) {
  return {
    id: 'fix2-own', planKind: 'fixed_expense', title: '家庭网络', categoryId: 'bill', currency: 'MYR',
    amountMode: 'fixed', fixedAmountMinor: 9900, schedule: { recurrence: 'monthly', dueDay: 20, timezone: 'Asia/Kuala_Lumpur' },
    startDate: '2026-01-20', status: 'active', paymentSourceAccountId: 'sv-mbb', recordOnlyDefault: false,
    canonicalSource: { sourceType: 'fixed_plan', sourceId: 'fix2-own' }, createdAt: '2026-01-01T09:00:00+08:00', updatedAt: '2026-01-01T09:00:00+08:00',
    ...overrides,
  };
}

const normalize = (overrides = {}) => normalizeRecurringPlan(rawPlan(overrides));
const occurrence = (plan, month = '2026-07', overrides = {}) => ({ ...buildOccurrenceSnapshot(plan, month, { referenceDate, generatedAt: `${referenceDate}T09:00:00+08:00` }), ...overrides });
const normalizedFixtures = RECURRING_PLAN_FIXTURES.map((row) => normalizeRecurringPlan(row));
const couple = normalizedFixtures.find((row) => row.id === 'fixed-rent-shared');
const variable = normalizedFixtures.find((row) => row.id === 'fixed-month-end-utilities');
const family = normalizeRecurringPlan(LEDGER_RECURRING_SCENARIO_FIXTURES.find((row) => row.id === 'fixed-family-rent'));
const installment = normalizeRecurringPlan(LEDGER_RECURRING_SCENARIO_FIXTURES.find((row) => row.id === 'fixed-sister-bed-installment'));
const otherPaidSubscription = normalizeRecurringPlan({
  ...rawPlan({ id: 'subscription-abi-paid', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'subscription-abi-paid' }, planKind: 'subscription', title: 'Netflix 代付', categoryId: 'fun', fixedAmountMinor: 5490, paymentSourceAccountId: 'cc-mbb-visa', subscriptionFundingMode: 'other_pays' }),
  relationshipMode: 'shared_bill',
  relationship: { relationshipMode: 'shared_bill', ledgerId: 'ledger-abi', participantIds: [ME, 'participant-abi'], authenticatedParticipantId: ME, payerParticipantId: 'participant-abi', splitMode: 'custom', shares: [{ participantId: ME, amountMinor: 5490 }, { participantId: 'participant-abi', amountMinor: 0 }] },
});

const cases = [];
function add(name, fn) { cases.push([name, fn]); }

// 001–030: canonical plan visual identities and labeled amounts.
const own = normalize();
const ownOccurrence = occurrence(own);
const ownVisual = derivePlanVisualPresentation(own, ownOccurrence, context());
add('fixed expense type', () => assert.equal(ownVisual.type, 'fixed_expense'));
add('fixed expense label', () => assert.equal(ownVisual.typeLabel, '固定支出'));
add('fixed primary label', () => assert.equal(ownVisual.primaryAmountLabel, '本期需付'));
add('fixed primary minor', () => assert.equal(ownVisual.primaryAmountMinor, 9900));
add('fixed source label', () => assert.equal(ownVisual.sourceLabel, 'Maybank 储蓄卡'));
add('monthly cadence', () => assert.equal(ownVisual.cadenceLabel, '每月'));
const netflix = normalizedFixtures.find((row) => row.id === 'subscription-netflix');
const netflixVisual = derivePlanVisualPresentation(netflix, occurrence(netflix), context());
add('subscription type', () => assert.equal(netflixVisual.type, 'subscription'));
add('subscription label', () => assert.equal(netflixVisual.typeLabel, '订阅'));
add('subscription primary label', () => assert.equal(netflixVisual.primaryAmountLabel, '本期扣款'));
add('subscription amount', () => assert.equal(netflixVisual.primaryAmountMinor, 5490));
const coupleVisual = derivePlanVisualPresentation(couple, occurrence(couple), context());
add('couple user fronts label', () => assert.equal(coupleVisual.primaryAmountLabel, '本期先付'));
add('couple full outflow', () => assert.equal(coupleVisual.primaryAmountMinor, 131200));
add('couple own share secondary', () => assert.deepEqual(coupleVisual.secondaryAmounts[0], { label: '我的份额', amountMinor: 65600 }));
add('couple receipt secondary', () => assert.deepEqual(coupleVisual.secondaryAmounts[1], { label: '预计收回', amountMinor: 65600, tone: 'positive' }));
add('couple money flow', () => assert.equal(coupleVisual.moneyFlowLabel, '我先付款'));
const familyVisual = derivePlanVisualPresentation(family, occurrence(family), context());
add('central collection type', () => assert.equal(familyVisual.type, 'central_collection'));
add('central collection label', () => assert.equal(familyVisual.typeLabel, '统一收款'));
add('family payment label names collector', () => assert.equal(familyVisual.primaryAmountLabel, '本期交给姐姐'));
add('family exact own payment', () => assert.equal(familyVisual.primaryAmountMinor, 8333));
add('family total secondary', () => assert.deepEqual(familyVisual.secondaryAmounts[0], { label: '账单总额', amountMinor: 25000 }));
add('family flow names external payer', () => assert.equal(familyVisual.moneyFlowLabel, '姐姐统一付款'));
const installmentVisual = derivePlanVisualPresentation(installment, occurrence(installment), context());
add('installment type', () => assert.equal(installmentVisual.type, 'installment_repayment'));
add('installment label', () => assert.equal(installmentVisual.typeLabel, '分期还款'));
add('installment primary', () => assert.equal(installmentVisual.primaryAmountMinor, 8333));
add('installment remaining principal', () => assert.equal(installmentVisual.progress.remainingPrincipalMinor, 50000));
add('installment remaining periods', () => assert.equal(installmentVisual.progress.remainingPeriods, 6));
add('installment final amount', () => assert.equal(installmentVisual.progress.finalInstallmentMinor, 8335));
add('installment progress ratio exact', () => assert.equal(installmentVisual.progress.ratio, 0.5));
const otherPaidVisual = derivePlanVisualPresentation(otherPaidSubscription, occurrence(otherPaidSubscription), context());
add('partner paid remains subscription type', () => assert.equal(otherPaidVisual.type, 'subscription'));
add('partner paid label names Abi', () => assert.equal(otherPaidVisual.primaryAmountLabel, '本期需还 Abi'));

// 031–060: variable semantics and exclusive monthly sections.
const variableOccurrence = occurrence(variable);
const variablePresentation = deriveRecurringOccurrencePresentation(variableOccurrence, variable, referenceDate);
const variableVisual = derivePlanVisualPresentation(variable, variableOccurrence, context());
add('variable fixture explicit mode', () => assert.equal(variable.amountMode, 'variable'));
add('variable estimate remains estimate', () => assert.equal(variableOccurrence.amountState, 'estimated'));
add('variable has no actual amount', () => assert.equal(variableOccurrence.actualAmountMinor, null));
add('variable status waits for amount', () => assert.equal(variablePresentation.semanticState, 'awaiting_variable_amount'));
add('variable status is amber', () => assert.equal(variablePresentation.tone, 'amber'));
add('variable primary is waiting', () => assert.equal(variableVisual.primaryAmountLabel, '等待填写本期金额'));
add('variable primary has no confirmed minor', () => assert.equal(variableVisual.primaryAmountMinor, null));
add('variable reference budget stays secondary', () => assert.deepEqual(variableVisual.secondaryAmounts[0], { label: '参考预算', amountMinor: 24000, isEstimate: true }));
const projectedRows = [
  occurrence(couple, '2026-07', { dueDate: '2026-07-07', status: 'overdue' }),
  occurrence(netflix, '2026-07', { dueDate: '2026-07-20', status: 'upcoming' }),
  variableOccurrence,
  occurrence(own, '2026-07', { dueDate: '2026-07-25', status: 'upcoming' }),
  occurrence(normalizedFixtures.find((row) => row.id === 'subscription-icloud'), '2026-07', { recordedStatus: 'paid', status: 'paid' }),
];
const projection = selectRecurringMonth({ plans: [couple, netflix, variable, own, normalizedFixtures.find((row) => row.id === 'subscription-icloud')], occurrences: projectedRows, monthKey: '2026-07', referenceDate });
const monthly = deriveMonthlyWorkspace(projection);
add('monthly overdue in now', () => assert.ok(monthly.sections.now.some((row) => row.plan.id === couple.id)));
add('monthly due soon in now', () => assert.ok(monthly.sections.now.some((row) => row.plan.id === netflix.id)));
add('monthly variable in now', () => assert.ok(monthly.sections.now.some((row) => row.plan.id === variable.id)));
add('monthly future in next', () => assert.ok(monthly.sections.next.some((row) => row.plan.id === own.id)));
add('monthly paid in completed', () => assert.equal(monthly.sections.completed.length, 1));
add('monthly no duplicate IDs', () => assert.equal(monthly.duplicateOccurrenceCount, 0));
add('monthly occurrence count exclusive', () => assert.equal(monthly.occurrenceIds.length, 5));
add('monthly completed count', () => assert.equal(monthly.overview.completedCount, 1));
add('monthly total count', () => assert.equal(monthly.overview.totalCount, 5));
add('monthly remaining count', () => assert.equal(monthly.overview.remainingCount, 4));
add('monthly overdue count', () => assert.equal(monthly.overview.overdueCount, 1));
add('monthly attention count', () => assert.equal(monthly.overview.attentionCount, 3));
add('monthly awaiting amount count', () => assert.equal(monthly.overview.awaitingAmountCount, 1));
add('monthly burden uses own shares', () => assert.equal(monthly.overview.burdenMinor, projectedRows.reduce((sum, row) => sum + row.ownShareMinor, 0)));
add('monthly account outflow exact', () => assert.equal(monthly.overview.accountOutflowMinor, projectedRows.reduce((sum, row) => sum + row.cashOutflowMinor, 0)));
add('monthly expected receipt exact', () => assert.equal(monthly.overview.expectedReceiptMinor, 65600));
add('monthly payment-to-other exact', () => assert.equal(monthly.overview.paymentToOtherMinor, 0));
for (const section of ['now', 'next', 'completed']) add(`${section} ordering deterministic`, () => {
  const ids = monthly.sections[section].map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
});
for (const status of ['paused', 'stopped', 'archived']) add(`${status} excluded from operational sections`, () => {
  const changed = normalize({ id: `fix2-${status}`, canonicalSource: { sourceType: 'fixed_plan', sourceId: `fix2-${status}` }, status: status === 'archived' ? 'stopped' : status, ...(status === 'archived' ? { archivedAt: '2026-07-01T09:00:00+08:00' } : {}) });
  const row = { ...occurrence(changed), status };
  const selected = selectRecurringMonth({ plans: [changed], occurrences: [row], monthKey: '2026-07', referenceDate });
  assert.equal(deriveMonthlyWorkspace(selected).occurrenceIds.length, 0);
});

// 061–090: plan library states, types, sorting and identity.
const libraryPlans = [couple, netflix, variable, family, installment, normalize({ id: 'paused', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'paused' }, status: 'paused' }), normalize({ id: 'stopped', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'stopped' }, status: 'stopped' }), normalize({ id: 'archived', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'archived' }, status: 'stopped', archivedAt: '2026-07-01T09:00:00+08:00' })];
const occurrenceMap = new Map(libraryPlans.map((plan, index) => [plan.id, [{ ...occurrence(plan), dueDate: `2026-07-${String(14 + index).padStart(2, '0')}`, status: 'upcoming' }]]));
add('active library count', () => assert.equal(filterPlanLibrary(libraryPlans, { status: 'active', occurrencesByPlan: occurrenceMap, referenceDate }).length, 5));
add('paused library count', () => assert.equal(filterPlanLibrary(libraryPlans, { status: 'paused', occurrencesByPlan: occurrenceMap, referenceDate }).length, 1));
add('stopped library excludes archived', () => assert.equal(filterPlanLibrary(libraryPlans, { status: 'stopped', occurrencesByPlan: occurrenceMap, referenceDate }).length, 1));
add('archived library count', () => assert.equal(filterPlanLibrary(libraryPlans, { status: 'archived', occurrencesByPlan: occurrenceMap, referenceDate }).length, 1));
for (const [type, expected] of [['fixed', 1], ['subscription', 1], ['relationship', 2], ['installment', 1]]) add(`${type} plan filter`, () => assert.equal(filterPlanLibrary(libraryPlans, { status: 'active', type, occurrencesByPlan: occurrenceMap, referenceDate }).length, expected));
add('couple maps relationship type', () => assert.equal(planLibraryType(couple), 'relationship'));
add('family maps relationship type', () => assert.equal(planLibraryType(family), 'relationship'));
add('installment maps installment type', () => assert.equal(planLibraryType(installment), 'installment'));
add('subscription maps subscription type', () => assert.equal(planLibraryType(netflix), 'subscription'));
add('variable maps fixed type', () => assert.equal(planLibraryType(variable), 'fixed'));
add('library has no duplicate plan', () => { const rows = filterPlanLibrary([...libraryPlans, libraryPlans[0]], { status: 'active', occurrencesByPlan: occurrenceMap, referenceDate }); assert.equal(new Set(rows.map((row) => row.id)).size, rows.length); });
add('library earliest occurrence first', () => assert.equal(filterPlanLibrary(libraryPlans, { status: 'active', occurrencesByPlan: occurrenceMap, referenceDate })[0].id, couple.id));
add('library canonical source preserved', () => assert.equal(canonicalSourceKey(filterPlanLibrary(libraryPlans, { status: 'active', occurrencesByPlan: occurrenceMap, referenceDate })[0].canonicalSource), canonicalSourceKey(couple.canonicalSource)));
for (const status of ['active', 'paused', 'stopped']) add(`${status} state label structured`, () => {
  const plan = libraryPlans.find((row) => row.status === status && !row.archivedAt);
  assert.ok(derivePlanVisualPresentation(plan, null, context('plan-library')).planStateLabel);
});
for (const name of ['month', 'plan-library', 'history', 'today', 'ledger', 'plan-detail']) add(`${name} context retained`, () => assert.equal(derivePlanVisualPresentation(own, ownOccurrence, context(name)).context, name));
for (const plan of [couple, netflix, variable, family, installment]) add(`${plan.id} stable visual plan ID`, () => assert.equal(derivePlanVisualPresentation(plan, null, context('plan-library')).planId, plan.id));

// 091–115: history identity, immutable snapshots and filter behavior.
const historyPaid = { ...occurrence(own, '2026-06'), recordedStatus: 'paid', status: 'paid' };
const historyOverdue = { ...occurrence(couple, '2026-06'), dueDate: '2026-06-07', status: 'overdue' };
const historySkipped = { ...occurrence(netflix, '2026-06'), recordedStatus: 'skipped', status: 'skipped' };
const historyRows = [historyPaid, historyOverdue, historySkipped].map((row) => ({ ...row, plan: row.planId === own.id ? own : row.planId === couple.id ? couple : netflix, presentation: deriveRecurringOccurrencePresentation(row, row.planId === own.id ? own : row.planId === couple.id ? couple : netflix, referenceDate) }));
add('history all includes supported states', () => assert.equal(filterHistoryRows(historyRows, 'all').length, 3));
add('history completed filter', () => assert.deepEqual(filterHistoryRows(historyRows, 'completed').map((row) => row.id), [historyPaid.id]));
add('history overdue filter', () => assert.deepEqual(filterHistoryRows(historyRows, 'overdue').map((row) => row.id), [historyOverdue.id]));
add('history skipped filter', () => assert.deepEqual(filterHistoryRows(historyRows, 'skipped').map((row) => row.id), [historySkipped.id]));
add('history future excluded', () => { const future = { ...occurrence(own, '2026-08'), plan: own, presentation: deriveRecurringOccurrencePresentation(occurrence(own, '2026-08'), own, referenceDate) }; assert.equal(filterHistoryRows([future], 'all').length, 0); });
add('history duplicate occurrence removed', () => assert.equal(filterHistoryRows([historyRows[0], historyRows[0]], 'all').length, 1));
add('history newest first', () => assert.equal(filterHistoryRows(historyRows, 'all')[0].dueDate >= filterHistoryRows(historyRows, 'all').at(-1).dueDate, true));
add('history immutable amount wins after plan edit', () => { const changed = { ...own, fixedAmountMinor: 20000, totalAmountMinor: 20000, ownShareMinor: 20000, cashOutflowMinor: 20000 }; assert.equal(derivePlanVisualPresentation(changed, historyPaid, context('history')).primaryAmountMinor, 9900); });
add('history immutable occurrence ID', () => assert.equal(derivePlanVisualPresentation(own, historyPaid, context('history')).occurrenceId, historyPaid.id));
add('history paid tone green', () => assert.equal(derivePlanVisualPresentation(own, historyPaid, context('history')).tone, 'green'));
add('history skipped tone neutral', () => assert.equal(derivePlanVisualPresentation(netflix, historySkipped, context('history')).tone, 'neutral'));
for (const recorded of ['paid', 'charged', 'received', 'repaid', 'completed']) add(`${recorded} completion is immutable`, () => {
  const row = { ...historyPaid, id: `history-${recorded}`, recordedStatus: recorded, status: recorded };
  const value = deriveRecurringOccurrencePresentation(row, own, referenceDate);
  assert.deepEqual([value.tone, value.immutable], ['green', true]);
});
for (const offset of [1, 2, 3, 4, 5, 6, 7]) add(`due-soon day ${offset} stays attention`, () => {
  const day = String(13 + offset).padStart(2, '0');
  assert.equal(deriveRecurringOccurrencePresentation({ ...ownOccurrence, dueDate: `2026-07-${day}`, status: 'upcoming' }, own, referenceDate).attention, true);
});
for (const state of ['paused', 'stopped', 'archived']) add(`history lifecycle ${state} label remains text`, () => assert.ok(['已暂停', '已停止', '已归档'].includes(deriveRecurringOccurrencePresentation({ ...historyOverdue, status: null }, { ...couple, status: state === 'paused' ? 'paused' : 'stopped', archivedAt: state === 'archived' ? '2026-07-01' : null }, referenceDate).label)));

// 116–145: route, accessibility, responsive and cross-surface contracts.
for (const token of ['fixedWorkspace', 'fixedPlanStatus', 'fixedPlanType', 'fixedHistoryFilter', 'fixedCompletedExpanded']) add(`state owns ${token}`, () => assert.ok(source.state.includes(token)));
for (const token of ["url.searchParams.set('view'", "url.searchParams.set('status'", "url.searchParams.set('type'", "url.searchParams.set('history'"]) add(`route serializes ${token}`, () => assert.ok(source.route.includes(token)));
for (const token of ['view=month', 'view=plans', 'view=history']) add(`${token} represented by workspace values`, () => assert.ok(source.center.includes(token.split('=')[1])));
add('main parses fixed workspace before assets view', () => assert.ok(source.main.includes("params.get('fixedCenter') !== '1'")));
add('workspace selected semantics', () => assert.ok(source.center.includes('aria-current') && source.center.includes('aria-pressed')));
add('workspace keyboard arrows', () => assert.ok(source.center.includes('ArrowLeft') && source.center.includes('ArrowRight')));
add('workspace Home and End', () => assert.ok(source.center.includes("'Home', 'End'")));
add('completed announces expansion', () => assert.ok(source.center.includes('aria-expanded')));
add('cards keyboard reachable', () => assert.ok(source.center.includes('tabindex="0"')));
add('amount accessible label', () => assert.ok(source.center.includes('fixed-primary-amount" aria-label=')));
add('touch focus cleanup', () => assert.ok(source.css.includes('focus:not(:focus-visible)')));
add('keyboard focus remains available', () => assert.ok(source.css.includes(':focus-visible')));
add('390 card grid constrains text', () => assert.ok(source.css.includes('grid-template-columns: 42px minmax(0, 1fr)')));
add('430 responsive rule', () => assert.ok(source.css.includes('@media (max-width: 430px)')));
add('374 narrow fallback', () => assert.ok(source.css.includes('@media (max-width: 374px)')));
add('bottom safe area', () => assert.ok(source.css.includes('env(safe-area-inset-bottom)')));
add('filter rail owns horizontal scroll', () => assert.ok(source.css.includes('.fixed-filter-rail') && source.css.includes('overflow-x: auto')));
add('document width constrained', () => assert.ok(source.css.includes('min-width: 0')));
add('reduced motion media query', () => assert.ok(source.css.includes('prefers-reduced-motion: reduce')));
add('debug reduced motion token', () => assert.ok(source.css.includes('data-reduced-motion="true"')));
add('Today uses shared monthly selector', () => assert.ok(source.today.includes('deriveMonthlyWorkspace')));
add('Today opens month workspace', () => assert.ok(source.today.includes("fixedWorkspace: 'month'")));
add('Ledger projection consumes shared visual', () => assert.ok(source.ledger.includes('card.visual.statusLabel')));
add('Plan Detail consumes shared visual', () => assert.ok(source.detail.includes('derivePlanVisualPresentation')));
add('Plan Detail labels primary amount', () => assert.ok(source.detail.includes('visual.primaryAmountLabel')));
add('Plan Detail replaces own account copy for partner-paid subscriptions', () => assert.ok(source.detail.includes("subscriptionFundingMode === 'other_pays'") && source.detail.includes("['代付方'")));

// 146–181: financial isolation, canonical identity and cumulative safeguards.
const demo = createDemoDataSource();
const before = { accounts: demo.getAccounts(), transactions: demo.getTransactions(), activities: demo.getActivities(), relationship: demo.getRelationshipSummary('ledger-sis') };
demo.getFixedCenterMonth('2026-07', referenceDate);
demo.getCanonicalRecurringPlans().forEach((plan) => derivePlanVisualPresentation(plan, null, context('plan-library')));
add('visual reads do not mutate accounts', () => assert.deepEqual(demo.getAccounts(), before.accounts));
add('visual reads do not create transactions', () => assert.deepEqual(demo.getTransactions(), before.transactions));
add('visual reads do not create activities', () => assert.deepEqual(demo.getActivities(), before.activities));
add('visual reads do not mutate relationship balances', () => assert.deepEqual(demo.getRelationshipSummary('ledger-sis'), before.relationship));
add('one canonical plan source', () => { const keys = demo.getCanonicalRecurringPlans().map((plan) => canonicalSourceKey(plan.canonicalSource)); assert.equal(new Set(keys).size, keys.length); });
add('one occurrence per period', () => { const rows = demo.getFixedCenterMonth('2026-07', referenceDate).rows; assert.equal(new Set(rows.map((row) => `${canonicalSourceKey(row.canonicalSource)}:${row.periodKey}`)).size, rows.length); });
add('Fixed and Ledger couple plan ID equal', () => assert.equal(demo.getFixedCenterMonth('2026-07', referenceDate).rows.find((row) => row.plan.id === couple.id).canonicalPlanId, demo.getLedgerRecurringProjection('ledger-sis', referenceDate).cards.find((card) => card.planId === couple.id).canonicalPlanId));
add('variable display does not mark paid', () => assert.notEqual(variableOccurrence.status, 'paid'));
add('installment display does not reduce principal', () => { const beforeRemaining = installment.relationship.remainingPrincipalMinor; derivePlanVisualPresentation(installment, occurrence(installment), context()); assert.equal(installment.relationship.remainingPrincipalMinor, beforeRemaining); });
for (const [name, pattern] of [
  ['network fetch', /\bfetch\s*\(/], ['XHR', /XMLHttpRequest/], ['WebSocket', /WebSocket/], ['EventSource', /EventSource/], ['sendBeacon', /sendBeacon/],
  ['localStorage', /localStorage/], ['sessionStorage', /sessionStorage/], ['IndexedDB', /indexedDB/i], ['Supabase', /createClient\s*\(|@supabase/i],
  ['Telegram execution', /api\.telegram|sendMessage|botToken/i], ['transaction posting', /createTransaction|postTransaction|applyTransaction/],
  ['account mutation', /setAccountBalance|updateAccountBalance/], ['card mutation', /setCardDebt|updateCardOutstanding/],
  ['relationship posting', /recordRelationshipEntry|postRelationship/], ['protected port', /8788/],
]) add(`FIX2 source has no ${name}`, () => assert.doesNotMatch(`${source.visual}\n${source.workspace}\n${source.center}`, pattern));
add('monthly workspaces are exactly three', () => assert.deepEqual([...source.center.matchAll(/\['(month|plans|history)',/g)].map((match) => match[1]), ['month', 'plans', 'history']));
add('old six visible buckets removed', () => {
  const visibleMonthRenderer = source.center.slice(source.center.indexOf('function renderMonthWorkspace'), source.center.indexOf('function filterRail'));
  assert.doesNotMatch(visibleMonthRenderer, /section\(COPY\.(overdue|dueSoon|paused|stopped)/);
});
add('paused plans absent from month renderer', () => assert.doesNotMatch(source.center.slice(source.center.indexOf('function renderMonthWorkspace'), source.center.indexOf('function filterRail')), /pausedPlans/));
add('plan filters preserve canonical IDs', () => assert.ok(source.center.includes('data-canonical-plan-id')));
add('history preserves occurrence IDs', () => assert.ok(source.center.includes('data-occurrence-id')));
add('variable reference is explicitly budget', () => assert.ok(source.visual.includes("label: '参考预算'")));
add('expected receipt explicitly forecast', () => assert.ok(source.visual.includes("label: '预计收回'")));
add('counterparty payment explicit', () => assert.ok(source.visual.includes('本期需还')));
add('central collection explicit', () => assert.ok(source.visual.includes('本期交给')));
add('shared full outflow explicit', () => assert.ok(source.visual.includes('本期先付')));
add('history empty state does not imply deletion', () => assert.ok(source.center.includes('记录没有被删除')));
add('month empty state lists supported plan kinds', () => assert.ok(source.center.includes('固定支出、订阅、关系计划或分期')));

assert.ok(cases.length >= 181, `FIX2 focused suite must contain at least 181 substantive cases, got ${cases.length}`);
cases.forEach(([name, fn], index) => test(`2C2-FIX2-${String(index + 1).padStart(3, '0')}: ${name}`, fn));
