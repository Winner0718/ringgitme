// In-memory money engine. It owns the authoritative account and transaction
// snapshot; UI modules only interact through the data-source adapter.

import { AccountCapacityError, assertAccountCapacity, inspectAccountCapacity } from './accountCapacity.js';
import { accountConfirmationSnapshot, immutableConfirmationSnapshot } from './confirmationSnapshot.js';

const ACCOUNT_TYPE = { saving: 'savings', ew: 'ewallet', cc: 'credit' };
const VALID_KINDS = new Set(['expense', 'income', 'transfer']);
const VALID_ACCOUNT_EFFECTS = new Set(['posted', 'record_only', 'relationship_only']);

export function toMinor(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('金额无效');
  return Math.round(n * 100);
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

function normalizeAccount(raw) {
  const account = structuredClone(raw);
  account.domainType = ACCOUNT_TYPE[account.type] || account.type;
  account.institution = account.bank;
  account.maskedDigits = account.last4 || '';
  account.recordOnlySupported = true;
  if (account.type === 'cc') {
    account.creditLimitMinor = Number.isFinite(Number(account.limit)) ? toMinor(account.limit) : null;
    account.currentOutstandingMinor = Number.isFinite(Number(account.outstanding)) ? toMinor(account.outstanding) : 0;
  } else {
    account.balanceMinor = toMinor(account.balance);
  }
  return syncAccount(account);
}

function syncAccount(account) {
  if (account.type === 'cc') {
    account.limit = Number.isInteger(account.creditLimitMinor) ? fromMinor(account.creditLimitMinor) : null;
    account.creditLimit = account.limit;
    account.outstanding = fromMinor(account.currentOutstandingMinor);
    account.currentOutstanding = account.outstanding;
    account.availableCreditMinor = Number.isInteger(account.creditLimitMinor) ? Math.max(0, account.creditLimitMinor - account.currentOutstandingMinor) : null;
    account.availableCredit = account.availableCreditMinor == null ? null : fromMinor(account.availableCreditMinor);
    account.overLimitMinor = Number.isInteger(account.creditLimitMinor) ? Math.max(0, account.currentOutstandingMinor - account.creditLimitMinor) : null;
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
      source.currentOutstandingMinor += delta + feeDelta;
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

export function createMoneyEngine({ accounts, transactions, today }) {
  const initial = { accounts: structuredClone(accounts), transactions: structuredClone(transactions) };
  let state;
  let sequence = 0;
  let confirmationSequence = 0;
  const submissionKeys = new Map();
  const listeners = new Set();

  function resetState() {
    state = {
      accounts: initial.accounts.map(normalizeAccount),
      transactions: [],
    };
    state.transactions = initial.transactions.map((transaction) => normalizeFixtureTransaction(transaction, state.accounts));
  }

  function notify() {
    listeners.forEach((listener) => listener(getSnapshot()));
  }

  function getSnapshot() {
    return structuredClone(state);
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
      return structuredClone({ state, sequence, confirmationSequence });
    },
    restoreCheckpoint(checkpoint) {
      if (!checkpoint?.state) throw new Error('无效的账户检查点');
      state = structuredClone(checkpoint.state);
      sequence = Number(checkpoint.sequence || 0);
      confirmationSequence = Number(checkpoint.confirmationSequence || 0);
      submissionKeys.clear();
      state.transactions.forEach((transaction) => {
        if (transaction.submissionKey) submissionKeys.set(transaction.submissionKey, transaction);
      });
      notify();
    },
    getAccounts: () => state.accounts,
    getAccount: (id) => accountById(state.accounts, id),
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
      state.transactions[index] = transaction;
      notify();
      return transaction;
    },
    reverseTransaction(id, { force = false } = {}) {
      const index = state.transactions.findIndex((transaction) => transaction.id === id);
      const transaction = state.transactions[index];
      if (!transaction || transaction.status !== 'active') throw new Error('这笔记录已经删除');
      if (!force) assertMutable(transaction, 'delete');
      const accountsCopy = structuredClone(state.accounts);
      applyEffect(accountsCopy, transaction, -1);
      state.accounts = accountsCopy;
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
    getDerivedMetrics({ investmentTotal = 0, fixedDepositTotal = 0, instalmentRemaining = 0, monthCardDue = 0, aaReceivable = 0, myFixed = 0 }) {
      const currentCashMinor = state.accounts.filter((account) => account.type !== 'cc').reduce((sum, account) => sum + account.balanceMinor, 0);
      const cardOutstandingMinor = state.accounts.filter((account) => account.type === 'cc').reduce((sum, account) => sum + account.currentOutstandingMinor, 0);
      const currentCash = fromMinor(currentCashMinor);
      const totalCardDebt = fromMinor(cardOutstandingMinor) + instalmentRemaining;
      const totalAssets = currentCash + investmentTotal + fixedDepositTotal;
      return {
        currentCash,
        myFixed,
        totalCardDebt,
        monthCardDue,
        afterCardPayment: currentCash - monthCardDue,
        aaReceivable,
        afterReceive: currentCash + aaReceivable,
        totalAssets,
        totalDebt: totalCardDebt,
        netDebt: totalCardDebt - currentCash,
        netAssets: totalAssets - totalCardDebt,
      };
    },
    resetDemoData() {
      sequence = 0;
      confirmationSequence = 0;
      submissionKeys.clear();
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
