// ============================================================
// Today / Money Pulse page (blueprint §14.1).
// First viewport: hero number → metric strip → one pinned item
// → three radar rows. Budget + group summary below the fold.
// ============================================================

import { registerPage, navigate } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, daysBetween } from '../../app/format.js';
import { renderMoneyPulse, activateMoneyPulse, cycleHero } from '../../components/MoneyPulse.js';
import { renderMetricStrip } from '../../components/MetricStrip.js';
import { renderCommitmentRow, commitmentStatus } from '../../components/CommitmentRow.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';

function radarSorted() {
  return [...data.getCommitments()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function pinnedCommitment() {
  return radarSorted().find((c) => !c.paid) || null;
}

function pinnedItem() {
  const next = pinnedCommitment();
  if (!next) return '';
  const d = daysBetween(data.today, next.dueDate);
  const when = d < 0 ? `逾期 ${-d} 天` : d === 0 ? '今天' : `${d} 天后`;
  return `
    <section class="section">
      <button class="pin glass-accent" data-action="pin-tap">
        <span class="pin-icon">${icon('pin', 18)}</span>
        <div class="row-main">
          <div class="row-title">${next.name}</div>
          <div class="caption">${when} · ${fmtRM(next.myShare, { privacy: ui.privacy })}</div>
        </div>
        ${icon('chevronRight', 16)}
      </button>
    </section>
  `;
}

function budgetHTML() {
  const b = data.getBudget();
  const pct = Math.min(100, Math.round((b.used / b.total) * 100));
  return `
    <section class="section surface pad">
      <div class="row-between">
        <span class="caption">7 月预算</span>
        <span class="num caption">${fmtRM(b.used, { privacy: ui.privacy })} / ${fmtRM(b.total, { privacy: ui.privacy })}</span>
      </div>
      <div class="budget-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${pct}%" class="${pct > 90 ? 'warn' : ''}"></span>
      </div>
      <div class="caption">已用 ${pct}% · 剩 ${fmtRM(b.total - b.used, { privacy: ui.privacy })}</div>
    </section>
  `;
}

function groupSummaryHTML() {
  const groups = data.getGroups();
  if (!groups.length) return '';
  return `
    <section class="section">
      <h2 class="sec-title">群组</h2>
      <div class="surface">
        <ul>
          ${groups.map((g) => `
            <li class="row row-static">
              <div class="row-main">
                <div class="row-title">${g.name}</div>
                <div class="caption">${g.members} 人</div>
              </div>
              <span class="num row-amt ${g.myNet > 0 ? 'amt-pos' : 'amt-neg'}">
                ${g.myNet > 0 ? '应收' : '应付'} ${fmtRM(Math.abs(g.myNet), { privacy: ui.privacy })}
              </span>
            </li>`).join('')}
        </ul>
      </div>
    </section>
  `;
}

function renderToday(container) {
  const pulse = data.getPulse();
  // The pinned item is not repeated as the first radar row
  const pinned = pinnedCommitment();
  const radar = radarSorted().filter((c) => c !== pinned).slice(0, 3);
  container.innerHTML = `
    ${renderMoneyPulse(pulse)}
    ${renderMetricStrip(pulse)}
    ${pinnedItem()}
    <section class="section">
      <div class="row-between sec-head">
        <h2 class="sec-title">${icon('radar', 16)} 本月必还</h2>
        <span class="caption">共 ${data.getCommitments().filter((c) => !c.paid).length} 项待付</span>
      </div>
      <div class="surface"><ul>${radar.map(renderCommitmentRow).join('')}</ul></div>
    </section>
    ${budgetHTML()}
    ${groupSummaryHTML()}
  `;
  activateMoneyPulse(container);
}

export function registerTodayFeature() {
  registerPage('today', renderToday);
  registerAction('pulse-cycle', (el) => cycleHero(el.closest('.pulse')));
  registerAction('pin-tap', () => navigate('activity'));
  registerAction('metric-tap', (el) => {
    const m = el.dataset.metric;
    if (m === 'aaReceivable' || m === 'afterReceive') navigate('ledger');
    else navigate('assets');
  });
  // Marking paid is a short confirmation, never an instant mutation
  registerAction('toggle-commit-paid', (el, e) => {
    e.stopPropagation();
    const c = data.getCommitments().find((x) => x.id === el.dataset.commit);
    if (!c) return;
    openSheet({
      title: c.paid ? '恢复为待付' : '标记已付',
      contentHTML: `
        <div class="detail-hero">
          <div class="num detail-amt">${fmtRM(c.myShare, { privacy: ui.privacy })}</div>
          <div class="row-title">${c.name}</div>
          <div class="caption">${c.paid ? '恢复后会重新出现在待付列表。' : '确认这个月已经付了这一项？'}</div>
        </div>
        <button class="sheet-primary" data-action="confirm-commit-paid" data-commit="${c.id}">${c.paid ? '恢复待付' : '确认已付'}</button>
        <button class="sheet-secondary" data-action="sheet-close">取消</button>
      `,
    });
  });

  registerAction('confirm-commit-paid', (el) => {
    const c = data.getCommitments().find((x) => x.id === el.dataset.commit);
    if (!c) return;
    data.setCommitmentPaid(c.id, !c.paid);
    closeSheet();
    toast(c.paid ? `已标记「${c.name}」本月已付` : `「${c.name}」已恢复待付`);
    update({});
  });
}

export { commitmentStatus };
