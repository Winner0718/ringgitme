// Pure recurring-relationship configuration and planning projections.
// This module never posts a transaction or mutates relationship balances.

export const RELATIONSHIP_MODES = Object.freeze([
  'shared_bill',
  'central_collection',
  'direct_recurring_payment',
  'installment_repayment',
]);

function defaultFail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = structuredClone(details);
  throw error;
}

function participantIdsFor(value, fail) {
  const ids = Array.isArray(value) ? value.map(String) : [];
  if (ids.length < 2 || ids.some((id) => !id.trim())) fail('invalid_participants', '关系计划至少需要两位参与者');
  if (new Set(ids).size !== ids.length) fail('duplicate_participant', '关系参与者不能重复');
  return ids;
}

function participantRole(id, ids, code, message, fail) {
  const value = String(id || '');
  if (!value) fail(code, message);
  if (!ids.includes(value)) fail('unknown_participant', '所选角色必须属于当前关系账本', { participantId: value });
  return value;
}

function exactShares(totalMinor, ids, splitMode, inputShares, fail) {
  if (!['equal', 'custom'].includes(splitMode)) fail('invalid_split_mode', '分摊方式无效');
  if (splitMode === 'equal') {
    const base = ids.length ? Math.floor(totalMinor / ids.length) : 0;
    return ids.map((participantId, index) => ({
      participantId,
      amountMinor: index === ids.length - 1 ? totalMinor - base * (ids.length - 1) : base,
    }));
  }
  const shares = structuredClone(inputShares || []);
  if (shares.length !== ids.length) fail('custom_split_not_exact', '自定义分摊必须包含所有参与者');
  const shareIds = shares.map((share) => String(share.participantId || ''));
  if (new Set(shareIds).size !== shareIds.length) fail('duplicate_participant', '关系参与者不能重复');
  if (!shareIds.every((id) => ids.includes(id))) fail('unknown_participant', '分摊包含未知参与者');
  if (shares.some((share) => !Number.isInteger(share.amountMinor) || share.amountMinor < 0)) fail('invalid_own_share', '分摊金额不能为负数');
  if (shares.reduce((sum, share) => sum + share.amountMinor, 0) !== totalMinor) fail('custom_split_not_exact', '自定义分摊总额必须等于计划金额');
  return shares;
}

export function normalizeRecurringRelationship({
  relationshipMode,
  relationship,
  planningAmountMinor,
  amountPending = false,
}, fail = defaultFail) {
  if (!relationship && !relationshipMode) return { relationshipMode: null, relationship: null };
  const mode = relationshipMode || relationship?.relationshipMode || 'shared_bill';
  if (!RELATIONSHIP_MODES.includes(mode)) fail('unsupported_relationship_mode', '关系计划类型无效', { relationshipMode: mode });
  const ledgerId = String(relationship?.ledgerId || '').trim();
  if (!ledgerId) fail('unknown_ledger', '请选择对象或群组');
  const participantIds = participantIdsFor(relationship?.participantIds, fail);
  const authenticatedParticipantId = participantRole(
    relationship?.authenticatedParticipantId,
    participantIds,
    'authenticated_user_missing',
    '关系计划必须包含你自己',
    fail,
  );
  const totalMinor = Number(planningAmountMinor || 0);
  if (!Number.isInteger(totalMinor) || totalMinor < 0) fail('invalid_amount', '计划金额无效');
  const base = {
    relationshipMode: mode,
    ledgerId,
    participantIds,
    authenticatedParticipantId,
    relationshipLabel: relationship?.relationshipLabel || null,
  };

  if (mode === 'shared_bill') {
    const payerParticipantId = participantRole(relationship?.payerParticipantId, participantIds, 'payer_missing', '请选择谁先付款', fail);
    const splitMode = relationship?.splitMode || 'equal';
    const shares = exactShares(totalMinor, participantIds, splitMode, relationship?.shares, fail);
    return { relationshipMode: mode, relationship: { ...base, payerParticipantId, splitMode, shares, paymentMode: relationship?.paymentMode || 'full_bill' } };
  }

  if (mode === 'central_collection') {
    const collectorParticipantId = participantRole(relationship?.collectorParticipantId, participantIds, 'collector_missing', '请选择钱先交给谁', fail);
    const externalPayerParticipantId = participantRole(relationship?.externalPayerParticipantId, participantIds, 'external_payer_missing', '请选择谁向外付款', fail);
    const splitMode = relationship?.splitMode || 'equal';
    const shares = exactShares(totalMinor, participantIds, splitMode, relationship?.shares, fail);
    return { relationshipMode: mode, relationship: { ...base, collectorParticipantId, externalPayerParticipantId, splitMode, shares } };
  }

  if (mode === 'direct_recurring_payment') {
    const recipientParticipantId = participantRole(relationship?.recipientParticipantId, participantIds, 'recipient_missing', '请选择每月付给谁', fail);
    // The recipient may be the signed-in user: that is the canonical inverse
    // direction for “对方定期付给我”, not a self-payment.
    if (participantIds.length < 2) fail('invalid_recipient', '定期往来必须包含另一位参与者');
    return { relationshipMode: mode, relationship: { ...base, recipientParticipantId } };
  }

  const creditorParticipantId = participantRole(relationship?.creditorParticipantId, participantIds, 'creditor_missing', '请选择债权人', fail);
  const debtorParticipantId = participantRole(relationship?.debtorParticipantId, participantIds, 'debtor_missing', '请选择还款人', fail);
  if (creditorParticipantId === debtorParticipantId) fail('invalid_debt_roles', '债权人与还款人不能相同');
  if (![creditorParticipantId, debtorParticipantId].includes(authenticatedParticipantId)) fail('authenticated_user_missing', '分期还款必须包含你自己');
  const originalPrincipalMinor = Number(relationship?.originalPrincipalMinor);
  const remainingPrincipalMinor = Number(relationship?.remainingPrincipalMinor);
  const installmentAmountMinor = Number(relationship?.installmentAmountMinor ?? planningAmountMinor);
  if (!Number.isInteger(originalPrincipalMinor) || originalPrincipalMinor <= 0) fail('invalid_principal', '原始欠款必须大于零');
  if (!Number.isInteger(remainingPrincipalMinor) || remainingPrincipalMinor < 0 || remainingPrincipalMinor > originalPrincipalMinor) fail('invalid_remaining_principal', '剩余欠款不能大于原始欠款');
  if (!Number.isInteger(installmentAmountMinor) || installmentAmountMinor <= 0) fail('invalid_installment_amount', '每期还款必须大于零');
  if (remainingPrincipalMinor && installmentAmountMinor > remainingPrincipalMinor) fail('installment_exceeds_remaining', '每期还款不能大于剩余欠款');
  return {
    relationshipMode: mode,
    relationship: {
      ...base,
      creditorParticipantId,
      debtorParticipantId,
      originalPrincipalMinor,
      remainingPrincipalMinor,
      installmentAmountMinor,
      completedInstallments: Number.isInteger(relationship?.completedInstallments) ? relationship.completedInstallments : null,
      plannedInstallmentCount: Number.isInteger(relationship?.plannedInstallmentCount) ? relationship.plannedInstallmentCount : null,
      repaymentMethod: relationship?.repaymentMethod || 'fixed_monthly',
      repaymentMonths: Number.isInteger(relationship?.repaymentMonths) ? relationship.repaymentMonths : null,
      finalInstallmentMinor: Number.isInteger(relationship?.finalInstallmentMinor) ? relationship.finalInstallmentMinor : null,
    },
  };
}

function shareFor(relationship, participantId) {
  return Number(relationship.shares?.find((share) => share.participantId === participantId)?.amountMinor || 0);
}

export function calculateRecurringRelationshipProjection(totalAmountMinor, relationshipMode, relationship, fail = defaultFail) {
  const totalMinor = Number(totalAmountMinor || 0);
  if (!Number.isInteger(totalMinor) || totalMinor < 0) fail('invalid_amount', '计划金额无效');
  if (!relationshipMode || !relationship) {
    return {
      totalAmountMinor: totalMinor,
      ownShareMinor: totalMinor,
      directExternalOutflowMinor: totalMinor,
      transferToMemberOutflowMinor: 0,
      cashOutflowMinor: totalMinor,
      receivableMinor: 0,
      payableMinor: 0,
    };
  }
  const me = relationship.authenticatedParticipantId;

  if (relationshipMode === 'shared_bill') {
    const ownShareMinor = shareFor(relationship, me);
    const pays = relationship.payerParticipantId === me;
    const cashOutflowMinor = pays ? (relationship.paymentMode === 'own_share' ? ownShareMinor : totalMinor) : 0;
    return {
      totalAmountMinor: totalMinor,
      ownShareMinor,
      directExternalOutflowMinor: cashOutflowMinor,
      transferToMemberOutflowMinor: 0,
      cashOutflowMinor,
      receivableMinor: pays ? Math.max(0, cashOutflowMinor - ownShareMinor) : 0,
      payableMinor: pays ? 0 : ownShareMinor,
      payerParticipantId: relationship.payerParticipantId,
    };
  }

  if (relationshipMode === 'central_collection') {
    const ownShareMinor = shareFor(relationship, me);
    const isCollector = relationship.collectorParticipantId === me;
    const isExternalPayer = relationship.externalPayerParticipantId === me;
    const directExternalOutflowMinor = isExternalPayer ? totalMinor : 0;
    const transferToMemberOutflowMinor = isExternalPayer ? 0 : isCollector ? totalMinor : ownShareMinor;
    return {
      totalAmountMinor: totalMinor,
      ownShareMinor,
      directExternalOutflowMinor,
      transferToMemberOutflowMinor,
      cashOutflowMinor: directExternalOutflowMinor + transferToMemberOutflowMinor,
      receivableMinor: isCollector || isExternalPayer ? Math.max(0, totalMinor - ownShareMinor) : 0,
      payableMinor: isCollector || isExternalPayer ? 0 : ownShareMinor,
      collectorParticipantId: relationship.collectorParticipantId,
      externalPayerParticipantId: relationship.externalPayerParticipantId,
    };
  }

  if (relationshipMode === 'direct_recurring_payment') {
    const outgoing = relationship.recipientParticipantId !== me;
    return {
      totalAmountMinor: totalMinor,
      ownShareMinor: totalMinor,
      directExternalOutflowMinor: 0,
      transferToMemberOutflowMinor: outgoing ? totalMinor : 0,
      cashOutflowMinor: outgoing ? totalMinor : 0,
      receivableMinor: outgoing ? 0 : totalMinor,
      payableMinor: outgoing ? totalMinor : 0,
      recipientParticipantId: relationship.recipientParticipantId,
    };
  }

  const outgoing = relationship.debtorParticipantId === me;
  const installmentMinor = Math.min(relationship.installmentAmountMinor, relationship.remainingPrincipalMinor);
  const repaidPrincipalMinor = relationship.originalPrincipalMinor - relationship.remainingPrincipalMinor;
  const completedInstallments = relationship.completedInstallments ?? Math.floor(repaidPrincipalMinor / relationship.installmentAmountMinor);
  const plannedInstallmentCount = relationship.plannedInstallmentCount ?? Math.ceil(relationship.originalPrincipalMinor / relationship.installmentAmountMinor);
  return {
    totalAmountMinor: installmentMinor,
    ownShareMinor: installmentMinor,
    directExternalOutflowMinor: 0,
    transferToMemberOutflowMinor: outgoing ? installmentMinor : 0,
    cashOutflowMinor: outgoing ? installmentMinor : 0,
    receivableMinor: outgoing ? 0 : installmentMinor,
    payableMinor: outgoing ? installmentMinor : 0,
    creditorParticipantId: relationship.creditorParticipantId,
    debtorParticipantId: relationship.debtorParticipantId,
    originalPrincipalMinor: relationship.originalPrincipalMinor,
    remainingPrincipalMinor: relationship.remainingPrincipalMinor,
    repaidPrincipalMinor,
    installmentAmountMinor: relationship.installmentAmountMinor,
    completedInstallments,
    plannedInstallmentCount,
    remainingInstallments: relationship.remainingPrincipalMinor
      ? Math.ceil(relationship.remainingPrincipalMinor / relationship.installmentAmountMinor)
      : 0,
    finalInstallmentMinor: relationship.finalInstallmentMinor ?? (relationship.remainingPrincipalMinor % relationship.installmentAmountMinor || relationship.installmentAmountMinor),
  };
}

export function calculateSubscriptionFundingProjection(totalAmountMinor, fundingMode = 'self', relationship = null, fail = defaultFail) {
  if (fundingMode === 'self') return calculateRecurringRelationshipProjection(totalAmountMinor, null, null, fail);
  if (!['other_pays', 'user_pays_for_other', 'shared'].includes(fundingMode)) fail('invalid_subscription_funding', '订阅扣款关系无效');
  if (!relationship) fail('subscription_relationship_required', '请选择订阅关系对象');
  return calculateRecurringRelationshipProjection(totalAmountMinor, relationship.relationshipMode || 'shared_bill', relationship, fail);
}
