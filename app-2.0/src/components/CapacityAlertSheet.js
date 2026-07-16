import { escapeHTML, fmtRM } from '../app/format.js';
import { closeSheet, openSheet } from './AppSheet.js';
import { icon } from './Icons.js';

const money = (minor) => fmtRM(Number(minor || 0) / 100);

function cashCopy(capacity, context) {
  const transfer = context === 'transfer' || capacity.role === 'transfer';
  const repayment = context === 'repayment' || context === 'settlement';
  return {
    title: transfer ? '转出账户余额不足' : repayment ? '还款账户余额不足' : '余额不足',
    body: transfer
      ? `转出金额和手续费共需 ${money(capacity.requiredMinor)}，当前余额为 ${money(capacity.currentMinor)}，还差 ${money(capacity.shortageMinor)}。`
      : `账户余额为 ${money(capacity.currentMinor)}，这笔${repayment ? '还款' : '支出'}需要 ${money(capacity.requiredMinor)}，还差 ${money(capacity.shortageMinor)}。`,
  };
}

function alertHTML(capacity, context) {
  if (capacity.status === 'insufficient-cash') {
    const copy = cashCopy(capacity, context);
    return { title: copy.title, html: `<div class="capacity-alert-hero">${icon('alert', 22)}<strong>${escapeHTML(capacity.accountName)}</strong><p>${escapeHTML(copy.body)}</p></div>
      <button class="sheet-primary" data-capacity-change>更换账户</button><button class="sheet-secondary" data-capacity-return>返回修改</button>` };
  }
  if (capacity.status === 'credit-limit-unknown') {
    return { title: '未设置信用额度', html: `<div class="capacity-alert-hero">${icon('alert', 22)}<strong>${escapeHTML(capacity.accountName)}</strong><p>无法自动检查这张信用卡是否超额。只有在交易已经成功时才继续记录。</p></div>
      <button class="sheet-primary capacity-explicit-approval" data-capacity-approve>交易已成功，继续记录</button><button class="sheet-secondary" data-capacity-return>返回修改</button>` };
  }
  return { title: '将超过信用额度', html: `<div class="capacity-alert-hero">${icon('alert', 22)}<strong>${escapeHTML(capacity.accountName)}</strong></div>
    <dl class="capacity-rows"><div><dt>信用额度</dt><dd>${money(capacity.creditLimitMinor)}</dd></div><div><dt>当前已使用</dt><dd>${money(capacity.outstandingMinor)}</dd></div><div><dt>可用额度</dt><dd>${money(capacity.availableCreditMinor)}</dd></div><div><dt>本次金额</dt><dd>${money(capacity.requiredMinor)}</dd></div><div class="capacity-over"><dt>超出额度</dt><dd>${money(capacity.overLimitMinor)}</dd></div></dl>
    <p class="capacity-explanation">这笔记录会超过信用卡可用额度。只有在银行已经批准这笔真实交易时才继续记录。</p>
    <button class="sheet-primary capacity-explicit-approval" data-capacity-approve>交易已获批准，继续记录</button><button class="sheet-secondary" data-capacity-return>返回修改</button>` };
}

export function openCapacityAlert({ capacity, context = 'expense', onChangeAccount, onApprove }) {
  const content = alertHTML(capacity, context);
  let resolved = false;
  const finish = (callback) => {
    if (resolved) return;
    resolved = true;
    closeSheet();
    requestAnimationFrame(callback || (() => {}));
  };
  return openSheet({
    title: content.title,
    className: 'capacity-alert-sheet',
    contentHTML: content.html,
    stacked: true,
    onOpen: (sheet) => {
      sheet.querySelector('[data-capacity-return]')?.addEventListener('click', () => finish());
      sheet.querySelector('[data-capacity-change]')?.addEventListener('click', () => finish(onChangeAccount));
      sheet.querySelector('[data-capacity-approve]')?.addEventListener('click', (event) => {
        event.currentTarget.disabled = true;
        finish(() => onApprove?.({ fingerprint: capacity.confirmationFingerprint }));
      });
    },
  });
}
