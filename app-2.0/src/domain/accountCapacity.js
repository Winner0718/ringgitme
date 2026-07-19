// Central capacity policy for every canonical outgoing posting. The UI only
// presents these structured results; all authoritative math stays in minor units.

const CREDIT_TYPES = new Set(['cc', 'credit', 'credit_card']);

function stableHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `capacity-${(hash >>> 0).toString(36)}`;
}

function accountById(accounts, id) {
  return accounts.find((account) => account.id === id);
}

export function outgoingPostings(transaction) {
  if (transaction.accountEffect !== 'posted') return [];
  const feeMinor = Number(transaction.feeMinor || transaction.transferFeeMinor || 0);
  if (transaction.kind === 'expense') {
    return [{ accountId: transaction.sourceAccountId, requiredMinor: transaction.amountMinor + feeMinor, role: 'expense' }];
  }
  if (transaction.kind === 'transfer') {
    return [{ accountId: transaction.sourceAccountId, requiredMinor: transaction.amountMinor + feeMinor, role: 'transfer' }];
  }
  return [];
}

export function capacityFingerprint({ transaction, account, requiredMinor }) {
  return stableHash(JSON.stringify({
    accountId: account.id,
    operation: transaction.kind,
    amountMinor: transaction.amountMinor,
    feeMinor: transaction.feeMinor || transaction.transferFeeMinor || 0,
    relationshipMode: transaction.relationshipMode || null,
    clientEventId: transaction.submissionKey || transaction.clientEventId || null,
    requiredMinor,
    creditLimitMinor: account.effectiveCreditLimitMinor ?? account.creditLimitMinor ?? null,
    outstandingMinor: account.currentOutstandingMinor ?? null,
    availableCreditMinor: account.availableCreditMinor ?? null,
    sharedLimitPoolId: account.sharedLimitPoolId ?? null,
  }));
}

export function inspectAccountCapacity(accounts, transaction, authorization = null) {
  const postings = outgoingPostings(transaction);
  for (const posting of postings) {
    const account = accountById(accounts, posting.accountId);
    if (!account) continue;
    const requiredMinor = posting.requiredMinor;
    if (!CREDIT_TYPES.has(account.type) && !CREDIT_TYPES.has(account.domainType)) {
      const currentMinor = Number(account.balanceMinor);
      if (requiredMinor > currentMinor) {
        return {
          status: 'insufficient-cash', accountId: account.id, accountType: account.type,
          accountName: account.name, role: posting.role, currentMinor, requiredMinor,
          shortageMinor: requiredMinor - currentMinor, feeMinor: transaction.feeMinor || 0,
        };
      }
      continue;
    }

    const creditLimitMinor = Number.isInteger(account.effectiveCreditLimitMinor)
      ? account.effectiveCreditLimitMinor
      : Number.isInteger(account.creditLimitMinor) ? account.creditLimitMinor : null;
    const outstandingMinor = Number(account.currentOutstandingMinor || 0);
    const confirmationFingerprint = capacityFingerprint({ transaction, account, requiredMinor });
    if (creditLimitMinor == null) {
      if (authorization?.fingerprint === confirmationFingerprint) continue;
      return {
        status: 'credit-limit-unknown', accountId: account.id, accountType: account.type,
        accountName: account.name, role: posting.role, requiredMinor, outstandingMinor,
        creditLimitMinor: null, availableCreditMinor: null, overLimitMinor: null,
        confirmationFingerprint,
      };
    }
    // Shared-pool cards receive their canonical pool availability from the
    // asset model. Negative availability is meaningful over-limit state and
    // must never be hidden by clamping it to zero.
    const availableCreditMinor = Number.isInteger(account.availableCreditMinor)
      ? account.availableCreditMinor
      : creditLimitMinor - outstandingMinor;
    if (requiredMinor > availableCreditMinor) {
      if (authorization?.fingerprint === confirmationFingerprint) continue;
      return {
        status: 'credit-over-limit', accountId: account.id, accountType: account.type,
        accountName: account.name, role: posting.role, requiredMinor, outstandingMinor,
        creditLimitMinor, availableCreditMinor,
        overLimitMinor: requiredMinor - availableCreditMinor,
        confirmationFingerprint,
      };
    }
  }
  return { status: 'allowed' };
}

export class AccountCapacityError extends Error {
  constructor(result) {
    super(result.status === 'insufficient-cash' ? '账户余额不足' : result.status === 'credit-limit-unknown' ? '未设置信用额度' : '将超过信用额度');
    this.name = 'AccountCapacityError';
    this.capacity = structuredClone(result);
  }
}

export function assertAccountCapacity(accounts, transaction, authorization = null) {
  const result = inspectAccountCapacity(accounts, transaction, authorization);
  if (result.status !== 'allowed') throw new AccountCapacityError(result);
  return result;
}

export function isAccountCapacityError(error) {
  return error?.name === 'AccountCapacityError' && Boolean(error.capacity?.status);
}
