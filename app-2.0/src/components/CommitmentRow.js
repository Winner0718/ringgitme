// ============================================================
// CommitmentRow — radar rows sorted by days-to-due.
// Overdue = red, ≤7 days = orange, otherwise neutral.
// Includes the paid-state flip sample (blueprint §10 motion).
// ============================================================

import { fmtRM, fmtDateMY, daysBetween } from '../app/format.js';
import { data, ui } from '../app/state.js';
import { icon } from './Icons.js';

export function commitmentStatus(c, today = data.today) {
  if (c.paid) return { cls: 'paid', label: '已付' };
  const d = daysBetween(today, c.dueDate);
  if (d < 0) return { cls: 'overdue', label: `逾期 ${-d} 天` };
  if (d === 0) return { cls: 'soon', label: '今天到期' };
  if (d <= 7) return { cls: 'soon', label: `${d} 天后` };
  return { cls: 'normal', label: fmtDateMY(c.dueDate) };
}

export function renderCommitmentRow(c) {
  const st = commitmentStatus(c);
  const shareNote = c.myShare !== c.amount ? `我的份额 ${fmtRM(c.myShare, { privacy: ui.privacy })}` : '';
  return `
    <li class="commit-row row ${st.cls}${c.paid ? ' is-paid' : ''}" data-commit-id="${c.id}">
      <span class="commit-dot" aria-hidden="true"></span>
      <div class="row-main">
        <div class="row-title">${c.name}</div>
        <div class="caption">${st.label}${shareNote ? ` · ${shareNote}` : ''}</div>
      </div>
      <span class="num row-amt">${fmtRM(c.myShare, { privacy: ui.privacy })}</span>
      <button class="commit-pay${c.paid ? ' done' : ''}" data-action="toggle-commit-paid" data-commit="${c.id}"
        aria-label="${c.paid ? '标记未付' : '标记本月已付'}" aria-pressed="${c.paid}">
        ${icon('check', 16)}
      </button>
    </li>
  `;
}
