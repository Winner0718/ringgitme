// Session-only custom institution directory. The application has no durable
// persistence layer yet, so this deliberately lives in memory and never
// writes to browser persistence, a network service, or financial state.

const records = new Map();
let sequence = 0;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const slug = (value) => String(value || 'institution').normalize('NFKD').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'institution';

function normalizeType(value) {
  if (value === 'ew' || value === 'ewallet') return 'ewallet';
  return 'bank';
}

function normalizedRecord(input, existing = null) {
  const now = new Date().toISOString();
  const entityType = normalizeType(input.entityType || existing?.entityType);
  const displayName = String(input.displayName ?? existing?.displayName ?? '').trim();
  const shortName = String(input.shortName ?? existing?.shortName ?? displayName).trim() || displayName;
  const notes = String(input.notes ?? existing?.notes ?? '').trim();
  if (!displayName) throw new Error(entityType === 'ewallet' ? '请输入电子钱包名称' : '请输入银行名称');
  const id = existing?.id || `custom-${entityType}-${slug(displayName)}-${++sequence}`;
  const requested = input.logoPresentationMode || existing?.logoPresentationMode || 'auto';
  const resolved = input.resolvedLogoPresentation || existing?.resolvedLogoPresentation || 'symbol_contained';
  return {
    id,
    institutionId: id,
    entityType,
    legalName: displayName,
    displayName,
    shortName,
    aliases: [],
    country: 'MY',
    market: 'Malaysia',
    officialWebsite: null,
    // Archived entries remain resolvable by existing accounts but are omitted
    // from future picker choices. This stays session-only: no persistence.
    status: (input.status ?? existing?.status) === 'archived' ? 'archived' : 'custom',
    logoPresentationMode: ['auto', 'fill', 'contain'].includes(requested) ? requested : 'auto',
    resolvedLogoPresentation: ['icon_full_bleed', 'symbol_contained', 'wordmark_contained'].includes(resolved) ? resolved : 'symbol_contained',
    customLogo: clone(input.customLogo !== undefined ? input.customLogo : existing?.customLogo) || null,
    palette: clone(input.palette !== undefined ? input.palette : existing?.palette) || null,
    notes,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    provenance: {
      sourceUrl: null,
      sourceTitle: 'User-created custom institution',
      verifiedAt: now.slice(0, 10),
      sourceType: 'user-custom',
      notes: 'Session-only custom institution; not an official or verified brand record.',
    },
  };
}

export function createCustomInstitution(input = {}) {
  const record = normalizedRecord(input);
  records.set(record.id, record);
  return clone(record);
}

export function updateCustomInstitution(id, changes = {}) {
  const existing = records.get(id);
  if (!existing) throw new Error('找不到自定义机构');
  const record = normalizedRecord({ ...existing, ...changes }, existing);
  records.set(id, record);
  return clone(record);
}

export function getCustomInstitution(id) { return clone(records.get(id) || null); }

export function listCustomInstitutions({ entityTypes = null, includeArchived = false } = {}) {
  const allowed = entityTypes ? new Set(Array.isArray(entityTypes) ? entityTypes.map(normalizeType) : [normalizeType(entityTypes)]) : null;
  return [...records.values()].filter((record) => (!allowed || allowed.has(record.entityType)) && (includeArchived || record.status !== 'archived'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
}

export function countCustomInstitutionUsage(id, accounts = []) {
  return (accounts || []).filter((account) => (account.brandId || account.catalogInstitutionId) === id).length;
}

export function deleteCustomInstitution(id, { accounts = [] } = {}) {
  const usageCount = countCustomInstitutionUsage(id, accounts);
  if (usageCount) throw new Error(`仍有 ${usageCount} 个账户使用此机构，请先重新指定机构`);
  return records.delete(id);
}

export function archiveCustomInstitution(id, { accounts = [] } = {}) {
  const existing = records.get(id);
  if (!existing) throw new Error('找不到自定义机构');
  const usageCount = countCustomInstitutionUsage(id, accounts);
  const record = normalizedRecord({ ...existing, status: 'archived' }, existing);
  records.set(id, record);
  return { ...clone(record), usageCount };
}

export function restoreCustomInstitution(id) {
  const existing = records.get(id);
  if (!existing) throw new Error('找不到自定义机构');
  const record = normalizedRecord({ ...existing, status: 'custom' }, existing);
  records.set(id, record);
  return clone(record);
}

export function isCustomInstitutionId(id) { return records.has(id); }

export const customInstitutionDirectoryTestHooks = Object.freeze({
  reset() { records.clear(); sequence = 0; },
  snapshot() { return listCustomInstitutions(); },
  normalizeType,
});
