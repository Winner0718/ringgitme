// In-memory money engine. It owns the authoritative account and transaction
// snapshot; UI modules only interact through the data-source adapter.

import { AccountCapacityError, assertAccountCapacity, inspectAccountCapacity } from './accountCapacity.js';
import { accountConfirmationSnapshot, immutableConfirmationSnapshot } from './confirmationSnapshot.js';
import {
  buildInstallmentSchedule,
  major,
  minor,
  nextCalendarMonthSameDay,
  normalizeAsset,
  normalizeCardInstallment,
  normalizeSharedLimitPool,
  sanitizePrivateIdentifier,
  selectAssetFinancialSummary,
  syncAllAssetDerived,
  validateAssetFinancialIntegrity,
} from './assetFinancialModel.js';

const ACCOUNT_TYPE = { saving: 'savings', ew: 'ewallet', cc: 'credit' };
const VALID_KINDS = new Set(['expense', 'income', 'transfer']);
const VALID_ACCOUNT_EFFECTS = new Set(['posted', 'record_only', 'relationship_only']);

export function toMinor(value) {
  return minor(value);
}

export function fromMinor(value) {
  return value / 100;
}

function nowISO() {
  return new Date().toISOString();
}

function localOccurredAt(date, time) {
  return `${date}T${time}:00+08:00`;
}

function normalizeAccount(raw, index = 0) {
  const account = normalizeAsset(raw, index, raw?.createdAt || '2000-01-01T00:00:00.000Z');
  account.domainType = ACCOUNT_TYPE[account.type] || account.type;
  account.recordOnlySupported = true;
  return account;
}

function syncAccount(account) {
  if (account.type === 'cc') {
    account.grossCardDebtMinor = account.ordinaryPrincipalOutstandingMinor
      + account.recordOnlyDebtMinor
      + account.installmentPrincipalOutstandingMinor
      + account.feeInterestOutstandingMinor;
    account.totalCardDebtMinor = Math.max(0, account.grossCardDebtMinor - account.cardCreditBalanceMinor);
    account.currentOutstandingMinor = account.totalCardDebtMinor;
    account.limit = Number.isInteger(account.creditLimitMinor) ? fromMinor(account.creditLimitMinor) : null;
    account.creditLimit = account.limit;
    account.outstanding = fromMinor(account.totalCardDebtMinor);
    account.currentOutstanding = account.outstanding;
    account.availableCreditMinor = Number.isInteger(account.creditLimitMinor) ? account.creditLimitMinor - account.totalCardDebtMinor : null;
    account.availableCredit = account.availableCreditMinor == null ? null : fromMinor(account.availableCreditMinor);
    account.overLimitMinor = account.availableCreditMinor == null ? null : Math.max(0, -account.availableCreditMinor);
    account.overLimit = account.overLimitMinor == null ? null : fromMinor(account.overLimitMinor);
  } else {
    account.balance = fromMinor(account.balanceMinor);
  }
  return account;
}

function normalizeFixtureTransaction(raw, accounts) {
  const kind = raw.kind || raw.type;
  const amountMinor = raw.amountMinor ?? toMinor(raw.amount);
  let sourceAccountId = raw.sourceAccountId || (kind === 'expense' || kind === 'transfer' ? raw.accountId : null);
  let destinationAccountId = raw.destinationAccountId || (kind === 'income' ? raw.accountId : null);

  // Older visual fixtures predate source/destination fields. Normalize their
  // ordinary money records once at repository initialization so every cloned
  // baseline transaction can pass the same edit/reversal validation as a new
  // transaction. IDs stay authoritative; account names are never matched.
  if (kind === 'income' && accountById(accounts, destinationAccountId)?.type === 'cc') {
    destinationAccountId = accounts.find((account) => account.type !== 'cc')?.id || null;
  }
  if (kind === 'transfer') {
    if (!accountById(accounts, sourceAccountId) || accountById(accounts, sourceAccountId)?.type === 'cc') {
      sourceAccountId = accounts.find((account) => account.type !== 'cc')?.id || null;
    }
    const destination = accountById(accounts, destinationAccountId);
    if (!destination || destination.type === 'cc' || destination.id === sourceAccountId) {
      destinationAccountId = accounts.find((account) => account.id === 'ew-tng' && account.id !== sourceAccountId)?.id
        || accounts.find((account) => account.type !== 'cc' && account.id !== sourceAccountId)?.id
        || null;
    }
  }
  return {
    ...structuredClone(raw),
    kind,
    type: kind,
    amountMinor,
    amount: fromMinor(amountMinor),
    feeMinor: Number(raw.feeMinor || raw.transferFeeMinor || 0),
    transferFeeMinor: Number(raw.feeMinor || raw.transferFeeMinor || 0),
    description: raw.description || raw.desc,
    desc: raw.desc || raw.description,
    catId: kind === 'transfer' ? (raw.catId === 'transfer' || !raw.catId ? 'transfer-fallback' : raw.catId) : raw.catId,
    catLabel: kind === 'transfer' ? '转账' : raw.catLabel,
    category: kind === 'transfer' ? '转账' : raw.category || raw.catLabel,
    sourceAccountId,
    destinationAccountId,
    accountId: raw.accountId || sourceAccountId || destinationAccountId,
    occurredAt: raw.occurredAt || localOccurredAt(raw.date, raw.time),
    recordOnly: Boolean(raw.recordOnly),
    accountEffect: raw.accountEffect || (raw.recordOnly ? 'record_only' : 'posted'),
    aa: Boolean(raw.aa ?? raw.shared),
    attachment: raw.attachment || (raw.receipt || raw.photo ? { kind: raw.photo ? 'photo' : 'receipt' } : null),
    attachmentIds: structuredClone(raw.attachmentIds || []),
    createdAt: raw.createdAt || localOccurredAt(raw.date, raw.time),
    updatedAt: raw.updatedAt || raw.createdAt || localOccurredAt(raw.date, raw.time),
    revision: Number(raw.revision || 1),
    editHistory: structuredClone(raw.editHistory || []),
    status: raw.status || 'active',
    origin: raw.origin || 'fixture',
    lockedReason: String(raw.lockedReason || '').trim() || null,
  };
}

function accountById(accounts, id) {
  return accounts.find((account) => account.id === id);
}

function validateAndNormalize(draft, accounts) {
  const kind = draft.kind || draft.type;
  if (!VALID_KINDS.has(kind)) throw new Error('请选择有效的记录类型');
  const amountMinor = draft.amountMinor ?? toMinor(draft.amount);
  if (amountMinor <= 0) throw new Error('金额必须大于零');
  const desc = String(draft.desc ?? draft.description ?? '').trim();
  if (!desc) throw new Error('请输入备注');
  const accountEffect = draft.accountEffect || (draft.recordOnly ? 'record_only' : 'posted');
  if (!VALID_ACCOUNT_EFFECTS.has(accountEffect)) throw new Error('账户影响类型无效');

  const sourceAccountId = draft.sourceAccountId || (kind === 'expense' ? draft.accountId : null);
  const destinationAccountId = draft.destinationAccountId || (kind === 'income' ? draft.accountId : null);
  const source = sourceAccountId ? accountById(accounts, sourceAccountId) : null;
  const destination = destinationAccountId ? accountById(accounts, destinationAccountId) : null;

  if (kind === 'expense' && !source) throw new Error('请选择支出账户');
  if (kind === 'income' && (!destination || destination.type === 'cc')) throw new Error('请选择可入账账户');
  if (kind === 'transfer') {
    if (!source || !destination) throw new Error('请选择转出和转入账户');
    if (source.id === destination.id) throw new Error('转出和转入账户不能相同');
    if (source.type === 'cc' || destination.type === 'cc') throw new Error('暂不支持信用卡转账');
  }

  const date = draft.date || String(draft.occurredAt || '').slice(0, 10);
  const time = draft.time || String(draft.occurredAt || '').slice(11, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('日期或时间无效');

  const rawFeeMinor = draft.feeMinor ?? draft.transferFeeMinor ?? (draft.fee != null ? toMinor(draft.fee) : draft.transferFee != null ? toMinor(draft.transferFee) : 0);
  if (!Number.isInteger(rawFeeMinor) || rawFeeMinor < 0) throw new Error('手续费无效');
  return {
    kind,
    type: kind,
    amountMinor,
    amount: fromMinor(amountMinor),
    desc,
    description: desc,
    catId: draft.catId || (kind === 'transfer' ? 'transfer-fallback' : kind === 'income' ? 'income-fallback' : 'expense-fallback'),
    catLabel: draft.catLabel || draft.category || (kind === 'transfer' ? '转账' : kind === 'income' ? '未分类收入' : '未分类支出'),
    category: draft.category || draft.catLabel || (kind === 'transfer' ? '转账' : ''),
    date,
    time,
    occurredAt: localOccurredAt(date, time),
    sourceAccountId: source?.id || null,
    destinationAccountId: destination?.id || null,
    accountId: kind === 'income' ? destination.id : source.id,
    recordOnly: Boolean(draft.recordOnly),
    accountEffect,
    aa: Boolean(draft.aa),
    shared: Boolean(draft.aa),
    attachment: draft.attachment || null,
    attachmentIds: structuredClone(draft.attachmentIds || []),
    receipt: draft.attachment?.kind === 'receipt' || draft.attachment?.kind === 'file',
    photo: draft.attachment?.kind === 'photo',
    lockedReason: String(draft.lockedReason || '').trim() || null,
    feeMinor: rawFeeMinor,
    transferFeeMinor: rawFeeMinor,
    relationshipMode: draft.relationshipMode || draft.entryType || null,
    submissionKey: draft.submissionKey || draft.clientEventId || null,
    recurringPlanId: draft.recurringPlanId || null,
    recurringOccurrenceId: draft.recurringOccurrenceId || null,
    recurringPostingId: draft.recurringPostingId || null,
    recipientPaymentSnapshot: structuredClone(draft.recipientPaymentSnapshot || null),
    payerAccountSnapshot: structuredClone(draft.payerAccountSnapshot || null),
    reversalOfTransactionId: draft.reversalOfTransactionId || null,
  };
}

function applyEffect(accounts, transaction, direction) {
  if (transaction.accountEffect !== 'posted') return;
  const delta = transaction.amountMinor * direction;
  const feeDelta = Number(transaction.feeMinor || 0) * direction;
  const source = transaction.sourceAccountId ? accountById(accounts, transaction.sourceAccountId) : null;
  const destination = transaction.destinationAccountId ? accountById(accounts, transaction.destinationAccountId) : null;

  if (transaction.kind === 'expense') {
    if (source.type === 'cc') {
      source.ordinaryPrincipalOutstandingMinor = Math.max(0, source.ordinaryPrincipalOutstandingMinor + delta);
      source.feeInterestOutstandingMinor = Math.max(0, source.feeInterestOutstandingMinor + feeDelta);
      if (direction > 0) {
        source.ordinaryDueMinor += transaction.amountMinor;
        source.feeDueMinor += Number(transaction.feeMinor || 0);
        if (!source.cycleAnchorDate) {
          source.cycleAnchorDate = transaction.date;
          source.dueDate = nextCalendarMonthSameDay(transaction.date);
        }
        source.duePaid = false;
      } else {
        source.ordinaryDueMinor = Math.max(0, source.ordinaryDueMinor - transaction.amountMinor);
        source.feeDueMinor = Math.max(0, source.feeDueMinor - Number(transaction.feeMinor || 0));
        if (source.ordinaryPrincipalOutstandingMinor === 0 && source.feeInterestOutstandingMinor === 0) {
          source.cycleAnchorDate = null;
          source.dueDate = null;
        }
      }
    } else {
      source.balanceMinor -= delta + feeDelta;
    }
    syncAccount(source);
  } else if (transaction.kind === 'income') {
    destination.balanceMinor += delta;
    syncAccount(destination);
  } else {
    source.balanceMinor -= delta + feeDelta;
    destination.balanceMinor += delta;
    syncAccount(source);
    syncAccount(destination);
  }
}

function changedFields(previous, next) {
  const keys = ['kind', 'amountMinor', 'feeMinor', 'desc', 'catId', 'catLabel', 'date', 'time', 'sourceAccountId', 'destinationAccountId', 'recordOnly', 'accountEffect'];
  return keys.filter((key) => previous[key] !== next[key]);
}

function accountValueMinor(account) {
  return account?.type === 'cc' ? account.currentOutstandingMinor : account?.balanceMinor;
}

function accountChanges(beforeAccounts, afterAccounts, transaction) {
  const ids = [transaction.sourceAccountId, transaction.destinationAccountId].filter(Boolean);
  return [...new Set(ids)].map((accountId) => {
    const before = accountById(beforeAccounts, accountId);
    const after = accountById(afterAccounts, accountId);
    const beforeMinor = accountValueMinor(before);
    const afterMinor = accountValueMinor(after);
    return {
      accountId,
      accountName: after?.name || before?.name || '账户',
      accountType: after?.type || before?.type,
      measure: (after?.type || before?.type) === 'cc' ? 'outstanding' : 'balance',
      beforeMinor,
      afterMinor,
      deltaMinor: Number(afterMinor || 0) - Number(beforeMinor || 0),
      accountSnapshot: accountConfirmationSnapshot(after || before),
      role: transaction.sourceAccountId === accountId && transaction.destinationAccountId === accountId
        ? 'source_destination'
        : transaction.sourceAccountId === accountId ? 'source' : 'destination',
    };
  });
}

function confirmationSnapshot({ transaction, beforeAccounts, afterAccounts, previousTransactions, confirmationId, operation = 'create' }) {
  const relatedAccountIds = new Set([transaction.sourceAccountId, transaction.destinationAccountId].filter(Boolean));
  const uniqueIds = new Set();
  const recentRecords = [transaction, ...previousTransactions.filter((item) =>
    relatedAccountIds.has(item.sourceAccountId) || relatedAccountIds.has(item.destinationAccountId))]
    .filter((item) => item?.id && !uniqueIds.has(item.id) && uniqueIds.add(item.id))
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      desc: item.desc,
      amountMinor: item.amountMinor,
      date: item.date,
      time: item.time,
      sourceAccountId: item.sourceAccountId,
      destinationAccountId: item.destinationAccountId,
    }));
  return immutableConfirmationSnapshot({
    confirmationId,
    operation,
    transactionId: transaction.id,
    kind: transaction.kind,
    amountMinor: transaction.amountMinor,
    description: transaction.desc,
    accountEffect: transaction.accountEffect,
    accountChanges: accountChanges(beforeAccounts, afterAccounts, transaction),
    recentRecords,
    createdAt: transaction.updatedAt,
  });
}

function mutationPolicy(transaction) {
  if (!transaction) return { canEdit: false, canDelete: false, reason: '找不到这笔记录。' };
  if (transaction.status !== 'active') return { canEdit: false, canDelete: false, reason: '这笔记录已经删除。' };
  if (transaction.lockedReason) return { canEdit: false, canDelete: false, reason: transaction.lockedReason };
  return { canEdit: true, canDelete: true, reason: '' };
}

function assertMutable(transaction, operation) {
  const policy = mutationPolicy(transaction);
  if (operation === 'edit' ? !policy.canEdit : !policy.canDelete) throw new Error(policy.reason);
}

export function createMoneyEngine({ accounts, transactions, installments = [], sharedLimitPools = [], today }) {
  const legacyPools = [];
  accounts.forEach((account) => {
    if (!account.sharedPool || legacyPools.some((pool) => pool.name === account.sharedPool)) return;
    legacyPools.push({ name: account.sharedPool, limit: account.sharedPoolTotal, sortOrder: legacyPools.length });
  });
  const initial = {
    accounts: structuredClone(accounts),
    transactions: structuredClone(transactions),
    installments: structuredClone(installments),
    sharedLimitPools: structuredClone(sharedLimitPools.length ? sharedLimitPools : legacyPools),
  };
  let state;
  let sequence = 0;
  let confirmationSequence = 0;
  let assetSequence = 0;
  let operationSequence = 0;
  let installmentSequence = 0;
  let poolSequence = 0;
  const submissionKeys = new Map();
  const assetOperationKeys = new Map();
  const listeners = new Set();

  function resetState() {
    state = {
      accounts: initial.accounts.map((account, index) => normalizeAccount(account, index)),
      transactions: [],
      installments: initial.installments.map((item, index) => normalizeCardInstallment(item, index, item?.createdAt || '2000-01-01T00:00:00.000Z')),
      sharedLimitPools: initial.sharedLimitPools.map((pool, index) => normalizeSharedLimitPool(pool, index, pool?.createdAt || '2000-01-01T00:00:00.000Z')),
      assetOperations: [],
    };
    syncAllAssetDerived(state.accounts, state.installments, state.sharedLimitPools, today);
    state.transactions = initial.transactions.map((transaction) => normalizeFixtureTransaction(transaction, state.accounts));
  }

  function notify() {
    listeners.forEach((listener) => listener(getSnapshot()));
  }

  function getSnapshot() {
    return structuredClone(state);
  }

  function refreshAssets() {
    syncAllAssetDerived(state.accounts, state.installments, state.sharedLimitPools, today);
  }

  function financialStateSnapshot() {
    return structuredClone({
      accounts: state.accounts,
      transactions: state.transactions,
      installments: state.installments,
      sharedLimitPools: state.sharedLimitPools,
    });
  }

  function financialFingerprint(snapshot = financialStateSnapshot()) {
    return JSON.stringify(snapshot);
  }

  function restoreFinancialState(snapshot) {
    state.accounts = structuredClone(snapshot.accounts);
    if (snapshot.transactions) state.transactions = structuredClone(snapshot.transactions);
    state.installments = structuredClone(snapshot.installments);
    state.sharedLimitPools = structuredClone(snapshot.sharedLimitPools);
    refreshAssets();
  }

  function assetById(id) {
    return state.accounts.find((account) => account.id === id);
  }

  function assertAsset(id, type = null) {
    const account = assetById(id);
    if (!account) throw new Error('账户不存在');
    if (type && account.type !== type) throw new Error('账户类型不适用');
    if (account.status !== 'active') throw new Error('账户已归档');
    return account;
  }

  function assertOperationIntegrity() {
    const integrity = validateAssetFinancialIntegrity({ accounts: state.accounts, installments: state.installments, pools: state.sharedLimitPools, operations: state.assetOperations, asOfDate: today });
    if (!integrity.ok) throw new Error(`资产完整性校验失败：${integrity.errors[0]}`);
  }

  function executeAssetOperation({ type, idempotencyKey, metadata = {}, mutate }) {
    const key = String(idempotencyKey || '').trim();
    if (!key) throw new Error('缺少操作幂等键');
    const existingId = assetOperationKeys.get(key);
    if (existingId) {
      const existing = state.assetOperations.find((operation) => operation.id === existingId);
      if (existing?.type !== type) throw new Error('相同操作键对应不同操作');
      return existing;
    }
    const before = financialStateSnapshot();
    let result;
    try {
      result = mutate();
      refreshAssets();
      assertOperationIntegrity();
    } catch (error) {
      restoreFinancialState(before);
      throw error;
    }
    const after = financialStateSnapshot();
    const createdAt = nowISO();
    const operation = {
      id: `asset-op-${String(++operationSequence).padStart(4, '0')}`,
      type,
      idempotencyKey: key,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      result: structuredClone(result || {}),
      metadata: structuredClone(metadata),
      beforeSnapshot: before,
      afterSnapshot: after,
      afterFingerprint: financialFingerprint(after),
    };
    state.assetOperations.unshift(operation);
    assetOperationKeys.set(key, operation.id);
    notify();
    return operation;
  }

  function changeDefault(type, accountId) {
    state.accounts.filter((account) => account.type === type).forEach((account) => {
      account.isDefault = account.id === accountId;
      account.isDefaultPaymentSource = account.id === accountId;
      account.updatedAt = nowISO();
    });
  }

  function normalizeNewAsset(input) {
    const type = String(input?.type || 'saving');
    const generatedId = `asset-${type}-${String(++assetSequence).padStart(4, '0')}`;
    const account = normalizeAccount({ ...input, id: input?.id || generatedId, sortOrder: state.accounts.filter((item) => item.type === type).length }, state.accounts.length);
    if (state.accounts.some((item) => item.id === account.id)) throw new Error('账户 ID 已存在');
    if (state.accounts.some((item) => item.status === 'active' && item.type === type && item.name.toLowerCase() === account.name.toLowerCase())) throw new Error('同类型账户名称不能重复');
    return account;
  }

  function paymentAllocation(card, amountMinor) {
    let remaining = amountMinor;
    const allocation = { feeMinor: 0, installmentMinor: 0, ordinaryDueMinor: 0, ordinaryMinor: 0, recordOnlyMinor: 0, cardCreditMinor: 0 };
    const fee = Math.min(remaining, card.feeDueMinor, card.feeInterestOutstandingMinor);
    card.feeDueMinor -= fee;
    card.feeInterestOutstandingMinor -= fee;
    allocation.feeMinor = fee;
    remaining -= fee;

    const dueInstallments = state.installments
      .filter((item) => item.cardId === card.id && item.status === 'active')
      .flatMap((installment) => installment.schedule
        .filter((occurrence) => occurrence.status !== 'paid' && occurrence.dueDate.slice(0, 7) <= today.slice(0, 7))
        .map((occurrence) => ({ installment, occurrence })));
    for (const { installment, occurrence } of dueInstallments) {
      if (remaining <= 0) break;
      const occurrenceRemaining = occurrence.amountMinor - Number(occurrence.paidMinor || 0);
      const paid = Math.min(remaining, occurrenceRemaining);
      occurrence.paidMinor = Number(occurrence.paidMinor || 0) + paid;
      installment.remainingPrincipalMinor -= paid;
      allocation.installmentMinor += paid;
      remaining -= paid;
      if (occurrence.paidMinor === occurrence.amountMinor) {
        occurrence.status = 'paid';
        occurrence.paidAt = nowISO();
        installment.paidTerms += 1;
      }
      installment.status = installment.remainingPrincipalMinor === 0 ? 'completed' : 'active';
      installment.updatedAt = nowISO();
      installment.revision += 1;
    }

    const ordinaryDue = Math.min(remaining, card.ordinaryDueMinor, card.ordinaryPrincipalOutstandingMinor);
    card.ordinaryDueMinor -= ordinaryDue;
    card.ordinaryPrincipalOutstandingMinor -= ordinaryDue;
    allocation.ordinaryDueMinor = ordinaryDue;
    remaining -= ordinaryDue;

    const ordinary = Math.min(remaining, card.ordinaryPrincipalOutstandingMinor);
    card.ordinaryPrincipalOutstandingMinor -= ordinary;
    card.ordinaryDueMinor = Math.max(0, card.ordinaryDueMinor - ordinary);
    allocation.ordinaryMinor = ordinary;
    remaining -= ordinary;

    const recordOnly = Math.min(remaining, card.recordOnlyDebtMinor);
    card.recordOnlyDebtMinor -= recordOnly;
    allocation.recordOnlyMinor = recordOnly;
    remaining -= recordOnly;

    if (remaining > 0) {
      card.cardCreditBalanceMinor += remaining;
      allocation.cardCreditMinor = remaining;
      remaining = 0;
    }
    if (card.ordinaryDueMinor + card.feeDueMinor === 0 && card.currentInstallmentDueMinor === 0) card.duePaid = true;
    return allocation;
  }

  resetState();

  return {
    today,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot,
    createCheckpoint() {
      return structuredClone({ state, sequence, confirmationSequence, assetSequence, operationSequence, installmentSequence, poolSequence });
    },
    restoreCheckpoint(checkpoint) {
      if (!checkpoint?.state) throw new Error('无效的账户检查点');
      state = structuredClone(checkpoint.state);
      sequence = Number(checkpoint.sequence || 0);
      confirmationSequence = Number(checkpoint.confirmationSequence || 0);
      assetSequence = Number(checkpoint.assetSequence || 0);
      operationSequence = Number(checkpoint.operationSequence || 0);
      installmentSequence = Number(checkpoint.installmentSequence || 0);
      poolSequence = Number(checkpoint.poolSequence || 0);
      submissionKeys.clear();
      assetOperationKeys.clear();
      state.transactions.forEach((transaction) => {
        if (transaction.submissionKey) submissionKeys.set(transaction.submissionKey, transaction);
      });
      state.assetOperations.forEach((operation) => assetOperationKeys.set(operation.idempotencyKey, operation.id));
      refreshAssets();
      notify();
    },
    getAccounts: () => state.accounts,
    getAccount: (id) => accountById(state.accounts, id),
    getCardInstallments: (cardId = null) => state.installments.filter((item) => !cardId || item.cardId === cardId),
    getSharedLimitPools: () => state.sharedLimitPools,
    getSharedLimitPool: (id) => state.sharedLimitPools.find((pool) => pool.id === id),
    getAssetOperations: ({ includeReversed = true } = {}) => state.assetOperations.filter((operation) => includeReversed || operation.status === 'active'),
    getAssetOperation: (id) => state.assetOperations.find((operation) => operation.id === id),
    createAsset(input) {
      const account = normalizeNewAsset(input);
      const openingBalanceMinor = account.type === 'cc' ? 0 : account.balanceMinor;
      if (account.type !== 'cc') account.balanceMinor = 0;
      state.accounts.push(account);
      if (input?.isDefault || !state.accounts.some((item) => item.type === account.type && item.status === 'active' && item.isDefault)) changeDefault(account.type, account.id);
      refreshAssets();
      assertOperationIntegrity();
      notify();
      if (openingBalanceMinor) this.recordAssetOpeningBalance({ accountId: account.id, amountMinor: openingBalanceMinor, idempotencyKey: `asset-opening:${account.id}` });
      if (account.type === 'cc' && Number(input?.openingRecordOnlyDebt || input?.openingRecordOnlyDebtMinor || 0) > 0) this.recordOpeningCardDebt({ cardId: account.id, amountMinor: input.openingRecordOnlyDebtMinor ?? minor(input.openingRecordOnlyDebt), idempotencyKey: `asset-opening-debt:${account.id}` });
      if (account.type === 'cc' && Number(input?.openingCardCredit || input?.openingCardCreditMinor || 0) > 0) this.recordOpeningCardCredit({ cardId: account.id, amountMinor: input.openingCardCreditMinor ?? minor(input.openingCardCredit), idempotencyKey: `asset-opening-credit:${account.id}` });
      return account;
    },
    updateAsset(id, changes) {
      const account = assetById(id);
      if (!account) throw new Error('账户不存在');
      const nextName = String(changes?.name ?? account.name).trim();
      if (!nextName) throw new Error('请输入账户名称');
      if (state.accounts.some((item) => item.id !== id && item.type === account.type && item.status === 'active' && item.name.toLowerCase() === nextName.toLowerCase())) throw new Error('同类型账户名称不能重复');
      const immutable = new Set(['id', 'type', 'ordinaryPrincipalOutstandingMinor', 'recordOnlyDebtMinor', 'installmentPrincipalOutstandingMinor', 'feeInterestOutstandingMinor', 'cardCreditBalanceMinor', 'balanceMinor']);
      Object.entries(changes || {}).forEach(([key, value]) => {
        if (!immutable.has(key)) account[key] = value;
      });
      account.name = nextName;
      if (account.type === 'saving') {
        account.bankAccountNumber = sanitizePrivateIdentifier(account.bankAccountNumber);
        account.debitCardNumber = sanitizePrivateIdentifier(account.debitCardNumber);
      }
      if (account.type === 'ew') account.walletIdentifier = sanitizePrivateIdentifier(account.walletIdentifier);
      if (account.type === 'cc') {
        account.creditCardLast4 = String(account.creditCardLast4 ?? account.last4 ?? '').replace(/\D/g, '').slice(-4);
        account.last4 = account.creditCardLast4;
        account.maskedDigits = account.creditCardLast4;
      }
      if (changes?.limit != null && account.type === 'cc') account.creditLimitMinor = minor(changes.limit);
      if (changes?.creditLimitMinor != null && account.type === 'cc') account.creditLimitMinor = Number(changes.creditLimitMinor);
      account.updatedAt = nowISO();
      account.revision += 1;
      if (changes?.isDefault) changeDefault(account.type, account.id);
      refreshAssets();
      assertOperationIntegrity();
      notify();
      return account;
    },
    archiveAsset(id) {
      const account = assertAsset(id);
      account.status = 'archived';
      account.archivedAt = nowISO();
      account.isDefault = false;
      account.updatedAt = account.archivedAt;
      const replacement = state.accounts.find((item) => item.type === account.type && item.status === 'active');
      if (replacement && !state.accounts.some((item) => item.type === account.type && item.status === 'active' && item.isDefault)) changeDefault(account.type, replacement.id);
      refreshAssets();
      notify();
      return account;
    },
    restoreAsset(id) {
      const account = assetById(id);
      if (!account) throw new Error('账户不存在');
      account.status = 'active';
      account.archivedAt = null;
      account.updatedAt = nowISO();
      if (!state.accounts.some((item) => item.type === account.type && item.status === 'active' && item.isDefault)) changeDefault(account.type, account.id);
      refreshAssets();
      notify();
      return account;
    },
    setAssetHidden(id, hidden) {
      const account = assetById(id);
      if (!account) throw new Error('账户不存在');
      account.isHidden = Boolean(hidden);
      account.updatedAt = nowISO();
      notify();
      return account;
    },
    setAssetIncludedInTotals(id, included) {
      const account = assetById(id);
      if (!account) throw new Error('账户不存在');
      account.includeInTotals = Boolean(included);
      account.updatedAt = nowISO();
      notify();
      return account;
    },
    setAssetActive(id, active) {
      const account = assetById(id);
      if (!account || account.status === 'archived') throw new Error('账户不存在或已归档');
      account.status = active ? 'active' : 'inactive';
      if (!active) account.isDefault = account.isDefaultPaymentSource = false;
      account.updatedAt = nowISO();
      if (active && !state.accounts.some((item) => item.type === account.type && item.status === 'active' && item.isDefault)) changeDefault(account.type, account.id);
      refreshAssets(); notify(); return account;
    },
    setDefaultAsset(type, id) {
      if (id == null) {
        state.accounts.filter((account) => account.type === type).forEach((account) => {
          account.isDefault = false;
          account.isDefaultPaymentSource = false;
          account.updatedAt = nowISO();
        });
        notify();
        return null;
      }
      const account = assertAsset(id);
      if (account.type !== type) throw new Error('默认账户类型不匹配');
      changeDefault(type, id);
      notify();
      return account;
    },
    reorderAssets(type, orderedIds) {
      const active = state.accounts.filter((account) => account.type === type && account.status === 'active');
      const expected = active.map((account) => account.id).sort();
      const requested = [...new Set(orderedIds || [])];
      if (requested.length !== active.length || JSON.stringify([...requested].sort()) !== JSON.stringify(expected)) throw new Error('账户排列不完整');
      requested.forEach((id, index) => { assetById(id).sortOrder = index; });
      state.accounts.sort((a, b) => a.type.localeCompare(b.type) || a.sortOrder - b.sortOrder);
      notify();
      return state.accounts.filter((account) => account.type === type && account.status === 'active');
    },
    canHardDeleteAsset(id) {
      const account = assetById(id);
      if (!account) return { allowed: false, reason: '账户不存在' };
      const hasTransactions = state.transactions.some((transaction) => [transaction.sourceAccountId, transaction.destinationAccountId, transaction.accountId].includes(id));
      const hasInstallments = state.installments.some((item) => item.cardId === id);
      const hasOperations = state.assetOperations.some((operation) => operation.metadata?.accountId === id || operation.metadata?.cardId === id || operation.metadata?.sourceAccountId === id);
      const hasPoolMembership = Boolean(account.sharedLimitPoolId);
      const nonZero = account.type === 'cc' ? account.totalCardDebtMinor !== 0 : account.balanceMinor !== 0;
      if (hasTransactions || hasInstallments || hasOperations || hasPoolMembership || nonZero) return { allowed: false, reason: '账户已有余额、分期、额度池或历史记录，请改为归档。' };
      return { allowed: true, reason: '' };
    },
    hardDeleteAsset(id) {
      const policy = this.canHardDeleteAsset(id);
      if (!policy.allowed) throw new Error(policy.reason);
      const index = state.accounts.findIndex((account) => account.id === id);
      const [removed] = state.accounts.splice(index, 1);
      refreshAssets();
      notify();
      return removed;
    },
    createSharedLimitPool(input) {
      const pool = normalizeSharedLimitPool({ ...input, id: input?.id || `limit-pool:user-${String(++poolSequence).padStart(4, '0')}` }, state.sharedLimitPools.length);
      if (state.sharedLimitPools.some((item) => item.id === pool.id)) throw new Error('共享额度池已存在');
      state.sharedLimitPools.push(pool);
      refreshAssets();
      notify();
      return pool;
    },
    updateSharedLimitPool(id, changes) {
      const pool = state.sharedLimitPools.find((item) => item.id === id);
      if (!pool) throw new Error('共享额度池不存在');
      if (changes?.name != null) pool.name = String(changes.name).trim();
      if (changes?.limit != null) pool.limitMinor = minor(changes.limit);
      if (changes?.limitMinor != null) pool.limitMinor = Number(changes.limitMinor);
      if (!pool.name || pool.limitMinor <= 0) throw new Error('共享额度池资料无效');
      pool.updatedAt = nowISO();
      refreshAssets();
      assertOperationIntegrity();
      notify();
      return pool;
    },
    assignCardToSharedLimitPool(cardId, poolId) {
      const card = assertAsset(cardId, 'cc');
      if (poolId && !state.sharedLimitPools.some((pool) => pool.id === poolId && pool.status === 'active')) throw new Error('共享额度池不存在');
      card.sharedLimitPoolId = poolId || null;
      card.updatedAt = nowISO();
      refreshAssets();
      notify();
      return card;
    },
    removeSharedLimitPool(id) {
      const pool = state.sharedLimitPools.find((item) => item.id === id);
      if (!pool) throw new Error('共享额度池不存在');
      const members = state.accounts.filter((account) => account.sharedLimitPoolId === id);
      if (members.length) throw new Error('请先从额度池移除所有信用卡');
      pool.status = 'archived';
      pool.updatedAt = nowISO();
      refreshAssets();
      notify();
      return pool;
    },
    getTransactions({ includeReversed = false } = {}) {
      return state.transactions
        .filter((transaction) => includeReversed || transaction.status === 'active')
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },
    getTransaction: (id) => state.transactions.find((transaction) => transaction.id === id),
    getTransactionMutationPolicy(transactionOrId) {
      const transaction = typeof transactionOrId === 'string'
        ? state.transactions.find((item) => item.id === transactionOrId)
        : transactionOrId;
      return mutationPolicy(transaction);
    },
    inspectTransactionCapacity(draft, { editingId = null } = {}) {
      const accountsCopy = structuredClone(state.accounts);
      if (editingId) {
        const previous = state.transactions.find((item) => item.id === editingId);
        if (!previous) throw new Error('找不到这笔记录');
        applyEffect(accountsCopy, previous, -1);
      }
      const normalized = validateAndNormalize(draft, accountsCopy);
      return inspectAccountCapacity(accountsCopy, normalized, draft.capacityAuthorization);
    },
    assertTransactionCapacity(draft, options = {}) {
      const result = this.inspectTransactionCapacity(draft, options);
      if (result.status !== 'allowed') throw new AccountCapacityError(result);
      return result;
    },
    addTransaction(draft) {
      if (draft.submissionKey && submissionKeys.has(draft.submissionKey)) return submissionKeys.get(draft.submissionKey);
      const normalized = validateAndNormalize(draft, state.accounts);
      const accountsBefore = structuredClone(state.accounts);
      const previousTransactions = state.transactions.filter((item) => item.status === 'active');
      const accountsCopy = structuredClone(state.accounts);
      assertAccountCapacity(accountsCopy, normalized, draft.capacityAuthorization);
      applyEffect(accountsCopy, normalized, 1);
      const createdAt = nowISO();
      const transaction = {
        ...normalized,
        id: `txn-${String(++sequence).padStart(4, '0')}`,
        createdAt,
        updatedAt: createdAt,
        revision: 1,
        editHistory: [],
        status: 'active',
        origin: 'user',
        submissionKey: draft.submissionKey || null,
        justSaved: true,
      };
      transaction.confirmation = confirmationSnapshot({ transaction, beforeAccounts: accountsBefore, afterAccounts: accountsCopy, previousTransactions, confirmationId: `motion:${transaction.id}:${transaction.revision}:${++confirmationSequence}` });
      state.accounts = accountsCopy;
      refreshAssets();
      state.transactions.unshift(transaction);
      if (draft.submissionKey) submissionKeys.set(draft.submissionKey, transaction);
      notify();
      return transaction;
    },
    editTransaction(id, changes) {
      const index = state.transactions.findIndex((transaction) => transaction.id === id);
      const previous = state.transactions[index];
      if (!previous || previous.status !== 'active') throw new Error('这笔记录已无法编辑');
      assertMutable(previous, 'edit');
      const candidateDraft = { ...previous, ...changes };
      if (Object.hasOwn(changes, 'amount') && !Object.hasOwn(changes, 'amountMinor')) delete candidateDraft.amountMinor;
      const normalized = validateAndNormalize(candidateDraft, state.accounts);
      const accountsBefore = structuredClone(state.accounts);
      const previousTransactions = state.transactions.filter((item) => item.status === 'active' && item.id !== id);
      const accountsCopy = structuredClone(state.accounts);
      applyEffect(accountsCopy, previous, -1);
      assertAccountCapacity(accountsCopy, normalized, changes.capacityAuthorization);
      applyEffect(accountsCopy, normalized, 1);
      const editedAt = nowISO();
      const fields = changedFields(previous, normalized);
      const history = {
        editedAt,
        at: editedAt,
        oldAmount: previous.amount,
        newAmount: normalized.amount,
        oldDescription: previous.desc,
        newDescription: normalized.desc,
        oldCategory: previous.catLabel,
        newCategory: normalized.catLabel,
        oldType: previous.kind,
        newType: normalized.kind,
        oldSourceAccountId: previous.sourceAccountId,
        newSourceAccountId: normalized.sourceAccountId,
        oldDestinationAccountId: previous.destinationAccountId,
        newDestinationAccountId: normalized.destinationAccountId,
        oldDate: previous.date,
        newDate: normalized.date,
        oldTime: previous.time,
        newTime: normalized.time,
        changedFields: fields,
        revision: previous.revision + 1,
        from: { amount: previous.amount, desc: previous.desc, category: previous.catLabel, kind: previous.kind },
        to: { amount: normalized.amount, desc: normalized.desc, category: normalized.catLabel, kind: normalized.kind },
      };
      const transaction = {
        ...previous,
        ...normalized,
        createdAt: previous.createdAt,
        updatedAt: editedAt,
        revision: previous.revision + 1,
        editHistory: [...previous.editHistory, history],
        justSaved: false,
      };
      transaction.confirmation = confirmationSnapshot({ transaction, beforeAccounts: accountsBefore, afterAccounts: accountsCopy, previousTransactions, confirmationId: `motion:${transaction.id}:${transaction.revision}:${++confirmationSequence}`, operation: 'edit' });
      state.accounts = accountsCopy;
      refreshAssets();
      state.transactions[index] = transaction;
      notify();
      return transaction;
    },
    reverseTransaction(id, { force = false } = {}) {
      const index = state.transactions.findIndex((transaction) => transaction.id === id);
      const transaction = state.transactions[index];
      if (!transaction || transaction.status !== 'active') throw new Error('这笔记录已经删除');
      if (!force) assertMutable(transaction, 'delete');
      const sourcePresentationBefore = transaction.sourceAccountId ? accountById(state.accounts, transaction.sourceAccountId)?.outstanding : null;
      const accountsCopy = structuredClone(state.accounts);
      applyEffect(accountsCopy, transaction, -1);
      state.accounts = accountsCopy;
      refreshAssets();
      const reversedSource = transaction.sourceAccountId ? accountById(state.accounts, transaction.sourceAccountId) : null;
      if (reversedSource?.type === 'cc' && Number.isFinite(sourcePresentationBefore)) {
        // Preserve the existing public decimal adapter contract for baseline
        // fixture reversal while the authoritative value remains integer minor.
        reversedSource.outstanding = sourcePresentationBefore - transaction.amount - fromMinor(Number(transaction.feeMinor || 0));
        reversedSource.currentOutstanding = reversedSource.outstanding;
      }
      state.transactions[index] = {
        ...transaction,
        status: 'reversed',
        reversedAt: nowISO(),
        reversal: { reason: 'user-delete', revision: transaction.revision },
        justSaved: false,
      };
      notify();
      return state.transactions[index];
    },
    markTransactionReversalAudit(id, reversal) {
      const transaction = state.transactions.find((item) => item.id === id);
      if (!transaction) throw new Error('找不到原始记录');
      transaction.reversal = { ...(transaction.reversal || {}), ...structuredClone(reversal || {}) };
      transaction.reversalAudit = structuredClone(transaction.reversal);
      transaction.updatedAt = nowISO();
      notify();
      return transaction;
    },
    deleteTransaction(id) {
      return this.reverseTransaction(id);
    },
    // Attachment membership only — no financial meaning. Keep a lightweight
    // evidence audit without fabricating a financial edit revision.
    setTransactionAttachments(id, attachmentIds) {
      const transaction = state.transactions.find((item) => item.id === id);
      if (!transaction) throw new Error('找不到这笔记录');
      const previousIds = structuredClone(transaction.attachmentIds || []);
      transaction.attachmentIds = structuredClone(attachmentIds || []);
      transaction.updatedAt = nowISO();
      if (JSON.stringify(previousIds) !== JSON.stringify(transaction.attachmentIds)) {
        transaction.attachmentAudit = [
          ...(transaction.attachmentAudit || []),
          {
            occurredAt: transaction.updatedAt,
            previousCount: previousIds.length,
            nextCount: transaction.attachmentIds.length,
          },
        ];
      }
      notify();
      return transaction;
    },
    recordAssetAdjustment({ accountId, deltaMinor, amount, note = '', idempotencyKey }) {
      const normalizedDelta = deltaMinor ?? minor(amount);
      if (!Number.isInteger(normalizedDelta) || normalizedDelta === 0) throw new Error('调整金额不能为零');
      return executeAssetOperation({
        type: 'asset_adjustment',
        idempotencyKey,
        metadata: { accountId, deltaMinor: normalizedDelta, note: String(note || '').trim(), spendingDeltaMinor: 0, incomeDeltaMinor: 0 },
        mutate: () => {
          const account = assertAsset(accountId);
          if (account.type === 'cc') throw new Error('信用卡请使用欠款调整');
          if (account.balanceMinor + normalizedDelta < 0) throw new Error('调整后余额不能小于零');
          const beforeMinor = account.balanceMinor;
          account.balanceMinor += normalizedDelta;
          account.updatedAt = nowISO();
          account.revision += 1;
          return { accountId, beforeMinor, afterMinor: account.balanceMinor, deltaMinor: normalizedDelta };
        },
      });
    },
    recordAssetTargetBalance({ accountId, targetBalanceMinor, targetBalance, note = '', idempotencyKey }) {
      const normalizedTarget = targetBalanceMinor ?? minor(targetBalance);
      if (!Number.isInteger(normalizedTarget) || normalizedTarget < 0) throw new Error('调整后余额不能小于零');
      return executeAssetOperation({
        type: 'asset_adjustment', idempotencyKey,
        metadata: { accountId, targetBalanceMinor: normalizedTarget, note: String(note || '').trim(), spendingDeltaMinor: 0, incomeDeltaMinor: 0 },
        mutate: () => {
          const account = assertAsset(accountId);
          if (account.type === 'cc') throw new Error('信用卡请使用欠款调整');
          const beforeMinor = account.balanceMinor;
          const deltaMinor = normalizedTarget - beforeMinor;
          if (deltaMinor === 0) throw new Error('调整后余额没有变化');
          account.balanceMinor = normalizedTarget;
          account.updatedAt = nowISO(); account.revision += 1;
          return { accountId, beforeMinor, afterMinor: normalizedTarget, deltaMinor };
        },
      });
    },
    recordAssetOpeningBalance({ accountId, amountMinor, amount, idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount < 0) throw new Error('初始余额无效');
      return executeAssetOperation({
        type: 'asset_opening_balance', idempotencyKey,
        metadata: { accountId, amountMinor: normalizedAmount, spendingDeltaMinor: 0, incomeDeltaMinor: 0, opening: true },
        mutate: () => {
          const account = assertAsset(accountId);
          if (account.type === 'cc') throw new Error('信用卡不使用现金初始余额');
          const beforeMinor = account.balanceMinor;
          account.balanceMinor += normalizedAmount;
          account.updatedAt = nowISO(); account.revision += 1;
          return { accountId, beforeMinor, afterMinor: account.balanceMinor, deltaMinor: normalizedAmount };
        },
      });
    },
    recordOpeningCardDebt({ cardId, amountMinor, amount, note = '', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('导入欠款必须大于零');
      return executeAssetOperation({
        type: 'card_opening_debt',
        idempotencyKey,
        metadata: { cardId, amountMinor: normalizedAmount, note: String(note || '').trim(), recordOnly: true, spendingDeltaMinor: 0, incomeDeltaMinor: 0 },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          card.recordOnlyDebtMinor += normalizedAmount;
          card.updatedAt = nowISO();
          card.revision += 1;
          return { cardId, amountMinor: normalizedAmount, recordOnlyDebtMinor: card.recordOnlyDebtMinor };
        },
      });
    },
    recordOpeningCardCredit({ cardId, amountMinor, amount, note = '', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('初始卡片余额必须大于零');
      return executeAssetOperation({
        type: 'card_opening_credit', idempotencyKey,
        metadata: { cardId, amountMinor: normalizedAmount, note: String(note || '').trim(), spendingDeltaMinor: 0, incomeDeltaMinor: 0, opening: true },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          card.cardCreditBalanceMinor += normalizedAmount;
          card.updatedAt = nowISO(); card.revision += 1;
          return { cardId, amountMinor: normalizedAmount, cardCreditBalanceMinor: card.cardCreditBalanceMinor };
        },
      });
    },
    recordCardFee({ cardId, amountMinor, amount, description = '费用与利息', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('费用金额必须大于零');
      return executeAssetOperation({
        type: 'card_fee',
        idempotencyKey,
        metadata: { cardId, amountMinor: normalizedAmount, description, spendingDeltaMinor: normalizedAmount, incomeDeltaMinor: 0 },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          card.feeInterestOutstandingMinor += normalizedAmount;
          card.feeDueMinor += normalizedAmount;
          if (!card.cycleAnchorDate) {
            card.cycleAnchorDate = today;
            card.dueDate = nextCalendarMonthSameDay(today);
          }
          card.duePaid = false;
          card.updatedAt = nowISO();
          card.revision += 1;
          return { cardId, amountMinor: normalizedAmount };
        },
      });
    },
    createCardInstallment({ cardId, name, principalMinor, principal, termCount, firstDueDate, aaOwnShareMinor, aaReceivableMinor = 0, categoryId = null, categoryLabel = '', occurredAt = null, note = '', idempotencyKey }) {
      const normalizedPrincipal = principalMinor ?? minor(principal);
      const dueDate = firstDueDate || nextCalendarMonthSameDay(today);
      const schedule = buildInstallmentSchedule({ principalMinor: normalizedPrincipal, termCount: Number(termCount), firstDueDate: dueDate });
      return executeAssetOperation({
        type: 'card_installment_purchase',
        idempotencyKey,
        metadata: {
          cardId,
          amountMinor: normalizedPrincipal,
          spendingDeltaMinor: normalizedPrincipal,
          incomeDeltaMinor: 0,
          aaOwnShareMinor: aaOwnShareMinor ?? normalizedPrincipal,
          aaReceivableMinor,
          originMode: 'new-purchase',
          categoryId,
          categoryLabel,
          occurredAt,
          note: String(note || '').trim(),
        },
        mutate: () => {
          assertAsset(cardId, 'cc');
          const installment = normalizeCardInstallment({
            id: `card-installment:user-${String(++installmentSequence).padStart(4, '0')}`,
            cardId,
            name,
            principalMinor: normalizedPrincipal,
            termCount: Number(termCount),
            firstDueDate: dueDate,
            schedule,
            aaOwnShareMinor: aaOwnShareMinor ?? normalizedPrincipal,
            aaReceivableMinor,
            originMode: 'new-purchase',
            categoryId,
            categoryLabel,
            occurredAt,
            note,
          }, state.installments.length);
          state.installments.push(installment);
          return { installmentId: installment.id, cardId, principalMinor: normalizedPrincipal, schedule: structuredClone(schedule) };
        },
      });
    },
    convertPurchaseToInstallment({ cardId, transactionId, termCount, firstDueDate, idempotencyKey }) {
      const transaction = state.transactions.find((item) => item.id === transactionId);
      if (!transaction || transaction.status !== 'active' || transaction.kind !== 'expense' || transaction.sourceAccountId !== cardId || transaction.accountEffect !== 'posted') throw new Error('找不到可转换的原消费');
      if (transaction.convertedInstallmentId) throw new Error('原消费已转换为分期');
      if (Number(transaction.refundedMinor || 0) > 0) throw new Error('已退款消费不适用分期转换');
      const principalMinor = transaction.amountMinor;
      const dueDate = firstDueDate || nextCalendarMonthSameDay(today);
      const schedule = buildInstallmentSchedule({ principalMinor, termCount: Number(termCount), firstDueDate: dueDate });
      return executeAssetOperation({
        type: 'card_installment_conversion', idempotencyKey,
        metadata: { cardId, linkedTransactionId: transactionId, amountMinor: principalMinor, spendingDeltaMinor: 0, incomeDeltaMinor: 0, aaReceivableMinor: Number(transaction.aaReceivableMinor || 0), originMode: 'converted-purchase' },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          if (card.ordinaryPrincipalOutstandingMinor < principalMinor) throw new Error('原消费剩余普通欠款不足，无法转换');
          card.ordinaryPrincipalOutstandingMinor -= principalMinor;
          card.ordinaryDueMinor = Math.max(0, card.ordinaryDueMinor - principalMinor);
          const installment = normalizeCardInstallment({
            id: `card-installment:user-${String(++installmentSequence).padStart(4, '0')}`,
            cardId, name: transaction.desc, principalMinor, termCount: Number(termCount), firstDueDate: dueDate, schedule,
            originMode: 'converted-purchase', linkedTransactionId: transaction.id,
            aaOwnShareMinor: principalMinor - Number(transaction.aaReceivableMinor || 0),
            aaReceivableMinor: Number(transaction.aaReceivableMinor || 0),
          }, state.installments.length);
          state.installments.push(installment);
          transaction.convertedInstallmentId = installment.id;
          transaction.updatedAt = nowISO();
          return { installmentId: installment.id, cardId, linkedTransactionId: transaction.id, principalMinor, schedule: structuredClone(schedule) };
        },
      });
    },
    importCardInstallment({ cardId, name, remainingPrincipalMinor, remainingPrincipal, remainingTermCount, nextDueDate, originalTermCount = null, monthlyAmountMinor = null, monthlyAmount = null, note = '', idempotencyKey }) {
      const principalMinor = remainingPrincipalMinor ?? minor(remainingPrincipal);
      const termCount = Number(remainingTermCount);
      const schedule = buildInstallmentSchedule({ principalMinor, termCount, firstDueDate: nextDueDate });
      const suppliedMonthlyMinor = monthlyAmountMinor ?? (monthlyAmount == null || monthlyAmount === '' ? null : minor(monthlyAmount));
      return executeAssetOperation({
        type: 'card_installment_import', idempotencyKey,
        metadata: { cardId, amountMinor: principalMinor, spendingDeltaMinor: 0, incomeDeltaMinor: 0, recordOnly: true, originMode: 'imported-existing', originalTermCount: originalTermCount == null ? null : Number(originalTermCount), suppliedMonthlyMinor, note: String(note || '').trim() },
        mutate: () => {
          assertAsset(cardId, 'cc');
          const installment = normalizeCardInstallment({
            id: `card-installment:user-${String(++installmentSequence).padStart(4, '0')}`,
            cardId, name, principalMinor, termCount, firstDueDate: nextDueDate, schedule,
            originMode: 'imported-existing', imported: true, recordOnly: true,
            originalTermCount: originalTermCount == null ? termCount : Number(originalTermCount),
            suppliedMonthlyMinor, note,
          }, state.installments.length);
          state.installments.push(installment);
          return { installmentId: installment.id, cardId, principalMinor, schedule: structuredClone(schedule), originMode: 'imported-existing' };
        },
      });
    },
    recordCardPayment({ cardId, sourceAccountId, amountMinor, amount, note = '', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('还款金额必须大于零');
      return executeAssetOperation({
        type: 'card_payment',
        idempotencyKey,
        metadata: { cardId, sourceAccountId, amountMinor: normalizedAmount, note: String(note || '').trim(), spendingDeltaMinor: 0, incomeDeltaMinor: 0 },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          const source = assertAsset(sourceAccountId);
          if (source.type === 'cc') throw new Error('请选择储蓄账户或 eWallet 还款');
          if (source.balanceMinor < normalizedAmount) throw new Error('付款账户余额不足');
          const sourceBeforeMinor = source.balanceMinor;
          const cardBeforeMinor = card.totalCardDebtMinor;
          source.balanceMinor -= normalizedAmount;
          source.updatedAt = nowISO();
          source.revision += 1;
          const allocation = paymentAllocation(card, normalizedAmount);
          card.monthPaidMinor = Number(card.monthPaidMinor || 0)
            + allocation.feeMinor + allocation.installmentMinor + allocation.ordinaryDueMinor;
          card.updatedAt = nowISO();
          card.revision += 1;
          return { cardId, sourceAccountId, amountMinor: normalizedAmount, sourceBeforeMinor, sourceAfterMinor: source.balanceMinor, cardBeforeMinor, allocation };
        },
      });
    },
    recordCardRefund({ cardId, amountMinor, amount, description = '信用卡退款', linkedTransactionId = null, idempotencyKey }) {
      if (linkedTransactionId && state.transactions.some((item) => item.id === linkedTransactionId)) {
        return this.recordLinkedCardRefund({ cardId, amountMinor, amount, description, linkedTransactionId, idempotencyKey });
      }
      const operation = this.recordGeneralCardCredit({ cardId, amountMinor, amount, description, idempotencyKey });
      // Compatibility for pre-2D1A callers that supplied only a display link.
      if (linkedTransactionId) {
        operation.metadata.linkedTransactionId = linkedTransactionId;
        operation.metadata.spendingDeltaMinor = -operation.metadata.amountMinor;
      }
      return operation;
    },
    recordLinkedCardRefund({ cardId, linkedTransactionId, amountMinor, amount, description = '原消费退款', note = '', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('退款金额必须大于零');
      const transaction = state.transactions.find((item) => item.id === linkedTransactionId);
      if (!transaction || transaction.status !== 'active' || transaction.kind !== 'expense' || transaction.sourceAccountId !== cardId || transaction.accountEffect !== 'posted') throw new Error('找不到可退款的原消费');
      if (transaction.convertedInstallmentId) throw new Error('已转换分期的消费不适用普通退款');
      const refundedBeforeMinor = Number(transaction.refundedMinor || 0);
      const refundableMinor = transaction.amountMinor - refundedBeforeMinor;
      if (refundableMinor <= 0) throw new Error('原消费已全额退款');
      if (normalizedAmount > refundableMinor) throw new Error('退款金额超过剩余可退款金额');
      return executeAssetOperation({
        type: 'card_linked_refund',
        idempotencyKey,
        metadata: { cardId, amountMinor: normalizedAmount, description, note: String(note || '').trim(), linkedTransactionId, spendingDeltaMinor: -normalizedAmount, incomeDeltaMinor: 0, refundMode: 'linked-purchase' },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          const debtReductionMinor = Math.min(normalizedAmount, card.ordinaryPrincipalOutstandingMinor);
          card.ordinaryPrincipalOutstandingMinor -= debtReductionMinor;
          card.ordinaryDueMinor = Math.max(0, card.ordinaryDueMinor - debtReductionMinor);
          const creditMinor = normalizedAmount - debtReductionMinor;
          if (creditMinor > 0) card.cardCreditBalanceMinor += creditMinor;
          const originalAAReceivableMinor = Number(transaction.aaReceivableMinor || 0);
          const aaReceivableReductionMinor = Math.min(
            Math.max(0, originalAAReceivableMinor - Number(transaction.aaRefundedMinor || 0)),
            Math.floor(originalAAReceivableMinor * normalizedAmount / transaction.amountMinor),
          );
          transaction.refundedMinor = refundedBeforeMinor + normalizedAmount;
          transaction.aaRefundedMinor = Number(transaction.aaRefundedMinor || 0) + aaReceivableReductionMinor;
          transaction.updatedAt = nowISO();
          card.updatedAt = nowISO();
          card.revision += 1;
          return { cardId, amountMinor: normalizedAmount, linkedTransactionId, debtReductionMinor, cardCreditAddedMinor: creditMinor, remainingRefundableMinor: refundableMinor - normalizedAmount, aaReceivableReductionMinor };
        },
      });
    },
    recordGeneralCardCredit({ cardId, amountMinor, amount, description = '一般卡片退款', date = today, time = '12:00', note = '', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('退款金额必须大于零');
      return executeAssetOperation({
        type: 'card_general_credit', idempotencyKey,
        metadata: { cardId, amountMinor: normalizedAmount, description, date, time, note: String(note || '').trim(), spendingDeltaMinor: 0, incomeDeltaMinor: 0, refundMode: 'general-card-credit' },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          const debtReductionMinor = Math.min(normalizedAmount, card.ordinaryPrincipalOutstandingMinor);
          card.ordinaryPrincipalOutstandingMinor -= debtReductionMinor;
          card.ordinaryDueMinor = Math.max(0, card.ordinaryDueMinor - debtReductionMinor);
          const creditMinor = normalizedAmount - debtReductionMinor;
          if (creditMinor > 0) card.cardCreditBalanceMinor += creditMinor;
          card.updatedAt = nowISO(); card.revision += 1;
          return { cardId, amountMinor: normalizedAmount, debtReductionMinor, cardCreditAddedMinor: creditMinor };
        },
      });
    },
    recordCardCashback({ cardId, amountMinor, amount, date = today, time = '12:00', source = '', note = '', idempotencyKey }) {
      const normalizedAmount = amountMinor ?? minor(amount);
      if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) throw new Error('Cashback 金额必须大于零');
      return executeAssetOperation({
        type: 'card_cashback',
        idempotencyKey,
        metadata: {
          cardId,
          amountMinor: normalizedAmount,
          date,
          time,
          source: String(source || '').trim(),
          note: String(note || '').trim(),
          spendingDeltaMinor: 0,
          incomeDeltaMinor: 0,
          rewardType: 'statement-credit',
        },
        mutate: () => {
          const card = assertAsset(cardId, 'cc');
          const cardBeforeMinor = card.totalCardDebtMinor;
          if (normalizedAmount > cardBeforeMinor) throw new Error('Cashback 不能超过当前信用卡欠款');
          // A statement credit offsets gross debt without pretending that an
          // installment principal, savings balance or cash-income stream moved.
          card.cardCreditBalanceMinor += normalizedAmount;
          card.updatedAt = nowISO();
          card.revision += 1;
          return {
            cardId,
            amountMinor: normalizedAmount,
            cardBeforeMinor,
            cardAfterMinor: cardBeforeMinor - normalizedAmount,
            debtReductionMinor: normalizedAmount,
          };
        },
      });
    },
    getCardCashbackSummary(cardId, monthKey = today.slice(0, 7)) {
      const operations = state.assetOperations.filter((operation) => operation.type === 'card_cashback'
        && operation.status === 'active'
        && operation.metadata?.cardId === cardId);
      const monthlyMinor = operations
        .filter((operation) => String(operation.metadata?.date || operation.createdAt).startsWith(monthKey))
        .reduce((sum, operation) => sum + Number(operation.metadata?.amountMinor || 0), 0);
      const totalMinor = operations.reduce((sum, operation) => sum + Number(operation.metadata?.amountMinor || 0), 0);
      return { cardId, monthKey, monthlyMinor, totalMinor, count: operations.length };
    },
    reverseAssetOperation(id, { reason = 'user-reversal' } = {}) {
      const operation = state.assetOperations.find((item) => item.id === id);
      if (!operation) throw new Error('找不到资产操作');
      if (operation.status === 'reversed') return operation;
      if (financialFingerprint() !== operation.afterFingerprint) throw new Error('后续财务状态已变化，无法安全撤销这次操作');
      restoreFinancialState(operation.beforeSnapshot);
      operation.status = 'reversed';
      operation.reversedAt = nowISO();
      operation.updatedAt = operation.reversedAt;
      operation.reversal = { reason, restoredExactly: true };
      notify();
      return operation;
    },
    getAssetFinancialIntegrity() {
      return validateAssetFinancialIntegrity({ accounts: state.accounts, installments: state.installments, pools: state.sharedLimitPools, operations: state.assetOperations, asOfDate: today });
    },
    getAssetFinancialSummary(input = {}) {
      return selectAssetFinancialSummary({ accounts: state.accounts, installments: state.installments, pools: state.sharedLimitPools, asOfDate: today, ...input });
    },
    transferFunds(draft) {
      return this.addTransaction({ ...draft, kind: 'transfer', catId: draft.catId || 'transfer-fallback', catLabel: draft.catLabel || '转账' });
    },
    getAccountBalance(id) {
      const account = accountById(state.accounts, id);
      if (!account) throw new Error('账户不存在');
      return account.type === 'cc' ? account.outstanding : account.balance;
    },
    getUserTransactions() {
      return state.transactions.filter((transaction) => transaction.origin === 'user' && transaction.status === 'active');
    },
    getDerivedMetrics({ investmentTotal = 0, fixedDepositTotal = 0, aaReceivable = 0, myFixed = 0 } = {}) {
      const summary = selectAssetFinancialSummary({
        accounts: state.accounts,
        installments: state.installments,
        pools: state.sharedLimitPools,
        investmentMinor: minor(investmentTotal),
        fixedDepositMinor: minor(fixedDepositTotal),
        aaReceivableMinor: minor(aaReceivable),
        myFixedMinor: minor(myFixed),
        includeInstallmentInMyFixed: false,
        asOfDate: today,
      });
      return {
        ...summary,
        currentCash: major(summary.currentCashMinor),
        myFixed: major(summary.myFixedMinor),
        totalCardDebt: major(summary.totalCardDebtMinor),
        monthCardDue: major(summary.monthCardDueMinor),
        afterCardPayment: major(summary.afterCardPaymentMinor),
        aaReceivable: major(summary.aaReceivableMinor),
        afterReceive: major(summary.afterReceiveMinor),
        totalAssets: major(summary.totalAssetsMinor),
        totalDebt: major(summary.totalDebtMinor),
        netDebt: major(summary.netDebtMinor),
        netAssets: major(summary.netAssetsMinor),
        fullPayoffPosition: major(summary.fullPayoffPositionMinor),
      };
    },
    resetDemoData() {
      sequence = 0;
      confirmationSequence = 0;
      assetSequence = 0;
      operationSequence = 0;
      installmentSequence = 0;
      poolSequence = 0;
      submissionKeys.clear();
      assetOperationKeys.clear();
      resetState();
      notify();
    },
    projectAAReceivable: () => null,
    settleAAReceivable: () => null,
    reverseAAProjection: () => null,
    postFixedExpense: () => null,
    reverseFixedExpense: () => null,
  };
}
