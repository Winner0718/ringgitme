// ============================================================
// GlassTabBar — floating Liquid Glass bottom bar (G3).
// Four zones + central Capture button. Safe-area aware.
// ============================================================

import { icon } from './Icons.js';
import { ui } from '../app/state.js';

const TABS = [
  { id: 'today', label: '今天', icon: 'today' },
  { id: 'assets', label: '资产', icon: 'assets' },
  { id: '__capture', label: '捕捉', icon: 'plus', capture: true },
  { id: 'activity', label: '动态', icon: 'activity' },
  { id: 'ledger', label: '账本', icon: 'ledger' },
];

export function renderTabBar(parent) {
  const nav = document.createElement('nav');
  nav.className = 'tabbar glass-chrome';
  nav.setAttribute('aria-label', '主导航');
  parent.appendChild(nav);
  updateTabBar(nav);
  return nav;
}

export function updateTabBar(nav) {
  nav.innerHTML = TABS.map((t) => {
    if (t.capture) {
      return `<div class="tab-capture-wrap">
        <button class="tab-capture" data-action="open-capture" aria-label="捕捉">
          ${icon('plus', 24)}
        </button>
        <span class="tab-capture-label">${t.label}</span>
      </div>`;
    }
    const active = ui.tab === t.id;
    return `<button class="tab-item${active ? ' active' : ''}" data-action="nav-tab" data-tab="${t.id}"
      aria-label="${t.label}" ${active ? 'aria-current="page"' : ''}>
      ${icon(t.icon, 22)}
      <span>${t.label}</span>
    </button>`;
  }).join('');
}
