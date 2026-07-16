import { escapeHTML } from '../app/format.js';
import { prefersReducedMotion, nextFrame } from '../app/motion.js';
import { accountVisualCardHTML, bindAccountVisualFallbacks } from './AccountVisualCard.js';

const SETTLE_DELAY_MS = 130;
const RECENT_SCROLL_MS = 220;

export function nearestCenterIndex(scroller, cards = [...scroller.querySelectorAll('[data-snap-account-id]')]) {
  if (!cards.length) return 0;
  const center = scroller.scrollLeft + scroller.clientWidth / 2;
  let nearest = 0;
  let distance = Infinity;
  cards.forEach((card, index) => {
    const cardCenter = card.offsetLeft + card.offsetWidth / 2;
    const nextDistance = Math.abs(cardCenter - center);
    if (nextDistance < distance) { distance = nextDistance; nearest = index; }
  });
  return nearest;
}

export function centeredScrollLeft(scroller, card) {
  return Math.max(0, card.offsetLeft - (scroller.clientWidth - card.offsetWidth) / 2);
}

function requestedNativePosition(count) {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('carouselPosition');
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= Math.max(0, count - 1) ? value : null;
}

export function renderNativeSnapCardCarousel(items, index, {
  selectAction = 'carousel-select',
  variant = 'category',
  carouselKey = variant,
} = {}) {
  const selected = items[index] || items[0];
  return `<div class="native-carousel-shell deck-viewport ${variant === 'detail' ? 'detail-peek' : ''}" data-native-snap-carousel data-carousel-key="${escapeHTML(carouselKey)}" data-selected-account-id="${escapeHTML(selected?.id || '')}" data-count="${items.length}" data-variant="${escapeHTML(variant)}">
    <div class="native-carousel-scroller" data-carousel-scroller role="listbox" aria-label="账户卡片">
      ${items.map((account, cardIndex) => `<div class="native-snap-card deck-card${cardIndex === index ? ' is-centered' : ''}" data-snap-account-id="${escapeHTML(account.id)}" data-deck-card="${cardIndex}" data-action="${selectAction}" data-index="${cardIndex}" data-acc="${escapeHTML(account.id)}" role="option" tabindex="0" aria-selected="${cardIndex === index}" aria-label="${cardIndex === index ? `打开 ${escapeHTML(account.name)}` : `选择 ${escapeHTML(account.name)}`}">${accountVisualCardHTML(account, { variant: variant === 'overview' ? 'compact' : variant })}</div>`).join('')}
    </div>
  </div>
  <div class="deck-dots" data-carousel-dots aria-label="账户位置">${items.map((account, cardIndex) => `<span class="${cardIndex === index ? 'on' : ''}" data-dot-account-id="${escapeHTML(account.id)}"></span>`).join('')}</div>`;
}

function updatePresentation(scroller, cards) {
  const center = scroller.scrollLeft + scroller.clientWidth / 2;
  const width = Math.max(1, cards[0]?.offsetWidth || scroller.clientWidth);
  cards.forEach((card) => {
    const distance = Math.min(1.35, Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) / width);
    card.style.setProperty('--center-distance', distance.toFixed(3));
    card.style.opacity = String(1 - Math.min(distance, 1) * .18);
  });
}

function updateSelectedPresentation(shell, cards, index) {
  const selectedId = cards[index]?.dataset.snapAccountId || '';
  shell.dataset.selectedAccountId = selectedId;
  cards.forEach((card, cardIndex) => {
    const active = cardIndex === index;
    card.classList.toggle('is-centered', active);
    card.setAttribute('aria-selected', String(active));
  });
  shell.parentElement?.querySelectorAll?.('[data-dot-account-id]').forEach((dot) => dot.classList.toggle('on', dot.dataset.dotAccountId === selectedId));
}

export function activateNativeSnapCardCarousel(container, index, onChange, { carouselKey } = {}) {
  const shell = carouselKey
    ? container.querySelector(`[data-native-snap-carousel][data-carousel-key="${carouselKey}"]`)
    : container.matches?.('[data-native-snap-carousel]') ? container : container.querySelector('[data-native-snap-carousel]');
  if (!shell || shell.dataset.activated === 'true') return () => {};
  shell.dataset.activated = 'true';
  const scroller = shell.querySelector('[data-carousel-scroller]');
  const cards = [...scroller.querySelectorAll('[data-snap-account-id]')];
  if (!cards.length) return () => {};
  let settledIndex = Math.max(0, Math.min(cards.length - 1, index));
  let settleTimer = 0;
  let recentScrollUntil = 0;
  let lastSettledLeft = 0;
  let destroyed = false;

  const debugPosition = requestedNativePosition(cards.length);
  // Screenshot-only pause: keep a real fractional scrollLeft instead of a
  // transform simulation. No control is exposed in the product interface.
  shell.classList.toggle('debug-scroll-position', debugPosition !== null);
  const initialPosition = debugPosition ?? settledIndex;
  const lower = Math.floor(initialPosition);
  const upper = Math.min(cards.length - 1, Math.ceil(initialPosition));
  const fraction = initialPosition - lower;
  const initialLeft = centeredScrollLeft(scroller, cards[lower]) * (1 - fraction) + centeredScrollLeft(scroller, cards[upper]) * fraction;
  scroller.scrollLeft = initialLeft;
  lastSettledLeft = initialLeft;
  updateSelectedPresentation(shell, cards, settledIndex);
  updatePresentation(scroller, cards);
  bindAccountVisualFallbacks(shell);
  nextFrame(() => { if (!destroyed) shell.classList.add('is-ready'); });

  const settle = () => {
    clearTimeout(settleTimer);
    if (destroyed || debugPosition !== null) return;
    const nextIndex = nearestCenterIndex(scroller, cards);
    lastSettledLeft = scroller.scrollLeft;
    updateSelectedPresentation(shell, cards, nextIndex);
    if (nextIndex === settledIndex) return;
    settledIndex = nextIndex;
    onChange?.(nextIndex, cards[nextIndex]?.dataset.snapAccountId);
  };
  const onScroll = () => {
    updatePresentation(scroller, cards);
    if (Math.abs(scroller.scrollLeft - lastSettledLeft) > 3) recentScrollUntil = performance.now() + RECENT_SCROLL_MS;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
  };
  const onClickCapture = (event) => {
    const card = event.target.closest('[data-snap-account-id]');
    if (!card) return;
    if (performance.now() < recentScrollUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const cardIndex = cards.indexOf(card);
    if (cardIndex === settledIndex) return;
    event.preventDefault();
    event.stopPropagation();
    scroller.scrollTo({ left: centeredScrollLeft(scroller, card), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  const onKeydown = (event) => {
    if (!['Enter', ' '].includes(event.key) || !event.target.closest('[data-snap-account-id]')) return;
    event.preventDefault();
    event.target.closest('[data-snap-account-id]').click();
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });
  scroller.addEventListener('scrollend', settle);
  scroller.addEventListener('click', onClickCapture, true);
  scroller.addEventListener('keydown', onKeydown);
  return () => {
    destroyed = true;
    clearTimeout(settleTimer);
    scroller.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('scrollend', settle);
    scroller.removeEventListener('click', onClickCapture, true);
    scroller.removeEventListener('keydown', onKeydown);
  };
}
