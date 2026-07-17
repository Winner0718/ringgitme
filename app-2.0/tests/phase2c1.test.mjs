import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateResponsibility,
  canonicalSourceKey,
  equalSplitShares,
  normalizeRecurringPlan,
} from '../src/domain/recurringPlanModel.js';
import { createRecurringPlanRepository } from '../src/domain/recurringPlanRepository.js';
import {
  buildOccurrenceSnapshot,
  deterministicOccurrenceId,
  dueDateForPlanMonth,
  isDueSoon,
  occurrencePeriodKey,
  occurrenceStatus,
} from '../src/domain/recurringSchedule.js';
import {
  dedupeCanonicalOccurrences,
  dedupeCanonicalPlans,
  projectFixedRelationshipsForLedger,
  projectObligationPlan,
  selectRecurringMonth,
  selectTodayFixed,
} from '../src/domain/recurringPlanSelectors.js';
import { calendarDuration, elapsedDurationChinese } from '../src/domain/calendarDuration.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(APP, path), 'utf8');
const moduleFiles = (dir) => readdirSync(join(APP, dir), { withFileTypes: true }).flatMap((entry) => {
  const next = join(dir, entry.name);
  return entry.isDirectory() ? moduleFiles(next) : entry.name.endsWith('.js') ? [next] : [];
});

const BASE = Object.freeze({
  id: 'fixed-test', planKind: 'fixed_expense', title: '测试固定计划', currency: 'MYR', totalAmountMinor: 10000,
  schedule: { recurrence: 'monthly', dueDay: 15, timezone: 'Asia/Kuala_Lumpur' }, startDate: '2026-01-01',
  status: 'active', paymentSourceAccountId: 'sv-mbb', recordOnlyDefault: false, note: '保留备注',
  provider: { name: 'Provider', kind: 'fixture' }, logoRef: 'fixture-logo',
});

function rawPlan(overrides = {}) {
  return {
    ...BASE,
    ...overrides,
    schedule: { ...BASE.schedule, ...(overrides.schedule || {}) },
  };
}

function plan(overrides = {}) {
  return normalizeRecurringPlan(rawPlan(overrides));
}

function relation(overrides = {}) {
  return {
    ledgerId: 'ledger-sis', participantIds: ['participant-me', 'participant-sis'], authenticatedParticipantId: 'participant-me',
    payerParticipantId: 'participant-me', splitMode: 'custom', paymentMode: 'full_bill',
    shares: [{ participantId: 'participant-me', amountMinor: 5000 }, { participantId: 'participant-sis', amountMinor: 5000 }],
    ...overrides,
  };
}

function repository({ plans = [rawPlan()], occurrences = [] } = {}) {
  return createRecurringPlanRepository({
    plans, occurrences, accountExists: () => true, participantExists: () => true, ledgerExists: () => true,
    clock: () => '2026-07-13T09:00:00+08:00',
  });
}

function generated(p = plan(), month = '2026-07', referenceDate = '2026-07-13') {
  return buildOccurrenceSnapshot(p, month, { referenceDate, generatedAt: `${referenceDate}T09:00:00+08:00` });
}

function errorCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

const obligation = (overrides = {}) => ({
  planId: 'plan-obligation', planType: 'recurring_monthly', title: '关系月付', currency: 'MYR', amountMinor: 85000,
  dueDay: 7, startDate: '2026-01-07', endDate: null, status: 'active', ledgerId: 'ledger-sis',
  creditorParticipantId: 'participant-sis', debtorParticipantId: 'participant-me', defaultAccountId: 'sv-mbb',
  projection: { fixedCenterEligible: true }, createdAt: '2026-01-01T09:00:00+08:00', updatedAt: '2026-01-01T09:00:00+08:00', revision: 1,
  ...overrides,
});

const cases = [];
const add = (id, name, fn) => cases.push([id, name, fn]);

// Plan model 1–16.
add(1, 'fixed expense creation', () => assert.equal(plan().planKind, 'fixed_expense'));
add(2, 'subscription creation', () => assert.equal(plan({ planKind: 'subscription' }).planKind, 'subscription'));
add(3, 'recurring relationship projection', () => assert.equal(plan({ planKind: 'recurring_relationship', relationship: relation() }).ownShareMinor, 5000));
add(4, 'stable plan ID', () => assert.equal(plan().id, 'fixed-test'));
add(5, 'amount uses minor units', () => assert.equal(plan().totalAmountMinor, 10000));
add(6, 'invalid negative amount', () => errorCode(() => plan({ totalAmountMinor: -1 }), 'invalid_amount'));
add(7, 'invalid zero amount', () => errorCode(() => plan({ totalAmountMinor: 0 }), 'invalid_amount'));
add(8, 'active status', () => assert.equal(plan().status, 'active'));
add(9, 'paused status', () => assert.equal(plan({ status: 'paused' }).status, 'paused'));
add(10, 'stopped status', () => assert.equal(plan({ status: 'stopped' }).status, 'stopped'));
add(11, 'revision increments on update', () => { const repo = repository(); assert.equal(repo.updatePlan('fixed-test', { title: '新名称' }).revision, 2); });
add(12, 'historical data preserved', () => { const repo = repository(); assert.equal(repo.updatePlan('fixed-test', { title: '新名称' }).history[0].before.title, BASE.title); });
add(13, 'record-only default preserved', () => assert.equal(plan({ recordOnlyDefault: true }).recordOnlyDefault, true));
add(14, 'note preserved', () => assert.equal(plan().note, '保留备注'));
add(15, 'payment source preserved', () => assert.equal(plan().paymentSourceAccountId, 'sv-mbb'));
add(16, 'logo and provider metadata preserved', () => assert.deepEqual([plan().logoRef, plan().provider.name], ['fixture-logo', 'Provider']));

// Schedule 17–26.
add(17, 'monthly due date', () => assert.equal(dueDateForPlanMonth(plan(), '2026-07'), '2026-07-15'));
add(18, 'yearly due date', () => assert.equal(dueDateForPlanMonth(plan({ schedule: { recurrence: 'yearly', dueMonth: 8, dueDay: 18 } }), '2026-08'), '2026-08-18'));
add(19, 'February day-31 clamp', () => assert.equal(dueDateForPlanMonth(plan({ schedule: { dueDay: 31 } }), '2026-02'), '2026-02-28'));
add(20, 'leap-year February clamp', () => assert.equal(dueDateForPlanMonth(plan({ schedule: { dueDay: 31 } }), '2028-02'), '2028-02-29'));
add(21, 'April day-31 clamp', () => assert.equal(dueDateForPlanMonth(plan({ schedule: { dueDay: 31 } }), '2026-04'), '2026-04-30'));
add(22, 'clamped date never rolls month', () => assert.equal(dueDateForPlanMonth(plan({ schedule: { dueDay: 31 } }), '2026-02').slice(0, 7), '2026-02'));
add(23, 'no occurrence before start', () => assert.equal(generated(plan({ startDate: '2026-08-01' }), '2026-07'), null));
add(24, 'no occurrence after end', () => assert.equal(generated(plan({ endDate: '2026-06-30' }), '2026-07'), null));
add(25, 'explicit timezone and reference input', () => assert.equal(generated().generatedAt, '2026-07-13T09:00:00+08:00'));
add(26, 'pure generator has no Date.now dependency', () => assert.doesNotMatch(read('src/domain/recurringSchedule.js'), /Date\.now\s*\(/));

// Responsibility 27–42.
add(27, 'no relationship own share equals total', () => assert.equal(calculateResponsibility(10000).ownShareMinor, 10000));
add(28, 'user pays full shared bill', () => assert.equal(calculateResponsibility(10000, relation()).cashOutflowMinor, 10000));
add(29, 'shared own share is correct', () => assert.equal(calculateResponsibility(10000, relation()).ownShareMinor, 5000));
add(30, 'shared cash outflow is correct', () => assert.equal(calculateResponsibility(10000, relation()).cashOutflowMinor, 10000));
add(31, 'shared receivable is correct', () => assert.equal(calculateResponsibility(10000, relation()).receivableMinor, 5000));
add(32, 'another participant pays', () => assert.equal(calculateResponsibility(10000, relation({ payerParticipantId: 'participant-sis' })).payableMinor, 5000));
add(33, 'other payer means user cash outflow zero', () => assert.equal(calculateResponsibility(10000, relation({ payerParticipantId: 'participant-sis' })).cashOutflowMinor, 0));
add(34, 'other payer payable is correct', () => assert.equal(calculateResponsibility(10000, relation({ payerParticipantId: 'participant-sis' })).payableMinor, 5000));
add(35, 'equal split is exact in minor units', () => assert.deepEqual(equalSplitShares(100, ['a', 'b', 'c']).map((x) => x.amountMinor), [33, 33, 34]));
add(36, 'custom split exact', () => assert.equal(calculateResponsibility(10000, relation()).totalAmountMinor, 10000));
add(37, 'custom split under total rejected', () => errorCode(() => calculateResponsibility(10000, relation({ shares: [{ participantId: 'participant-me', amountMinor: 4000 }, { participantId: 'participant-sis', amountMinor: 5000 }] })), 'custom_split_not_exact'));
add(38, 'custom split over total rejected', () => errorCode(() => calculateResponsibility(10000, relation({ shares: [{ participantId: 'participant-me', amountMinor: 6000 }, { participantId: 'participant-sis', amountMinor: 5000 }] })), 'custom_split_not_exact'));
add(39, 'duplicate participant rejected', () => errorCode(() => calculateResponsibility(10000, relation({ participantIds: ['participant-me', 'participant-me'] })), 'duplicate_participant'));
add(40, 'missing authenticated user rejected', () => errorCode(() => calculateResponsibility(10000, relation({ authenticatedParticipantId: 'participant-x' })), 'authenticated_user_missing'));
add(41, 'missing payer rejected', () => errorCode(() => calculateResponsibility(10000, relation({ payerParticipantId: '' })), 'payer_missing'));
add(42, 'stable participant IDs preserved', () => assert.deepEqual(plan({ planKind: 'recurring_relationship', relationship: relation() }).relationship.participantIds, ['participant-me', 'participant-sis']));

// Canonical source 43–53.
add(43, 'fixed repository source', () => assert.equal(canonicalSourceKey(plan().canonicalSource), 'fixed_plan:fixed-test'));
add(44, 'obligation repository source', () => assert.equal(canonicalSourceKey(projectObligationPlan(obligation()).canonicalSource), 'obligation_plan:plan-obligation'));
add(45, 'one canonical source per plan', () => assert.equal(dedupeCanonicalPlans([plan()]).length, 1));
add(46, 'duplicate canonical source rejected', () => errorCode(() => repository({ plans: [rawPlan(), rawPlan({ id: 'fixed-other', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'fixed-test' } })] }), 'duplicate_canonical_source'));
add(47, 'Fixed projection from obligation', () => assert.equal(projectObligationPlan(obligation()).planKind, 'recurring_relationship'));
add(48, 'Ledger projection from fixed relationship plan', () => assert.equal(projectFixedRelationshipsForLedger([plan({ relationship: relation() })], 'ledger-sis')[0].projectionOnly, true));
add(49, 'Today projection', () => assert.equal(selectTodayFixed(createDemoDataSource().getFixedCenterMonth('2026-07')).myFixedMinor, 181380));
add(50, 'same canonical ID across projections', () => { const p = plan({ planKind: 'recurring_relationship', relationship: relation() }); assert.equal(projectFixedRelationshipsForLedger([p], 'ledger-sis')[0].canonicalPlanId, p.id); });
add(51, 'title equality does not merge unrelated plans', () => assert.equal(dedupeCanonicalPlans([plan(), plan({ id: 'fixed-other' })]).length, 2));
add(52, 'no duplicate rent plan by canonical source', () => { const d = createDemoDataSource(); const rows = d.getFixedCenterMonth('2026-07').rows; assert.equal(new Set(rows.map((row) => row.canonicalSourceKey)).size, rows.length); });
add(53, 'source update reflected in projection', () => { const repo = repository({ plans: [rawPlan({ planKind: 'recurring_relationship', relationship: relation() })] }); repo.updatePlan('fixed-test', { title: '更新关系固定' }); assert.equal(projectFixedRelationshipsForLedger(repo.listPlans(), 'ledger-sis')[0].title, '更新关系固定'); });

// Occurrence identity 54–62.
add(54, 'monthly deterministic ID', () => assert.equal(generated().id, generated().id));
add(55, 'yearly deterministic ID', () => { const p = plan({ schedule: { recurrence: 'yearly', dueMonth: 8, dueDay: 18 } }); assert.equal(deterministicOccurrenceId(p, occurrencePeriodKey(p, '2026-08')), generated(p, '2026-08').id); });
add(56, 'same-period generation idempotent', () => { const repo = repository(); const a = repo.generateOccurrence('fixed-test', '2026-07', { referenceDate: '2026-07-13' }); const b = repo.generateOccurrence('fixed-test', '2026-07', { referenceDate: '2026-07-13' }); assert.deepEqual([a.created, b.created], [true, false]); });
add(57, 'adjacent month occurrence unique', () => assert.notEqual(generated(plan(), '2026-07').id, generated(plan(), '2026-08').id));
add(58, 'duplicate occurrence repository insert rejected', () => { const o = generated(); errorCode(() => repository({ occurrences: [o, o] }), 'duplicate_occurrence_identity'); });
add(59, 'period key stable', () => assert.equal(occurrencePeriodKey(plan(), '2026-07'), '2026-07'));
add(60, 'occurrence snapshots financial values', () => assert.deepEqual([generated().totalAmountMinor, generated().ownShareMinor, generated().cashOutflowMinor], [10000, 10000, 10000]));
add(61, 'occurrence carries canonical source', () => assert.deepEqual(generated().canonicalSource, { sourceType: 'fixed_plan', sourceId: 'fixed-test' }));
add(62, 'occurrence carries plan revision', () => assert.equal(generated(plan({ revision: 4 })).planRevision, 4));

// Status 63–74.
const statusFor = (dueDate, referenceDate, planChanges = {}, recordedStatus = null) => occurrenceStatus({ dueDate, recordedStatus }, plan(planChanges), referenceDate);
add(63, 'upcoming status', () => assert.equal(statusFor('2026-07-20', '2026-07-13'), 'upcoming'));
add(64, 'due-today status', () => assert.equal(statusFor('2026-07-13', '2026-07-13'), 'due_today'));
add(65, 'overdue status', () => assert.equal(statusFor('2026-07-12', '2026-07-13'), 'overdue'));
add(66, 'paid status', () => assert.equal(statusFor('2026-07-12', '2026-07-13', {}, 'paid'), 'paid'));
add(67, 'skipped status', () => assert.equal(statusFor('2026-07-12', '2026-07-13', {}, 'skipped'), 'skipped'));
add(68, 'not-started status', () => assert.equal(statusFor('2026-07-10', '2026-07-13', { startDate: '2026-07-11' }), 'not_started'));
add(69, 'paused status', () => assert.equal(statusFor('2026-07-20', '2026-07-13', { status: 'paused' }), 'paused'));
add(70, 'stopped status', () => assert.equal(statusFor('2026-07-20', '2026-07-13', { status: 'stopped' }), 'stopped'));
add(71, 'paid priority over overdue', () => assert.equal(statusFor('2026-07-01', '2026-07-13', {}, 'paid'), 'paid'));
add(72, 'stopped history remains paid', () => assert.equal(statusFor('2026-07-01', '2026-07-13', { status: 'stopped' }, 'paid'), 'paid'));
add(73, 'seven-day due-soon selector', () => assert.equal(isDueSoon({ dueDate: '2026-07-20', status: 'upcoming' }, '2026-07-13', 7), true));
add(74, 'status reference date is explicit', () => errorCode(() => occurrenceStatus({ dueDate: '2026-07-20' }, plan()), 'invalid_reference_date'));

// Historical integrity 75–81.
add(75, 'paid occurrence immutable', () => { const p = plan(); const o = { ...generated(p, '2026-08'), recordedStatus: 'paid' }; const repo = repository({ occurrences: [o] }); repo.updatePlan('fixed-test', { totalAmountMinor: 12000 }); assert.equal(repo.generateOccurrence('fixed-test', '2026-08', { referenceDate: '2026-07-13' }).occurrence.totalAmountMinor, 10000); });
add(76, 'skipped occurrence immutable', () => { const o = { ...generated(plan(), '2026-08'), recordedStatus: 'skipped' }; const repo = repository({ occurrences: [o] }); repo.updatePlan('fixed-test', { totalAmountMinor: 12000 }); assert.equal(repo.generateOccurrence('fixed-test', '2026-08', { referenceDate: '2026-07-13' }).occurrence.totalAmountMinor, 10000); });
add(77, 'future unpaid occurrence refreshes safely', () => { const o = generated(plan(), '2026-08'); const repo = repository({ occurrences: [o] }); repo.updatePlan('fixed-test', { totalAmountMinor: 12000 }); const result = repo.generateOccurrence('fixed-test', '2026-08', { referenceDate: '2026-07-13' }); assert.deepEqual([result.refreshed, result.occurrence.totalAmountMinor], [true, 12000]); });
add(78, 'unsafe historical rewrite fails', () => { const o = generated(plan(), '2026-06'); const repo = repository({ occurrences: [o] }); repo.updatePlan('fixed-test', { totalAmountMinor: 12000 }); errorCode(() => repo.generateOccurrence('fixed-test', '2026-06', { referenceDate: '2026-07-13' }), 'unsafe_historical_occurrence_rewrite'); });
add(79, 'stopping plan preserves occurrence history', () => { const repo = repository(); repo.generateOccurrence('fixed-test', '2026-07', { referenceDate: '2026-07-01' }); repo.stopPlan('fixed-test'); assert.equal(repo.listOccurrencesForPlan('fixed-test', '2026-07-13').length, 1); });
add(80, 'pausing plan preserves history', () => { const repo = repository(); repo.generateOccurrence('fixed-test', '2026-07', { referenceDate: '2026-07-01' }); repo.pausePlan('fixed-test'); assert.equal(repo.listOccurrencesForPlan('fixed-test', '2026-07-13').length, 1); });
add(81, 'resuming generates only explicitly requested future period', () => { const repo = repository(); repo.pausePlan('fixed-test'); repo.resumePlan('fixed-test'); repo.generateOccurrence('fixed-test', '2026-08', { referenceDate: '2026-07-13' }); assert.deepEqual(repo.listOccurrencesForPlan('fixed-test', '2026-07-13').map((o) => o.monthKey), ['2026-08']); });

// Repository 82–92.
add(82, 'repository create', () => { const repo = repository({ plans: [] }); assert.equal(repo.createPlan(rawPlan()).id, 'fixed-test'); });
add(83, 'repository update', () => { const repo = repository(); assert.equal(repo.updatePlan('fixed-test', { title: '已更新' }).title, '已更新'); });
add(84, 'repository pause', () => { const repo = repository(); assert.equal(repo.pausePlan('fixed-test').status, 'paused'); });
add(85, 'repository resume', () => { const repo = repository({ plans: [rawPlan({ status: 'paused' })] }); assert.equal(repo.resumePlan('fixed-test').status, 'active'); });
add(86, 'repository stop', () => { const repo = repository(); assert.equal(repo.stopPlan('fixed-test').status, 'stopped'); });
add(87, 'repository get by ID', () => assert.equal(repository().getPlan('fixed-test').title, BASE.title));
add(88, 'repository list plans', () => assert.equal(repository().listPlans().length, 1));
add(89, 'repository list monthly occurrences', () => { const repo = repository(); repo.generateOccurrence('fixed-test', '2026-07', { referenceDate: '2026-07-13' }); assert.equal(repo.listOccurrencesForMonth('2026-07', '2026-07-13').length, 1); });
add(90, 'repository list per-plan occurrences', () => { const repo = repository(); repo.generateOccurrence('fixed-test', '2026-07', { referenceDate: '2026-07-13' }); assert.equal(repo.listOccurrencesForPlan('fixed-test', '2026-07-13').length, 1); });
add(91, 'unknown ID structured error', () => errorCode(() => repository().updatePlan('missing', { title: 'x' }), 'unknown_plan'));
add(92, 'repository exposes no hard delete command', () => assert.equal(repository().deletePlan, undefined));

// Calendar duration 93–101.
add(93, 'duration under one month', () => assert.deepEqual(calendarDuration('2026-07-01', '2026-07-13'), { years: 0, months: 0, days: 12 }));
add(94, 'duration one month plus days', () => assert.deepEqual(calendarDuration('2026-06-01', '2026-07-13'), { years: 0, months: 1, days: 12 }));
add(95, 'duration over one year', () => assert.deepEqual(calendarDuration('2024-06-01', '2026-07-13'), { years: 2, months: 1, days: 12 }));
add(96, 'leap-year duration', () => assert.deepEqual(calendarDuration('2028-02-29', '2028-03-29'), { years: 0, months: 1, days: 0 }));
add(97, 'month-end move-in date', () => assert.deepEqual(calendarDuration('2026-01-31', '2026-02-28'), { years: 0, months: 1, days: 0 }));
add(98, 'duration does not approximate 30-day months', () => assert.deepEqual(calendarDuration('2026-02-28', '2026-03-31'), { years: 0, months: 1, days: 3 }));
add(99, 'negative duration rejected', () => errorCode(() => calendarDuration('2026-07-14', '2026-07-13'), 'negative_elapsed_duration'));
add(100, 'duration requires explicit reference date', () => errorCode(() => calendarDuration('2026-07-01'), 'invalid_duration_date'));
add(101, 'duration Chinese formatting', () => assert.equal(elapsedDurationChinese('2024-06-01', '2026-07-13', '已住 '), '已住 2年 1个月 12天'));

// Selectors 102–117.
const demoMonth = () => createDemoDataSource().getFixedCenterMonth('2026-07', '2026-07-13');
add(102, 'selector returns selected-month occurrences', () => assert.ok(demoMonth().rows.every((row) => row.monthKey === '2026-07')));
add(103, 'my fixed own-share total', () => assert.equal(demoMonth().summary.myFixedMinor, 181380));
add(104, 'paid own-share total', () => assert.equal(demoMonth().summary.paidOwnShareMinor, 1290));
add(105, 'pending own-share total', () => assert.equal(demoMonth().summary.pendingOwnShareMinor, 29490));
add(106, 'overdue own-share total', () => assert.equal(demoMonth().summary.overdueOwnShareMinor, 150600));
add(107, 'upcoming own-share total', () => assert.equal(demoMonth().summary.upcomingOwnShareMinor, 29490));
add(108, 'planned cash outflow total', () => assert.equal(demoMonth().summary.plannedCashOutflowMinor, 161980));
add(109, 'planned receivable total', () => assert.equal(demoMonth().summary.plannedReceivableMinor, 65600));
add(110, 'planned payable total', () => assert.equal(demoMonth().summary.plannedPayableMinor, 85000));
add(111, 'subscriptions filter', () => assert.ok(demoMonth().filters.subscriptions.some((p) => p.title === 'Netflix')));
add(112, 'fixed-expenses filter', () => assert.ok(demoMonth().filters.fixedExpenses.some((p) => p.title === '房租')));
add(113, 'relationship-recurring filter', () => assert.ok(demoMonth().filters.relationshipRecurring.some((p) => p.canonicalSource.sourceType === 'obligation_plan')));
add(114, 'paused filter', () => assert.deepEqual(demoMonth().filters.paused.map((p) => p.title), ['Spotify']));
add(115, 'stopped excluded from future active totals', () => assert.ok(!demoMonth().rows.some((row) => row.plan.title === '旧健身房会籍')));
add(116, 'skipped excluded from due totals', () => { const p = plan(); const o = { ...generated(p, '2026-07'), recordedStatus: 'skipped', status: 'skipped' }; assert.equal(selectRecurringMonth({ plans: [p], occurrences: [o], monthKey: '2026-07', referenceDate: '2026-07-13' }).summary.myFixedMinor, 0); });
add(117, 'no projection double count', () => assert.equal(dedupeCanonicalOccurrences(demoMonth().rows).length, demoMonth().rows.length));

// Today integration 118–126.
add(118, 'Today 我的固定 uses selector', () => assert.equal(createDemoDataSource().getPulse().myFixed, demoMonth().summary.myFixedMinor / 100));
add(119, 'Today uses own share not full shared bill', () => { const rent = demoMonth().rows.find((row) => row.plan.id === 'fixed-rent-shared'); assert.deepEqual([rent.ownShareMinor, rent.totalAmountMinor], [65600, 131200]); });
add(120, 'ordinary credit-card purchase excluded', () => assert.ok(!demoMonth().rows.some((row) => row.planKind === 'expense')));
add(121, 'subscription included once', () => assert.equal(demoMonth().rows.filter((row) => row.plan.title === 'Netflix').length, 1));
add(122, 'relationship recurring included once', () => assert.equal(demoMonth().rows.filter((row) => row.plan.planKind === 'recurring_relationship').length, 1));
add(123, 'paused plan excluded from commitment total', () => assert.ok(!demoMonth().rows.some((row) => row.plan.title === 'Spotify')));
add(124, 'paid current-month item stays in commitment', () => assert.ok(demoMonth().rows.some((row) => row.plan.title === 'iCloud+' && row.status === 'paid')));
add(125, 'Today entry opens Fixed Center', () => assert.match(read('src/features/today/index.js'), /data-action="fixed-center-open"/));
add(126, 'no sixth bottom tab', () => assert.equal((read('src/app/shell.js').match(/data-tab=/g) || []).length <= 5, true));

// Read-only center 127–149.
const fixedSource = () => read('src/features/fixed/index.js');
const fixedCSS = () => read('src/styles/phase2c1.css');
add(127, 'center route and view', () => assert.match(read('src/app/router.js'), /todayView.*fixed/));
add(128, 'current month heading', () => assert.match(fixedSource(), /monthTitle\(selectedMonth\)/));
add(129, 'previous month action', () => assert.match(fixedSource(), /fixed-month-prev/));
add(130, 'next month action', () => assert.match(fixedSource(), /fixed-month-next/));
add(131, 'return-current-month action', () => assert.match(fixedSource(), /fixed-month-current/));
add(132, 'summary own-share values', () => assert.match(fixedSource(), /summary\.myFixedMinor/));
add(133, 'overdue section', () => assert.match(fixedSource(), /section\(COPY\.overdue/));
add(134, 'due-soon section', () => assert.match(fixedSource(), /section\(COPY\.dueSoon/));
add(135, 'paid section', () => assert.match(fixedSource(), /section\(COPY\.completed/));
add(136, 'paused section', () => assert.match(fixedSource(), /sections\.pausedPlans/));
add(137, 'empty sections are omitted', () => assert.match(fixedSource(), /if \(!rows\.length\) return ''/));
add(138, 'rent card data exists', () => assert.ok(demoMonth().rows.some((row) => row.plan.title === '房租')));
add(139, 'subscription card data exists', () => assert.ok(demoMonth().rows.some((row) => row.plan.planKind === 'subscription')));
add(140, 'relationship projection card exists', () => assert.ok(demoMonth().rows.some((row) => row.plan.planKind === 'recurring_relationship')));
add(141, 'move-in duration is rendered', () => assert.match(fixedSource(), /elapsedDurationChinese/));
add(142, 'payment source label is rendered', () => assert.match(fixedSource(), /data\.getAccount\(plan\.paymentSourceAccountId\)/));
add(143, 'full amount only when different', () => assert.match(fixedSource(), /row\.totalAmountMinor !== row\.ownShareMinor/));
add(144, 'center has no fake Pay button', () => assert.doesNotMatch(fixedSource(), /立即付款|记录付款/));
add(145, 'center has no fake Delete button', () => assert.doesNotMatch(fixedSource(), /删除计划|data-action="fixed-delete/));
add(146, 'mobile rows are keyboard accessible', () => assert.match(fixedSource(), /tabindex="0"/));
add(147, 'dark mode styling exists', () => assert.match(fixedCSS(), /data-theme="dark"/));
add(148, 'reduced-motion contract exists', () => assert.match(fixedCSS(), /prefers-reduced-motion/));
add(149, 'center constrains horizontal layout', () => assert.match(fixedCSS(), /min-width:\s*0/));

// Regression and prohibited boundaries 150–170.
const allSource = () => moduleFiles('src').map((path) => read(path)).join('\n');
add(150, 'all previous tests remain discoverable', () => assert.match(read('package.json'), /tests\/\*\.test\.mjs/));
add(151, 'Assets source remains present', () => assert.ok(read('src/features/assets/index.js').length > 1000));
add(152, 'Capture source remains present', () => assert.ok(read('src/components/CaptureSheet.js').length > 1000));
add(153, 'Relationship source remains present', () => assert.ok(read('src/features/ledger/index.js').includes('关系账')));
add(154, 'split calculator remains present', () => assert.ok(read('src/components/MoneyCalculatorSheet.js').includes('calculator')));
add(155, 'Confirmation remains present', () => assert.ok(read('src/components/MoneyFlowConfirmation.js').includes('confirmation')));
add(156, 'continuous balance motion remains present', () => assert.ok(read('src/components/MoneyFlowConfirmation.js').includes('balance')));
add(157, 'account capacity remains present', () => assert.ok(read('src/domain/accountCapacity.js').length > 100));
add(158, 'credit-limit behavior remains present', () => assert.match(read('src/domain/accountCapacity.js'), /credit/i));
add(159, 'attachment behavior remains present', () => assert.ok(read('src/domain/attachmentRepository.js').length > 100));
add(160, 'Record Detail remains present', () => assert.ok(read('src/features/activity/index.js').includes('transaction')));
add(161, 'Ledger existing plan actions remain present', () => assert.match(read('src/features/ledger/index.js'), /obligation-plan-detail/));
add(162, 'obligation engine remains present', () => assert.ok(read('src/domain/obligationEngine.js').length > 1000));
add(163, 'Phase 2C1 adds no executable network client', () => assert.doesNotMatch([read('src/domain/recurringPlanModel.js'), read('src/domain/recurringPlanRepository.js'), read('src/features/fixed/index.js')].join('\n'), /\bfetch\s*\(|XMLHttpRequest|WebSocket/));
add(164, 'Phase 2C1 adds no localStorage', () => assert.doesNotMatch(allSource(), /localStorage/));
add(165, 'Phase 2C1 adds no sessionStorage', () => assert.doesNotMatch(allSource(), /sessionStorage/));
add(166, 'Phase 2C1 adds no IndexedDB', () => assert.doesNotMatch(allSource(), /indexedDB|IndexedDB/));
add(167, 'Phase 2C1 adds no Supabase', () => assert.doesNotMatch(allSource(), /createClient\s*\(|@supabase/));
add(168, 'Phase 2C1 adds no Telegram execution', () => assert.doesNotMatch([fixedSource(), read('src/domain/recurringPlanRepository.js')].join('\n'), /telegram\.|sendTelegram|TelegramClient/));
add(169, 'Fixed Center performs no financial posting', () => assert.doesNotMatch(fixedSource(), /createTransaction|postTransaction|applyTransaction|recordPayment/));
add(170, 'Phase 2C1 scripts do not touch port 8788', () => assert.doesNotMatch([fixedSource(), read('src/domain/recurringPlanRepository.js'), read('src/domain/recurringSchedule.js')].join('\n'), /8788/));

assert.equal(cases.length, 170, 'Phase 2C1 numbered coverage must remain complete');
cases.forEach(([id, name, fn]) => test(`2C1-${String(id).padStart(3, '0')}: ${name}`, fn));
