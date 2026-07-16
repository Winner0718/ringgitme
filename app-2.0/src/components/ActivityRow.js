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
  const amtCls = t.kind === 'income' ? 'amt-pos' : t.kind === 'transfer' ? 'amt-muted' : '';
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
  const category = data.getCategory(t.catId);
  const catIcon = KIND_ICON[t.kind] || category?.icon || catIconName(t.catId);
  const attachmentCount = t.attachmentCount ?? (t.attachment || t.receipt || t.photo ? 1 : 0);
  const marks = [
    t.shared ? `<span class="row-mark" title="共享">AA</span>` : '',
    t.accountEffect === 'record_only' ? '<span class="row-mark record-only-badge">只记录</span>' : '',
    t.accountEffect === 'relationship_only' ? '<span class="row-mark relationship-only-badge">关系账</span>' : '',
    attachmentCount ? `<span class="row-clip">${icon('paperclip', 13)}${attachmentCount > 1 ? `<span class="row-clip-count">${attachmentCount}</span>` : ''}</span>` : '',
  ].join('');
  return `
    <li class="act-row row${t.justSaved ? ' just-saved' : ''}" data-action="open-record-detail" data-txn="${t.id}" id="act-${t.id}" role="button" tabindex="0" aria-label="查看 ${escapeHTML(t.desc)} 记录详情">
      <span class="row-icon theme-${t.categoryThemeToken || category?.themeToken || 'slate'}">${icon(catIcon, 17)}</span>
      <div class="row-main">
        <div class="row-title">${escapeHTML(t.desc)}${marks}</div>
        <div class="caption">${escapeHTML(data.getTransactionCategoryLabel(t))} · ${escapeHTML(data.getTransactionAccountLabel(t))} · ${fmtTimeAMPM(t.time)}</div>
      </div>
      <span class="num row-amt ${amtCls}">${ui.privacy ? 'RM ••••' : `${sign}${fmtRM(t.amount).replace('RM ', 'RM ')}`}</span>
    </li>
  `;
}

export function catIconName(catId) {
  return ({ food: 'food', grocery: 'cart', transport: 'car', fun: 'ticket', bill: 'receipt', health: 'heart' })[catId] || 'note';
}
