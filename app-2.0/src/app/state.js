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
  heroIndex: 0, // Money Pulse hero state
  // Assets zone: overview → category (储蓄卡/信用卡/eWallet) → 账户详情
  assetsView: { name: 'overview' }, // | {name:'category', type} | {name:'detail', accountId, from}
  assetsSegment: 'all', // all | assets | liab
  categoryIndex: { saving: 0, cc: 0, ew: 0 }, // carousel selection per category
  // Activity
  activityFilter: 'all', // all | money | shared | receipts | photos
  activityQuery: '',
  activityMonth: '2026-07',
  highlightActivityId: null,
  // Ledger
  ledgerSegment: 'people', // people | groups
  ledgerPersonId: null, // set → person detail view
  ledgerView: 'current', // current | history
  ledgerHistoryLimit: 30,
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
