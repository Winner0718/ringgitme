// Static enforcement exceptions are finite, reviewed compatibility boundaries.
// New feature work must not add files here merely to bypass the canonical system.
export const DESIGN_SYSTEM_STATIC_ALLOWLIST = Object.freeze({
  canonicalOwners: [
    'src/styles/tokens.css',
    'src/styles/design-system.css',
    'src/design-system/designSystemContract.js',
    'src/design-system/designSystemAllowlist.js',
  ],
  legacyCompatibilityStyles: [
    { pattern: 'src/styles/phase2*.css', reason: 'Pre-2D1A.2 reachable selectors are presentation callers overridden by design-system.css while their product layout contracts remain intact.' },
    { pattern: 'src/styles/assets.css', reason: 'Accepted physical-card and asset-stack geometry is protected product artwork/layout.' },
    { pattern: 'src/styles/category-habits.css', reason: 'Category semantic colours are an approved exception.' },
    { pattern: 'src/styles/money-engine.css', reason: 'Legacy amount motion geometry is retained; colour and surface ownership is canonical.' },
  ],
  artworkExceptions: [
    { pattern: 'src/components/AccountVisualCard.js', reason: 'Temporary demo card-art colours; official brand assets are explicitly out of scope.' },
    { pattern: 'src/fixtures/demoData.js', reason: 'Fixture category and temporary product-art colour metadata.' },
  ],
});

export function validateDesignSystemAllowlist(value = DESIGN_SYSTEM_STATIC_ALLOWLIST) {
  const rows = [...value.legacyCompatibilityStyles, ...value.artworkExceptions];
  return value.canonicalOwners.length === new Set(value.canonicalOwners).size
    && rows.every((row) => row.pattern && row.reason.length >= 20);
}
