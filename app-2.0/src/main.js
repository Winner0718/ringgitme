// ============================================================
// RinggitMe 2.0 — entry point.
// Boot order: theme → shell → features → first render.
// Query params (?theme=dark&tab=assets) exist for preview and
// screenshot tooling only; they set initial UI state, nothing
// is persisted.
// ============================================================

import { mountShell } from './app/shell.js';
import { initializeNavigationHistory, renderCurrentPage } from './app/router.js';
import { data, ui, applyTheme, watchSystemTheme, dispatchAction } from './app/state.js';
import { registerTodayFeature } from './features/today/index.js';
import { registerAssetsFeature } from './features/assets/index.js';
import { registerCaptureFeature } from './features/capture/index.js';
import { registerActivityFeature } from './features/activity/index.js';
import { registerLedgerFeature } from './features/ledger/index.js';
import { openCaptureSheet } from './components/CaptureSheet.js';
import { openMoneyFlowConfirmation } from './components/MoneyFlowConfirmation.js';
import { buildConfirmationDebugPreview } from './components/ConfirmationDebugPreview.js';
import { openSplitComposerDebugPreview } from './components/SplitComposerDebugPreview.js';

const params = new URLSearchParams(location.search);

// Screenshot-only deterministic override; no production control is exposed.
if (params.get('reducedMotion') === '1') document.documentElement.dataset.reducedMotion = 'true';

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

// Ledger sub-views: ?ledger=group or ?ledgerId=<id>
if (['group', 'groups'].includes(params.get('ledger'))) {
  ui.tab = 'ledger';
  ui.ledgerSegment = 'group';
}
if (params.get('ledgerId')) {
  ui.tab = 'ledger';
  ui.ledgerId = params.get('ledgerId');
}
if (params.get('transaction')) {
  ui.tab = 'activity';
  ui.activityDetailId = params.get('transaction');
}
if (params.get('plan')) {
  ui.tab = 'ledger';
  ui.planDetailId = params.get('plan');
}

initializeNavigationHistory();

mountShell(document.getElementById('app'));

registerTodayFeature();
registerAssetsFeature();
registerCaptureFeature();
registerActivityFeature();
registerLedgerFeature();

renderCurrentPage();

if (params.get('capture') === '1') {
  openCaptureSheet();
  if (params.get('more') === '1') dispatchAction('cap-open-details', document.body, null);
}
if (params.get('profile') === '1') dispatchAction('open-profile', document.body, null);

const confirmationDemo = params.get('confirmationDemo');
if (['expense', 'income', 'transfer', 'credit', 'ewallet', 'grabpay', 'record', 'otherpayer', 'userpaid', 'directdebt', 'received', 'repayment', 'monthly', 'instalment'].includes(confirmationDemo)) {
  openMoneyFlowConfirmation({ confirmation: buildConfirmationDebugPreview(data, confirmationDemo) });
}
if (params.get('splitComposerDemo')) openSplitComposerDebugPreview(params.get('splitComposerDemo'));
