const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

const THEMES = freeze([
  { id: 'pearl-chrome', displayName: '珍珠镀铬', englishName: 'Pearl Chrome', tone: 'light', pattern: 'pearl' },
  { id: 'obsidian-flow', displayName: '黑曜流光', englishName: 'Obsidian Flow', tone: 'dark', pattern: 'flow' },
  { id: 'midnight-blue', displayName: '午夜蓝', englishName: 'Midnight Blue', tone: 'dark', pattern: 'aurora' },
  { id: 'crimson-arc', displayName: '绯红弧线', englishName: 'Crimson Arc', tone: 'dark', pattern: 'arc' },
  { id: 'emerald-depth', displayName: '翡翠深海', englishName: 'Emerald Depth', tone: 'dark', pattern: 'depth' },
  { id: 'champagne-wave', displayName: '香槟波纹', englishName: 'Champagne Wave', tone: 'light', pattern: 'wave' },
  { id: 'violet-prism', displayName: '紫晶棱镜', englishName: 'Violet Prism', tone: 'dark', pattern: 'prism' },
  { id: 'graphite-grid', displayName: '石墨网格', englishName: 'Graphite Grid', tone: 'dark', pattern: 'grid' },
]);

const BY_ID = new Map(THEMES.map((item) => [item.id, item]));

export function cardThemeRegistry() { return THEMES.map(clone); }
export function getCardTheme(id) { return clone(BY_ID.get(id) || null); }
export function defaultCardThemeId(type) {
  if (type === 'cc') return 'obsidian-flow';
  if (type === 'ew') return 'midnight-blue';
  return 'pearl-chrome';
}
export function resolveCardThemeId(id, type = 'saving') { return BY_ID.has(id) ? id : defaultCardThemeId(type); }
export function validateCardThemeRegistry() {
  const errors = [];
  const ids = new Set();
  THEMES.forEach((theme) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme.id)) errors.push(`invalid-id:${theme.id}`);
    if (ids.has(theme.id)) errors.push(`duplicate-id:${theme.id}`);
    ids.add(theme.id);
    if (!['light', 'dark'].includes(theme.tone)) errors.push(`invalid-tone:${theme.id}`);
  });
  return { valid: errors.length === 0, errors, total: THEMES.length };
}

export const cardThemeRegistryTestHooks = freeze({ records: clone(THEMES) });
