import { daysBetween, fmtDateMY } from '../app/format.js';

const COMPLETION_LABELS = Object.freeze({
  paid: '已付',
  charged: '已扣款',
  received: '已收款',
  repaid: '已还款',
  completed: '已完成',
});

const WAITING_STATES = Object.freeze({
  awaiting_variable_amount: '等待填写本期金额',
  awaiting_charge_confirmation: '等待确认扣款',
  awaiting_payment_confirmation: '等待确认付款',
  awaiting_receipt_confirmation: '等待确认收款',
  awaiting_confirmation: '等待确认',
});

function result(semanticState, label, tone, priority, actionHint, attention, dueDate, extra = {}) {
  return Object.freeze({
    semanticState,
    label,
    tone,
    priority,
    actionHint,
    attention,
    dateLabel: dueDate ? fmtDateMY(dueDate) : '',
    ...extra,
  });
}

function recordedState(occurrence) {
  return occurrence?.recordedStatus || occurrence?.status || null;
}

export function deriveRecurringOccurrencePresentation(occurrence, plan, referenceDate, { dueSoonDays = 7 } = {}) {
  if (!occurrence || !plan || !referenceDate) throw new Error('recurring_presentation_requires_context');
  const dueDate = occurrence.dueDate;
  const recorded = recordedState(occurrence);

  if (recorded in COMPLETION_LABELS) {
    return result(recorded, COMPLETION_LABELS[recorded], 'green', 0, 'view', false, dueDate, { immutable: true });
  }
  if (recorded === 'failure' || recorded === 'failed') {
    return result('failure', '处理失败', 'red', 100, 'resolve_failure', true, dueDate);
  }
  if (recorded === 'skipped' || recorded === 'cancelled') {
    return result(recorded, recorded === 'skipped' ? '已跳过' : '已取消', 'neutral', 5, 'view', false, dueDate, { immutable: true });
  }

  const suppressed = plan.archivedAt ? 'archived' : plan.status === 'paused' ? 'paused' : plan.status === 'stopped' ? 'stopped' : null;
  if (suppressed) {
    const labels = { archived: '已归档', paused: '已暂停', stopped: '已停止' };
    return result(suppressed, labels[suppressed], 'neutral', 10, 'view', false, dueDate);
  }

  const days = daysBetween(referenceDate, dueDate);
  if (days < 0) return result('overdue', `已逾期 ${Math.abs(days)} 天`, 'red', 90, 'review_overdue', true, dueDate);
  if (days === 0) return result('due_today', '今天到期', 'red', 85, 'review_today', true, dueDate);

  // An estimate is planning context, not a confirmed bill. Until an actual
  // period amount exists, variable plans remain an explicit attention state.
  const waiting = occurrence.amountPending || occurrence.amountState === 'pending'
    || (occurrence.amountState === 'estimated' && occurrence.actualAmountMinor == null)
    ? 'awaiting_variable_amount'
    : recorded in WAITING_STATES ? recorded
      : occurrence.awaitingConfirmation === 'charge' ? 'awaiting_charge_confirmation'
        : occurrence.awaitingConfirmation === 'payment' ? 'awaiting_payment_confirmation'
          : occurrence.awaitingConfirmation === 'receipt' ? 'awaiting_receipt_confirmation'
            : occurrence.awaitingConfirmation ? 'awaiting_confirmation' : null;
  if (waiting) return result(waiting, WAITING_STATES[waiting], 'amber', 70, waiting === 'awaiting_variable_amount' ? 'enter_amount' : 'confirm', true, dueDate);

  if (days === 1) return result('due_soon', '明天到期', 'amber', 60, 'review_upcoming', true, dueDate, { daysUntilDue: days });
  if (days >= 2 && days <= dueSoonDays) return result('due_soon', `${days} 天后`, 'amber', 55, 'review_upcoming', true, dueDate, { daysUntilDue: days });
  return result('future', fmtDateMY(dueDate), 'neutral', 20, 'view', false, dueDate, { daysUntilDue: days });
}

export const recurringOccurrencePresentationTestHooks = Object.freeze({ COMPLETION_LABELS, WAITING_STATES });
