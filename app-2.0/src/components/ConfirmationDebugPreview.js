// Internal screenshot/evidence adapter. It derives every visible balance and
// prior row from the live in-memory fixture repository, performs no mutation,
// and is reachable only through an explicit query parameter used by QA.

function balanceMinor(account) {
  return account.type === 'cc' ? Math.round(account.outstanding * 100) : Math.round(account.balance * 100);
}

function accountChange(account, deltaMinor) {
  const beforeMinor = balanceMinor(account);
  return {
    accountId: account.id,
    accountName: account.name,
    accountType: account.type,
    measure: account.type === 'cc' ? 'outstanding' : 'balance',
    beforeMinor,
    afterMinor: beforeMinor + deltaMinor,
    deltaMinor,
    accountSnapshot: account,
  };
}

function recentRecords(data, accountId, current) {
  const prior = data.getActivities()
    .filter((row) => row.accountId === accountId && row.id !== current.id)
    .slice(0, 3)
    .map((row) => ({ id: row.id, desc: row.desc, amountMinor: row.amountMinor, kind: row.kind, date: row.date, time: row.time }));
  return [current, ...prior];
}

export function buildConfirmationDebugPreview(data, variant = 'expense') {
  const savings = data.getAccount('sv-mbb');
  const wallet = data.getAccount('ew-tng');
  const boost = data.getAccount('ew-boost');
  const grabPay = data.getAccount('ew-grab');
  const credit = data.getAccount('cc-mbb-visa');
  const transactionId = `debug-confirmation-${variant}`;
  const base = {
    operation: 'create', kind: 'expense', accountEffect: 'posted', transactionId,
    amountMinor: 1000, description: '餐饮', accountChanges: [accountChange(savings, -1000)],
  };

  if (variant === 'income') Object.assign(base, {
    kind: 'income', description: '薪资', accountChanges: [accountChange(boost, 1000)],
  });
  if (variant === 'credit') Object.assign(base, {
    description: 'Maybank Visa 消费', accountChanges: [accountChange(credit, 1000)],
  });
  if (variant === 'hsbc') {
    const hsbc = {
      id: 'debug-hsbc-card', type: 'cc', name: '测试卡', displayName: '测试卡',
      bank: 'HSBC Malaysia', institution: 'HSBC Malaysia', brandId: 'hsbc',
      creditCardLast4: '1111', last4: '1111', tier: 'Platinum', networkId: 'mastercard',
      cardPalette: { primary: '#b21f2d', supporting: '#5d1019' }, limit: 6000,
      outstanding: 320, totalCardDebt: 320, totalCardDebtMinor: 32000,
    };
    Object.assign(base, { description: '测试卡消费', accountChanges: [accountChange(hsbc, 1000)] });
  }
  if (variant === 'custom-card') {
    const custom = {
      id: 'debug-custom-card', type: 'cc', name: '自定义卡面', bank: '我的卡片',
      outstanding: 260, totalCardDebt: 260, totalCardDebtMinor: 26000,
      customCardImage: {
        fileName: 'custom-card.png', mimeType: 'image/png', sizeBytes: 1943,
        dataUrl: '/assets/brands/official/hsbc.png', width: 512, height: 512,
      },
    };
    Object.assign(base, { description: '自定义卡面消费', accountChanges: [accountChange(custom, 1000)] });
  }
  if (variant === 'ewallet') Object.assign(base, {
    description: 'Touch n Go 充值', accountChanges: [accountChange(wallet, -1000)],
  });
  if (variant === 'grabpay') Object.assign(base, {
    description: 'GrabPay 消费', accountChanges: [accountChange(grabPay, -1000)],
  });
  if (variant === 'transfer') Object.assign(base, {
    kind: 'transfer', description: '资金调配', accountChanges: [accountChange(savings, -1000), accountChange(wallet, 1000)],
  });
  if (variant === 'record') Object.assign(base, {
    description: '只记录餐饮', accountEffect: 'record_only', accountChanges: [accountChange(savings, 0)],
  });
  if (variant === 'otherpayer') Object.assign(base, {
    description: '日本旅行晚餐', accountEffect: 'relationship_only', accountChanges: [accountChange(savings, 0)],
    relationship: { entryType: 'split_expense', payerName: 'Jason', currentUserShareMinor: 500, afterMinor: 500, ledgerTitle: '日本旅行 2026' },
  });
  if (variant === 'userpaid') Object.assign(base, {
    description: '女朋友晚餐 AA',
    relationship: { entryType: 'split_expense', payerName: '我', currentUserShareMinor: 500, afterMinor: 5000, ledgerTitle: '女朋友' },
  });
  if (variant === 'directdebt') Object.assign(base, {
    description: 'Abi 代付', accountEffect: 'relationship_only', accountChanges: [accountChange(savings, 0)],
    relationship: { entryType: 'direct_payable', payerName: 'Abi', currentUserShareMinor: 5000, afterMinor: 5000, ledgerTitle: 'Abi 账本' },
  });
  if (variant === 'received') Object.assign(base, {
    kind: 'settlement', description: '收到 Jason 还款', accountChanges: [accountChange(wallet, 1000)],
    relationship: { entryType: 'settlement_received', payerName: 'Jason', afterMinor: 2400, ledgerTitle: 'Jason 账本' },
  });
  if (variant === 'repayment') Object.assign(base, {
    kind: 'settlement', description: '还款给 Jason', accountChanges: [accountChange(savings, -1000)],
    relationship: { entryType: 'settlement_paid', payerName: '我', afterMinor: 2200, ledgerTitle: 'Jason 账本' },
  });
  if (variant === 'monthly') Object.assign(base, {
    operation: 'payment', kind: 'expense', description: '姐姐每月账', amountMinor: 85000, accountChanges: [accountChange(savings, -85000)],
    plan: { title: '姐姐每月账', planType: 'recurring_monthly', afterPaidMinor: 85000, remainingMinor: 170000 },
  });
  if (variant === 'instalment') Object.assign(base, {
    operation: 'payment', kind: 'expense', description: 'Shopee 分期', amountMinor: 10000, accountChanges: [accountChange(savings, -10000)],
    plan: { title: 'Shopee 分期', planType: 'installment', afterPaidMinor: 20000, remainingMinor: 99000 },
  });

  const current = {
    id: transactionId,
    desc: base.description,
    amountMinor: base.amountMinor,
    kind: variant === 'received' || base.kind === 'income' ? 'income' : base.kind === 'transfer' ? 'transfer' : 'expense',
    date: data.today,
    time: '13:14',
  };
  base.recentRecords = recentRecords(data, base.accountChanges[0]?.accountId, current);
  return base;
}
