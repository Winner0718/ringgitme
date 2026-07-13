// ============================================================
// RinggitMe 2.0 — entry point.
// Boot order: theme → shell → features → first render.
// Query params (?theme=dark&tab=assets) exist for preview and
// screenshot tooling only; they set initial UI state, nothing
// is persisted.
// ============================================================

import { mountShell } from './app/shell.js';
import { renderCurrentPage } from './app/router.js';
import { ui, applyTheme, watchSystemTheme, dispatchAction } from './app/state.js';
import { registerTodayFeature } from './features/today/index.js';
import { registerAssetsFeature } from './features/assets/index.js';
import { registerCaptureFeature } from './features/capture/index.js';
import { registerActivityFeature } from './features/activity/index.js';
import { registerLedgerFeature } from './features/ledger/index.js';
import { openCaptureSheet } from './components/CaptureSheet.js';

const params = new URLSearchParams(location.search);

applyTheme(['light', 'dark'].includes(params.get('theme')) ? params.get('theme') : 'auto');
watchSystemTheme();

const tab = params.get('tab');
if (['today', 'assets', 'activity', 'ledger'].includes(tab)) ui.tab = tab;

// Assets sub-views: ?view=saving|cc|ew (category) or ?view=detail&acc=<id>
const view = params.get('view');
if (['saving', 'cc', 'ew'].includes(view)) {
  ui.tab = 'assets';
  ui.assetsView = { name: 'category', type: view };
} else if (view === 'detail' && params.get('acc')) {
  ui.tab = 'assets';
  ui.assetsView = { name: 'detail', accountId: params.get('acc'), from: 'category' };
}

// Ledger sub-views: ?ledger=groups or ?person=<id>
if (params.get('ledger') === 'groups') {
  ui.tab = 'ledger';
  ui.ledgerSegment = 'groups';
}
if (params.get('person')) {
  ui.tab = 'ledger';
  ui.ledgerPersonId = params.get('person');
}

mountShell(document.getElementById('app'));

registerTodayFeature();
registerAssetsFeature();
registerCaptureFeature();
registerActivityFeature();
registerLedgerFeature();

renderCurrentPage();

if (params.get('capture') === '1') {
  openCaptureSheet();
  if (params.get('more') === '1') dispatchAction('cap-more', document.body, null);
}
if (params.get('profile') === '1') dispatchAction('open-profile', document.body, null);
