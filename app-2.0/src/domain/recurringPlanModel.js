// Canonical recurring-plan value model. It describes future commitments only;
// no function in this module posts transactions or mutates account/ledger state.

import { calculateRecurringRelationshipProjection, normalizeRecurringRelationship } from './recurringRelationshipModel.js';

export const PLAN_KINDS = Object.freeze(['fixed_expense', 'subscription', 'recurring_relationship']);
export const PLAN_STATUSES = Object.freeze(['active', 'paused', 'stopped']);
export const RECURRENCES = Object.freeze(['monthly', 'yearly']);
export const SOURCE_TYPES = Object.freeze(['fixed_plan', 'obligation_plan']);
export const AMOUNT_MODES = Object.freeze(['fixed', 'variable']);
export const SUBSCRIPTION_FUNDING_MODES = Object.freeze(['self', 'other_pays', 'user_pays_for_other', 'shared']);
export const DEFAULT_PLAN_TIMEZONE = 'Asia/Kuala_Lumpur';

export class RecurringPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecurringPlanError';
    this.code = code;
    this.details = structuredClone(details);
  }
}

export function recurringError(code, message, details) {
  throw new RecurringPlanError(code, message, details);
}

export function isISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function canonicalSourceKey(source) {
  if (!SOURCE_TYPES.includes(source?.sourceType) || !String(source?.sourceId || '').trim()) {
    recurringError('invalid_canonical_source', '计划来源无效', { source });
  }
  return `${source.sourceType}:${source.sourceId}`;
}

export function fixedPlanSource(planId) {
  return { sourceType: 'fixed_plan', sourceId: String(planId) };
}

function positiveMinor(value, code, message) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) recurringError(code, message, { value });
  return amount;
}

function validateParticipantIds(participantIds) {
  if (!Array.isArray(participantIds) || participantIds.length < 2) recurringError('invalid_participants', '关系分摊至少需要两位参与者');
  if (participantIds.some((id) => !String(id || '').trim())) recurringError('unknown_participant', '关系参与者无效');
  if (new Set(participantIds).size !== participantIds.length) recurringError('duplicate_participant', '关系参与者不能重复');
  return [...participantIds];
}

export function equalSplitShares(totalAmountMinor, participantIds) {
  const total = positiveMinor(totalAmountMinor, 'invalid_amount', '计划金额必须大于零');
  const ids = validateParticipantIds(participantIds);
  const base = Math.floor(total / ids.length);
  return ids.map((participantId, index) => ({
    participantId,
    amountMinor: index === ids.length - 1 ? total - base * (ids.length - 1) : base,
  }));
}

export function validateSplitConfiguration(totalAmountMinor, relationship) {
  const total = positiveMinor(totalAmountMinor, 'invalid_amount', '计划金额必须大于零');
  if (!relationship) return null;
  const participantIds = validateParticipantIds(relationship.participantIds);
  const authenticatedParticipantId = String(relationship.authenticatedParticipantId || '');
  if (!participantIds.includes(authenticatedParticipantId)) recurringError('authenticated_user_missing', '关系分摊必须包含你自己');
  const payerParticipantId = String(relationship.payerParticipantId || '');
  if (!payerParticipantId) recurringError('payer_missing', '请选择付款人');
  if (!participantIds.includes(payerParticipantId)) recurringError('unknown_participant', '付款人必须属于所选关系');
  if (!String(relationship.ledgerId || '').trim()) recurringError('unknown_ledger', '关系账本无效');
  const splitMode = relationship.splitMode || 'equal';
  if (!['equal', 'custom'].includes(splitMode)) recurringError('invalid_split_mode', '分摊方式无效');
  const shares = splitMode === 'equal'
    ? equalSplitShares(total, participantIds)
    : structuredClone(relationship.shares || []);
  if (shares.length !== participantIds.length) recurringError('custom_split_not_exact', '自定义分摊必须包含所有参与者');
  const shareIds = shares.map((share) => share.participantId);
  if (new Set(shareIds).size !== shareIds.length) recurringError('duplicate_participant', '关系参与者不能重复');
  if (!shareIds.every((id) => participantIds.includes(id))) recurringError('unknown_participant', '分摊包含未知参与者');
  if (shares.some((share) => !Number.isInteger(share.amountMinor) || share.amountMinor < 0)) recurringError('invalid_own_share', '分摊金额不能为负数');
  if (shares.reduce((sum, share) => sum + share.amountMinor, 0) !== total) recurringError('custom_split_not_exact', '自定义分摊总额必须等于账单总额');
  return {
    ledgerId: relationship.ledgerId,
    participantIds,
    authenticatedParticipantId,
    payerParticipantId,
    splitMode,
    shares,
    paymentMode: relationship.paymentMode || 'full_bill',
    relationshipLabel: relationship.relationshipLabel || null,
  };
}

export function calculateResponsibility(totalAmountMinor, relationship = null) {
  const total = positiveMinor(totalAmountMinor, 'invalid_amount', '计划金额必须大于零');
  const normalized = validateSplitConfiguration(total, relationship);
  if (!normalized) return { totalAmountMinor: total, ownShareMinor: total, cashOutflowMinor: total, receivableMinor: 0, payableMinor: 0 };
  const ownShareMinor = normalized.shares.find((share) => share.participantId === normalized.authenticatedParticipantId)?.amountMinor;
  if (!Number.isInteger(ownShareMinor) || ownShareMinor < 0 || ownShareMinor > total) recurringError('invalid_own_share', '我的份额无效');
  if (normalized.payerParticipantId === normalized.authenticatedParticipantId) {
    const cashOutflowMinor = normalized.paymentMode === 'own_share' ? ownShareMinor : total;
    return { totalAmountMinor: total, ownShareMinor, cashOutflowMinor, receivableMinor: Math.max(0, cashOutflowMinor - ownShareMinor), payableMinor: 0 };
  }
  return { totalAmountMinor: total, ownShareMinor, cashOutflowMinor: 0, receivableMinor: 0, payableMinor: ownShareMinor };
}

export function validateSchedule(schedule) {
  if (!RECURRENCES.includes(schedule?.recurrence)) recurringError('unsupported_recurrence', '重复周期无效');
  const dueDay = Number(schedule.dueDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) recurringError('invalid_schedule', '到期日必须介于 1 至 31');
  if (schedule.recurrence === 'yearly') {
    const dueMonth = Number(schedule.dueMonth);
    if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12) recurringError('invalid_schedule', '年度到期月份无效');
  }
  return {
    recurrence: schedule.recurrence,
    dueDay,
    ...(schedule.recurrence === 'yearly' ? { dueMonth: Number(schedule.dueMonth) } : {}),
    timezone: schedule.timezone || DEFAULT_PLAN_TIMEZONE,
  };
}

export function normalizeRecurringPlan(input, { accountExists, participantExists, ledgerExists } = {}) {
  const id = String(input?.id || '').trim();
  if (!id) recurringError('invalid_plan_id', '计划 ID 无效');
  if (!PLAN_KINDS.includes(input.planKind)) recurringError('unsupported_plan_kind', '计划类型无效');
  if (!PLAN_STATUSES.includes(input.status || 'active')) recurringError('invalid_plan_status', '计划状态无效');
  const title = String(input.title || '').trim();
  if (!title) recurringError('invalid_title', '请输入计划名称');
  const currency = input.currency || 'MYR';
  if (currency !== 'MYR') recurringError('unsupported_currency', '当前仅支持 MYR');
  const amountMode = input.amountMode || 'fixed';
  if (!AMOUNT_MODES.includes(amountMode)) recurringError('unsupported_amount_mode', '金额模式无效', { amountMode });
  if (input.planKind === 'subscription' && amountMode !== 'fixed') recurringError('unsupported_subscription_amount_mode', '订阅目前只支持固定金额');
  let fixedAmountMinor = null;
  let estimateAmountMinor = null;
  if (amountMode === 'fixed') {
    const legacyAmount = input.fixedAmountMinor == null && input.amountMode == null;
    fixedAmountMinor = positiveMinor(
      input.fixedAmountMinor ?? input.totalAmountMinor ?? input.amountMinor,
      legacyAmount ? 'invalid_amount' : 'fixed_amount_missing',
      legacyAmount ? '计划金额必须大于零' : '请输入固定金额',
    );
  } else if (input.estimateAmountMinor != null && input.estimateAmountMinor !== '') {
    estimateAmountMinor = Number(input.estimateAmountMinor);
    if (!Number.isInteger(estimateAmountMinor) || estimateAmountMinor <= 0) recurringError('invalid_estimate', '预计金额必须大于零');
  } else if (input.totalAmountMinor > 0 && input.amountMode === 'variable') {
    // Compatibility for early FIX1 drafts that supplied the estimate through
    // totalAmountMinor while already declaring the explicit variable mode.
    estimateAmountMinor = positiveMinor(input.totalAmountMinor, 'invalid_estimate', '预计金额必须大于零');
  }
  const plannedAmountMinor = amountMode === 'fixed' ? fixedAmountMinor : estimateAmountMinor;
  const amountPending = amountMode === 'variable' && plannedAmountMinor == null;
  const totalAmountMinor = plannedAmountMinor || 0;
  if (!isISODate(input.startDate)) recurringError('invalid_start_date', '开始日期无效');
  if (input.endDate && (!isISODate(input.endDate) || input.endDate < input.startDate)) recurringError('invalid_end_date', '结束日期无效');
  if (input.moveInDate && !isISODate(input.moveInDate)) recurringError('invalid_move_in_date', '入住或订阅日期无效');
  const paymentSourceAccountId = input.paymentSourceAccountId || null;
  if (paymentSourceAccountId && accountExists && !accountExists(paymentSourceAccountId)) recurringError('unknown_account', '付款账户不存在', { accountId: paymentSourceAccountId });
  const normalizedRelationship = normalizeRecurringRelationship({
    relationshipMode: input.relationshipMode,
    relationship: input.relationship,
    planningAmountMinor: totalAmountMinor,
    amountPending,
  }, recurringError);
  const relationship = normalizedRelationship.relationship;
  const relationshipMode = normalizedRelationship.relationshipMode;
  if (input.planKind === 'recurring_relationship' && !relationship) recurringError('relationship_required', '请选择关系计划场景');
  if (relationship && participantExists && relationship.participantIds.some((idValue) => !participantExists(idValue))) recurringError('unknown_participant', '关系包含未知参与者');
  if (relationship && ledgerExists && !ledgerExists(relationship.ledgerId)) recurringError('unknown_ledger', '关系账本不存在');
  const responsibility = calculateRecurringRelationshipProjection(totalAmountMinor, relationshipMode, relationship, recurringError);
  const subscriptionFundingMode = input.planKind === 'subscription' ? input.subscriptionFundingMode || 'self' : null;
  if (subscriptionFundingMode && !SUBSCRIPTION_FUNDING_MODES.includes(subscriptionFundingMode)) recurringError('invalid_subscription_funding', '订阅扣款关系无效');
  if (input.planKind === 'subscription' && subscriptionFundingMode !== 'self' && !relationship) recurringError('subscription_relationship_required', '请选择订阅关系对象');
  const archivedAt = input.archivedAt || null;
  if (archivedAt && Number.isNaN(Date.parse(archivedAt))) recurringError('invalid_archive_date', '归档时间无效');
  const source = input.canonicalSource || fixedPlanSource(id);
  canonicalSourceKey(source);
  return {
    id,
    planKind: input.planKind,
    title,
    categoryId: input.categoryId || null,
    currency,
    amountMode,
    fixedAmountMinor,
    estimateAmountMinor,
    plannedAmountMinor,
    amountPending,
    totalAmountMinor,
    amountMinor: totalAmountMinor,
    ...responsibility,
    schedule: validateSchedule(input.schedule),
    startDate: input.startDate,
    endDate: input.endDate || null,
    moveInDate: input.moveInDate || null,
    status: input.status || 'active',
    stoppedAt: input.stoppedAt || null,
    paymentSourceAccountId,
    provider: input.provider ? structuredClone(input.provider) : null,
    logoRef: input.logoRef || null,
    relationshipMode,
    relationship,
    subscriptionFundingMode,
    canonicalSource: structuredClone(source),
    recordOnlyDefault: Boolean(input.recordOnlyDefault),
    note: input.note || null,
    archivedAt,
    archivedReason: input.archivedReason || null,
    archivedBy: input.archivedBy || null,
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null,
    revision: Number(input.revision || 1),
    history: structuredClone(input.history || []),
  };
}
