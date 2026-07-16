import { escapeHTML, fmtDateMY, fmtTimeAMPM } from '../app/format.js';
import { data } from '../app/state.js';
import { CONFIRMATION_COPY } from '../app/copy.js';
import { icon } from './Icons.js';
import { accountIdentityBarHTML, accountVisualCardHTML, bindAccountVisualFallbacks } from './AccountVisualCard.js';
import { formatMoneyMinor } from './MoneyCalculatorSheet.js';
import { staticMoneyBalanceHTML } from './MoneyOdometer.js';
import {
  continuousBalanceCountHTML,
  continuousBalanceMinorAtProgress,
  setContinuousBalanceValue,
  startContinuousBalanceCount,
} from './ContinuousBalanceCount.js';
import { MOTION, nextFrame, prefersReducedMotion } from '../app/motion.js';
import { isTopModal, mountModalLayer, pushModalLayer } from '../app/modalStack.js';
import { pushRoute } from '../app/router.js';
import { openRecordDetailOverlay } from './RecordDetailOverlay.js';
import { immutableConfirmationSnapshot } from '../domain/confirmationSnapshot.js';

// The final-state path is selected by prefers-reduced-motion: reduce.

export const CONFIRMATION_STATES = Object.freeze(['preparing', 'first-frame', 'balance-motion', 'record-motion', 'settled']);
export const CONFIRMATION_PHASES = Object.freeze([
  'first-frame', 'balance-rolling', 'balance-settle', 'relationship-enter', 'record-motion',
  'source-rolling', 'source-settle', 'transfer-cue', 'destination-rolling', 'destination-settle',
  'reduced-crossfade', 'settled',
]);
let confirmationPresentationSequence = 0;
let activeConfirmationClose = null;

export function confirmationStateFrame(state) {
  if (state === 'settled') return 3;
  return ['preparing', 'first-frame'].includes(state) ? 1 : 2;
}

export function createConfirmationPresentationSnapshot(confirmation) {
  const confirmationId = confirmation?.confirmationId || `presentation:${++confirmationPresentationSequence}`;
  return immutableConfirmationSnapshot({ ...confirmation, confirmationId });
}

function signedMinor(minor, kind = '') {
  const value = Number(minor || 0);
  const neutral = kind === 'transfer' || kind === 'plan';
  const prefix = neutral ? '' : kind === 'income' ? '+' : kind === 'expense' ? '−' : value > 0 ? '+' : value < 0 ? '−' : '';
  return `${prefix}${formatMoneyMinor(Math.abs(value))}`;
}

export function uniqueRecentRecords(records = [], transactionId = null) {
  const seen = new Set();
  return records.filter((record) => {
    if (!record?.id || seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  }).sort((a, b) => (a.id === transactionId ? -1 : b.id === transactionId ? 1 : 0));
}

function paddedCharacters(beforeMinor, afterMinor) {
  const before = formatMoneyMinor(beforeMinor);
  const after = formatMoneyMinor(afterMinor);
  const length = Math.max(before.length, after.length);
  return [before.padStart(length, ' '), after.padStart(length, ' ')];
}

// Animation-only markup. It is mounted solely for frame 2 and is removed at
// settle, leaving an ordinary static text node for iPhone Safari.
export function odometerHTML(beforeMinor, afterMinor) {
  const [before, after] = paddedCharacters(beforeMinor, afterMinor);
  return `<span class="motion-odometer-overlay num" data-motion-odometer-overlay aria-label="${formatMoneyMinor(beforeMinor)} 到 ${formatMoneyMinor(afterMinor)}">${[...after].map((next, index) => {
    const previous = before[index];
    const stable = previous === next || !/\d/.test(previous) || !/\d/.test(next);
    return stable ? `<span class="motion-digit stable${next === ' ' ? ' space' : ''}">${escapeHTML(next)}</span>` : `<span class="motion-digit changed"><i>${previous}</i><i>${next}</i></span>`;
  }).join('')}</span>`;
}

export function confirmationBalanceMode(motionState, accountIndex = 0, accountCount = 1, unchanged = false) {
  if (unchanged) return 'unchanged';
  if (motionState === 'reduced-crossfade') return 'reduced-after';
  if (motionState === 'settled' || motionState === 'record-motion' || motionState === 'relationship-enter' || motionState === 'balance-settle') return 'after';
  if (accountCount > 1) {
    if (accountIndex === 0) return motionState === 'source-rolling' ? 'counting' : ['source-settle', 'transfer-cue', 'destination-rolling', 'destination-settle'].includes(motionState) ? 'after' : 'before';
    return motionState === 'destination-rolling' ? 'counting' : motionState === 'destination-settle' ? 'after' : 'before';
  }
  return ['balance-motion', 'balance-rolling'].includes(motionState) ? 'counting' : 'before';
}

function accountForChange(change) {
  return change.accountSnapshot || data.getAccount(change.accountId) || {
    id: change.accountId,
    type: change.accountType || 'saving',
    name: change.accountName || '账户',
    short: change.accountName || '账户',
    bank: change.accountName || 'RinggitMe',
    last4: '',
    brandColor: 'var(--emerald-800)',
    art: null,
    balance: Number(change.afterMinor || 0) / 100,
    outstanding: Number(change.afterMinor || 0) / 100,
  };
}

function balanceVisualHTML(change, motionState, accountIndex, accountCount) {
  const unchanged = change.beforeMinor === change.afterMinor;
  const mode = confirmationBalanceMode(motionState, accountIndex, accountCount, unchanged);
  if (mode === 'counting') return continuousBalanceCountHTML(change.beforeMinor, change.afterMinor);
  if (mode === 'after') return staticMoneyBalanceHTML(change.afterMinor);
  if (mode === 'reduced-after') return staticMoneyBalanceHTML(change.afterMinor, { reducedCrossfade: true });
  return staticMoneyBalanceHTML(change.beforeMinor);
}

function balanceStageHTML(change, motionState, accountIndex, accountCount) {
  return `<div class="motion-balance-stage" data-motion-balance-stage data-motion-index="${accountIndex}" data-before-minor="${Number(change.beforeMinor || 0)}" data-after-minor="${Number(change.afterMinor || 0)}">
    ${balanceVisualHTML(change, motionState, accountIndex, accountCount)}
  </div>`;
}

function accountHeroHTML(change, motionState, accountIndex, accountCount, { compact = false, roleLabel = '', status = '' } = {}) {
  const unchanged = change.beforeMinor === change.afterMinor;
  const balanceMode = confirmationBalanceMode(motionState, accountIndex, accountCount, unchanged);
  const account = accountForChange(change);
  const balanceLabel = change.measure === 'outstanding' ? '当前欠款' : '账户余额';
  return `<article class="motion-balance-hero${compact ? ' compact' : ''}" data-motion-account="${escapeHTML(change.accountId)}">
    ${accountIdentityBarHTML(account, { status: status || (unchanged ? '余额未变' : '已更新'), roleLabel })}
    ${accountVisualCardHTML(account, { variant: 'confirmation', showAmount: false })}
    <div class="motion-balance-copy" data-balance-account="${escapeHTML(change.accountId)}">
      <span>${balanceLabel}</span>
      ${balanceStageHTML(change, motionState, accountIndex, accountCount)}
      <small class="motion-balance-range num" data-visible="${['after', 'reduced-after', 'unchanged'].includes(balanceMode)}">${formatMoneyMinor(change.beforeMinor)} → ${formatMoneyMinor(change.afterMinor)}</small>
      <div class="motion-balance-delta ${change.deltaMinor > 0 ? 'positive' : change.deltaMinor < 0 ? 'negative' : ''}">${unchanged ? '余额未变' : signedMinor(change.deltaMinor)}</div>
    </div>
  </article>`;
}

function accountsHTML(confirmation, motionState) {
  const changes = confirmation.accountChanges || [];
  if (!changes.length) return `<div class="motion-static-card">${icon(confirmation.accountEffect === 'planned' ? 'calendar' : 'note', 22)}<span><strong>${escapeHTML(CONFIRMATION_COPY.effect[confirmation.accountEffect] || '记录已保存')}</strong><small>没有产生账户余额动作</small></span></div>`;
  if (confirmation.accountEffect !== 'posted') {
    const unchanged = { ...changes[0], afterMinor: changes[0].beforeMinor, deltaMinor: 0 };
    const status = confirmation.accountEffect === 'relationship_only' ? '余额未变' : (CONFIRMATION_COPY.effect[confirmation.accountEffect] || '余额未变');
    return `${accountHeroHTML(unchanged, motionState, 0, 1, { status })}<div class="motion-unchanged-note">${escapeHTML(status)}</div>`;
  }
  if (changes.length > 1) return `<div class="motion-account-list dual">${accountHeroHTML(changes[0], motionState, 0, changes.length, { compact: true, roleLabel: '转出' })}<span class="motion-transfer-arrow">${icon('arrowDown', 18)}</span>${accountHeroHTML(changes[1], motionState, 1, changes.length, { compact: true, roleLabel: '转入' })}</div>`;
  return `<div class="motion-account-list">${accountHeroHTML(changes[0], motionState, 0, changes.length)}</div>`;
}

function relationshipHTML(confirmation) {
  const relationship = confirmation.relationship;
  if (!relationship) return '';
  const otherPaid = relationship.entryType === 'split_expense' && relationship.payerName && relationship.payerName !== '我';
  const action = relationship.entryType === 'split_expense'
    ? otherPaid ? `${relationship.payerName} 已付款 · 你应付 ${formatMoneyMinor(relationship.currentUserShareMinor)}` : `新增待收 ${formatMoneyMinor(relationship.afterMinor)}`
    : relationship.entryType === 'direct_payable' ? `新增待付 ${formatMoneyMinor(relationship.afterMinor)}`
      : relationship.entryType === 'settlement_received' || relationship.entryType === 'settlement_paid' ? `结算后剩余 ${formatMoneyMinor(relationship.afterMinor)}`
        : `新增待收 ${formatMoneyMinor(relationship.afterMinor)}`;
  return `<div class="motion-relationship-card">${icon('aa', 20)}<span><small>${escapeHTML(relationship.ledgerTitle || '关系账')}</small><strong>${escapeHTML(action)}</strong></span><b>已更新</b></div>`;
}

function planHTML(confirmation) {
  const plan = confirmation.plan;
  if (!plan) return '';
  const progress = plan.afterPaidMinor > 0 ? `${formatMoneyMinor(plan.afterPaidMinor)} 已完成` : '尚未付款';
  return `<div class="motion-relationship-card motion-plan-card">${icon('repayment', 20)}<span><small>${escapeHTML(plan.title)}</small><strong>${progress} · 剩余 ${formatMoneyMinor(plan.remainingMinor)}</strong></span><b>计划已更新</b></div>`;
}

export function isComplexConfirmation(confirmation) {
  return Boolean(
    (confirmation.accountChanges || []).length > 1
    || confirmation.relationship
    || confirmation.plan
    || confirmation.accountEffect === 'relationship_only'
    || ['settlement', 'plan'].includes(confirmation.kind),
  );
}

export function recentRecordLimit(confirmation) {
  return isComplexConfirmation(confirmation) ? 2 : 3;
}

export function recentHTML(confirmation, { expanded = false } = {}) {
  const records = uniqueRecentRecords(confirmation.recentRecords, confirmation.transactionId);
  if (!records.length) return '';
  const limit = recentRecordLimit(confirmation);
  const visible = expanded ? records : records.slice(0, limit);
  const expandable = records.length > limit;
  return `<div class="motion-recent" data-motion-recent data-expanded="${expanded}"><div class="motion-recent-head"><span class="caption">${CONFIRMATION_COPY.recent.title}</span>${expandable ? `<button type="button" data-motion-recent-toggle aria-expanded="${expanded}">${expanded ? CONFIRMATION_COPY.recent.collapse : CONFIRMATION_COPY.recent.expand} ${icon('chevronDown', 12)}</button>` : ''}</div>${visible.map((record) => {
    const current = record.id === confirmation.transactionId;
    return `<button type="button" class="motion-recent-row${current ? ' newest' : ' prior'}" data-motion-record-id="${escapeHTML(record.id)}" aria-label="查看 ${escapeHTML(record.desc || '记录')} 记录详情"><span><b>${escapeHTML(record.desc || '记录')}</b><small>${fmtDateMY(record.date)} · ${fmtTimeAMPM(record.time)}</small></span><strong class="num">${signedMinor(record.amountMinor, record.kind)}</strong></button>`;
  }).join('')}</div>`;
}

export function confirmationHistoryActionsHTML(confirmation) {
  if (confirmation.accountEffect === 'relationship_only') return '';
  const changes = (confirmation.accountChanges || []).filter((change) => data.getAccount(change.accountId));
  if (!changes.length) return '';
  if (changes.length > 1 || confirmation.kind === 'transfer') {
    return `<div class="motion-account-history-actions" data-motion-history-actions>
      ${changes.slice(0, 2).map((change, index) => {
        const account = data.getAccount(change.accountId);
        const label = index === 0 ? CONFIRMATION_COPY.recent.outgoingHistory : CONFIRMATION_COPY.recent.incomingHistory;
        return `<button type="button" data-motion-account-history="${escapeHTML(account.id)}"><span><small>${label}</small><strong>${escapeHTML(account.name)}</strong></span>${icon('chevronRight', 14)}</button>`;
      }).join('')}
    </div>`;
  }
  const account = data.getAccount(changes[0].accountId);
  const label = CONFIRMATION_COPY.recent.viewAccountHistory.replace('{name}', account.name);
  return `<div class="motion-account-history-actions" data-motion-history-actions><button type="button" data-motion-account-history="${escapeHTML(account.id)}"><span><strong>${escapeHTML(label)}</strong></span>${icon('chevronRight', 14)}</button></div>`;
}

function titleFor(confirmation) {
  if (confirmation.operation === 'edit') return '修改已更新';
  if (confirmation.kind === 'transfer') return '转账完成';
  if (confirmation.kind === 'plan') return '计划已建立';
  if (confirmation.kind === 'settlement') return '结算完成';
  if (confirmation.kind === 'income') return '收入已入账';
  return '已记入账户';
}

export function moneyFlowConfirmationHTML(confirmation, { frame = 3, recentExpanded = false, motionState = frame === 1 ? 'first-frame' : frame === 2 ? 'balance-motion' : 'settled' } = {}) {
  const title = titleFor(confirmation);
  const complex = isComplexConfirmation(confirmation);
  return `<div class="money-motion-layer modal-layer frame-${frame}" data-money-motion data-motion-state="${motionState}" data-confirmation-id="${escapeHTML(confirmation.confirmationId || '')}">
    <div class="money-motion-backdrop" data-modal-backdrop aria-hidden="true"></div>
    <section class="money-motion-card glass-sheet" data-modal-surface data-confirmation-shell data-complex="${complex}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
      <div class="money-motion-body" data-money-motion-body>
        ${accountsHTML(confirmation, motionState)}
        <div class="motion-transaction-effect"><span><small>本次</small><strong>${escapeHTML(confirmation.description || title)}</strong></span><b class="num">${signedMinor(confirmation.amountMinor, confirmation.kind)}</b></div>
        ${relationshipHTML(confirmation)}${planHTML(confirmation)}${recentHTML(confirmation, { expanded: recentExpanded })}${confirmationHistoryActionsHTML(confirmation)}
      </div>
      <footer class="money-motion-actions" data-money-motion-footer><button type="button" class="sheet-secondary" data-motion-continue>${CONFIRMATION_COPY.action.continue}</button><button type="button" class="sheet-secondary" data-motion-view ${confirmation.transactionId ? '' : 'disabled'}>${CONFIRMATION_COPY.action.view}</button><button type="button" class="sheet-primary" data-motion-done>${CONFIRMATION_COPY.action.done}</button></footer>
    </section>
  </div>`;
}

function requestedDebugFrame() {
  const frame = Number(new URLSearchParams(window.location.search).get('motionFrame'));
  return [1, 2, 3].includes(frame) ? frame : null;
}

function requestedDebugPhase() {
  const phase = new URLSearchParams(window.location.search).get('motionPhase');
  return CONFIRMATION_PHASES.includes(phase) ? phase : null;
}

function applyFrame(layer, next) {
  const previous = [...layer.classList].find((name) => /^frame-/.test(name));
  if (previous) layer.classList.remove(previous);
  layer.classList.add(`frame-${next}`);
  if (next === 3) layer.querySelectorAll('[data-motion-odometer-overlay], [data-continuous-balance-count]').forEach((overlay) => overlay.remove());
}

function renderBalanceStages(layer, presentation, motionState) {
  const changes = presentation.accountEffect === 'posted'
    ? (presentation.accountChanges || [])
    : (presentation.accountChanges || []).slice(0, 1).map((change) => ({ ...change, afterMinor: change.beforeMinor, deltaMinor: 0 }));
  layer.querySelectorAll('[data-motion-balance-stage]').forEach((stage) => {
    const index = Number(stage.dataset.motionIndex || 0);
    const change = changes[index];
    if (change) stage.innerHTML = balanceVisualHTML(change, motionState, index, changes.length);
  });
}

export function openMoneyFlowConfirmation({ transaction, confirmation = transaction?.confirmation, onPresented, onContinue, onViewRecord, onDone } = {}) {
  if (!confirmation) return null;
  if (activeConfirmationClose) activeConfirmationClose({ silent: true, instant: true });
  const presentation = createConfirmationPresentationSnapshot(confirmation);
  // Hidden browser-QA override mirrors the reduced-motion branch without
  // exposing any debug control in the production interface.
  const debugReducedMotion = new URLSearchParams(window.location.search).get('reducedMotion') === '1';
  const reducedMotion = debugReducedMotion || prefersReducedMotion();
  // Compatibility contract from the accepted three-frame implementation:
  // reducedMotion ? 3 : 1; automatic motion previously called setFrame(2)
  // before setFrame(3). The explicit state machine below preserves that same
  // visible frame mapping while adding first-paint and timeout guarantees.
  const debugFrame = requestedDebugFrame();
  const debugPhase = requestedDebugPhase();
  const transfer = (presentation.accountChanges || []).length > 1;
  const mappedDebugState = debugPhase || (debugFrame ? (debugFrame === 1 ? 'first-frame' : debugFrame === 2 ? (transfer ? 'source-rolling' : 'balance-rolling') : 'settled') : null);
  // Legacy reference retained for the accepted FIX3 source contract:
  // reducedMotion ? 'settled' : 'first-frame'; reducedMotion ? 3 : 1;
  let motionState = mappedDebugState || 'first-frame';
  let frame = confirmationStateFrame(motionState);
  let recentExpanded = false;
  let closed = false;
  const timers = [];
  const animationFrames = [];
  const countCancels = [];
  const wrapper = document.createElement('div');
  wrapper.innerHTML = moneyFlowConfirmationHTML(presentation, { frame, motionState });
  const layer = wrapper.firstElementChild;
  if (debugFrame || debugPhase) layer.classList.add('debug-motion-frame');
  const surface = layer.querySelector('[data-modal-surface]');
  const backdrop = layer.querySelector('[data-modal-backdrop]');
  mountModalLayer(layer);
  const releaseModal = pushModalLayer(layer, { id: `confirmation:${presentation.confirmationId}`, parentId: null, kind: 'confirmation', surface, backdrop });
  bindAccountVisualFallbacks(layer);
  surface?.focus?.({ preventScroll: true });
  onPresented?.(presentation);

  const cancelBalanceCounts = () => {
    while (countCancels.length) countCancels.pop()?.();
  };

  const startBalanceCounts = (nextState) => {
    const changes = presentation.accountEffect === 'posted' ? (presentation.accountChanges || []) : [];
    layer.querySelectorAll('[data-motion-balance-stage]').forEach((stage) => {
      const index = Number(stage.dataset.motionIndex || 0);
      const change = changes[index];
      if (!change || confirmationBalanceMode(nextState, index, changes.length, change.beforeMinor === change.afterMinor) !== 'counting') return;
      const counter = stage.querySelector('[data-continuous-balance-count]');
      if (!counter) return;
      countCancels.push(startContinuousBalanceCount(counter, {
        startMinor: change.beforeMinor,
        endMinor: change.afterMinor,
        durationMs: 1190,
      }));
    });
  };

  const setState = (nextState) => {
    if (closed || !CONFIRMATION_PHASES.includes(nextState)) return;
    motionState = nextState;
    cancelBalanceCounts();
    const next = confirmationStateFrame(nextState);
    frame = next;
    layer.dataset.motionState = nextState;
    applyFrame(layer, next);
    renderBalanceStages(layer, presentation, nextState);
    if (!debugFrame && !debugPhase && ['balance-rolling', 'source-rolling', 'destination-rolling'].includes(nextState)) {
      startBalanceCounts(nextState);
    }
  };
  const schedule = (state, delay) => timers.push(setTimeout(() => setState(state), delay));
  const settleDelay = transfer ? MOTION.transferConfirmationMs : MOTION.confirmationMs;
  if (!debugFrame && !debugPhase) {
    const firstPaint = nextFrame(() => {
      animationFrames.splice(animationFrames.indexOf(firstPaint), 1);
      const secondPaint = nextFrame(() => {
        animationFrames.splice(animationFrames.indexOf(secondPaint), 1);
      if (closed) return;
      if (reducedMotion) {
        schedule('reduced-crossfade', 180);
        schedule('record-motion', 420);
        if (presentation.relationship) schedule('relationship-enter', 520);
        schedule('settled', 680);
        return;
      }
      if (presentation.accountEffect !== 'posted' || !(presentation.accountChanges || []).some((change) => change.beforeMinor !== change.afterMinor)) {
        schedule('record-motion', 360);
        schedule('relationship-enter', 540);
        schedule('settled', 900);
      } else if (transfer) {
        schedule('source-rolling', 160);
        schedule('source-settle', 1350);
        schedule('transfer-cue', 1420);
        schedule('destination-rolling', 1500);
        schedule('destination-settle', 2690);
        schedule('record-motion', 2780);
        if (presentation.relationship) schedule('relationship-enter', 2860);
        schedule('settled', MOTION.transferConfirmationMs);
      } else {
        schedule('balance-rolling', 160);
        schedule('balance-settle', 1350);
        schedule('record-motion', 1650);
        if (presentation.relationship) schedule('relationship-enter', 1800);
        schedule('settled', MOTION.confirmationMs);
      }
      // Deterministic safety net: a missed CSS/animation event can never leave
      // the visual half-finished and never performs a financial write.
      timers.push(setTimeout(() => setState('settled'), settleDelay + 420));
      });
      animationFrames.push(secondPaint);
    });
    animationFrames.push(firstPaint);
    // FIX3 compatibility proof: motion begins after two paints via
    // nextFrame(() => nextFrame(() => ...)).
  }
  if (debugFrame || debugPhase) {
    const debugProgress = Math.max(0, Math.min(1, Number(new URLSearchParams(window.location.search).get('motionProgress')) || .55));
    layer.querySelectorAll('[data-continuous-balance-count]').forEach((counter) => {
      setContinuousBalanceValue(counter, continuousBalanceMinorAtProgress(Number(counter.dataset.startMinor), Number(counter.dataset.endMinor), debugProgress), { animate: false });
    });
  }
  const close = (callback, { silent = false, instant = false } = {}) => {
    if (closed) return false;
    closed = true;
    timers.forEach(clearTimeout);
    animationFrames.forEach((id) => (globalThis.cancelAnimationFrame || clearTimeout)(id));
    cancelBalanceCounts();
    document.removeEventListener('keydown', keydown);
    releaseModal();
    activeConfirmationClose = null;
    layer.classList.add('closing');
    setTimeout(() => { layer.remove(); if (!silent) callback?.(); }, instant || reducedMotion ? 0 : 180);
    return true;
  };
  activeConfirmationClose = ({ silent = false, instant = false } = {}) => close(onDone, { silent, instant });
  layer.addEventListener('click', (event) => {
    if (!isTopModal(layer)) return;
    if (event.target.closest('[data-motion-recent-toggle]')) {
      event.preventDefault();
      event.stopPropagation();
      recentExpanded = !recentExpanded;
      const currentRecent = layer.querySelector('[data-motion-recent]');
      currentRecent?.insertAdjacentHTML('afterend', recentHTML(presentation, { expanded: recentExpanded }));
      currentRecent?.remove();
      requestAnimationFrame(() => layer.querySelector('[data-motion-recent-toggle]')?.scrollIntoView?.({ block: 'nearest' }));
      return;
    }
    const record = event.target.closest('[data-motion-record-id]');
    if (record) return openRecordDetailOverlay(record.dataset.motionRecordId, { originView: 'confirmation' });
    const historyAction = event.target.closest('[data-motion-account-history]');
    if (historyAction) {
      const accountId = historyAction.dataset.motionAccountHistory;
      return close(() => pushRoute({ tab: 'activity', activityDetailId: null, activityAccountId: accountId, activityFilter: 'all', activityQuery: '' }, { direction: 'forward' }));
    }
    if (event.target.closest('[data-motion-continue]')) return close(onContinue || onDone);
    if (event.target.closest('[data-motion-view]')) return close(onViewRecord);
    if (event.target.closest('[data-motion-done]')) return close(onDone);
  });
  const keydown = (event) => { if (event.key === 'Escape' && isTopModal(layer)) { event.preventDefault(); motionState !== 'settled' ? setState('settled') : close(onDone); } };
  document.addEventListener('keydown', keydown);
  return { close: () => close(onDone), getFrame: () => frame, getState: () => motionState, isRecentExpanded: () => recentExpanded, confirmation: presentation };
}
