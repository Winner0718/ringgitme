// In-memory attachment collection store. Attachments are session-local only:
// object URLs / data URLs live for the browsing session and are revoked when
// an item is removed, replaced or the store resets. Owner entities reference
// attachments by id; the store is the single authority for order and metadata.

export const DEFAULT_MAX_ATTACHMENTS = 6;

function defaultRevoke(url) {
  if (url && url.startsWith('blob:') && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url);
}

export function attachmentKind(mimeType) {
  const type = String(mimeType || '');
  if (type.startsWith('image/')) return 'photo';
  if (type === 'application/pdf') return 'pdf';
  return 'file';
}

export function sanitizeAttachmentName(currentName, requestedName) {
  const current = String(currentName || '附件').trim();
  const extensionIndex = current.lastIndexOf('.');
  const extension = extensionIndex > 0 ? current.slice(extensionIndex) : '';
  let base = String(requestedName || '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  if (extension && base.toLowerCase().endsWith(extension.toLowerCase())) base = base.slice(0, -extension.length).trim().replace(/[. ]+$/g, '');
  else if (extension && /\.[a-z0-9]{1,10}$/i.test(base)) base = base.slice(0, base.lastIndexOf('.')).trim().replace(/[. ]+$/g, '');
  if (!base) throw new Error('附件名称不能为空');
  const maximumBase = Math.max(1, 120 - extension.length);
  return `${base.slice(0, maximumBase).trim()}${extension}`;
}

export function createAttachmentStore({ maxPerOwner = DEFAULT_MAX_ATTACHMENTS, revokeUrl = defaultRevoke, initialAttachments = [] } = {}) {
  const seed = structuredClone(initialAttachments);
  let items = structuredClone(seed);
  let sequence = items.length;
  const byClientEvent = new Map(items.filter((item) => item.clientEventId).map((item) => [item.clientEventId, item]));
  const now = () => new Date().toISOString();

  const ownerKey = (type, id) => `${type}:${id}`;
  const listRaw = (type, id) => items.filter((item) => item.ownerEntityType === type && item.ownerEntityId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const resequence = (type, id) => listRaw(type, id).forEach((item, index) => { item.sortOrder = index; });
  const find = (id) => items.find((item) => item.attachmentId === id);

  function normalize(input) {
    const name = String(input.name || '附件').trim() || '附件';
    const mimeType = String(input.mimeType || input.type || 'application/octet-stream');
    return {
      name,
      mimeType,
      kind: attachmentKind(mimeType),
      sizeBytes: Number(input.sizeBytes ?? input.size ?? 0),
      localObjectUrl: String(input.localObjectUrl || input.dataUrl || ''),
      thumbnail: attachmentKind(mimeType) === 'photo' ? { kind: 'image', url: String(input.localObjectUrl || input.dataUrl || '') } : { kind: 'tile', label: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase().slice(0, 4) : 'FILE' },
      source: input.source || 'app',
    };
  }

  return {
    maxPerOwner,
    add(input) {
      if (!input.clientEventId) throw new Error('缺少客户端事件 ID');
      if (byClientEvent.has(input.clientEventId)) return structuredClone(byClientEvent.get(input.clientEventId));
      const { ownerEntityType, ownerEntityId } = input;
      if (!ownerEntityType || !ownerEntityId) throw new Error('附件缺少归属实体');
      const existing = listRaw(ownerEntityType, ownerEntityId);
      if (existing.length >= maxPerOwner) throw new Error(`最多只能添加 ${maxPerOwner} 个附件`);
      const created = {
        ...normalize(input),
        attachmentId: `att-${String(++sequence).padStart(4, '0')}`,
        ownerEntityType,
        ownerEntityId,
        sortOrder: existing.length,
        clientEventId: input.clientEventId,
        createdAt: now(),
        updatedAt: now(),
      };
      items.push(created);
      byClientEvent.set(created.clientEventId, created);
      return structuredClone(created);
    },
    remove(attachmentId) {
      const item = find(attachmentId);
      if (!item) return false;
      revokeUrl(item.localObjectUrl);
      items = items.filter((candidate) => candidate.attachmentId !== attachmentId);
      if (item.clientEventId) byClientEvent.delete(item.clientEventId);
      resequence(item.ownerEntityType, item.ownerEntityId);
      return true;
    },
    replace(attachmentId, input, clientEventId) {
      const item = find(attachmentId);
      if (!item) throw new Error('附件不存在');
      if (clientEventId && byClientEvent.has(clientEventId)) return structuredClone(byClientEvent.get(clientEventId));
      revokeUrl(item.localObjectUrl);
      Object.assign(item, normalize(input), { updatedAt: now() });
      if (clientEventId) { item.clientEventId = clientEventId; byClientEvent.set(clientEventId, item); }
      return structuredClone(item);
    },
    rename(attachmentId, requestedName) {
      const item = find(attachmentId);
      if (!item) throw new Error('附件不存在');
      item.name = sanitizeAttachmentName(item.name, requestedName);
      item.updatedAt = now();
      if (item.kind !== 'photo') item.thumbnail = { kind: 'tile', label: item.name.includes('.') ? item.name.slice(item.name.lastIndexOf('.') + 1).toUpperCase().slice(0, 4) : 'FILE' };
      return structuredClone(item);
    },
    reorder(ownerEntityType, ownerEntityId, orderedIds) {
      const existing = listRaw(ownerEntityType, ownerEntityId);
      const currentIds = existing.map((item) => item.attachmentId);
      if (orderedIds.length !== currentIds.length || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => currentIds.includes(id))) throw new Error('附件排序无效');
      orderedIds.forEach((id, index) => { find(id).sortOrder = index; });
      return this.listFor(ownerEntityType, ownerEntityId);
    },
    assignOwner(fromType, fromId, toType, toId) {
      const moved = listRaw(fromType, fromId);
      const offset = listRaw(toType, toId).length;
      moved.forEach((item, index) => Object.assign(item, { ownerEntityType: toType, ownerEntityId: toId, sortOrder: offset + index, updatedAt: now() }));
      return moved.map((item) => item.attachmentId);
    },
    removeFor(ownerEntityType, ownerEntityId) {
      listRaw(ownerEntityType, ownerEntityId).forEach((item) => this.remove(item.attachmentId));
    },
    get: (attachmentId) => structuredClone(find(attachmentId) || null),
    getMany: (ids = []) => ids.map((id) => structuredClone(find(id) || null)).filter(Boolean),
    listFor: (ownerEntityType, ownerEntityId) => structuredClone(listRaw(ownerEntityType, ownerEntityId)),
    countFor: (ownerEntityType, ownerEntityId) => listRaw(ownerEntityType, ownerEntityId).length,
    getSnapshot: () => structuredClone(items),
    reset() {
      items.filter((item) => !seed.some((seeded) => seeded.attachmentId === item.attachmentId)).forEach((item) => revokeUrl(item.localObjectUrl));
      items = structuredClone(seed);
      sequence = items.length;
      byClientEvent.clear();
      items.forEach((item) => { if (item.clientEventId) byClientEvent.set(item.clientEventId, item); });
    },
  };
}
