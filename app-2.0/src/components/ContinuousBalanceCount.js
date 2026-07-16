import { escapeHTML } from '../app/format.js';
import { formatMoneyMinor } from './MoneyCalculatorSheet.js';

export const CONTINUOUS_BALANCE_SAMPLE_COUNT = 42;

function clampProgress(progress) {
  return Math.max(0, Math.min(1, Number(progress) || 0));
}

export function continuousBalanceEase(progress) {
  const value = clampProgress(progress);
  return 1 - ((1 - value) ** 3);
}

export function continuousBalanceMinorAtProgress(startMinor, endMinor, progress) {
  const start = Math.trunc(Number(startMinor || 0));
  const end = Math.trunc(Number(endMinor || 0));
  if (progress <= 0 || start === end) return start;
  if (progress >= 1) return end;
  const candidate = start + Math.round((end - start) * continuousBalanceEase(progress));
  return end >= start
    ? Math.max(start, Math.min(end, candidate))
    : Math.min(start, Math.max(end, candidate));
}

export function continuousBalanceSequence(startMinor, endMinor, sampleCount = CONTINUOUS_BALANCE_SAMPLE_COUNT) {
  const count = Math.max(2, Math.min(60, Math.trunc(Number(sampleCount) || CONTINUOUS_BALANCE_SAMPLE_COUNT)));
  const values = [];
  for (let index = 0; index <= count; index += 1) {
    const value = continuousBalanceMinorAtProgress(startMinor, endMinor, index / count);
    if (values.at(-1) !== value) values.push(value);
  }
  const exactEnd = Math.trunc(Number(endMinor || 0));
  if (values.at(-1) !== exactEnd) values.push(exactEnd);
  return Object.freeze(values);
}

export function continuousBalanceCountHTML(startMinor, endMinor, currentMinor = startMinor) {
  const start = Math.trunc(Number(startMinor || 0));
  const end = Math.trunc(Number(endMinor || 0));
  const current = Math.trunc(Number(currentMinor || 0));
  const direction = end >= start ? 'increase' : 'decrease';
  return `<span class="continuous-balance-count num" data-continuous-balance-count data-start-minor="${start}" data-end-minor="${end}" data-current-minor="${current}" data-direction="${direction}" aria-live="off" aria-atomic="true" aria-label="${escapeHTML(`余额从 ${formatMoneyMinor(start)} 更新至 ${formatMoneyMinor(end)}`)}">${formatMoneyMinor(current)}</span>`;
}

const tickAnimations = new WeakMap();

export function setContinuousBalanceValue(element, minor, { animate = true } = {}) {
  if (!element) return;
  const next = Math.trunc(Number(minor || 0));
  const previous = Math.trunc(Number(element.dataset.currentMinor || next));
  if (previous === next && element.textContent === formatMoneyMinor(next)) return;
  element.dataset.currentMinor = String(next);
  element.textContent = formatMoneyMinor(next);
  if (!animate || typeof element.animate !== 'function') return;
  tickAnimations.get(element)?.cancel?.();
  const direction = element.dataset.direction === 'increase' ? 1 : -1;
  const animation = element.animate([
    { transform: `translateY(${direction * 3}px)`, opacity: .9 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { duration: 78, easing: 'cubic-bezier(.22,.78,.24,1)', fill: 'both' });
  tickAnimations.set(element, animation);
  animation.addEventListener?.('finish', () => tickAnimations.delete(element), { once: true });
  animation.addEventListener?.('cancel', () => tickAnimations.delete(element), { once: true });
}

export function startContinuousBalanceCount(element, {
  startMinor,
  endMinor,
  durationMs = 1190,
  sampleCount = CONTINUOUS_BALANCE_SAMPLE_COUNT,
  requestFrame = globalThis.requestAnimationFrame || ((callback) => setTimeout(() => callback(Date.now()), 16)),
  cancelFrame = globalThis.cancelAnimationFrame || clearTimeout,
  onUpdate,
  onComplete,
} = {}) {
  const start = Math.trunc(Number(startMinor || 0));
  const end = Math.trunc(Number(endMinor || 0));
  const steps = Math.max(2, Math.min(60, Math.trunc(Number(sampleCount) || CONTINUOUS_BALANCE_SAMPLE_COUNT)));
  let frameId = null;
  let startTime = null;
  let lastBucket = -1;
  let cancelled = false;
  setContinuousBalanceValue(element, start, { animate: false });

  const finish = () => {
    if (cancelled) return;
    element?.setAttribute?.('aria-live', 'polite');
    setContinuousBalanceValue(element, end, { animate: false });
    element?.setAttribute?.('aria-label', formatMoneyMinor(end));
    element?.setAttribute?.('data-settled', 'true');
    onUpdate?.(end);
    onComplete?.(end);
  };

  const tick = (timestamp) => {
    if (cancelled) return;
    if (startTime === null) startTime = Number(timestamp || 0);
    const elapsed = Math.max(0, Number(timestamp || 0) - startTime);
    const progress = Math.min(1, elapsed / Math.max(1, Number(durationMs || 1)));
    const bucket = progress >= 1 ? steps : Math.floor(progress * steps);
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      const value = continuousBalanceMinorAtProgress(start, end, bucket / steps);
      setContinuousBalanceValue(element, value, { animate: bucket > 0 && bucket < steps });
      onUpdate?.(value);
    }
    if (progress >= 1) finish();
    else frameId = requestFrame(tick);
  };

  frameId = requestFrame(tick);
  return () => {
    if (cancelled) return false;
    cancelled = true;
    if (frameId !== null) cancelFrame(frameId);
    tickAnimations.get(element)?.cancel?.();
    tickAnimations.delete(element);
    return true;
  };
}
