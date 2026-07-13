// ============================================================
// StackedDeck — the approved vertically layered deck used on
// the 资产 overview page. Every layer stays readable: identity,
// name, masked digits, amount, chevron. Savings and credit
// cards each get their own deck; types are never mixed.
// ============================================================

import { ui } from '../app/state.js';
import { fmtRM, escapeHTML } from '../app/format.js';
import { icon } from './Icons.js';

export function renderStackedDeck(items) {
  return `
    <div class="stack-deck">
      ${items.map((a, i) => {
        const amount = a.type === 'cc' ? -a.outstanding : a.balance;
        return `
        <button class="stack-card" style="--brand:${a.brandColor}; z-index:${items.length - i}"
          data-action="assets-open-detail" data-acc="${a.id}" aria-label="${escapeHTML(a.name)}">
          <span class="stack-logo">${escapeHTML(logoText(a))}</span>
          <span class="stack-main">
            <span class="stack-name">${escapeHTML(a.name)}</span>
            ${a.last4 ? `<span class="stack-digits num">•••• ${a.last4}</span>` : ''}
          </span>
          <span class="stack-amt num">${a.type === 'cc' ? '−' : ''}${fmtRM(Math.abs(amount), { privacy: ui.privacy })}</span>
          ${icon('chevronRight', 13)}
        </button>`;
      }).join('')}
    </div>
  `;
}

function logoText(a) {
  const word = a.bank || a.name;
  // Latin brands → first letters; keeps the chip restrained, no fake logos
  return word.replace(/（.*）/, '').trim().slice(0, 1).toUpperCase();
}
