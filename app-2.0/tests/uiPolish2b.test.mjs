import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { timePickerHTML, timePartsFrom24, time24FromParts } from '../src/components/TimePickerSheet.js';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('GA: time picker renders custom listboxes — every hour, every minute, no native select', () => {
  const html = timePickerHTML('09:41');
  assert.equal(html.includes('<select'), false);
  assert.equal((html.match(/role="listbox"/g) || []).length, 2);
  assert.equal((html.match(/class="time-option/g) || []).length, 72); // 12 hours + 60 minutes
  assert.equal(html.includes('data-value="59"'), true);
  assert.equal(html.includes('9:41 AM'), true);
});

test('GB: cancel never commits and Escape/complete paths are wired', () => {
  const source = read('../src/components/TimePickerSheet.js');
  assert.equal(source.includes("event.key === 'Escape'"), true);
  assert.equal(source.includes('data-time-cancel'), true);
  const cancelBlock = source.split('data-time-cancel]').at(-1);
  assert.equal(source.includes('completed = true'), true);
  assert.equal(cancelBlock.includes("addEventListener('click', close)"), true);
  assert.equal(source.includes('data-time-now'), true);
});

test('GC: wide viewports cap the time picker and picker sheets — no full-width stretch', () => {
  const css = read('../src/styles/phase2b2.css');
  const desktopBlocks = css.split('@media (min-width: 720px)').slice(1);
  assert.equal(desktopBlocks.length >= 2, true);
  assert.equal(desktopBlocks.some((block) => block.includes('.time-picker-sheet') && block.includes('min(92vw, 440px)')), true);
  assert.equal(desktopBlocks.some((block) => block.includes('.picker-sheet') && block.includes('min(92vw, 440px)')), true);
});

test('GD: relationship and capture flows use RinggitMe pickers, not raw selects', () => {
  const ledger = read('../src/features/ledger/index.js');
  const capture = read('../src/components/CaptureSheet.js');
  [ledger, capture].forEach((source) => {
    assert.equal(source.includes('<select'), false);
    assert.equal(source.includes('openPickerSheet'), true);
    assert.equal(source.includes('nativeDateTimeFieldsHTML'), true);
    assert.equal(source.includes('attachmentSummaryHTML'), true);
  });
});

test('GE: transaction detail resolves the linked relationship entry as source of truth', () => {
  const activity = read('../src/features/activity/index.js');
  assert.equal(activity.includes("detailRow('AA 分账'"), false);
  assert.equal(activity.includes('relationshipSummaryHTML'), true);
  ['付款人', '我的份额', '剩余待收', '结算状态', '前往'].forEach((label) => assert.equal(activity.includes(label), true));
  assert.equal(activity.includes('data-ledger="${escapeHTML(entry.ledgerId)}"'), true);
  assert.equal(activity.includes('getObligationEntityForTransaction'), true);
});

test('GF: attachment counts surface on activity rows and detail opens a gallery', () => {
  const row = read('../src/components/ActivityRow.js');
  const activity = read('../src/features/activity/index.js');
  assert.equal(row.includes('attachmentCount'), true);
  assert.equal(activity.includes('openAttachmentGallery'), true);
  assert.equal(activity.includes('个附件'), true);
});

test('GG: obligation sections render from canonical plans with real actions only', () => {
  const ledger = read('../src/features/ledger/index.js');
  ['每月账', '分期', 'monthlyPlanOverview', 'installmentPlanOverview', 'obligation-pay', 'installment-early', 'obligation-pause', 'obligation-resume', 'obligation-stop', 'obligation-history'].forEach((needle) => {
    assert.equal(ledger.includes(needle), true);
  });
  assert.equal(ledger.includes('邀请') === false, true); // no inert invite buttons
});

test('GH: AM/PM edge conversions stay exact for the shared picker', () => {
  assert.equal(time24FromParts({ hour: 12, minute: 0, period: 'AM' }), '00:00');
  assert.equal(time24FromParts({ hour: 12, minute: 0, period: 'PM' }), '12:00');
  assert.equal(time24FromParts({ hour: 11, minute: 59, period: 'PM' }), '23:59');
  assert.deepEqual(timePartsFrom24('23:59'), { hour: 11, minute: 59, period: 'PM' });
});

test('GI: Activity Edit uses RinggitMe pickers and shared attachment management', () => {
  const activity = read('../src/features/activity/index.js');
  assert.equal(activity.includes('<select'), false);
  ['edit-kind', 'edit-category', 'edit-source', 'edit-destination'].forEach((key) => assert.equal(activity.includes(key), true));
  assert.equal(activity.includes("attachmentSummaryHTML('transaction', t.id)"), true);
  assert.equal(activity.includes('bindAttachmentField'), true);
});

test('GJ: attachment chooser is hidden, multi-file, and manager/gallery remain designed controls', () => {
  const attachment = read('../src/components/AttachmentField.js');
  assert.equal(attachment.includes('type="file"'), true);
  assert.equal(attachment.includes(' hidden multiple '), true);
  assert.equal(attachment.includes('openAttachmentManager'), true);
  assert.equal(attachment.includes('openAttachmentGallery'), true);
  assert.equal(attachment.includes('files.slice(0, 1)'), true);
});

test('GK: monthly and instalment forms expose complete canonical fields and shared time picker', () => {
  const ledger = read('../src/features/ledger/index.js');
  ['结束日期（可选）', '到期提醒', '商家／提供方（可选）', '本金', '费用（可为 0）', '总应还', "timeLabel: '记录时间'"].forEach((label) => assert.equal(ledger.includes(label), true));
  assert.equal(ledger.includes('obligation-attachments'), true);
  assert.equal(ledger.includes('ledger-item-attachments'), true);
});
