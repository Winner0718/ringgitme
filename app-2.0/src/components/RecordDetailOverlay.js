import { data, ui } from '../app/state.js';
import { closeSheet } from './AppSheet.js';
import { closeOverlayHistory, pushOverlayHistory, registerOverlayHistoryHandler } from '../app/router.js';

let presenter = null;
let active = null;
let suppressPresenterClose = false;

export function recordDetailOriginSnapshot(originView = null) {
  const content = document.querySelector('.app-content');
  const confirmationBody = document.querySelector('[data-money-motion-body]');
  const view = originView || (confirmationBody ? 'confirmation'
    : ui.tab === 'assets' && ui.assetsView.name === 'category' ? `${ui.assetsView.type}-category`
      : ui.tab === 'assets' && ui.assetsView.name === 'detail' ? 'account-detail'
        : ui.tab);
  return {
    view,
    tab: ui.tab,
    assetsView: structuredClone(ui.assetsView),
    selectedAccountId: structuredClone(ui.selectedAccountId),
    categoryIndex: structuredClone(ui.categoryIndex),
    activityAccountId: ui.activityAccountId,
    activityFilter: ui.activityFilter,
    activityQuery: ui.activityQuery,
    activityMonth: ui.activityMonth,
    pageScrollTop: content?.scrollTop || 0,
    confirmationScrollTop: confirmationBody?.scrollTop || 0,
  };
}

export function registerRecordDetailPresenter(nextPresenter) {
  presenter = nextPresenter;
}

function present(entry, { fromHistory = false } = {}) {
  const transaction = data.getActivity(entry.transactionId);
  if (!transaction || !presenter) return null;
  active = entry;
  presenter(transaction, {
    stacked: entry.origin?.view === 'confirmation',
    origin: entry.origin,
    onClose: () => {
      if (suppressPresenterClose) return;
      closeOverlayHistory(entry.token);
    },
  });
  if (fromHistory) restoreOriginPosition(entry.origin);
  return entry;
}

export function openRecordDetailOverlay(transactionId, { originView = null } = {}) {
  const transaction = data.getActivity(transactionId);
  if (!transaction || !presenter) return null;
  if (active?.transactionId === transactionId) return present(active);
  const entry = pushOverlayHistory({
    kind: 'record-detail',
    transactionId,
    origin: recordDetailOriginSnapshot(originView),
  });
  return present(entry);
}

export function transitionRecordDetailSheet(callback) {
  suppressPresenterClose = true;
  try { return callback?.(); }
  finally { queueMicrotask(() => { suppressPresenterClose = false; }); }
}

export function restoreOriginPosition(origin) {
  requestAnimationFrame(() => {
    const content = document.querySelector('.app-content');
    if (content && Number.isFinite(origin?.pageScrollTop)) content.scrollTop = origin.pageScrollTop;
    const confirmationBody = document.querySelector('[data-money-motion-body]');
    if (confirmationBody && Number.isFinite(origin?.confirmationScrollTop)) confirmationBody.scrollTop = origin.confirmationScrollTop;
  });
}

export function activeRecordDetail() {
  return active ? structuredClone(active) : null;
}

registerOverlayHistoryHandler(({ action, overlay }) => {
  if (overlay?.kind !== 'record-detail') return;
  if (action === 'open') return present(overlay, { fromHistory: true });
  suppressPresenterClose = true;
  closeSheet(true);
  suppressPresenterClose = false;
  restoreOriginPosition(overlay.origin);
  if (active?.token === overlay.token) active = null;
});
