// ============================================================
// CaptureSheet — central ＋ interaction (blueprint §14.6).
// First view holds exactly four essentials: mode / amount /
// category / account. Everything else sits behind「更多」.
// Saving appends an in-memory fixture activity (no persistence,
// no rm_v3). Sound stays off by default (none wired).
// ============================================================

import { openSheet, closeSheet, toast } from './AppSheet.js';
import { icon } from './Icons.js';
import { fmtRM, fmtDateMY, fmtTimeAMPM, escapeHTML } from '../app/format.js';
import { data, ui, update, registerAction } from '../app/state.js';
import { navigate } from '../app/router.js';
import { catIconName } from './ActivityRow.js';

const MODES = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '收入' },
  { id: 'transfer', label: '转账' },
];

const cap = {
  mode: 'expense',
  amount: '',
  catId: 'food',
  accountId: 'sv-mbb',
  more: false,
  recordOnly: false,
  aa: false,
  desc: '',
};

let sheetEl = null;
let saving = false;

export function openCaptureSheet() {
  Object.assign(cap, { mode: 'expense', amount: '', more: false, recordOnly: false, aa: false, desc: '' });
  saving = false;
  sheetEl = openSheet({
    title: '',
    className: 'capture-sheet',
    contentHTML: captureHTML(),
    onClose: () => (sheetEl = null),
  });
}

function rerender() {
  if (!sheetEl) return;
  const descEl = sheetEl.querySelector('[data-cap-desc]');
  if (descEl) cap.desc = descEl.value;
  sheetEl.querySelector('.sheet-body').innerHTML = captureHTML();
}

function amountDisplay() {
  if (!cap.amount) return '0.00';
  return cap.amount;
}

function captureHTML() {
  const cats = data.getRecentCategories();
  const accounts = data.getAccounts();
  const acc = data.getAccount(cap.accountId);
  const accSummary =
    acc?.type === 'cc'
      ? `可用 ${fmtRM(acc.limit - acc.outstanding)} · 欠 ${fmtRM(acc.outstanding)}`
      : acc
        ? `余额 ${fmtRM(acc.balance)}`
        : '';
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `
    <div class="segmented capture-modes" role="radiogroup" aria-label="记账模式">
      ${MODES.map((m) => `<button class="seg-item${cap.mode === m.id ? ' active' : ''}" data-action="cap-mode" data-mode="${m.id}" role="radio" aria-checked="${cap.mode === m.id}">${m.label}</button>`).join('')}
    </div>

    <div class="cap-amount num" aria-live="polite">RM <span>${amountDisplay()}</span></div>

    <div class="cap-cats" role="listbox" aria-label="类别">
      ${cats.map((c) => `<button class="cap-cat${cap.catId === c.id ? ' active' : ''}" data-action="cap-cat" data-cat="${c.id}" role="option" aria-selected="${cap.catId === c.id}">
        ${icon(catIconName(c.id), 16)}<span>${c.label}</span>
      </button>`).join('')}
    </div>

    <div class="cap-accounts" role="listbox" aria-label="账户">
      ${accounts.map((a) => `<button class="cap-acc${cap.accountId === a.id ? ' active' : ''}" data-action="cap-acc" data-acc="${a.id}" role="option" aria-selected="${cap.accountId === a.id}">${escapeHTML(shortName(a))}</button>`).join('')}
    </div>
    <div class="caption cap-acc-summary">${escapeHTML(acc?.name || '')} · ${accSummary}</div>

    <button class="cap-more-toggle" data-action="cap-more" aria-expanded="${cap.more}">
      更多 ${icon(cap.more ? 'chevronDown' : 'chevronRight', 14)}
    </button>
    ${cap.more ? moreHTML(hhmm) : ''}

    <div class="cap-keypad" role="group" aria-label="数字键盘">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']
        .map((k) =>
          k === 'back'
            ? `<button class="key" data-action="cap-key" data-key="back" aria-label="退格">${icon('backspace', 20)}</button>`
            : `<button class="key num" data-action="cap-key" data-key="${k}">${k}</button>`,
        )
        .join('')}
    </div>

    <div class="cap-save-wrap">
      <button class="cap-save" data-action="cap-save">保存</button>
    </div>
  `;
}

function moreHTML(hhmm) {
  return `
    <div class="cap-more">
      <label class="cap-field">
        <span class="caption">描述</span>
        <input type="text" data-cap-desc placeholder="例如 KFC 午餐" value="${escapeHTML(cap.desc)}" maxlength="40" />
      </label>
      <div class="cap-field-row">
        <span class="caption">${icon('calendar', 14)} ${fmtDateMY(data.today)} · ${fmtTimeAMPM(hhmm)}</span>
      </div>
      <button class="cap-flag${cap.aa ? ' on' : ''}" data-action="cap-aa" aria-pressed="${cap.aa}">
        AA 分账${cap.aa ? icon('check', 14) : ''}
      </button>
      <button class="cap-flag" data-action="cap-attach">
        ${icon('paperclip', 14)} 附件
      </button>
      <button class="cap-flag${cap.recordOnly ? ' on' : ''}" data-action="cap-record-only" aria-pressed="${cap.recordOnly}">
        只记录，不动余额${cap.recordOnly ? icon('check', 14) : ''}
      </button>
    </div>
  `;
}

function shortName(a) {
  return a.short || a.name;
}

function pressKey(key) {
  if (key === 'back') {
    cap.amount = cap.amount.slice(0, -1);
  } else if (key === '.') {
    if (!cap.amount.includes('.')) cap.amount = (cap.amount || '0') + '.';
  } else {
    const [, dec] = cap.amount.split('.');
    if (dec !== undefined && dec.length >= 2) return; // sen precision
    if (cap.amount.replace('.', '').length >= 9) return;
    if (cap.amount === '0') cap.amount = key;
    else cap.amount += key;
  }
  const el = sheetEl?.querySelector('.cap-amount span');
  if (el) el.textContent = amountDisplay();
}

function save() {
  const amount = parseFloat(cap.amount);
  if (!amount || amount <= 0) {
    toast('先输入金额');
    return;
  }
  if (saving) return; // double-tap guard
  saving = true;
  const descEl = sheetEl.querySelector('[data-cap-desc]');
  if (descEl) cap.desc = descEl.value.trim();
  const item = data.saveCapture({
    mode: cap.mode,
    amount,
    catId: cap.catId,
    accountId: cap.accountId,
    desc: cap.desc,
  });

  // Success motion: check burst inside the sheet, then flow to Activity
  const overlay = document.createElement('div');
  overlay.className = 'cap-success';
  overlay.innerHTML = `<div class="cap-success-ring">${icon('check', 34)}</div><div class="caption">已记一笔 ${fmtRM(amount)}</div>`;
  sheetEl.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => {
    closeSheet();
    update({ highlightActivityId: item.id, activityMonth: '2026-07', activityFilter: 'all', activityQuery: '' });
    navigate('activity');
    toast(`已记一笔 ${fmtRM(amount)} · ${item.desc}`);
  }, 620);
}

export function registerCaptureActions() {
  registerAction('open-capture', () => openCaptureSheet());
  registerAction('cap-mode', (el) => { cap.mode = el.dataset.mode; rerender(); });
  registerAction('cap-cat', (el) => { cap.catId = el.dataset.cat; rerender(); });
  registerAction('cap-acc', (el) => { cap.accountId = el.dataset.acc; rerender(); });
  registerAction('cap-more', () => { cap.more = !cap.more; rerender(); });
  registerAction('cap-aa', () => { cap.aa = !cap.aa; rerender(); });
  registerAction('cap-record-only', () => { cap.recordOnly = !cap.recordOnly; rerender(); });
  registerAction('cap-attach', () => toast('此功能暂未开放'));
  registerAction('cap-key', (el) => pressKey(el.dataset.key));
  registerAction('cap-save', () => save());
}
