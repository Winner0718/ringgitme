// ============================================================
// Router — five-zone tab navigation. Each feature registers a
// render(container) function; Capture is a sheet, not a page.
// ============================================================

import { ui, update } from './state.js';
import { closeSheet } from '../components/AppSheet.js';

const pages = new Map();
const TAB_ORDER = ['today', 'assets', 'activity', 'ledger'];
const PRESENTATION_QUERY_KEYS = ['theme', 'capture', 'more', 'profile', 'confirmationDemo', 'motionFrame', 'motionPhase', 'motionProgress', 'splitComposerDemo', 'carouselPosition', 'reducedMotion', 'imageFailure'];

export function registerPage(name, renderFn) {
  pages.set(name, renderFn);
}

export function navigate(tab) {
  if (tab === ui.tab) {
    // re-tap active tab = back to that zone's root view
    if (tab === 'assets' && ui.assetsView.name !== 'overview') {
      replaceRoute({ assetsView: { name: 'overview' } }, { direction: 'back' });
    } else if (tab === 'ledger' && ui.ledgerId) {
      replaceRoute({ ledgerId: null, planDetailId: null, ledgerHistoryLimit: 30 }, { direction: 'back' });
    } else {
      renderCurrentPage();
    }
    return;
  }
  const dir = TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(ui.tab) ? 'forward' : 'back';
  replaceRoute({ tab, activityDetailId: null, planDetailId: null }, { direction: dir });
}

let historyDepth = 0;
let historyReady = false;

function routeSnapshot(source = ui) {
  return {
    tab: source.tab,
    assetsView: structuredClone(source.assetsView),
    ledgerId: source.ledgerId || null,
    ledgerSegment: source.ledgerSegment,
    activityDetailId: source.activityDetailId || null,
    activityAccountId: source.activityAccountId || null,
    activityFilter: source.activityFilter,
    activityQuery: source.activityQuery,
    activityMonth: source.activityMonth,
    planDetailId: source.planDetailId || null,
  };
}

let activeOverlayHistory = null;
let overlayHistoryHandler = null;

export function registerOverlayHistoryHandler(handler) {
  overlayHistoryHandler = handler;
}

export function pushOverlayHistory(overlay) {
  const token = overlay.token || `overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entry = { ...structuredClone(overlay), token };
  const nextDepth = historyDepth + 1;
  const route = routeSnapshot();
  const url = new URL(routeURL(route), location.origin);
  if (entry.kind === 'record-detail' && entry.transactionId) url.searchParams.set('transaction', entry.transactionId);
  history.pushState({ ringgitme: true, depth: nextDepth, route, overlay: entry }, '', `${url.pathname}${url.search}`);
  historyDepth = nextDepth;
  activeOverlayHistory = entry;
  return entry;
}

export function closeOverlayHistory(token) {
  if (!activeOverlayHistory || (token && activeOverlayHistory.token !== token)) return false;
  if (history.state?.overlay?.token === activeOverlayHistory.token) history.back();
  else {
    const previous = activeOverlayHistory;
    activeOverlayHistory = null;
    overlayHistoryHandler?.({ action: 'close', overlay: previous });
  }
  return true;
}

function routeURL(route) {
  const url = new URL(location.href);
  const presentationQuery = new URLSearchParams();
  PRESENTATION_QUERY_KEYS.forEach((key) => {
    if (url.searchParams.has(key)) presentationQuery.set(key, url.searchParams.get(key));
  });
  url.search = '';
  presentationQuery.forEach((value, key) => url.searchParams.set(key, value));
  if (route.tab !== 'today') url.searchParams.set('tab', route.tab);
  if (route.tab === 'assets' && route.assetsView?.name === 'category') url.searchParams.set('view', route.assetsView.type);
  if (route.tab === 'assets' && route.assetsView?.name === 'detail') {
    url.searchParams.set('view', 'detail');
    url.searchParams.set('acc', route.assetsView.accountId);
    if (route.assetsView.from) url.searchParams.set('from', route.assetsView.from);
  }
  if (route.tab === 'ledger' && route.ledgerId) url.searchParams.set('ledgerId', route.ledgerId);
  if (route.activityDetailId) url.searchParams.set('transaction', route.activityDetailId);
  if (route.planDetailId) url.searchParams.set('plan', route.planDetailId);
  return `${url.pathname}${url.search}`;
}

function commitRoute(patch, { replace = false, direction = 'forward' } = {}) {
  const route = routeSnapshot({ ...ui, ...patch });
  const nextDepth = replace ? historyDepth : historyDepth + 1;
  history[replace ? 'replaceState' : 'pushState']({ ringgitme: true, depth: nextDepth, route }, '', routeURL(route));
  historyDepth = nextDepth;
  update({ ...patch, navDirection: direction });
}

export function pushRoute(patch, options = {}) { commitRoute(patch, { ...options, replace: false }); }
export function replaceRoute(patch, options = {}) { commitRoute(patch, { ...options, replace: true }); }

export function backOr(fallbackPatch) {
  if (history.state?.ringgitme && historyDepth > 0) history.back();
  else replaceRoute(fallbackPatch, { direction: 'back' });
}

export function initializeNavigationHistory() {
  if (historyReady) return;
  historyReady = true;
  historyDepth = Number(history.state?.ringgitme ? history.state.depth : 0) || 0;
  history.replaceState({ ringgitme: true, depth: historyDepth, route: routeSnapshot() }, '', routeURL(routeSnapshot()));
  window.addEventListener('popstate', (event) => {
    if (!event.state?.ringgitme) return;
    const nextDepth = Number(event.state.depth || 0);
    const direction = nextDepth < historyDepth ? 'back' : 'forward';
    const targetOverlay = event.state.overlay || null;
    if (activeOverlayHistory?.token !== targetOverlay?.token) {
      const previousOverlay = activeOverlayHistory;
      activeOverlayHistory = targetOverlay;
      historyDepth = nextDepth;
      if (previousOverlay) overlayHistoryHandler?.({ action: 'close', overlay: previousOverlay });
      if (targetOverlay) overlayHistoryHandler?.({ action: 'open', overlay: targetOverlay });
      return;
    }
    historyDepth = nextDepth;
    closeSheet(true);
    update({ ...event.state.route, navDirection: direction });
  });
}

let contentEl = null;

export function mountContent(el) {
  contentEl = el;
}

export function renderCurrentPage() {
  if (!contentEl) return;
  const renderFn = pages.get(ui.tab);
  if (!renderFn) return;
  contentEl.scrollTop = 0;
  contentEl.classList.remove('page-enter', 'page-back');
  // restart CSS animation
  void contentEl.offsetWidth;
  contentEl.classList.add('page-enter');
  if (ui.navDirection === 'back') contentEl.classList.add('page-back');
  renderFn(contentEl);
}
