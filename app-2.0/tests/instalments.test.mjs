import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { installmentPlanOverview } from '../src/domain/obligationSelectors.js';

const TODAY = '2026-07-13';
const cmd = (overrides = {}) => ({ sourceChannel: 'app', clientEventId: `inst-${Math.random()}`, date: TODAY, time: '11:00', ...overrides });

function newInstallment(data, overrides = {}) {
  return data.createObligationPlan(cmd({
    planType: 'installment', ledgerId: 'ledger-sis', creditorParticipantId: 'participant-sis',
    debtorParticipantId: 'participant-me', title: 'Shopee 测试分期', merchant: 'Shopee LatePay',
    totalRepayable: 1200, termCount: 6, dueDay: 15, startDate: '2026-07-01', defaultAccountId: 'sv-mbb', ...overrides,
  }));
}

test('EA: creation generates the exact finite schedule and does not deduct any account', () => {
  const data = createDemoDataSource();
  const before = data.getAccount('sv-mbb').balance;
  const plan = newInstallment(data);
  const instances = data.getObligationInstances(plan.planId);
  assert.equal(instances.length, 6);
  assert.deepEqual(instances.map((instance) => instance.termNumber), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(instances.map((instance) => instance.amountDueMinor), [20000, 20000, 20000, 20000, 20000, 20000]);
  assert.equal(instances.at(-1).periodKey, '2026-12');
  assert.equal(data.getAccount('sv-mbb').balance, before);
  assert.equal(plan.remainingBalanceMinor, 120000);
});

test('EB: final term absorbs deterministic rounding with no negative remainder', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data, { totalRepayable: 1000, termCount: 3, clientEventId: 'eb-plan' });
  const instances = data.getObligationInstances(plan.planId);
  assert.deepEqual(instances.map((instance) => instance.amountDueMinor), [33333, 33333, 33334]);
  assert.equal(instances.reduce((sum, instance) => sum + instance.amountDueMinor, 0), 100000);
});

test('EC: partial term payment and multiple payments per term deduct exactly once each', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data);
  const before = data.getAccount('sv-mbb').balance;
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 80, sourceAccountId: 'sv-mbb', clientEventId: 'ec-1' }));
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 120, sourceAccountId: 'sv-mbb', clientEventId: 'ec-2' }));
  const term1 = data.getObligationInstances(plan.planId)[0];
  assert.equal(term1.status, 'paid');
  assert.equal(term1.amountPaidMinor, 20000);
  assert.equal(data.getAccount('sv-mbb').balance, before - 200);
  const updated = data.getObligationPlan(plan.planId);
  assert.equal(updated.currentTerm, 2);
  assert.equal(updated.remainingBalanceMinor, 100000);
});

test('ED: overpayment beyond remaining balance is refused', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data);
  assert.throws(() => data.recordObligationPayment(cmd({ planId: plan.planId, amount: 1201, sourceAccountId: 'sv-mbb', clientEventId: 'ed-over' })), /超过/);
});

test('EE: full repayment auto-completes the plan and no further terms remain', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data, { totalRepayable: 300, termCount: 2, clientEventId: 'ee-plan' });
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 300, sourceAccountId: 'sv-mbb', clientEventId: 'ee-pay' }));
  const completed = data.getObligationPlan(plan.planId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.remainingBalanceMinor, 0);
  assert.equal(data.getObligationInstances(plan.planId).every((instance) => instance.status === 'paid'), true);
  assert.throws(() => data.recordObligationPayment(cmd({ planId: plan.planId, amount: 1, sourceAccountId: 'sv-mbb', clientEventId: 'ee-more' })), /已完成/);
});

test('EF: early payoff settles remaining balance and emits installment.early_settled', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data);
  const before = data.getAccount('sv-mbb').balance;
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 200, sourceAccountId: 'sv-mbb', clientEventId: 'ef-term1' }));
  data.earlySettleInstallment(cmd({ planId: plan.planId, sourceAccountId: 'sv-mbb', clientEventId: 'ef-early' }));
  const completed = data.getObligationPlan(plan.planId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.remainingBalanceMinor, 0);
  assert.equal(data.getAccount('sv-mbb').balance, before - 1200);
  assert.equal(data.getIntegrationOutbox().some((event) => event.eventType === 'installment.early_settled' && event.entityId === plan.planId), true);
});

test('EG: payment reversal restores remaining balance, term state, and completion status', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data, { totalRepayable: 400, termCount: 2, clientEventId: 'eg-plan' });
  const before = data.getAccount('sv-mbb').balance;
  const { payment } = data.recordObligationPayment(cmd({ planId: plan.planId, amount: 400, sourceAccountId: 'sv-mbb', clientEventId: 'eg-pay' }));
  assert.equal(data.getObligationPlan(plan.planId).status, 'completed');
  data.reverseObligationPayment(payment.paymentId, cmd({ clientEventId: 'eg-reverse' }));
  const restored = data.getObligationPlan(plan.planId);
  assert.equal(restored.status, 'active');
  assert.equal(restored.remainingBalanceMinor, 40000);
  assert.equal(data.getAccount('sv-mbb').balance, before);
  assert.equal(data.getIntegrationOutbox().some((event) => event.eventType === 'installment.payment.reversed'), true);
});

test('EH: editing total/terms after payments requires reversal first; titles stay editable', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data);
  data.recordObligationPayment(cmd({ planId: plan.planId, amount: 100, sourceAccountId: 'sv-mbb', clientEventId: 'eh-pay' }));
  assert.throws(() => data.updateObligationPlan(plan.planId, { totalRepayableMinor: 100000 }, cmd({ clientEventId: 'eh-edit' })), /撤销/);
  const renamed = data.updateObligationPlan(plan.planId, { title: '新名字' }, cmd({ clientEventId: 'eh-rename' }));
  assert.equal(renamed.title, '新名字');
});

test('EI: fixture Shopee plan reflects one paid term and derives overview correctly', () => {
  const data = createDemoDataSource();
  const plan = data.getObligationPlan('plan-shopee-sis');
  const overview = installmentPlanOverview(plan, data.getObligationInstances(plan.planId), TODAY);
  assert.equal(overview.currentTerm, 2);
  assert.equal(overview.termCount, 6);
  assert.equal(overview.paidMinor, 20000);
  assert.equal(overview.remainingMinor, 100000);
  assert.equal(overview.nextDueDate, '2026-07-15');
  assert.equal(overview.dueThisMonthMinor, 20000);
});

test('EJ: discarding an unused draft plan keeps paid history plans protected', () => {
  const data = createDemoDataSource();
  const draft = newInstallment(data, { clientEventId: 'ej-draft' });
  data.discardObligationPlan(draft.planId, cmd({ clientEventId: 'ej-discard' }));
  assert.equal(data.getObligationPlans().some((plan) => plan.planId === draft.planId), false);
  assert.throws(() => data.discardObligationPlan('plan-shopee-sis', cmd({ clientEventId: 'ej-protected' })), /结束计划/);
  assert.equal(data.getObligationInstances('plan-shopee-sis').find((instance) => instance.termNumber === 1).status, 'paid');
});

test('EK: explicit principal and fee produce one canonical total', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data, { principal: 999.99, fee: 25.01, totalRepayable: 1025, clientEventId: 'ek-plan' });
  assert.equal(plan.principalMinor, 99999);
  assert.equal(plan.feeMinor, 2501);
  assert.equal(plan.totalRepayableMinor, 102500);
  assert.equal(data.getObligationInstances(plan.planId).reduce((sum, item) => sum + item.amountDueMinor, 0), 102500);
  assert.throws(() => newInstallment(data, { principal: 1000, fee: 10, totalRepayable: 1000, clientEventId: 'ek-invalid' }), /本金加费用/);
});

test('EL: repeated early-settlement client event stays idempotent', () => {
  const data = createDemoDataSource();
  const plan = newInstallment(data, { totalRepayable: 300, termCount: 3, clientEventId: 'el-plan' });
  const before = data.getAccount('sv-mbb').balance;
  const command = cmd({ planId: plan.planId, sourceAccountId: 'sv-mbb', clientEventId: 'el-early' });
  const first = data.earlySettleInstallment(command);
  const second = data.earlySettleInstallment(command);
  assert.equal(second.payment.paymentId, first.payment.paymentId);
  assert.equal(data.getAccount('sv-mbb').balance, before - 300);
  assert.equal(data.getIntegrationOutbox().filter((event) => event.eventType === 'installment.early_settled' && event.entityId === plan.planId).length, 1);
});
