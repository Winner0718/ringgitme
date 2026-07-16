function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function immutableConfirmationSnapshot(snapshot) {
  return deepFreeze(structuredClone(snapshot));
}

export function accountConfirmationSnapshot(account) {
  if (!account) return null;
  return {
    id: account.id,
    type: account.type,
    name: account.name,
    short: account.short,
    bank: account.bank,
    last4: account.last4,
    brandColor: account.brandColor,
    art: account.art || null,
    balance: account.balance,
    outstanding: account.outstanding,
  };
}
