export function attachmentMetadata(file, dataUrl = '') {
  if (!file) throw new Error('请选择附件');
  return {
    kind: String(file.type || '').startsWith('image/') ? 'photo' : 'file',
    name: String(file.name || '附件'),
    type: String(file.type || 'application/octet-stream'),
    size: Number(file.size || 0),
    dataUrl: String(dataUrl || ''),
  };
}

export function attachmentSizeLabel(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
