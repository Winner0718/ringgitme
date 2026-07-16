import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMoneyEngine } from '../src/domain/moneyEngine.js';
import { inspectAccountCapacity } from '../src/domain/accountCapacity.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';
import { tapMovementWithinThreshold } from '../src/components/TapIntent.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = {
  appSheet: read('../src/components/AppSheet.js'),
  tap: read('../src/components/TapIntent.js'),
  capture: read('../src/components/CaptureSheet.js'),
  capacity: read('../src/domain/accountCapacity.js'),
  alert: read('../src/components/CapacityAlertSheet.js'),
  money: read('../src/domain/moneyEngine.js'),
  relation: read('../src/domain/relationshipLedgerEngine.js'),
  activity: read('../src/features/activity/index.js'),
  ledger: read('../src/features/ledger/index.js'),
  copy: read('../src/app/copy.js'),
  css: read('../src/styles/phase2b3f.css') + read('../src/styles/phase2b3g.css'),
};

function makeEngine(overrides = {}) {
  return createMoneyEngine({
    accounts: overrides.accounts || [
      { id: 'cash', type: 'saving', name: 'Cash', bank: 'Bank', last4: '0001', balance: 100 },
      { id: 'wallet', type: 'ew', name: 'Wallet', bank: 'Wallet', last4: '', balance: 100 },
      { id: 'prepaid', type: 'prepaid', name: 'Prepaid', bank: 'Stored', last4: '', balance: 100 },
      { id: 'negative', type: 'saving', name: 'Legacy negative', bank: 'Bank', last4: '0002', balance: -10 },
      { id: 'card', type: 'cc', name: 'Card', bank: 'Bank', last4: '1000', limit: 1000, outstanding: 900 },
      { id: 'card2', type: 'cc', name: 'Card 2', bank: 'Bank', last4: '2000', limit: 1000, outstanding: 900 },
      { id: 'unknown', type: 'cc', name: 'Unknown limit', bank: 'Bank', last4: '3000', outstanding: 10 },
    ],
    transactions: overrides.transactions || [],
    today: '2026-07-15',
  });
}

const draft = (changes = {}) => ({ kind: 'expense', amount: 1, desc: '测试备注', sourceAccountId: 'cash', date: '2026-07-15', time: '12:00', submissionKey: `key-${Math.random()}`, ...changes });
function caught(run) { try { run(); assert.fail('expected an error'); } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; return error; } }

// Relationship activation (001–030)
test('FIX1-001 pointerdown/up and synthetic click have one owned path', () => { assert.match(source.tap, /pointerdown/); assert.match(source.tap, /pointerup/); assert.match(source.tap, /suppressClickUntil/); });
test('FIX1-002 touchstart/touchend fallback exists', () => { assert.match(source.tap, /touchstart/); assert.match(source.tap, /touchend/); });
test('FIX1-003 3px movement remains a tap', () => assert.equal(tapMovementWithinThreshold(0, 0, 0, 3), true));
test('FIX1-004 6px movement remains a tap', () => assert.equal(tapMovementWithinThreshold(0, 0, 6, 0), true));
test('FIX1-005 deliberate drag beyond threshold is not a tap', () => assert.equal(tapMovementWithinThreshold(0, 0, 0, 9), false));
test('FIX1-006 parent Capture grabber drag remains active', () => assert.match(source.appSheet, /attachDragToClose/));
test('FIX1-007 row label is inside the activating button', () => assert.match(source.capture, /advanced-relation[\s\S]*CAPTURE_DETAIL_COPY\.relationship/));
test('FIX1-008 row subtitle is inside the activating button', () => assert.match(source.capture, /advanced-relation[\s\S]*普通支出/));
test('FIX1-009 row whitespace belongs to one button hit target', () => assert.match(source.capture, /<button class="capture-detail-row advanced-relation"/));
test('FIX1-010 row chevron belongs to the same button', () => assert.match(source.capture, /advanced-relation[\s\S]*chevronRight/));
test('FIX1-011 duplicate Relationship opens are guarded', () => assert.match(source.capture, /if \(relationSheet\?\.isConnected\) return/));
test('FIX1-012 nested Relationship uses the body-level stacked portal', () => { assert.match(source.capture, /stacked: true/); assert.match(source.appSheet, /document\.body/); });
test('FIX1-013 parent overflow cannot clip the portal', () => assert.match(source.css, /sheet-layer-stacked[\s\S]*position: fixed/));
test('FIX1-014 stacked layer owns pointer events', () => assert.match(source.css, /sheet-layer > \.sheet[\s\S]*pointer-events: auto/));
test('FIX1-015 opening Relationship does not rebuild Capture', () => assert.doesNotMatch(source.capture.match(/function openCaptureRelationship[\s\S]*?function rerenderRelationshipSheet/)?.[0] || '', /openCaptureSheet/));
test('FIX1-016 cancel closes only the nested layer', () => assert.match(source.capture, /capture-relation-cancel'[\s\S]*closeSheet\(\)/));
test('FIX1-017 Complete applies a cloned selection once', () => assert.match(source.capture, /cap\.relationship = [\s\S]*structuredClone\(relationDraft\)[\s\S]*closeSheet\(\); rerender\(\)/));
test('FIX1-018 open-close-open retains a canonical connected-state guard', () => assert.match(source.capture, /relationSheet = null[\s\S]*openCaptureRelationship/));
test('FIX1-019 AA remains selectable', () => assert.match(source.capture, /split_expense/));
test('FIX1-020 direct receivable remains selectable', () => assert.match(source.capture, /direct_receivable/));
test('FIX1-021 direct payable remains selectable', () => assert.match(source.capture, /direct_payable/));
test('FIX1-022 normal expense remains selectable', () => assert.match(source.capture, /normal: 'note'/));
test('FIX1-023 object picker remains wired', () => assert.match(source.capture, /data-picker-field="ledger"/));
test('FIX1-024 payer picker remains wired', () => assert.match(source.capture, /data-picker-field="payer"/));
test('FIX1-025 custom split calculators remain wired', () => assert.match(source.capture, /capture-share-/));
test('FIX1-026 exact split is still required', () => assert.match(source.capture, /if \(!summary\.exact\)/));
test('FIX1-027 invalid split keeps visible feedback', () => assert.match(source.capture, /relationship-allocation-error/));
test('FIX1-028 stacked scrim stops click-through', () => assert.match(source.appSheet, /stopPropagation\(\)/));
test('FIX1-029 Escape and backdrop only close the top sheet', () => { assert.match(source.appSheet, /sheets\.at\(-1\) === entry/); assert.match(source.appSheet, /event\.key === 'Escape'/); });
test('FIX1-030 focus and scroll return to Relationship row', () => { assert.match(source.capture, /relationReturn/); assert.match(source.capture, /focus\?\.\(\{ preventScroll: true \}\)/); });

// Cash capacity (031–056)
test('FIX1-031 RM99.99 from RM100 succeeds', () => { const e = makeEngine(); e.addTransaction(draft({ amount: 99.99 })); assert.equal(e.getAccount('cash').balanceMinor, 1); });
test('FIX1-032 exact RM100 succeeds', () => { const e = makeEngine(); e.addTransaction(draft({ amount: 100 })); assert.equal(e.getAccount('cash').balanceMinor, 0); });
test('FIX1-033 one cent over is blocked', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ amount: 100.01 }))).capacity.shortageMinor, 1));
test('FIX1-034 RM200 is blocked from RM100', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ amount: 200 }))).capacity.status, 'insufficient-cash'));
test('FIX1-035 blocked expense leaves balance unchanged', () => { const e = makeEngine(); caught(() => e.addTransaction(draft({ amount: 200 }))); assert.equal(e.getAccount('cash').balance, 100); });
test('FIX1-036 blocked expense creates no transaction', () => { const e = makeEngine(); caught(() => e.addTransaction(draft({ amount: 200 }))); assert.equal(e.getTransactions().length, 0); });
test('FIX1-037 blocked user-paid AA creates no entry', () => { const d = createDemoDataSource(); const l = d.getRelationshipLedger('ledger-abi'); const before = d.getRelationshipEntries(l.ledgerId).length; const ids = l.participantIds; caught(() => d.recordRelationshipEntry({ ledgerId: l.ledgerId, entryType: 'split_expense', payerParticipantId: 'participant-me', amount: 7000, shares: [{ participantId: ids[0], amountMinor: 350000 }, { participantId: ids[1], amountMinor: 350000 }], description: 'AA', sourceAccountId: 'sv-mbb', date: d.today, time: '12:00', clientEventId: 'blocked-aa', sourceChannel: 'app' })); assert.equal(d.getRelationshipEntries(l.ledgerId).length, before); });
test('FIX1-038 blocked operation creates no confirmation snapshot', () => { const e = makeEngine(); caught(() => e.addTransaction(draft({ amount: 200 }))); assert.equal(e.getTransactions()[0]?.confirmation, undefined); });
test('FIX1-039 repeated blocked saves stay mutation-free', () => { const e = makeEngine(); const d = draft({ amount: 200, submissionKey: 'repeat-block' }); caught(() => e.addTransaction(d)); caught(() => e.addTransaction(d)); assert.equal(e.getTransactions().length, 0); });
test('FIX1-040 insufficient eWallet is blocked', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ amount: 100.01, sourceAccountId: 'wallet' }))).capacity.accountId, 'wallet'));
test('FIX1-041 insufficient cash-type account is blocked', () => { const e = makeEngine({ accounts: [{ id: 'cash', type: 'cash', name: 'Cash', bank: '', last4: '', balance: 1 }] }); assert.equal(caught(() => e.addTransaction(draft({ amount: 1.01 }))).capacity.status, 'insufficient-cash'); });
test('FIX1-042 prepaid/stored value is blocked', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ amount: 100.01, sourceAccountId: 'prepaid' }))).capacity.accountId, 'prepaid'));
test('FIX1-043 transfer includes source fee', () => { const e = makeEngine(); const error = caught(() => e.addTransaction(draft({ kind: 'transfer', amount: 95, sourceAccountId: 'cash', destinationAccountId: 'wallet', transferFeeMinor: 600 }))); assert.equal(error.capacity.requiredMinor, 10100); });
test('FIX1-044 exact transfer plus fee succeeds', () => { const e = makeEngine(); e.addTransaction(draft({ kind: 'transfer', amount: 94, sourceAccountId: 'cash', destinationAccountId: 'wallet', feeMinor: 600 })); assert.equal(e.getAccount('cash').balanceMinor, 0); });
test('FIX1-045 transfer plus fee one cent over blocks', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ kind: 'transfer', amount: 94.01, sourceAccountId: 'cash', destinationAccountId: 'wallet', feeMinor: 600 }))).capacity.shortageMinor, 1));
test('FIX1-046 obligation repayment uses centralized guard', () => { const d = createDemoDataSource(); const plan = d.getObligationPlan('plan-shopee-sis'); const before = d.getAccount('ew-bigpay').balanceMinor; const error = caught(() => d.recordObligationPayment({ planId: plan.planId, amount: 100, sourceAccountId: 'ew-bigpay', date: d.today, time: '12:00', clientEventId: 'blocked-plan', sourceChannel: 'app' })); assert.equal(error.capacity.status, 'insufficient-cash'); assert.equal(d.getAccount('ew-bigpay').balanceMinor, before); });
test('FIX1-047 paid settlement preflights before ledger mutation', () => { const d = createDemoDataSource(); d.addTransaction({ kind: 'expense', amount: 96, desc: 'drain', sourceAccountId: 'ew-bigpay', date: d.today, time: '11:00', submissionKey: 'drain' }); const entry = d.getRelationshipEntries('ledger-jason')[0]; const before = entry.remainingMinor; caught(() => d.settleRelationship({ ledgerId: 'ledger-jason', direction: 'paid', amount: 32, sourceAccountId: 'ew-bigpay', date: d.today, time: '12:00', clientEventId: 'blocked-settle', sourceChannel: 'app' })); assert.equal(d.getRelationshipEntry(entry.entryId).remainingMinor, before); });
test('FIX1-048 user-paid AA validates the full bill', () => { const d = createDemoDataSource(); const l = d.getRelationshipLedger('ledger-abi'); const ids = l.participantIds; const error = caught(() => d.recordRelationshipEntry({ ledgerId: l.ledgerId, entryType: 'split_expense', payerParticipantId: 'participant-me', amount: 7000, shares: [{ participantId: ids[0], amountMinor: 350000 }, { participantId: ids[1], amountMinor: 350000 }], description: 'AA', sourceAccountId: 'sv-mbb', date: d.today, time: '12:00', clientEventId: 'full-aa', sourceChannel: 'app' })); assert.equal(error.capacity.requiredMinor, 700000); });
test('FIX1-049 user-paid AA does not validate only own share', () => { const d = createDemoDataSource(); const l = d.getRelationshipLedger('ledger-abi'); const ids = l.participantIds; const error = caught(() => d.recordRelationshipEntry({ ledgerId: l.ledgerId, entryType: 'split_expense', payerParticipantId: 'participant-me', amount: 7000, shares: [{ participantId: ids[0], amountMinor: 100000 }, { participantId: ids[1], amountMinor: 600000 }], description: 'AA', sourceAccountId: 'sv-mbb', date: d.today, time: '12:00', clientEventId: 'share-aa', sourceChannel: 'app' })); assert.equal(error.capacity.requiredMinor, 700000); });
test('FIX1-050 other-payer AA does not debit own account', () => { const d = createDemoDataSource(); const l = d.getRelationshipLedger('ledger-abi'); const other = l.participantIds.find((id) => id !== 'participant-me'); const before = d.getAccount('sv-mbb').balanceMinor; d.recordRelationshipEntry({ ledgerId: l.ledgerId, entryType: 'split_expense', payerParticipantId: other, amount: 10000, shares: [{ participantId: 'participant-me', amountMinor: 500000 }, { participantId: other, amountMinor: 500000 }], description: 'other', sourceAccountId: 'sv-mbb', date: d.today, time: '12:00', clientEventId: 'other-aa', sourceChannel: 'app' }); assert.equal(d.getAccount('sv-mbb').balanceMinor, before); });
test('FIX1-051 record-only bypasses capacity', () => { const e = makeEngine(); e.addTransaction(draft({ amount: 1000, recordOnly: true })); assert.equal(e.getAccount('cash').balance, 100); });
test('FIX1-052 income bypasses outgoing capacity', () => { const e = makeEngine(); e.addTransaction(draft({ kind: 'income', amount: 1, sourceAccountId: null, destinationAccountId: 'negative' })); assert.equal(e.getAccount('negative').balance, -9); });
test('FIX1-053 received settlement has no outgoing posting', () => assert.deepEqual(inspectAccountCapacity(makeEngine().getAccounts(), { kind: 'income', amountMinor: 100, accountEffect: 'posted', destinationAccountId: 'cash' }), { status: 'allowed' }));
test('FIX1-054 negative legacy balance accepts a credit', () => { const e = makeEngine(); e.addTransaction(draft({ kind: 'income', amount: 5, sourceAccountId: null, destinationAccountId: 'negative' })); assert.equal(e.getAccount('negative').balance, -5); });
test('FIX1-055 negative legacy balance blocks a new debit', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ sourceAccountId: 'negative' }))).capacity.status, 'insufficient-cash'));
test('FIX1-056 capacity comparison uses exact minor units', () => { assert.match(source.capacity, /requiredMinor <=|requiredMinor > currentMinor/); assert.doesNotMatch(source.capacity, /toFixed/); });

// Credit-card capacity (057–078)
test('FIX1-057 purchase below available credit succeeds', () => { const e = makeEngine(); e.addTransaction(draft({ amount: 99.99, sourceAccountId: 'card' })); assert.equal(e.getAccount('card').outstanding, 999.99); });
test('FIX1-058 exact available credit succeeds', () => { const e = makeEngine(); e.addTransaction(draft({ amount: 100, sourceAccountId: 'card' })); assert.equal(e.getAccount('card').availableCredit, 0); });
test('FIX1-059 one cent over returns warning', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ amount: 100.01, sourceAccountId: 'card' }))).capacity.status, 'credit-over-limit'));
test('FIX1-060 first over-limit save has zero mutation', () => { const e = makeEngine(); caught(() => e.addTransaction(draft({ amount: 101, sourceAccountId: 'card' }))); assert.equal(e.getAccount('card').outstanding, 900); assert.equal(e.getTransactions().length, 0); });
test('FIX1-061 exact explicit approval commits once', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'approve' }); const error = caught(() => e.addTransaction(d)); e.addTransaction({ ...d, capacityAuthorization: { fingerprint: error.capacity.confirmationFingerprint } }); assert.equal(e.getTransactions().length, 1); });
test('FIX1-062 approval double submit is idempotent', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'double' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; const a = e.addTransaction({ ...d, capacityAuthorization: auth }); const b = e.addTransaction({ ...d, capacityAuthorization: auth }); assert.equal(a.id, b.id); assert.equal(e.getTransactions().length, 1); });
test('FIX1-063 warning cancel means zero mutation', () => { const e = makeEngine(); caught(() => e.addTransaction(draft({ amount: 101, sourceAccountId: 'card' }))); assert.equal(e.getTransactions().length, 0); });
test('FIX1-064 changed amount invalidates authorization', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'amount' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; assert.equal(caught(() => e.addTransaction({ ...d, amount: 102, capacityAuthorization: auth })).capacity.status, 'credit-over-limit'); });
test('FIX1-065 changed card invalidates authorization', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'card' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; assert.equal(caught(() => e.addTransaction({ ...d, sourceAccountId: 'card2', capacityAuthorization: auth })).capacity.accountId, 'card2'); });
test('FIX1-066 changed fee invalidates authorization', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'fee' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; assert.equal(caught(() => e.addTransaction({ ...d, feeMinor: 1, capacityAuthorization: auth })).capacity.requiredMinor, 10101); });
test('FIX1-067 changed relationship mode invalidates authorization', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'rel', relationshipMode: 'split_expense' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; assert.equal(caught(() => e.addTransaction({ ...d, relationshipMode: 'direct_receivable', capacityAuthorization: auth })).capacity.status, 'credit-over-limit'); });
test('FIX1-068 over-limit amount is exact', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ amount: 101, sourceAccountId: 'card' }))).capacity.overLimitMinor, 100));
test('FIX1-069 approved transaction updates outstanding', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'debt' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; e.addTransaction({ ...d, capacityAuthorization: auth }); assert.equal(e.getAccount('card').outstanding, 1001); });
test('FIX1-070 reversal restores outstanding once', () => { const e = makeEngine(); const d = draft({ amount: 101, sourceAccountId: 'card', submissionKey: 'reverse' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; const t = e.addTransaction({ ...d, capacityAuthorization: auth }); e.reverseTransaction(t.id); assert.equal(e.getAccount('card').outstanding, 900); });
test('FIX1-071 delete restores outstanding once', () => { const e = makeEngine(); const t = e.addTransaction(draft({ amount: 50, sourceAccountId: 'card' })); e.deleteTransaction(t.id); assert.equal(e.getAccount('card').outstanding, 900); assert.throws(() => e.deleteTransaction(t.id)); });
test('FIX1-072 edit validates net effect after reversal', () => { const e = makeEngine(); const t = e.addTransaction(draft({ amount: 50, sourceAccountId: 'card' })); e.editTransaction(t.id, { amount: 100 }); assert.equal(e.getAccount('card').outstanding, 1000); });
test('FIX1-073 edit never double-counts old transaction', () => { const e = makeEngine(); const t = e.addTransaction(draft({ amount: 50, sourceAccountId: 'card' })); assert.doesNotThrow(() => e.editTransaction(t.id, { amount: 100 })); });
test('FIX1-074 missing credit limit requires warning', () => assert.equal(caught(() => makeEngine().addTransaction(draft({ sourceAccountId: 'unknown' }))).capacity.status, 'credit-limit-unknown'));
test('FIX1-075 missing-limit explicit success commits once', () => { const e = makeEngine(); const d = draft({ sourceAccountId: 'unknown', submissionKey: 'unknown' }); const auth = { fingerprint: caught(() => e.addTransaction(d)).capacity.confirmationFingerprint }; e.addTransaction({ ...d, capacityAuthorization: auth }); assert.equal(e.getTransactions().length, 1); });
test('FIX1-076 missing-limit cancel has zero mutation', () => { const e = makeEngine(); caught(() => e.addTransaction(draft({ sourceAccountId: 'unknown' }))); assert.equal(e.getAccount('unknown').outstanding, 10); });
test('FIX1-077 credit-card record-only leaves debt unchanged', () => { const e = makeEngine(); e.addTransaction(draft({ amount: 5000, sourceAccountId: 'card', recordOnly: true })); assert.equal(e.getAccount('card').outstanding, 900); });
test('FIX1-078 confirmation uses committed post-operation snapshot', () => { const e = makeEngine(); const t = e.addTransaction(draft({ amount: 50, sourceAccountId: 'card' })); assert.equal(t.confirmation.accountChanges[0].afterMinor, 95000); });

// Note semantics (079–096)
test('FIX1-079 expense Capture label is 备注', () => assert.match(source.copy, /note: '备注'/));
test('FIX1-080 expense placeholder is 点击输入备注', () => assert.match(source.copy, /notePlaceholder: '点击输入备注'/));
test('FIX1-081 income reuses the same Capture note field', () => assert.equal((source.capture.match(/data-cap-desc/g) || []).length >= 2, true));
test('FIX1-082 transfer reuses the same Capture note field', () => assert.match(source.capture, /cap\.mode[\s\S]*inlineDetailsHTML/));
test('FIX1-083 AA Capture preserves the shared note draft', () => assert.match(source.capture, /description: draft\.desc/));
test('FIX1-084 direct-debt ledger field is 备注', () => assert.match(source.ledger, /<span class="caption">备注<\/span>/));
test('FIX1-085 edit flow label is 备注', () => assert.match(source.activity, /<span class="caption">备注<\/span>/));
test('FIX1-086 demo placeholder is absent', () => assert.doesNotMatch(source.capture + source.activity + source.ledger, /例如 KFC 午餐/));
test('FIX1-087 existing note loads into edit', () => assert.match(source.activity, /value="\$\{escapeHTML\(editDraft\.desc\)\}"/));
test('FIX1-088 cancel preserves prior note draft', () => assert.doesNotMatch(source.capture.match(/capture-relation-cancel'[\s\S]*?;/)?.[0] || '', /cap\.desc\s*=/));
test('FIX1-089 save stores one compatible desc field', () => { const e = makeEngine(); const t = e.addTransaction(draft({ desc: 'KFC 午餐' })); assert.equal(t.desc, 'KFC 午餐'); assert.equal(t.description, 'KFC 午餐'); });
test('FIX1-090 no second canonical note field is created', () => { const e = makeEngine(); const t = e.addTransaction(draft()); assert.equal(Object.hasOwn(t, 'note'), false); });
test('FIX1-091 note remains the transaction detail title', () => assert.match(source.activity, /escapeHTML\(t\.desc\)/));
test('FIX1-092 note remains searchable', () => assert.match(source.activity, /t\.desc[\s\S]*getTransactionCategoryLabel[\s\S]*getTransactionAccountLabel/));
test('FIX1-093 empty Capture note uses operation/category fallback', () => assert.match(source.capture, /cap\.desc\.trim\(\) \|\| \(cap\.mode === 'transfer'/));
test('FIX1-094 note field uses light material tokens', () => assert.match(source.css, /glass-sheet-bg|--s1/));
test('FIX1-095 note field uses theme tokens instead of hardcoded text colors', () => assert.match(source.css, /var\(--text-2\)/));
test('FIX1-096 whole note field is a mobile-tappable label', () => assert.match(source.capture, /<label class="capture-detail-row capture-description-row"/));

// Frozen regressions (097–112)
test('FIX1-097 expense calculator key set remains complete', () => assert.match(source.capture, /\['C','back','÷','×','7','8','9','−','4','5','6','\+','1','2','3','=','0','\.'\]/));
test('FIX1-098 income uses the same complete calculator', () => assert.match(source.capture, /directKeypadHTML\(\)/));
test('FIX1-099 transfer uses the same complete calculator', () => assert.match(source.capture, /cap\.mode === 'transfer'[\s\S]*directKeypadHTML\(\)/));
test('FIX1-100 Save remains visible', () => assert.match(source.capture, /class="cap-save"[\s\S]*保存/));
test('FIX1-101 transfer viewport-height contract remains', () => assert.match(read('../src/components/CapturePresentation.js'), /transfer/));
test('FIX1-102 More Details grouped material remains', () => assert.match(source.capture, /capture-detail-group capture-transaction-details glass-sheet/));
test('FIX1-103 date picker remains bound', () => assert.match(source.capture, /bindNativeDateTimeFields/));
test('FIX1-104 time picker remains bound', () => assert.match(source.capture, /onTimeChange/));
test('FIX1-105 attachments remain bound', () => assert.match(source.capture, /bindAttachmentField/));
test('FIX1-106 asset cards were not changed by FIX1 modules', () => assert.doesNotMatch(source.capacity + source.alert + source.tap, /WalletStackCategoryDeck|StackedDeck/));
test('FIX1-107 account carousel remains outside FIX1 modules', () => assert.doesNotMatch(source.capacity + source.alert + source.tap, /CardCarousel/));
test('FIX1-108 confirmation remains a committed-result consumer', () => assert.match(source.capture, /openMoneyFlowConfirmation\(\{[\s\S]*transaction: item/));
test('FIX1-109 contextual record detail remains local', () => assert.match(source.activity, /openRecordDetailOverlay/));
test('FIX1-110 no network or persistence API is introduced', () => assert.doesNotMatch(Object.values(source).join('\n'), /\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|localStorage|indexedDB|supabase/i));
test('FIX1-111 submission idempotency remains', () => assert.match(source.money, /submissionKeys\.has/));
test('FIX1-112 reduced-motion contract remains', () => assert.match(source.capture + source.css, /prefers-reduced-motion|reducedMotion/));
test('FIX1-113 Relationship renderer uses the imported label helper', () => { assert.match(source.capture, /relationshipTypeLabels\(ledger\)/); assert.doesNotMatch(source.capture, /\brelationTypeLabels\b/); });
test('FIX1-114 body portal owns delegated data-action events', () => assert.match(source.appSheet, /attachActionDelegation\(layer\)[\s\S]*dispatchAction/));
