// ============================================================
// Ledger page (blueprint §14.12) — People/Groups segments, AA
// summary, person detail with current/history switch, 30-item
// pagination + Load More (reset on context change), paperclip
// indicators, Received Payment demo sheet with partial state.
// Presentation + in-memory interaction only. No RPCs.
// ============================================================

import { registerPage } from '../../app/router.js';
import { data, ui, update, registerAction } from '../../app/state.js';
import { fmtRM, fmtDateMY, escapeHTML } from '../../app/format.js';
import { renderPersonRow, renderGroupRow } from '../../components/LedgerPersonRow.js';
import { openSheet, closeSheet, toast } from '../../components/AppSheet.js';
import { icon } from '../../components/Icons.js';

function summaryHTML() {
  const people = data.getPeople();
  const receivable = people.reduce((s, p) => s + Math.max(0, p.net), 0);
  const payable = people.reduce((s, p) => s + Math.max(0, -p.net), 0);
  return `
    <section class="section surface pad ledger-summary">
      <div><span class="caption">AA 待收</span><span class="num amt-pos">${fmtRM(receivable, { privacy: ui.privacy })}</span></div>
      <div><span class="caption">待付</span><span class="num amt-neg">${fmtRM(payable, { privacy: ui.privacy })}</span></div>
    </section>
  `;
}

function settlementsHTML() {
  const rows = data.getRecentSettlements();
  if (!rows.length) return '';
  return `
    <section class="section">
      <h2 class="sec-title">最近结算</h2>
      <div class="surface"><ul>
        ${rows.map((s) => `
          <li class="row row-static">
            <span class="row-icon">${icon('check', 15)}</span>
            <div class="row-main">
              <div class="row-title">收到 ${escapeHTML(s.person)} 的还款</div>
              <div class="caption">${fmtDateMY(s.date)} · ${escapeHTML(s.via)}</div>
            </div>
            <span class="num row-amt amt-pos">+${fmtRM(s.amount, { privacy: ui.privacy }).replace('RM ', 'RM ')}</span>
          </li>`).join('')}
      </ul></div>
    </section>
  `;
}

function peopleHTML() {
  return `
    ${summaryHTML()}
    <section class="section surface"><ul>
      ${data.getPeople().map(renderPersonRow).join('')}
    </ul></section>
    ${settlementsHTML()}
  `;
}

function pendingHTML() {
  const pending = data.getPeople().flatMap((p) =>
    data.getPersonCurrent(p.id).map((it) => ({ person: p, it })));
  if (!pending.length) return '';
  return `
    <section class="section">
      <h2 class="sec-title">等待处理</h2>
      <div class="surface"><ul>
        ${pending.slice(0, 3).map(({ person, it }) => `
          <li class="row" data-action="open-person" data-person="${person.id}">
            <span class="avatar">${escapeHTML(person.name[0])}</span>
            <div class="row-main">
              <div class="row-title">${escapeHTML(it.title)}</div>
              <div class="caption">${escapeHTML(person.name)} · ${fmtDateMY(it.date)}</div>
            </div>
            <span class="num row-amt">${fmtRM(it.total - it.settled, { privacy: ui.privacy })}</span>
            ${icon('chevronRight', 15)}
          </li>`).join('')}
      </ul></div>
    </section>
  `;
}

function groupsHTML() {
  return `
    <section class="section surface"><ul>
      ${data.getGroups().map(renderGroupRow).join('')}
    </ul></section>
    ${pendingHTML()}
  `;
}

// ---- Person detail ------------------------------------------

function currentItemsHTML(person) {
  const items = data.getPersonCurrent(person.id);
  if (!items.length) return `<div class="empty surface pad caption">没有未结项。</div>`;
  return `<div class="surface"><ul>
    ${items.map((it) => {
      const remaining = it.total - it.settled;
      const partial = it.settled > 0;
      return `
        <li class="row ledger-item">
          <div class="row-main">
            <div class="row-title">${escapeHTML(it.title)}
              ${it.attachments ? `<span class="row-clip">${icon('paperclip', 13)}</span>` : ''}
            </div>
            <div class="caption">${fmtDateMY(it.date)}${partial ? ` · 已收 ${fmtRM(it.settled, { privacy: ui.privacy })} / ${fmtRM(it.total, { privacy: ui.privacy })}` : ''}</div>
            ${partial ? `<div class="partial-bar"><span style="width:${Math.round((it.settled / it.total) * 100)}%"></span></div>` : ''}
          </div>
          <span class="num row-amt">${fmtRM(remaining, { privacy: ui.privacy })}</span>
          <button class="mini-btn" data-action="open-receive" data-item="${it.id}" data-person="${person.id}">收到款</button>
        </li>`;
    }).join('')}
  </ul></div>`;
}

function historyHTML(person) {
  const all = data.getPersonHistory(person.id);
  const shown = all.slice(0, ui.ledgerHistoryLimit);
  return `
    <div class="surface"><ul>
      ${shown.map((h) => `
        <li class="row">
          <span class="row-icon">${icon(h.direction === 'receive' ? 'arrowDown' : 'arrowUp', 15)}</span>
          <div class="row-main">
            <div class="row-title">${escapeHTML(h.title)}
              ${h.attachments ? `<span class="row-clip">${icon('paperclip', 13)}</span>` : ''}
            </div>
            <div class="caption">${fmtDateMY(h.date)} · ${escapeHTML(h.settledVia)}</div>
          </div>
          <span class="num row-amt ${h.direction === 'receive' ? 'amt-pos' : ''}">${h.direction === 'receive' ? '+' : '−'}${fmtRM(h.amount, { privacy: ui.privacy }).replace('RM ', 'RM ')}</span>
        </li>`).join('')}
    </ul></div>
    <div class="caption load-note">已显示 ${shown.length} / ${all.length} 条</div>
    ${all.length > shown.length ? `<button class="load-more surface" data-action="ledger-load-more">加载更多</button>` : ''}
  `;
}

function personDetailHTML(person) {
  return `
    <div class="detail-nav">
      <button class="back-btn" data-action="ledger-back">${icon('chevronLeft', 18)} 账本</button>
    </div>
    <section class="section person-head">
      <span class="avatar avatar-lg">${escapeHTML(person.name[0])}</span>
      <div>
        <div class="page-title" style="font-size:22px">${escapeHTML(person.name)}</div>
        <div class="caption ${person.net > 0 ? 'amt-pos' : person.net < 0 ? 'amt-neg' : ''}">
          ${person.net > 0 ? `还欠你 ${fmtRM(person.net, { privacy: ui.privacy })}` : person.net < 0 ? `你还欠 ${fmtRM(-person.net, { privacy: ui.privacy })}` : '已结清'}
        </div>
      </div>
    </section>
    <div class="segmented" role="radiogroup" aria-label="视图">
      <button class="seg-item${ui.ledgerView === 'current' ? ' active' : ''}" data-action="ledger-view" data-view="current" role="radio" aria-checked="${ui.ledgerView === 'current'}">当前未结</button>
      <button class="seg-item${ui.ledgerView === 'history' ? ' active' : ''}" data-action="ledger-view" data-view="history" role="radio" aria-checked="${ui.ledgerView === 'history'}">历史</button>
    </div>
    <section class="section">
      ${ui.ledgerView === 'current' ? currentItemsHTML(person) : historyHTML(person)}
    </section>
  `;
}

function renderLedger(container) {
  if (ui.ledgerPersonId) {
    const person = data.getPerson(ui.ledgerPersonId);
    container.innerHTML = personDetailHTML(person);
    return;
  }
  container.innerHTML = `
    <div class="segmented" role="radiogroup" aria-label="账本分段">
      <button class="seg-item${ui.ledgerSegment === 'people' ? ' active' : ''}" data-action="ledger-segment" data-seg="people" role="radio" aria-checked="${ui.ledgerSegment === 'people'}">个人</button>
      <button class="seg-item${ui.ledgerSegment === 'groups' ? ' active' : ''}" data-action="ledger-segment" data-seg="groups" role="radio" aria-checked="${ui.ledgerSegment === 'groups'}">群组</button>
    </div>
    ${ui.ledgerSegment === 'people' ? peopleHTML() : groupsHTML()}
  `;
}

// ---- Received Payment demo sheet ----------------------------

function receiveSheet(personId, itemId) {
  const person = data.getPerson(personId);
  const item = data.getPersonCurrent(personId).find((i) => i.id === itemId);
  if (!person || !item) return;
  const remaining = item.total - item.settled;
  const targets = data.getReceiveTargets();
  openSheet({
    title: '收到款',
    contentHTML: `
      <div class="detail-hero">
        <div class="num detail-amt amt-pos">${fmtRM(remaining, { privacy: ui.privacy })}</div>
        <div class="caption">${escapeHTML(person.name)} · ${escapeHTML(item.title)}</div>
      </div>
      <div class="sheet-group">
        <div class="caption sheet-group-label">入账去向</div>
        ${targets.map((t) => `
          <button class="row target-row" data-action="receive-confirm" data-person="${personId}" data-item="${itemId}" data-target="${t.id}">
            <span class="row-icon">${icon(t.type === 'cash' ? 'note' : t.type === 'ew' ? 'wallet' : 'assets', 16)}</span>
            <div class="row-main">
              <div class="row-title">${escapeHTML(t.name)}</div>
              <div class="caption">${t.note}</div>
            </div>
            ${icon('chevronRight', 16)}
          </button>`).join('')}
      </div>
    `,
  });
}

export function registerLedgerFeature() {
  registerPage('ledger', renderLedger);

  registerAction('ledger-segment', (el) =>
    update({ ledgerSegment: el.dataset.seg, ledgerPersonId: null, ledgerHistoryLimit: 30 }));

  registerAction('open-person', (el) =>
    update({ ledgerPersonId: el.dataset.person, ledgerView: 'current', ledgerHistoryLimit: 30, navDirection: 'forward' }));

  registerAction('ledger-back', () =>
    update({ ledgerPersonId: null, ledgerHistoryLimit: 30, navDirection: 'back' }));

  registerAction('ledger-view', (el) =>
    update({ ledgerView: el.dataset.view, ledgerHistoryLimit: 30 }));

  registerAction('ledger-load-more', () =>
    update({ ledgerHistoryLimit: ui.ledgerHistoryLimit + 30 }));

  registerAction('open-receive', (el, e) => {
    e.stopPropagation();
    receiveSheet(el.dataset.person, el.dataset.item);
  });

  registerAction('receive-confirm', (el) => {
    const { person, item, target } = el.dataset;
    const it = data.getPersonCurrent(person).find((i) => i.id === item);
    const p = data.getPerson(person);
    if (!it || !p) return;
    const remaining = it.total - it.settled;
    it.settled = it.total; // demo full settle in memory
    p.net = Math.max(0, p.net - remaining);
    closeSheet();
    const cashNote = target === 'cash' ? '（只记录，不动余额）' : '';
    toast(`已收到 ${fmtRM(remaining)}${cashNote}`);
    update({});
  });
}
