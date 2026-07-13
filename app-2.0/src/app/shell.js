// ============================================================
// App shell — top chrome (G3), content area, tab bar, sheet
// host, and the single delegated event listener (no inline
// handlers anywhere in the app).
// ============================================================

import { ui, update, subscribe, dispatchAction, registerAction, applyTheme } from './state.js';
import { mountContent, renderCurrentPage, navigate } from './router.js';
import { renderTabBar, updateTabBar } from '../components/GlassTabBar.js';
import { mountSheetHost, openSheet, closeSheet, toast } from '../components/AppSheet.js';
import { icon } from '../components/Icons.js';

const TITLES = { today: '今天', assets: '资产', activity: '动态', ledger: '账本' };
const CATEGORY_TITLES = { saving: '储蓄卡', cc: '信用卡', ew: 'eWallet' };

// Topbar spec per current view: title, back affordance, eye, menu
function topbarSpec() {
  if (ui.tab === 'assets' && ui.assetsView.name === 'category') {
    return { title: CATEGORY_TITLES[ui.assetsView.type], back: true, eye: true, menu: true };
  }
  if (ui.tab === 'assets' && ui.assetsView.name === 'detail') {
    return { title: '账户详情', back: true, eye: true, menu: true };
  }
  return { title: TITLES[ui.tab] || 'RinggitMe', back: false, eye: ui.tab === 'today' || ui.tab === 'assets', menu: false };
}

let topbarEl = null;
let tabbarEl = null;
let contentEl = null;

export function mountShell(root) {
  root.innerHTML = '';

  topbarEl = document.createElement('header');
  topbarEl.className = 'topbar glass-chrome';
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
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
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
  topbarEl.innerHTML = `
    <div class="topbar-lead">
      ${spec.back ? `<button class="topbar-btn" data-action="assets-back" aria-label="返回">${icon('chevronLeft', 22)}</button>` : ''}
      <h1 class="topbar-title">${spec.title}</h1>
    </div>
    <div class="topbar-actions">
      ${spec.eye ? `<button class="topbar-btn" data-action="toggle-privacy" aria-label="${ui.privacy ? '显示金额' : '隐藏金额'}" aria-pressed="${ui.privacy}">
        ${icon(ui.privacy ? 'eyeOff' : 'eye')}
      </button>` : ''}
      <button class="topbar-avatar" data-action="open-profile" aria-label="个人与设置">W</button>
      ${spec.menu ? `<button class="topbar-btn" data-action="page-menu" aria-label="更多操作">${icon('dots', 20)}</button>` : ''}
    </div>
  `;
}

function registerShellActions() {
  registerAction('nav-tab', (el) => navigate(el.dataset.tab));

  registerAction('toggle-privacy', () => update({ privacy: !ui.privacy }));

  registerAction('open-profile', () => {
    openSheet({
      title: '我的',
      contentHTML: `
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
      `,
    });
  });

  registerAction('page-menu', () => toast('此功能暂未开放'));

  registerAction('set-theme', (el) => {
    applyTheme(el.dataset.themeValue);
    update({});
    closeSheet();
  });

  registerAction('sheet-close', () => closeSheet());
}
