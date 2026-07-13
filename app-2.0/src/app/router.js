// ============================================================
// Router — five-zone tab navigation. Each feature registers a
// render(container) function; Capture is a sheet, not a page.
// ============================================================

import { ui, update } from './state.js';

const pages = new Map();
const TAB_ORDER = ['today', 'assets', 'activity', 'ledger'];

export function registerPage(name, renderFn) {
  pages.set(name, renderFn);
}

export function navigate(tab) {
  if (tab === ui.tab) {
    // re-tap active tab = back to that zone's root view
    if (tab === 'assets' && ui.assetsView.name !== 'overview') {
      update({ assetsView: { name: 'overview' }, navDirection: 'back' });
    } else if (tab === 'ledger' && ui.ledgerPersonId) {
      update({ ledgerPersonId: null, ledgerHistoryLimit: 30, navDirection: 'back' });
    } else {
      renderCurrentPage();
    }
    return;
  }
  const dir = TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(ui.tab) ? 'forward' : 'back';
  update({ tab, navDirection: dir });
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
