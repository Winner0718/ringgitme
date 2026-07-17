// In-memory recipient payment methods for recurring-payment handoff.
// `profileId` remains a compatibility alias for the canonical stable
// `paymentMethodId`, so Phase 2C3A fixtures and plan references stay valid.

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function requiredText(value, code) {
  const text = String(value ?? '').trim();
  if (!text) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return text;
}

function optionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function digits(value) {
  return String(value ?? '').replace(/\s+/g, '');
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export const RECIPIENT_PAYMENT_METHOD_TYPES = Object.freeze({
  BANK_ACCOUNT: 'bank_account',
  DUITNOW: 'duitnow',
});

export const MALAYSIA_PAYMENT_BANKS = Object.freeze([
  Object.freeze({ code: 'MBB', name: 'Maybank', launchCapabilityId: 'maybank-mae' }),
  Object.freeze({ code: 'CIMB', name: 'CIMB', launchCapabilityId: 'cimb-octo' }),
  Object.freeze({ code: 'PBB', name: 'Public Bank', launchCapabilityId: 'public-bank' }),
  Object.freeze({ code: 'RHB', name: 'RHB', launchCapabilityId: 'rhb-mobile' }),
  Object.freeze({ code: 'HLB', name: 'Hong Leong Bank', launchCapabilityId: null }),
  Object.freeze({ code: 'AMB', name: 'AmBank', launchCapabilityId: null }),
  Object.freeze({ code: 'BIMB', name: 'Bank Islam', launchCapabilityId: null }),
  Object.freeze({ code: 'BSN', name: 'BSN', launchCapabilityId: null }),
  Object.freeze({ code: 'UOB', name: 'UOB', launchCapabilityId: null }),
  Object.freeze({ code: 'OCBC', name: 'OCBC', launchCapabilityId: null }),
  Object.freeze({ code: 'HSBC', name: 'HSBC', launchCapabilityId: null }),
  Object.freeze({ code: 'SCB', name: 'Standard Chartered', launchCapabilityId: null }),
  Object.freeze({ code: 'OTHER', name: '其他银行 / 自定义', launchCapabilityId: null }),
]);

export function normalizeRecipientPaymentProfile(input = {}) {
  const profileId = requiredText(input.paymentMethodId ?? input.profileId, 'RECIPIENT_PROFILE_ID_REQUIRED');
  const accountNumber = digits(input.accountNumber);
  const duitNowType = optionalText(input.duitNowType);
  const duitNowValue = optionalText(input.duitNowValue);
  const inferredType = accountNumber
    ? RECIPIENT_PAYMENT_METHOD_TYPES.BANK_ACCOUNT
    : RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW;
  const paymentMethodType = input.paymentMethodType || inferredType;
  if (!Object.values(RECIPIENT_PAYMENT_METHOD_TYPES).includes(paymentMethodType)) fail('RECIPIENT_PAYMENT_METHOD_TYPE_INVALID');
  if (paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.BANK_ACCOUNT && !accountNumber) fail('RECIPIENT_PAYMENT_DESTINATION_REQUIRED');
  if (paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW && !(duitNowType && duitNowValue)) fail('RECIPIENT_PAYMENT_DESTINATION_REQUIRED');
  const bankCode = optionalText(input.bankCode)?.toUpperCase() || null;
  const customBankName = optionalText(input.customBankName);
  const bankDisplayName = optionalText(input.bankDisplayName) || customBankName;
  if (paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.BANK_ACCOUNT && !(bankCode && bankDisplayName)) fail('BANK_DISPLAY_NAME_REQUIRED');
  const accountHolderName = requiredText(input.accountHolderName, 'ACCOUNT_HOLDER_NAME_REQUIRED');
  const isDefault = Boolean(input.isDefaultForParticipant ?? input.isDefault);
  return Object.freeze({
    profileId,
    paymentMethodId: profileId,
    paymentMethodType,
    recipientId: optionalText(input.recipientId ?? input.ownerParticipantId ?? input.relationshipParticipantId),
    // Compatibility alias. A recipient may also be an external payee, so new
    // code must use recipientId instead of assuming every owner is a member.
    ownerParticipantId: optionalText(input.recipientId ?? input.ownerParticipantId ?? input.relationshipParticipantId),
    displayName: requiredText(input.displayName, 'RECIPIENT_DISPLAY_NAME_REQUIRED'),
    accountHolderName,
    bankCode,
    bankDisplayName: bankDisplayName || optionalText(input.optionalBankName),
    customBankName,
    accountNumber: accountNumber || null,
    duitNowType,
    duitNowValue,
    nickname: optionalText(input.nickname ?? input.label),
    defaultReferenceTemplate: optionalText(input.defaultReferenceTemplate),
    launchCapabilityId: optionalText(input.bankAppTarget ?? input.launchCapabilityId),
    bankAppTarget: optionalText(input.bankAppTarget ?? input.launchCapabilityId),
    isDefaultForParticipant: isDefault,
    isDefault,
    revision: Math.max(1, Number(input.revision || 1)),
    createdAt: requiredText(input.createdAt, 'RECIPIENT_CREATED_AT_REQUIRED'),
    updatedAt: requiredText(input.updatedAt, 'RECIPIENT_UPDATED_AT_REQUIRED'),
  });
}

export function createRecipientPaymentProfileRepository({ profiles = [], clock = () => new Date().toISOString() } = {}) {
  const initial = profiles.map(normalizeRecipientPaymentProfile);
  if (new Set(initial.map((profile) => profile.profileId)).size !== initial.length) fail('DUPLICATE_RECIPIENT_PROFILE_ID');
  const seed = clone(initial);
  let state = clone(seed);
  let sequence = 0;

  function nextId() {
    do { sequence += 1; } while (state.some((row) => row.profileId === `recipient-method-${String(sequence).padStart(4, '0')}`));
    return `recipient-method-${String(sequence).padStart(4, '0')}`;
  }

  function normalizeDefaults(recipientId) {
    if (!recipientId) return;
    const owned = state.filter((row) => row.recipientId === recipientId);
    if (!owned.length) return;
    let defaultId = owned.find((row) => row.isDefaultForParticipant)?.profileId || owned[0].profileId;
    state = state.map((row) => row.recipientId === recipientId
      ? { ...row, isDefaultForParticipant: row.profileId === defaultId, isDefault: row.profileId === defaultId }
      : row);
  }

  function ensureSingleDefault(candidate) {
    if (!candidate.recipientId) return;
    if (candidate.isDefaultForParticipant) {
      state = state.map((row) => row.recipientId === candidate.recipientId
        ? { ...row, isDefaultForParticipant: row.profileId === candidate.profileId, isDefault: row.profileId === candidate.profileId }
        : row);
    } else normalizeDefaults(candidate.recipientId);
  }

  function create(input) {
    const id = optionalText(input.paymentMethodId ?? input.profileId) || nextId();
    if (state.some((profile) => profile.profileId === id)) fail('DUPLICATE_RECIPIENT_PROFILE_ID');
    const now = input.createdAt || clock();
    const recipientId = input.recipientId ?? input.ownerParticipantId ?? null;
    const ownerRows = state.filter((row) => row.recipientId && row.recipientId === recipientId);
    const profile = normalizeRecipientPaymentProfile({
      ...input,
      profileId: id,
      recipientId,
      isDefaultForParticipant: input.isDefaultForParticipant ?? input.isDefault ?? ownerRows.length === 0,
      revision: 1,
      createdAt: now,
      updatedAt: input.updatedAt || now,
    });
    state.push(clone(profile));
    ensureSingleDefault(profile);
    return clone(state.find((row) => row.profileId === id));
  }

  function update(profileId, changes = {}) {
    const index = state.findIndex((profile) => profile.profileId === profileId);
    if (index < 0) fail('RECIPIENT_PROFILE_NOT_FOUND');
    const previous = state[index];
    const profile = normalizeRecipientPaymentProfile({
      ...previous,
      ...clone(changes),
      profileId: previous.profileId,
      paymentMethodId: previous.profileId,
      createdAt: previous.createdAt,
      updatedAt: changes.updatedAt || clock(),
      revision: previous.revision + 1,
    });
    state[index] = clone(profile);
    ensureSingleDefault(profile);
    return clone(state.find((row) => row.profileId === profileId));
  }

  function remove(profileId) {
    const index = state.findIndex((row) => row.profileId === profileId);
    if (index < 0) fail('RECIPIENT_PROFILE_NOT_FOUND');
    const removed = state[index];
    state.splice(index, 1);
    normalizeDefaults(removed.recipientId);
    return clone(removed);
  }

  function setDefault(profileId) {
    const profile = state.find((row) => row.profileId === profileId);
    if (!profile) fail('RECIPIENT_PROFILE_NOT_FOUND');
    if (!profile.recipientId) fail('RECIPIENT_PROFILE_OWNER_REQUIRED');
    return update(profileId, { isDefaultForParticipant: true });
  }

  function list({ recipientId = null, ownerParticipantId = null } = {}) {
    const ownerId = recipientId || ownerParticipantId;
    const rows = ownerId ? state.filter((row) => row.recipientId === ownerId) : state;
    return clone([...rows].sort((a, b) => Number(b.isDefaultForParticipant) - Number(a.isDefaultForParticipant)
      || a.createdAt.localeCompare(b.createdAt) || a.profileId.localeCompare(b.profileId)));
  }

  return Object.freeze({
    get: (profileId) => clone(state.find((profile) => profile.profileId === profileId) || null),
    list,
    findDefault: (recipientId) => clone(list({ recipientId }).find((profile) => profile.isDefaultForParticipant) || null),
    create,
    update,
    remove,
    setDefault,
    reset() { state = clone(seed); sequence = 0; },
    getSnapshot: () => clone(state),
  });
}

export function selectRecipientPaymentProfile({ plan, action, repository, profileId = null } = {}) {
  if (!repository) return null;
  const explicitId = profileId || plan?.recipientPaymentProfileId || null;
  const explicit = explicitId ? repository.get(explicitId) : null;
  if (explicit) return explicit;
  const recipientId = plan?.recipientId || action?.recipientId || action?.counterpartyId || action?.memberId || null;
  return recipientId ? repository.findDefault(recipientId) : null;
}

export function paymentMethodDestination(profile, { hidden = false } = {}) {
  if (!profile) return '—';
  return profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW
    ? maskDuitNowValue(profile.duitNowValue, { hidden })
    : maskPaymentAccount(profile.accountNumber, { hidden });
}

export function paymentMethodSnapshot(profile, { recipientId = null, reference = null } = {}) {
  if (!profile) return null;
  const raw = profile.paymentMethodType === RECIPIENT_PAYMENT_METHOD_TYPES.DUITNOW ? profile.duitNowValue : profile.accountNumber;
  const compact = digits(raw);
  return Object.freeze({
    recipientId: recipientId || profile.recipientId || profile.ownerParticipantId || null,
    recipientDisplayName: profile.displayName,
    paymentMethodId: profile.paymentMethodId || profile.profileId,
    paymentMethodType: profile.paymentMethodType,
    bankName: profile.bankDisplayName || null,
    accountHolder: profile.accountHolderName,
    maskedDestination: compact ? `•••• ${compact.slice(-4)}` : '—',
    lastFour: compact.slice(-4) || null,
    paymentReference: optionalText(reference),
  });
}

export function maskPaymentAccount(value, { hidden = false } = {}) {
  const text = digits(value);
  if (!text) return '—';
  if (!hidden) return text;
  return `•••• ${text.slice(-4)}`;
}

export function maskDuitNowValue(value, { hidden = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  if (!hidden) return text;
  const compact = text.replace(/\s+/g, '');
  return compact.length <= 4 ? '••••' : `•••• ${compact.slice(-4)}`;
}

export const recipientPaymentProfileTestHooks = Object.freeze({ digits });
