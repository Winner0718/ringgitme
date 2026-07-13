import test from 'node:test';
import assert from 'node:assert/strict';
import { createCategoryRepository, DEFAULT_CATEGORIES } from '../src/domain/categoryRepository.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { fmtDateMY, fmtTimeAMPM, parseDateMY, parseTimeAMPM } from '../src/app/format.js';

test('P: expense defaults differ from income defaults', () => {
  const repo = createCategoryRepository();
  assert.deepEqual(repo.getQuickCategories('expense').map((item) => item.name), ['餐饮', '交通', '日用', '娱乐', '账单']);
  assert.deepEqual(repo.getQuickCategories('income').map((item) => item.name), ['薪资', '奖金／佣金', '退款', '利息', 'AA 回款']);
});

test('Q: transfer purposes never contain expense categories', () => {
  const repo = createCategoryRepository();
  const transferNames = repo.getCategories('transfer').map((item) => item.name);
  ['餐饮', '交通', '日用', '娱乐', '账单'].forEach((name) => assert.equal(transferNames.includes(name), false));
});

test('R: transfer purpose is optional and displays simply as 转账', () => {
  const data = createDemoDataSource();
  const transaction = data.addTransaction({ kind: 'transfer', amount: 8, desc: '账户转账', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng', date: data.today, time: '13:14' });
  assert.equal(transaction.catId, 'transfer-fallback');
  assert.equal(data.getTransactionCategoryLabel(transaction), '转账');
});

test('S: custom expense category can be created', () => {
  const repo = createCategoryRepository();
  const item = repo.create({ transactionType: 'expense', name: '宠物', icon: 'heart', themeToken: 'rose' });
  assert.equal(repo.getCategory(item.id).name, '宠物');
});

test('T: same visible custom name is allowed across expense and income', () => {
  const repo = createCategoryRepository();
  repo.create({ transactionType: 'expense', name: '其他', icon: 'note', themeToken: 'slate' });
  repo.create({ transactionType: 'income', name: '其他', icon: 'note', themeToken: 'slate' });
  assert.equal(repo.getCategories('expense').some((item) => item.name === '其他'), true);
  assert.equal(repo.getCategories('income').some((item) => item.name === '其他'), true);
});

test('U: duplicate active name in the same type is rejected', () => {
  const repo = createCategoryRepository();
  repo.create({ transactionType: 'income', name: '项目', icon: 'salary', themeToken: 'green' });
  assert.throws(() => repo.create({ transactionType: 'income', name: ' 项目 ', icon: 'note', themeToken: 'slate' }), /已有/);
});

test('V: category rename updates current transaction display via stable ID', () => {
  const data = createDemoDataSource();
  const transaction = data.addTransaction({ kind: 'expense', amount: 5, desc: '午餐', catId: 'food', sourceAccountId: 'sv-mbb', date: data.today, time: '10:00' });
  data.updateCategory('food', { name: '外食' });
  assert.equal(data.getTransaction(transaction.id).catId, 'food');
  assert.equal(data.getTransaction(transaction.id).catLabel, '外食');
});

test('W: archived category leaves active Capture choices', () => {
  const repo = createCategoryRepository();
  repo.archive('food');
  assert.equal(repo.getQuickCategories('expense').some((item) => item.id === 'food'), false);
  assert.equal(repo.getCategories('expense').some((item) => item.id === 'food'), false);
});

test('X: archived category remains readable on historical transactions', () => {
  const data = createDemoDataSource();
  const transaction = data.addTransaction({ kind: 'expense', amount: 5, desc: '午餐', catId: 'food', sourceAccountId: 'sv-mbb', date: data.today, time: '10:00' });
  data.archiveCategory('food');
  const historical = data.getTransaction(transaction.id);
  assert.equal(historical.catLabel, '餐饮');
  assert.equal(historical.categoryArchived, true);
});

test('Y: restoring archived category returns it to active choices', () => {
  const repo = createCategoryRepository(); repo.archive('food'); repo.restore('food');
  assert.equal(repo.getCategories('expense').some((item) => item.id === 'food'), true);
});

test('Z: pinned state controls the quick row without compressing other items', () => {
  const repo = createCategoryRepository();
  repo.getQuickCategories('expense').forEach((item) => repo.togglePin(item.id));
  repo.togglePin('shopping');
  assert.deepEqual(repo.getQuickCategories('expense').map((item) => item.id), ['shopping']);
});

test('AA: unpinned items remain in the complete active collection', () => {
  const repo = createCategoryRepository(); repo.togglePin('food');
  assert.equal(repo.getQuickCategories('expense').some((item) => item.id === 'food'), false);
  assert.equal(repo.getCategories('expense').some((item) => item.id === 'food'), true);
});

test('AB: expense and income defaults are independent selections', () => {
  const repo = createCategoryRepository(); repo.setDefault('income', 'income-refund');
  assert.equal(repo.getDefault('income').id, 'income-refund');
  assert.equal(repo.getDefault('expense').id, 'food');
});

test('AC: category namespaces prevent cross-type default leakage', () => {
  const repo = createCategoryRepository();
  assert.throws(() => repo.setDefault('income', 'food'), /显示状态/);
  assert.equal(repo.getDefault('income').transactionType, 'income');
});

test('AD: same-account transfer is blocked before money changes', () => {
  const data = createDemoDataSource(); const cash = data.getPulse().currentCash;
  assert.throws(() => data.addTransaction({ kind: 'transfer', amount: 5, desc: '错误转账', sourceAccountId: 'sv-mbb', destinationAccountId: 'sv-mbb', date: data.today, time: '10:00' }), /不能相同/);
  assert.equal(data.getPulse().currentCash, cash);
});

test('AE: category presentation edit never changes financial balance', () => {
  const data = createDemoDataSource(); const snapshot = data.getPulse();
  data.updateCategory('food', { name: '餐食', icon: 'cart', themeToken: 'mint', isPinned: false });
  assert.deepEqual(data.getPulse(), snapshot);
});

test('AF: transaction category change applies no duplicate money effect', () => {
  const data = createDemoDataSource(); const balance = data.getAccount('sv-mbb').balance;
  const transaction = data.addTransaction({ kind: 'expense', amount: 25, desc: '午餐', catId: 'food', sourceAccountId: 'sv-mbb', date: data.today, time: '10:00' });
  data.editTransaction(transaction.id, { catId: 'grocery' });
  assert.equal(data.getAccount('sv-mbb').balance, balance - 25);
  assert.equal(data.getTransaction(transaction.id).editHistory[0].oldCategory, '餐饮');
  assert.equal(data.getTransaction(transaction.id).editHistory[0].newCategory, '日用');
});

test('AG: date and time display normalize to Malaysian user format', () => {
  assert.equal(fmtDateMY('2026-07-13'), '13/07/2026');
  assert.equal(fmtTimeAMPM('13:14'), '1:14 PM');
});

test('AH: midnight and noon boundaries convert both directions', () => {
  assert.equal(fmtTimeAMPM('00:00'), '12:00 AM'); assert.equal(parseTimeAMPM('12:00 AM'), '00:00');
  assert.equal(fmtTimeAMPM('12:00'), '12:00 PM'); assert.equal(parseTimeAMPM('12:00 PM'), '12:00');
  assert.equal(parseTimeAMPM('11:59 PM'), '23:59');
});

test('AI: leap-day conversion is strict and reversible', () => {
  assert.equal(parseDateMY('29/02/2028'), '2028-02-29');
  assert.equal(fmtDateMY(parseDateMY('29/02/2028')), '29/02/2028');
  assert.throws(() => parseDateMY('29/02/2026'), /无效/);
});

test('AJ: reset restores the exact original category repository', () => {
  const data = createDemoDataSource();
  data.createCategory({ transactionType: 'expense', name: '宠物', icon: 'heart', themeToken: 'rose', isPinned: true });
  data.archiveCategory('food'); data.setDefaultCategory('income', 'income-refund'); data.resetDemoData();
  assert.deepEqual(data.getCategorySnapshot().categories, DEFAULT_CATEGORIES);
  assert.equal(data.getDefaultCategoryId('expense'), 'food'); assert.equal(data.getDefaultCategoryId('income'), 'income-salary');
});

test('AK: changing transaction type reverses old effect then applies new effect once', () => {
  const data = createDemoDataSource(); const source = data.getAccount('sv-mbb').balance; const destination = data.getAccount('sv-cimb').balance;
  const transaction = data.addTransaction({ kind: 'expense', amount: 40, desc: '调整', catId: 'food', sourceAccountId: 'sv-mbb', date: data.today, time: '10:00' });
  data.editTransaction(transaction.id, { kind: 'income', catId: 'income-refund', accountId: 'sv-cimb', sourceAccountId: null, destinationAccountId: 'sv-cimb' });
  assert.equal(data.getAccount('sv-mbb').balance, source);
  assert.equal(data.getAccount('sv-cimb').balance, destination + 40);
  assert.deepEqual(data.getTransaction(transaction.id).editHistory[0].changedFields.includes('kind'), true);
});
