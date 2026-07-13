// ============================================================
// MoneyPulse — the single hero number (blueprint §13/§14.1).
// One 44px amount per page; switchable hero state via swipe,
// tap, or dots. Animated count-up (480ms) with reduced-motion
// fallback to a plain swap.
// ============================================================

import { fmtRM } from '../app/format.js';
import { ui, update } from '../app/state.js';

export const HERO_STATES = [
  { id: 'currentCash', label: '当前现金' },
  { id: 'netAssets', label: '净资产' },
  { id: 'totalDebt', label: '总负债' },
  { id: 'netDebt', label: '净负债' },
];

let lastShown = new Map(); // heroId -> last animated value

export function renderMoneyPulse(pulse) {
  const st = HERO_STATES[ui.heroIndex];
  const value = pulse[st.id];
  const cls = st.id === 'netAssets' && value < 0 ? 'amt-neg' : '';
  return `
    <section class="pulse section" data-action="pulse-cycle" role="button" aria-label="切换主状态：${st.label}">
      <div class="pulse-label caption">${st.label}</div>
      <div class="pulse-amount num ${cls}" data-pulse-amount data-hero="${st.id}" data-value="${value}">
        ${fmtRM(value, { privacy: ui.privacy })}
      </div>
      <div class="pulse-dots" aria-hidden="true">
        ${HERO_STATES.map((s, i) => `<span class="${i === ui.heroIndex ? 'on' : ''}"></span>`).join('')}
      </div>
    </section>
  `;
}

export function activateMoneyPulse(container) {
  const amountEl = container.querySelector('[data-pulse-amount]');
  if (amountEl && !ui.privacy) animateAmount(amountEl);
  attachSwipe(container.querySelector('.pulse'));
}

function animateAmount(el) {
  const target = Number(el.dataset.value);
  const heroId = el.dataset.hero;
  const from = lastShown.has(heroId) ? lastShown.get(heroId) : 0;
  lastShown.set(heroId, target);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === target) return;
  const start = performance.now();
  const dur = 480;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = fmtRM(from + (target - from) * ease(p));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function attachSwipe(el) {
  if (!el) return;
  let startX = null;
  el.addEventListener('pointerdown', (e) => (startX = e.clientX));
  el.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 36) {
      const dir = dx < 0 ? 1 : -1;
      update({ heroIndex: (ui.heroIndex + dir + HERO_STATES.length) % HERO_STATES.length });
      // swipe consumed → suppress the click-cycle that follows
      el.dataset.swiped = '1';
      setTimeout(() => delete el.dataset.swiped, 250);
    }
  });
}

export function cycleHero(el) {
  if (el.dataset.swiped) return;
  update({ heroIndex: (ui.heroIndex + 1) % HERO_STATES.length });
}
