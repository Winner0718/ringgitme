// ============================================================
// ActivityRow — compact time-flow row. Right-aligned tabular
// amounts: expense neutral, income green, transfer grey.
// Attachment presence = paperclip indicator only.
// ============================================================

import { fmtRM, fmtTimeAMPM, escapeHTML } from '../app/format.js';
import { ui, data } from '../app/state.js';
import { icon } from './Icons.js';

const KIND_ICON = { expense: null, income: 'arrowDown', transfer: 'transfer' };

export function renderActivityRow(t) {
  const acc = data.getAccount(t.accountId);
  const amtCls = t.kind === 'income' ? 'amt-pos' : t.kind === 'transfer' ? 'amt-muted' : '';
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
  const catIcon = KIND_ICON[t.kind] || catIconName(t.catId);
  const marks = [
    t.shared ? `<span class="row-mark" title="共享">AA</span>` : '',
    t.receipt || t.photo ? `<span class="row-clip">${icon('paperclip', 13)}</span>` : '',
  ].join('');
  return `
    <li class="act-row row${t.justSaved ? ' just-saved' : ''}" data-action="open-activity-detail" data-txn="${t.id}" id="act-${t.id}">
      <span class="row-icon cat-${t.catId}">${icon(catIcon, 17)}</span>
      <div class="row-main">
        <div class="row-title">${escapeHTML(t.desc)}${marks}</div>
        <div class="caption">${t.catLabel} · ${acc ? escapeHTML(acc.name) : '—'} · ${fmtTimeAMPM(t.time)}</div>
      </div>
      <span class="num row-amt ${amtCls}">${ui.privacy ? 'RM ••••' : `${sign}${fmtRM(t.amount).replace('RM ', 'RM ')}`}</span>
    </li>
  `;
}

export function catIconName(catId) {
  return ({ food: 'food', grocery: 'cart', transport: 'car', fun: 'ticket', bill: 'receipt', health: 'heart' })[catId] || 'note';
}
