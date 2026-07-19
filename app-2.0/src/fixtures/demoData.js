import { createMoneyEngine } from '../domain/moneyEngine.js';
import { createCategoryRepository } from '../domain/categoryRepository.js';
import { createParticipantRepository } from '../domain/participantRepository.js';
import { createRelationshipLedgerRepository } from '../domain/relationshipLedgerRepository.js';
import { createRelationshipLedgerEngine } from '../domain/relationshipLedgerEngine.js';
import { memberBalances } from '../domain/relationshipSelectors.js';
import { createIntegrationOutbox } from '../domain/integrationOutbox.js';
import { createAttachmentStore } from '../domain/attachmentRepository.js';
import { createObligationRepository } from '../domain/obligationRepository.js';
import { createObligationEngine } from '../domain/obligationEngine.js';
import { RELATIONSHIP_PARTICIPANTS, RELATIONSHIP_LEDGERS, RELATIONSHIP_ENTRIES } from './relationshipFixtures.js';
import { OBLIGATION_PLANS, OBLIGATION_INSTANCES, OBLIGATION_PAYMENTS } from './obligationFixtures.js';
import { createRecurringPlanRepository } from '../domain/recurringPlanRepository.js';
import { createRecurringPlanManagementGateway } from '../domain/recurringPlanManagement.js';
import { buildOccurrenceSnapshot, dueSoonReminderIntents } from '../domain/recurringSchedule.js';
import { dedupeCanonicalPlans, projectFixedRelationshipsForLedger, projectObligationOccurrence, projectObligationPlan, selectRecurringMonth } from '../domain/recurringPlanSelectors.js';
import { RECURRING_PLAN_FIXTURES, RECURRING_OCCURRENCE_FIXTURES } from './recurringPlanFixtures.js';
import { buildLedgerRecurringProjection, selectRecurringPlansForLedger } from '../domain/ledgerRecurringProjection.js';
import { createRecipientPaymentProfileRepository } from '../domain/recipientPaymentProfiles.js';
import { buildRecipientDirectory, recipientIdentityForPlan } from '../domain/recipientDirectory.js';
import { RECIPIENT_PAYMENT_PROFILE_FIXTURES } from './recipientPaymentProfileFixtures.js';
import { createRecurringPostingExecutor } from '../domain/recurringPostingExecutor.js';

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
    art: 'assets/cards/maybank-global-access-mastercard-world.png',
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
    art: 'assets/cards/maybank-visa-platinum.png', brandColor: '#17191d',
    limit: 12000, outstanding: 3247.8, monthlyDue: 850, dueDate: '2026-07-26',
    duePaid: false, sharedPool: 'Maybank 共享额度池', sharedPoolTotal: 20000,
  },
  {
    id: 'cc-mbb-ikhwan', type: 'cc', name: 'Maybank Islamic Ikhwan', short: 'Maybank Ikhwan',
    bank: 'Maybank Islamic', network: 'Visa', last4: '4421',
    art: 'assets/cards/maybank-islamic-petronas-ikhwan-visa-platinum.png', brandColor: '#0c3a2b',
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
  { id: 'cm-rent', name: '房租（两人平分）', amount: 1312, myShare: 656, dueDate: '2026-07-15', sourceId: 'sv-mbb', paid: false, kind: 'rent', recurringPlanId: 'fixed-rent-shared' },
  { id: 'cm-netflix', name: 'Netflix', amount: 54.9, myShare: 54.9, dueDate: '2026-07-20', sourceId: 'cc-mbb-visa', paid: false, kind: 'sub', recurringPlanId: 'subscription-netflix' },
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
const FIXTURE_ATTACHMENT_IDS = ['att-fixture-receipt', 'att-fixture-invoice', 'att-fixture-warranty'];
const ATTACHMENT_FIXTURES = [
  {
    attachmentId: FIXTURE_ATTACHMENT_IDS[0], ownerEntityType: 'transaction', ownerEntityId: 't-0', sortOrder: 0,
    name: 'KFC-receipt.jpg', mimeType: 'image/svg+xml', kind: 'photo', sizeBytes: 48231,
    localObjectUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="420"%3E%3Crect width="320" height="420" rx="24" fill="%23f7f3ec"/%3E%3Crect x="30" y="28" width="260" height="72" rx="18" fill="%23c43d35"/%3E%3Ctext x="160" y="74" text-anchor="middle" font-family="Arial" font-size="28" font-weight="700" fill="white"%3EKFC%3C/text%3E%3Ctext x="42" y="145" font-family="Arial" font-size="20" fill="%23222"%3EReceipt%3C/text%3E%3Cpath d="M42 172h236M42 212h236M42 252h236M42 292h236" stroke="%23c9c2b8" stroke-width="3"/%3E%3Ctext x="42" y="345" font-family="Arial" font-size="22" fill="%23222"%3ETotal%3C/text%3E%3Ctext x="278" y="345" text-anchor="end" font-family="Arial" font-size="22" font-weight="700" fill="%23222"%3ERM 6.00%3C/text%3E%3C/svg%3E',
    thumbnail: { kind: 'image', url: '' }, source: 'migration', clientEventId: 'fixture-att-receipt', createdAt: '2026-07-13T09:00:00+08:00', updatedAt: '2026-07-13T09:00:00+08:00',
  },
  {
    attachmentId: FIXTURE_ATTACHMENT_IDS[1], ownerEntityType: 'transaction', ownerEntityId: 't-0', sortOrder: 1,
    name: 'order-confirmation.pdf', mimeType: 'application/pdf', kind: 'pdf', sizeBytes: 118204,
    localObjectUrl: '', thumbnail: { kind: 'tile', label: 'PDF' }, source: 'migration', clientEventId: 'fixture-att-invoice', createdAt: '2026-07-13T09:00:00+08:00', updatedAt: '2026-07-13T09:00:00+08:00',
  },
  {
    attachmentId: FIXTURE_ATTACHMENT_IDS[2], ownerEntityType: 'transaction', ownerEntityId: 't-0', sortOrder: 2,
    name: 'KFC-Sunway-Pyramid-purchase-warranty-and-itemised-order-details-2026-07-13.txt', mimeType: 'text/plain', kind: 'file', sizeBytes: 7741,
    localObjectUrl: '', thumbnail: { kind: 'tile', label: 'TXT' }, source: 'migration', clientEventId: 'fixture-att-warranty', createdAt: '2026-07-13T09:00:00+08:00', updatedAt: '2026-07-13T09:00:00+08:00',
  },
];

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
  const attachmentTransaction = rows.find((row) => row.id === 't-0');
  if (attachmentTransaction) attachmentTransaction.attachmentIds = [...FIXTURE_ATTACHMENT_IDS];
  return rows;
}

// ---- Data source interface (the adapter boundary) ----------
export function createDemoDataSource({ recurringPostingFaultInjector = null } = {}) {
  const engine = createMoneyEngine({ accounts, transactions: buildActivities(), installments: instalments, today: FIXTURE_TODAY });
  const categoryRepo = createCategoryRepository();
  const participantRepo = createParticipantRepository(RELATIONSHIP_PARTICIPANTS);
  const ledgerRepo = createRelationshipLedgerRepository({ ledgers: RELATIONSHIP_LEDGERS, entries: RELATIONSHIP_ENTRIES });
  const outbox = createIntegrationOutbox();
  const attachmentStore = createAttachmentStore({ initialAttachments: ATTACHMENT_FIXTURES });
  const relationshipLinks = new Map();
  const relationship = createRelationshipLedgerEngine({ participants: participantRepo, repository: ledgerRepo, outbox, financial: {
    addTransaction: (draft) => engine.addTransaction(draft),
    assertTransactionCapacity: (draft, options) => engine.assertTransactionCapacity(draft, options),
    reverseTransaction: (id) => engine.reverseTransaction(id, { force: true }),
    defaultAccountId: () => engine.getAccounts().find((account) => account.type !== 'cc')?.id,
    linkTransaction: (transactionId, entityId) => { if (transactionId) relationshipLinks.set(transactionId, entityId); },
  } });
  const obligationRepo = createObligationRepository({ plans: OBLIGATION_PLANS, instances: OBLIGATION_INSTANCES, payments: OBLIGATION_PAYMENTS });
  const obligationLinks = new Map();
  const obligations = createObligationEngine({ repository: obligationRepo, getLedger: (id) => ledgerRepo.getLedger(id), outbox, today: () => FIXTURE_TODAY, financial: {
    addTransaction: (draft) => engine.addTransaction(draft),
    assertTransactionCapacity: (draft, options) => engine.assertTransactionCapacity(draft, options),
    reverseTransaction: (id) => engine.reverseTransaction(id, { force: true }),
    defaultAccountId: () => engine.getAccounts().find((account) => account.type !== 'cc')?.id,
    linkTransaction: (transactionId, paymentId) => { if (transactionId) obligationLinks.set(transactionId, paymentId); },
  } });
  const recurringPlans = createRecurringPlanRepository({
    plans: RECURRING_PLAN_FIXTURES,
    occurrences: RECURRING_OCCURRENCE_FIXTURES,
    accountExists: (id) => Boolean(engine.getAccount(id)),
    participantExists: (id) => Boolean(participantRepo.get(id)),
    ledgerExists: (id) => Boolean(ledgerRepo.getLedger(id)),
    clock: () => `${FIXTURE_TODAY}T09:00:00+08:00`,
  });
  const recurringManagement = createRecurringPlanManagementGateway({
    recurringRepository: recurringPlans,
    obligationEngine: obligations,
    today: () => FIXTURE_TODAY,
  });
  const recipientPaymentProfiles = createRecipientPaymentProfileRepository({
    profiles: RECIPIENT_PAYMENT_PROFILE_FIXTURES,
    clock: () => `${FIXTURE_TODAY}T09:00:00+08:00`,
  });
  const resolveObligationPostingContext = (planId, occurrenceId) => {
    const sourcePlan = obligationRepo.getPlans()
      .find((candidate) => projectObligationPlan(candidate)?.id === planId);
    if (!sourcePlan) return { plan: null, occurrence: null, sourceType: null };
    const plan = projectObligationPlan(sourcePlan);
    const sourceInstance = obligationRepo.getInstances(sourcePlan.planId)
      .find((candidate) => projectObligationOccurrence(sourcePlan, candidate, FIXTURE_TODAY)?.id === occurrenceId);
    if (!sourceInstance) return { plan: null, occurrence: null, sourceType: null };
    return {
      plan,
      occurrence: projectObligationOccurrence(sourcePlan, sourceInstance, FIXTURE_TODAY),
      sourceType: 'obligation_plan',
      sourcePlan,
      sourceInstance,
    };
  };
  const recurringTransactionLinks = new Map();
  const recurringPosting = createRecurringPostingExecutor({
    adapter: {
      money: engine,
      recurring: recurringPlans,
      relationship: ledgerRepo,
      attachments: attachmentStore,
      outbox,
      obligation: {
        resolveContext: resolveObligationPostingContext,
        recordPayment: (command) => obligations.recordPayment(command),
        reversePayment: (paymentId, command) => obligations.reversePayment(paymentId, command),
        createCheckpoint: () => obligations.createCheckpoint(),
        restoreCheckpoint: (checkpoint) => obligations.restoreCheckpoint(checkpoint),
        skipOccurrence(instanceId, postingAudit) {
          return obligationRepo.updateInstance(instanceId, {
            status: 'skipped',
            recurringPostingId: postingAudit.postingId,
            postingAudit: structuredClone(postingAudit),
          });
        },
        restoreOccurrence(instanceId, before, reversalAudit) {
          return obligationRepo.updateInstance(instanceId, {
            amountPaidMinor: before.amountPaidMinor,
            status: before.status,
            settlementIds: structuredClone(before.settlementIds || []),
            recurringPostingId: before.recurringPostingId || null,
            postedTransactionId: before.postedTransactionId || null,
            postedAmountMinor: before.postedAmountMinor || null,
            attachmentIds: structuredClone(before.attachmentIds || []),
            postingAudit: structuredClone(before.postingAudit || null),
            reversalAudit: structuredClone(reversalAudit),
          });
        },
      },
      participants: () => participantRepo.getAll(),
      participantName: (id) => participantRepo.get(id)?.displayName || (id === 'participant-me' ? '我' : '关系对象'),
      linkTransaction(transactionId, relationshipEntityId, postingId) {
        if (transactionId) {
          recurringTransactionLinks.set(transactionId, postingId);
          if (relationshipEntityId) relationshipLinks.set(transactionId, relationshipEntityId);
        }
      },
    },
    clock: () => `${FIXTURE_TODAY}T09:00:00+08:00`,
    faultInjector: recurringPostingFaultInjector,
  });
  const emitAttachmentEvent = (eventType, attachment, clientEventId, payload = {}) => outbox.emit({
    clientEventId, eventType, sourceChannel: 'app', actorUserId: 'user-winner', participantId: null,
    ledgerId: null, entityId: attachment?.attachmentId || payload.entityId || null, revision: 1,
    occurredAt: new Date().toISOString(), payload: { ownerEntityType: attachment?.ownerEntityType, ownerEntityId: attachment?.ownerEntityId, ...payload },
  });
  let commitmentState = structuredClone(commitments);

  const ofType = (type) => engine.getAccounts().filter((account) => account.type === type && account.status === 'active' && !account.isHidden);
  const aaReceivable = () => relationship.getOverview().totals.receivableMinor / 100;
  const userTransactions = () => engine.getUserTransactions();
  const decorateTransaction = (transaction) => {
    if (!transaction) return transaction;
    const category = categoryRepo.getCategory(transaction.catId);
    const noPurpose = transaction.kind === 'transfer' && (!transaction.catId || transaction.catId === 'transfer-fallback');
    const label = noPurpose ? '转账' : category?.name || transaction.catLabel;
    const attachments = attachmentStore.getMany(transaction.attachmentIds || []);
    const attachmentCount = attachments.length || (transaction.attachment || transaction.receipt || transaction.photo ? 1 : 0);
    return { ...transaction, catLabel: label, category: label, categoryArchived: Boolean(category?.isArchived && !category?.isSystemFallback), categoryIcon: category?.icon || null, categoryThemeToken: category?.themeToken || 'slate', attachments, attachmentCount };
  };
  const decorateAssetOperation = (operation) => {
    if (!operation) return operation;
    const labels = {
      asset_adjustment: ['余额调整', '账户调整'],
      asset_opening_balance: ['初始余额', '账户初始值'],
      card_opening_debt: ['导入已有欠款', '信用卡欠款'],
      card_opening_credit: ['导入卡片溢缴余额', '信用卡初始值'],
      card_fee: [operation.metadata?.description || '费用与利息', '信用卡费用'],
      card_installment_purchase: ['新增信用卡分期', '信用卡分期'],
      card_installment_conversion: ['消费转为分期', '信用卡分期'],
      card_installment_import: ['导入已有分期', '信用卡分期'],
      card_payment: ['信用卡还款', '信用卡还款'],
      card_refund: [operation.metadata?.description || '信用卡退款', '信用卡退款'],
      card_linked_refund: ['原消费退款', '信用卡退款'],
      card_general_credit: ['一般卡片退款', '信用卡退款'],
    };
    const [desc, catLabel] = labels[operation.type] || ['账户操作', '账户操作'];
    const cardId = operation.metadata?.cardId || null;
    const accountId = operation.metadata?.accountId || cardId;
    const sourceAccountId = operation.type === 'card_payment' ? operation.metadata?.sourceAccountId : ['card_fee', 'card_installment_purchase'].includes(operation.type) ? cardId : null;
    const destinationAccountId = operation.type === 'card_payment' ? cardId : operation.type === 'card_refund' ? cardId : null;
    const signedMinor = operation.metadata?.deltaMinor ?? operation.metadata?.amountMinor
      ?? operation.result?.amountMinor ?? operation.result?.deltaMinor ?? 0;
    const occurredAt = operation.createdAt || `${FIXTURE_TODAY}T09:00:00+08:00`;
    return {
      id: operation.id,
      assetOperation: true,
      assetOperationType: operation.type,
      kind: ['card_fee', 'card_installment_purchase'].includes(operation.type) ? 'expense' : 'transfer',
      desc,
      catId: null,
      catLabel,
      category: catLabel,
      categoryThemeToken: operation.type === 'card_refund' ? 'mint' : 'slate',
      accountId,
      sourceAccountId,
      destinationAccountId,
      amountMinor: Math.abs(Number(signedMinor)),
      amount: Math.abs(Number(signedMinor)) / 100,
      accountEffect: 'asset_operation',
      date: occurredAt.slice(0, 10),
      time: occurredAt.slice(11, 16),
      occurredAt,
      createdAt: occurredAt,
      updatedAt: operation.updatedAt || occurredAt,
      status: operation.status,
      reversalAudit: operation.status === 'reversed' ? operation.reversal || { restoredExactly: true } : null,
      editHistory: [],
      attachmentIds: [],
      attachments: [],
      attachmentCount: 0,
      lockedReason: '资产与信用卡操作请使用安全撤销。',
    };
  };
  const fixedCenterProjection = (monthKey = FIXTURE_TODAY.slice(0, 7), referenceDate = FIXTURE_TODAY) => {
    const fixedPlans = recurringPlans.listPlans();
    const fixedOccurrences = [];
    fixedPlans.filter((plan) => !plan.archivedAt).forEach((plan) => {
      const generated = recurringPlans.generateOccurrence(plan.id, monthKey, { referenceDate, generatedAt: `${referenceDate}T09:00:00+08:00`, preserveLocked: true });
      if (generated.occurrence) fixedOccurrences.push(generated.occurrence);
    });
    const obligationPlans = obligationRepo.getPlans().map((plan) => projectObligationPlan(plan)).filter(Boolean);
    const obligationOccurrences = obligationPlans.flatMap((projectedPlan) => {
      const sourcePlan = obligationRepo.getPlan(projectedPlan.canonicalSource.sourceId);
      const authoritative = obligationRepo.getInstances(sourcePlan.planId).find((instance) => instance.dueDate.startsWith(monthKey));
      if (authoritative) return [projectObligationOccurrence(sourcePlan, authoritative, referenceDate)];
      if (projectedPlan.status !== 'active') return [];
      const projected = buildOccurrenceSnapshot(projectedPlan, monthKey, { referenceDate, generatedAt: `${referenceDate}T09:00:00+08:00` });
      return projected ? [projected] : [];
    });
    return selectRecurringMonth({
      plans: dedupeCanonicalPlans([...fixedPlans, ...obligationPlans]),
      occurrences: [...fixedOccurrences, ...obligationOccurrences],
      monthKey,
      referenceDate,
    });
  };

  return {
    today: FIXTURE_TODAY,

    // Money Pulse metric set — business meanings per blueprint §14.1.
    // Fixture-derived here; Phase 2 swaps in the frozen rm_v3 functions
    // (getCashNow / getMyMonthlyFixedTotal18_5B / getTotalCardDebt /
    // getPendingCardDue / getAfterCardPaymentCash / getAAReceivables /
    // getFullPayoffPosition) behind this same shape.
    getPulse() {
      const fixed = fixedCenterProjection(FIXTURE_TODAY.slice(0, 7), FIXTURE_TODAY);
      return engine.getDerivedMetrics({
        investmentTotal: investments.total,
        fixedDepositTotal: fixedDeposits.total,
        aaReceivable: aaReceivable(),
        myFixed: fixed.summary.myFixedMinor / 100,
      });
    },

    // Canonical read-only fixed/subscription projections. These commands may
    // generate deterministic in-memory occurrences but never post money.
    getRecurringPlans: () => recurringPlans.listPlans(),
    getRecurringPlan: (id) => recurringPlans.getPlan(id),
    getFixedCenterMonth: (monthKey, referenceDate = FIXTURE_TODAY) => fixedCenterProjection(monthKey, referenceDate),
    getRecurringOccurrencesForMonth: (monthKey, referenceDate = FIXTURE_TODAY) => fixedCenterProjection(monthKey, referenceDate).rows,
    getRecurringOccurrencesForPlan: (planId, referenceDate = FIXTURE_TODAY) => recurringPlans.listOccurrencesForPlan(planId, referenceDate),
    createRecurringPlan: (input) => recurringPlans.createPlan(input),
    updateRecurringPlan: (id, changes, options) => recurringPlans.updatePlan(id, changes, options),
    pauseRecurringPlan: (id, options) => recurringPlans.pausePlan(id, options),
    resumeRecurringPlan: (id, options) => recurringPlans.resumePlan(id, options),
    stopRecurringPlan: (id, options) => recurringPlans.stopPlan(id, options),
    generateRecurringOccurrence: (id, monthKey, options) => recurringPlans.generateOccurrence(id, monthKey, options),
    getFixedRelationshipPlanProjections: (ledgerId) => projectFixedRelationshipsForLedger(recurringPlans.listPlans(), ledgerId),
    getRecurringReminderIntents(monthKey, referenceDate = FIXTURE_TODAY) {
      return dueSoonReminderIntents(fixedCenterProjection(monthKey, referenceDate).rows, referenceDate);
    },
    getCanonicalRecurringPlan: (source) => recurringManagement.getCanonicalPlan(source),
    getCanonicalRecurringPlanOccurrences: (source, referenceDate = FIXTURE_TODAY) => recurringManagement.occurrencesFor(source, referenceDate),
    getCanonicalRecurringPlans: () => recurringManagement.listCanonicalPlans(),
    getLedgerRecurringProjection(ledgerId, referenceDate = FIXTURE_TODAY) {
      const plans = recurringManagement.listCanonicalPlans();
      const ledgerPlans = selectRecurringPlansForLedger(plans, ledgerId, { includeArchived: true });
      const occurrences = ledgerPlans.flatMap((plan) => recurringManagement.occurrencesFor(plan.canonicalSource, referenceDate));
      return buildLedgerRecurringProjection({
        plans,
        occurrences,
        ledgerId,
        participants: participantRepo.getAll(),
        referenceDate,
      });
    },
    findRecurringPlanDuplicates: (candidate, options) => recurringManagement.semanticDuplicates(candidate, options),
    createManagedRecurringPlan: (input, options) => recurringManagement.createPlan(input, options),
    updateManagedRecurringPlan: (source, changes, options) => recurringManagement.updatePlan(source, changes, options),
    pauseManagedRecurringPlan: (source, options) => recurringManagement.pausePlan(source, options),
    resumeManagedRecurringPlan: (source, options) => recurringManagement.resumePlan(source, options),
    stopManagedRecurringPlan: (source, options) => recurringManagement.stopPlan(source, options),
    archiveManagedRecurringPlan: (source, options) => recurringManagement.archivePlan(source, options),
    unarchiveManagedRecurringPlan: (source, options) => recurringManagement.unarchivePlan(source, options),
    removeManagedRecurringPlan: (source, options) => recurringManagement.removePlan(source, options),
    getManagedRecurringPlanRemovalEligibility: (source) => recurringManagement.getRemovalEligibility(source),
    softDeleteManagedRecurringPlan: (source, options) => recurringManagement.softDeletePlan(source, options),
    getRecentlyDeletedRecurringPlans: () => recurringManagement.listRecentlyDeletedPlans(),
    restoreDeletedRecurringPlan: (planId, options) => recurringManagement.restoreDeletedPlan(planId, options),
    permanentlyDeleteRecurringPlan: (planId, options) => recurringManagement.permanentlyDeletePlan(planId, options),
    clearRecentlyDeletedRecurringPlans: (options) => recurringManagement.clearRecentlyDeleted(options),
    getPreservedDeletedRecurringHistory: () => recurringManagement.getPreservedDeletedHistory(),
    getRecipientPaymentProfile: (profileId) => recipientPaymentProfiles.get(profileId),
    getRecipientPaymentProfiles: (options) => recipientPaymentProfiles.list(options),
    getDefaultRecipientPaymentProfile: (recipientId) => recipientPaymentProfiles.findDefault(recipientId),
    getRecipientIdentityForPlan(planOrId) {
      const plan = typeof planOrId === 'string'
        ? recurringManagement.listCanonicalPlans().find((row) => row.id === planOrId)
        : planOrId;
      return recipientIdentityForPlan(plan, {
        getProfile: (id) => recipientPaymentProfiles.get(id),
        getParticipant: (id) => participantRepo.get(id),
      });
    },
    getRecipientDirectory() {
      return buildRecipientDirectory({
        participants: participantRepo.getAll(),
        plans: recurringManagement.listCanonicalPlans(),
        profiles: recipientPaymentProfiles.list(),
      });
    },
    createRecipientPaymentProfile: (input) => recipientPaymentProfiles.create(input),
    updateRecipientPaymentProfile: (profileId, changes) => recipientPaymentProfiles.update(profileId, changes),
    deleteRecipientPaymentProfile: (profileId) => recipientPaymentProfiles.remove(profileId),
    setDefaultRecipientPaymentProfile: (profileId) => recipientPaymentProfiles.setDefault(profileId),
    executeRecurringOccurrencePosting: (command) => recurringPosting.executeRecurringOccurrencePosting(command),
    reverseRecurringOccurrencePosting: (postingId, options) => recurringPosting.reverseRecurringOccurrencePosting(postingId, options),
    getRecurringOccurrencePosting: (postingId) => recurringPosting.getPosting(postingId),
    getRecurringOccurrencePostings: () => recurringPosting.listPostings(),
    getRecurringPostingForTransaction(transactionId) {
      const postingId = recurringTransactionLinks.get(transactionId);
      return postingId ? recurringPosting.getPosting(postingId) : null;
    },

    subscribe: (listener) => engine.subscribe(listener),
    getAccounts: () => engine.getAccounts(),
    getAccountsByType: (type) => ofType(type),
    getAccount: (id) => engine.getAccount(id),
    getAccountBalance: (id) => engine.getAccountBalance(id),
    getInstalments: (cardId) => engine.getCardInstallments(cardId).map((item) => {
      const next = item.schedule.find((occurrence) => occurrence.status !== 'paid');
      return {
        ...item,
        monthly: (next?.amountMinor || 0) / 100,
        remaining: item.remainingPrincipalMinor / 100,
        totalTerms: item.termCount,
        paidTerms: item.paidTerms,
      };
    }),
    getSharedLimitPools: () => engine.getSharedLimitPools(),
    getSharedLimitPool: (id) => engine.getSharedLimitPool(id),
    getAssetOperations: (options) => engine.getAssetOperations(options),
    getAssetOperation: (id) => engine.getAssetOperation(id),
    getAssetFinancialSummary(input = {}) {
      const fixed = fixedCenterProjection(FIXTURE_TODAY.slice(0, 7), FIXTURE_TODAY);
      return engine.getAssetFinancialSummary({ investmentMinor: Math.round(investments.total * 100), fixedDepositMinor: Math.round(fixedDeposits.total * 100), aaReceivableMinor: Math.round(aaReceivable() * 100), myFixedMinor: fixed.summary.myFixedMinor, ...input });
    },
    getAssetFinancialIntegrity: () => engine.getAssetFinancialIntegrity(),
    createAsset: (input) => engine.createAsset(input),
    updateAsset: (id, changes) => engine.updateAsset(id, changes),
    archiveAsset: (id) => engine.archiveAsset(id),
    restoreAsset: (id) => engine.restoreAsset(id),
    setAssetHidden: (id, hidden) => engine.setAssetHidden(id, hidden),
    setAssetIncludedInTotals: (id, included) => engine.setAssetIncludedInTotals(id, included),
    setAssetActive: (id, active) => engine.setAssetActive(id, active),
    setDefaultAsset: (type, id) => engine.setDefaultAsset(type, id),
    reorderAssets: (type, orderedIds) => engine.reorderAssets(type, orderedIds),
    canHardDeleteAsset(id) {
      const base = engine.canHardDeleteAsset(id);
      if (!base.allowed) return base;
      const recurringReference = recurringPlans.listPlans().some((plan) => plan.paymentSourceAccountId === id)
        || obligationRepo.getPlans().some((plan) => plan.defaultAccountId === id)
        || commitmentState.some((commitment) => commitment.sourceId === id);
      if (recurringReference) return { allowed: false, reason: '账户仍被固定计划或付款安排使用，请改为归档。' };
      return base;
    },
    hardDeleteAsset(id) {
      const policy = this.canHardDeleteAsset(id);
      if (!policy.allowed) throw new Error(policy.reason);
      return engine.hardDeleteAsset(id);
    },
    createSharedLimitPool: (input) => engine.createSharedLimitPool(input),
    updateSharedLimitPool: (id, changes) => engine.updateSharedLimitPool(id, changes),
    assignCardToSharedLimitPool: (cardId, poolId) => engine.assignCardToSharedLimitPool(cardId, poolId),
    removeSharedLimitPool: (id) => engine.removeSharedLimitPool(id),
    recordAssetAdjustment: (command) => engine.recordAssetAdjustment(command),
    recordAssetTargetBalance: (command) => engine.recordAssetTargetBalance(command),
    recordAssetOpeningBalance: (command) => engine.recordAssetOpeningBalance(command),
    recordOpeningCardDebt: (command) => engine.recordOpeningCardDebt(command),
    recordOpeningCardCredit: (command) => engine.recordOpeningCardCredit(command),
    recordCardFee: (command) => engine.recordCardFee(command),
    createCardInstallment: (command) => engine.createCardInstallment(command),
    convertPurchaseToInstallment: (command) => engine.convertPurchaseToInstallment(command),
    importCardInstallment: (command) => engine.importCardInstallment(command),
    recordCardPayment: (command) => engine.recordCardPayment(command),
    recordCardRefund: (command) => engine.recordCardRefund(command),
    recordLinkedCardRefund: (command) => engine.recordLinkedCardRefund(command),
    recordGeneralCardCredit: (command) => engine.recordGeneralCardCredit(command),
    reverseAssetOperation: (id, options) => engine.reverseAssetOperation(id, options),
    getInvestments: () => investments,
    getFixedDeposits: () => fixedDeposits,
    getSavingsFlow() {
      const inflow = userTransactions()
        .filter((transaction) => transaction.accountEffect === 'posted' && transaction.kind === 'income' && engine.getAccount(transaction.destinationAccountId)?.type === 'saving')
        .reduce((sum, transaction) => sum + transaction.amount, savingsFlow.inflow);
      const outflow = userTransactions()
        .filter((transaction) => transaction.accountEffect === 'posted' && transaction.kind === 'expense' && engine.getAccount(transaction.sourceAccountId)?.type === 'saving')
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
        .filter((transaction) => transaction.accountEffect === 'posted' && transaction.kind === 'expense' && transaction.date.startsWith('2026-07'))
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const operationSpend = engine.getAssetOperations({ includeReversed: false })
        .reduce((sum, operation) => sum + Number(operation.metadata?.spendingDeltaMinor || 0), 0) / 100;
      return { month: '2026-07', total: 2500, used: 1684.3 + addedSpend + operationSpend };
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

    getActivities: () => [
      ...engine.getTransactions({ includeReversed: true })
        .filter((transaction) => transaction.status === 'active' || transaction.recurringPostingId)
        .map(decorateTransaction),
      ...engine.getAssetOperations().map(decorateAssetOperation),
    ].sort((a, b) => String(b.occurredAt || `${b.date}T${b.time}`).localeCompare(String(a.occurredAt || `${a.date}T${a.time}`))),
    getTransactions: (options) => engine.getTransactions(options).map(decorateTransaction),
    getActivity: (id) => decorateTransaction(engine.getTransaction(id)) || decorateAssetOperation(engine.getAssetOperation(id)),
    getTransaction: (id) => decorateTransaction(engine.getTransaction(id)),
    recordTransactionConfirmationPresented(transactionOrId) {
      const transaction = typeof transactionOrId === 'string' ? engine.getTransaction(transactionOrId) : transactionOrId;
      if (!transaction) return null;
      return outbox.emit({ clientEventId: `confirmation-${transaction.id}-${transaction.revision}`, eventType: 'transaction.confirmation.presented', sourceChannel: 'app', actorUserId: 'user-winner', participantId: null, ledgerId: null, entityId: transaction.id, revision: transaction.revision, occurredAt: new Date().toISOString(), payload: { confirmationId: transaction.confirmation?.confirmationId || null } });
    },
    getTransactionMutationPolicy(transactionOrId) {
      const candidate = typeof transactionOrId === 'string' ? this.getActivity(transactionOrId) : transactionOrId;
      if (candidate?.assetOperation) return { canEdit: false, canDelete: false, reason: candidate.status === 'reversed' ? '这次账户操作已撤销，原审计记录会保留。' : '资产与信用卡操作请使用安全撤销。' };
      return engine.getTransactionMutationPolicy(transactionOrId);
    },
    inspectTransactionCapacity: (draft, options) => engine.inspectTransactionCapacity(draft, options),
    assertTransactionCapacity: (draft, options) => engine.assertTransactionCapacity(draft, options),
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
      const linkedId = relationshipLinks.get(id);
      const currentLinkedTransaction = engine.getTransaction(id);
      if (linkedId?.startsWith('rel-entry-') && changes.kind && changes.kind !== currentLinkedTransaction.kind) throw new Error('关系账类型请从关系账详情修改');
      if (linkedId?.startsWith('rel-entry-') && Object.hasOwn(changes, 'amount')) {
        const linked = ledgerRepo.getEntry(linkedId);
        const settledMinor = linked.amountMinor - linked.remainingMinor;
        const nextRelationshipMinor = Math.round(Number(changes.amount) * 100 * (linked.relationshipRatio || 1));
        if (nextRelationshipMinor < settledMinor) throw new Error('金额不能低于已结算部分');
      }
      const edited = engine.editTransaction(id, {
        ...changes,
        ...(changes.catId ? { catLabel: noPurpose ? '转账' : category?.name, category: noPurpose ? '转账' : category?.name } : {}),
      });
      if (linkedId?.startsWith('rel-entry-')) {
        const entry = ledgerRepo.getEntry(linkedId);
        relationship.updateFromTransaction(edited, { ledgerId: entry.ledgerId, clientEventId: `transaction-edit-${id}-${edited.revision}`, sourceChannel: 'app', occurredAt: edited.updatedAt });
      }
      return decorateTransaction(edited);
    },
    reverseTransaction(id) {
      const linkedId = relationshipLinks.get(id);
      if (linkedId?.startsWith('rel-entry-')) return relationship.reverseEntry(linkedId, { clientEventId: `transaction-reverse-${id}`, sourceChannel: 'app', ledgerId: ledgerRepo.getEntry(linkedId).ledgerId });
      return engine.reverseTransaction(id);
    },
    deleteTransaction(id) { return this.reverseTransaction(id); },
    transferFunds: (draft) => engine.transferFunds(draft),
    getDerivedMetrics() {
      return this.getPulse();
    },
    getTransactionAccountLabel(transaction) {
      const source = transaction.sourceAccountId ? engine.getAccount(transaction.sourceAccountId) : null;
      const destination = transaction.destinationAccountId ? engine.getAccount(transaction.destinationAccountId) : null;
      if (transaction.assetOperation && transaction.kind === 'transfer') {
        if (source && destination) return `${source.name} → ${destination.name}`;
        return engine.getAccount(transaction.accountId)?.name || destination?.name || source?.name || '—';
      }
      if (transaction.kind === 'transfer') return `${source?.name || '—'} → ${destination?.name || '—'}`;
      return (transaction.kind === 'income' ? destination : source)?.name || '—';
    },
    getTransactionCategoryLabel: (transaction) => transaction?.assetOperation ? transaction.catLabel : decorateTransaction(transaction)?.catLabel || '—',
    resetDemoData() {
      commitmentState = structuredClone(commitments);
      engine.resetDemoData();
      categoryRepo.resetAll();
      relationship.reset();
      relationshipLinks.clear();
      obligations.reset();
      obligationLinks.clear();
      recurringPlans.reset();
      recurringManagement.resetCommands();
      recipientPaymentProfiles.reset();
      recurringPosting.reset();
      recurringTransactionLinks.clear();
      attachmentStore.reset();
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
    getGroups: () => relationship.getLedgers('group').map((ledger) => {
      const summary = relationship.getSummary(ledger.ledgerId);
      return { id: ledger.ledgerId, name: ledger.title, members: ledger.participantIds.length, myNet: summary.netMinor / 100, lastActivity: relationship.getEntries(ledger.ledgerId)[0]?.occurredAt.slice(0, 10) || FIXTURE_TODAY };
    }),
    getReceiveTargets: () =>
      engine.getAccounts()
        .filter((a) => a.type !== 'cc')
        .map((a) => ({ id: a.id, name: a.name, type: a.type, note: a.type === 'ew' ? '入账 eWallet' : '入账储蓄' }))
        .concat([{ id: 'cash', name: '现金', type: 'cash', note: '只记录，不动余额' }]),

    getRelationshipLedgers: (filter) => relationship.getLedgers(filter),
    getRelationshipLedger: (id) => relationship.getLedger(id),
    getRelationshipEntry: (id) => relationship.getEntry(id),
    getRelationshipEntries: (id, options) => relationship.getEntries(id, options),
    getRelationshipSettlements: (id) => relationship.getSettlements(id),
    getRelationshipSummary: (id) => relationship.getSummary(id),
    getRelationshipOverview: () => relationship.getOverview(),
    getParticipants: () => relationship.getParticipants(),
    getParticipant: (id) => relationship.getParticipant(id),
    createManualParticipant: (input) => relationship.createManualParticipant(input),
    createRelationshipLedger: (input) => relationship.createLedger(input),
    recordRelationshipEntry: (command) => relationship.record(command),
    settleRelationship: (command) => relationship.settle(command),
    reverseRelationshipSettlement: (id, command) => relationship.reverseSettlement(id, command),
    reverseRelationshipEntry: (id, command) => relationship.reverseEntry(id, command),
    prepareParticipantClaim: (...args) => relationship.prepareClaim(...args),
    completeParticipantClaim: (...args) => relationship.completeClaim(...args),
    cancelParticipantClaim: (id) => relationship.cancelClaim(id),
    getIntegrationOutbox: () => relationship.getOutbox(),
    getRelationshipEntityForTransaction: (id) => relationshipLinks.get(id) || null,
    getObligationEntityForTransaction: (id) => obligationLinks.get(id) || null,
    getRelationshipMemberBalances: (ledgerId) => memberBalances(ledgerRepo.getEntries(ledgerId), 'participant-me'),

    // ---- Attachments (session-local collection) -------------
    getAttachmentLimit: () => attachmentStore.maxPerOwner,
    getAttachment: (id) => attachmentStore.get(id),
    getAttachments: (ownerEntityType, ownerEntityId) => attachmentStore.listFor(ownerEntityType, ownerEntityId),
    getAttachmentsByIds: (ids) => attachmentStore.getMany(ids),
    addAttachment(input) {
      const attachment = attachmentStore.add(input);
      emitAttachmentEvent('attachment.added', attachment, `${input.clientEventId}:attachment.added`);
      return attachment;
    },
    removeAttachment(attachmentId, clientEventId = `attachment-remove-${attachmentId}`) {
      const attachment = attachmentStore.get(attachmentId);
      const removed = attachmentStore.remove(attachmentId);
      if (removed) {
        engine.getTransactions({ includeReversed: true }).filter((transaction) => transaction.attachmentIds?.includes(attachmentId)).forEach((transaction) => engine.setTransactionAttachments(transaction.id, transaction.attachmentIds.filter((id) => id !== attachmentId)));
        ledgerRepo.getLedgers().forEach((ledger) => {
          ledgerRepo.getEntries(ledger.ledgerId, { includeReversed: true }).filter((entry) => entry.attachmentIds?.includes(attachmentId)).forEach((entry) => ledgerRepo.updateEntry(entry.entryId, { attachmentIds: entry.attachmentIds.filter((id) => id !== attachmentId) }));
          ledgerRepo.getSettlements(ledger.ledgerId).filter((settlement) => settlement.attachmentIds?.includes(attachmentId)).forEach((settlement) => ledgerRepo.updateSettlement(settlement.settlementId, { attachmentIds: settlement.attachmentIds.filter((id) => id !== attachmentId) }));
        });
        obligationRepo.getPlans().filter((plan) => plan.attachmentIds?.includes(attachmentId)).forEach((plan) => obligationRepo.updatePlan(plan.planId, { attachmentIds: plan.attachmentIds.filter((id) => id !== attachmentId) }));
        obligationRepo.getPlans().forEach((plan) => obligationRepo.getPayments(plan.planId).filter((payment) => payment.attachmentIds?.includes(attachmentId)).forEach((payment) => obligationRepo.updatePayment(payment.paymentId, { attachmentIds: payment.attachmentIds.filter((id) => id !== attachmentId) })));
        emitAttachmentEvent('attachment.removed', attachment, `${clientEventId}:attachment.removed`, { entityId: attachmentId });
      }
      return removed;
    },
    renameAttachment(attachmentId, requestedName, clientEventId = `attachment-rename-${attachmentId}-${Date.now()}`) {
      const renamed = attachmentStore.rename(attachmentId, requestedName);
      emitAttachmentEvent('attachment.renamed', renamed, `${clientEventId}:attachment.renamed`, { name: renamed.name });
      return renamed;
    },
    recordAttachmentDownloaded(attachmentId) {
      const attachment = attachmentStore.get(attachmentId);
      if (attachment) emitAttachmentEvent('attachment.downloaded', attachment, `attachment-download-${attachmentId}-${Date.now()}`);
    },
    recordAttachmentShared(attachmentId) {
      const attachment = attachmentStore.get(attachmentId);
      if (attachment) emitAttachmentEvent('attachment.shared', attachment, `attachment-share-${attachmentId}-${Date.now()}`);
    },
    replaceAttachment(attachmentId, input, clientEventId) {
      const replaced = attachmentStore.replace(attachmentId, input, clientEventId);
      emitAttachmentEvent('attachment.added', replaced, `${clientEventId}:attachment.replaced`, { replacedAttachmentId: attachmentId });
      return replaced;
    },
    reorderAttachments(ownerEntityType, ownerEntityId, orderedIds, clientEventId = `attachment-reorder-${ownerEntityId}-${orderedIds.join('.')}`) {
      const ordered = attachmentStore.reorder(ownerEntityType, ownerEntityId, orderedIds);
      emitAttachmentEvent('attachment.reordered', ordered[0] || null, `${clientEventId}:attachment.reordered`, { ownerEntityType, ownerEntityId, orderedIds });
      return ordered;
    },
    assignAttachmentOwner: (fromType, fromId, toType, toId) => attachmentStore.assignOwner(fromType, fromId, toType, toId),
    discardDraftAttachments: (draftId) => attachmentStore.removeFor('draft', draftId),
    setTransactionAttachments: (id, attachmentIds) => decorateTransaction(engine.setTransactionAttachments(id, attachmentIds)),
    getTransactionAttachments(id) {
      const transaction = engine.getTransaction(id);
      return transaction ? attachmentStore.getMany(transaction.attachmentIds || []) : [];
    },

    // ---- Obligations: monthly relationship accounts + interpersonal
    // instalments (one canonical plan; projections only elsewhere) ----
    getObligationPlans: (filter) => obligations.getPlans(filter).filter((plan) => !plan.archived),
    getObligationPlan: (id) => obligations.getPlan(id),
    getObligationInstances: (planId) => obligations.getInstances(planId),
    getObligationPayments: (planId) => obligations.getPayments(planId),
    recordPlanDetailOpened(planId) {
      const plan = obligations.getPlan(planId);
      if (plan) outbox.emit({ clientEventId: `plan-detail-${planId}-${Date.now()}`, eventType: 'plan.detail.opened', sourceChannel: 'app', actorUserId: 'user-winner', participantId: null, ledgerId: plan.ledgerId, entityId: planId, revision: plan.revision || 1, occurredAt: new Date().toISOString(), payload: {} });
    },
    createObligationPlan: (command) => obligations.createPlan(command),
    updateObligationPlan: (planId, changes, command) => obligations.updatePlan(planId, changes, command),
    generateObligationInstance: (planId, command) => obligations.generateInstance(planId, command),
    recordObligationPayment: (command) => obligations.recordPayment(command),
    reverseObligationPayment: (paymentId, command) => obligations.reversePayment(paymentId, command),
    earlySettleInstallment: (command) => obligations.earlySettle(command),
    pauseObligationPlan: (planId, command) => obligations.pausePlan(planId, command),
    resumeObligationPlan: (planId, command) => obligations.resumePlan(planId, command),
    stopObligationPlan: (planId, command) => obligations.stopPlan(planId, command),
    discardObligationPlan: (planId, command) => obligations.discardPlan(planId, command),
  };
}
