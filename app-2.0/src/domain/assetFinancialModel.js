// Canonical Phase 2D1A asset and credit-card financial model.
// All values are integer minor units. UI adapters may expose decimal display
// values, but financial decisions and invariants stay in this module.

export const ASSET_TYPES = new Set(['saving', 'ew', 'cc', 'cash', 'prepaid']);
export const ASSET_STATUSES = new Set(['active', 'inactive', 'archived']);

export function minor(value) {
  // Legacy 2.0 fixtures expose decimal display numbers. Normalize that adapter
  // boundary once, then keep every canonical financial value as integer minor
  // units. User-entered strings are parsed directly without float arithmetic.
  const text = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) throw new Error('金额无效');
  const sign = match[1] === '-' ? -1 : 1;
  const wholeMinor = Number(match[2]) * 100;
  const fractionMinor = Number((match[3] || '').padEnd(2, '0'));
  const result = sign * (wholeMinor + fractionMinor);
  if (!Number.isSafeInteger(result)) throw new Error('金额无效');
  return result;
}

export function major(valueMinor) {
  return Number(valueMinor || 0) / 100;
}

export function sanitizePrivateIdentifier(value) {
  return String(value ?? '').trim();
}

// Account identifiers are deliberately handled as strings. They are not
// amounts, must never go through number parsing, and may legitimately begin
// with zero or include user-entered grouping spaces/hyphens.
export function normalizeBankAccountNumber(value) {
  return sanitizePrivateIdentifier(value);
}

export function validateOptionalBankAccountNumber(value) {
  const accountNumber = normalizeBankAccountNumber(value);
  if (accountNumber && !/^[0-9\s-]+$/.test(accountNumber)) throw new Error('银行账号只能包含数字、空格或连字符');
  return accountNumber;
}

export function validateOptionalLastFour(value, label = '卡末四位') {
  const lastFour = String(value ?? '').trim();
  if (lastFour && !/^\d{4}$/.test(lastFour)) throw new Error(`${label}必须是 4 位数字`);
  return lastFour;
}

export function bankAccountLastFour(value) {
  const digits = normalizeBankAccountNumber(value).replace(/\D/g, '');
  return digits ? digits.slice(-4) : '';
}

export function formatBankAccountNumber(value, { privacy = false } = {}) {
  const accountNumber = normalizeBankAccountNumber(value);
  if (!accountNumber) return '';
  return privacy ? `•••• ${bankAccountLastFour(accountNumber)}` : accountNumber;
}

export function formatCardLastFour(value, { privacy = false } = {}) {
  const lastFour = String(value ?? '').replace(/\D/g, '').slice(-4);
  if (!lastFour) return '';
  return privacy ? '••••' : lastFour;
}

export function maskAssetIdentifier(value) {
  return formatBankAccountNumber(value, { privacy: true });
}

function normalizeCustomAssetMedia(raw, kind) {
  if (!raw) return null;
  const dataUrl = String(raw.dataUrl || '');
  const mimeType = String(raw.mimeType || '');
  const maxBytes = kind === 'card' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !dataUrl.toLowerCase().startsWith(`data:${mimeType};base64,`)) throw new Error('自定义图片格式无效');
  const sizeBytes = Number(raw.sizeBytes || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) throw new Error('自定义图片大小无效');
  return {
    dataUrl,
    fileName: String(raw.fileName || (kind === 'card' ? 'custom-card' : 'custom-logo')).slice(0, 120),
    mimeType,
    sizeBytes,
    width: Math.max(1, Number(raw.width || 1)),
    height: Math.max(1, Number(raw.height || 1)),
    edgeTransparency: Math.max(0, Math.min(1, Number(raw.edgeTransparency || 0))),
    opaqueCoverage: Math.max(0, Math.min(1, Number(raw.opaqueCoverage || 0))),
    resolvedPresentation: ['icon_full_bleed', 'symbol_contained', 'wordmark_contained'].includes(raw.resolvedPresentation) ? raw.resolvedPresentation : null,
    derivedPalette: raw.derivedPalette && /^#[0-9a-f]{6}$/i.test(String(raw.derivedPalette.primary || '')) ? structuredClone(raw.derivedPalette) : null,
  };
}

export function clampMonthDay(year, monthIndex, day) {
  const max = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(Math.max(1, day), max);
}

export function nextCalendarMonthSameDay(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) throw new Error('日期无效');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const nextMonthIndex = (monthIndex + 1) % 12;
  const nextYear = year + (monthIndex === 11 ? 1 : 0);
  const nextDay = clampMonthDay(nextYear, nextMonthIndex, day);
  return `${nextYear}-${String(nextMonthIndex + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

export function deterministicPoolId(label) {
  const value = String(label || '').trim().toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '');
  return value ? `limit-pool:${value}` : null;
}

function timestamp(raw, fallback) {
  return String(raw || fallback || new Date().toISOString());
}

export function normalizeSharedLimitPool(raw, index = 0, clock = new Date().toISOString()) {
  const name = String(raw?.name || raw?.label || `共享额度池 ${index + 1}`).trim();
  const limitMinor = raw?.limitMinor ?? minor(raw?.limit ?? raw?.sharedPoolTotal ?? 0);
  if (!name) throw new Error('请输入共享额度池名称');
  if (!Number.isInteger(limitMinor) || limitMinor <= 0) throw new Error('共享额度必须大于零');
  return {
    id: String(raw?.id || deterministicPoolId(name) || `limit-pool:${index + 1}`),
    name,
    limitMinor,
    sortOrder: Number.isInteger(raw?.sortOrder) ? raw.sortOrder : index,
    status: raw?.status === 'archived' ? 'archived' : 'active',
    createdAt: timestamp(raw?.createdAt, clock),
    updatedAt: timestamp(raw?.updatedAt, clock),
  };
}

export function normalizeAsset(raw, index = 0, clock = new Date().toISOString()) {
  const typeAliases = { savings: 'saving', saving: 'saving', ewallet: 'ew', ew: 'ew', credit: 'cc', cc: 'cc', cash: 'cash', prepaid: 'prepaid' };
  const type = typeAliases[String(raw?.type || raw?.domainType || '').trim()] || '';
  if (!ASSET_TYPES.has(type)) throw new Error('账户类型无效');
  const name = String(raw?.name || '').trim();
  if (!name) throw new Error('请输入账户名称');
  const legacyPoolId = raw?.sharedPool ? deterministicPoolId(raw.sharedPool) : null;
  const base = {
    ...structuredClone(raw),
    id: String(raw?.id || `asset:${type}:${index + 1}`),
    type,
    accountKind: type === 'saving' ? 'bank_account' : type === 'cc' ? 'credit_card' : type === 'ew' ? 'ewallet' : type,
    domainType: type === 'saving' ? 'savings' : type === 'ew' ? 'ewallet' : 'credit',
    name,
    displayName: String(raw?.displayName || name).trim(),
    short: String(raw?.short || name).trim(),
    bank: String(raw?.bank || raw?.institution || '').trim(),
    institution: String(raw?.institution || raw?.bank || '').trim(),
    // Bank account identifiers remain optional. A full legacy debit-card
    // value is retained only for backward-compatible read/masking; the
    // current editor never exposes or writes it and stores only last four.
    bankAccountNumber: type === 'saving' ? normalizeBankAccountNumber(raw?.bankAccountNumber ?? raw?.accountNumber) : '',
    debitCardNumber: type === 'saving' ? sanitizePrivateIdentifier(raw?.debitCardNumber) : '',
    debitCardLast4: type === 'saving'
      ? String(raw?.debitCardLast4 ?? raw?.last4 ?? raw?.maskedDigits ?? '').replace(/\D/g, '').slice(-4)
      : '',
    walletIdentifier: type === 'ew' ? sanitizePrivateIdentifier(raw?.walletIdentifier ?? raw?.last4) : '',
    creditCardLast4: type === 'cc'
      ? String(raw?.creditCardLast4 ?? raw?.last4 ?? raw?.maskedDigits ?? '').replace(/\D/g, '').slice(-4)
      : '',
    last4: type === 'cc'
      ? String(raw?.creditCardLast4 ?? raw?.last4 ?? raw?.maskedDigits ?? '').replace(/\D/g, '').slice(-4)
      : String(raw?.last4 || raw?.maskedDigits || '').replace(/\D/g, '').slice(-4),
    maskedDigits: type === 'cc'
      ? String(raw?.creditCardLast4 ?? raw?.last4 ?? raw?.maskedDigits ?? '').replace(/\D/g, '').slice(-4)
      : String(raw?.last4 || raw?.maskedDigits || '').replace(/\D/g, '').slice(-4),
    note: String(raw?.note || '').trim(),
    status: raw?.status === 'archived' || raw?.archivedAt ? 'archived' : raw?.status === 'inactive' ? 'inactive' : 'active',
    archivedAt: raw?.archivedAt || null,
    isHidden: Boolean(raw?.isHidden),
    includeInAvailableCash: raw?.includeInAvailableCash ?? raw?.includeInTotals !== false,
    includeInNetWorth: raw?.includeInNetWorth ?? raw?.includeInTotals !== false,
    includeInTotalDebt: raw?.includeInTotalDebt ?? raw?.includeInTotals !== false,
    includeInTotals: raw?.includeInTotals !== false,
    isDefaultPaymentSource: Boolean(raw?.isDefaultPaymentSource ?? raw?.isDefault),
    isDefault: Boolean(raw?.isDefaultPaymentSource ?? raw?.isDefault),
    sortOrder: Number.isInteger(raw?.sortOrder) ? raw.sortOrder : index,
    brandColor: String(raw?.brandColor || '#248a5b'),
    art: raw?.art || null,
    catalogInstitutionId: raw?.catalogInstitutionId || null,
    catalogProductId: raw?.catalogProductId || null,
    artworkAssetId: raw?.artworkAssetId || null,
    brandId: raw?.brandId || raw?.catalogInstitutionId || null,
    productId: raw?.productId || raw?.catalogProductId || null,
    legacyProductId: raw?.legacyProductId || raw?.productId || raw?.catalogProductId || null,
    networkId: raw?.networkId || null,
    legacyNetworkId: raw?.legacyNetworkId || raw?.networkId || raw?.network || null,
    cardThemeId: raw?.cardThemeId || null,
    physicalVariantId: raw?.physicalVariantId || null,
    visualAssetId: raw?.visualAssetId || raw?.artworkAssetId || null,
    customBrandName: String(raw?.customBrandName || '').trim(),
    customProductName: String(raw?.customProductName || '').trim(),
    customLogo: normalizeCustomAssetMedia(raw?.customLogo, 'logo'),
    logoPresentationMode: ['auto', 'fill', 'contain'].includes(raw?.logoPresentationMode) ? raw.logoPresentationMode : 'auto',
    resolvedLogoPresentation: ['icon_full_bleed', 'symbol_contained', 'wordmark_contained'].includes(raw?.resolvedLogoPresentation) ? raw.resolvedLogoPresentation : null,
    cardPalette: raw?.cardPalette && /^#[0-9a-f]{6}$/i.test(String(raw.cardPalette.primary || '')) ? structuredClone(raw.cardPalette) : null,
    accountVisualOverride: raw?.accountVisualOverride?.enabled === true ? {
      enabled: true,
      logoPresentationMode: ['auto', 'fill', 'contain'].includes(raw.accountVisualOverride.logoPresentationMode) ? raw.accountVisualOverride.logoPresentationMode : 'auto',
      palette: raw.accountVisualOverride.palette && /^#[0-9a-f]{6}$/i.test(String(raw.accountVisualOverride.palette.primary || '')) ? structuredClone(raw.accountVisualOverride.palette) : null,
    } : null,
    customCardImage: normalizeCustomAssetMedia(raw?.customCardImage, 'card'),
    iconKey: raw?.iconKey || null,
    artKey: raw?.artKey || raw?.artworkAssetId || null,
    createdAt: timestamp(raw?.createdAt, clock),
    updatedAt: timestamp(raw?.updatedAt, clock),
    revision: Math.max(1, Number(raw?.revision || 1)),
    sharedLimitPoolId: raw?.sharedLimitPoolId || legacyPoolId,
  };

  if (type === 'cc') {
    const legacyOutstandingMinor = raw?.currentOutstandingMinor
      ?? raw?.ordinaryPrincipalOutstandingMinor
      ?? minor(raw?.outstanding ?? raw?.currentOutstanding ?? 0);
    base.creditLimitMinor = raw?.creditLimitMinor ?? (raw?.limit == null ? null : minor(raw.limit));
    base.ordinaryPrincipalOutstandingMinor = raw?.ordinaryPrincipalOutstandingMinor ?? legacyOutstandingMinor;
    base.recordOnlyDebtMinor = raw?.recordOnlyDebtMinor ?? 0;
    base.installmentPrincipalOutstandingMinor = raw?.installmentPrincipalOutstandingMinor ?? 0;
    base.feeInterestOutstandingMinor = raw?.feeInterestOutstandingMinor ?? 0;
    base.cardCreditBalanceMinor = raw?.cardCreditBalanceMinor ?? 0;
    base.ordinaryDueMinor = raw?.ordinaryDueMinor ?? minor(raw?.monthlyDue ?? 0);
    base.feeDueMinor = raw?.feeDueMinor ?? 0;
    base.currentInstallmentDueMinor = raw?.currentInstallmentDueMinor ?? 0;
    base.dueDate = raw?.dueDate || null;
    base.cycleAnchorDate = raw?.cycleAnchorDate || null;
    base.duePaid = Boolean(raw?.duePaid);
    base.monthPaidMinor = raw?.monthPaidMinor ?? 0;
    base.network = String(raw?.network || '').trim();
    base.tier = String(raw?.tier || '').trim();
    base.customTierLabel = String(raw?.customTierLabel || raw?.tierCustom || '').trim().slice(0, 32);
  } else {
    base.balanceMinor = raw?.balanceMinor ?? minor(raw?.balance ?? 0);
  }
  return base;
}

function addMonthsSameDay(isoDate, offset) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) throw new Error('日期无效');
  const sourceMonth = Number(match[1]) * 12 + Number(match[2]) - 1 + offset;
  const year = Math.floor(sourceMonth / 12);
  const monthIndex = ((sourceMonth % 12) + 12) % 12;
  const day = clampMonthDay(year, monthIndex, Number(match[3]));
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function subtractMonthsSameDay(isoDate, offset) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) throw new Error('日期无效');
  const sourceMonth = Number(match[1]) * 12 + Number(match[2]) - 1 - offset;
  const year = Math.floor(sourceMonth / 12);
  const monthIndex = ((sourceMonth % 12) + 12) % 12;
  const day = clampMonthDay(year, monthIndex, Number(match[3]));
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function buildInstallmentSchedule({ principalMinor, termCount, firstDueDate }) {
  if (!Number.isInteger(principalMinor) || principalMinor <= 0) throw new Error('分期本金必须大于零');
  if (!Number.isInteger(termCount) || termCount <= 0 || termCount > 120) throw new Error('分期期数无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(firstDueDate || ''))) throw new Error('首期日期无效');
  const regularMinor = Math.floor(principalMinor / termCount);
  const finalMinor = principalMinor - regularMinor * (termCount - 1);
  return Array.from({ length: termCount }, (_, index) => ({
    index: index + 1,
    dueDate: addMonthsSameDay(firstDueDate, index),
    amountMinor: index === termCount - 1 ? finalMinor : regularMinor,
    paidMinor: 0,
    status: 'pending',
    paidAt: null,
  }));
}

export function installmentScheduleSummary({ schedule, principalMinor, asOfDate = '2026-07-13' }) {
  if (!Array.isArray(schedule) || !schedule.length) throw new Error('分期计划无效');
  const totalMinor = schedule.reduce((sum, item) => sum + Number(item.amountMinor || 0), 0);
  if (Number.isInteger(principalMinor) && totalMinor !== principalMinor) throw new Error('分期总额与本金不一致');
  const month = String(asOfDate).slice(0, 7);
  return {
    principalMinor: Number.isInteger(principalMinor) ? principalMinor : totalMinor,
    termCount: schedule.length,
    firstDueDate: schedule[0].dueDate,
    finalDueDate: schedule.at(-1).dueDate,
    regularMinor: schedule[0].amountMinor,
    finalMinor: schedule.at(-1).amountMinor,
    totalMinor,
    currentMonthMinor: schedule.filter((item) => item.dueDate.slice(0, 7) === month).reduce((sum, item) => sum + item.amountMinor, 0),
    schedule: structuredClone(schedule),
  };
}

export function normalizeCardInstallment(raw, index = 0, clock = new Date().toISOString()) {
  const termCount = Number(raw?.termCount ?? raw?.totalTerms ?? raw?.tenureMonths ?? 1);
  const paidTerms = Math.max(0, Number(raw?.paidTerms ?? raw?.paidMonths ?? 0));
  const legacyMonthlyMinor = raw?.monthly != null ? minor(raw.monthly) : null;
  const principalMinor = raw?.principalMinor
    ?? raw?.originalPrincipalMinor
    ?? (raw?.remaining != null && legacyMonthlyMinor != null ? minor(raw.remaining) + paidTerms * legacyMonthlyMinor : minor(raw?.principal ?? raw?.totalAmount ?? raw?.remaining ?? 0));
  const nextDueDate = raw?.nextDueDate || '2026-07-26';
  const firstDueDate = raw?.firstDueDate || (paidTerms ? subtractMonthsSameDay(nextDueDate, paidTerms) : nextDueDate);
  const schedule = Array.isArray(raw?.schedule) && raw.schedule.length
    ? structuredClone(raw.schedule)
    : buildInstallmentSchedule({ principalMinor, termCount, firstDueDate });
  for (let item = 0; item < Math.min(paidTerms, schedule.length); item += 1) {
    schedule[item].status = 'paid';
    schedule[item].paidMinor = schedule[item].amountMinor;
    schedule[item].paidAt = raw?.updatedAt || clock;
  }
  const remainingPrincipalMinor = raw?.remainingPrincipalMinor
    ?? (raw?.remaining != null ? minor(raw.remaining) : schedule.filter((item) => item.status !== 'paid').reduce((sum, item) => sum + item.amountMinor, 0));
  const id = String(raw?.id || `card-installment:${index + 1}`);
  schedule.forEach((occurrence, occurrenceIndex) => {
    occurrence.id = String(occurrence.id || `${id}:occurrence:${occurrenceIndex + 1}`);
  });
  return {
    ...structuredClone(raw),
    id,
    cardId: String(raw?.cardId || ''),
    name: String(raw?.name || raw?.itemName || '信用卡分期').trim(),
    originalPrincipalMinor: principalMinor,
    remainingPrincipalMinor,
    termCount,
    paidTerms,
    firstDueDate,
    schedule,
    aaOwnShareMinor: raw?.aaOwnShareMinor ?? principalMinor,
    aaReceivableMinor: raw?.aaReceivableMinor ?? 0,
    status: remainingPrincipalMinor <= 0 ? 'completed' : (raw?.status || 'active'),
    createdAt: timestamp(raw?.createdAt, clock),
    updatedAt: timestamp(raw?.updatedAt, clock),
    revision: Math.max(1, Number(raw?.revision || 1)),
  };
}

export function currentInstallmentDueMinor(installment, asOfDate) {
  const month = String(asOfDate || '').slice(0, 7);
  return installment.schedule
    .filter((item) => item.status === 'pending' && item.dueDate.slice(0, 7) <= month)
    .reduce((sum, item) => sum + item.amountMinor - Number(item.paidMinor || 0), 0);
}

export function syncAssetDerived(account, installments = [], pools = [], asOfDate = '2026-07-13') {
  if (account.type !== 'cc') {
    account.balance = major(account.balanceMinor);
    return account;
  }
  const cardInstallments = installments.filter((item) => item.cardId === account.id && item.status !== 'reversed');
  account.installmentPrincipalOutstandingMinor = cardInstallments.reduce((sum, item) => sum + item.remainingPrincipalMinor, 0);
  account.currentInstallmentDueMinor = cardInstallments.reduce((sum, item) => sum + currentInstallmentDueMinor(item, asOfDate), 0);
  account.grossCardDebtMinor = account.ordinaryPrincipalOutstandingMinor
    + account.recordOnlyDebtMinor
    + account.installmentPrincipalOutstandingMinor
    + account.feeInterestOutstandingMinor;
  account.totalCardDebtMinor = Math.max(0, account.grossCardDebtMinor - account.cardCreditBalanceMinor);
  account.currentOutstandingMinor = account.totalCardDebtMinor;
  const selectedMonth = String(asOfDate).slice(0, 7);
  const ordinaryCycleDueNow = account.dueDate && account.dueDate.slice(0, 7) <= selectedMonth
    ? account.ordinaryDueMinor + account.feeDueMinor
    : 0;
  account.monthCardDueMinor = Math.max(0,
    ordinaryCycleDueNow + account.currentInstallmentDueMinor - account.cardCreditBalanceMinor);
  account.monthPaidMinor = Number(account.monthPaidMinor || 0);
  account.monthStatementDueMinor = account.monthCardDueMinor + account.monthPaidMinor;
  account.monthRemainingMinor = account.monthCardDueMinor;
  const pool = pools.find((item) => item.id === account.sharedLimitPoolId && item.status === 'active');
  const cardLimitMinor = pool?.limitMinor ?? account.creditLimitMinor;
  account.effectiveCreditLimitMinor = Number.isInteger(cardLimitMinor) ? cardLimitMinor : null;
  account.limit = account.creditLimitMinor == null ? null : major(account.creditLimitMinor);
  account.creditLimit = account.limit;
  // Legacy presentation adapters historically exposed only the non-
  // installment card balance through `outstanding`. Keep that public shape
  // deterministic while all Phase 2D1A finance uses totalCardDebtMinor.
  const legacyNonInstallmentDebtMinor = Math.max(0,
    account.ordinaryPrincipalOutstandingMinor + account.recordOnlyDebtMinor + account.feeInterestOutstandingMinor - account.cardCreditBalanceMinor);
  account.outstanding = major(legacyNonInstallmentDebtMinor);
  account.totalCardDebt = major(account.totalCardDebtMinor);
  account.currentOutstanding = account.outstanding;
  account.availableCreditMinor = account.effectiveCreditLimitMinor == null
    ? null
    : account.effectiveCreditLimitMinor - account.totalCardDebtMinor;
  account.availableCredit = account.availableCreditMinor == null ? null : major(account.availableCreditMinor);
  account.overLimitMinor = account.availableCreditMinor == null ? null : Math.max(0, -account.availableCreditMinor);
  account.overLimit = account.overLimitMinor == null ? null : major(account.overLimitMinor);
  // Preserve the original UI adapter contract: monthlyDue is the ordinary
  // statement component. New screens use monthCardDue for the canonical
  // selected-month ordinary + installment total.
  account.monthlyDue = major(account.ordinaryDueMinor + account.feeDueMinor);
  account.monthCardDue = major(account.monthCardDueMinor);
  account.monthPaid = major(account.monthPaidMinor);
  account.monthStatementDue = major(account.monthStatementDueMinor);
  account.monthRemaining = major(account.monthRemainingMinor);
  return account;
}

export function syncAllAssetDerived(accounts, installments = [], pools = [], asOfDate = '2026-07-13') {
  accounts.forEach((account) => syncAssetDerived(account, installments, pools, asOfDate));
  const cardById = new Map(accounts.filter((account) => account.type === 'cc').map((account) => [account.id, account]));
  pools.forEach((pool) => {
    const members = accounts.filter((account) => account.sharedLimitPoolId === pool.id && account.status === 'active');
    pool.memberIds = members.map((account) => account.id);
    pool.grossDebtMinor = members.reduce((sum, account) => sum + account.grossCardDebtMinor, 0);
    pool.cardCreditBalanceMinor = members.reduce((sum, account) => sum + account.cardCreditBalanceMinor, 0);
    pool.usedMinor = Math.max(0, pool.grossDebtMinor - pool.cardCreditBalanceMinor);
    pool.availableMinor = pool.limitMinor - pool.grossDebtMinor + pool.cardCreditBalanceMinor;
    pool.overLimitMinor = Math.max(0, -pool.availableMinor);
    members.forEach((account) => {
      account.availableCreditMinor = pool.availableMinor;
      account.availableCredit = major(pool.availableMinor);
      account.overLimitMinor = pool.overLimitMinor;
      account.overLimit = major(pool.overLimitMinor);
    });
  });
  installments.forEach((item) => {
    if (!cardById.has(item.cardId)) item.orphanedCard = true;
    else delete item.orphanedCard;
  });
  return accounts;
}

export function selectAssetFinancialSummary({ accounts, installments = [], pools = [], investmentMinor = 0, fixedDepositMinor = 0, aaReceivableMinor = 0, myFixedMinor = 0, includeInstallmentInMyFixed = true, asOfDate = '2026-07-13' }) {
  syncAllAssetDerived(accounts, installments, pools, asOfDate);
  const active = accounts.filter((account) => account.status === 'active');
  const currentCashMinor = active.filter((account) => account.type !== 'cc' && account.includeInAvailableCash !== false).reduce((sum, account) => sum + account.balanceMinor, 0);
  const liquidNetWorthMinor = active.filter((account) => account.type !== 'cc' && account.includeInNetWorth !== false).reduce((sum, account) => sum + account.balanceMinor, 0);
  const debtCards = active.filter((account) => account.type === 'cc' && account.includeInTotalDebt !== false);
  const totalCardDebtMinor = debtCards.reduce((sum, account) => sum + account.totalCardDebtMinor, 0);
  const monthCardDueMinor = debtCards.reduce((sum, account) => sum + account.monthCardDueMinor, 0);
  const installmentFixedDueMinor = debtCards.reduce((sum, account) => sum + account.currentInstallmentDueMinor, 0);
  const totalAssetsMinor = liquidNetWorthMinor + investmentMinor + fixedDepositMinor;
  return {
    currentCashMinor,
    liquidNetWorthMinor,
    myFixedMinor: myFixedMinor + (includeInstallmentInMyFixed ? installmentFixedDueMinor : 0),
    installmentFixedDueMinor,
    totalCardDebtMinor,
    monthCardDueMinor,
    afterCardPaymentMinor: currentCashMinor - monthCardDueMinor,
    aaReceivableMinor,
    afterReceiveMinor: currentCashMinor + aaReceivableMinor,
    totalAssetsMinor,
    totalDebtMinor: totalCardDebtMinor,
    netDebtMinor: totalCardDebtMinor - currentCashMinor,
    netAssetsMinor: totalAssetsMinor - totalCardDebtMinor,
    fullPayoffPositionMinor: currentCashMinor - totalCardDebtMinor,
    poolSummaries: pools.filter((pool) => pool.status === 'active').map((pool) => ({
      id: pool.id,
      name: pool.name,
      limitMinor: pool.limitMinor,
      usedMinor: pool.usedMinor,
      availableMinor: pool.availableMinor,
      overLimitMinor: pool.overLimitMinor,
      memberIds: structuredClone(pool.memberIds || []),
    })),
  };
}

export function validateAssetFinancialIntegrity({ accounts, installments = [], pools = [], operations = [], asOfDate = '2026-07-13' }) {
  // Validation is observational. Runtime repair would hide corruption and
  // make audit failures non-reproducible, so callers must derive first and the
  // validator only compares the supplied canonical snapshot.
  const errors = [];
  const ids = new Set();
    accounts.forEach((account) => {
    if (ids.has(account.id)) errors.push(`duplicate_asset:${account.id}`);
    ids.add(account.id);
    if (!ASSET_TYPES.has(account.type)) errors.push(`invalid_asset_type:${account.id}`);
    if (!ASSET_STATUSES.has(account.status)) errors.push(`invalid_asset_status:${account.id}`);
    if (account.type !== 'cc' && !Number.isInteger(account.balanceMinor)) errors.push(`invalid_balance:${account.id}`);
    if (account.type === 'cc') {
      ['ordinaryPrincipalOutstandingMinor', 'recordOnlyDebtMinor', 'installmentPrincipalOutstandingMinor', 'feeInterestOutstandingMinor', 'cardCreditBalanceMinor', 'totalCardDebtMinor'].forEach((key) => {
        if (!Number.isInteger(account[key]) || account[key] < 0) errors.push(`invalid_card_component:${account.id}:${key}`);
      });
      const expectedDebt = Math.max(0, account.ordinaryPrincipalOutstandingMinor + account.recordOnlyDebtMinor + account.installmentPrincipalOutstandingMinor + account.feeInterestOutstandingMinor - account.cardCreditBalanceMinor);
      if (expectedDebt !== account.totalCardDebtMinor) errors.push(`card_debt_mismatch:${account.id}`);
      const sharedPool = account.sharedLimitPoolId
        ? pools.find((pool) => pool.id === account.sharedLimitPoolId && pool.status === 'active')
        : null;
      const expectedAvailable = sharedPool
        ? sharedPool.availableMinor
        : account.effectiveCreditLimitMinor == null ? null : account.effectiveCreditLimitMinor - account.totalCardDebtMinor;
      if (expectedAvailable !== account.availableCreditMinor) errors.push(`card_available_mismatch:${account.id}`);
      if (account.sharedLimitPoolId && !pools.some((pool) => pool.id === account.sharedLimitPoolId)) errors.push(`missing_pool:${account.id}`);
    }
  });
  const defaults = new Map();
  accounts.filter((account) => account.status === 'active' && account.isDefault).forEach((account) => {
    if (defaults.has(account.type)) errors.push(`multiple_defaults:${account.type}`);
    defaults.set(account.type, account.id);
  });
  const installmentIds = new Set();
  installments.forEach((item) => {
    if (installmentIds.has(item.id)) errors.push(`duplicate_installment:${item.id}`);
    installmentIds.add(item.id);
    if (!ids.has(item.cardId)) errors.push(`orphan_installment:${item.id}`);
    if (item.schedule.reduce((sum, occurrence) => sum + occurrence.amountMinor, 0) !== item.originalPrincipalMinor) errors.push(`installment_schedule_mismatch:${item.id}`);
    if (item.schedule.reduce((sum, occurrence) => sum + occurrence.amountMinor - Number(occurrence.paidMinor || 0), 0) !== item.remainingPrincipalMinor) errors.push(`installment_remaining_mismatch:${item.id}`);
    const occurrenceIds = new Set();
    item.schedule.forEach((occurrence) => {
      if (!Number.isInteger(occurrence.amountMinor) || !Number.isInteger(Number(occurrence.paidMinor || 0))) errors.push(`floating_installment_money:${item.id}`);
      if (Number(occurrence.paidMinor || 0) < 0 || Number(occurrence.paidMinor || 0) > occurrence.amountMinor) errors.push(`invalid_installment_payment:${occurrence.id}`);
      if (occurrenceIds.has(occurrence.id)) errors.push(`duplicate_installment_occurrence:${occurrence.id}`);
      occurrenceIds.add(occurrence.id);
    });
  });
  const poolIds = new Set();
  pools.forEach((pool) => {
    if (poolIds.has(pool.id)) errors.push(`duplicate_pool:${pool.id}`);
    poolIds.add(pool.id);
    if (!Number.isInteger(pool.limitMinor) || pool.limitMinor <= 0) errors.push(`invalid_pool_limit:${pool.id}`);
    const members = accounts.filter((account) => account.status === 'active' && account.sharedLimitPoolId === pool.id);
    const expectedGross = members.reduce((sum, account) => sum + account.grossCardDebtMinor, 0);
    const expectedCredit = members.reduce((sum, account) => sum + account.cardCreditBalanceMinor, 0);
    if (pool.grossDebtMinor !== expectedGross || pool.cardCreditBalanceMinor !== expectedCredit || pool.availableMinor !== pool.limitMinor - expectedGross + expectedCredit) errors.push(`pool_summary_mismatch:${pool.id}`);
  });
  const operationIds = new Set();
  operations.forEach((operation) => {
    if (operationIds.has(operation.id)) errors.push(`duplicate_operation:${operation.id}`);
    operationIds.add(operation.id);
    if (!operation.idempotencyKey) errors.push(`missing_operation_key:${operation.id}`);
    const referencedId = operation.metadata?.accountId || operation.metadata?.cardId;
    if (referencedId && !ids.has(referencedId)) errors.push(`orphan_operation_asset:${operation.id}`);
    if (operation.type === 'card_opening_debt' && (operation.metadata?.spendingDeltaMinor !== 0 || operation.metadata?.incomeDeltaMinor !== 0)) errors.push(`record_only_classification:${operation.id}`);
  });
  return { ok: errors.length === 0, errors };
}
