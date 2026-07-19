// ============================================================
// App shell — top chrome (G3), content area, tab bar, sheet
// host, and the single delegated event listener (no inline
// handlers anywhere in the app).
// ============================================================

import { data, ui, update, subscribe, dispatchAction, registerAction, applyTheme, applyChromeMotion } from './state.js';
import { mountContent, renderCurrentPage, navigate } from './router.js';
import { renderTabBar, updateTabBar } from '../components/GlassTabBar.js';
import { mountSheetHost, openSheet, closeSheet, toast } from '../components/AppSheet.js';
import { icon } from '../components/Icons.js';
import { triggerLiquidChromeInteraction } from '../design-system/DesignSystem.js';

const TITLES = { today: '今天', assets: '资产', activity: '动态', ledger: '账本' };
const CATEGORY_TITLES = { saving: '储蓄卡', cc: '信用卡', ew: 'eWallet' };

// Topbar spec per current view: title, back affordance, eye, menu
function topbarSpec() {
  if (ui.tab === 'today' && ui.todayView === 'fixed') {
    return { title: '固定与订阅', back: true, backAction: 'fixed-center-back', eye: true, menu: false };
  }
  if (ui.tab === 'assets' && ui.assetsView.name === 'category') {
    return { title: CATEGORY_TITLES[ui.assetsView.type], back: true, backAction: 'assets-back', eye: true, manage: true };
  }
  if (ui.tab === 'assets' && ui.assetsView.name === 'detail') {
    return { title: '账户详情', back: true, backAction: 'assets-back', eye: true, menuAction: 'asset-detail-menu' };
  }
  return { title: TITLES[ui.tab] || 'RinggitMe', back: false, eye: ui.tab === 'today' || ui.tab === 'assets', manage: ui.tab === 'assets' };
}

let topbarEl = null;
let tabbarEl = null;
let contentEl = null;
let appRootEl = null;

export function mountShell(root) {
  appRootEl = root;
  root.innerHTML = '';

  topbarEl = document.createElement('header');
  topbarEl.className = 'topbar glass-chrome rm-topbar';
  topbarEl.dataset.rmComponent = 'TopBar';
  root.appendChild(topbarEl);

  contentEl = document.createElement('main');
  contentEl.className = 'app-content';
  root.appendChild(contentEl);
  mountContent(contentEl);

  tabbarEl = renderTabBar(root);
  mountSheetHost(root);

  // Chrome opacity ramps in as content scrolls under it (§11.2)
  contentEl.addEventListener('scroll', () => {
    topbarEl.classList.toggle('scrolled', contentEl.scrollTop > 8);
  }, { passive: true });

  // One delegated listener for every data-action in the app
  root.addEventListener('click', (e) => {
    triggerLiquidChromeInteraction(e.target);
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    dispatchAction(el.dataset.action, el, e);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-action][role="button"]');
    if (!el || el.tagName === 'BUTTON' || el.disabled) return;
    e.preventDefault();
    dispatchAction(el.dataset.action, el, e);
  });

  registerShellActions();
  subscribe(() => {
    renderTopbar();
    updateTabBar(tabbarEl);
    renderCurrentPage();
  });

  renderTopbar();
}

function renderTopbar() {
  const spec = topbarSpec();
  appRootEl.dataset.rmPage = ui.tab;
  appRootEl.dataset.rmView = ui.tab === 'assets' ? ui.assetsView.name : ui.tab === 'today' ? ui.todayView : 'overview';
  topbarEl.innerHTML = `
    <div class="topbar-lead">
      ${spec.back ? `<button class="topbar-btn" data-action="${spec.backAction}" aria-label="返回">${icon('chevronLeft', 22)}</button>` : ''}
      <h1 class="topbar-title">${spec.title}</h1>
    </div>
    <div class="topbar-actions">
      ${spec.eye ? `<button class="topbar-btn" data-action="toggle-privacy" aria-label="${ui.privacy ? '显示金额' : '隐藏金额'}" aria-pressed="${ui.privacy}">
        ${icon(ui.privacy ? 'eyeOff' : 'eye')}
      </button>` : ''}
      ${spec.manage ? '<button class="topbar-text-action" data-action="assets-manage" aria-label="管理账户">管理</button>' : ''}
      <button class="topbar-avatar" data-action="open-profile" aria-label="个人与设置">W</button>
      ${spec.menuAction ? `<button class="topbar-btn" data-action="${spec.menuAction}" aria-label="账户更多操作">${icon('dots', 20)}</button>` : ''}
    </div>
  `;
}

function registerShellActions() {
  registerAction('nav-tab', (el) => navigate(el.dataset.tab));

  registerAction('toggle-privacy', () => update({ privacy: !ui.privacy }));

  registerAction('open-profile', () => {
    openSheet({
      id: 'profile-settings',
      title: '我的',
      className: 'profile-settings-sheet',
      detent: 'medium',
      contentHTML: profileSettingsHTML(),
      onOpen: syncProfileSettingsControls,
    });
  });

  registerAction('set-theme', (el) => {
    applyTheme(el.dataset.themeValue);
    syncProfileSettingsControls();
  });

  registerAction('toggle-chrome-motion', (el) => {
    applyChromeMotion(el.checked);
    syncProfileSettingsControls();
  });

  registerAction('open-demo-reset', () => {
    openSheet({
      title: '重置示例数据',
      className: 'profile-reset-confirm-sheet',
      detent: 'compact',
      stacked: true,
      contentHTML: `
        <div class="detail-hero">
          <div class="row-title">恢复到最初状态？</div>
          <div class="caption">你在这次使用中新增、编辑或删除的记录都会清除。</div>
        </div>
        <button class="sheet-primary" data-action="confirm-demo-reset">确认重置</button>
        <button class="sheet-secondary" data-action="sheet-close">取消</button>
      `,
    });
  });

  registerAction('confirm-demo-reset', () => {
    data.resetDemoData();
    closeSheet();
    update({
      tab: 'today',
      todayView: 'overview',
      fixedMonth: data.today.slice(0, 7),
      fixedWorkspace: 'month',
      fixedPlanStatus: 'active',
      fixedPlanType: 'all',
      fixedHistoryFilter: 'all',
      fixedCompletedExpanded: false,
      navDirection: 'back',
      assetsView: { name: 'overview' },
      categoryIndex: { saving: 0, cc: 0, ew: 0 },
      activityFilter: 'all',
      activityQuery: '',
      activityAccountId: null,
      activityMonth: '2026-07',
      highlightActivityId: null,
      ledgerSegment: 'personal',
      ledgerId: null,
      ledgerView: 'current',
      ledgerHistoryLimit: 30,
    });
    toast('示例数据已重置');
  });

  registerAction('sheet-close', () => closeSheet());
}

function profileSettingsHTML() {
  return `
        <div class="profile-head">
          <div class="profile-avatar">W</div>
          <div>
            <div class="profile-name">Winner</div>
            <div class="caption">个人资料与偏好</div>
          </div>
        </div>
        <div class="sheet-group">
          <div class="caption sheet-group-label">外观</div>
          <div class="segmented" role="radiogroup" aria-label="外观模式">
            ${['auto', 'light', 'dark'].map((t) => `
              <button class="seg-item${ui.theme === t ? ' active' : ''}" data-action="set-theme" data-theme-value="${t}" role="radio" aria-checked="${ui.theme === t}">
                ${{ auto: '自动', light: '浅色', dark: '深色' }[t]}
              </button>`).join('')}
          </div>
        </div>
        <div class="sheet-group profile-motion-group">
          <label class="rm-toggle-row profile-chrome-motion">
            <span>
              <strong>镀铬动效</strong>
              <small id="chrome-motion-caption">控制边框反射与流动高光</small>
            </span>
            <input type="checkbox" data-action="toggle-chrome-motion" aria-label="镀铬动效" aria-describedby="chrome-motion-caption" ${ui.chromeMotion ? 'checked' : ''} />
            <span class="rm-switch" aria-hidden="true"><i></i></span>
          </label>
        </div>
        <button class="sheet-secondary" data-action="open-demo-reset">重置示例数据</button>
  `;
}

function syncProfileSettingsControls(sheet = document.querySelector('.profile-settings-sheet')) {
  if (!sheet) return;
  sheet.querySelectorAll('[data-action="set-theme"]').forEach((button) => {
    const selected = button.dataset.themeValue === ui.theme;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  const toggle = sheet.querySelector('[data-action="toggle-chrome-motion"]');
  if (toggle) toggle.checked = ui.chromeMotion;
}
