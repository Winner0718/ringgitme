export const DESIGN_SYSTEM_VERSION = '2D1A.3-liquid-chrome-ios';
export const LIQUID_CHROME_MATERIAL_VERSION = '2D1A.4-liquid-chrome-glass';
export const APP_SHEET_CONTRACT_VERSION = '2D1A.5-ios-bottom-sheet-detents';

export const DESIGN_SYSTEM_CONTRACT = Object.freeze({
  tokenSource: 'src/styles/tokens.css',
  componentStyleSource: 'src/styles/design-system.css',
  documentation: 'docs/RINGGITME_LIQUID_CHROME_IOS_DESIGN_CONTRACT.md',
  labQuery: '?designSystem=1',
  glassRecipes: Object.freeze(['chrome', 'sheet', 'compact']),
  liquidChromeRecipes: Object.freeze(['canvas', 'floating', 'content', 'control', 'overlay']),
  chromeEdgeRecipes: Object.freeze(['static', 'priority-orbit', 'interaction-sweep']),
  sheetDetents: Object.freeze(['compact', 'medium', 'large', 'content']),
  sheetGeometry: Object.freeze({ anchor: 'bottom', viewport: 'VisualViewport', scrollOwner: 'sheet-body', safeAreaOwner: 'sheet-action-dock' }),
  chromeMotionPreference: Object.freeze({ owner: 'ui.chromeMotion', rootAttribute: 'data-chrome-motion', values: ['on', 'off'], default: true, persistence: 'session-only', reducedMotionOverride: true }),
  liquidChromeMotionBudget: Object.freeze({ ambientScope: 'visible-chrome-surfaces', deterministicStagger: true, temporarySweeps: 2, transactionRowsLoop: 0 }),
  interactionPalette: Object.freeze(['graphite', 'silver', 'pearl', 'ice']),
  semanticColourOnly: Object.freeze(['income', 'expense', 'receivable', 'payable', 'success', 'warning', 'information']),
  componentOwners: Object.freeze({
    button: 'src/design-system/DesignSystem.js',
    iconButton: 'src/design-system/DesignSystem.js',
    topBar: 'src/app/shell.js',
    bottomNavigation: 'src/components/GlassTabBar.js',
    surface: 'src/design-system/DesignSystem.js',
    sheet: 'src/components/AppSheet.js',
    sheetFooter: 'src/components/SheetActionDock.js',
    assetSheetFooter: 'src/features/assets/AssetSheetFooter.js',
    dialog: 'src/design-system/DesignSystem.js',
    overflowMenu: 'src/design-system/DesignSystem.js',
    field: 'src/design-system/DesignSystem.js',
    moneyInput: 'src/components/MoneyCalculatorSheet.js',
    pickerField: 'src/components/PickerSheet.js',
    dateTimeField: 'src/components/NativeDateTimeFields.js',
    toggleRow: 'src/design-system/DesignSystem.js',
    chip: 'src/design-system/DesignSystem.js',
    segmentedControl: 'src/design-system/DesignSystem.js',
    actionTile: 'src/design-system/DesignSystem.js',
    listRow: 'src/design-system/DesignSystem.js',
    financialSummaryRow: 'src/design-system/DesignSystem.js',
    calculator: 'src/components/MoneyCalculatorSheet.js',
    toast: 'src/components/AppSheet.js',
    emptyState: 'src/design-system/DesignSystem.js',
    loadingState: 'src/design-system/DesignSystem.js',
    errorState: 'src/design-system/DesignSystem.js',
    dragHandle: 'src/design-system/DesignSystem.js',
  }),
  forbiddenOneOffs: Object.freeze([
    'page-specific primary-button systems',
    'page-specific sheet footers',
    'duplicate calculator roots',
    'local modal or backdrop frameworks',
    'arbitrary backdrop-filter values',
    'arbitrary box-shadow values',
    'arbitrary colour, radius, shadow or blur values',
    'decorative teal or green interaction surfaces',
    'green primary buttons, selected tabs, capture buttons or calculator equals keys',
    'page-specific Sheet height or top-attachment rules',
  ]),
});

export function validateDesignSystemContract(contract = DESIGN_SYSTEM_CONTRACT) {
  const owners = Object.values(contract.componentOwners || {});
  return Boolean(contract.tokenSource && contract.componentStyleSource && contract.documentation
    && new Set(owners).size >= 8 && contract.glassRecipes.length === 3
    && contract.sheetDetents.length === 4 && contract.chromeMotionPreference.rootAttribute === 'data-chrome-motion');
}
