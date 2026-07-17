// Shared recurring-plan adapter for the accepted Capture relationship
// composer primitives. It returns a draft only; it never posts money.

import { escapeHTML } from '../app/format.js';
import { data } from '../app/state.js';
import { equalSplitMinor, allocationSummary, rebuildSplitShares } from '../domain/smartSplit.js';
import { participantAvatarHTML } from '../domain/avatarResolver.js';
import { closeSheet, openSheet, toast } from './AppSheet.js';
import { formatMoneyMinor } from './MoneyCalculatorSheet.js';
import { openPickerSheet } from './PickerSheet.js';
import { sheetActionDockHTML } from './SheetActionDock.js';
import {
  commitInlineSplitExpression,
  createInlineSplitDraft,
  customAllocationProgress,
  customParticipantPresentation,
  inlineSplitDrawerHTML,
  pressInlineSplitKey,
  switchInlineSplitParticipant,
} from './SplitAllocationEditorSheet.js';

const ME = 'participant-me';

function nameFor(id) {
  return data.getParticipant(id)?.displayName || (id === ME ? '我' : '参与者');
}

function ledgerFor(draft) {
  return data.getRelationshipLedger(draft.ledgerId) || data.getRelationshipLedgers().find((ledger) => ledger.status === 'active');
}

function defaultDraft(mode, value = null) {
  const ledger = data.getRelationshipLedger(value?.ledgerId) || data.getRelationshipLedgers().find((item) => item.status === 'active');
  const participantIds = (value?.participantIds || ledger?.participantIds || []).filter((id) => ledger?.participantIds.includes(id));
  const ids = participantIds.includes(ME) ? participantIds : [ME, ...participantIds.filter((id) => id !== ME)];
  const other = ids.find((id) => id !== ME) || null;
  return {
    relationshipMode: mode,
    ledgerId: ledger?.ledgerId || null,
    participantIds: ids,
    authenticatedParticipantId: ME,
    payerParticipantId: value?.payerParticipantId || ME,
    collectorParticipantId: value?.collectorParticipantId || ME,
    externalPayerParticipantId: value?.externalPayerParticipantId || ME,
    splitMode: value?.splitMode || 'equal',
    shares: structuredClone(value?.shares || []),
    relationshipLabel: value?.relationshipLabel || ledger?.title || null,
    otherParticipantId: other,
  };
}

function shareObject(draft, totalMinor) {
  const previous = Object.fromEntries((draft.shares || []).map((share) => [share.participantId, share.amountMinor]));
  return draft.splitMode === 'equal'
    ? equalSplitMinor(totalMinor, draft.participantIds)
    : rebuildSplitShares({ totalMinor, participantIds: draft.participantIds, previous, initializeEqual: !draft.shares?.length });
}

function pickerRow({ label, key, valueId, valueLabel }) {
  const participant = valueId ? data.getParticipant(valueId) : null;
  return `<button type="button" class="relationship-picker-row" data-recurring-picker="${escapeHTML(key)}" aria-label="${escapeHTML(label)}，当前 ${escapeHTML(valueLabel)}">
    ${participant ? participantAvatarHTML(participant, 'relationship-row-avatar') : `<span class="relationship-row-avatar">${escapeHTML(valueLabel.slice(0, 1))}</span>`}
    <span class="relationship-picker-main"><small>${escapeHTML(label)}</small><strong>${escapeHTML(valueLabel)}</strong></span><span class="relationship-row-chevron">›</span>
  </button>`;
}

function participantPages(draft, shares, drawer) {
  const pages = [];
  for (let index = 0; index < draft.participantIds.length; index += 6) pages.push(draft.participantIds.slice(index, index + 6));
  return `<div class="relationship-split-pages" role="list" aria-label="分摊对象">${pages.map((page, pageIndex) => `<div class="relationship-split-page" data-split-page="${pageIndex}">${page.map((id) => {
    const participant = data.getParticipant(id);
    if (draft.splitMode !== 'custom') return `<div class="split-participant-row relationship-amount-row-wrap is-readonly"><div class="relationship-amount-row">${participantAvatarHTML(participant, 'relationship-row-avatar')}<span class="relationship-amount-name">${escapeHTML(nameFor(id))}</span><strong class="num">${formatMoneyMinor(shares[id] || 0)}</strong></div></div>`;
    const active = drawer?.activeId === id;
    const presentation = customParticipantPresentation({ amountMinor: shares[id], active, expression: drawer?.expression, fresh: drawer?.fresh });
    return `<div class="split-participant-row relationship-amount-row-wrap ${active ? 'is-editing' : shares[id] ? 'has-committed' : 'is-untouched'}" data-recurring-share-card="${escapeHTML(id)}"><button type="button" class="relationship-amount-row money-field-button has-affordance" data-recurring-share="${escapeHTML(id)}" aria-label="编辑 ${escapeHTML(nameFor(id))} 的分摊金额，当前 ${escapeHTML(presentation.amountLabel)}">${participantAvatarHTML(participant, 'relationship-row-avatar')}<span class="relationship-amount-copy"><span class="relationship-amount-name">${escapeHTML(nameFor(id))}</span><span class="relationship-amount-value-line"><strong class="num${presentation.editingExpression ? ' is-expression' : ''}" data-recurring-share-amount>${escapeHTML(presentation.amountLabel)}</strong><small class="custom-card-affordance" data-recurring-share-hint>${escapeHTML(presentation.hint || '›')}</small></span></span></button></div>`;
  }).join('')}</div>`).join('')}</div>`;
}

function composerHTML(draft, totalMinor, drawer, error = '') {
  const ledger = ledgerFor(draft);
  const shares = drawer?.shares || shareObject(draft, totalMinor);
  const progress = customAllocationProgress(totalMinor, shares, draft.participantIds);
  const equalRemainder = draft.participantIds.length ? totalMinor % draft.participantIds.length : 0;
  const roleRows = draft.relationshipMode === 'central_collection'
    ? `${pickerRow({ label: '钱先交给谁', key: 'collector', valueId: draft.collectorParticipantId, valueLabel: nameFor(draft.collectorParticipantId) })}${pickerRow({ label: '谁向外付款', key: 'external-payer', valueId: draft.externalPayerParticipantId, valueLabel: nameFor(draft.externalPayerParticipantId) })}`
    : pickerRow({ label: '谁先付款', key: 'payer', valueId: draft.payerParticipantId, valueLabel: draft.payerParticipantId === ME ? '我付款' : `${nameFor(draft.payerParticipantId)}付款` });
  const drawerHTML = drawer ? inlineSplitDrawerHTML({
    totalMinor,
    participantIds: drawer.ids,
    sharesMinor: drawer.shares,
    activeParticipantId: drawer.activeId,
    expression: drawer.expression,
    error: drawer.error,
    opening: drawer.isOpening,
  }) : '';
  return `<div class="relationship-editor recurring-relationship-composer${drawer ? ' has-inline-drawer' : ''}" data-recurring-composer>
    <section class="relationship-glass-group"><h3>对象与付款</h3>
      ${pickerRow({ label: '对象或群组', key: 'ledger', valueLabel: ledger?.title || '选择对象或群组' })}${roleRows}
    </section>
    <section class="relationship-glass-group"><h3>参与者</h3><div class="split-members" role="group">${ledger.participantIds.map((id) => `<button type="button" class="split-member relationship-avatar-chip${draft.participantIds.includes(id) ? ' active' : ''}" data-recurring-participant="${escapeHTML(id)}" aria-pressed="${draft.participantIds.includes(id)}">${participantAvatarHTML(data.getParticipant(id), 'relationship-chip-avatar')}<span>${escapeHTML(id === ME ? '我' : nameFor(id))}</span></button>`).join('')}</div></section>
    <section class="relationship-glass-group relationship-split-group"><h3>分摊方式</h3>
      <div class="segmented relationship-split-segment" role="radiogroup"><button type="button" class="seg-item${draft.splitMode === 'equal' ? ' active' : ''}" data-recurring-mode="equal">平均</button><button type="button" class="seg-item${draft.splitMode === 'custom' ? ' active' : ''}" data-recurring-mode="custom">自定义</button></div>
      ${draft.splitMode === 'custom' ? `<div class="smart-split-heading"><div><strong>自定义</strong><small class="custom-split-helper">点击成员输入金额</small></div><span class="split-state ${progress.state}" data-recurring-allocation-state>${escapeHTML(progress.label)}</span></div>` : `<p class="relationship-preview caption">${equalRemainder ? `无法完全平均，${formatMoneyMinor(equalRemainder)} 差额已分配给最后一位成员` : '平均分摊 · 金额已完全平均'}</p>`}
      ${participantPages(draft, shares, drawer)}
      ${draft.splitMode === 'custom' ? `<div class="relationship-allocation-status ${progress.state}" aria-live="polite"><span>总额 <strong>${formatMoneyMinor(totalMinor)}</strong></span><i>·</i><span>已分 <strong data-recurring-allocated>${formatMoneyMinor(progress.allocatedMinor)}</strong></span><i>·</i><span>差额 <strong data-recurring-difference>${formatMoneyMinor(progress.overMinor || progress.remainingMinor)}</strong></span></div>` : ''}
      ${error ? `<p class="form-error" role="alert">${escapeHTML(error)}</p>` : ''}
    </section>
  </div>${drawer ? '' : sheetActionDockHTML({ context: 'recurring-relationship', className: 'relationship-action-dock', primaryLabel: '应用分摊', secondaryLabel: '取消', primaryAttributes: { 'data-recurring-apply': '' }, secondaryAttributes: { 'data-recurring-cancel': '' } })}${drawerHTML}`;
}

export function openRecurringRelationshipComposer({ mode, totalMinor, value = null, onComplete, trigger = document.activeElement }) {
  let draft = defaultDraft(mode, value);
  let drawer = null;
  let error = '';
  let sheet = null;
  const opening = structuredClone(draft);

  const normalizeLedger = (ledgerId) => {
    const ledger = data.getRelationshipLedger(ledgerId);
    if (!ledger) return;
    draft.ledgerId = ledger.ledgerId;
    draft.participantIds = [...ledger.participantIds];
    draft.relationshipLabel = ledger.title;
    draft.payerParticipantId = ledger.participantIds.includes(draft.payerParticipantId) ? draft.payerParticipantId : ME;
    draft.collectorParticipantId = ledger.participantIds.includes(draft.collectorParticipantId) ? draft.collectorParticipantId : ME;
    draft.externalPayerParticipantId = ledger.participantIds.includes(draft.externalPayerParticipantId) ? draft.externalPayerParticipantId : ME;
    draft.shares = [];
    drawer = null;
  };

  const render = ({ focus = '', preserveScroll = true } = {}) => {
    const body = sheet?.querySelector('.sheet-body');
    const scrollTop = preserveScroll ? body?.scrollTop || 0 : 0;
    const shouldRevealDrawer = Boolean(drawer?.isOpening);
    if (body) body.innerHTML = composerHTML(draft, totalMinor, drawer, error);
    sheet?.classList.toggle('has-inline-split-drawer', Boolean(drawer));
    if (body) body.scrollTop = scrollTop;
    bind();
    requestAnimationFrame(() => {
      if (focus) sheet?.querySelector(focus)?.focus?.({ preventScroll: true });
      if (shouldRevealDrawer) {
        sheet?.querySelector('[data-inline-split-drawer]')?.scrollIntoView?.({ block: 'end', behavior: 'auto' });
      }
      if (drawer) drawer.isOpening = false;
    });
  };

  // Calculator keypresses update only their text/state targets. Replacing the
  // full Sheet body here caused the visible 0/decimal twitch and changed the
  // parent's geometry and scroll position on every digit.
  const syncInlineSplitView = () => {
    if (!drawer || !sheet) return;
    const progress = customAllocationProgress(totalMinor, drawer.shares, drawer.ids);
    drawer.ids.forEach((id) => {
      const card = sheet.querySelector(`[data-recurring-share-card="${CSS.escape(id)}"]`);
      const button = card?.querySelector('[data-recurring-share]');
      const amount = card?.querySelector('[data-recurring-share-amount]');
      const hint = card?.querySelector('[data-recurring-share-hint]');
      if (!card || !button || !amount || !hint) return;
      const active = drawer.activeId === id;
      const presentation = customParticipantPresentation({ amountMinor: drawer.shares[id], active, expression: drawer.expression, fresh: drawer.fresh });
      card.classList.toggle('is-editing', active);
      card.classList.toggle('has-committed', !active && Number(drawer.shares[id] || 0) > 0);
      card.classList.toggle('is-untouched', !active && !Number(drawer.shares[id] || 0));
      button.setAttribute('aria-label', `编辑 ${nameFor(id)} 的分摊金额，当前 ${presentation.amountLabel}`);
      amount.textContent = presentation.amountLabel;
      amount.classList.toggle('is-expression', presentation.editingExpression);
      hint.textContent = presentation.hint || '›';
    });

    const state = sheet.querySelector('[data-recurring-allocation-state]');
    if (state) {
      state.className = `split-state ${progress.state}`;
      state.textContent = progress.label;
    }
    const status = sheet.querySelector('.relationship-allocation-status');
    if (status) status.className = `relationship-allocation-status ${progress.state}`;
    const allocated = sheet.querySelector('[data-recurring-allocated]');
    const difference = sheet.querySelector('[data-recurring-difference]');
    if (allocated) allocated.textContent = formatMoneyMinor(progress.allocatedMinor);
    if (difference) difference.textContent = formatMoneyMinor(progress.overMinor || progress.remainingMinor);

    const feedback = sheet.querySelector('[data-inline-split-feedback]');
    if (feedback) {
      feedback.className = `split-editor-feedback ${progress.state}${drawer.error ? ' has-error' : ''}`;
      feedback.textContent = drawer.error || progress.label;
    }
    const activeOperator = String(drawer.expression || '').match(/[+−×÷]$/)?.[0] || '';
    sheet.querySelectorAll('[data-inline-split-key]').forEach((key) => {
      const selected = ['÷', '×', '−', '+', '='].includes(key.dataset.inlineSplitKey) && key.dataset.inlineSplitKey === activeOperator;
      key.classList.toggle('is-selected', selected);
      if (key.classList.contains('operator')) key.setAttribute('aria-pressed', String(selected));
    });
  };

  const closeDrawer = (apply = false) => {
    if (!drawer) return;
    const participantId = drawer.triggerParticipantId;
    if (apply && !commitInlineSplitExpression(drawer)) return render({ focus: '[data-inline-split-feedback]' });
    if (apply) draft.shares = draft.participantIds.map((id) => ({ participantId: id, amountMinor: drawer.shares[id] || 0 }));
    drawer = null;
    render({ focus: `[data-recurring-share="${CSS.escape(participantId)}"]` });
  };

  const rolePicker = (key, title, selectedValue) => {
    const ledger = ledgerFor(draft);
    const row = sheet.querySelector(`[data-recurring-picker="${key}"]`);
    openPickerSheet({
      title,
      selectedValue,
      options: ledger.participantIds.map((id) => ({ value: id, label: id === ME ? '我' : nameFor(id), avatar: nameFor(id).slice(0, 1) })),
      trigger: row,
      onSelect: (id) => {
        if (key === 'payer') draft.payerParticipantId = id;
        if (key === 'collector') draft.collectorParticipantId = id;
        if (key === 'external-payer') draft.externalPayerParticipantId = id;
        render();
      },
    });
  };

  const bind = () => {
    sheet?.querySelector('[data-recurring-picker="ledger"]')?.addEventListener('click', (event) => openPickerSheet({
      title: '选择对象或群组',
      selectedValue: draft.ledgerId,
      options: data.getRelationshipLedgers().filter((ledger) => ledger.status === 'active').map((ledger) => ({ value: ledger.ledgerId, label: ledger.title, caption: `${ledger.participantIds.length} 位成员`, avatar: ledger.title.slice(0, 1) })),
      trigger: event.currentTarget,
      onSelect: (id) => { normalizeLedger(id); render({ preserveScroll: false }); },
    }));
    sheet?.querySelector('[data-recurring-picker="payer"]')?.addEventListener('click', () => rolePicker('payer', '谁先付款', draft.payerParticipantId));
    sheet?.querySelector('[data-recurring-picker="collector"]')?.addEventListener('click', () => rolePicker('collector', '钱先交给谁', draft.collectorParticipantId));
    sheet?.querySelector('[data-recurring-picker="external-payer"]')?.addEventListener('click', () => rolePicker('external-payer', '谁向外付款', draft.externalPayerParticipantId));
    sheet?.querySelectorAll('[data-recurring-participant]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.recurringParticipant;
      const selected = new Set(draft.participantIds);
      if (selected.has(id)) {
        if (id === ME) return toast('关系计划必须包含你自己');
        if (selected.size <= 2) return toast('至少保留两位参与者');
        selected.delete(id);
      } else selected.add(id);
      const ledger = ledgerFor(draft);
      draft.participantIds = ledger.participantIds.filter((memberId) => selected.has(memberId));
      draft.shares = draft.shares.filter((share) => draft.participantIds.includes(share.participantId));
      render();
    }));
    sheet?.querySelectorAll('[data-recurring-mode]').forEach((button) => button.addEventListener('click', () => {
      draft.splitMode = button.dataset.recurringMode;
      const shares = shareObject(draft, totalMinor);
      draft.shares = draft.participantIds.map((id) => ({ participantId: id, amountMinor: shares[id] || 0 }));
      drawer = null;
      error = '';
      render();
    }));
    sheet?.querySelectorAll('[data-recurring-share]').forEach((button) => button.addEventListener('click', () => {
      const id = button.dataset.recurringShare;
      if (drawer) {
        if (!switchInlineSplitParticipant(drawer, id)) return render({ focus: '[data-inline-split-feedback]' });
      } else {
        const shares = shareObject(draft, totalMinor);
        drawer = createInlineSplitDraft({ participantIds: draft.participantIds, sharesMinor: shares, activeParticipantId: id, triggerParticipantId: id });
        drawer.isOpening = true;
      }
      render({ focus: '[data-inline-split-key="7"]' });
    }));
    sheet?.querySelectorAll('[data-inline-split-key]').forEach((button) => button.addEventListener('click', () => {
      pressInlineSplitKey(drawer, button.dataset.inlineSplitKey);
      syncInlineSplitView();
      button.focus({ preventScroll: true });
    }));
    sheet?.querySelector('[data-inline-split-collapse]')?.addEventListener('click', () => closeDrawer(false));
    sheet?.querySelector('[data-inline-split-apply]')?.addEventListener('click', () => closeDrawer(true));
    sheet?.querySelector('[data-recurring-cancel]')?.addEventListener('click', () => closeSheet());
    sheet?.querySelector('[data-recurring-apply]')?.addEventListener('click', () => {
      const shares = shareObject(draft, totalMinor);
      if (draft.splitMode === 'custom') {
        const summary = allocationSummary(totalMinor, shares, draft.participantIds);
        if (!summary.exact) { error = summary.overMinor ? `已超出 ${formatMoneyMinor(summary.overMinor)}` : `还差 ${formatMoneyMinor(summary.remainingMinor)}`; return render(); }
      }
      draft.shares = draft.participantIds.map((id) => ({ participantId: id, amountMinor: shares[id] || 0 }));
      onComplete?.(structuredClone(draft));
      closeSheet();
    });
  };

  sheet = openSheet({
    id: 'recurring-relationship-composer',
    title: mode === 'central_collection' ? '统一收款设置' : '共同分担设置',
    className: 'capture-relationship-sheet recurring-relationship-composer-sheet',
    stacked: true,
    trigger,
    contentHTML: composerHTML(draft, totalMinor, drawer, error),
    onClose: () => { draft = opening; drawer = null; sheet = null; },
  });
  bind();
  return sheet;
}
