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
  const fields = [
    'id', 'type', 'accountKind', 'name', 'displayName', 'short', 'bank', 'institution',
    'institutionLocalizedName', 'brandId', 'catalogInstitutionId', 'customBrandName',
    'last4', 'debitCardLast4', 'creditCardLast4', 'bankAccountNumber', 'walletIdentifier',
    'network', 'networkId', 'tier', 'customTierLabel', 'brandColor', 'art', 'cardPalette',
    'accountVisualOverride', 'customLogo', 'customCardImage', 'logoPresentationMode',
    'resolvedLogoPresentation', 'balance', 'balanceMinor', 'outstanding',
    'currentOutstandingMinor', 'totalCardDebt', 'totalCardDebtMinor',
  ];
  return Object.fromEntries(fields.filter((field) => account[field] !== undefined).map((field) => [field, structuredClone(account[field])]));
}
