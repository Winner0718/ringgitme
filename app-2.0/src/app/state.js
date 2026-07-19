// ============================================================
// App state — one UI-state store + one action registry.
// Data access goes through `data` (the adapter boundary); UI
// preferences live in `ui`. No financial persistence anywhere.
// ============================================================

import { createDemoDataSource } from '../fixtures/demoData.js';

export const data = createDemoDataSource();

const listeners = new Set();

export const ui = {
  tab: 'today', // today | assets | activity | ledger
  navDirection: 'forward',
  privacy: false,
  theme: 'auto', // auto | light | dark
  chromeMotion: true, // session-only presentation preference
  heroIndex: 0, // Money Pulse hero state
  todayView: 'overview', // overview | fixed (still the Today tab)
  fixedMonth: '2026-07',
  fixedWorkspace: 'month', // month | plans | history
  fixedPlanStatus: 'active', // active | paused | stopped | archived
  fixedPlanType: 'all', // all | fixed | subscription | relationship | installment
  fixedHistoryFilter: 'all', // all | completed | overdue | skipped
  fixedCompletedExpanded: false,
  // Assets zone: overview → category (储蓄卡/信用卡/eWallet) → 账户详情
  assetsView: { name: 'overview' }, // | {name:'category', type} | {name:'detail', accountId, from}
  assetsSegment: 'all', // all | assets | liab
  categoryIndex: { saving: 0, cc: 0, ew: 0 }, // carousel selection per category
  // Stable identity is authoritative; indexes are only a presentation cache.
  selectedAccountId: { saving: null, cc: null, ew: null },
  // Activity
  activityFilter: 'all', // all | money | shared | receipts | photos
  activityQuery: '',
  activityAccountId: null, // optional stable-ID filter opened from an account category
  activityMonth: '2026-07',
  highlightActivityId: null,
  // Ledger
  ledgerSegment: 'personal', // personal | group, derived from participant count
  ledgerId: null,
  ledgerPersonId: null,
  ledgerView: 'current', // current | history
  ledgerHistoryLimit: 30,
  ledgerFocusEntryId: null,
  ledgerReturnTransactionId: null,
  pendingActivityDetailId: null,
  activityDetailId: null,
  planDetailId: null,
  receivedPaymentDemo: null, // { itemId, targetId, amount } transient
};

export function update(patch) {
  Object.assign(ui, patch);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  listeners.forEach((fn) => fn(ui));
}

// ---- Delegated action registry (no inline handlers) --------
const actionHandlers = new Map();

export function registerAction(name, fn) {
  actionHandlers.set(name, fn);
}

export function dispatchAction(name, el, event) {
  const fn = actionHandlers.get(name);
  if (fn) fn(el, event);
}

// ---- Theme ------------------------------------------------
export function applyTheme(theme) {
  ui.theme = theme;
  const root = document.documentElement;
  if (theme === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';
  } else {
    root.dataset.theme = theme;
  }
}

export function watchSystemTheme() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (ui.theme === 'auto') {
      applyTheme('auto');
      emit();
    }
  });
}

function reducedMotionIsActive() {
  return document.documentElement.dataset.reducedMotion === 'true'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function applyChromeMotion(enabled = ui.chromeMotion) {
  ui.chromeMotion = enabled !== false;
  const root = document.documentElement;
  const preference = ui.chromeMotion ? 'on' : 'off';
  const effective = ui.chromeMotion && !reducedMotionIsActive() ? 'on' : 'off';
  root.dataset.chromeMotionPreference = preference;
  root.dataset.chromeMotion = effective;
  const app = document.getElementById('app');
  if (app) {
    app.dataset.chromeMotionPreference = preference;
    app.dataset.chromeMotion = effective;
  }
  return effective;
}

export function watchSystemMotion() {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => applyChromeMotion(ui.chromeMotion);
  media.addEventListener('change', sync);
  return () => media.removeEventListener('change', sync);
}
