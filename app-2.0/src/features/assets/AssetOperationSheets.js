import { data, registerAction, update } from '../../app/state.js';
import { closeSheet, openSheet, toast } from '../../components/AppSheet.js';
import { bindDatePickerField, bindNativeDateTimeFields, datePickerFieldHTML, nativeDateTimeFieldsHTML } from '../../components/NativeDateTimeFields.js';
import { escapeHTML, fmtDateMY, fmtRM } from '../../app/format.js';
import { buildInstallmentSchedule, installmentScheduleSummary, minor } from '../../domain/assetFinancialModel.js';
import { assetSheetFooterHTML } from './AssetSheetFooter.js';

let context = null;

function moneyField(name, label, value = '', { required = true } = {}) {
  return `<label class="asset-form-field"><span>${label}</span><div class="asset-money-input"><b>RM</b><input name="${name}" inputmode="decimal" value="${escapeHTML(String(value))}" placeholder="0.00" ${required ? 'required' : ''} /></div></label>`;
}

function operationShell(account, content, footer) {
  return `<div class="asset-operation-summary"><span>${escapeHTML(account.name)}</span><strong>${account.type === 'cc' ? `总欠款 ${fmtRM(account.totalCardDebt)}` : `当前余额 ${fmtRM(account.balance)}`}</strong></div>${content}${footer}`;
}

function closeOperation(message) {
  const depth = Math.max(1, Number(context?.closeDepth || 1));
  for (let index = 0; index < depth; index += 1) closeSheet(true);
  toast(message);
  update({});
}

function openSimpleOperation(account, operation) {
  const sources = data.getAccounts().filter((item) => item.status === 'active' && item.type !== 'cc' && !item.isHidden);
  const title = { payment: '信用卡还款', fee: '记录费用与利息', opening: '导入已有欠款' }[operation];
  const fields = `${operation === 'payment' ? `<label class="asset-form-field"><span>付款账户</span><select name="sourceAccountId">${sources.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${fmtRM(item.balance)}</option>`).join('')}</select></label>` : ''}${moneyField('amount', operation === 'payment' ? '还款金额' : operation === 'fee' ? '费用金额' : '已有欠款')}<label class="asset-form-field"><span>备注</span><input name="note" maxlength="80" placeholder="可选" /></label>`;
  context = { accountId: account.id, operation, closeDepth: 1 };
  openSheet({ title, className: 'asset-operation-sheet', contentHTML: `<form data-asset-simple-operation>${operationShell(account, fields, assetSheetFooterHTML({ primaryAction: 'asset-simple-operation-save', primaryLabel: '确认记录' }))}</form>` });
}

function bindAdjustmentPreview(sheet, account) {
  const input = sheet.querySelector('[name="targetBalance"]');
  const difference = sheet.querySelector('[data-adjustment-difference]');
  const helper = sheet.querySelector('[data-adjustment-helper]');
  const primary = sheet.querySelector('[data-action="asset-target-adjustment-save"]');
  const render = () => {
    try {
      const targetMinor = minor(input.value);
      const deltaMinor = targetMinor - account.balanceMinor;
      difference.textContent = `${deltaMinor < 0 ? '−' : '+'}${fmtRM(Math.abs(deltaMinor) / 100)}`;
      difference.className = `num ${deltaMinor < 0 ? 'amt-neg' : 'amt-pos'}`;
      helper.textContent = deltaMinor < 0 ? '系统将减少账户余额' : deltaMinor > 0 ? '系统将增加账户余额' : '余额没有变化';
      primary.disabled = deltaMinor === 0 || targetMinor < 0;
    } catch {
      difference.textContent = '—'; helper.textContent = '请输入有效余额'; primary.disabled = true;
    }
  };
  input.addEventListener('input', render);
  render();
}

function openTargetAdjustment(account) {
  context = { accountId: account.id, operation: 'adjustment', closeDepth: 1 };
  const fields = `<div class="asset-current-balance-card"><span>当前余额</span><strong class="num">${fmtRM(account.balance)}</strong></div>${moneyField('targetBalance', '调整后余额', account.balance.toFixed(2))}<div class="asset-adjustment-live"><span data-adjustment-helper>余额没有变化</span><strong data-adjustment-difference class="num">RM 0.00</strong></div><label class="asset-form-field"><span>备注 / 原因</span><input name="note" maxlength="80" placeholder="例如 现金充值" /></label>`;
  openSheet({ title: '调整余额', className: 'asset-operation-sheet', contentHTML: `<form data-asset-target-adjustment>${operationShell(account, fields, assetSheetFooterHTML({ primaryAction: 'asset-target-adjustment-save', primaryLabel: '确认调整', primaryDisabled: true }))}</form>`, onOpen: (sheet) => bindAdjustmentPreview(sheet, account) });
}

function eligiblePurchases(cardId) {
  return data.getTransactions({ includeReversed: false }).filter((transaction) => transaction.kind === 'expense'
    && transaction.sourceAccountId === cardId && transaction.accountEffect === 'posted'
    && !transaction.convertedInstallmentId && Number(transaction.refundedMinor || 0) < transaction.amountMinor);
}

function purchasePickerHTML(account, action) {
  const rows = eligiblePurchases(account.id);
  return `<div class="asset-purchase-picker">${rows.map((transaction) => {
    const remaining = (transaction.amountMinor - Number(transaction.refundedMinor || 0)) / 100;
    return `<button type="button" class="asset-purchase-row" data-action="${action}" data-id="${escapeHTML(transaction.id)}"><span><strong>${escapeHTML(transaction.desc)}</strong><small>${fmtDateMY(transaction.date)} · ${escapeHTML(transaction.catLabel || '未分类')}</small></span><span class="num">${fmtRM(remaining)}</span></button>`;
  }).join('') || '<div class="asset-empty-state">没有可用的原消费</div>'}</div>`;
}

function openRefundMode(account) {
  context = { accountId: account.id, operation: 'refund', closeDepth: 1 };
  openSheet({ title: '记录退款', className: 'asset-operation-sheet', contentHTML: `<div class="asset-mode-cards"><button type="button" data-action="asset-refund-linked"><strong>关联原消费退款</strong><span>选择原信用卡消费，支持部分或全额退款</span></button><button type="button" data-action="asset-refund-general"><strong>一般卡片退款 / Card Credit</strong><span>没有原消费时，直接记录卡片退款或信用余额</span></button></div>${assetSheetFooterHTML({ primaryAction: 'sheet-close', primaryLabel: '完成', secondaryLabel: '返回' })}` });
}

function openLinkedRefundPicker() {
  const account = data.getAccount(context.accountId);
  context = { ...context, closeDepth: 2 };
  openSheet({ title: '选择原消费', className: 'asset-operation-sheet', stacked: true, contentHTML: `${purchasePickerHTML(account, 'asset-refund-purchase-select')}${assetSheetFooterHTML({ primaryAction: 'sheet-close', primaryLabel: '返回', secondaryLabel: '取消' })}` });
}

function openLinkedRefundForm(transactionId) {
  const transaction = data.getTransaction(transactionId);
  const remainingMinor = transaction.amountMinor - Number(transaction.refundedMinor || 0);
  context = { ...context, transactionId, closeDepth: 3 };
  const aa = Number(transaction.aaReceivableMinor || 0);
  const summary = `<div class="asset-purchase-detail"><strong>${escapeHTML(transaction.desc)}</strong><span>原金额 <b class="num">${fmtRM(transaction.amount)}</b></span><span>日期 <b>${fmtDateMY(transaction.date)}</b></span><span>类别 <b>${escapeHTML(transaction.catLabel || '未分类')}</b></span><span>剩余可退款 <b class="num amt-pos">${fmtRM(remainingMinor / 100)}</b></span>${aa ? `<span>AA 应收关联 <b class="num">${fmtRM(aa / 100)}</b></span>` : ''}</div>`;
  const fields = `${summary}${moneyField('amount', '退款金额', (remainingMinor / 100).toFixed(2))}<label class="asset-form-field"><span>备注</span><input name="note" maxlength="80" placeholder="可选" /></label>`;
  openSheet({ title: '关联原消费退款', className: 'asset-operation-sheet', stacked: true, contentHTML: `<form data-linked-refund>${fields}${assetSheetFooterHTML({ primaryAction: 'asset-linked-refund-save', primaryLabel: '确认退款' })}</form>` });
}

function openGeneralCreditForm() {
  const account = data.getAccount(context.accountId);
  context = { ...context, closeDepth: 2 };
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const fields = `<div class="asset-form-note">一般卡片退款 / Card Credit 不会计作收入，也不会反转某个消费类别。</div>${moneyField('amount', '金额')}${nativeDateTimeFieldsHTML({ prefix: 'asset-general-credit', date: data.today, time })}<label class="asset-form-field"><span>备注</span><input name="note" maxlength="80" placeholder="可选" /></label>`;
  openSheet({ title: '一般卡片退款', className: 'asset-operation-sheet', stacked: true, contentHTML: `<form data-general-card-credit>${operationShell(account, fields, assetSheetFooterHTML({ primaryAction: 'asset-general-credit-save', primaryLabel: '确认记录' }))}</form>`, onOpen: (sheet) => bindNativeDateTimeFields(sheet) });
}

function schedulePreviewHTML({ principalMinor, termCount, firstDueDate }) {
  try {
    const schedule = buildInstallmentSchedule({ principalMinor, termCount, firstDueDate });
    const summary = installmentScheduleSummary({ schedule, principalMinor, asOfDate: data.today });
    return `<div class="asset-installment-preview" data-installment-preview><h3>分期计划预览</h3><div><span>本金</span><b class="num">${fmtRM(summary.principalMinor / 100)}</b></div><div><span>期数</span><b>${summary.termCount} 期</b></div><div><span>每期</span><b class="num">${fmtRM(summary.regularMinor / 100)}</b></div><div><span>首期</span><b>${fmtDateMY(summary.firstDueDate)}</b></div><div><span>最后一期</span><b>${fmtDateMY(summary.finalDueDate)}</b></div><div><span>最后一期金额</span><b class="num">${fmtRM(summary.finalMinor / 100)}</b></div><div><span>总额</span><b class="num">${fmtRM(summary.totalMinor / 100)}</b></div>${summary.currentMonthMinor ? `<div><span>本月</span><b class="num">${fmtRM(summary.currentMonthMinor / 100)}</b></div>` : ''}</div>`;
  } catch { return '<div class="asset-installment-preview is-empty" data-installment-preview>填写资料后显示准确分期计划</div>'; }
}

function bindInstallmentPreview(sheet, selectors) {
  const form = sheet.querySelector('form');
  const refresh = () => {
    let principalMinor;
    try { principalMinor = Number.isInteger(selectors.fixedPrincipalMinor) ? selectors.fixedPrincipalMinor : minor(form.elements[selectors.amount].value); } catch { principalMinor = 0; }
    const termCount = Number(form.elements[selectors.terms].value);
    const firstDueDate = form.elements[selectors.date].value;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = schedulePreviewHTML({ principalMinor, termCount, firstDueDate });
    form.querySelector('[data-installment-preview]')?.replaceWith(wrapper.firstElementChild);
  };
  form.addEventListener('input', refresh);
  bindDatePickerField(sheet, selectors.key, { onDateChange: refresh });
  refresh();
}

function openInstallmentMode(account) {
  context = { accountId: account.id, operation: 'installment', closeDepth: 1 };
  openSheet({ title: '新增信用卡分期', className: 'asset-operation-sheet', contentHTML: `<div class="asset-mode-cards"><button type="button" data-action="asset-installment-new"><strong>新分期消费</strong><span>尚未记账的全新购买</span></button><button type="button" data-action="asset-installment-convert"><strong>转换已有消费</strong><span>把同卡普通消费转成分期，不重复计支出</span></button><button type="button" data-action="asset-installment-import"><strong>导入已有分期</strong><span>迁移剩余本金和剩余期数</span></button></div>${assetSheetFooterHTML({ primaryAction: 'sheet-close', primaryLabel: '完成', secondaryLabel: '返回' })}` });
}

function openNewInstallmentForm() {
  context = { ...context, closeDepth: 2 };
  const categories = data.getCategories('expense').filter((item) => !item.isArchived);
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const fields = `${moneyField('principal', '本金')}<label class="asset-form-field"><span>项目名称</span><input name="name" maxlength="40" placeholder="例如 笔记本电脑" required /></label><label class="asset-form-field"><span>类别</span><select name="categoryId">${categories.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('')}</select></label>${nativeDateTimeFieldsHTML({ prefix: 'asset-new-installment-purchase', date: data.today, time })}<label class="asset-form-field"><span>期数</span><input name="termCount" inputmode="numeric" value="12" min="1" max="120" required /></label>${datePickerFieldHTML({ label: '首期日期', key: 'asset-new-installment-date', value: '2026-08-13', inputName: 'firstDueDate' })}<label class="asset-form-field"><span>备注</span><input name="note" maxlength="80" placeholder="可选" /></label>${schedulePreviewHTML({ principalMinor: 0, termCount: 12, firstDueDate: '2026-08-13' })}`;
  openSheet({ title: '新分期消费', className: 'asset-operation-sheet', stacked: true, contentHTML: `<form data-new-installment>${fields}${assetSheetFooterHTML({ primaryAction: 'asset-new-installment-save', primaryLabel: '建立分期' })}</form>`, onOpen: (sheet) => { bindNativeDateTimeFields(sheet); bindInstallmentPreview(sheet, { amount: 'principal', terms: 'termCount', date: 'firstDueDate', key: 'asset-new-installment-date' }); } });
}

function openConvertPicker() {
  const account = data.getAccount(context.accountId);
  context = { ...context, closeDepth: 2 };
  openSheet({ title: '选择已有消费', className: 'asset-operation-sheet', stacked: true, contentHTML: `${purchasePickerHTML(account, 'asset-installment-purchase-select')}${assetSheetFooterHTML({ primaryAction: 'sheet-close', primaryLabel: '返回', secondaryLabel: '取消' })}` });
}

function openConvertForm(transactionId) {
  const transaction = data.getTransaction(transactionId);
  context = { ...context, transactionId, closeDepth: 3 };
  const fields = `<div class="asset-purchase-detail"><strong>${escapeHTML(transaction.desc)}</strong><span>原金额 <b class="num">${fmtRM(transaction.amount)}</b></span><span>日期 <b>${fmtDateMY(transaction.date)}</b></span><span>剩余普通本金 <b class="num">${fmtRM(transaction.amount)}</b></span></div><label class="asset-form-field"><span>分期期数</span><input name="termCount" inputmode="numeric" value="12" min="1" max="120" required /></label>${datePickerFieldHTML({ label: '首期日期', key: 'asset-convert-installment-date', value: '2026-08-13', inputName: 'firstDueDate' })}${schedulePreviewHTML({ principalMinor: transaction.amountMinor, termCount: 12, firstDueDate: '2026-08-13' })}`;
  openSheet({ title: '转换为分期', className: 'asset-operation-sheet', stacked: true, contentHTML: `<form data-convert-installment>${fields}${assetSheetFooterHTML({ primaryAction: 'asset-convert-installment-save', primaryLabel: '确认转换' })}</form>`, onOpen: (sheet) => bindInstallmentPreview(sheet, { fixedPrincipalMinor: transaction.amountMinor, terms: 'termCount', date: 'firstDueDate', key: 'asset-convert-installment-date' }) });
}

function openImportInstallmentForm() {
  context = { ...context, closeDepth: 2 };
  const fields = `<div class="asset-form-note">只建立剩余分期，不会重新计入过去的消费或收入。</div><label class="asset-form-field"><span>项目名称</span><input name="name" maxlength="40" placeholder="例如 已有手机分期" required /></label>${moneyField('remainingPrincipal', '剩余本金')}<label class="asset-form-field"><span>剩余期数</span><input name="remainingTermCount" inputmode="numeric" value="6" min="1" max="120" required /></label>${datePickerFieldHTML({ label: '下一期日期', key: 'asset-import-installment-date', value: '2026-08-13', inputName: 'nextDueDate' })}<label class="asset-form-field"><span>原总期数（可选）</span><input name="originalTermCount" inputmode="numeric" min="1" max="120" /></label>${moneyField('monthlyAmount', '每月金额（可选）', '', { required: false })}<label class="asset-form-field"><span>备注</span><input name="note" maxlength="80" placeholder="可选" /></label>${schedulePreviewHTML({ principalMinor: 0, termCount: 6, firstDueDate: '2026-08-13' })}`;
  openSheet({ title: '导入已有分期', className: 'asset-operation-sheet', stacked: true, contentHTML: `<form data-import-installment>${fields}${assetSheetFooterHTML({ primaryAction: 'asset-import-installment-save', primaryLabel: '导入分期' })}</form>`, onOpen: (sheet) => bindInstallmentPreview(sheet, { amount: 'remainingPrincipal', terms: 'remainingTermCount', date: 'nextDueDate', key: 'asset-import-installment-date' }) });
}

export function openAssetOperation(accountId, operation) {
  const account = data.getAccount(accountId);
  if (!account) return;
  if (operation === 'adjustment') return openTargetAdjustment(account);
  if (operation === 'refund') return openRefundMode(account);
  if (operation === 'installment') return openInstallmentMode(account);
  return openSimpleOperation(account, operation);
}

export function registerAssetOperationActions() {
  registerAction('asset-detail-operation', (el) => openAssetOperation(el.dataset.id, el.dataset.operation));
  registerAction('asset-simple-operation-save', (el) => {
    const form = el.closest('.sheet-body').querySelector('[data-asset-simple-operation]');
    const values = Object.fromEntries(new FormData(form));
    const key = `asset-ui-${context.operation}-${context.accountId}-${Date.now()}`;
    try {
      if (context.operation === 'payment') data.recordCardPayment({ cardId: context.accountId, sourceAccountId: values.sourceAccountId, amount: values.amount, note: values.note, idempotencyKey: key });
      if (context.operation === 'fee') data.recordCardFee({ cardId: context.accountId, amount: values.amount, description: values.note || '费用与利息', idempotencyKey: key });
      if (context.operation === 'opening') data.recordOpeningCardDebt({ cardId: context.accountId, amount: values.amount, note: values.note, idempotencyKey: key });
      closeOperation('资产记录已更新');
    } catch (error) { toast(error.message); }
  });
  registerAction('asset-target-adjustment-save', (el) => {
    const values = Object.fromEntries(new FormData(el.closest('form')));
    try { data.recordAssetTargetBalance({ accountId: context.accountId, targetBalance: values.targetBalance, note: values.note, idempotencyKey: `asset-target-${context.accountId}-${Date.now()}` }); closeOperation('余额调整已记录'); } catch (error) { toast(error.message); }
  });
  registerAction('asset-refund-linked', openLinkedRefundPicker);
  registerAction('asset-refund-general', openGeneralCreditForm);
  registerAction('asset-refund-purchase-select', (el) => openLinkedRefundForm(el.dataset.id));
  registerAction('asset-linked-refund-save', (el) => { const values = Object.fromEntries(new FormData(el.closest('form'))); try { data.recordLinkedCardRefund({ cardId: context.accountId, linkedTransactionId: context.transactionId, amount: values.amount, note: values.note, idempotencyKey: `asset-linked-refund-${context.transactionId}-${Date.now()}` }); closeOperation('原消费退款已记录'); } catch (error) { toast(error.message); } });
  registerAction('asset-general-credit-save', (el) => { const form = el.closest('form'); const values = Object.fromEntries(new FormData(form)); try { data.recordGeneralCardCredit({ cardId: context.accountId, amount: values.amount, date: form.querySelector('[data-ringgit-date-input]')?.value, time: form.querySelector('[data-ringgit-time-input]')?.value, note: values.note, idempotencyKey: `asset-general-credit-${context.accountId}-${Date.now()}` }); closeOperation('一般卡片退款已记录'); } catch (error) { toast(error.message); } });
  registerAction('asset-installment-new', openNewInstallmentForm);
  registerAction('asset-installment-convert', openConvertPicker);
  registerAction('asset-installment-import', openImportInstallmentForm);
  registerAction('asset-installment-purchase-select', (el) => openConvertForm(el.dataset.id));
  registerAction('asset-new-installment-save', (el) => { const form = el.closest('form'); const values = Object.fromEntries(new FormData(form)); const category = data.getCategory(values.categoryId); const date = form.querySelector('[data-ringgit-date-input]')?.value; const time = form.querySelector('[data-ringgit-time-input]')?.value; try { data.createCardInstallment({ cardId: context.accountId, name: values.name, principal: values.principal, termCount: Number(values.termCount), firstDueDate: values.firstDueDate, categoryId: values.categoryId, categoryLabel: category?.name || '', occurredAt: date && time ? `${date}T${time}:00` : null, note: values.note, idempotencyKey: `asset-new-installment-${context.accountId}-${Date.now()}` }); closeOperation('新分期已建立'); } catch (error) { toast(error.message); } });
  registerAction('asset-convert-installment-save', (el) => { const values = Object.fromEntries(new FormData(el.closest('form'))); try { data.convertPurchaseToInstallment({ cardId: context.accountId, transactionId: context.transactionId, termCount: Number(values.termCount), firstDueDate: values.firstDueDate, idempotencyKey: `asset-convert-installment-${context.transactionId}-${Date.now()}` }); closeOperation('消费已转换为分期'); } catch (error) { toast(error.message); } });
  registerAction('asset-import-installment-save', (el) => { const values = Object.fromEntries(new FormData(el.closest('form'))); try { data.importCardInstallment({ cardId: context.accountId, name: values.name, remainingPrincipal: values.remainingPrincipal, remainingTermCount: Number(values.remainingTermCount), nextDueDate: values.nextDueDate, originalTermCount: values.originalTermCount || null, monthlyAmount: values.monthlyAmount || null, note: values.note, idempotencyKey: `asset-import-installment-${context.accountId}-${Date.now()}` }); closeOperation('已有分期已导入'); } catch (error) { toast(error.message); } });
}
