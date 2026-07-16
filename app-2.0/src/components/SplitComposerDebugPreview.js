import { escapeHTML } from '../app/format.js';
import {
  clearInlineSplitCurrent,
  commitInlineSplitExpression,
  customAllocationProgress,
  customParticipantPresentation,
  createInlineSplitDraft,
  equalizeInlineSplitDraft,
  fillInlineSplitRemainder,
  inlineSplitDrawerHTML,
  pressInlineSplitKey,
  switchInlineSplitParticipant,
} from './SplitAllocationEditorSheet.js';
import { mountModalLayer, pushModalLayer } from '../app/modalStack.js';

const REAL_IDS = ['participant-me', 'participant-abi', 'participant-mei', 'participant-jason'];
const REAL_NAMES = ['Winner', 'Abi', 'Mei Ling', 'Jason'];

function previewName(id, index) {
  return REAL_NAMES[index] || `成员 ${index + 1}`;
}

function parentRows(ids, shares, activeId, expression = '', fresh = true) {
  const pages = [];
  for (let index = 0; index < ids.length; index += 6) pages.push(ids.slice(index, index + 6));
  return `<div class="relationship-split-pages split-debug-pages" role="list" aria-label="自定义分摊对象">${pages.map((page, pageIndex) => `<div class="relationship-split-page" role="presentation" data-split-page="${pageIndex}">${page.map((id) => {
    const index = ids.indexOf(id);
    const presentation = customParticipantPresentation({ amountMinor: shares[id], active: id === activeId, expression, fresh });
    const stateClass = presentation.state === 'active' ? ' is-editing' : presentation.state === 'committed' ? ' has-committed' : ' is-untouched';
    const affordance = presentation.hint ? escapeHTML(presentation.hint) : '›';
    return `<div class="split-participant-row${stateClass}" role="listitem" data-allocation-state="${presentation.state}"><button type="button" class="relationship-amount-row has-affordance" data-debug-person="${escapeHTML(id)}" aria-label="编辑 ${escapeHTML(previewName(id, index))} 的分摊金额，当前 ${escapeHTML(presentation.amountLabel)}"><span class="split-debug-avatar relationship-row-avatar">${escapeHTML(previewName(id, index).slice(0, 1))}</span><span class="relationship-amount-copy"><span class="relationship-amount-name-line"><span class="relationship-amount-name">${escapeHTML(previewName(id, index))}</span></span><span class="relationship-amount-value-line"><strong class="num${presentation.editingExpression ? ' is-expression' : ''}">${escapeHTML(presentation.amountLabel)}</strong><small class="custom-card-affordance">${affordance}</small></span></span></button></div>`;
  }).join('')}</div>`).join('')}</div>`;
}

// Query-only visual QA adapter. It renders the production inline drawer inside
// one Relationship-like modal and never adds a second modal or backdrop.
export function openSplitComposerDebugPreview(count = 4) {
  const size = Math.max(2, Math.min(12, Number(count) || 4));
  const ids = Array.from({ length: size }, (_, index) => REAL_IDS[index] || `participant-demo-${index + 1}`);
  let shares = Object.fromEntries(ids.map((id) => [id, 0]));
  const parent = document.createElement('div');
  parent.className = 'split-debug-parent modal-layer';
  const draft = createInlineSplitDraft({ participantIds: ids, sharesMinor: shares, activeParticipantId: ids[0], triggerParticipantId: ids[0] });
  parent.innerHTML = `<div class="split-debug-backdrop" data-modal-backdrop></div><section class="split-debug-parent-sheet glass-sheet has-inline-split-drawer" data-modal-surface role="dialog" aria-modal="true" aria-label="关系账自定义分摊预览"><header><span class="caption">日本旅行 2026 · ${ids.length} 位参与者</span><h2>自定义分摊</h2><p data-debug-progress>${customAllocationProgress(10000, shares, ids).label}</p></header><div class="split-debug-parent-list" data-debug-parent-list>${parentRows(ids, shares, draft.activeId, draft.expression, draft.fresh)}</div><div data-debug-inline-drawer></div></section>`;
  mountModalLayer(parent);
  const surface = parent.querySelector('[data-modal-surface]');
  const backdrop = parent.querySelector('[data-modal-backdrop]');
  pushModalLayer(parent, { id: 'split-composer-debug-parent', parentId: null, kind: 'split-composer-debug', surface, backdrop });
  const render = () => {
    parent.querySelector('[data-debug-inline-drawer]').innerHTML = inlineSplitDrawerHTML({ totalMinor: 10000, participantIds: ids, sharesMinor: draft.shares, activeParticipantId: draft.activeId, expression: draft.expression, error: draft.error });
    parent.querySelector('[data-debug-parent-list]').innerHTML = parentRows(ids, draft.shares, draft.activeId, draft.expression, draft.fresh);
    parent.querySelector('[data-debug-progress]').textContent = customAllocationProgress(10000, draft.shares, ids).label;
  };
  parent.addEventListener('click', (event) => {
    const person = event.target.closest('[data-debug-person]');
    if (person) { switchInlineSplitParticipant(draft, person.dataset.debugPerson); render(); return; }
    const key = event.target.closest('[data-inline-split-key]');
    if (key) { pressInlineSplitKey(draft, key.dataset.inlineSplitKey); render(); return; }
    if (event.target.closest('[data-inline-split-even]')) { equalizeInlineSplitDraft(draft, 10000); render(); return; }
    if (event.target.closest('[data-inline-split-fill]')) { try { fillInlineSplitRemainder(draft, 10000); } catch (error) { draft.error = error.message; } render(); return; }
    if (event.target.closest('[data-inline-split-clear]')) { clearInlineSplitCurrent(draft); render(); return; }
    if (event.target.closest('[data-inline-split-apply]')) {
      if (commitInlineSplitExpression(draft)) shares = { ...draft.shares };
      render();
    }
  });
  render();
  return { ids, getShares: () => ({ ...shares }) };
}
