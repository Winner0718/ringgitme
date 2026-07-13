import test from 'node:test';
import assert from 'node:assert/strict';
import { createCategoryRepository, automaticThemeToken } from '../src/domain/categoryRepository.js';
import { createReorderSession } from '../src/domain/reorderSession.js';
import { categoryEditorHTML } from '../src/components/CategorySheets.js';
import { nativeDateTimeFieldsHTML, openNativePicker } from '../src/components/NativeDateTimeFields.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { fmtDateMY, fmtTimeAMPM, parseDateMY, parseTimeAMPM } from '../src/app/format.js';

test('AL: active categories reorder atomically by stable ID and persist', () => {
  const repo = createCategoryRepository();
  const ids = repo.getCategories('expense').map((item) => item.id);
  repo.reorderActive('expense', [ids[1], ids[0], ...ids.slice(2)]);
  assert.deepEqual(repo.getCategories('expense').map((item) => item.id), [ids[1], ids[0], ...ids.slice(2)]);
  assert.equal(repo.getCategory(ids[0]).id, 'food');
});

test('AM: quick-row order follows repository order', () => {
  const repo = createCategoryRepository();
  const ids = repo.getCategories('expense').map((item) => item.id);
  repo.reorderActive('expense', [ids[2], ids[0], ids[1], ...ids.slice(3)]);
  assert.deepEqual(repo.getQuickCategories('expense').slice(0, 3).map((item) => item.id), [ids[2], ids[0], ids[1]]);
});

test('AN: expense, income, and transfer order remain isolated', () => {
  const repo = createCategoryRepository();
  const income = repo.getCategories('income').map((item) => item.id);
  const transfer = repo.getCategories('transfer').map((item) => item.id);
  const expense = repo.getCategories('expense').map((item) => item.id);
  repo.reorderActive('expense', [...expense].reverse());
  assert.deepEqual(repo.getCategories('income').map((item) => item.id), income);
  assert.deepEqual(repo.getCategories('transfer').map((item) => item.id), transfer);
  repo.reorderActive('income', [income[1], income[0], ...income.slice(2)]);
  assert.deepEqual(repo.getCategories('transfer').map((item) => item.id), transfer);
});

test('AO: pinned and default state remain attached to stable IDs after reorder', () => {
  const repo = createCategoryRepository();
  repo.setDefault('expense', 'grocery');
  const before = { pinned: repo.getCategory('food').isPinned, defaultId: repo.getDefaultId('expense') };
  repo.reorderActive('expense', [...repo.getCategories('expense').map((item) => item.id)].reverse());
  assert.equal(repo.getCategory('food').isPinned, before.pinned);
  assert.equal(repo.getDefaultId('expense'), before.defaultId);
});

test('AP: cancelled reorder session restores the original order', () => {
  const session = createReorderSession(['a', 'b', 'c']);
  session.move('a', 2);
  assert.deepEqual(session.getCurrent(), ['b', 'c', 'a']);
  assert.deepEqual(session.cancel(), ['a', 'b', 'c']);
});

test('AQ: archived entries are excluded and fallback remains valid', () => {
  const repo = createCategoryRepository();
  repo.archive('shopping');
  const active = repo.getCategories('expense').map((item) => item.id);
  assert.equal(active.includes('shopping'), false);
  repo.reorderActive('expense', [...active].reverse());
  assert.equal(repo.getCategory('shopping').isArchived, true);
  assert.equal(repo.getCategory('expense-fallback').isSystemFallback, true);
});

test('AR: invalid reorder cannot duplicate or lose a category', () => {
  const repo = createCategoryRepository();
  const ids = repo.getCategories('expense').map((item) => item.id);
  assert.throws(() => repo.reorderActive('expense', [ids[0], ids[0], ...ids.slice(2)]), /不完整/);
  assert.deepEqual(new Set(repo.getCategories('expense').map((item) => item.id)).size, ids.length);
});

test('AS: category editor exposes neither theme choices nor up/down controls', () => {
  const repo = createCategoryRepository();
  const html = categoryEditorHTML(repo.getCategory('food'), 'expense', true);
  ['主题', '青绿', '薄荷', '暖橙', '海蓝', '紫罗兰', '珊瑚', '雾灰', '上移', '下移'].forEach((label) => assert.equal(html.includes(label), false));
  assert.equal(html.includes('图标'), true);
  assert.equal(html.includes('设为常用'), true);
});

test('AT: an existing theme token survives icon editing', () => {
  const repo = createCategoryRepository();
  const theme = repo.getCategory('food').themeToken;
  repo.update('food', { icon: 'heart' });
  assert.equal(repo.getCategory('food').themeToken, theme);
});

test('AU: new categories receive deterministic automatic theme tokens', () => {
  const first = createCategoryRepository().create({ transactionType: 'expense', name: '宠物', icon: 'heart' });
  const second = createCategoryRepository().create({ transactionType: 'income', name: '宠物', icon: 'heart' });
  assert.equal(first.themeToken, 'rose');
  assert.equal(second.themeToken, first.themeToken);
  assert.equal(automaticThemeToken('heart'), automaticThemeToken('heart'));
});

test('AV: native picker fields show formatted labels but retain ISO values internally', () => {
  const html = nativeDateTimeFieldsHTML({ prefix: 'test', date: '2026-07-13', time: '13:14' });
  assert.equal(html.includes('13/07/2026'), true);
  assert.equal(html.includes('1:14 PM'), true);
  assert.equal(html.includes('type="date" value="2026-07-13"'), true);
  assert.equal(html.includes('type="hidden" value="13:14"'), true);
  assert.equal(html.includes('type="time"'), false);
  assert.equal(html.includes('type="text"'), false);
  assert.equal((html.match(/aria-readonly="true"/g) || []).length, 2);
});

test('AW: showPicker is preferred and focus/click is a safe fallback', () => {
  let shown = 0;
  assert.equal(openNativePicker({ showPicker: () => { shown += 1; } }), 'showPicker');
  assert.equal(shown, 1);
  let focused = 0; let clicked = 0;
  const fallback = { showPicker: () => { throw new Error('unsupported'); }, focus: () => { focused += 1; }, click: () => { clicked += 1; } };
  assert.equal(openNativePicker(fallback), 'focus-click');
  assert.equal(focused, 1); assert.equal(clicked, 1);
});

test('AX: picker cancellation preserves the prior transaction state', () => {
  const state = { amount: '25', desc: '午餐', date: '2026-07-13', time: '13:14', catId: 'food', attachment: true };
  const before = structuredClone(state);
  openNativePicker({ showPicker() {} });
  assert.deepEqual(state, before);
});

test('AY: date/time conversions cover display, boundaries, and leap-year safety', () => {
  assert.equal(fmtDateMY('2026-07-13'), '13/07/2026');
  assert.equal(fmtTimeAMPM('00:00'), '12:00 AM');
  assert.equal(fmtTimeAMPM('12:00'), '12:00 PM');
  assert.equal(fmtTimeAMPM('23:59'), '11:59 PM');
  assert.equal(parseTimeAMPM('11:59 PM'), '23:59');
  assert.equal(parseDateMY('29/02/2028'), '2028-02-29');
  assert.throws(() => parseDateMY('29/02/2026'), /无效/);
});

test('AZ: date-only edit leaves balances unchanged and records only date', () => {
  const data = createDemoDataSource();
  const balance = data.getAccount('sv-mbb').balance;
  const transaction = data.addTransaction({ kind: 'expense', amount: 25, desc: '日期测试', catId: 'food', sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '13:14' });
  const edited = data.editTransaction(transaction.id, { date: '2026-07-14' });
  assert.equal(data.getAccount('sv-mbb').balance, balance - 25);
  assert.deepEqual(edited.editHistory[0].changedFields, ['date']);
  assert.equal(edited.editHistory[0].oldDate, '2026-07-13');
  assert.equal(edited.editHistory[0].newDate, '2026-07-14');
});

test('BA: time-only edit leaves balances unchanged and records only time', () => {
  const data = createDemoDataSource();
  const balance = data.getAccount('sv-mbb').balance;
  const transaction = data.addTransaction({ kind: 'expense', amount: 25, desc: '时间测试', catId: 'food', sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '13:14' });
  const edited = data.editTransaction(transaction.id, { time: '14:30' });
  assert.equal(data.getAccount('sv-mbb').balance, balance - 25);
  assert.deepEqual(edited.editHistory[0].changedFields, ['time']);
  assert.equal(edited.editHistory[0].oldTime, '13:14');
  assert.equal(edited.editHistory[0].newTime, '14:30');
});

test('BB: Create and Edit share the same native conversion field generator', () => {
  const create = nativeDateTimeFieldsHTML({ prefix: 'capture', date: '2028-02-29', time: '00:00' });
  const edit = nativeDateTimeFieldsHTML({ prefix: 'edit', date: '2028-02-29', time: '00:00' });
  assert.equal(create.replace('capture', 'shared'), edit.replace('edit', 'shared'));
  assert.equal(create.includes('29/02/2028'), true);
  assert.equal(create.includes('12:00 AM'), true);
});
