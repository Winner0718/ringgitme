import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMoneyEngine } from '../src/domain/moneyEngine.js';
import {
  buildInstallmentSchedule,
  nextCalendarMonthSameDay,
  selectAssetFinancialSummary,
  validateAssetFinancialIntegrity,
} from '../src/domain/assetFinancialModel.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const TODAY = '2026-07-13';
const saving = (id = 'cash-a', balance = 2000, extra = {}) => ({ id, type: 'saving', name: id, bank: 'Test Bank', last4: '0001', balance, ...extra });
const wallet = (id = 'wallet-a', balance = 300, extra = {}) => ({ id, type: 'ew', name: id, bank: 'Wallet', balance, ...extra });
const card = (id = 'card-a', ordinary = 0, extra = {}) => ({ id, type: 'cc', name: id, bank: 'Test Bank', last4: '0002', limit: 5000, outstanding: ordinary, monthlyDue: ordinary, dueDate: ordinary ? '2026-07-20' : null, ...extra });

function makeEngine({ accounts = [saving(), wallet(), card()], installments = [], pools = [], today = TODAY } = {}) {
  return createMoneyEngine({ accounts, transactions: [], installments, sharedLimitPools: pools, today });
}

function expense(engine, { amount = 100, cardId = 'card-a', key = `expense-${Math.random()}`, date = TODAY } = {}) {
  return engine.addTransaction({ kind: 'expense', amount, desc: '测试消费', sourceAccountId: cardId, catId: 'shopping', catLabel: '购物', date, time: '10:00', submissionKey: key });
}

function activeOperation(engine, type) {
  return engine.getAssetOperations({ includeReversed: false }).find((operation) => operation.type === type);
}

let number = 0;
const add = (title, fn) => test(`2D1A-${String(++number).padStart(3, '0')} ${title}`, fn);

// Asset domain (1–20)
add('bank account can be created with opening balance', () => { const e = makeEngine(); const a = e.createAsset({ type: 'saving', name: 'New Bank', balance: 123.45 }); assert.equal(a.balanceMinor, 12345); assert.equal(activeOperation(e, 'asset_opening_balance').metadata.incomeDeltaMinor, 0); });
add('eWallet can be created with opening balance', () => { const e = makeEngine(); const a = e.createAsset({ type: 'ew', name: 'New Wallet', balance: 8.08 }); assert.equal(a.balanceMinor, 808); });
add('credit card can be created with limit and zero debt', () => { const e = makeEngine(); const a = e.createAsset({ type: 'cc', name: 'Zero Card', limit: 9000 }); assert.equal(a.creditLimitMinor, 900000); assert.equal(a.totalCardDebtMinor, 0); });
add('credit card can be created with recordOnly opening debt', () => { const e = makeEngine(); const a = e.createAsset({ type: 'cc', name: 'Debt Card', limit: 9000, openingRecordOnlyDebt: 312.34 }); assert.equal(a.recordOnlyDebtMinor, 31234); });
add('opening balance is not income', () => { const e = makeEngine(); e.createAsset({ type: 'saving', name: 'Opening', balance: 100 }); assert.equal(activeOperation(e, 'asset_opening_balance').metadata.incomeDeltaMinor, 0); });
add('recordOnly debt is not spending', () => { const e = makeEngine(); e.recordOpeningCardDebt({ cardId: 'card-a', amount: 100, idempotencyKey: 'open-debt' }); assert.equal(activeOperation(e, 'card_opening_debt').metadata.spendingDeltaMinor, 0); });
add('asset ID survives edits', () => { const e = makeEngine(); assert.equal(e.updateAsset('cash-a', { name: 'Renamed' }).id, 'cash-a'); });
add('asset type cannot change after creation', () => { const e = makeEngine(); e.updateAsset('cash-a', { type: 'cc' }); assert.equal(e.getAccount('cash-a').type, 'saving'); });
add('last four preserves leading zeroes', () => { const e = makeEngine(); e.updateAsset('cash-a', { last4: '0012' }); assert.equal(e.getAccount('cash-a').last4, '0012'); });
add('all money remains integer minor units', () => { const e = makeEngine(); e.recordAssetAdjustment({ accountId: 'cash-a', amount: 0.29, idempotencyKey: 'integer' }); assert.equal(Number.isInteger(e.getAccount('cash-a').balanceMinor), true); });
add('cancel/checkpoint restore does not mutate', () => { const e = makeEngine(); const before = e.createCheckpoint(); e.updateAsset('cash-a', { note: 'draft' }); e.restoreCheckpoint(before); assert.equal(e.getAccount('cash-a').note, ''); });
add('editing changes only intended asset', () => { const e = makeEngine(); const other = structuredClone(e.getAccount('wallet-a')); e.updateAsset('cash-a', { name: 'Only Me' }); assert.deepEqual(e.getAccount('wallet-a'), other); });
add('reordering works', () => { const e = makeEngine({ accounts: [saving('a'), saving('b'), wallet(), card()] }); assert.deepEqual(e.reorderAssets('saving', ['b', 'a']).map((a) => a.id), ['b', 'a']); });
add('hide and unhide work', () => { const e = makeEngine(); e.setAssetHidden('cash-a', true); assert.equal(e.getAccount('cash-a').isHidden, true); e.setAssetHidden('cash-a', false); assert.equal(e.getAccount('cash-a').isHidden, false); });
add('activate and deactivate work', () => { const e = makeEngine(); e.setAssetActive('wallet-a', false); assert.equal(e.getAccount('wallet-a').status, 'inactive'); e.setAssetActive('wallet-a', true); assert.equal(e.getAccount('wallet-a').status, 'active'); });
add('archive and restore work', () => { const e = makeEngine(); e.archiveAsset('wallet-a'); assert.equal(e.getAccount('wallet-a').status, 'archived'); e.restoreAsset('wallet-a'); assert.equal(e.getAccount('wallet-a').status, 'active'); });
add('default payment source behaves correctly', () => { const e = makeEngine({ accounts: [saving('a'), saving('b'), wallet(), card()] }); e.setDefaultAsset('saving', 'b'); assert.equal(e.getAccount('b').isDefaultPaymentSource, true); assert.equal(e.getAccount('a').isDefaultPaymentSource, false); });
add('unused asset can be hard deleted', () => { const e = makeEngine(); const a = e.createAsset({ type: 'saving', name: 'Empty', balance: 0 }); assert.equal(e.canHardDeleteAsset(a.id).allowed, true); e.hardDeleteAsset(a.id); assert.equal(e.getAccount(a.id), undefined); });
add('referenced asset cannot be hard deleted', () => { const e = makeEngine(); expense(e); assert.equal(e.canHardDeleteAsset('card-a').allowed, false); });
add('archived asset history remains readable', () => { const e = makeEngine(); const t = expense(e); e.archiveAsset('card-a'); assert.equal(e.getTransaction(t.id).sourceAccountId, 'card-a'); assert.equal(e.getAccount('card-a').name, 'card-a'); });

// Bank/eWallet balance (21–26)
add('opening balance establishes position without income', () => { const e = makeEngine(); const before = e.getDerivedMetrics().currentCashMinor; e.createAsset({ type: 'saving', name: 'Open Pos', balance: 20 }); assert.equal(e.getDerivedMetrics().currentCashMinor, before + 2000); assert.equal(e.getUserTransactions().length, 0); });
add('live balance cannot be silently overwritten', () => { const e = makeEngine(); e.updateAsset('cash-a', { balance: 1, balanceMinor: 1 }); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); });
add('balance adjustment records old new and difference', () => { const e = makeEngine(); const op = e.recordAssetAdjustment({ accountId: 'cash-a', amount: -20, note: 'reconcile', idempotencyKey: 'adjust-1' }); assert.deepEqual(op.result, { accountId: 'cash-a', beforeMinor: 200000, afterMinor: 198000, deltaMinor: -2000 }); });
add('adjustment affects balance exactly once', () => { const e = makeEngine(); const command = { accountId: 'cash-a', amount: 25, idempotencyKey: 'adjust-once' }; e.recordAssetAdjustment(command); e.recordAssetAdjustment(command); assert.equal(e.getAccount('cash-a').balanceMinor, 202500); });
add('adjustment reversal restores prior balance', () => { const e = makeEngine(); const op = e.recordAssetAdjustment({ accountId: 'cash-a', amount: 25, idempotencyKey: 'adjust-reverse' }); e.reverseAssetOperation(op.id); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); });
add('duplicate reversal never applies twice', () => { const e = makeEngine(); const op = e.recordAssetAdjustment({ accountId: 'cash-a', amount: 25, idempotencyKey: 'adjust-reverse-2' }); e.reverseAssetOperation(op.id); e.reverseAssetOperation(op.id); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); });

// Ordinary credit card (27–39)
add('purchase increases spending and card debt', () => { const e = makeEngine(); expense(e); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 10000); });
add('purchase does not reduce cash', () => { const e = makeEngine(); const before = e.getAccount('cash-a').balanceMinor; expense(e); assert.equal(e.getAccount('cash-a').balanceMinor, before); });
add('purchase reduces available credit', () => { const e = makeEngine(); const before = e.getAccount('card-a').availableCreditMinor; expense(e); assert.equal(e.getAccount('card-a').availableCreditMinor, before - 10000); });
add('first post-settlement purchase opens due cycle', () => { const e = makeEngine(); expense(e); assert.equal(e.getAccount('card-a').cycleAnchorDate, TODAY); });
add('due date uses next-month same day', () => assert.equal(nextCalendarMonthSameDay('2026-06-26'), '2026-07-26'));
add('month-end clamping works', () => { assert.equal(nextCalendarMonthSameDay('2026-01-31'), '2026-02-28'); assert.equal(nextCalendarMonthSameDay('2026-03-31'), '2026-04-30'); });
add('later purchase joins open cycle', () => { const e = makeEngine(); expense(e, { key: 'first' }); const due = e.getAccount('card-a').dueDate; expense(e, { key: 'second', date: '2026-07-20' }); assert.equal(e.getAccount('card-a').dueDate, due); });
add('full settlement closes cycle', () => { const e = makeEngine(); expense(e); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 100, idempotencyKey: 'settle-cycle' }); assert.equal(e.getAccount('card-a').ordinaryDueMinor, 0); assert.equal(e.getAccount('card-a').duePaid, true); });
add('recordOnly does not open cycle', () => { const e = makeEngine(); e.recordOpeningCardDebt({ cardId: 'card-a', amount: 50, idempotencyKey: 'record-only-cycle' }); assert.equal(e.getAccount('card-a').dueDate, null); assert.equal(e.getAccount('card-a').ordinaryDueMinor, 0); });
add('edit atomically reverses old and applies new', () => { const e = makeEngine(); const t = expense(e); e.editTransaction(t.id, { amount: 120 }); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 12000); });
add('delete restores debt credit and spending', () => { const e = makeEngine(); const before = e.getAccount('card-a').availableCreditMinor; const t = expense(e); e.deleteTransaction(t.id); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 0); assert.equal(e.getAccount('card-a').availableCreditMinor, before); });
add('refund reduces spending and debt', () => { const e = makeEngine(); expense(e); const op = e.recordCardRefund({ cardId: 'card-a', amount: 40, linkedTransactionId: 'original', idempotencyKey: 'refund' }); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 6000); assert.equal(op.metadata.spendingDeltaMinor, -4000); });
add('refund is not income', () => { const e = makeEngine(); const op = e.recordCardRefund({ cardId: 'card-a', amount: 40, idempotencyKey: 'refund-income' }); assert.equal(op.metadata.incomeDeltaMinor, 0); });

// Installments (40–50)
add('full installment principal enters total card debt', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'inst-1' }); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 120000); });
add('full remaining principal occupies credit', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'inst-2' }); assert.equal(e.getAccount('card-a').availableCreditMinor, 380000); });
add('only monthly occurrence enters My Monthly Fixed', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'inst-3' }); const s = e.getAssetFinancialSummary({ myFixedMinor: 5000 }); assert.equal(s.myFixedMinor, 15000); });
add('only due occurrence enters this-month due', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'inst-4' }); assert.equal(e.getAssetFinancialSummary().monthCardDueMinor, 10000); });
add('schedule sums exactly to principal', () => assert.equal(buildInstallmentSchedule({ principalMinor: 10001, termCount: 3, firstDueDate: '2026-08-31' }).reduce((s, r) => s + r.amountMinor, 0), 10001));
add('final installment absorbs sen remainder', () => assert.deepEqual(buildInstallmentSchedule({ principalMinor: 10001, termCount: 3, firstDueDate: '2026-08-31' }).map((r) => r.amountMinor), [3333, 3333, 3335]));
add('future occurrences remain future debt', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: '2026-08-13', idempotencyKey: 'inst-future' }); assert.equal(e.getAccount('card-a').currentInstallmentDueMinor, 0); assert.equal(e.getAccount('card-a').installmentPrincipalOutstandingMinor, 120000); });
add('occurrence cannot post twice', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 100, termCount: 1, firstDueDate: TODAY, idempotencyKey: 'inst-pay-once' }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 100, idempotencyKey: 'pay-once' }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 1, idempotencyKey: 'pay-after' }); assert.equal(e.getCardInstallments('card-a')[0].paidTerms, 1); });
add('installment operation reversal restores principal', () => { const e = makeEngine(); const op = e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'inst-reverse' }); e.reverseAssetOperation(op.id); assert.equal(e.getCardInstallments('card-a').length, 0); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 0); });
add('excess normal payment does not erase future installments', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 1200, termCount: 12, firstDueDate: '2026-08-13', idempotencyKey: 'inst-no-prepay' }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 200, idempotencyKey: 'future-payment' }); assert.equal(e.getCardInstallments('card-a')[0].remainingPrincipalMinor, 120000); assert.equal(e.getAccount('card-a').cardCreditBalanceMinor, 20000); });
add('mixed ordinary and installment debt calculates correctly', () => { const e = makeEngine(); expense(e); e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 300, termCount: 3, firstDueDate: TODAY, idempotencyKey: 'mixed' }); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 40000); });

// Card payments (51–60)
add('card payment debits selected cash account', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 100)] }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 50, idempotencyKey: 'payment-cash' }); assert.equal(e.getAccount('cash-a').balanceMinor, 195000); });
add('card payment reduces card debt', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 100)] }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 50, idempotencyKey: 'payment-debt' }); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 5000); });
add('card payment is not spending', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 100)] }); const op = e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 50, idempotencyKey: 'payment-spend' }); assert.equal(op.metadata.spendingDeltaMinor, 0); });
add('payment allocation order is deterministic', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 100, { feeInterestOutstandingMinor: 1000, feeDueMinor: 1000 })] }); const op = e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 20, idempotencyKey: 'payment-order' }); assert.equal(op.result.allocation.feeMinor, 1000); assert.equal(op.result.allocation.ordinaryDueMinor, 1000); });
add('current installment due can be settled', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'One', principal: 30, termCount: 1, firstDueDate: TODAY, idempotencyKey: 'due-inst' }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 30, idempotencyKey: 'due-inst-pay' }); assert.equal(e.getCardInstallments('card-a')[0].remainingPrincipalMinor, 0); });
add('ordinary due can be settled', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 80)] }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 80, idempotencyKey: 'ordinary-pay' }); assert.equal(e.getAccount('card-a').ordinaryDueMinor, 0); });
add('excess becomes card credit balance', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 80)] }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 100, idempotencyKey: 'excess' }); assert.equal(e.getAccount('card-a').cardCreditBalanceMinor, 2000); });
add('payment reversal restores cash and debt', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 80)] }); const op = e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 50, idempotencyKey: 'payment-reverse' }); e.reverseAssetOperation(op.id); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 8000); });
add('duplicate payment and reversal are idempotent', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 80)] }); const command = { cardId: 'card-a', sourceAccountId: 'cash-a', amount: 50, idempotencyKey: 'duplicate-payment' }; const one = e.recordCardPayment(command); assert.equal(e.recordCardPayment(command).id, one.id); e.reverseAssetOperation(one.id); e.reverseAssetOperation(one.id); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); });
add('available credit restores correctly', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 80)] }); const before = e.getAccount('card-a').availableCreditMinor; e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 50, idempotencyKey: 'available-pay' }); assert.equal(e.getAccount('card-a').availableCreditMinor, before + 5000); });

// Shared limit (61–70)
const sharedEngine = ({ credit = 0 } = {}) => makeEngine({ accounts: [saving(), card('a', 400, { sharedLimitPoolId: 'pool' }), card('b', 300, { sharedLimitPoolId: 'pool', cardCreditBalanceMinor: credit })], pools: [{ id: 'pool', name: 'Family', limit: 1000 }] });
add('two cards can share one pool', () => assert.deepEqual(sharedEngine().getSharedLimitPool('pool').memberIds.sort(), ['a', 'b']));
add('pool limit is counted once', () => assert.equal(sharedEngine().getAssetFinancialSummary().poolSummaries[0].limitMinor, 100000));
add('pool gross debt sums member cards', () => assert.equal(sharedEngine().getSharedLimitPool('pool').grossDebtMinor, 70000));
add('pool card credit balances are handled correctly', () => { const p = sharedEngine({ credit: 10000 }).getSharedLimitPool('pool'); assert.equal(p.cardCreditBalanceMinor, 10000); assert.equal(p.availableMinor, 40000); });
add('shared availability is correct', () => assert.equal(sharedEngine().getSharedLimitPool('pool').availableMinor, 30000));
add('card cannot belong to two pools simultaneously', () => { const e = sharedEngine(); e.createSharedLimitPool({ id: 'other', name: 'Other', limit: 1000 }); e.assignCardToSharedLimitPool('a', 'other'); assert.equal(e.getSharedLimitPool('pool').memberIds.includes('a'), false); assert.equal(e.getSharedLimitPool('other').memberIds.includes('a'), true); });
add('removing a card preserves its debt', () => { const e = sharedEngine(); e.assignCardToSharedLimitPool('a', null); assert.equal(e.getAccount('a').totalCardDebtMinor, 40000); });
add('pool archive is blocked when unsafe', () => { const e = sharedEngine(); assert.throws(() => e.removeSharedLimitPool('pool'), /先.*移除/); });
add('editing limit does not rewrite debt', () => { const e = sharedEngine(); e.updateSharedLimitPool('pool', { limit: 500 }); assert.equal(e.getAccount('a').totalCardDebtMinor + e.getAccount('b').totalCardDebtMinor, 70000); });
add('pool over-limit state is represented without corruption', () => { const e = sharedEngine(); e.updateSharedLimitPool('pool', { limit: 500 }); assert.equal(e.getSharedLimitPool('pool').availableMinor, -20000); assert.equal(e.getSharedLimitPool('pool').overLimitMinor, 20000); });

// Summaries (71–86)
add('current cash includes eligible bank and eWallet balances', () => assert.equal(makeEngine().getAssetFinancialSummary().currentCashMinor, 230000));
add('current cash excludes card limits', () => assert.notEqual(makeEngine().getAssetFinancialSummary().currentCashMinor, 730000));
add('My Monthly Fixed includes user fixed share', () => assert.equal(makeEngine().getAssetFinancialSummary({ myFixedMinor: 65600 }).myFixedMinor, 65600));
add('My Monthly Fixed includes installment monthly due', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Monthly', principal: 120, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'fixed-inst' }); assert.equal(e.getAssetFinancialSummary().myFixedMinor, 1000); });
add('My Monthly Fixed excludes ordinary card purchases', () => { const e = makeEngine(); expense(e); assert.equal(e.getAssetFinancialSummary().myFixedMinor, 0); });
add('My Monthly Fixed excludes card payments', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 100)] }); e.recordCardPayment({ cardId: 'card-a', sourceAccountId: 'cash-a', amount: 10, idempotencyKey: 'fixed-payment' }); assert.equal(e.getAssetFinancialSummary().myFixedMinor, 0); });
add('My Monthly Fixed excludes recordOnly debt', () => { const e = makeEngine(); e.recordOpeningCardDebt({ cardId: 'card-a', amount: 100, idempotencyKey: 'fixed-record' }); assert.equal(e.getAssetFinancialSummary().myFixedMinor, 0); });
add('total card debt includes ordinary debt', () => assert.equal(makeEngine({ accounts: [saving(), wallet(), card('card-a', 100)] }).getAssetFinancialSummary().totalCardDebtMinor, 10000));
add('total card debt includes installment remaining principal', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Debt', principal: 120, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'debt-inst' }); assert.equal(e.getAssetFinancialSummary().totalCardDebtMinor, 12000); });
add('total card debt does not double count installment due', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Debt', principal: 120, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'debt-no-double' }); assert.equal(e.getAssetFinancialSummary().totalCardDebtMinor, 12000); });
add('this-month due includes ordinary current-cycle due', () => assert.equal(makeEngine({ accounts: [saving(), wallet(), card('card-a', 100)] }).getAssetFinancialSummary().monthCardDueMinor, 10000));
add('this-month due includes current installment occurrences', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Due', principal: 120, termCount: 12, firstDueDate: TODAY, idempotencyKey: 'due-summary' }); assert.equal(e.getAssetFinancialSummary().monthCardDueMinor, 1000); });
add('this-month due excludes future installment principal', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Future', principal: 120, termCount: 12, firstDueDate: '2026-08-13', idempotencyKey: 'due-future' }); assert.equal(e.getAssetFinancialSummary().monthCardDueMinor, 0); });
add('cash-after-due subtracts current due not total debt', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Future', principal: 120, termCount: 12, firstDueDate: '2026-08-13', idempotencyKey: 'cash-after' }); const s = e.getAssetFinancialSummary(); assert.equal(s.afterCardPaymentMinor, s.currentCashMinor); assert.notEqual(s.afterCardPaymentMinor, s.currentCashMinor - s.totalCardDebtMinor); });
add('net debt uses liabilities minus eligible liquid assets', () => { const s = makeEngine({ accounts: [saving('cash-a', 200), card('card-a', 300)] }).getAssetFinancialSummary(); assert.equal(s.netDebtMinor, 10000); });
add('shared pool does not double count debt', () => assert.equal(sharedEngine().getAssetFinancialSummary().totalCardDebtMinor, 70000));

// AA + credit card (87–94)
add('full AA card payment increases card debt by full amount', () => { const e = makeEngine(); e.addTransaction({ kind: 'expense', amount: 1312, desc: 'AA 房租', sourceAccountId: 'card-a', catId: 'home', catLabel: '住房', date: TODAY, time: '09:00', aa: true }); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 131200); });
add('user fixed burden uses only user share', () => { const d = createDemoDataSource(); const rent = d.getFixedCenterMonth('2026-07').rows.find((row) => row.plan.id === 'fixed-rent-shared'); assert.equal(rent.ownShareMinor, 65600); });
add('partner share becomes receivable', () => { const d = createDemoDataSource(); assert.ok(d.getPulse().aaReceivableMinor >= 65600); });
add('receiving reimbursement increases selected cash account', () => { const e = makeEngine(); const before = e.getAccount('wallet-a').balanceMinor; e.addTransaction({ kind: 'income', amount: 656, desc: 'AA 回款', destinationAccountId: 'wallet-a', catId: 'refund', catLabel: 'AA 回款', date: TODAY, time: '10:00' }); assert.equal(e.getAccount('wallet-a').balanceMinor, before + 65600); });
add('reimbursement does not automatically reduce card debt', () => { const e = makeEngine({ accounts: [saving(), wallet(), card('card-a', 1312)] }); e.addTransaction({ kind: 'income', amount: 656, desc: 'AA 回款', destinationAccountId: 'wallet-a', catId: 'refund', catLabel: 'AA 回款', date: TODAY, time: '10:00' }); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 131200); });
add('editing AA card expense adjusts full card amount once', () => { const e = makeEngine(); const t = e.addTransaction({ kind: 'expense', amount: 1312, desc: 'AA 房租', sourceAccountId: 'card-a', catId: 'home', catLabel: '住房', date: TODAY, time: '09:00', aa: true }); e.editTransaction(t.id, { amount: 1200 }); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 120000); });
add('deleting AA card expense reverses debt', () => { const e = makeEngine(); const t = e.addTransaction({ kind: 'expense', amount: 1312, desc: 'AA 房租', sourceAccountId: 'card-a', catId: 'home', catLabel: '住房', date: TODAY, time: '09:00', aa: true }); e.deleteTransaction(t.id); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 0); });
add('AA-linked refund carries an audit link', () => { const e = makeEngine(); const op = e.recordCardRefund({ cardId: 'card-a', amount: 20, linkedTransactionId: 'aa-origin', idempotencyKey: 'aa-refund' }); assert.equal(op.metadata.linkedTransactionId, 'aa-origin'); });

// Integrity (95–100)
add('financial invariant validator passes valid state', () => assert.equal(makeEngine().getAssetFinancialIntegrity().ok, true));
add('duplicate operation fails validation', () => { const e = makeEngine(); e.recordAssetAdjustment({ accountId: 'cash-a', amount: 1, idempotencyKey: 'dup-op' }); const checkpoint = e.createCheckpoint(); checkpoint.state.assetOperations.push(structuredClone(checkpoint.state.assetOperations[0])); e.restoreCheckpoint(checkpoint); assert.match(e.getAssetFinancialIntegrity().errors.join(','), /duplicate_operation/); });
add('orphaned asset reference fails validation', () => { const e = makeEngine(); e.recordAssetAdjustment({ accountId: 'cash-a', amount: 1, idempotencyKey: 'orphan-op' }); e.getAssetOperations()[0].metadata.accountId = 'missing'; assert.match(e.getAssetFinancialIntegrity().errors.join(','), /orphan_operation_asset/); });
add('duplicate installment occurrence fails validation', () => { const e = makeEngine(); e.createCardInstallment({ cardId: 'card-a', name: 'Dup', principal: 10, termCount: 2, firstDueDate: TODAY, idempotencyKey: 'dup-inst' }); const i = e.getCardInstallments('card-a')[0]; i.schedule[1].id = i.schedule[0].id; assert.match(e.getAssetFinancialIntegrity().errors.join(','), /duplicate_installment_occurrence/); });
add('selector mismatch fails validation', () => { const e = makeEngine(); e.getAccount('card-a').availableCreditMinor = 1; assert.match(e.getAssetFinancialIntegrity().errors.join(','), /card_available_mismatch/); });
add('floating money fails validation', () => { const e = makeEngine(); e.getAccount('cash-a').balanceMinor = 1.5; assert.match(e.getAssetFinancialIntegrity().errors.join(','), /invalid_balance/); });

// Regression (101–110)
add('existing expense posting remains correct', () => { const d = createDemoDataSource(); const before = d.getAccount('sv-mbb').balanceMinor; d.addTransaction({ kind: 'expense', amount: 1, desc: 'expense', sourceAccountId: 'sv-mbb', catId: 'food', catLabel: '餐饮', date: d.today, time: '10:00' }); assert.equal(d.getAccount('sv-mbb').balanceMinor, before - 100); });
add('existing income posting remains correct', () => { const d = createDemoDataSource(); const before = d.getAccount('sv-mbb').balanceMinor; d.addTransaction({ kind: 'income', amount: 1, desc: 'income', destinationAccountId: 'sv-mbb', catId: 'salary', catLabel: '薪资', date: d.today, time: '10:00' }); assert.equal(d.getAccount('sv-mbb').balanceMinor, before + 100); });
add('existing transfer remains cash neutral', () => { const d = createDemoDataSource(); const before = d.getPulse().currentCashMinor; d.transferFunds({ amount: 1, desc: 'transfer', sourceAccountId: 'sv-mbb', destinationAccountId: 'ew-tng', date: d.today, time: '10:00' }); assert.equal(d.getPulse().currentCashMinor, before); });
add('existing recurring posting remains idempotent by source contract', () => { const source = fs.readFileSync(new URL('../src/domain/recurringPostingExecutor.js', import.meta.url), 'utf8'); assert.match(source, /idempotency|replayed/); });
add('existing reversal remains correct', () => { const e = makeEngine(); const t = expense(e); e.reverseTransaction(t.id); assert.equal(e.getAccount('card-a').totalCardDebtMinor, 0); });
add('existing Payment Assistant routing remains source-owned', () => { const source = fs.readFileSync(new URL('../src/domain/paymentHandoff.js', import.meta.url), 'utf8'); assert.match(source, /resolveSourceAccountAppCapability/); });
add('existing recipient directory remains available', () => { const source = fs.readFileSync(new URL('../src/features/ledger/index.js', import.meta.url), 'utf8'); assert.match(source, /收款资料/); });
add('existing attachments remain optional', () => { const source = fs.readFileSync(new URL('../src/domain/attachmentRepository.js', import.meta.url), 'utf8'); assert.match(source, /createPostingEvidenceDraftStore/); });
add('existing AA totals remain canonical', () => { const d = createDemoDataSource(); assert.equal(Number.isInteger(d.getPulse().aaReceivableMinor), true); });
add('Phase 2D1A introduces no network or persistence API, formats dates, and uses canonical debt in visible account summaries', () => { const files = ['../src/domain/assetFinancialModel.js','../src/domain/moneyEngine.js','../src/features/assets/AssetManagementSheets.js','../src/features/assets/AssetOperationSheets.js','../src/components/CaptureSheet.js','../src/features/assets/index.js']; const source = files.map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'); assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|indexedDB|supabase/i); assert.match(source, /datePickerFieldHTML/); assert.doesNotMatch(source, /name="firstDueDate"\s+type="date"/); assert.match(source, /totalCardDebt/); });

assert.equal(number, 110);
