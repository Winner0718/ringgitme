// ============================================================
// RinggitMe 2.0 — entry point.
// Boot order: theme → shell → features → first render.
// Query params (?theme=dark&tab=assets) exist for preview and
// screenshot tooling only; they set initial UI state, nothing
// is persisted.
// ============================================================

import { mountShell } from './app/shell.js';
import { initializeNavigationHistory, renderCurrentPage } from './app/router.js';
import { data, ui, applyTheme, watchSystemTheme, applyChromeMotion, watchSystemMotion, dispatchAction } from './app/state.js';
import { registerTodayFeature } from './features/today/index.js';
import { registerAssetsFeature } from './features/assets/index.js';
import { registerCaptureFeature } from './features/capture/index.js';
import { registerActivityFeature } from './features/activity/index.js';
import { registerLedgerFeature } from './features/ledger/index.js';
import { openCaptureSheet } from './components/CaptureSheet.js';
import { openMoneyFlowConfirmation } from './components/MoneyFlowConfirmation.js';
import { buildConfirmationDebugPreview } from './components/ConfirmationDebugPreview.js';
import { openSplitComposerDebugPreview } from './components/SplitComposerDebugPreview.js';
import { mountDesignSystemLab } from './design-system/DesignSystemLab.js';

const params = new URLSearchParams(location.search);

// Screenshot-only deterministic override; no production control is exposed.
if (params.get('reducedMotion') === '1') document.documentElement.dataset.reducedMotion = 'true';
if (params.get('blurFallback') === '1') document.documentElement.dataset.blurFallback = 'true';

applyTheme(['light', 'dark'].includes(params.get('theme')) ? params.get('theme') : 'auto');
watchSystemTheme();
applyChromeMotion(params.get('chromeMotion') === '0' ? false : ui.chromeMotion);
watchSystemMotion();

const tab = params.get('tab');
if (['today', 'assets', 'activity', 'ledger'].includes(tab)) ui.tab = tab;
if (params.get('fixedCenter') === '1') {
  ui.tab = 'today';
  ui.todayView = 'fixed';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '')) ui.fixedMonth = params.get('month');
  if (['month', 'plans', 'history'].includes(params.get('view'))) ui.fixedWorkspace = params.get('view');
  if (['active', 'paused', 'stopped', 'archived'].includes(params.get('status'))) ui.fixedPlanStatus = params.get('status');
  if (['all', 'fixed', 'subscription', 'relationship', 'installment'].includes(params.get('type'))) ui.fixedPlanType = params.get('type');
  if (['all', 'completed', 'overdue', 'skipped'].includes(params.get('history'))) ui.fixedHistoryFilter = params.get('history');
}

// Assets sub-views: ?view=saving|cc|ew (category) or ?view=detail&acc=<id>
const view = params.get('view');
if (params.get('fixedCenter') !== '1' && ['saving', 'cc', 'ew'].includes(view)) {
  ui.tab = 'assets';
  ui.assetsView = { name: 'category', type: view };
} else if (params.get('fixedCenter') !== '1' && view === 'detail' && params.get('acc')) {
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
applyChromeMotion(ui.chromeMotion);

registerTodayFeature();
registerAssetsFeature();
registerCaptureFeature();
registerActivityFeature();
registerLedgerFeature();

renderCurrentPage();

// Internal QA route only. The Lab mounts the actual production components
// after their normal action contracts have registered, and never appears in
// customer navigation.
if (params.get('designSystem') === '1') mountDesignSystemLab(document.getElementById('app'));

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
