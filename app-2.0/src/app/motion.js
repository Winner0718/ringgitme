// RinggitMe motion contract. Components consume these shared values instead
// of inventing local timings, and reduced motion keeps every state visible.
export const MOTION = Object.freeze({
  pressMs: 110,
  listMs: 210,
  sheetMs: 310,
  pageMs: 340,
  carouselMs: 360,
  confirmationMs: 2200,
  transferConfirmationMs: 3100,
  dragThresholdPx: 7,
  carouselDistanceRatio: 0.17,
  carouselVelocityPxMs: 0.42,
  edgeResistance: 0.24,
});

// The initial few pixels are deliberately undecided.  Once an axis wins it
// is never reconsidered, so a vertical page scroll cannot turn into a card
// swipe halfway through the gesture.
export function carouselGestureAxis(dx, dy, { threshold = MOTION.dragThresholdPx, ratio = 1.25 } = {}) {
  if (Math.hypot(dx, dy) < threshold) return 'pending';
  return Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * ratio ? 'horizontal' : 'vertical';
}

export function prefersReducedMotion(target = globalThis) {
  return Boolean(target?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function motionDuration(name, target = globalThis) {
  return prefersReducedMotion(target) ? 1 : MOTION[name] || MOTION.listMs;
}

export function resistedCarouselPosition(position, count, resistance = MOTION.edgeResistance) {
  if (position < 0) return position * resistance;
  const last = Math.max(0, count - 1);
  if (position > last) return last + (position - last) * resistance;
  return position;
}

export function carouselTarget({ index, count, deltaPx, velocityPxMs, widthPx }) {
  const distancePassed = Math.abs(deltaPx) >= Math.max(26, widthPx * MOTION.carouselDistanceRatio);
  const velocityPassed = Math.abs(velocityPxMs) >= MOTION.carouselVelocityPxMs;
  if (!distancePassed && !velocityPassed) return index;
  const direction = deltaPx < 0 || (Math.abs(deltaPx) < 8 && velocityPxMs < 0) ? 1 : -1;
  return Math.max(0, Math.min(count - 1, index + direction));
}

export function nextFrame(callback) {
  return (globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(callback);
}

export function runSharedCardTransition(source) {
  if (!source?.getBoundingClientRect || prefersReducedMotion() || typeof document === 'undefined') return;
  const rect = source.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const app = document.getElementById('app');
  const appRect = app?.getBoundingClientRect?.() || { left: 0, width: innerWidth };
  const clone = source.cloneNode(true);
  clone.removeAttribute?.('data-action');
  clone.className = `${clone.className || ''} shared-card-ghost`;
  Object.assign(clone.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.appendChild(clone);
  const targetWidth = Math.min(320, appRect.width * .76);
  const scale = targetWidth / rect.width;
  const x = appRect.left + (appRect.width - rect.width) / 2 - rect.left;
  const y = Math.max(72, rect.top - Math.min(120, rect.top - 72)) - rect.top;
  const animation = clone.animate?.([
    { transform: 'translate3d(0,0,0) scale(1)', opacity: .94 },
    { transform: `translate3d(${x}px,${y}px,0) scale(${scale})`, opacity: 0 },
  ], { duration: MOTION.pageMs, easing: 'cubic-bezier(.22,.82,.24,1)', fill: 'forwards' });
  if (animation) {
    animation.addEventListener('finish', () => clone.remove(), { once: true });
    animation.addEventListener('cancel', () => clone.remove(), { once: true });
  }
  else setTimeout(() => clone.remove(), MOTION.pageMs);
}
