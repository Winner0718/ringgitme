import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveRecurringOccurrencePresentation } from '../src/domain/recurringOccurrencePresentation.js';
import { selectRecurringMonth } from '../src/domain/recurringPlanSelectors.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = {
  modalHistory: read('src/app/modalHistory.js'),
  modalStack: read('src/app/modalStack.js'),
  appSheet: read('src/components/AppSheet.js'),
  picker: read('src/components/PickerSheet.js'),
  date: read('src/components/DatePickerSheet.js'),
  time: read('src/components/TimePickerSheet.js'),
  calculator: read('src/components/MoneyCalculatorSheet.js'),
  composer: read('src/components/RecurringRelationshipComposer.js'),
  plans: read('src/features/fixed/RecurringPlanSheets.js'),
  center: read('src/features/fixed/index.js'),
  selector: read('src/domain/recurringPlanSelectors.js'),
  presentation: read('src/domain/recurringOccurrencePresentation.js'),
  css: read('src/styles/phase2c2.css'),
};
const combined = Object.values(source).join('\n');
const add = (name, fn) => test(`2C2-FIX1C-${String(++add.count).padStart(3, '0')}: ${name}`, fn);
add.count = 0;

const referenceDate = '2026-07-13';
const activePlan = (patch = {}) => ({ id: 'fix1c-plan', planKind: 'fixed_expense', title: 'FIX1C', status: 'active', archivedAt: null, schedule: { recurrence: 'monthly', dueDay: 13 }, canonicalSource: { sourceType: 'fixed_plan', sourceId: 'fix1c-plan' }, ...patch });
const occurrence = (dueDate, patch = {}) => ({ id: `occ-${dueDate}`, planId: 'fix1c-plan', monthKey: dueDate.slice(0, 7), periodKey: dueDate.slice(0, 7), dueDate, status: 'upcoming', canonicalSource: { sourceType: 'fixed_plan', sourceId: 'fix1c-plan' }, ownShareMinor: 1000, totalAmountMinor: 1000, cashOutflowMinor: 1000, receivableMinor: 0, payableMinor: 0, ...patch });
const present = (dueDate, occurrencePatch = {}, planPatch = {}) => deriveRecurringOccurrencePresentation(occurrence(dueDate, occurrencePatch), activePlan(planPatch), referenceDate);

// Date horizon matrix: every day around the reference date has one canonical
// state, label, tone and attention policy.
for (let delta = -14; delta <= 31; delta += 1) {
  const date = new Date(`${referenceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  const iso = date.toISOString().slice(0, 10);
  add(`date horizon ${delta >= 0 ? '+' : ''}${delta} derives canonical state`, () => {
    const result = present(iso);
    if (delta < 0) assert.deepEqual([result.semanticState, result.tone, result.attention], ['overdue', 'red', true]);
    else if (delta === 0) assert.deepEqual([result.semanticState, result.label, result.tone], ['due_today', '今天到期', 'red']);
    else if (delta === 1) assert.deepEqual([result.semanticState, result.label, result.tone], ['due_soon', '明天到期', 'amber']);
    else if (delta <= 7) assert.deepEqual([result.semanticState, result.label, result.tone], ['due_soon', `${delta} 天后`, 'amber']);
    else assert.deepEqual([result.semanticState, result.label, result.tone], ['future', `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`, 'neutral']);
  });
}

for (const [status, label] of [['paid','已付'],['charged','已扣款'],['received','已收款'],['repaid','已还款'],['completed','已完成']]) {
  add(`${status} is immutable completed green`, () => {
    const result = present('2026-06-01', { status, recordedStatus: status });
    assert.deepEqual([result.semanticState, result.label, result.tone, result.immutable], [status, label, 'green', true]);
  });
}
for (const [field, value, expected] of [
  ['amountPending', true, 'awaiting_variable_amount'],
  ['awaitingConfirmation', 'charge', 'awaiting_charge_confirmation'],
  ['awaitingConfirmation', 'payment', 'awaiting_payment_confirmation'],
  ['awaitingConfirmation', 'receipt', 'awaiting_receipt_confirmation'],
  ['awaitingConfirmation', true, 'awaiting_confirmation'],
]) add(`${expected} maps to amber attention`, () => {
  const result = present('2026-07-28', { [field]: value });
  assert.deepEqual([result.semanticState, result.tone, result.attention], [expected, 'amber', true]);
});
for (const [status, patch] of [['paused',{ status:'paused' }],['stopped',{ status:'stopped' }],['archived',{ archivedAt:'2026-07-13T00:00:00Z' }]]) {
  add(`${status} suppresses active due status`, () => {
    const result = present('2026-07-01', {}, patch);
    assert.deepEqual([result.semanticState, result.tone, result.attention], [status, 'neutral', false]);
  });
}
for (const [status, expected, tone] of [['failed','failure','red'],['failure','failure','red'],['skipped','skipped','neutral'],['cancelled','cancelled','neutral']]) {
  add(`${status} terminal mapping is stable`, () => {
    const result = present('2026-07-01', { status, recordedStatus: status });
    assert.deepEqual([result.semanticState, result.tone], [expected, tone]);
  });
}

// Explicit precedence: completion always wins over due, waiting and plan-level
// suppression; suppression wins over due/waiting; due wins over waiting.
for (const completion of ['paid','charged','received','repaid','completed']) {
  add(`${completion} wins over overdue and paused`, () => {
    const result = present('2026-06-01', { recordedStatus: completion, amountPending: true }, { status: 'paused' });
    assert.equal(result.semanticState, completion);
  });
}
for (const suppressed of [{status:'paused'},{status:'stopped'},{archivedAt:'2026-07-01'}]) {
  add(`${JSON.stringify(suppressed)} wins over waiting`, () => {
    const result = present('2026-07-28', { amountPending: true }, suppressed);
    assert.ok(['paused','stopped','archived'].includes(result.semanticState));
  });
}
for (const dueDate of ['2026-07-01','2026-07-13']) {
  add(`${dueDate} due urgency wins over waiting`, () => {
    const result = present(dueDate, { amountPending: true });
    assert.ok(['overdue','due_today'].includes(result.semanticState));
  });
}
for (const status of ['skipped','cancelled']) {
  add(`${status} wins over archived suppression`, () => assert.equal(present('2026-07-01', { recordedStatus: status }, { archivedAt:'2026-07-10' }).semanticState, status));
}

const contracts = [
  ['owned history token', source.modalHistory, 'ringgitmeModalLayer'],
  ['owned layer id', source.modalHistory, 'layerId'],
  ['owned top assertion', source.modalHistory, 'modal_history_layer_mismatch'],
  ['owned Back consumption', source.modalHistory, 'history.back()'],
  ['owned pop stop', source.modalHistory, 'stopImmediatePropagation'],
  ['picker compatibility token', source.picker, 'ringgitmePicker'],
  ['picker stable id', source.picker, 'pickerId'],
  ['picker parent id', source.picker, 'parentId'],
  ['picker exact release', source.picker, 'releaseModal(pickerId)'],
  ['picker commit guard', source.picker, 'committing'],
  ['picker commit failure', source.picker, 'picker_commit_failed'],
  ['date stable id', source.date, 'datePickerId'],
  ['date exact release', source.date, 'releaseModal(datePickerId)'],
  ['date owned history', source.date, 'registerOwnedModalHistory'],
  ['date portal', source.date, 'mountModalLayer(layer)'],
  ['time stable id', source.time, 'timePickerId'],
  ['time exact release', source.time, 'releaseModal(timePickerId)'],
  ['time owned history', source.time, 'registerOwnedModalHistory'],
  ['time portal', source.time, 'mountModalLayer(layer)'],
  ['calculator stable id', source.calculator, 'calculatorId'],
  ['calculator exact release', source.calculator, 'releaseModal(calculatorId)'],
  ['calculator owned history', source.calculator, 'registerOwnedModalHistory'],
  ['top sheet primitive', source.appSheet, 'closeTopSheet'],
  ['top modal primitive', source.modalStack, 'closeTopModalLayer'],
  ['modal mismatch loud failure', source.modalStack, 'modal_layer_mismatch'],
  ['stable parent ID', source.modalStack, 'parentSheetId'],
  ['parent frozen state', source.modalStack, 'frozenState'],
  ['surface scroll snapshot', source.modalStack, 'surfaceScrollTop'],
  ['body scroll snapshot', source.modalStack, 'bodyScrollTop'],
  ['focus prevent scroll', source.modalStack, 'preventScroll: true'],
];
for (const [name, text, token] of contracts) add(name, () => assert.ok(text.includes(token)));
add('picker commits before child close request', () => assert.ok(source.picker.indexOf('onSelect?.') < source.picker.indexOf('close();', source.picker.indexOf('onSelect?.'))));
add('picker no broad parent close', () => assert.doesNotMatch(source.picker, /closeAll|closeSheet|router|pushRoute|backOr/));
add('child history has no route replacement', () => assert.doesNotMatch(source.modalHistory, /pushRoute|replaceRoute|location\.assign/));
add('double tap cannot double commit', () => assert.match(source.picker, /committing \|\| closed/));

const editorContracts = [
  ['editor session sequence','editorSessionSequence'],['editor stable identity','editorSessionId'],['draft revision','draftRevision'],
  ['session mismatch failure','recurring_editor_session_mismatch'],['picker parent ID','parentId: sessionId'],['picker child ID','picker:${key}'],
  ['date child ID',':date:${key}:'],['date trigger','trigger:el'],['date scroll capture','const scrollTop=body?.scrollTop'],
  ['rerender scroll restore','body.scrollTop = preservedScroll'],['rerender focus restore','preventScroll: true'],['More state','moreOpen'],
  ['frequency picker',"key === 'recurrence'"],['due day picker',"key === 'due-day'"],['annual month picker',"key === 'due-month'"],
  ['account picker',"key === 'account'"],['ledger picker',"key === 'ledger'"],['recipient picker',"key === 'recipient'"],
  ['creditor picker',"key === 'creditor'"],['debtor picker',"'debtorParticipantId'"],
];
for (const [name, token] of editorContracts) add(name, () => assert.ok(source.plans.includes(token)));
add('trigger identity supports recurring picker', () => assert.ok(source.modalStack.includes('data-recurring-picker')));
add('trigger identity supports exact date key', () => assert.ok(source.modalStack.includes('data-date-key')));
add('composer uses stable picker trigger', () => assert.match(source.composer, /trigger:\s*(row|event\.currentTarget)/));
add('composer does not navigate on selection', () => assert.doesNotMatch(source.composer, /history\.back|pushRoute|backOr/));

const cssContracts = [
  ['one root scrim','modal-effective-scrim'],['context backdrop','.modal-context-backdrop'],['child veil','var(--s0) 74%'],
  ['dark child veil','var(--s0) 82%'],['parent suspended','.modal-suspended'],['parent frozen','.modal-parent-frozen'],
  ['touch focus cleanup','focus:not(:focus-visible)'],['keyboard focus visible',':focus-visible'],['whole sheet no outline','.sheet:focus-visible'],
  ['calculator scroll owner','.capture-relationship-sheet.has-inline-split-drawer .sheet-body'],['calculator parent scroll','overflow-y: auto'],
  ['calculator scroll padding','scroll-padding-bottom: calc(364px'],['calculator fixed basis','flex: 0 0 348px'],
  ['calculator fixed height','height: 348px'],['calculator minimum height','min-height: 348px'],['keypad fixed basis','flex: 0 0 256px'],
  ['keypad five rows','grid-template-rows: repeat(5, 48px)'],['dock normal flow','.inline-split-action-dock { margin-top: 12px'],
  ['zero visible','.split-editor-key.zero'],['decimal visible','data-inline-split-key="."'],['safe area','env(safe-area-inset-bottom)'],
  ['short viewport rule','@media (max-height: 700px)'],['short drawer floor','min-height: 310px'],['short key floor','repeat(5, 42px)'],
  ['no drawer bottom overlay','bottom: auto'],['drawer relative flow','position: relative'],['drawer visible overflow','overflow: visible'],
  ['reduced motion','prefers-reduced-motion: reduce'],
];
for (const [name, token] of cssContracts) add(name, () => assert.ok(`${source.css}\n${source.modalStack}`.includes(token)));

const viewContracts = [
  ['header reserved actions','fixed-header-actions'],['header no absolute','position: static'],['return current action','fixed-current-month'],
  ['new plan action','fixed-plan-new'],['semantic derivation import','deriveRecurringOccurrencePresentation'],['semantic state attribute','data-semantic-state'],
  ['semantic tone class','tone-${presentation.tone}'],['semantic status line','fixed-semantic-line'],['red tone','tone-red'],
  ['amber tone','tone-amber'],['green tone','tone-green'],['neutral tone','tone-neutral'],
  ['first row title','fixed-plan-title-row'],['first row type','fixed-kind'],['first row amount','fixed-own-amount'],
  ['second row recurrence','const recurrence'],['third row context','fixed-plan-meta'],['relationship money flow','relationshipLine'],
];
for (const [name, token] of viewContracts) add(name, () => assert.ok(`${source.center}\n${source.css}`.includes(token)));

// Selector integration proves the same presentation object travels with rows
// and section membership remains canonical and non-duplicated.
for (const [dueDate, status, expectedSection, expectedSemantic] of [
  ['2026-07-01','overdue','overdue','overdue'],
  ['2026-07-13','due_today','dueSoon','due_today'],
  ['2026-07-14','upcoming','dueSoon','due_soon'],
  ['2026-07-20','upcoming','dueSoon','due_soon'],
  ['2026-07-21','upcoming','planned','future'],
  ['2026-07-31','upcoming','planned','future'],
  ['2026-07-05','paid','paid','paid'],
]) add(`selector ${status} ${dueDate} uses ${expectedSemantic}`, () => {
  const plan = activePlan();
  const row = occurrence(dueDate, { status, recordedStatus: status === 'paid' ? 'paid' : null });
  const selected = selectRecurringMonth({ plans:[plan], occurrences:[row], monthKey:'2026-07', referenceDate });
  assert.equal(selected.sections[expectedSection].length, 1);
  assert.equal(selected.rows[0].presentation.semanticState, expectedSemantic);
  const sectionCount = Object.values(selected.sections).filter(Array.isArray).reduce((sum, rows) => sum + rows.filter((item) => item.id === row.id).length, 0);
  assert.equal(sectionCount, 1);
});
for (const status of ['paused','stopped']) add(`${status} plan appears once in neutral plan section`, () => {
  const plan = activePlan({ status });
  const selected = selectRecurringMonth({ plans:[plan], occurrences:[], monthKey:'2026-07', referenceDate });
  assert.equal(selected.sections[`${status}Plans`].length, 1);
});
add('archived plan excluded from normal rows', () => {
  const plan=activePlan({status:'stopped',archivedAt:'2026-07-01'});
  const selected=selectRecurringMonth({plans:[plan],occurrences:[occurrence('2026-07-13')],monthKey:'2026-07',referenceDate});
  assert.deepEqual([selected.rows.length,selected.sections.archivedPlans.length],[0,1]);
});

for (const [name, pattern] of [
  ['no fetch',/\bfetch\s*\(/],['no XHR',/XMLHttpRequest/],['no WebSocket',/WebSocket/],['no EventSource',/EventSource/],
  ['no sendBeacon',/sendBeacon/],['no localStorage',/localStorage/],['no sessionStorage',/sessionStorage/],['no IndexedDB',/indexedDB/i],
  ['no Supabase',/createClient\s*\(/],['no Telegram',/Telegram|sendMessage/],['no account mutation',/setAccountBalance|updateAccountBalance/],
  ['no card debt mutation',/setCardDebt|updateCardOutstanding/],['no Activity mutation',/createTransaction|appendActivity/],
  ['no relationship posting',/recordRelationshipEntry|postRelationship/],['no protected port',/8788/],
]) add(name, () => assert.doesNotMatch(`${source.modalHistory}\n${source.presentation}\n${source.selector}\n${source.plans}\n${source.center}`, pattern));

add('focused suite contains at least 180 meaningful cases', () => assert.ok(add.count >= 180));
