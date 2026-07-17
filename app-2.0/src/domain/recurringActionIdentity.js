// Canonical serialization and idempotency identity for Phase 2C3A previews.
// No random values or wall-clock reads are used here.

const DRAFT_KEYS = Object.freeze([
  'version', 'actionType', 'actorId', 'planId', 'occurrenceId',
  'occurrenceRevision', 'planRevision', 'amountMinor', 'sourceAccountId',
  'sourceAccountKind', 'counterpartyId', 'groupId', 'memberId', 'note',
  'occurredAt', 'clientEventId', 'idempotencyKey',
]);

function normalizedText(value, fallback = null) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function integerOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value === undefined ? null : value;
}

export function stableRecurringActionJSON(value) {
  return JSON.stringify(stableValue(value));
}

export function canonicalizeRecurringActionDraft(input = {}) {
  const draft = {
    version: Number.isInteger(Number(input.version)) ? Number(input.version) : 1,
    actionType: normalizedText(input.actionType),
    actorId: normalizedText(input.actorId),
    planId: normalizedText(input.planId),
    occurrenceId: normalizedText(input.occurrenceId),
    occurrenceRevision: integerOrNull(input.occurrenceRevision),
    planRevision: integerOrNull(input.planRevision),
    amountMinor: integerOrNull(input.amountMinor),
    sourceAccountId: normalizedText(input.sourceAccountId),
    sourceAccountKind: normalizedText(input.sourceAccountKind),
    counterpartyId: normalizedText(input.counterpartyId),
    groupId: normalizedText(input.groupId),
    memberId: normalizedText(input.memberId),
    note: normalizedText(input.note),
    occurredAt: normalizedText(input.occurredAt),
    clientEventId: normalizedText(input.clientEventId),
    idempotencyKey: normalizedText(input.idempotencyKey),
  };
  return Object.freeze(Object.fromEntries(DRAFT_KEYS.map((key) => [key, draft[key] ?? null])));
}

export function createRecurringActionIdempotencyKey(input = {}) {
  const actionType = normalizedText(input.actionType, 'unknown');
  const actorId = normalizedText(input.actorId, 'unknown');
  const occurrenceId = normalizedText(input.occurrenceId, 'unknown');
  const clientEventId = normalizedText(input.clientEventId, 'unknown');
  return `recurring-action:v1:${actorId}:${occurrenceId}:${actionType}:${clientEventId}`;
}

export function createRecurringActionDraft({ action, plan, occurrence, actorId = 'participant-me', amountMinor = null,
  sourceAccountId = null, sourceAccountKind = null, counterpartyId = null, groupId = null,
  memberId = null, note = null, occurredAt, clientEventId } = {}) {
  const base = canonicalizeRecurringActionDraft({
    version: 1,
    actionType: action?.actionType,
    actorId,
    planId: plan?.id,
    occurrenceId: occurrence?.id,
    occurrenceRevision: occurrence?.revision,
    planRevision: plan?.revision,
    amountMinor,
    sourceAccountId,
    sourceAccountKind,
    counterpartyId: counterpartyId ?? action?.counterpartyId,
    groupId: groupId ?? plan?.relationship?.ledgerId,
    memberId: memberId ?? action?.memberId,
    note,
    occurredAt,
    clientEventId,
  });
  return canonicalizeRecurringActionDraft({
    ...base,
    idempotencyKey: createRecurringActionIdempotencyKey(base),
  });
}

function hash64(text) {
  let hash = 0xcbf29ce484222325n;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function fingerprintRecurringActionDraft(input) {
  const draft = canonicalizeRecurringActionDraft(input);
  const identity = { ...draft };
  // Human notes and the idempotency key do not change financial identity.
  delete identity.note;
  delete identity.idempotencyKey;
  return `rafp1-${hash64(stableRecurringActionJSON(identity))}`;
}

export function compareIdempotentAttempt(previous, current) {
  const earlier = canonicalizeRecurringActionDraft(previous);
  const next = canonicalizeRecurringActionDraft(current);
  if (!next.idempotencyKey) return Object.freeze({ status: 'invalid', safeReplay: false, conflict: false, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  if (earlier.idempotencyKey !== next.idempotencyKey) return Object.freeze({ status: 'new_attempt', safeReplay: false, conflict: false, code: null });
  const previousFingerprint = fingerprintRecurringActionDraft(earlier);
  const currentFingerprint = fingerprintRecurringActionDraft(next);
  if (previousFingerprint === currentFingerprint) return Object.freeze({ status: 'safe_replay', safeReplay: true, conflict: false, code: null, fingerprint: currentFingerprint });
  return Object.freeze({ status: 'conflict', safeReplay: false, conflict: true, code: 'IDEMPOTENCY_CONFLICT', previousFingerprint, currentFingerprint });
}

export const recurringActionIdentityTestHooks = Object.freeze({ DRAFT_KEYS, stableValue, hash64 });
