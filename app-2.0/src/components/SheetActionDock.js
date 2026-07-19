import { escapeHTML } from '../app/format.js';

function safeAttributes(attributes = {}) {
  return Object.entries(attributes).map(([name, value]) => {
    if (!/^(?:data|aria)-[a-z0-9-]+$/.test(name)) throw new Error(`Unsupported action dock attribute: ${name}`);
    return ` ${name}="${escapeHTML(String(value))}"`;
  }).join('');
}

export function sheetActionDockHTML({
  context,
  className = '',
  primaryLabel,
  secondaryLabel,
  primaryAttributes = {},
  secondaryAttributes = {},
  primaryDisabledVisual = false,
} = {}) {
  const disabledClass = primaryDisabledVisual ? ' visually-disabled' : '';
  const disabledAttributes = primaryDisabledVisual ? ' aria-disabled="true"' : '';
  return `<footer class="sheet-action-dock rm-sheet-footer ${escapeHTML(className)}" data-rm-component="SheetFooter" data-sheet-action-dock data-dock-context="${escapeHTML(context || 'sheet')}">
    <div class="sheet-action-dock-surface">
      <button type="button" class="sheet-primary rm-button rm-chrome-edge rm-chrome-priority rm-button--primary sheet-action-dock-primary${disabledClass}"${safeAttributes(primaryAttributes)}${disabledAttributes}>${escapeHTML(primaryLabel)}</button>
      <button type="button" class="sheet-secondary rm-button rm-button--secondary sheet-action-dock-secondary"${safeAttributes(secondaryAttributes)}>${escapeHTML(secondaryLabel)}</button>
    </div>
  </footer>`;
}
