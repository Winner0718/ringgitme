import { escapeHTML } from '../../app/format.js';

function attributes(input = {}) {
  return Object.entries(input)
    .filter(([, value]) => value !== false && value != null)
    .map(([key, value]) => value === true ? key : `${key}="${escapeHTML(String(value))}"`)
    .join(' ');
}

export function assetSheetFooterHTML({
  primaryLabel = '保存', primaryAction, primaryDisabled = false,
  secondaryLabel = '取消', secondaryAction = 'sheet-close',
  danger = false, className = '',
} = {}) {
  return `<footer class="asset-sheet-footer ${className}" data-asset-sheet-footer>
    <button type="button" class="sheet-secondary" ${attributes({ 'data-action': secondaryAction })}>${escapeHTML(secondaryLabel)}</button>
    <button type="button" class="${danger ? 'sheet-danger' : 'sheet-primary'}" ${attributes({ 'data-action': primaryAction, disabled: primaryDisabled })}>${escapeHTML(primaryLabel)}</button>
  </footer>`;
}
