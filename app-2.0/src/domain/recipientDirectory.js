// Canonical in-memory recipient identities. Relationship participants keep
// their participant ID; plan-only payees receive a deterministic external ID.

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function deterministicExternalRecipientId({ profileId = '', planId = '', displayName = '' } = {}) {
  const source = String(profileId || planId || displayName || 'payee').trim().toLowerCase();
  const slug = source.replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'payee';
  return `recipient-external-${slug}`;
}

export function recipientIdentityForPlan(plan, { getProfile, getParticipant } = {}) {
  if (!plan) return null;
  const profile = plan.recipientPaymentProfileId ? getProfile?.(plan.recipientPaymentProfileId) : null;
  const explicitId = plan.recipientId || profile?.recipientId || profile?.ownerParticipantId || null;
  const relationshipId = plan.relationship?.creditorParticipantId
    || plan.relationship?.recipientParticipantId
    || null;
  const recipientId = explicitId || relationshipId || (profile ? deterministicExternalRecipientId({ profileId: profile.profileId, planId: plan.id, displayName: profile.displayName }) : null);
  if (!recipientId) return null;
  const participant = getParticipant?.(recipientId);
  return Object.freeze({
    recipientId,
    displayName: plan.recipientDisplayName || profile?.displayName || participant?.displayName || '收款对象',
    kind: participant ? 'relationship_person' : 'external_payee',
    participantId: participant?.participantId || null,
    sourcePlanIds: Object.freeze([plan.id]),
  });
}

export function buildRecipientDirectory({ participants = [], plans = [], profiles = [] } = {}) {
  const byId = new Map();
  const profileById = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const participantById = new Map(participants.map((participant) => [participant.participantId, participant]));
  participants.filter((participant) => participant.participantId !== 'participant-me').forEach((participant) => {
    byId.set(participant.participantId, {
      recipientId: participant.participantId,
      displayName: participant.displayName,
      kind: 'relationship_person',
      participantId: participant.participantId,
      sourcePlanIds: [],
    });
  });
  plans.forEach((plan) => {
    const identity = recipientIdentityForPlan(plan, {
      getProfile: (id) => profileById.get(id),
      getParticipant: (id) => participantById.get(id),
    });
    if (!identity) return;
    const current = byId.get(identity.recipientId) || clone(identity);
    current.sourcePlanIds = [...new Set([...(current.sourcePlanIds || []), plan.id])];
    byId.set(identity.recipientId, current);
  });
  profiles.forEach((profile) => {
    const recipientId = profile.recipientId || profile.ownerParticipantId || deterministicExternalRecipientId({ profileId: profile.profileId, displayName: profile.displayName });
    if (!byId.has(recipientId)) byId.set(recipientId, {
      recipientId,
      displayName: profile.displayName,
      kind: participantById.has(recipientId) ? 'relationship_person' : 'external_payee',
      participantId: participantById.has(recipientId) ? recipientId : null,
      sourcePlanIds: [],
    });
  });
  return [...byId.values()].map((identity) => {
    const methods = profiles.filter((profile) => (profile.recipientId || profile.ownerParticipantId) === identity.recipientId);
    return Object.freeze({ ...clone(identity), paymentMethodCount: methods.length, defaultPaymentMethodId: methods.find((method) => method.isDefaultForParticipant)?.profileId || methods[0]?.profileId || null });
  }).sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans'));
}
