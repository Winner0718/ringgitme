import { escapeHTML } from '../app/format.js';
import { icon } from '../components/Icons.js';

const INTERACTION_SWEEP_SELECTOR = [
  '.rm-button', '.sheet-primary', '.sheet-secondary', '.cap-save',
  '.calculator-key', '.capture-calculator-key', '.tab-capture',
  '.tab-item.active', '.seg-item.active', '.rm-segment.is-selected',
  '.rm-chip.is-selected', '.cap-cat.active', '.cap-acc.active',
  '.asset-account-row', '.rm-action-tile', '.recurring-action-card',
].join(',');

export function triggerLiquidChromeInteraction(source) {
  const target = source?.closest?.(INTERACTION_SWEEP_SELECTOR);
  if (!target || document.documentElement.dataset.chromeMotion !== 'on'
    || document.documentElement.dataset.reducedMotion === 'true'
    || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  target.classList.remove('rm-edge-sweep');
  requestAnimationFrame(() => {
    target.classList.add('rm-edge-sweep');
    target.addEventListener('animationend', () => target.classList.remove('rm-edge-sweep'), { once: true });
  });
}

function attrs(attributes = {}) {
  return Object.entries(attributes).map(([name, value]) => {
    if (!/^(?:data|aria)-[a-z0-9-]+$/.test(name)) throw new Error(`Unsupported design-system attribute: ${name}`);
    return ` ${name}="${escapeHTML(String(value))}"`;
  }).join('');
}

export function buttonHTML({ label, variant = 'primary', size = 'standard', iconName = '', disabled = false, loading = false, attributes = {} }) {
  const classes = `rm-button rm-chrome-edge rm-button--${variant} rm-button--${size}${variant === 'primary' ? ' rm-chrome-priority' : ''}${loading ? ' is-loading' : ''}`;
  return `<button type="button" class="${classes}"${disabled ? ' disabled aria-disabled="true"' : ''}${attrs(attributes)}>${loading ? '<span class="rm-spinner" aria-hidden="true"></span>' : iconName ? icon(iconName, 18) : ''}<span>${escapeHTML(label)}</span></button>`;
}

export function iconButtonHTML({ label, iconName, variant = 'standard', selected = false, attributes = {} }) {
  return `<button type="button" class="rm-icon-button rm-icon-button--${variant}${selected ? ' is-selected' : ''}" aria-label="${escapeHTML(label)}"${selected ? ' aria-pressed="true"' : ''}${attrs(attributes)}>${icon(iconName, 19)}</button>`;
}

export function surfaceHTML({ content, variant = 'solid', className = '' }) {
  return `<section class="rm-surface rm-surface--${variant} ${escapeHTML(className)}" data-rm-surface="${escapeHTML(variant)}">${content}</section>`;
}

export function fieldHTML({ label, name, value = '', placeholder = '', type = 'text', error = '', disabled = false, readonly = false }) {
  return `<label class="rm-field${error ? ' has-error' : ''}${disabled ? ' is-disabled' : ''}"><span class="rm-field-label">${escapeHTML(label)}</span><input class="rm-field-control" type="${escapeHTML(type)}" name="${escapeHTML(name)}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}"${disabled ? ' disabled' : ''}${readonly ? ' readonly aria-readonly="true"' : ''}/>${error ? `<span class="rm-field-error" role="alert">${escapeHTML(error)}</span>` : ''}</label>`;
}

export function toggleRowHTML({ label, caption = '', checked = false, disabled = false, name = '' }) {
  return `<label class="rm-toggle-row${disabled ? ' is-disabled' : ''}"><span><strong>${escapeHTML(label)}</strong>${caption ? `<small>${escapeHTML(caption)}</small>` : ''}</span><input type="checkbox" ${name ? `name="${escapeHTML(name)}" ` : ''}${checked ? 'checked ' : ''}${disabled ? 'disabled ' : ''}/><span class="rm-switch" aria-hidden="true"><i></i></span></label>`;
}

export function chipHTML({ label, variant = 'neutral', selected = false }) {
  return `<button type="button" class="rm-chip rm-chip--${escapeHTML(variant)}${selected ? ' is-selected' : ''}" aria-pressed="${selected}">${escapeHTML(label)}</button>`;
}

export function segmentedControlHTML({ label, items, selected }) {
  return `<div class="rm-segmented" role="radiogroup" aria-label="${escapeHTML(label)}">${items.map((item) => `<button type="button" class="rm-segment${item.value === selected ? ' is-selected' : ''}" role="radio" aria-checked="${item.value === selected}">${escapeHTML(item.label)}</button>`).join('')}</div>`;
}

export function actionTileHTML({ title, caption = '', iconName = 'note', tone = 'neutral' }) {
  return `<button type="button" class="rm-action-tile rm-action-tile--${escapeHTML(tone)}"><span class="rm-action-tile-icon">${icon(iconName, 20)}</span><span class="rm-action-tile-copy"><strong>${escapeHTML(title)}</strong>${caption ? `<small>${escapeHTML(caption)}</small>` : ''}</span>${icon('chevronRight', 18)}</button>`;
}

export function listRowHTML({ title, caption = '', value = '', iconName = 'note' }) {
  return `<button type="button" class="rm-list-row"><span class="rm-list-row-icon">${icon(iconName, 19)}</span><span class="rm-list-row-copy"><strong>${escapeHTML(title)}</strong>${caption ? `<small>${escapeHTML(caption)}</small>` : ''}</span>${value ? `<span class="rm-list-row-value num">${escapeHTML(value)}</span>` : ''}${icon('chevronRight', 17)}</button>`;
}

export function financialSummaryRowHTML({ label, value, tone = 'default', caption = '' }) {
  return `<div class="rm-financial-row rm-financial-row--${escapeHTML(tone)}"><span>${escapeHTML(label)}${caption ? `<small>${escapeHTML(caption)}</small>` : ''}</span><strong class="num">${escapeHTML(value)}</strong></div>`;
}

export function feedbackStateHTML({ type = 'empty', title, message, action = '' }) {
  const iconName = type === 'error' ? 'x' : type === 'loading' ? 'activity' : 'note';
  return `<div class="rm-state rm-state--${escapeHTML(type)}" role="${type === 'error' ? 'alert' : 'status'}"><span class="rm-state-icon">${type === 'loading' ? '<span class="rm-spinner"></span>' : icon(iconName, 22)}</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p>${action ? buttonHTML({ label: action, variant: 'secondary', size: 'compact' }) : ''}</div>`;
}

export function sectionHeaderHTML({ title, action = '' }) {
  return `<div class="rm-section-header"><h2>${escapeHTML(title)}</h2>${action ? `<button type="button" class="rm-link-button">${escapeHTML(action)}${icon('chevronRight', 15)}</button>` : ''}</div>`;
}

export function privacyValueHTML({ label, value, hidden = false }) {
  return `<span class="rm-privacy-value" aria-label="${escapeHTML(label)}">${hidden ? '••••••' : escapeHTML(value)}</span>`;
}

export function dragHandleHTML(label = '拖动重新排序') {
  return `<button type="button" class="rm-drag-handle" aria-label="${escapeHTML(label)}"><span aria-hidden="true">≡</span></button>`;
}
