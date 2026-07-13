import { createMoneyEngine } from '../domain/moneyEngine.js';
import { createCategoryRepository } from '../domain/categoryRepository.js';

// ============================================================
// RinggitMe 2.0 — demo fixtures (Phase 1 shell only)
//
// FIXTURE BOUNDARY: everything the UI reads comes through
// createDemoDataSource() below. The Phase 2+ adapters (rm_v3 /
// finance-domain / Supabase / AA / invitations / Telegram) will
// implement the same interface; no UI code may import fixture
// objects directly. In-memory only — nothing is persisted.
// ============================================================

export const FIXTURE_TODAY = '2026-07-13';

// ---- Accounts ----------------------------------------------
// type: 'cc' | 'saving' | 'ew'. Card art: local decorative PNGs
// only. Masked final digits only — never full numbers or CVV.
const accounts = [
  {
    id: 'sv-mbb', type: 'saving', name: 'Maybank 储蓄卡', short: 'Maybank 储蓄',
    bank: 'Maybank（马来亚银行）', last4: '8888', balance: 6842.15,
    art: '/assets/cards/maybank-global-access-mastercard-world.png',
    brandColor: '#e8a800', note: 'Emergency Fund',
  },
  {
    id: 'sv-cimb', type: 'saving', name: 'CIMB OctoSavers', short: 'CIMB Octo',
    bank: 'CIMB', last4: '2468', balance: 2400.0,
    art: null, brandColor: '#c0152c', note: '',
  },
  {
    id: 'sv-pbb', type: 'saving', name: 'Public Bank Savings', short: 'Public Bank',
    bank: 'Public Bank', last4: '1357', balance: 3180.5,
    art: null, brandColor: '#8f1d22', note: '',
  },
  {
    id: 'sv-rhb', type: 'saving', name: 'RHB Smart Account', short: 'RHB Smart',
    bank: 'RHB', last4: '7788', balance: 1905.2,
    art: null, brandColor: '#155ba5', note: '日常开销',
  },
  {
    id: 'cc-mbb-visa', type: 'cc', name: 'Maybank Visa Platinum', short: 'Maybank Visa',
    bank: 'Maybank（马来亚银行）', network: 'Visa', last4: '9910',
    art: '/assets/cards/maybank-visa-platinum.png', brandColor: '#17191d',
    limit: 12000, outstanding: 3247.8, monthlyDue: 850, dueDate: '2026-07-26',
    duePaid: false, sharedPool: 'Maybank 共享额度池', sharedPoolTotal: 20000,
  },
  {
    id: 'cc-mbb-ikhwan', type: 'cc', name: 'Maybank Islamic Ikhwan', short: 'Maybank Ikhwan',
    bank: 'Maybank Islamic', network: 'Visa', last4: '4421',
    art: '/assets/cards/maybank-islamic-petronas-ikhwan-visa-platinum.png', brandColor: '#0c3a2b',
    limit: 8000, outstanding: 1120.45, monthlyDue: 380, dueDate: '2026-08-02',
    duePaid: false, sharedPool: 'Maybank 共享额度池', sharedPoolTotal: 20000,
  },
  {
    id: 'cc-rhb', type: 'cc', name: 'RHB Cashback Card', short: 'RHB Cashback',
    bank: 'RHB', network: 'Mastercard', last4: '7712',
    art: null, brandColor: '#0f2f5c',
    limit: 6000, outstanding: 890.0, monthlyDue: 320, dueDate: '2026-08-08',
    duePaid: false, sharedPool: null, sharedPoolTotal: 0,
  },
  {
    id: 'ew-boost', type: 'ew', name: 'Boost', short: 'Boost',
    bank: 'Boost', last4: '', balance: 250.0, art: null, brandColor: '#e8362c', note: '',
  },
  {
    id: 'ew-tng', type: 'ew', name: "Touch 'n Go eWallet", short: "Touch 'n Go",
    bank: 'TNG Digital', last4: '', balance: 342.6, art: null, brandColor: '#134a8e', note: '',
  },
  {
    id: 'ew-grab', type: 'ew', name: 'GrabPay', short: 'GrabPay',
    bank: 'Grab', last4: '', balance: 128.44, art: null, brandColor: '#00804a', note: '',
  },
  {
    id: 'ew-bigpay', type: 'ew', name: 'BigPay', short: 'BigPay',
    bank: 'BigPay', last4: '', balance: 96.2, art: null, brandColor: '#12b5ab', note: '',
  },
];

// ---- Instalments (feed Total Card Debt + monthly due) ------
const instalments = [
  { id: 'in-1', cardId: 'cc-mbb-visa', name: 'MacBook Air 分期', monthly: 400, paidTerms: 12, totalTerms: 24, remaining: 4800 },
  { id: 'in-2', cardId: 'cc-mbb-ikhwan', name: 'iPhone 16 分期', monthly: 195, paidTerms: 12, totalTerms: 24, remaining: 2340 },
];

// ---- Investments & fixed deposits (Assets page sections) ---
const investments = {
  total: 28540.3, portfolios: 3,
  dayGain: 128.5, dayPct: 0.45, monthGain: 986.23, monthPct: 3.58,
  spark: [12, 14, 11, 16, 15, 19, 17, 22, 20, 26, 23, 28],
};

const fixedDeposits = {
  total: 17500, count: 2,
  nextMaturity: '2026-08-18', expectedAtMaturity: 8850.36,
};

// This month in/out for the savings category header
const savingsFlow = { inflow: 4150.0, outflow: 2318.4 };

// ---- Commitments (radar) -----------------------------------
const commitments = [
  { id: 'cm-loan', name: '车贷 Proton X50', amount: 751.2, myShare: 751.2, dueDate: '2026-07-10', sourceId: 'sv-mbb', paid: false, kind: 'loan' },
  { id: 'cm-rent', name: '房租（两人平分）', amount: 1312, myShare: 656, dueDate: '2026-07-15', sourceId: 'sv-mbb', paid: false, kind: 'rent' },
  { id: 'cm-netflix', name: 'Netflix', amount: 54.9, myShare: 54.9, dueDate: '2026-07-20', sourceId: 'cc-mbb-visa', paid: false, kind: 'sub' },
  { id: 'cm-spotify', name: 'Spotify', amount: 23.9, myShare: 23.9, dueDate: '2026-07-28', sourceId: 'ew-tng', paid: false, kind: 'sub' },
];

// ---- Ledger: people ----------------------------------------
const people = [
  { id: 'p-abi', name: 'Abi', net: 250.0, telegram: true },
  { id: 'p-mei', name: 'Mei Ling', net: 136.5, telegram: false },
  { id: 'p-jason', name: 'Jason', net: -32.0, telegram: true },
];

const personCurrent = {
  'p-abi': [
    { id: 'la-1', title: '日本机票代付', total: 400, settled: 150, date: '2026-07-02', attachments: 1 },
  ],
  'p-mei': [
    { id: 'lm-1', title: '车油钱 AA', total: 86.5, settled: 0, date: '2026-07-08', attachments: 0 },
    { id: 'lm-2', title: '晚餐 · 鼎泰丰', total: 50, settled: 0, date: '2026-07-11', attachments: 1 },
  ],
  'p-jason': [
    { id: 'lj-1', title: '羽球场地费', total: 32, settled: 0, date: '2026-07-09', attachments: 0 },
  ],
};

const recentSettlements = [
  { id: 'st-1', person: 'Abi', amount: 150.0, date: '2026-07-05', via: 'Maybank 储蓄卡' },
  { id: 'st-2', person: 'Mei Ling', amount: 86.5, date: '2026-06-28', via: "Touch 'n Go eWallet" },
  { id: 'st-3', person: 'Jason', amount: 45.0, date: '2026-06-20', via: '现金（只记录）' },
];

// Deterministic 65-item history per person → proves 30 + Load More + reset
const HIST_TITLES = ['午餐 AA', '晚餐 AA', 'Grab 车费', '电影票', '日用品代买', '水电费平分', '奶茶', '停车费', '演唱会门票', '烧烤材料'];
function buildHistory(personId, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const day = ((i * 7) % 28) + 1;
    const month = 6 - Math.floor(i / 14); // walk backwards from Jun 2026
    const m = ((month - 1 + 12) % 12) + 1;
    const y = month >= 1 ? 2026 : 2025;
    const amount = Math.round((12 + ((i * 37) % 180) + ((i % 3) * 0.5)) * 100) / 100;
    rows.push({
      id: `${personId}-h${i}`,
      title: HIST_TITLES[i % HIST_TITLES.length],
      amount,
      direction: i % 4 === 3 ? 'pay' : 'receive',
      date: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      attachments: i % 5 === 0 ? 1 : 0,
      settledVia: i % 4 === 1 ? "Touch 'n Go eWallet" : i % 4 === 2 ? '现金（只记录）' : 'Maybank 储蓄卡',
    });
  }
  return rows;
}
const personHistory = {
  'p-abi': buildHistory('p-abi', 65),
  'p-mei': buildHistory('p-mei', 42),
  'p-jason': buildHistory('p-jason', 31),
};

// ---- Ledger: groups ----------------------------------------
const groups = [
  { id: 'g-jp', name: '日本旅行 2026', members: 4, myNet: 210.0, lastActivity: '2026-07-11' },
  { id: 'g-room', name: '室友账本', members: 3, myNet: -45.0, lastActivity: '2026-07-09' },
];

// ---- Activity feed -----------------------------------------
const CATS = [
  { id: 'food', label: '餐饮', icon: 'food' },
  { id: 'grocery', label: '日用', icon: 'cart' },
  { id: 'transport', label: '交通', icon: 'car' },
  { id: 'fun', label: '娱乐', icon: 'ticket' },
  { id: 'bill', label: '账单', icon: 'receipt' },
  { id: 'health', label: '医疗', icon: 'heart' },
];
const MERCHANTS = {
  food: ['KFC', 'Nasi Lemak Wanjo', '鼎泰丰', 'ZUS Coffee', 'Mamak 档', 'Sushi Zanmai'],
  grocery: ['Lotus’s', 'Jaya Grocer', '99 Speedmart', 'Mr DIY'],
  transport: ['Petronas 加油', 'Touch n Go 过路费', 'Grab 车费', 'MRT 充值'],
  fun: ['GSC 电影', 'Steam', 'Spotify', '羽球场'],
  bill: ['TNB 电费', 'Air Selangor 水费', 'Unifi 网费', 'Maxis 话费'],
  health: ['Guardian', 'Klinik Mediviron', 'Watsons'],
};
const ACTIVITY_ACCOUNTS = ['sv-mbb', 'cc-mbb-visa', 'ew-tng', 'cc-mbb-ikhwan', 'sv-cimb', 'cc-rhb', 'ew-boost', 'sv-rhb'];

function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildActivities() {
  const rows = [];
  let n = 0;
  // ~80 entries walking back from today across Jul + Jun
  for (let back = 0; back < 36; back++) {
    const d = new Date(`${FIXTURE_TODAY}T12:00:00`);
    d.setDate(d.getDate() - back);
    const iso = localISO(d);
    const perDay = back % 3 === 0 ? 3 : 2;
    for (let k = 0; k < perDay; k++) {
      const cat = CATS[(back + k * 2) % CATS.length];
      const names = MERCHANTS[cat.id];
      const isIncome = n % 17 === 8;
      const isTransfer = n % 23 === 15;
      const shared = n % 9 === 4;
      const amount = isIncome
        ? [3800, 250, 120][n % 3]
        : Math.round((6 + ((n * 53) % 140) + (n % 2) * 0.9) * 100) / 100;
      rows.push({
        id: `t-${n}`,
        kind: isTransfer ? 'transfer' : isIncome ? 'income' : 'expense',
        desc: isTransfer ? "转账 · 储蓄 → Touch 'n Go" : isIncome ? (n % 3 === 0 ? '工资 Salary' : 'AA 收回') : names[(n + k) % names.length],
        catId: isTransfer ? 'transfer-fallback' : isIncome ? (n % 3 === 0 ? 'income-salary' : 'income-aa') : cat.id,
        catLabel: isTransfer ? '转账' : isIncome ? '收入' : cat.label,
        accountId: ACTIVITY_ACCOUNTS[n % ACTIVITY_ACCOUNTS.length],
        amount,
        date: iso,
        time: `${String(9 + ((n * 3) % 12)).padStart(2, '0')}:${String((n * 11) % 60).padStart(2, '0')}`,
        shared,
        receipt: n % 12 === 6,
        photo: n % 15 === 10,
        editHistory: [],
      });
      n++;
    }
  }
  return rows;
}

// ---- Data source interface (the adapter boundary) ----------
export function createDemoDataSource() {
  const engine = createMoneyEngine({ accounts, transactions: buildActivities(), today: FIXTURE_TODAY });
  const categoryRepo = createCategoryRepository();
  let commitmentState = structuredClone(commitments);

  const ofType = (type) => engine.getAccounts().filter((account) => account.type === type);
  const instalmentRemaining = () => instalments.reduce((sum, item) => sum + item.remaining, 0);
  const instalmentMonthly = () => instalments.reduce((sum, item) => sum + item.monthly, 0);
  const cardDueThisMonth = () =>
    ofType('cc').filter((account) => !account.duePaid).reduce((sum, account) => sum + account.monthlyDue, 0) + instalmentMonthly();
  const aaReceivable = () => people.reduce((sum, person) => sum + Math.max(0, person.net), 0);
  const userTransactions = () => engine.getUserTransactions();
  const decorateTransaction = (transaction) => {
    if (!transaction) return transaction;
    const category = categoryRepo.getCategory(transaction.catId);
    const noPurpose = transaction.kind === 'transfer' && (!transaction.catId || transaction.catId === 'transfer-fallback');
    const label = noPurpose ? '转账' : category?.name || transaction.catLabel;
    return { ...transaction, catLabel: label, category: label, categoryArchived: Boolean(category?.isArchived), categoryIcon: category?.icon || null, categoryThemeToken: category?.themeToken || 'slate' };
  };

  return {
    today: FIXTURE_TODAY,

    // Money Pulse metric set — business meanings per blueprint §14.1.
    // Fixture-derived here; Phase 2 swaps in the frozen rm_v3 functions
    // (getCashNow / getMyMonthlyFixedTotal18_5B / getTotalCardDebt /
    // getPendingCardDue / getAfterCardPaymentCash / getAAReceivables /
    // getFullPayoffPosition) behind this same shape.
    getPulse() {
      return engine.getDerivedMetrics({
        investmentTotal: investments.total,
        fixedDepositTotal: fixedDeposits.total,
        instalmentRemaining: instalmentRemaining(),
        monthCardDue: cardDueThisMonth(),
        aaReceivable: aaReceivable(),
        myFixed: Math.round(commitmentState.reduce((sum, commitment) => sum + commitment.myShare, 0) * 100) / 100,
      });
    },

    subscribe: (listener) => engine.subscribe(listener),
    getAccounts: () => engine.getAccounts(),
    getAccountsByType: (type) => ofType(type),
    getAccount: (id) => engine.getAccount(id),
    getAccountBalance: (id) => engine.getAccountBalance(id),
    getInstalments: (cardId) => instalments.filter((i) => i.cardId === cardId),
    getInvestments: () => investments,
    getFixedDeposits: () => fixedDeposits,
    getSavingsFlow() {
      const inflow = userTransactions()
        .filter((transaction) => !transaction.recordOnly && transaction.kind === 'income' && engine.getAccount(transaction.destinationAccountId)?.type === 'saving')
        .reduce((sum, transaction) => sum + transaction.amount, savingsFlow.inflow);
      const outflow = userTransactions()
        .filter((transaction) => !transaction.recordOnly && transaction.kind === 'expense' && engine.getAccount(transaction.sourceAccountId)?.type === 'saving')
        .reduce((sum, transaction) => sum + transaction.amount, savingsFlow.outflow);
      return { inflow, outflow };
    },
    getCommitments: () => commitmentState,
    setCommitmentPaid(id, paid) {
      const c = commitmentState.find((x) => x.id === id);
      if (c) c.paid = paid;
    },
    getBudget() {
      const addedSpend = userTransactions()
        .filter((transaction) => !transaction.recordOnly && transaction.kind === 'expense' && transaction.date.startsWith('2026-07'))
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      return { month: '2026-07', total: 2500, used: 1684.3 + addedSpend };
    },
    getCategories: (type = 'expense', options) => categoryRepo.getCategories(type, options),
    getCategory: (id) => categoryRepo.getCategory(id),
    getQuickCategories: (type) => categoryRepo.getQuickCategories(type),
    getDefaultCategory: (type) => categoryRepo.getDefault(type),
    getDefaultCategoryId: (type) => categoryRepo.getDefaultId(type),
    getCategorySnapshot: () => categoryRepo.getSnapshot(),
    createCategory: (input) => categoryRepo.create(input),
    updateCategory: (id, changes) => categoryRepo.update(id, changes),
    setDefaultCategory: (type, id) => categoryRepo.setDefault(type, id),
    moveCategory: (id, direction) => categoryRepo.move(id, direction),
    reorderCategories: (type, orderedIds) => categoryRepo.reorderActive(type, orderedIds),
    toggleCategoryPin: (id) => categoryRepo.togglePin(id),
    archiveCategory: (id) => categoryRepo.archive(id),
    restoreCategory: (id) => categoryRepo.restore(id),
    removeCategory(id) {
      const used = engine.getTransactions({ includeReversed: true }).some((transaction) => transaction.catId === id);
      return categoryRepo.remove(id, used);
    },
    resetCategoryType: (type) => categoryRepo.resetType(type),
    getRecentCategories: () => categoryRepo.getQuickCategories('expense'),

    getActivities: () => engine.getTransactions().map(decorateTransaction),
    getTransactions: (options) => engine.getTransactions(options).map(decorateTransaction),
    getActivity: (id) => decorateTransaction(engine.getTransaction(id)),
    getTransaction: (id) => decorateTransaction(engine.getTransaction(id)),
    getTransactionMutationPolicy: (transactionOrId) => engine.getTransactionMutationPolicy(transactionOrId),
    addTransaction(draft) {
      const cat = categoryRepo.getCategory(draft.catId);
      const noPurpose = draft.kind === 'transfer' && (!cat || cat.isSystemFallback);
      return decorateTransaction(engine.addTransaction({
        ...draft,
        catId: draft.catId || (draft.kind === 'transfer' ? 'transfer-fallback' : categoryRepo.getDefaultId(draft.kind)),
        catLabel: noPurpose ? '转账' : draft.catLabel || cat?.name,
        category: noPurpose ? '转账' : draft.category || cat?.name,
      }));
    },
    editTransaction(id, changes) {
      const category = categoryRepo.getCategory(changes.catId);
      const noPurpose = (changes.kind || engine.getTransaction(id)?.kind) === 'transfer' && (!category || category.isSystemFallback);
      return decorateTransaction(engine.editTransaction(id, {
        ...changes,
        ...(changes.catId ? { catLabel: noPurpose ? '转账' : category?.name, category: noPurpose ? '转账' : category?.name } : {}),
      }));
    },
    reverseTransaction: (id) => engine.reverseTransaction(id),
    deleteTransaction: (id) => engine.deleteTransaction(id),
    transferFunds: (draft) => engine.transferFunds(draft),
    getDerivedMetrics() {
      return this.getPulse();
    },
    getTransactionAccountLabel(transaction) {
      const source = transaction.sourceAccountId ? engine.getAccount(transaction.sourceAccountId) : null;
      const destination = transaction.destinationAccountId ? engine.getAccount(transaction.destinationAccountId) : null;
      if (transaction.kind === 'transfer') return `${source?.name || '—'} → ${destination?.name || '—'}`;
      return (transaction.kind === 'income' ? destination : source)?.name || '—';
    },
    getTransactionCategoryLabel: (transaction) => decorateTransaction(transaction)?.catLabel || '—',
    resetDemoData() {
      commitmentState = structuredClone(commitments);
      engine.resetDemoData();
      categoryRepo.resetAll();
    },
    projectAAReceivable: (...args) => engine.projectAAReceivable(...args),
    settleAAReceivable: (...args) => engine.settleAAReceivable(...args),
    reverseAAProjection: (...args) => engine.reverseAAProjection(...args),
    postFixedExpense: (...args) => engine.postFixedExpense(...args),
    reverseFixedExpense: (...args) => engine.reverseFixedExpense(...args),

    getPeople: () => people,
    getPerson: (id) => people.find((p) => p.id === id),
    getPersonCurrent: (id) => personCurrent[id] || [],
    getPersonHistory: (id) => personHistory[id] || [],
    getRecentSettlements: () => recentSettlements,
    getGroups: () => groups,
    getReceiveTargets: () =>
      engine.getAccounts()
        .filter((a) => a.type !== 'cc')
        .map((a) => ({ id: a.id, name: a.name, type: a.type, note: a.type === 'ew' ? '入账 eWallet' : '入账储蓄' }))
        .concat([{ id: 'cash', name: '现金', type: 'cash', note: '只记录，不动余额' }]),
  };
}
