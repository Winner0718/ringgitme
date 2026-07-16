import { escapeHTML } from '../app/format.js';
import { data } from '../app/state.js';
import { allocationSummary, applyRemainderToActive, equalSplitMinor } from '../domain/smartSplit.js';
import { evaluateMoneyExpression, formatMoneyMinor } from './MoneyCalculatorSheet.js';
import { icon } from './Icons.js';
import { sheetActionDockHTML } from './SheetActionDock.js';

function participantName(participantId) {
  if (participantId === 'participant-me') return 'Winner';
  const demoNumber = String(participantId).match(/^participant-demo-(\d+)$/)?.[1];
  return data.getParticipant(participantId)?.displayName || (demoNumber ? `成员 ${demoNumber}` : '参与者');
}

function expressionForMinor(minor) {
  return (Math.max(0, Number(minor || 0)) / 100).toFixed(2);
}

function appendExpression(expression, key, fresh) {
  if (key === 'C') return { expression: '', fresh: false };
  if (key === 'back') return { expression: expression.slice(0, -1), fresh: false };
  if (key === '=') return { expression, fresh };
  const operator = ['+', '−', '×', '÷'].includes(key);
  if (operator) {
    if (!expression || /[+−×÷]$/.test(expression)) return { expression, fresh: false };
    return { expression: `${expression}${key}`, fresh: false };
  }
  let next = fresh ? '' : expression;
  const tail = next.split(/[+−×÷]/).at(-1) || '';
  if (key === '.' && tail.includes('.')) return { expression: next, fresh: false };
  if (tail.includes('.') && tail.split('.')[1].length >= 2) return { expression: next, fresh: false };
  next += key;
  return { expression: next, fresh: false };
}

export function splitCompletionMessage(summary) {
  if (summary.exact) return '';
  return summary.overMinor
    ? `已超出 ${formatMoneyMinor(summary.overMinor)}，请调整金额`
    : `还差 ${formatMoneyMinor(summary.remainingMinor)}，请完成分配`;
}

export function customParticipantPresentation({ amountMinor = 0, active = false, expression = '', fresh = true } = {}) {
  const committedMinor = Math.max(0, Number(amountMinor || 0));
  const editingExpression = active && !fresh;
  return {
    state: active ? 'active' : committedMinor > 0 ? 'committed' : 'untouched',
    hint: active ? '正在输入' : committedMinor > 0 ? '' : '点击输入',
    amountLabel: editingExpression ? `RM ${expression || '0.00'}` : formatMoneyMinor(committedMinor),
    editingExpression,
  };
}

export function customAllocationProgress(totalMinor, sharesMinor, participantIds) {
  const ids = [...new Set(participantIds || [])];
  const total = Math.max(0, Number(totalMinor || 0));
  const summary = allocationSummary(total, sharesMinor, ids);
  const committedCount = ids.filter((id) => Math.max(0, Number(sharesMinor?.[id] || 0)) > 0).length;
  if (!total && !summary.allocatedMinor) {
    return { ...summary, state: 'neutral', committedCount, participantCount: ids.length, label: `已填写 ${committedCount}/${ids.length} 人` };
  }
  if (summary.overMinor) {
    return { ...summary, state: 'over', committedCount, participantCount: ids.length, label: `超出 ${formatMoneyMinor(summary.overMinor)}` };
  }
  if (summary.exact) {
    return { ...summary, state: 'exact', committedCount, participantCount: ids.length, label: '分配完成 ✓' };
  }
  return { ...summary, state: 'remaining', committedCount, participantCount: ids.length, label: `已填写 ${committedCount}/${ids.length} 人 · 剩余 ${formatMoneyMinor(summary.remainingMinor)}` };
}

export function createInlineSplitDraft({ participantIds, sharesMinor, activeParticipantId, triggerParticipantId = activeParticipantId } = {}) {
  const ids = [...new Set(participantIds || [])];
  const shares = Object.fromEntries(ids.map((id) => [id, Math.max(0, Number(sharesMinor?.[id] || 0))]));
  const activeId = ids.includes(activeParticipantId) ? activeParticipantId : ids[0];
  return {
    ids,
    shares,
    activeId,
    expression: expressionForMinor(shares[activeId]),
    fresh: true,
    error: '',
    triggerParticipantId,
  };
}

export function commitInlineSplitExpression(draft) {
  if (!draft?.activeId) return false;
  if (!draft.expression) {
    draft.shares[draft.activeId] = 0;
    draft.error = '';
    return true;
  }
  try {
    const result = evaluateMoneyExpression(draft.expression, { allowZero: true });
    draft.shares[draft.activeId] = result.minor;
    draft.error = '';
    return true;
  } catch (reason) {
    draft.error = reason.message;
    return false;
  }
}

export function switchInlineSplitParticipant(draft, participantId) {
  if (!draft?.ids.includes(participantId)) return false;
  if (!commitInlineSplitExpression(draft)) return false;
  draft.activeId = participantId;
  draft.expression = expressionForMinor(draft.shares[participantId]);
  draft.fresh = true;
  draft.error = '';
  return true;
}

export function pressInlineSplitKey(draft, key) {
  if (!draft) return false;
  if (key === '=') {
    if (!commitInlineSplitExpression(draft)) return false;
    draft.expression = expressionForMinor(draft.shares[draft.activeId]);
    draft.fresh = true;
    return true;
  }
  ({ expression: draft.expression, fresh: draft.fresh } = appendExpression(draft.expression, key, draft.fresh));
  draft.error = '';
  if (!/[+−×÷]$/.test(draft.expression)) commitInlineSplitExpression(draft);
  return true;
}

export function equalizeInlineSplitDraft(draft, totalMinor) {
  draft.shares = equalSplitMinor(totalMinor, draft.ids);
  draft.expression = expressionForMinor(draft.shares[draft.activeId]);
  draft.fresh = true;
  draft.error = '';
  return draft;
}

export function fillInlineSplitRemainder(draft, totalMinor) {
  draft.shares = applyRemainderToActive(totalMinor, draft.ids, draft.shares, draft.activeId);
  draft.expression = expressionForMinor(draft.shares[draft.activeId]);
  draft.fresh = true;
  draft.error = '';
  return draft;
}

export function clearInlineSplitCurrent(draft) {
  draft.shares[draft.activeId] = 0;
  draft.expression = '';
  draft.fresh = false;
  draft.error = '';
  return draft;
}

export function splitEditorClosingShares(openingShares, currentShares, completed) {
  return { ...(completed ? currentShares : openingShares) };
}

export function inlineSplitDrawerHTML({ totalMinor, participantIds, sharesMinor, activeParticipantId, expression, error = '', opening = false }) {
  const ids = [...new Set(participantIds || [])];
  const progress = customAllocationProgress(totalMinor, sharesMinor, ids);
  const keys = ['C', 'back', '÷', '×', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', '=', '0', '.'];
  const activeOperator = String(expression || '').match(/[+−×÷]$/)?.[0] || '';
  return `<aside class="inline-split-drawer${opening ? ' is-opening' : ''}" data-inline-split-drawer aria-label="编辑 ${escapeHTML(participantName(activeParticipantId))} 的分摊金额">
    <div class="split-editor-feedback ${progress.state}${error ? ' has-error' : ''}" data-inline-split-feedback tabindex="-1" aria-live="polite">${escapeHTML(error || progress.label)}</div>
    <div class="split-editor-keypad" role="group" aria-label="分摊金额计算器">${keys.map((key) => {
      const isOperator = ['÷', '×', '−', '+', '='].includes(key);
      const isSelected = isOperator && key === activeOperator;
      return `<button type="button" class="capture-calculator-key split-editor-key${isOperator ? ' operator' : ''}${isSelected ? ' is-selected' : ''}${key === '0' ? ' zero' : ''}" data-inline-split-key="${key}" aria-label="${key === 'back' ? '退格' : key === 'C' ? '清除' : key}"${isOperator ? ` aria-pressed="${isSelected}"` : ''}>${key === 'back' ? icon('backspace', 18) : key}</button>`;
    }).join('')}</div>
    ${sheetActionDockHTML({ context: 'inline-split', className: 'inline-split-action-dock', primaryLabel: '应用', secondaryLabel: '收起', primaryAttributes: { 'data-inline-split-apply': '' }, secondaryAttributes: { 'data-inline-split-collapse': '' } })}
  </aside>`;
}

// Compatibility export for focused domain tests. The production path renders
// this markup inline inside the existing Relationship Sheet; it never mounts
// another modal, backdrop, portal or body-level layer.
export const splitAllocationEditorHTML = inlineSplitDrawerHTML;
