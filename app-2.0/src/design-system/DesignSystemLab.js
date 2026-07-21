import { icon } from '../components/Icons.js';
import { openSheet, closeSheet, toast } from '../components/AppSheet.js';
import { sheetActionDockHTML } from '../components/SheetActionDock.js';
import { openPickerSheet, pickerFieldHTML } from '../components/PickerSheet.js';
import { openMoneyCalculatorSheet, moneyFieldHTML } from '../components/MoneyCalculatorSheet.js';
import { datePickerFieldHTML, nativeDateTimeFieldsHTML } from '../components/NativeDateTimeFields.js';
import { openDatePickerSheet } from '../components/DatePickerSheet.js';
import { openTimePickerSheet } from '../components/TimePickerSheet.js';
import {
  actionTileHTML, buttonHTML, chipHTML, dragHandleHTML, feedbackStateHTML,
  fieldHTML, financialSummaryRowHTML, iconButtonHTML, listRowHTML,
  privacyValueHTML, sectionHeaderHTML, segmentedControlHTML, surfaceHTML,
  toggleRowHTML,
} from './DesignSystem.js';
import { DESIGN_SYSTEM_VERSION, LIQUID_CHROME_MATERIAL_VERSION } from './designSystemContract.js';
import { escapeHTML } from '../app/format.js';
import { brandRegistry } from '../domain/brandRegistry.js';
import { assetVisualRegistry } from '../domain/assetVisualRegistry.js';
import { assetBrandVisualHTML } from '../components/AssetBrandVisual.js';
import { ringgitMeCardComposerHTML } from '../components/RinggitMeCardComposer.js';

const labSection = (title, body) => `<section class="rm-lab-section">${sectionHeaderHTML({ title })}<div class="rm-lab-grid">${body}</div></section>`;

function labMarkup() {
  // Phase 2D1B 品牌注册表 remains the stable data source; Phase 2D1B.1 adds
  // review-state and slot-geometry inspection without changing registry IDs.
  const buttonMatrix = ['primary', 'secondary', 'tertiary', 'danger'].map((variant) => buttonHTML({ label: { primary: '主要操作', secondary: '次要操作', tertiary: '文字操作', danger: '删除资料' }[variant], variant })).join('')
    + buttonHTML({ label: '载入中', variant: 'primary', loading: true })
    + buttonHTML({ label: '不可使用', variant: 'primary', disabled: true });
  const brandMatrix = brandRegistry({ includeFallbacks: false }).filter((brand) => brand.entityType !== 'card_network').map((brand) => {
    const slotType = brand.entityType === 'ewallet' ? 'brand_app_icon' : 'brand_compact_mark';
    const pending = assetVisualRegistry({ slotType }).find((asset) => asset.brandId === brand.id);
    return `<article class="rm-lab-brand-card" data-qa-asset-status="${escapeHTML(pending?.status || 'missing')}">${assetBrandVisualHTML({ brandId: brand.id, slotType, entityType: brand.entityType, label: `${brand.displayName}系统 Logo`, qa: true })}<strong>${escapeHTML(brand.displayName)}</strong><small>${escapeHTML(slotType)} · ${escapeHTML(pending?.status || 'missing')}</small><small class="rm-lab-asset-meta">${escapeHTML(pending?.filePath || '无文件')} · 临时系统素材</small><small class="rm-lab-asset-meta">机构 ID 稳定，可独立替换 Logo</small></article>`;
  }).join('');
  const cardMatrix = [
    { type: 'saving', brandId: 'maybank', name: '工资账户', networkId: 'visa', debitCardLast4: '8899' },
    { type: 'cc', brandId: 'cimb', name: '旅行信用卡', networkId: 'mastercard', creditCardLast4: '2211' },
    { type: 'ew', brandId: 'tng', name: '日常电子钱包' },
  ].map((account) => ringgitMeCardComposerHTML(account, { preview: true })).join('');
  const geometryMatrix = [
    { id:'saving-max', account:{ type:'saving',brandId:'standard-chartered',name:'这是一个非常非常长的储蓄账户名称用于几何验证',debitCardLast4:'0012' }, amount:'RM 999,999,999.99', label:'账户余额' },
    { id:'credit-amex', account:{ type:'cc',brandId:'cimb',name:'家庭旅行与日常消费信用卡主账户',creditCardLast4:'8899',networkId:'amex' }, amount:'RM 12,398.25', label:'当前欠款' },
    { id:'credit-visa', account:{ type:'cc',brandId:'maybank',name:'Visa Platinum',creditCardLast4:'9910',networkId:'visa' }, amount:'RM 8,047.80', label:'当前欠款' },
    { id:'ewallet', account:{ type:'ew',brandId:'tng',name:'Touch n Go 日常通勤电子钱包' }, amount:'RM 342.60', label:'账户余额' },
  ].map((item) => `<article class="rm-lab-card-geometry-case" data-qa-card-geometry="${item.id}">${ringgitMeCardComposerHTML(item.account, { amountHTML:`<strong class="num">${item.amount}</strong>`, amountLabel:item.label })}</article>`).join('');
  return `<div class="rm-design-lab" data-design-system-lab data-version="${DESIGN_SYSTEM_VERSION}">
    <header class="rm-lab-topbar rm-glass-chrome"><div><small>RINGGITME LIQUID CHROME iOS</small><h1>视觉系统实验室</h1></div><div class="rm-lab-top-actions">${iconButtonHTML({ label: '切换隐私', iconName: 'eye', variant: 'glass' })}${iconButtonHTML({ label: '个人与设置', iconName: 'user', variant: 'selected' })}</div></header>
    <main class="rm-lab-content">
      ${labSection('Liquid Chrome Material Pilot', `${surfaceHTML({ variant: 'frosted', className: 'rm-lab-material-sample', content: `<strong>液态镀铬玻璃</strong><p>背景透过 20px frost 保留空间层次，静态边缘由局部银白高光与 graphite lowlight 构成。</p><small>${LIQUID_CHROME_MATERIAL_VERSION}</small>` })}<div class="rm-lab-edge-ambient rm-glass-chrome" aria-label="可见移动边缘"><strong>Liquid Chrome Edge</strong><span>单一局部高光沿边缘移动</span></div>${buttonHTML({ label: 'Graphite Primary', variant: 'primary' })}${buttonHTML({ label: 'Pearl Glass Secondary', variant: 'secondary' })}`)}
      ${labSection('按钮层级', buttonMatrix)}
      ${labSection('图标按钮与表面', `${iconButtonHTML({ label: '返回', iconName: 'chevronLeft' })}${iconButtonHTML({ label: '玻璃按钮', iconName: 'dots', variant: 'glass' })}${iconButtonHTML({ label: '危险操作', iconName: 'x', variant: 'danger' })}${surfaceHTML({ variant: 'solid', content: '<strong>扎实金融表面</strong><p>余额与长列表优先清晰度。</p>' })}${surfaceHTML({ variant: 'tonal', content: '<strong>冰银辅助表面</strong><p>用于次级说明与选择状态。</p>' })}${surfaceHTML({ variant: 'frosted', content: '<strong>Liquid Chrome 玻璃</strong><p>真实模糊、银色边缘、内高光与方向阴影。</p>' })}`)}
      ${labSection('表单与选择', `${fieldHTML({ label: '名称', name: 'lab-name', value: '七月生活费', placeholder: '请输入名称' })}${fieldHTML({ label: '错误状态', name: 'lab-error', value: '', error: '请填写有效内容' })}${moneyFieldHTML({ label: '金额', key: 'lab-amount', value: '850.00', caption: '整数 minor units 保持不变' })}${pickerFieldHTML({ label: '付款账户', key: 'lab-account', valueLabel: 'Maybank 储蓄卡', caption: '•••• 8888' })}${datePickerFieldHTML({ label: '日期', key: 'lab-date', value: '2026-07-18' })}${nativeDateTimeFieldsHTML({ prefix: 'lab', date: '2026-07-18', time: '13:14' })}`)}
      ${labSection('控制与状态', `${toggleRowHTML({ label: '设为常用', caption: '之后优先显示', checked: true })}${segmentedControlHTML({ label: '交易类型', selected: 'expense', items: [{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'transfer', label: '转账' }] })}<div class="rm-chip-row">${chipHTML({ label: '餐饮', selected: true })}${chipHTML({ label: '交通' })}${chipHTML({ label: '即将到期', variant: 'warning' })}${chipHTML({ label: '已逾期', variant: 'danger' })}</div>`)}
      ${labSection('动作与列表', `${actionTileHTML({ title: '支付并记录分摊', caption: '核对后再确认记账', iconName: 'aa' })}${listRowHTML({ title: 'Maybank 储蓄卡', caption: '•••• 8888', value: 'RM 6,842.15', iconName: 'wallet' })}${financialSummaryRowHTML({ label: '账户余额', value: 'RM 48,787.14' })}${financialSummaryRowHTML({ label: '本月支出', value: '−RM 2,318.40', tone: 'danger' })}`)}
      ${labSection('覆盖层与反馈', `${buttonHTML({ label: '打开标准 Sheet', variant: 'secondary', attributes: { 'data-lab-action': 'sheet' } })}${buttonHTML({ label: '打开嵌套 Sheet', variant: 'secondary', attributes: { 'data-lab-action': 'nested-sheet' } })}${buttonHTML({ label: '打开选择器', variant: 'secondary', attributes: { 'data-lab-action': 'picker' } })}${buttonHTML({ label: '打开计算器', variant: 'secondary', attributes: { 'data-lab-action': 'calculator' } })}${buttonHTML({ label: '显示 Toast', variant: 'tertiary', attributes: { 'data-lab-action': 'toast' } })}`)}
      ${labSection('空、载入与错误', `${feedbackStateHTML({ type: 'empty', title: '暂时没有记录', message: '完成一笔交易后会显示在这里。', action: '新增记录' })}${feedbackStateHTML({ type: 'loading', title: '正在整理', message: '请稍候，资料很快就好。' })}${feedbackStateHTML({ type: 'error', title: '无法完成', message: '没有任何金额被更改。', action: '再试一次' })}`)}
      ${labSection('长文、隐私与拖动', `<div class="rm-long-copy"><strong>这是用来验证很长的中文与 English mixed-language content 不会被截断的标题</strong><p>金额 ${privacyValueHTML({ label: '隐私金额', value: 'RM 1,234,567,890.12' })} 仍然清晰，并且说明文字可以自然换行。</p></div><div class="rm-reorder-demo">${dragHandleHTML()}<span><strong>拖动排序项目</strong><small>Space / Enter 开始，方向键移动，Escape 取消</small></span></div>`)}
      ${labSection('轻量自动卡面系统', `<p class="rm-lab-review-note">单一确定性系统卡面由机构色板生成；卡组织仅使用文字，不再提供主题或产品选择。</p><div class="rm-lab-card-system-matrix">${cardMatrix}</div>`)}
      ${labSection('卡片几何防碰撞', `<p class="rm-lab-review-note">生产卡片组件的长名称、大金额与卡组织极限组合。</p><div class="rm-lab-card-geometry-matrix">${geometryMatrix}</div>`)}
      ${labSection('品牌与临时系统 Logo', `<p class="rm-lab-review-note">机构 ID 是稳定身份；当前 Logo 是可按机构独立替换的临时系统素材。</p><div class="rm-lab-brand-matrix">${brandMatrix}</div><div class="rm-lab-asset-state-grid"><article data-qa-asset-status="missing">${assetBrandVisualHTML({ slotType: 'brand_compact_mark', entityType: 'bank', label: '缺少素材' })}<strong>missing</strong><small>无文件 · 使用中性银行图标</small></article><article data-qa-asset-status="neutral_system_fallback">${assetBrandVisualHTML({ slotType: 'brand_app_icon', entityType: 'ewallet', label: '中性系统 fallback' })}<strong>neutral_system_fallback</strong><small>不模仿任何品牌</small></article></div>`)}
    </main>
    <nav class="rm-lab-bottom-nav rm-glass-chrome" aria-label="设计系统底部导航"><button class="is-selected">${icon('today', 20)}<span>今天</span></button><button>${icon('assets', 20)}<span>资产</span></button><button class="rm-lab-capture" data-lab-action="calculator">${icon('plus', 22)}</button><button>${icon('activity', 20)}<span>动态</span></button><button>${icon('ledger', 20)}<span>账本</span></button></nav>
  </div>`;
}

export function mountDesignSystemLab(root) {
  root.innerHTML = labMarkup();
  root.classList.add('design-system-lab-host');
  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-lab-action]')?.dataset.labAction;
    if (!action) return;
    if (action === 'toast') return toast('设计系统反馈已显示');
    if (action === 'calculator') return openMoneyCalculatorSheet({ value: '850.00', allowZero: true, onComplete: (value) => toast(`已应用 RM ${value}`) });
    if (action === 'picker') return openPickerSheet({ title: '选择账户', selectedValue: 'maybank', options: [{ value: 'maybank', label: 'Maybank 储蓄卡', caption: '•••• 8888' }, { value: 'cimb', label: 'CIMB OctoSavers', caption: '•••• 2468' }], onSelect: () => toast('选择已更新') });
    const openChild = () => openSheet({ title: '嵌套 Sheet', stacked: true, contentHTML: `${surfaceHTML({ variant: 'tonal', content: '<strong>子层内容</strong><p>Browser Back 会先关闭这一层。</p>' })}${sheetActionDockHTML({ context: 'design-lab-child', primaryLabel: '完成', secondaryLabel: '取消', primaryAttributes: { 'data-action': 'sheet-close' }, secondaryAttributes: { 'data-action': 'sheet-close' } })}` });
    openSheet({ title: action === 'nested-sheet' ? '父层 Sheet' : '标准 Sheet', contentHTML: `${fieldHTML({ label: 'Sheet 字段', name: 'lab-sheet-field', value: '保持清晰可读' })}<div class="rm-lab-inline-actions">${buttonHTML({ label: '日期选择器', variant: 'tertiary', attributes: { 'data-lab-child': 'date' } })}${buttonHTML({ label: '时间选择器', variant: 'tertiary', attributes: { 'data-lab-child': 'time' } })}${action === 'nested-sheet' ? buttonHTML({ label: '打开子层', variant: 'secondary', attributes: { 'data-lab-child': 'nested' } }) : ''}</div>${sheetActionDockHTML({ context: 'design-lab', primaryLabel: '保存', secondaryLabel: '取消', primaryAttributes: { 'data-action': 'sheet-close' }, secondaryAttributes: { 'data-action': 'sheet-close' } })}`, onOpen: (sheet) => sheet.addEventListener('click', (childEvent) => { const child = childEvent.target.closest('[data-lab-child]')?.dataset.labChild; if (child === 'nested') openChild(); if (child === 'date') openDatePickerSheet({ value: '2026-07-18', onComplete: () => toast('日期已更新') }); if (child === 'time') openTimePickerSheet({ value: '13:14', onComplete: () => toast('时间已更新') }); }) });
  });
}
