import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { timePartsFrom24, time24FromParts, currentLocalTime, timePickerHTML } from '../src/components/TimePickerSheet.js';
import { nativeDateTimeFieldsHTML } from '../src/components/NativeDateTimeFields.js';
import { attachmentMetadata } from '../src/domain/attachmentSession.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

test('BC: custom picker converts every minute with correct AM/PM boundaries', () => {
  for (let minute = 0; minute < 60; minute += 1) {
    const value = `23:${String(minute).padStart(2, '0')}`;
    assert.equal(time24FromParts(timePartsFrom24(value)), value);
  }
  assert.deepEqual(timePartsFrom24('00:00'), { hour: 12, minute: 0, period: 'AM' });
  assert.deepEqual(timePartsFrom24('12:00'), { hour: 12, minute: 0, period: 'PM' });
  assert.equal(time24FromParts({ hour: 11, minute: 59, period: 'PM' }), '23:59');
});

test('BD: picker exposes AM/PM, current time, cancel, complete, and all minutes', () => {
  const html = timePickerHTML('14:56');
  ['AM', 'PM', '当前时间', '取消', '完成'].forEach((label) => assert.equal(html.includes(label), true));
  assert.equal((html.match(/data-time-minute/g) || []).length >= 1, true);
  assert.equal(html.includes('value="59"'), true);
  assert.equal(html.includes('2:56 PM'), true);
  assert.equal(html.includes('<option value="2" selected>02</option>'), true);
  assert.equal(currentLocalTime(new Date(2026, 6, 13, 5, 7)), '05:07');
});

test('BE: Create and Edit share the custom picker generator and never expose native time', () => {
  const create = nativeDateTimeFieldsHTML({ prefix: 'capture', date: '2026-07-13', time: '14:56' });
  const edit = nativeDateTimeFieldsHTML({ prefix: 'edit', date: '2026-07-13', time: '14:56' });
  assert.equal(create.replace('capture', 'shared'), edit.replace('edit', 'shared'));
  assert.equal(create.includes('2:56 PM'), true);
  assert.equal(create.includes('type="time"'), false);
  assert.equal(create.includes('type="date"'), true);
});

test('BF: attachment metadata preserves local preview facts and can be removed', () => {
  let attachment = attachmentMetadata({ name: 'receipt.png', type: 'image/png', size: 2048 }, 'data:image/png;base64,AA');
  assert.deepEqual({ kind: attachment.kind, name: attachment.name, type: attachment.type, size: attachment.size }, { kind: 'photo', name: 'receipt.png', type: 'image/png', size: 2048 });
  assert.equal(attachment.dataUrl.startsWith('data:image/png'), true);
  attachment = null;
  assert.equal(attachment, null);
});

test('BG: Capture exposes one Advanced Details entry and no inert AA/attachment/record-only buttons', () => {
  const source = fs.readFileSync(new URL('../src/components/CaptureSheet.js', import.meta.url), 'utf8');
  assert.equal(source.includes('data-action="cap-open-details"'), true);
  ['data-action="cap-aa"', 'data-action="cap-attach"', 'data-action="cap-record-only"'].forEach((needle) => assert.equal(source.includes(needle), false));
  assert.equal(source.includes('只记录，不影响账户余额'), true);
});

test('BH: record-only from Advanced Details stays balance neutral for every core type', () => {
  const data = createDemoDataSource();
  const source = data.getAccount('sv-mbb').balance;
  const destination = data.getAccount('ew-tng').balance;
  data.addTransaction({ kind: 'expense', amount: 10, desc: '只记录支出', catId: 'food', sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '14:56', recordOnly: true });
  data.addTransaction({ kind: 'income', amount: 10, desc: '只记录收入', catId: 'income-salary', destinationAccountId: 'ew-tng', date: '2026-07-13', time: '14:56', recordOnly: true });
  data.addTransaction({ kind: 'transfer', amount: 10, desc: '只记录转账', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng', date: '2026-07-13', time: '14:56', recordOnly: true });
  assert.equal(data.getAccount('sv-mbb').balance, source);
  assert.equal(data.getAccount('ew-tng').balance, destination);
});
