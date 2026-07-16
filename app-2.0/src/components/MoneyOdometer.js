import { escapeHTML } from '../app/format.js';
import { formatMoneyMinor } from './MoneyCalculatorSheet.js';

export const MONEY_REEL_STAGGER_MS = 72;
export const MONEY_REEL_MAX_STAGGER_ORDER = 3;

function numericText(minor) {
  return formatMoneyMinor(minor).replace(/^RM\s*/, '');
}

function glyphKind(before, after) {
  if (before === after) return 'stable';
  if (/\d/.test(before) && /\d/.test(after)) return 'reel';
  if (before === ' ' && /\d/.test(after)) return 'enter';
  if (/\d/.test(before) && after === ' ') return 'exit';
  return 'transition';
}

export function moneyOdometerModel(beforeMinor, afterMinor) {
  const beforeText = numericText(beforeMinor);
  const afterText = numericText(afterMinor);
  const width = Math.max(beforeText.length, afterText.length);
  const before = beforeText.padStart(width, ' ');
  const after = afterText.padStart(width, ' ');
  const baseGlyphs = [...after].map((next, index) => ({
    before: before[index],
    after: next,
    kind: glyphKind(before[index], next),
    index,
  }));
  // A balance reads like a mechanical counter: the right-most changed wheel
  // starts first, then carries travel left with a short deterministic stagger.
  const reelOrder = new Map(baseGlyphs
    .filter((glyph) => glyph.kind === 'reel')
    .map((glyph) => glyph.index)
    .reverse()
    .map((index, order) => [index, order]));
  return Object.freeze({
    beforeMinor: Number(beforeMinor || 0),
    afterMinor: Number(afterMinor || 0),
    beforeLabel: formatMoneyMinor(beforeMinor),
    afterLabel: formatMoneyMinor(afterMinor),
    direction: Number(afterMinor) >= Number(beforeMinor) ? 'increase' : 'decrease',
    glyphs: Object.freeze(baseGlyphs.map((glyph) => Object.freeze({
      ...glyph,
      reelOrder: reelOrder.get(glyph.index) ?? -1,
    }))),
  });
}

function reelGlyph(glyph) {
  const delay = Math.min(glyph.reelOrder, MONEY_REEL_MAX_STAGGER_ORDER) * MONEY_REEL_STAGGER_MS;
  return `<span class="money-reel-slot motion-digit changed" data-money-reel data-reel-order="${glyph.reelOrder}" data-from="${escapeHTML(glyph.before)}" data-to="${escapeHTML(glyph.after)}" style="--money-reel-delay:${delay}ms"><span class="money-reel-track"><i class="money-reel-old">${escapeHTML(glyph.before)}</i><i class="money-reel-new">${escapeHTML(glyph.after)}</i></span></span>`;
}

function transitionGlyph(glyph) {
  const className = glyph.kind === 'enter' ? 'entering' : glyph.kind === 'exit' ? 'leaving' : 'punctuation-transition';
  return `<span class="money-glyph-transition motion-digit ${className}" data-from="${escapeHTML(glyph.before)}" data-to="${escapeHTML(glyph.after)}"><i>${escapeHTML(glyph.before)}</i><i>${escapeHTML(glyph.after)}</i></span>`;
}

export function moneyOdometerHTML(beforeMinor, afterMinor) {
  const model = moneyOdometerModel(beforeMinor, afterMinor);
  return `<span class="money-odometer motion-odometer-overlay num" data-money-odometer data-direction="${model.direction}" aria-label="${escapeHTML(`${model.beforeLabel} 到 ${model.afterLabel}`)}"><span class="money-odometer-prefix">RM&nbsp;</span><span class="money-odometer-number">${model.glyphs.map((glyph) => {
    if (glyph.kind === 'reel') return reelGlyph(glyph);
    if (glyph.kind === 'stable') return `<span class="motion-digit stable${glyph.after === ' ' ? ' space' : ''}">${escapeHTML(glyph.after)}</span>`;
    return transitionGlyph(glyph);
  }).join('')}</span></span>`;
}

export function staticMoneyBalanceHTML(minor, { reducedCrossfade = false } = {}) {
  return `<span class="motion-static-balance num${reducedCrossfade ? ' reduced-crossfade' : ''}" data-motion-static-balance>${formatMoneyMinor(minor)}</span>`;
}
