// Localized copy boundary. Phase 2B3C keeps Chinese active while allowing the
// future system / 中文 / English switch to replace presentation copy without
// changing financial-domain logic.
export const CONFIRMATION_COPY = Object.freeze({
  effect: {
    posted: '账户已更新',
    record_only: '只记录 · 余额未变',
    relationship_only: '关系账已更新 · 余额未变',
    planned: '计划已建立 · 尚未扣款',
  },
  action: {
    continue: '继续记账',
    view: '查看记录',
    done: '完成',
  },
  recent: {
    title: '最近记录',
    expand: '展开更多',
    collapse: '收起',
    viewAccountHistory: '查看{name}全部记录',
    outgoingHistory: '查看转出账户记录',
    incomingHistory: '查看转入账户记录',
  },
});

export const ACTIVITY_COPY = Object.freeze({
  currentAccount: '当前账户',
  clearFilter: '清除',
  emptyAccount: '这个账户还没有记录',
  viewAll: '查看全部动态',
  transactionDetails: '交易资料',
  accountingMethod: '记账方式',
  contextualDetail: '在当前页面查看记录详情',
});

export const CAPTURE_DETAIL_COPY = Object.freeze({
  transactionDetails: '交易资料',
  accountingMethod: '记账方式',
  // Stored `description`/`desc` remains the compatible domain field; in the
  // product it is one transaction note, never a second title field.
  note: '备注',
  notePlaceholder: '点击输入备注',
  relationship: '关系账',
  recordOnly: '只记录',
  balanceNeutral: '不影响账户余额',
});

export const RELATIONSHIP_COPY = Object.freeze({
  explanation: Object.freeze({
    normal: '只影响所选账户，不会创建关系账。',
    split_expense: '按参与者份额记录，并更新应收或应付。',
    direct_receivable: '记录对方欠你的金额，并建立待收。',
    direct_payable: '记录你欠对方的金额，并建立待付。',
  }),
  group: Object.freeze({
    target: '关系对象',
    payerParticipants: '付款与参与',
    splitMethod: '分摊方式',
  }),
  field: Object.freeze({
    target: '对象或群组',
    payer: '谁付款',
    participants: '参与分摊',
  }),
  action: Object.freeze({
    addLocalTarget: '添加本地对象',
    equal: '平均',
    custom: '自定义',
    distributeEvenly: '平均分配',
    fillLast: '补给最后一人',
    clear: '清空',
  }),
  allocation: Object.freeze({
    total: '总额',
    allocated: '已分',
    exact: '分配完成',
    difference: '差额',
    remaining: '剩余',
    excess: '超出',
    remainingPrefix: '还需',
    exactRequired: '自定义分摊必须与总额一致',
  }),
});

export const ASSET_CATEGORY_COPY = Object.freeze({
  saving: {
    totalLabel: '储蓄卡总额',
    countLabel: '账户数量',
    inflowLabel: '本月流入',
    outflowLabel: '本月流出',
    currentLabel: '当前账户',
    balanceLabel: '余额',
    recentChangeLabel: '最近变动',
    recentTitle: '最近记录',
    detailPrefix: '查看',
    detailSuffix: '详情',
  },
  cc: {
    totalLabel: '总欠款',
    countLabel: '卡片数量',
    spendLabel: '本月新增消费',
    paidLabel: '本月已还',
    currentLabel: '当前卡片',
    balanceLabel: '当前欠款',
    dueLabel: '本月待还',
    dueDateLabel: '到期日',
    availableLabel: '可用额度',
    recentTitle: '最近记录',
    detailPrefix: '查看',
    detailSuffix: '详情',
  },
  action: {
    viewAll: '查看全部',
    clearAccountFilter: '清除账户筛选',
  },
});
