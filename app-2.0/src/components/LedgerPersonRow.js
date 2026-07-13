// ============================================================
// LedgerPersonRow + group row — net-direction people rows.
// Positive net = they owe me (green); negative = I owe (red).
// ============================================================

import { fmtRM, fmtDateMY, escapeHTML } from '../app/format.js';
import { ui } from '../app/state.js';
import { icon } from './Icons.js';

export function renderPersonRow(p) {
  const dir = p.net > 0 ? `${escapeHTML(p.name)} 还欠你` : p.net < 0 ? `你还欠 ${escapeHTML(p.name)}` : '已结清';
  const cls = p.net > 0 ? 'amt-pos' : p.net < 0 ? 'amt-neg' : 'amt-muted';
  return `
    <li class="row person-row" data-action="open-person" data-person="${p.id}">
      <span class="avatar">${escapeHTML(p.name[0])}${p.telegram ? '<i class="tg-dot" title="已连接 Telegram"></i>' : ''}</span>
      <div class="row-main">
        <div class="row-title">${escapeHTML(p.name)}</div>
        <div class="caption">${dir}</div>
      </div>
      <span class="num row-amt ${cls}">${fmtRM(Math.abs(p.net), { privacy: ui.privacy })}</span>
      ${icon('chevronRight', 16)}
    </li>
  `;
}

export function renderGroupRow(g) {
  const dir = g.myNet > 0 ? '应收' : g.myNet < 0 ? '应付' : '已结清';
  const cls = g.myNet > 0 ? 'amt-pos' : g.myNet < 0 ? 'amt-neg' : 'amt-muted';
  return `
    <li class="row person-row" data-group="${g.id}">
      <span class="avatar group-avatar">${icon('ledger', 18)}</span>
      <div class="row-main">
        <div class="row-title">${escapeHTML(g.name)}</div>
        <div class="caption">${g.members} 人 · 最近 ${fmtDateMY(g.lastActivity)}</div>
      </div>
      <span class="num row-amt ${cls}">${dir} ${fmtRM(Math.abs(g.myNet), { privacy: ui.privacy })}</span>
    </li>
  `;
}
