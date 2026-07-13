// ============================================================
// CardCarousel — shared horizontal card carousel: one selected
// card centered, neighbours peeking both sides, pointer-drag or
// tap to change selection, page dots. Used by 储蓄卡页面,
// 信用卡页面 and 账户详情 (same-category swipe only).
// ============================================================

import { ui } from '../app/state.js';
import { fmtRM, escapeHTML } from '../app/format.js';

const TYPE_BADGE = { cc: '信用卡', saving: '储蓄', ew: 'eWallet' };

export function renderCardFace(a, { showAmount = true } = {}) {
  const amount = a.type === 'cc' ? -a.outstanding : a.balance;
  const overlay = `
    <span class="face-digits num">${a.last4 ? `•••• ${a.last4}` : escapeHTML(a.short)}</span>
    ${showAmount ? `<span class="face-amount num">${a.type === 'cc' ? '−' : ''}${fmtRM(Math.abs(amount), { privacy: ui.privacy })}</span>` : ''}
  `;
  if (a.art) {
    return `<img src="${a.art}" alt="" draggable="false" />
      <span class="deck-badge">${TYPE_BADGE[a.type]}</span>
      <div class="face-overlay">${overlay}</div>`;
  }
  return `<div class="deck-fallback" style="--brand:${a.brandColor || 'var(--emerald-800)'}">
      <span class="deck-fallback-name">${escapeHTML(a.name)}</span>
      <span class="deck-fallback-bank">${escapeHTML(a.bank)}</span>
      <span class="deck-badge">${TYPE_BADGE[a.type]}</span>
      <div class="face-overlay">${overlay}</div>
    </div>`;
}

// variant 'category' (default): neighbours stay clearly exposed with
// their content visible — the approved category-page look.
// variant 'detail': neighbours peek as clean card edges; their text/
// amounts never intrude on the centred card (账户详情 reference).
export function renderCarousel(items, index, { selectAction = 'carousel-select', variant = 'category' } = {}) {
  return `
    <div class="deck-viewport${variant === 'detail' ? ' detail-peek' : ''}" data-carousel
      data-count="${items.length}" data-variant="${variant}">
      <div class="deck-stage">
        ${items.map((a, i) => {
          const label = i === index
            ? (variant === 'detail' ? escapeHTML(a.name) : `查看 ${escapeHTML(a.name)} 账户详情`)
            : `选择 ${escapeHTML(a.name)}`;
          return `
          <button class="deck-card" data-deck-card="${i}" data-action="${selectAction}" data-index="${i}" data-acc="${a.id}"
            aria-label="${label}">${renderCardFace(a)}</button>`;
        }).join('')}
      </div>
    </div>
    <div class="deck-dots" aria-hidden="true">
      ${items.map((_, i) => `<span class="${i === index ? 'on' : ''}"></span>`).join('')}
    </div>
  `;
}

function layout(stage, pos, count, variant) {
  const step = variant === 'detail' ? 15 : 18; // % of card width per position
  const selectedIndex = Math.round(pos);
  stage.querySelectorAll('[data-deck-card]').forEach((el, i) => {
    const d = i - pos;
    const abs = Math.min(Math.abs(d), 3);
    const x = d * step;
    const scale = 1 - abs * (variant === 'detail' ? 0.06 : 0.09);
    el.style.transform = `translateX(${x}%) scale(${scale})`;
    el.style.zIndex = 100 - Math.round(abs * 10);
    const hidden = variant === 'detail' ? abs > 1.25 : abs >= 2.4;
    el.style.opacity = hidden ? 0 : 1 - abs * 0.28;
    el.style.pointerEvents = hidden ? 'none' : '';
    el.classList.toggle('front', selectedIndex === i);
    el.classList.toggle('before', i < selectedIndex);
    el.classList.toggle('after', i > selectedIndex);
  });
}

// Attach after HTML is in the DOM. onChange(newIndex) fires after a
// completed drag; taps on cards go through the data-action.
// Click-versus-drag discrimination: pointer travel beyond
// DRAG_THRESHOLD (CSS px) marks the gesture as a drag, and the click
// that follows a drag is swallowed so navigation never fires from a
// swipe. A genuine short tap (touch, mouse, or Enter/Space on the
// focused card) still activates the data-action.
const DRAG_THRESHOLD = 10;

export function activateCarousel(container, index, onChange) {
  const viewport = container.querySelector('[data-carousel]');
  if (!viewport) return;
  const count = Number(viewport.dataset.count);
  const variant = viewport.dataset.variant || 'category';
  const stage = viewport.querySelector('.deck-stage');
  layout(stage, index, count, variant);

  let startX = null;
  let startY = null;
  let activePointerId = null;
  let dragPos = index;
  let dragging = false;
  const width = () => viewport.clientWidth * 0.6;

  viewport.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    startX = e.clientX;
    startY = e.clientY;
    activePointerId = e.pointerId;
    dragPos = index;
    dragging = false;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (startX === null || e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD && !dragging) {
      dragging = true;
      stage.classList.add('dragging');
      // Capture only after the gesture is known to be a drag. Capturing
      // on pointerdown retargets a genuine tap's click to the viewport,
      // so the centred card's delegated data-action never receives it.
      if (Math.abs(dx) >= Math.abs(dy)) viewport.setPointerCapture(e.pointerId);
    }
    if (dragging) {
      dragPos = clamp(index - dx / width(), -0.4, count - 0.6);
      layout(stage, dragPos, count, variant);
    }
  });
  const release = (e) => {
    if (startX === null || e.pointerId !== activePointerId) return;
    startX = null;
    startY = null;
    activePointerId = null;
    stage.classList.remove('dragging');
    const target = clamp(Math.round(dragPos), 0, count - 1);
    if (dragging && target !== index) onChange(target);
    else layout(stage, index, count, variant);
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== activePointerId) return;
    startX = null;
    startY = null;
    activePointerId = null;
    dragging = false;
    stage.classList.remove('dragging');
    layout(stage, index, count, variant);
  });

  // A completed drag must not also fire the tap action
  viewport.addEventListener('click', (e) => {
    if (dragging) {
      e.stopPropagation();
      e.preventDefault();
      dragging = false;
    }
  }, true);

  // Explicit keyboard activation for focused cards (Enter / Space).
  // preventDefault stops the browser's own button activation so the
  // action fires exactly once on every engine.
  viewport.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-deck-card]');
    if (!card) return;
    e.preventDefault();
    card.click();
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
