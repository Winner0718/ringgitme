import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const draft = (data, values) => ({
  catId: 'grocery',
  catLabel: '日用',
  category: '日用',
  date: data.today,
  time: '10:30',
  ...values,
});

test('A: savings expense applies once and deletion restores values', () => {
  const data = createDemoDataSource();
  const balance = data.getAccount('sv-mbb').balance;
  const cash = data.getPulse().currentCash;
  const transaction = data.addTransaction(draft(data, {
    kind: 'expense', amount: 25.9, desc: 'Mr DIY', sourceAccountId: 'sv-mbb',
  }));
  assert.equal(data.getAccount('sv-mbb').balance, balance - 25.9);
  assert.equal(data.getPulse().currentCash, cash - 25.9);
  assert.equal(data.getActivities().filter((item) => item.id === transaction.id).length, 1);
  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount('sv-mbb').balance, balance);
  assert.equal(data.getPulse().currentCash, cash);
  assert.equal(data.getActivities().some((item) => item.id === transaction.id), false);
});

test('B: income edit applies only the delta, records history, and deletes cleanly', () => {
  const data = createDemoDataSource();
  const balance = data.getAccount('sv-cimb').balance;
  const cash = data.getPulse().currentCash;
  const transaction = data.addTransaction(draft(data, {
    kind: 'income', amount: 1000, desc: 'Salary', destinationAccountId: 'sv-cimb', catLabel: '收入',
  }));
  assert.equal(data.getAccount('sv-cimb').balance, balance + 1000);
  data.editTransaction(transaction.id, { amount: 1200, desc: 'Salary - July' });
  assert.equal(data.getAccount('sv-cimb').balance, balance + 1200);
  assert.equal(data.getPulse().currentCash, cash + 1200);
  const edited = data.getTransaction(transaction.id);
  assert.equal(edited.revision, 2);
  assert.equal(edited.desc, 'Salary - July');
  assert.equal(edited.editHistory[0].oldAmount, 1000);
  assert.equal(edited.editHistory[0].newAmount, 1200);
  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount('sv-cimb').balance, balance);
});

test('C: transfer preserves total cash and reverses both account effects', () => {
  const data = createDemoDataSource();
  const source = data.getAccount('sv-mbb').balance;
  const destination = data.getAccount('ew-tng').balance;
  const cash = data.getPulse().currentCash;
  const transaction = data.transferFunds(draft(data, {
    amount: 100, desc: 'Wallet top-up', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng',
  }));
  assert.equal(data.getAccount('sv-mbb').balance, source - 100);
  assert.equal(data.getAccount('ew-tng').balance, destination + 100);
  assert.equal(data.getPulse().currentCash, cash);
  assert.equal(data.getActivities().filter((item) => item.id === transaction.id).length, 1);
  data.reverseTransaction(transaction.id);
  assert.equal(data.getAccount('sv-mbb').balance, source);
  assert.equal(data.getAccount('ew-tng').balance, destination);
});

test('D: credit-card expense updates outstanding, available credit, and debt', () => {
  const data = createDemoDataSource();
  const card = data.getAccount('cc-mbb-visa');
  const outstanding = card.outstanding;
  const available = card.availableCredit;
  const debt = data.getPulse().totalCardDebt;
  const transaction = data.addTransaction(draft(data, {
    kind: 'expense', amount: 50, desc: 'Fuel', sourceAccountId: card.id,
  }));
  assert.equal(data.getAccount(card.id).outstanding, outstanding + 50);
  assert.equal(data.getAccount(card.id).availableCredit, available - 50);
  assert.equal(data.getPulse().totalCardDebt, debt + 50);
  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount(card.id).outstanding, outstanding);
  assert.equal(data.getAccount(card.id).availableCredit, available);
  assert.equal(data.getPulse().totalCardDebt, debt);
});

test('E: record-only expense never changes balances', () => {
  const data = createDemoDataSource();
  const balance = data.getAccount('sv-mbb').balance;
  const debt = data.getPulse().totalCardDebt;
  const transaction = data.addTransaction(draft(data, {
    kind: 'expense', amount: 300, desc: 'Cash note', sourceAccountId: 'sv-mbb', recordOnly: true,
  }));
  assert.equal(data.getAccount('sv-mbb').balance, balance);
  assert.equal(data.getPulse().totalCardDebt, debt);
  assert.equal(data.getTransaction(transaction.id).recordOnly, true);
  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount('sv-mbb').balance, balance);
});

test('F: repeated submission key returns one transaction and one effect', () => {
  const data = createDemoDataSource();
  const balance = data.getAccount('sv-mbb').balance;
  const values = draft(data, {
    kind: 'expense', amount: 25.9, desc: 'Double tap', sourceAccountId: 'sv-mbb', submissionKey: 'same-save',
  });
  const first = data.addTransaction(values);
  const second = data.addTransaction(values);
  assert.equal(second.id, first.id);
  assert.equal(data.getAccount('sv-mbb').balance, balance - 25.9);
  assert.equal(data.getActivities().filter((item) => item.id === first.id).length, 1);
});

test('G: same-account transfer is rejected without state changes', () => {
  const data = createDemoDataSource();
  const snapshot = data.getPulse();
  assert.throws(() => data.transferFunds(draft(data, {
    amount: 100, desc: 'Invalid', sourceAccountId: 'sv-mbb', destinationAccountId: 'sv-mbb',
  })), /不能相同/);
  assert.deepEqual(data.getPulse(), snapshot);
});

test('H: reset restores the complete baseline snapshot', () => {
  const data = createDemoDataSource();
  const pulse = data.getPulse();
  const accounts = structuredClone(data.getAccounts());
  const baselineCount = data.getActivities().length;
  data.addTransaction(draft(data, { kind: 'expense', amount: 25, desc: 'One', sourceAccountId: 'sv-mbb' }));
  data.addTransaction(draft(data, { kind: 'income', amount: 1200, desc: 'Two', destinationAccountId: 'sv-cimb', catLabel: '收入' }));
  data.resetDemoData();
  assert.deepEqual(data.getPulse(), pulse);
  assert.deepEqual(data.getAccounts(), accounts);
  assert.equal(data.getActivities().length, baselineCount);
});
