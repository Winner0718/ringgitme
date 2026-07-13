// In-memory transaction-habit repository. Category IDs are stable; names,
// presentation, order and visibility are user preferences. Financial meaning
// remains owned by the transaction kind in moneyEngine.js.

export const CATEGORY_TYPES = ['expense', 'income', 'transfer'];
export const CATEGORY_THEME_TOKENS = ['green', 'mint', 'orange', 'blue', 'violet', 'rose', 'slate'];
export const CATEGORY_ICONS = [
  'food', 'car', 'cart', 'receipt', 'home', 'heart', 'ticket', 'salary',
  'gift', 'refund', 'interest', 'aa', 'savings', 'repayment', 'investment', 'note',
  'transfer', 'wallet', 'arrowDown',
];

const ICON_THEME = {
  food: 'orange', car: 'blue', cart: 'orange', receipt: 'rose', home: 'blue', heart: 'rose',
  ticket: 'violet', salary: 'green', gift: 'rose', refund: 'mint', interest: 'blue', aa: 'violet',
  savings: 'mint', repayment: 'orange', investment: 'green', note: 'slate', transfer: 'green',
  wallet: 'blue', arrowDown: 'violet',
};

export function automaticThemeToken(icon) {
  return ICON_THEME[icon] || 'slate';
}

const CREATED = '2026-07-13T00:00:00+08:00';

const definitions = {
  expense: [
    ['food', '餐饮', 'food', 'orange', true],
    ['transport', '交通', 'car', 'blue', true],
    ['grocery', '日用', 'cart', 'mint', true],
    ['fun', '娱乐', 'ticket', 'violet', true],
    ['bill', '账单', 'receipt', 'rose', true],
    ['shopping', '购物', 'cart', 'orange'],
    ['health', '医疗', 'heart', 'rose'],
    ['home', '住房', 'home', 'blue'],
    ['education', '教育', 'note', 'violet'],
    ['other-expense', '其他支出', 'note', 'slate'],
    ['expense-fallback', '未分类支出', 'note', 'slate', false, true],
  ],
  income: [
    ['income-salary', '薪资', 'salary', 'green', true],
    ['income-bonus', '奖金／佣金', 'gift', 'orange', true],
    ['income-refund', '退款', 'refund', 'mint', true],
    ['income-interest', '利息', 'interest', 'blue', true],
    ['income-aa', 'AA 回款', 'aa', 'violet', true],
    ['income-gift', '礼金', 'gift', 'rose'],
    ['income-side', '副业收入', 'salary', 'green'],
    ['other-income', '其他收入', 'note', 'slate'],
    ['income-fallback', '未分类收入', 'note', 'slate', false, true],
  ],
  transfer: [
    ['transfer-funds', '资金调配', 'transfer', 'green', true],
    ['transfer-savings', '储蓄', 'savings', 'mint', true],
    ['transfer-repayment', '还款', 'repayment', 'orange', true],
    ['transfer-topup', '充值', 'wallet', 'blue', true],
    ['transfer-withdrawal', '提现', 'arrowDown', 'violet'],
    ['transfer-investment', '投资转入', 'investment', 'green'],
    ['other-transfer', '其他转账', 'transfer', 'slate'],
    ['transfer-fallback', '普通转账', 'transfer', 'slate', false, true],
  ],
};

export const DEFAULT_CATEGORY_IDS = {
  expense: 'food',
  income: 'income-salary',
  transfer: null,
};

function buildDefaults() {
  return CATEGORY_TYPES.flatMap((transactionType) => definitions[transactionType].map((row, sortOrder) => ({
    id: row[0], transactionType, name: row[1], label: row[1], icon: row[2], themeToken: row[3],
    sortOrder, isPinned: Boolean(row[4]), isArchived: Boolean(row[5]),
    isSystemFallback: Boolean(row[5]), createdAt: CREATED, updatedAt: CREATED,
  })));
}

export const DEFAULT_CATEGORIES = buildDefaults();

function assertType(type) {
  if (!CATEGORY_TYPES.includes(type)) throw new Error('类别类型无效');
}

function cleanName(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('请输入类别名称');
  if (value.length > 12) throw new Error('类别名称最多 12 个字');
  return value;
}

export function createCategoryRepository() {
  let categories = structuredClone(DEFAULT_CATEGORIES);
  let defaults = structuredClone(DEFAULT_CATEGORY_IDS);
  let sequence = 0;

  const activeNameExists = (type, name, exceptId = null) => categories.some((item) =>
    item.transactionType === type && !item.isArchived && item.id !== exceptId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const normalizeOrder = (type) => {
    categories.filter((item) => item.transactionType === type)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((item, index) => { item.sortOrder = index; });
  };

  return {
    getSnapshot: () => ({ categories: structuredClone(categories), defaults: structuredClone(defaults) }),
    getCategory: (id) => categories.find((item) => item.id === id) || null,
    getCategories(type, { includeArchived = false, includeFallback = false } = {}) {
      assertType(type);
      return categories.filter((item) => item.transactionType === type)
        .filter((item) => includeArchived || !item.isArchived)
        .filter((item) => includeFallback || !item.isSystemFallback)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
    getQuickCategories(type) {
      const active = this.getCategories(type);
      const pinned = active.filter((item) => item.isPinned);
      return pinned.length ? pinned : active.slice(0, 5);
    },
    getDefaultId: (type) => defaults[type] ?? null,
    getDefault(type) {
      const selected = categories.find((item) => item.id === defaults[type] && !item.isArchived);
      return selected || this.getCategories(type)[0] || categories.find((item) => item.transactionType === type && item.isSystemFallback);
    },
    create(input) {
      assertType(input.transactionType);
      const name = cleanName(input.name);
      if (activeNameExists(input.transactionType, name)) throw new Error('同一类型已有这个类别');
      const now = new Date().toISOString();
      const selectedIcon = CATEGORY_ICONS.includes(input.icon) ? input.icon : 'note';
      const item = {
        id: `custom-${input.transactionType}-${Date.now().toString(36)}-${++sequence}`,
        transactionType: input.transactionType, name, label: name,
        icon: selectedIcon,
        // User-facing themes are deferred for a future curated icon/theme-pack system.
        themeToken: automaticThemeToken(selectedIcon),
        sortOrder: categories.filter((entry) => entry.transactionType === input.transactionType).length,
        isPinned: Boolean(input.isPinned), isArchived: false, isSystemFallback: false,
        createdAt: now, updatedAt: now,
      };
      categories.push(item);
      if (input.isDefault && input.transactionType !== 'transfer') defaults[input.transactionType] = item.id;
      return item;
    },
    update(id, changes) {
      const item = this.getCategory(id);
      if (!item) throw new Error('找不到这个类别');
      const name = Object.hasOwn(changes, 'name') ? cleanName(changes.name) : item.name;
      if (!item.isArchived && activeNameExists(item.transactionType, name, id)) throw new Error('同一类型已有这个类别');
      item.name = name;
      item.label = name;
      if (CATEGORY_ICONS.includes(changes.icon)) item.icon = changes.icon;
      if (CATEGORY_THEME_TOKENS.includes(changes.themeToken)) item.themeToken = changes.themeToken;
      if (Object.hasOwn(changes, 'isPinned')) item.isPinned = Boolean(changes.isPinned);
      if (changes.isDefault && item.transactionType !== 'transfer') defaults[item.transactionType] = item.id;
      item.updatedAt = new Date().toISOString();
      return item;
    },
    setDefault(type, id) {
      assertType(type);
      if (type === 'transfer') return null;
      const item = this.getCategory(id);
      if (!item || item.transactionType !== type || item.isArchived) throw new Error('默认类别必须处于显示状态');
      defaults[type] = id;
      return item;
    },
    move(id, direction) {
      const item = this.getCategory(id);
      if (!item) throw new Error('找不到这个类别');
      const list = this.getCategories(item.transactionType, { includeArchived: true, includeFallback: true });
      const index = list.findIndex((entry) => entry.id === id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= list.length) return item;
      [list[index].sortOrder, list[target].sortOrder] = [list[target].sortOrder, list[index].sortOrder];
      item.updatedAt = new Date().toISOString();
      normalizeOrder(item.transactionType);
      return item;
    },
    reorderActive(type, orderedIds) {
      assertType(type);
      const active = this.getCategories(type);
      const expected = active.map((item) => item.id);
      if (orderedIds.length !== expected.length || new Set(orderedIds).size !== expected.length || expected.some((id) => !orderedIds.includes(id))) {
        throw new Error('类别排序资料不完整');
      }
      const now = new Date().toISOString();
      orderedIds.forEach((id, index) => {
        const item = this.getCategory(id);
        item.sortOrder = index;
        item.updatedAt = now;
      });
      categories.filter((item) => item.transactionType === type && item.isArchived)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach((item, index) => { item.sortOrder = orderedIds.length + index; });
      return this.getCategories(type);
    },
    togglePin(id) {
      const item = this.getCategory(id);
      if (!item || item.isSystemFallback) throw new Error('这个类别不能设为常用');
      item.isPinned = !item.isPinned;
      item.updatedAt = new Date().toISOString();
      return item;
    },
    archive(id) {
      const item = this.getCategory(id);
      if (!item || item.isSystemFallback) throw new Error('保底类别不能隐藏');
      item.isArchived = true;
      item.isPinned = false;
      if (defaults[item.transactionType] === id) defaults[item.transactionType] = this.getCategories(item.transactionType).find((entry) => entry.id !== id)?.id || null;
      item.updatedAt = new Date().toISOString();
      return item;
    },
    restore(id) {
      const item = this.getCategory(id);
      if (!item) throw new Error('找不到这个类别');
      if (activeNameExists(item.transactionType, item.name, id)) throw new Error('先处理同名的显示类别');
      item.isArchived = false;
      item.updatedAt = new Date().toISOString();
      return item;
    },
    remove(id, isUsed = false) {
      const item = this.getCategory(id);
      if (!item || item.isSystemFallback) throw new Error('保底类别不能删除');
      if (isUsed) throw new Error('已使用的类别只能隐藏');
      categories = categories.filter((entry) => entry.id !== id);
      if (defaults[item.transactionType] === id) defaults[item.transactionType] = this.getCategories(item.transactionType)[0]?.id || null;
      normalizeOrder(item.transactionType);
    },
    resetType(type) {
      assertType(type);
      categories = categories.filter((item) => item.transactionType !== type)
        .concat(structuredClone(DEFAULT_CATEGORIES.filter((item) => item.transactionType === type)));
      defaults[type] = DEFAULT_CATEGORY_IDS[type];
    },
    resetAll() {
      categories = structuredClone(DEFAULT_CATEGORIES);
      defaults = structuredClone(DEFAULT_CATEGORY_IDS);
      sequence = 0;
    },
  };
}
