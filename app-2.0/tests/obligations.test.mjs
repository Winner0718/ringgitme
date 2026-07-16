import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { instanceState, monthlyPlanOverview, overduePlans, planProjection } from '../src/domain/obligationSelectors.js';
import { installmentSchedule, dueDateFor, addMonths } from '../src/domain/scheduleGenerator.js';

const TODAY = '2026-07-13';
const cmd = (overrides = {}) => ({ sourceChannel: 'app', clientEventId: `obl-${Math.random()}`, date: TODAY, time: '10:00', ...overrides });

function newMonthlyPlan(data, overrides = {}) {
  return data.createObligationPlan(cmd({
    planType: 'recurring_monthly', ledgerId: 'ledger-sis', creditorParticipantId: 'participant-sis',
    debtorParticipantId: 'participant-me', title: '测试月付', amount: 120, dueDay: 10, startDate: '2026-07-01',
    defaultAccountId: 'sv-mbb', ...overrides,
  }));
}

test('DA: plan creation is canonical, idempotent, and never touches accounts', () => {
  const data = createDemoDataSource();
  const before = data.getAccount('sv-mbb').balance;
  const command = cmd({ planType: 'recurring_monthly', ledgerId: 'ledger-sis', creditorParticipantId: 'participant-sis', debtorParticipantId: 'participant-me', title: '重复创建', amount: 55, dueDay: 5, startDate: '2026-07-01', clientEventId: 'da-create' });
  const first = data.createObligationPlan(command);
  const second = data.createObligationPlan(command);
  assert.equal(second.planId, first.planId);
  assert.equal(data.getObligationPlans({ ledgerId: 'ledger-sis' }).filter((plan) => plan.title === '重复创建').length, 1);
  assert.equal(data.getAccount('sv-mbb').balance, before);
  assert.equal(data.getIntegrationOutbox().filter((event) => event.eventType === 'obligation.plan.created' && event.entityId === first.planId).length, 1);
});

test('DB: one instance per month — duplicate generation refuses to duplicate', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data);
  const first = data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  const second = data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  assert.equal(second.instanceId, first.instanceId);
  assert.equal(data.getObligationInstances(plan.planId).length, 1);
  assert.equal(first.dueDate, '2026-07-10');
  const next = data.generateObligationInstance(plan.planId, {});
  assert.equal(next.periodKey, '2026-08');
});

test('DC: partial then full payment settles the month and deducts the account once each', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data);
  data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  const before = data.getAccount('sv-mbb').balance;
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 50, sourceAccountId: 'sv-mbb', clientEventId: 'dc-partial' }));
  let instance = data.getObligationInstances(plan.planId)[0];
  assert.equal(instance.amountPaidMinor, 5000);
  assert.equal(instance.status, 'partial');
  assert.equal(data.getAccount('sv-mbb').balance, before - 50);
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 70, sourceAccountId: 'sv-mbb', clientEventId: 'dc-full' }));
  instance = data.getObligationInstances(plan.planId)[0];
  assert.equal(instance.status, 'paid');
  assert.equal(data.getAccount('sv-mbb').balance, before - 120);
  assert.throws(() => data.recordObligationPayment(cmd({ planId: plan.planId, amount: 1, sourceAccountId: 'sv-mbb', clientEventId: 'dc-over' })), /超过/);
});

test('DD: repeated payment clientEventId is idempotent for balances and records', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data);
  data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  const before = data.getAccount('sv-mbb').balance;
  const command = cmd({ planId: plan.planId, amount: 40, sourceAccountId: 'sv-mbb', clientEventId: 'dd-once' });
  const first = data.recordObligationPayment(command);
  const second = data.recordObligationPayment(command);
  assert.equal(second.payment.paymentId, first.payment.paymentId);
  assert.equal(data.getAccount('sv-mbb').balance, before - 40);
  assert.equal(data.getObligationPayments(plan.planId).length, 1);
});

test('DE: overdue/due/upcoming/partial/paid selectors derive from instances', () => {
  const data = createDemoDataSource();
  const instances = data.getObligationInstances('plan-rent-sis');
  assert.equal(instanceState(instances.find((instance) => instance.periodKey === '2026-05'), TODAY), 'paid');
  assert.equal(instanceState(instances.find((instance) => instance.periodKey === '2026-07'), TODAY), 'overdue');
  const overview = monthlyPlanOverview(data.getObligationPlan('plan-rent-sis'), instances, TODAY);
  assert.equal(overview.current.periodKey, '2026-07');
  assert.equal(overview.nextPreview.periodKey, '2026-08');
  assert.equal(overview.nextPreview.dueDate, '2026-08-07');
  const overdue = overduePlans(data.getObligationPlans({ planType: 'recurring_monthly' }), (planId) => data.getObligationInstances(planId), TODAY);
  assert.equal(overdue.some((plan) => plan.planId === 'plan-rent-sis'), true);
});

test('DF: pause prevents generation, resume continues from a valid month, stop is permanent', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data);
  data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  data.pauseObligationPlan(plan.planId, cmd({ clientEventId: 'df-pause' }));
  assert.throws(() => data.generateObligationInstance(plan.planId, { periodKey: '2026-08' }), /暂停/);
  data.resumeObligationPlan(plan.planId, cmd({ clientEventId: 'df-resume', date: '2026-09-02' }));
  assert.throws(() => data.generateObligationInstance(plan.planId, { periodKey: '2026-08' }), /补生成/);
  const next = data.generateObligationInstance(plan.planId, {});
  assert.equal(next.periodKey, '2026-09');
  data.stopObligationPlan(plan.planId, cmd({ clientEventId: 'df-stop' }));
  assert.throws(() => data.generateObligationInstance(plan.planId, {}), /暂停或已结束/);
  assert.throws(() => data.resumeObligationPlan(plan.planId, cmd({ clientEventId: 'df-resume-2' })), /不允许/);
  const events = data.getIntegrationOutbox().map((event) => event.eventType);
  ['obligation.plan.paused', 'obligation.plan.resumed', 'obligation.plan.stopped'].forEach((type) => assert.equal(events.includes(type), true));
});

test('DG: payment reversal restores account balance and remaining exactly once', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data);
  data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  const before = data.getAccount('sv-mbb').balance;
  const { payment } = data.recordObligationPayment(cmd({ planId: plan.planId, amount: 120, sourceAccountId: 'sv-mbb', clientEventId: 'dg-pay' }));
  data.reverseObligationPayment(payment.paymentId, cmd({ clientEventId: 'dg-reverse' }));
  assert.equal(data.getAccount('sv-mbb').balance, before);
  assert.equal(data.getObligationInstances(plan.planId)[0].amountPaidMinor, 0);
  const again = data.reverseObligationPayment(payment.paymentId, cmd({ clientEventId: 'dg-reverse' }));
  assert.equal(again.status, 'reversed');
  assert.equal(data.getAccount('sv-mbb').balance, before);
  const event = data.getIntegrationOutbox().find((item) => item.eventType === 'obligation.payment.reversed');
  assert.equal(event.payload.originalPaymentId, payment.paymentId);
});

test('DH: editing a future plan never silently rewrites historical paid months', () => {
  const data = createDemoDataSource();
  const paidMay = data.getObligationInstances('plan-rent-sis').find((instance) => instance.periodKey === '2026-05');
  data.updateObligationPlan('plan-rent-sis', { amountMinor: 90000 }, cmd({ clientEventId: 'dh-update' }));
  const after = data.getObligationInstances('plan-rent-sis');
  assert.deepEqual(after.find((instance) => instance.periodKey === '2026-05').amountDueMinor, paidMay.amountDueMinor);
  assert.equal(after.find((instance) => instance.periodKey === '2026-07').amountDueMinor, 90000);
  const plan = data.getObligationPlan('plan-rent-sis');
  assert.equal(plan.history.at(-1).action, 'updated');
  assert.equal(plan.revision > 1, true);
});

test('DI: canonical plan exposes projection metadata without duplicating data', () => {
  const data = createDemoDataSource();
  const plan = data.getObligationPlan('plan-rent-sis');
  const projection = planProjection(plan);
  assert.equal(projection.planId, plan.planId);
  assert.equal(projection.fixedCenterEligible, true);
  assert.deepEqual(Object.keys(projection).sort(), ['direction', 'fixedCenterEligible', 'ledgerId', 'planId', 'planType', 'surfaces']);
  assert.equal('amountMinor' in projection, false);
  assert.equal('instances' in projection, false);
});

test('DJ: schedule math is deterministic across period boundaries', () => {
  assert.equal(dueDateFor('2026-02', 31), '2026-02-28');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  const schedule = installmentSchedule({ totalRepayableMinor: 100000, termCount: 3, startDate: '2026-12-05', dueDay: 31 });
  assert.deepEqual(schedule.map((term) => term.amountDueMinor), [33333, 33333, 33334]);
  assert.deepEqual(schedule.map((term) => term.dueDate), ['2026-12-31', '2027-01-31', '2027-02-28']);
});

test('DK: reset restores plans, instances, payments and event log exactly', () => {
  const data = createDemoDataSource();
  const initialPlans = data.getObligationPlans();
  const initialInstances = data.getObligationInstances('plan-rent-sis');
  const plan = newMonthlyPlan(data);
  data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 10, sourceAccountId: 'sv-mbb', clientEventId: 'dk-pay' }));
  data.resetDemoData();
  assert.deepEqual(data.getObligationPlans(), initialPlans);
  assert.deepEqual(data.getObligationInstances('plan-rent-sis'), initialInstances);
  assert.deepEqual(data.getIntegrationOutbox(), []);
});

test('DL: telegram/app_to_app sourced obligation events are represented without networking', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data, { clientEventId: 'dl-plan', sourceChannel: 'telegram' });
  data.generateObligationInstance(plan.planId, { periodKey: '2026-07' });
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 20, sourceAccountId: 'sv-mbb', recordOnly: true, clientEventId: 'dl-pay', sourceChannel: 'app_to_app' }));
  const events = data.getIntegrationOutbox();
  assert.equal(events.some((event) => event.eventType === 'obligation.plan.created' && event.sourceChannel === 'telegram'), true);
  assert.equal(events.some((event) => event.eventType === 'obligation.payment.recorded' && event.sourceChannel === 'app_to_app'), true);
  const ordered = events.map((event) => event.eventId);
  assert.deepEqual([...ordered].sort(), ordered);
});

test('DM: monthly plan keeps end date, reminder, attachments and exact creation time', () => {
  const data = createDemoDataSource();
  const plan = newMonthlyPlan(data, {
    clientEventId: 'dm-plan', endDate: '2026-12-31', reminder: { enabled: true, offsetDays: 1, channel: 'local' },
    attachmentIds: ['att-proof'], occurredAt: '2026-07-13T21:47:00+08:00',
  });
  assert.equal(plan.endDate, '2026-12-31');
  assert.deepEqual(plan.reminder, { enabled: true, offsetDays: 1, channel: 'local' });
  assert.deepEqual(plan.attachmentIds, ['att-proof']);
  assert.equal(plan.createdAt, '2026-07-13T21:47:00+08:00');
  assert.throws(() => newMonthlyPlan(data, { clientEventId: 'dm-invalid', startDate: '2026-08-01', endDate: '2026-07-31' }), /结束日期/);
});
