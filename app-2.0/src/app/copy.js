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

export const FIXED_CENTER_COPY = Object.freeze({
  title: '固定与订阅',
  myFixed: '我的固定',
  paid: '已付',
  pending: '待付',
  overdue: '逾期',
  dueSoon: '即将到期',
  monthPlan: '本月计划',
  completed: '已完成',
  paused: '已暂停',
  totalBill: '账单总额',
  ownShare: '我的份额',
  plannedCashOutflow: '实际预计付款',
  plannedReceivable: '预计待收',
  plannedPayable: '预计待付',
  monthly: '每月',
  yearly: '每年',
  due: '到期',
  dueToday: '今天到期',
  skipped: '已跳过',
  notStarted: '尚未开始',
  lived: '已居住',
  subscribed: '已订阅',
  empty: '暂无固定计划',
  currentMonth: '返回本月',
  stopped: '已停止',
});

export const FIXED_MANAGEMENT_COPY = Object.freeze({
  newPlan: '新增计划', createPlan: '创建计划', editPlan: '编辑计划', saveChanges: '保存修改', detail: '计划详情',
  fixedExpense: '固定支出', subscription: '订阅', relationship: '关系固定', planName: '计划名称', visual: '图标或 Logo',
  billAmount: '账单金额', frequency: '付款频率', monthlyDue: '每月到期日', yearlyDue: '每年到期日', paymentAccount: '付款账户',
  shared: '与他人分摊', target: '对象或群组', payer: '谁付款', total: '账单总额', ownShare: '我的份额',
  plannedPayment: '实际预计付款', receivable: '预计待收', payable: '预计待付', moveIn: '搬入日期', subscribedAt: '开始订阅日期',
  more: '更多设置', startDate: '开始日期', endDate: '结束日期', pause: '暂停计划', resume: '恢复计划', stop: '停止计划',
  history: '账期记录', locked: '本期账期已锁定', nextPeriod: '修改将从下一期生效', discardTitle: '放弃尚未保存的修改？',
  continueEditing: '继续编辑', discard: '放弃修改', duplicateTitle: '这项计划可能已经存在', viewExisting: '查看现有计划',
  continueCreate: '继续建立', returnEdit: '返回修改', ledgerManaged: '由账本管理',
  switchAndClear: '切换并清除', deletePlanLabel: '删除计划', deletePlanTitle: '删除这项计划？', deleteBlockedTitle: '这项计划不能直接删除',
  archivePlan: '归档计划', stopAndArchive: '停止并归档', archived: '已归档', viewArchive: '查看归档', unarchive: '取消归档',
  newLedger: '新增账本', addPerson: '添加个人', createGroup: '建立群组', groupName: '群组名称', addMember: '添加成员',
  viewAllPlans: '查看全部计划', firstOccurrence: '首次账期', alreadyRepaidQuestion: '已经还过一部分了吗？', notStartedRepayment: '还没开始',
  hasRepaid: '已经还了一部分', enterRemaining: '填写目前剩余欠款', enterRepaid: '填写已经还了多少', nextRepayment: '接下来怎么还？',
  byMonths: '按月数还清', fixedMonthly: '固定每月金额', expectedPeriods: '预计剩余期数', finalInstallment: '最后一期金额',
  commonExpense: '共同费用', paymentFlowQuestion: '钱是怎样付的？', onePaysFirst: '一人先付，其他人再还', collectThenPay: '大家先交给一人，由他统一付款',
  subscriptionPayer: '谁负责扣款？', ownAccount: '我自己的账户', otherPays: '对方账户代付', userPaysForOther: '我替对方扣款', sharedSubscription: '共同分担',
});
