import { escapeHTML } from '../app/format.js';
import { icon } from './Icons.js';

export function renderRecurringActionCard({
  title,
  subtitle,
  iconName = 'arrowUp',
  action = 'fixed-occurrence-action',
  tone = 'accent',
  attributes = {},
} = {}) {
  const attrs = Object.entries(attributes)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}="${escapeHTML(String(value))}"`)
    .join(' ');
  return `<button type="button" class="fixed-occurrence-quick-action recurring-action-card semantic-action-control tone-${escapeHTML(tone)}" data-action="${escapeHTML(action)}" ${attrs} aria-label="${escapeHTML(title)}，${escapeHTML(subtitle)}">
    <span class="recurring-action-card-icon">${icon(iconName, 17)}</span>
    <span class="recurring-action-card-copy"><strong>${escapeHTML(title)}</strong><small>${escapeHTML(subtitle)}</small></span>
    <span class="recurring-action-card-chevron">${icon('chevronRight', 15)}</span>
  </button>`;
}
