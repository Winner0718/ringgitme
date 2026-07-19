import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMoneyEngine } from '../src/domain/moneyEngine.js';
import {
  buildInstallmentSchedule,
  installmentScheduleSummary,
  maskAssetIdentifier,
} from '../src/domain/assetFinancialModel.js';

const TODAY = '2026-07-13';
const saving = (id = 'cash-a', balance = 2000, extra = {}) => ({ id, type: 'saving', name: id, bank: 'Test Bank', balance, ...extra });
const wallet = (id = 'wallet-a', balance = 300, extra = {}) => ({ id, type: 'ew', name: id, bank: 'Wallet', balance, ...extra });
const card = (id = 'card-a', ordinary = 0, extra = {}) => ({ id, type: 'cc', name: id, bank: 'Test Bank', creditCardLast4: '0002', limit: 5000, outstanding: ordinary, monthlyDue: ordinary, dueDate: ordinary ? '2026-07-20' : null, ...extra });
const makeEngine = ({ accounts = [saving(), wallet(), card()], transactions = [], installments = [], pools = [] } = {}) => createMoneyEngine({ accounts, transactions, installments, sharedLimitPools: pools, today: TODAY });
const purchase = (engine, { amount = 100, cardId = 'card-a', key = `purchase-${Math.random()}`, relationship = null } = {}) => engine.addTransaction({ kind: 'expense', amount, desc: '测试消费', sourceAccountId: cardId, catId: 'shopping', catLabel: '购物', date: TODAY, time: '10:00', relationship, submissionKey: key });
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const source = (...paths) => paths.map(read).join('\n');
const uiSource = () => source('../src/features/assets/AssetManagementSheets.js', '../src/features/assets/AssetDragReorder.js', '../src/features/assets/detail.js', '../src/features/assets/index.js', '../src/styles/phase2d1a.css', '../src/app/shell.js');

let number = 0;
const add = (title, fn) => test(`2D1A1-${String(++number).padStart(3, '0')} ${title}`, fn);

// Management and ordering (1–6)
add('Management action lives in the topbar rather than summary', () => { const s = uiSource(); assert.match(s, /assets-manage/); assert.doesNotMatch(read('../src/features/assets/index.js'), /assets-manage-button/); });
add('drag reorder changes only selected asset type', () => { const e = makeEngine({ accounts: [saving('a'), saving('b'), wallet(), card()] }); const walletBefore = e.getAccount('wallet-a').sortOrder; e.reorderAssets('saving', ['b', 'a']); assert.deepEqual(e.getAccounts().filter((a) => a.type === 'saving').map((a) => a.id), ['b', 'a']); assert.equal(e.getAccount('wallet-a').sortOrder, walletBefore); });
add('cross-type drag is blocked', () => { const e = makeEngine({ accounts: [saving('a'), saving('b'), wallet(), card()] }); assert.throws(() => e.reorderAssets('saving', ['a', 'wallet-a']), /排列不完整/); });
add('reorder preserves stable IDs', () => { const e = makeEngine({ accounts: [saving('a'), saving('b'), wallet(), card()] }); e.reorderAssets('saving', ['b', 'a']); assert.deepEqual(new Set(e.getAccounts().map((a) => a.id)), new Set(['a', 'b', 'wallet-a', 'card-a'])); });
add('cancelled drag does not mutate repository', () => { const e = makeEngine({ accounts: [saving('a'), saving('b'), wallet(), card()] }); const before = e.createCheckpoint(); const draft = ['b', 'a']; assert.deepEqual(draft, ['b', 'a']); e.restoreCheckpoint(before); assert.deepEqual(e.getAccounts().filter((a) => a.type === 'saving').map((a) => a.id), ['a', 'b']); });
add('keyboard reorder fallback is declared', () => { const s = uiSource(); assert.match(s, /asset-reorder-handle/); assert.match(s, /ArrowUp|ArrowDown/); assert.match(s, /Escape/); });

// Identifiers (7–18)
add('bank saves with no identifiers', () => { const a = makeEngine().createAsset({ type: 'saving', name: 'Blank' }); assert.equal(a.bankAccountNumber, ''); assert.equal(a.debitCardNumber, ''); });
add('bank saves with account number only', () => { const a = makeEngine().createAsset({ type: 'saving', name: 'Account', bankAccountNumber: '001 234' }); assert.equal(a.bankAccountNumber, '001 234'); });
add('bank saves with debit card only', () => { const a = makeEngine().createAsset({ type: 'saving', name: 'Debit', debitCardNumber: '0000 1234' }); assert.equal(a.debitCardNumber, '0000 1234'); });
add('bank saves with both identifiers', () => { const a = makeEngine().createAsset({ type: 'saving', name: 'Both', bankAccountNumber: '001', debitCardNumber: '002' }); assert.equal(a.bankAccountNumber, '001'); assert.equal(a.debitCardNumber, '002'); });
add('leading zeroes are preserved', () => { const a = makeEngine().createAsset({ type: 'saving', name: 'Zeros', bankAccountNumber: '000012340' }); assert.equal(a.bankAccountNumber, '000012340'); });
add('long identifiers remain strings', () => { const value = '0000 1234 5678 9012 3456'; const a = makeEngine().createAsset({ type: 'saving', name: 'Long', debitCardNumber: value }); assert.equal(typeof a.debitCardNumber, 'string'); assert.equal(a.debitCardNumber, value); });
add('credit card stores last four only', () => { const a = makeEngine().createAsset({ type: 'cc', name: 'Safe Card', creditCardLast4: '0012', limit: 1000 }); assert.equal(a.creditCardLast4, '0012'); assert.equal(a.last4, '0012'); });
add('credit card private editor has no PAN CVV PIN or expiry field', () => { const s = read('../src/features/assets/AssetManagementSheets.js'); assert.doesNotMatch(s, /name="(?:pan|cvv|pin|expiry)"/i); });
add('eWallet identifier is optional', () => { const a = makeEngine().createAsset({ type: 'ew', name: 'Wallet' }); assert.equal(a.walletIdentifier, ''); });
add('identifier mask exposes last four only', () => assert.equal(maskAssetIdentifier('0000 1234 5678'), '•••• 5678'));
add('privacy control cannot reveal identifiers', () => { const s = uiSource(); assert.doesNotMatch(s, /ui\.privacy[^\n]+bankAccountNumber|ui\.privacy[^\n]+debitCardNumber|ui\.privacy[^\n]+walletIdentifier/); });
add('sensitive identifiers are not logged', () => { const s = source('../src/domain/assetFinancialModel.js', '../src/domain/moneyEngine.js', '../src/features/assets/AssetManagementSheets.js'); assert.doesNotMatch(s, /console\.(?:log|info|warn|error)\([^)]*(?:bankAccountNumber|debitCardNumber|walletIdentifier)/); });

// Menus (19–24)
add('bank overflow menu is functional', () => { const s = uiSource(); assert.match(s, /asset-overflow-menu/); assert.match(s, /编辑账户/); });
add('eWallet overflow menu is functional', () => assert.match(uiSource(), /编辑eWallet/));
add('credit card overflow menu is functional', () => assert.match(uiSource(), /管理共享额度池[^]*记录费用与利息[^]*导入已有欠款/));
add('account menus do not show unavailable placeholder', () => assert.doesNotMatch(uiSource(), /此功能暂未开放/));
add('dangerous deletion remains dependency-safe', () => { const e = makeEngine(); purchase(e); assert.equal(e.canHardDeleteAsset('card-a').allowed, false); });
add('archived account history remains readable', () => { const e = makeEngine(); const t = purchase(e); e.archiveAsset('card-a'); assert.equal(e.getTransaction(t.id).sourceAccountId, 'card-a'); });

// Actions (25–29)
add('transfer-in presets current account as destination', () => assert.match(uiSource(), /asset-transfer-in[^]*destinationAccountId/));
add('transfer-out presets current account as source', () => assert.match(uiSource(), /asset-transfer-out[^]*sourceAccountId/));
add('eWallet transfer actions reuse Capture transfer flow', () => assert.match(uiSource(), /openCaptureSheet/));
add('card actions show payment refund and installment', () => { const s = read('../src/features/assets/detail.js'); assert.match(s, /还款/); assert.match(s, /记录退款/); assert.match(s, /新增分期/); });
add('lower-frequency card actions live in overflow', () => { const s = read('../src/features/assets/detail.js'); assert.doesNotMatch(s, /asset-action-grid[^]*费用\/利息[^]*导入欠款/); });

// Balance adjustment (30–35)
add('current balance is not editable metadata', () => { const s = read('../src/features/assets/AssetManagementSheets.js'); assert.match(s, /余额由调整记录管理/); assert.doesNotMatch(s, /name="balance"[^>]+readonly/); });
add('target adjustment calculates positive difference', () => { const e = makeEngine(); const op = e.recordAssetTargetBalance({ accountId: 'cash-a', targetBalance: 2100, idempotencyKey: 'target-up' }); assert.equal(op.result.deltaMinor, 10000); });
add('target adjustment calculates negative difference', () => { const e = makeEngine(); const op = e.recordAssetTargetBalance({ accountId: 'cash-a', targetBalance: 1900, idempotencyKey: 'target-down' }); assert.equal(op.result.deltaMinor, -10000); });
add('target adjustment applies once', () => { const e = makeEngine(); const cmd = { accountId: 'cash-a', targetBalance: 2100, idempotencyKey: 'target-once' }; e.recordAssetTargetBalance(cmd); e.recordAssetTargetBalance(cmd); assert.equal(e.getAccount('cash-a').balanceMinor, 210000); });
add('target adjustment reversal restores prior balance', () => { const e = makeEngine(); const op = e.recordAssetTargetBalance({ accountId: 'cash-a', targetBalance: 2100, idempotencyKey: 'target-reverse' }); e.reverseAssetOperation(op.id); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); });
add('duplicate target reversal is blocked idempotently', () => { const e = makeEngine(); const op = e.recordAssetTargetBalance({ accountId: 'cash-a', targetBalance: 2100, idempotencyKey: 'target-reverse-twice' }); e.reverseAssetOperation(op.id); e.reverseAssetOperation(op.id); assert.equal(e.getAccount('cash-a').balanceMinor, 200000); });

// Refunds (36–45)
add('linked refund requires eligible original purchase', () => { const e = makeEngine(); assert.throws(() => e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: 'missing', amount: 1, idempotencyKey: 'missing-refund' }), /原消费/); });
add('partial linked refund is supported', () => { const e = makeEngine(); const t = purchase(e); const op = e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 40, idempotencyKey: 'partial-refund' }); assert.equal(op.result.remainingRefundableMinor, 6000); });
add('full linked refund is supported', () => { const e = makeEngine(); const t = purchase(e); e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 100, idempotencyKey: 'full-refund' }); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 0); });
add('over-refund is blocked', () => { const e = makeEngine(); const t = purchase(e); assert.throws(() => e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 101, idempotencyKey: 'over-refund' }), /超过/); });
add('linked refund reduces recognized spending and debt', () => { const e = makeEngine(); const t = purchase(e); const op = e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 40, idempotencyKey: 'linked-debt' }); assert.equal(op.metadata.spendingDeltaMinor, -4000); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 6000); });
add('linked refund is not income', () => { const e = makeEngine(); const t = purchase(e); const op = e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 20, idempotencyKey: 'linked-income' }); assert.equal(op.metadata.incomeDeltaMinor, 0); });
add('linked AA refund adjusts receivable snapshot', () => { const e = makeEngine(); const t = purchase(e); t.aaReceivableMinor = 5000; const op = e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 40, idempotencyKey: 'linked-aa' }); assert.equal(op.result.aaReceivableReductionMinor, 2000); });
add('general card credit leaves purchase category untouched', () => { const e = makeEngine(); const t = purchase(e); e.recordGeneralCardCredit({ cardId: 'card-a', amount: 10, idempotencyKey: 'general-category' }); assert.equal(e.getTransaction(t.id).catLabel, '购物'); });
add('general card credit can create excess credit', () => { const e = makeEngine(); e.recordGeneralCardCredit({ cardId: 'card-a', amount: 50, idempotencyKey: 'general-excess' }); assert.equal(e.getAccount('card-a').cardCreditBalanceMinor, 5000); });
add('duplicate full linked refund is blocked', () => { const e = makeEngine(); const t = purchase(e); e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 100, idempotencyKey: 'linked-full' }); assert.throws(() => e.recordLinkedCardRefund({ cardId: 'card-a', linkedTransactionId: t.id, amount: 1, idempotencyKey: 'linked-again' }), /可退款|已全额退款/); });

// Installments (46–57)
add('new installment recognizes spending once', () => { const e = makeEngine(); const op = e.createCardInstallment({ cardId: 'card-a', name: 'Phone', principal: 120, termCount: 3, firstDueDate: TODAY, idempotencyKey: 'new-spend' }); assert.equal(op.metadata.spendingDeltaMinor, 12000); });
add('new installment creates debt once', () => { const e = makeEngine(); const cmd = { cardId: 'card-a', name: 'Phone', principal: 120, termCount: 3, firstDueDate: TODAY, idempotencyKey: 'new-debt' }; e.createCardInstallment(cmd); e.createCardInstallment(cmd); assert.equal(e.getAccount('card-a').installmentPrincipalOutstandingMinor, 12000); });
add('conversion does not duplicate spending', () => { const e = makeEngine(); const t = purchase(e); const op = e.convertPurchaseToInstallment({ cardId: 'card-a', transactionId: t.id, termCount: 4, firstDueDate: TODAY, idempotencyKey: 'convert-spend' }); assert.equal(op.metadata.spendingDeltaMinor, 0); });
add('conversion moves ordinary debt to installment debt', () => { const e = makeEngine(); const t = purchase(e); e.convertPurchaseToInstallment({ cardId: 'card-a', transactionId: t.id, termCount: 4, firstDueDate: TODAY, idempotencyKey: 'convert-debt' }); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 0); assert.equal(e.getAccount('card-a').installmentPrincipalOutstandingMinor, 10000); });
add('converted purchase retains linkage', () => { const e = makeEngine(); const t = purchase(e); const op = e.convertPurchaseToInstallment({ cardId: 'card-a', transactionId: t.id, termCount: 4, firstDueDate: TODAY, idempotencyKey: 'convert-link' }); assert.equal(op.metadata.linkedTransactionId, t.id); });
add('import does not count as spending', () => { const e = makeEngine(); const op = e.importCardInstallment({ cardId: 'card-a', name: 'Old Phone', remainingPrincipal: 120, remainingTermCount: 3, nextDueDate: TODAY, idempotencyKey: 'import-spend' }); assert.equal(op.metadata.spendingDeltaMinor, 0); });
add('import creates only remaining schedule', () => { const e = makeEngine(); const op = e.importCardInstallment({ cardId: 'card-a', name: 'Old Phone', remainingPrincipal: 120, remainingTermCount: 3, nextDueDate: TODAY, originalTermCount: 12, idempotencyKey: 'import-schedule' }); assert.equal(op.result.schedule.length, 3); });
add('imported installment occupies credit', () => { const e = makeEngine(); const before = e.getAccount('card-a').availableCreditMinor; e.importCardInstallment({ cardId: 'card-a', name: 'Old Phone', remainingPrincipal: 120, remainingTermCount: 3, nextDueDate: TODAY, idempotencyKey: 'import-credit' }); assert.equal(e.getAccount('card-a').availableCreditMinor, before - 12000); });
add('schedule preview equals canonical schedule', () => { const schedule = buildInstallmentSchedule({ principalMinor: 10001, termCount: 3, firstDueDate: '2026-08-31' }); assert.deepEqual(installmentScheduleSummary({ schedule, principalMinor: 10001, asOfDate: TODAY }).schedule, schedule); });
add('final installment absorbs sen remainder', () => assert.deepEqual(buildInstallmentSchedule({ principalMinor: 10001, termCount: 3, firstDueDate: TODAY }).map((r) => r.amountMinor), [3333, 3333, 3335]));
add('schedule total equals principal', () => { const summary = installmentScheduleSummary({ schedule: buildInstallmentSchedule({ principalMinor: 10001, termCount: 3, firstDueDate: TODAY }), principalMinor: 10001, asOfDate: TODAY }); assert.equal(summary.totalMinor, 10001); });
add('refunded or converted purchase cannot convert twice', () => { const e = makeEngine(); const t = purchase(e); e.convertPurchaseToInstallment({ cardId: 'card-a', transactionId: t.id, termCount: 2, firstDueDate: TODAY, idempotencyKey: 'convert-once' }); assert.throws(() => e.convertPurchaseToInstallment({ cardId: 'card-a', transactionId: t.id, termCount: 2, firstDueDate: TODAY, idempotencyKey: 'convert-twice' }), /已转换|不适用/); });

// Presentation (58–65)
add('card hero displays total debt', () => assert.match(source('../src/components/CardCarousel.js', '../src/features/assets/index.js'), /totalCardDebt/));
add('ordinary debt is shown separately', () => assert.match(read('../src/features/assets/detail.js'), /普通消费欠款/));
add('installment principal is shown separately', () => assert.match(read('../src/features/assets/detail.js'), /分期剩余本金/));
add('monthly due is numeric', () => assert.match(read('../src/features/assets/detail.js'), /本月应还[^]*fmtRM/));
add('monthly paid is numeric', () => assert.match(read('../src/features/assets/detail.js'), /本月已还[^]*fmtRM/));
add('monthly remaining is numeric', () => assert.match(read('../src/features/assets/detail.js'), /本月剩余[^]*fmtRM/));
add('shared pool availability is labelled shared', () => assert.match(read('../src/features/assets/detail.js'), /共享额度池[^]*共享可用/));
add('pool limit remains counted once', () => { const e = makeEngine({ accounts: [saving(), card('a', 100, { sharedLimitPoolId: 'pool' }), card('b', 50, { sharedLimitPoolId: 'pool' })], pools: [{ id: 'pool', name: 'Pool', limit: 1000 }] }); assert.equal(e.getAssetFinancialSummary().poolSummaries[0].limitMinor, 100000); });

// UI (66–72)
add('asset sheets use one canonical footer component', () => { const s = uiSource(); assert.match(s, /assetSheetFooterHTML/); assert.doesNotMatch(s, /asset-sheet-dock/); });
add('footer is safe-area aware', () => assert.match(read('../src/styles/phase2d1a.css'), /asset-sheet-footer[^}]*safe-area-inset-bottom/));
add('footer is keyboard safe', () => assert.match(read('../src/styles/phase2d1a.css'), /asset-sheet-footer/));
add('cancelled form remains non-mutating', () => { const e = makeEngine(); const before = e.getSnapshot(); assert.deepEqual(e.getSnapshot(), before); });
add('asset editor is type-scoped without stale fields', () => assert.match(read('../src/features/assets/AssetManagementSheets.js'), /editorContext\.type/));
add('accepted card stack layout remains', () => assert.match(read('../src/features/assets/index.js'), /asset-card-stack/));
add('accepted detail carousel remains', () => assert.match(read('../src/features/assets/detail.js'), /renderCarousel/));

// Regression (73–79)
add('Phase 2D1A suite remains present with 110 tests', () => assert.match(read('./phase2d1a.test.mjs'), /assert\.equal\(number, 110\)/));
add('full suite runner remains unchanged', () => assert.ok(fs.existsSync(new URL('../package.json', import.meta.url))));
add('Phase 2C3 cumulative tests remain present', () => assert.ok(fs.readdirSync(new URL('.', import.meta.url)).some((name) => name.includes('phase2c3'))));
add('ordinary card purchase remains correct', () => { const e = makeEngine(); purchase(e); assert.equal(e.getAccount('card-a').ordinaryPrincipalOutstandingMinor, 10000); });
add('installment payment and reversal remain correct', () => { const e = makeEngine(); const op = e.createCardInstallment({ cardId: 'card-a', name: 'One', principal: 20, termCount: 1, firstDueDate: TODAY, idempotencyKey: 'reg-inst' }); e.reverseAssetOperation(op.id); assert.equal(e.getAccount('card-a').installmentPrincipalOutstandingMinor, 0); });
add('AA relationship data remains linked through conversion', () => { const e = makeEngine(); const t = purchase(e); t.aaReceivableMinor = 3000; const op = e.convertPurchaseToInstallment({ cardId: 'card-a', transactionId: t.id, termCount: 2, firstDueDate: TODAY, idempotencyKey: 'reg-aa' }); assert.equal(op.metadata.aaReceivableMinor, 3000); });
add('recurring payment routing remains source owned', () => assert.match(read('../src/domain/paymentHandoff.js'), /resolveSourceAccountAppCapability/));

assert.equal(number, 79);
