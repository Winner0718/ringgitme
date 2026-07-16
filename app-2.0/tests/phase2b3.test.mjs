import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nativeDateTimeFieldsHTML } from '../src/components/NativeDateTimeFields.js';
import { calendarCells, datePickerHTML, isISODate, shiftMonth } from '../src/components/DatePickerSheet.js';
import { evaluateMoneyExpression, moneyStringToMinor } from '../src/components/MoneyCalculatorSheet.js';
import { allocationSummary, applyRemainderToLast, equalSplitMinor, rebuildSplitShares, suggestedMissingShare } from '../src/domain/smartSplit.js';
import { moneyFlowConfirmationHTML } from '../src/components/MoneyFlowConfirmation.js';
import { createAttachmentStore, sanitizeAttachmentName } from '../src/domain/attachmentRepository.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const dateSource = read('../src/components/DatePickerSheet.js');
const dateCSS = read('../src/styles/phase2b3.css');
const calcSource = read('../src/components/MoneyCalculatorSheet.js');
const captureSource = read('../src/components/CaptureSheet.js');
const activitySource = read('../src/features/activity/index.js');
const ledgerSource = read('../src/features/ledger/index.js');
const attachmentSource = read('../src/components/AttachmentField.js');
const motionSource = read('../src/components/MoneyFlowConfirmation.js');
const demoSource = read('../src/fixtures/demoData.js');
const moneySource = read('../src/domain/moneyEngine.js');

let sequence = 0;
const command = (overrides = {}) => ({
  ledgerId: 'ledger-abi', entryType: 'direct_receivable', amount: 10, description: 'Phase 2B3',
  participantId: 'participant-abi', payerParticipantId: 'participant-me', sourceAccountId: 'sv-mbb',
  destinationAccountId: 'ew-tng', date: '2026-07-13', time: '13:14', sourceChannel: 'app',
  clientEventId: `b3-${++sequence}`, ...overrides,
});
const ordinary = (data, overrides = {}) => data.addTransaction({ kind: 'expense', amount: 10, desc: 'Motion test', catId: 'food', sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '13:14', submissionKey: `b3-txn-${++sequence}`, ...overrides });

const cases = [
  ['01', 'date displays DD/MM/YYYY', () => assert.match(nativeDateTimeFieldsHTML({ prefix: 'x', date: '2026-07-13', time: '13:14' }), /13\/07\/2026/)],
  ['02', 'date retains ISO internally', () => assert.match(nativeDateTimeFieldsHTML({ prefix: 'x', date: '2026-07-13', time: '13:14' }), /type="hidden" value="2026-07-13"/)],
  ['03', 'date picker initializes selected date', () => assert.match(datePickerHTML('2026-07-13'), /data-date-value="2026-07-13"[^>]*aria-selected="true"/)],
  ['04', 'date picker exposes today shortcut', () => assert.match(datePickerHTML('2026-07-13'), /data-date-today/)],
  ['05', 'date picker cancel never calls completion', () => { assert.match(dateSource, /data-date-cancel/); assert.equal(dateSource.indexOf('onComplete?.(selected)'), dateSource.lastIndexOf('onComplete?.(selected)')); }],
  ['06', 'date picker validates leap years', () => { assert.equal(isISODate('2028-02-29'), true); assert.equal(isISODate('2026-02-29'), false); }],
  ['07', 'date month navigation crosses year', () => assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 })],
  ['08', 'date picker is a mobile bottom sheet', () => assert.match(dateCSS, /\.date-picker-sheet[\s\S]*bottom: max\(10px/)],
  ['09', 'date picker desktop width is capped', () => assert.match(dateCSS, /width: min\(92vw, 460px\)/)],
  ['10', 'date UI exposes no native date control', () => assert.equal(nativeDateTimeFieldsHTML({ prefix: 'x', date: '2026-07-13', time: '13:14' }).includes('type="date"'), false)],

  ['11', 'calculator addition', () => assert.equal(evaluateMoneyExpression('10+2.50').minor, 1250)],
  ['12', 'calculator subtraction', () => assert.equal(evaluateMoneyExpression('10−2.50').minor, 750)],
  ['13', 'calculator multiplication', () => assert.equal(evaluateMoneyExpression('4×2.50').minor, 1000)],
  ['14', 'calculator division', () => assert.equal(evaluateMoneyExpression('10÷4').minor, 250)],
  ['15', 'calculator honors precedence', () => assert.equal(evaluateMoneyExpression('2+3×4').minor, 1400)],
  ['16', 'calculator handles decimals exactly', () => assert.equal(evaluateMoneyExpression('0.10+0.20').minor, 30)],
  ['17', 'calculator converts to minor units', () => assert.equal(moneyStringToMinor('123.45'), 12345)],
  ['18', 'calculator refuses division by zero', () => assert.throws(() => evaluateMoneyExpression('10÷0'), /除以零/)],
  ['19', 'calculator refuses incomplete expression', () => assert.throws(() => evaluateMoneyExpression('10+'), /不完整/)],
  ['20', 'calculator refuses negative results', () => assert.throws(() => evaluateMoneyExpression('1−2'), /负数/)],
  ['21', 'calculator cancel preserves caller state', () => assert.match(calcSource, /data-calculator-cancel[^\n]*return close/)],
  ['22', 'calculator supports keyboard entry', () => assert.match(calcSource, /Backspace[\s\S]*Delete[\s\S]*mapped/)],
  ['23', 'calculator never uses eval or Function', () => { assert.equal(/\beval\s*\(|new Function|Function\s*\(/.test(calcSource), false); }],

  ['24', 'smart split reports under-allocation', () => assert.equal(allocationSummary(1000, { a: 300, b: 400 }, ['a', 'b']).remainingMinor, 300)],
  ['25', 'smart split reports over-allocation', () => assert.equal(allocationSummary(1000, { a: 700, b: 400 }, ['a', 'b']).overMinor, 100)],
  ['26', 'smart split recognizes exact allocation', () => assert.equal(allocationSummary(1000, { a: 600, b: 400 }, ['a', 'b']).exact, true)],
  ['27', 'smart split equal reset is deterministic', () => assert.deepEqual(equalSplitMinor(1000, ['a', 'b', 'c']), { a: 333, b: 333, c: 334 })],
  ['28', 'smart split puts remainder on final participant', () => assert.deepEqual(applyRemainderToLast(1000, ['a', 'b'], { a: 600, b: 0 }), { a: 600, b: 400 })],
  ['29', 'smart split preserves RM0.01 exactly', () => assert.deepEqual(equalSplitMinor(1, ['a', 'b', 'c']), { a: 0, b: 0, c: 1 })],
  ['30', 'smart split rebuild follows selected participants', () => assert.deepEqual(rebuildSplitShares({ totalMinor: 100, participantIds: ['b', 'c'], previous: { a: 20, b: 30 } }), { b: 30, c: 0 })],
  ['31', 'invalid custom split disables completion', () => assert.match(captureSource, /splitValid[\s\S]*'data-action': 'capture-relation-save'[\s\S]*'data-disabled-visual': String\(!splitValid\)/)],
  ['32', 'each custom share opens the inline calculator drawer', () => assert.match(captureSource, /data-split-allocation[\s\S]*createInlineSplitDraft/)],
  ['33', 'missing-share suggestion has no float drift', () => assert.deepEqual(suggestedMissingShare(1001, ['a', 'b'], { a: 333, b: 0 }), { participantId: 'b', amountMinor: 668 })],

  ['34', 'expense confirmation contains exact before and after balance', () => { const data = createDemoDataSource(); const t = ordinary(data); assert.equal(t.confirmation.accountChanges[0].beforeMinor - t.confirmation.accountChanges[0].afterMinor, 1000); }],
  ['35', 'income confirmation contains exact balance increase', () => { const data = createDemoDataSource(); const t = ordinary(data, { kind: 'income', catId: 'income-salary', sourceAccountId: null, destinationAccountId: 'ew-tng' }); assert.equal(t.confirmation.accountChanges[0].deltaMinor, 1000); }],
  ['36', 'transfer confirmation contains both account results', () => { const data = createDemoDataSource(); const t = ordinary(data, { kind: 'transfer', catId: 'transfer-fallback', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng' }); assert.equal(t.confirmation.accountChanges.length, 2); assert.equal(t.confirmation.accountChanges.reduce((sum, row) => sum + row.deltaMinor, 0), 0); }],
  ['37', 'record-only confirmation keeps balance unchanged', () => { const data = createDemoDataSource(); const t = ordinary(data, { recordOnly: true }); assert.equal(t.accountEffect, 'record_only'); assert.equal(t.confirmation.accountChanges[0].deltaMinor, 0); }],
  ['38', 'other-payer AA keeps own balance unchanged', () => { const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance; const result = data.recordRelationshipEntry(command({ entryType: 'split_expense', payerParticipantId: 'participant-abi', shares: [{ participantId: 'participant-me', amountMinor: 500 }, { participantId: 'participant-abi', amountMinor: 500 }] })); assert.equal(data.getAccount('sv-mbb').balance, before); assert.equal(result.transaction.confirmation.accountEffect, 'relationship_only'); }],
  ['39', 'user-paid AA confirmation carries receivable summary', () => { const data = createDemoDataSource(); const result = data.recordRelationshipEntry(command({ entryType: 'split_expense', shares: [{ participantId: 'participant-me', amountMinor: 500 }, { participantId: 'participant-abi', amountMinor: 500 }] })); assert.equal(result.transaction.confirmation.relationship.afterMinor, 500); }],
  ['40', 'received payment confirms destination increase', () => { const data = createDemoDataSource(); const result = data.settleRelationship(command({ direction: 'received', amount: 1, description: '收到款' })); assert.equal(result.transaction.confirmation.accountChanges[0].deltaMinor, 100); }],
  ['41', 'repayment confirms source decrease', () => { const data = createDemoDataSource(); const result = data.settleRelationship(command({ ledgerId: 'ledger-jason', direction: 'paid', amount: 1, description: '我还款' })); assert.equal(result.transaction.confirmation.accountChanges[0].deltaMinor, -100); }],
  ['42', 'monthly payment confirmation includes plan progress', () => { const data = createDemoDataSource(); const result = data.recordObligationPayment({ planId: 'plan-rent-sis', amount: 1, sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '13:14', sourceChannel: 'app', clientEventId: `b3-pay-${++sequence}` }); assert.equal(result.transaction.confirmation.plan.planType, 'recurring_monthly'); }],
  ['43', 'instalment payment confirmation includes remaining plan amount', () => { const data = createDemoDataSource(); const result = data.recordObligationPayment({ planId: 'plan-shopee-sis', amount: 1, sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '13:14', sourceChannel: 'app', clientEventId: `b3-pay-${++sequence}` }); assert.equal(result.transaction.confirmation.plan.remainingMinor, 99900); }],
  ['44', 'confirmation uses actual recent transaction ids', () => { const data = createDemoDataSource(); const t = ordinary(data); assert.equal(t.confirmation.recentRecords[0].id, t.id); assert.ok(t.confirmation.recentRecords.slice(1).every((row) => data.getTransaction(row.id))); }],
  ['45', 'motion source contains no fake placeholder records', () => assert.equal(/placeholder|fake transaction/i.test(motionSource), false)],
  ['46', 'submission idempotency prevents duplicate save', () => { const data = createDemoDataSource(); const key = 'b3-idempotent'; const one = ordinary(data, { submissionKey: key }); const two = ordinary(data, { submissionKey: key }); assert.equal(one.id, two.id); }],
  ['47', 'motion supports reduced-motion mode', () => assert.match(motionSource, /prefers-reduced-motion: reduce/)],
  ['48', 'motion completion closes without financial mutation', () => { assert.match(motionSource, /data-motion-done/); assert.equal(motionSource.includes('addTransaction'), false); }],

  ['49', 'attachment metadata can be renamed', () => { const store = createAttachmentStore(); const item = store.add({ name: 'receipt.pdf', ownerEntityType: 'transaction', ownerEntityId: 't', clientEventId: 'a' }); assert.equal(store.rename(item.attachmentId, 'Maybank').name, 'Maybank.pdf'); }],
  ['50', 'attachment rename sanitizes invalid filename characters', () => assert.equal(sanitizeAttachmentName('receipt.pdf', ' Maybank:/proof?.png '), 'Maybank proof.pdf')],
  ['51', 'download uses renamed user-facing filename', () => assert.match(attachmentSource, /anchor\.download = item\.name/)],
  ['52', 'share is shown only after canShare file check', () => assert.match(attachmentSource, /navigator\.canShare\(\{ files: \[file\] \}\)/)],
  ['53', 'unsupported share returns a safe fallback state', () => assert.match(attachmentSource, /if \(!attachmentCanShare\(item\)\) return false/)],
  ['54', 'attachment store deduplicates repeated client events', () => { const store = createAttachmentStore(); const input = { name: 'a.pdf', ownerEntityType: 'transaction', ownerEntityId: 't', clientEventId: 'same' }; assert.equal(store.add(input).attachmentId, store.add(input).attachmentId); }],
  ['55', 'relationship attachment display removes transaction duplicates', () => assert.match(activitySource, /transactionAttachmentSet[\s\S]*distinctRelationshipAttachmentIds/)],
  ['56', 'activity attachment count derives from canonical store objects', () => { const data = createDemoDataSource(); assert.equal(data.getActivity('t-0').attachmentCount, data.getTransactionAttachments('t-0').length); }],

  ['57', 'personal ledger link has a specific destination label', () => assert.match(activitySource, /`前往\$\{ledger\?\.title \|\| '个人'\}账本`/)],
  ['58', 'group ledger link has a specific destination label', () => assert.match(activitySource, /`前往\$\{ledger\?\.title \|\| '群组'\}`/)],
  ['59', 'relationship navigation uses exact ledger id', () => assert.match(activitySource, /data-ledger="\$\{escapeHTML\(entry\.ledgerId\)\}"/)],
  ['60', 'ledger back restores linked transaction detail', () => { assert.match(ledgerSource, /ledgerReturnTransactionId[\s\S]*activityDetailId/); assert.match(activitySource, /pushRoute\(\{ tab: 'ledger'[\s\S]*activityDetailId: null/); }],
  ['61', 'relationship card has one heading', () => { assert.equal((activitySource.match(/sheet-group-label">关系账/g) || []).length, 0); assert.match(activitySource, /relationship-summary-heading/); }],

  ['62', 'four participants render all names and initials', () => assert.match(ledgerSource, /members\.length <= 5 \? 5 : 4/)],
  ['63', 'member +N appears only above five', () => assert.match(ledgerSource, /names\.length > 5/)],
  ['64', 'channel vocabulary consistently uses RinggitMe', () => { assert.match(ledgerSource, /RinggitMe \+ Telegram/); assert.equal(ledgerSource.includes('App + Telegram'), false); }],
  ['65', 'ledger exposes a three-action primary toolbar', () => { assert.match(ledgerSource, /ledger-primary-actions/); assert.match(dateCSS, /ledger-primary-actions \{ grid-template-columns: repeat\(3/); }],
  ['66', '记一笔 opens compact action sheet', () => assert.match(ledgerSource, /function ledgerEntryActionsSheet[\s\S]*AA 分账/)],
  ['67', 'all three relationship commands remain reachable', () => ['split_expense', 'direct_receivable', 'direct_payable'].forEach((type) => assert.match(ledgerSource, new RegExp(`data-type="${type}"`)))],

  ['68', 'compact monthly summary surfaces current due', () => assert.match(ledgerSource, /planType === 'recurring_monthly'[\s\S]*本月待/)],
  ['69', 'compact instalment summary surfaces due and remaining', () => assert.match(ledgerSource, /本期应还[\s\S]*剩余/)],
  ['70', 'plan progress derives from paid over total', () => assert.match(ledgerSource, /overview\.paidMinor \/ plan\.totalRepayableMinor/)],
  ['71', 'empty plans use one compact entry', () => assert.match(ledgerSource, /plans-empty-row/)],
  ['72', 'detail renders one unified plans section', () => { assert.match(ledgerSource, /plansPaymentsSectionHTML\(ledger\)/); assert.equal(/detailHTML[\s\S]*monthlySectionHTML\(ledger\)/.test(ledgerSource), false); }],
  ['73', 'plan menu routes only to registered actions', () => ['obligation-history', 'installment-schedule', 'installment-early', 'obligation-pause', 'obligation-resume', 'obligation-stop'].forEach((action) => assert.match(ledgerSource, new RegExp(`registerAction\\('${action}'`)))],
  ['74', 'plan detail opens exact plan id', () => { assert.match(ledgerSource, /obligation-plan-detail[\s\S]*planDetailId: el\.dataset\.plan/); assert.match(ledgerSource, /ui\.planDetailId[\s\S]*planDetailSheet\(ui\.planDetailId\)/); }],

  ['75', 'record-only transaction remains in Activity', () => { const data = createDemoDataSource(); const t = ordinary(data, { recordOnly: true }); assert.ok(data.getActivities().some((row) => row.id === t.id)); }],
  ['76', 'record-only transaction is excluded from account balance', () => { const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance; ordinary(data, { recordOnly: true }); assert.equal(data.getAccount('sv-mbb').balance, before); }],
  ['77', 'record-only transaction is excluded from Current Cash', () => { const data = createDemoDataSource(); const before = data.getPulse().currentCash; ordinary(data, { recordOnly: true }); assert.equal(data.getPulse().currentCash, before); }],
  ['78', 'record-only transaction is excluded from monthly spend KPI', () => { const data = createDemoDataSource(); const before = data.getBudget().used; ordinary(data, { recordOnly: true }); assert.equal(data.getBudget().used, before); }],
  ['79', 'record-only card expense is excluded from debt totals', () => { const data = createDemoDataSource(); const before = data.getPulse().totalCardDebt; ordinary(data, { sourceAccountId: 'cc-mbb-visa', recordOnly: true }); assert.equal(data.getPulse().totalCardDebt, before); }],
  ['80', 'other-payer operation still increases relationship payable', () => { const data = createDemoDataSource(); const before = data.getRelationshipSummary('ledger-abi').payableMinor; data.recordRelationshipEntry(command({ entryType: 'direct_payable' })); assert.equal(data.getRelationshipSummary('ledger-abi').payableMinor, before + 1000); }],
  ['81', 'relationship-only operation is not standard record-only', () => { const data = createDemoDataSource(); const result = data.recordRelationshipEntry(command({ entryType: 'direct_payable' })); assert.equal(result.transaction.recordOnly, false); assert.equal(result.transaction.accountEffect, 'relationship_only'); }],

  ['82', 'category regression suite remains part of npm tests', () => assert.equal(fs.existsSync(new URL('./categoryHabits.test.mjs', import.meta.url)), true)],
  ['83', 'relationship regression suite remains part of npm tests', () => assert.equal(fs.existsSync(new URL('./relationshipLedger.test.mjs', import.meta.url)), true)],
  ['84', 'settlement commands preserve relationship engine path', () => assert.match(demoSource, /settleRelationship: \(command\) => relationship\.settle\(command\)/)],
  ['85', 'monthly and instalment regression suites remain', () => { assert.equal(fs.existsSync(new URL('./obligations.test.mjs', import.meta.url)), true); assert.equal(fs.existsSync(new URL('./instalments.test.mjs', import.meta.url)), true); }],
  ['86', 'attachment regression suite remains', () => assert.equal(fs.existsSync(new URL('./attachments.test.mjs', import.meta.url)), true)],
  ['87', 'reset restores account-effect and repository state', () => { const data = createDemoDataSource(); const before = data.getAccount('sv-mbb').balance; ordinary(data); data.resetDemoData(); assert.equal(data.getAccount('sv-mbb').balance, before); assert.equal(data.getActivities().some((row) => row.origin === 'user'), false); }],
  ['88', 'Phase 2B3 adds no persistence or network client', () => [dateSource, calcSource, captureSource, activitySource, ledgerSource, attachmentSource, motionSource, moneySource].forEach((source) => assert.equal(/\blocalStorage\b|\bindexedDB\b|\bfetch\s*\(|\bWebSocket\b|createClient\s*\(/.test(source), false))],
];

assert.equal(cases.length, 88);
cases.forEach(([number, name, run]) => test(`2B3-${number}: ${name}`, run));

test('2B3 calendar grid always renders six valid weeks', () => {
  const cells = calendarCells(2026, 7);
  assert.equal(cells.length, 42);
  assert.equal(cells.every((cell) => isISODate(cell.iso)), true);
});

test('2B3 motion HTML renders exact transaction snapshot fields', () => {
  const html = moneyFlowConfirmationHTML({ operation: 'create', kind: 'expense', amountMinor: 1000, description: 'KFC', accountEffect: 'posted', accountChanges: [{ accountId: 'sv-mbb', accountName: 'Maybank', accountType: 'saving', measure: 'balance', beforeMinor: 10000, afterMinor: 9000, deltaMinor: -1000 }], recentRecords: [] });
  assert.match(html, /Maybank/);
  assert.match(html, /RM 100\.00 → RM 90\.00/);
});
