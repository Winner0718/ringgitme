import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoneyEngine, toMinor } from '../src/domain/moneyEngine.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

function baseline(data, predicate, label) {
  const transaction = data.getActivities().find((item) => item.origin === 'fixture' && predicate(item));
  assert.ok(transaction, `missing baseline ${label}`);
  assert.deepEqual(data.getTransactionMutationPolicy(transaction), { canEdit: true, canDelete: true, reason: '' });
  return transaction;
}

test('I: ordinary baseline records are mutable regardless of fixture origin', () => {
  const data = createDemoDataSource();
  const ordinary = data.getActivities().filter((item) => item.origin === 'fixture');
  assert.ok(ordinary.length > 70);
  ordinary.forEach((transaction) => {
    assert.equal(data.getTransactionMutationPolicy(transaction).canEdit, true, transaction.id);
    assert.equal(data.getTransactionMutationPolicy(transaction).canDelete, true, transaction.id);
  });
});

test('J: baseline eWallet expense edits by delta and deletion restores the full effect once', () => {
  const data = createDemoDataSource();
  const transaction = baseline(data, (item) => item.desc === 'TNB 电费' && item.amount === 112, 'TNB expense');
  const account = data.getAccount(transaction.sourceAccountId);
  assert.equal(account.id, 'ew-tng');
  const startingBalance = account.balance;
  const startingCash = data.getPulse().currentCash;

  const edited = data.editTransaction(transaction.id, { amount: 120, desc: 'TNB 电费（已更新）' });
  assert.equal(data.getAccount(account.id).balance, startingBalance - 8);
  assert.equal(data.getPulse().currentCash, startingCash - 8);
  assert.equal(edited.revision, 2);
  assert.equal(edited.editHistory.length, 1);
  assert.equal(edited.editHistory[0].oldAmount, 112);
  assert.equal(edited.editHistory[0].newAmount, 120);
  assert.equal(edited.editHistory[0].oldDescription, 'TNB 电费');
  assert.equal(edited.editHistory[0].newDescription, 'TNB 电费（已更新）');

  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount(account.id).balance, startingBalance + 112);
  assert.equal(data.getPulse().currentCash, startingCash + 112);
  const afterDelete = data.getAccount(account.id).balance;
  assert.throws(() => data.deleteTransaction(transaction.id), /已经删除/);
  assert.equal(data.getAccount(account.id).balance, afterDelete);
});

test('K: baseline credit expense keeps outstanding, available credit, and debt consistent', () => {
  const data = createDemoDataSource();
  const transaction = baseline(data, (item) => item.desc === 'Grab 车费' && item.amount === 59.9, 'card expense');
  const card = data.getAccount(transaction.sourceAccountId);
  assert.equal(card.type, 'cc');
  const startingOutstanding = card.outstanding;
  const startingAvailable = card.availableCredit;
  const startingDebt = data.getPulse().totalCardDebt;

  data.editTransaction(transaction.id, { amount: 79.9, desc: 'Grab 车费（已更新）' });
  assert.equal(data.getAccount(card.id).outstanding, startingOutstanding + 20);
  assert.equal(data.getAccount(card.id).availableCredit, startingAvailable - 20);
  assert.equal(data.getPulse().totalCardDebt, startingDebt + 20);

  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount(card.id).outstanding, startingOutstanding - 59.9);
  assert.equal(data.getAccount(card.id).availableCredit, startingAvailable + 59.9);
  assert.equal(data.getPulse().totalCardDebt, startingDebt - 59.9);
});

test('L: baseline income edits by delta and deletion removes the original credit', () => {
  const data = createDemoDataSource();
  const transaction = baseline(data, (item) => item.kind === 'income' && data.getAccount(item.destinationAccountId)?.type !== 'cc', 'income');
  const account = data.getAccount(transaction.destinationAccountId);
  const startingBalance = account.balance;
  const startingCash = data.getPulse().currentCash;
  const updatedAmount = transaction.amount + 30;

  data.editTransaction(transaction.id, { amount: updatedAmount, desc: `${transaction.desc}（已更新）` });
  assert.equal(data.getAccount(account.id).balance, startingBalance + 30);
  assert.equal(data.getPulse().currentCash, startingCash + 30);
  data.deleteTransaction(transaction.id);
  assert.equal(data.getAccount(account.id).balance, startingBalance - transaction.amount);
  assert.equal(data.getPulse().currentCash, startingCash - transaction.amount);
});

test('M: baseline transfer edits both sides, stays cash-neutral, and reverses once', () => {
  const data = createDemoDataSource();
  const transaction = baseline(data, (item) => item.kind === 'transfer', 'transfer');
  const source = data.getAccount(transaction.sourceAccountId);
  const destination = data.getAccount(transaction.destinationAccountId);
  assert.notEqual(source.id, destination.id);
  assert.notEqual(source.type, 'cc');
  assert.notEqual(destination.type, 'cc');
  const sourceBalance = source.balance;
  const destinationBalance = destination.balance;
  const startingCash = data.getPulse().currentCash;

  data.editTransaction(transaction.id, { amount: transaction.amount + 10, desc: '转账（已更新）' });
  assert.equal(data.getAccount(source.id).balance, sourceBalance - 10);
  assert.equal(data.getAccount(destination.id).balance, destinationBalance + 10);
  assert.equal(data.getPulse().currentCash, startingCash);
  data.deleteTransaction(transaction.id);
  assert.equal(toMinor(data.getAccount(source.id).balance), toMinor(sourceBalance + transaction.amount));
  assert.equal(toMinor(data.getAccount(destination.id).balance), toMinor(destinationBalance - transaction.amount));
  assert.equal(data.getPulse().currentCash, startingCash);
});

test('N: baseline record-only stays mutable without a money effect and explicit locks explain themselves', () => {
  const accounts = [{ id: 'cash', type: 'saving', name: 'Cash', bank: 'Bank', last4: '0001', balance: 500 }];
  const transaction = {
    id: 'fixture-note', kind: 'expense', amount: 300, desc: '现金备注', catId: 'grocery', catLabel: '日用',
    accountId: 'cash', date: '2026-07-13', time: '10:00', recordOnly: true,
  };
  const locked = {
    ...transaction, id: 'fixture-locked', desc: '已完成结算', recordOnly: false,
    lockedReason: '这笔结算需要使用专用撤销流程。',
  };
  const engine = createMoneyEngine({ accounts, transactions: [transaction, locked], today: '2026-07-13' });
  assert.equal(engine.getTransactionMutationPolicy('fixture-note').canEdit, true);
  engine.editTransaction('fixture-note', { amount: 350, desc: '现金备注（已更新）' });
  assert.equal(engine.getAccount('cash').balance, 500);
  engine.deleteTransaction('fixture-note');
  assert.equal(engine.getAccount('cash').balance, 500);

  assert.deepEqual(engine.getTransactionMutationPolicy('fixture-locked'), {
    canEdit: false, canDelete: false, reason: '这笔结算需要使用专用撤销流程。',
  });
  assert.throws(() => engine.editTransaction('fixture-locked', { amount: 1 }), /专用撤销流程/);
  assert.throws(() => engine.deleteTransaction('fixture-locked'), /专用撤销流程/);
});

test('O: reset restores original baseline revisions, histories, states, and balances', () => {
  const data = createDemoDataSource();
  const baselineAccounts = structuredClone(data.getAccounts());
  const baselineTransactions = structuredClone(data.getActivities());
  const expense = baseline(data, (item) => item.desc === 'TNB 电费' && item.amount === 112, 'TNB expense');
  const income = baseline(data, (item) => item.kind === 'income', 'income');
  const transfer = baseline(data, (item) => item.kind === 'transfer', 'transfer');

  data.editTransaction(expense.id, { amount: 120, desc: '已修改电费' });
  data.deleteTransaction(income.id);
  data.editTransaction(transfer.id, { amount: transfer.amount + 10, desc: '已修改转账' });
  data.resetDemoData();

  assert.deepEqual(data.getAccounts(), baselineAccounts);
  assert.deepEqual(data.getActivities(), baselineTransactions);
  data.getActivities().forEach((transaction) => {
    assert.equal(transaction.status, 'active');
    assert.equal(transaction.revision, 1);
    assert.deepEqual(transaction.editHistory, []);
  });
});
