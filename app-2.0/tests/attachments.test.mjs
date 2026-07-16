import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachmentStore, attachmentKind, DEFAULT_MAX_ATTACHMENTS } from '../src/domain/attachmentRepository.js';
import { createDemoDataSource } from '../src/fixtures/demoData.js';

const file = (name, mimeType, overrides = {}) => ({
  ownerEntityType: 'draft', ownerEntityId: 'draft-1', name, mimeType, sizeBytes: 2048,
  localObjectUrl: `blob:demo/${name}`, clientEventId: `att-${name}-${Math.random()}`, ...overrides,
});

test('CA: multiple image attachments keep stable ids and order', () => {
  const store = createAttachmentStore({ revokeUrl: () => {} });
  const a = store.add(file('receipt.jpg', 'image/jpeg'));
  const b = store.add(file('invoice.png', 'image/png'));
  const c = store.add(file('warranty.jpg', 'image/jpeg'));
  const list = store.listFor('draft', 'draft-1');
  assert.deepEqual(list.map((item) => item.attachmentId), [a.attachmentId, b.attachmentId, c.attachmentId]);
  assert.deepEqual(list.map((item) => item.sortOrder), [0, 1, 2]);
  assert.equal(store.countFor('draft', 'draft-1'), 3);
});

test('CB: mixed image/PDF/generic files classify kinds and thumbnails', () => {
  const store = createAttachmentStore({ revokeUrl: () => {} });
  const image = store.add(file('photo.jpg', 'image/jpeg'));
  const pdf = store.add(file('order.pdf', 'application/pdf'));
  const generic = store.add(file('warranty.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  assert.equal(image.kind, 'photo'); assert.equal(image.thumbnail.kind, 'image');
  assert.equal(pdf.kind, 'pdf'); assert.equal(pdf.thumbnail.label, 'PDF');
  assert.equal(generic.kind, 'file'); assert.equal(generic.thumbnail.kind, 'tile');
  assert.equal(attachmentKind('image/webp'), 'photo');
});

test('CC: removing one attachment resequences without touching others', () => {
  const revoked = [];
  const store = createAttachmentStore({ revokeUrl: (url) => revoked.push(url) });
  const a = store.add(file('a.jpg', 'image/jpeg'));
  const b = store.add(file('b.pdf', 'application/pdf'));
  const c = store.add(file('c.jpg', 'image/jpeg'));
  assert.equal(store.remove(b.attachmentId), true);
  assert.deepEqual(revoked, ['blob:demo/b.pdf']);
  const list = store.listFor('draft', 'draft-1');
  assert.deepEqual(list.map((item) => item.attachmentId), [a.attachmentId, c.attachmentId]);
  assert.deepEqual(list.map((item) => item.sortOrder), [0, 1]);
});

test('CD: replace swaps content, revokes the old URL, and keeps position', () => {
  const revoked = [];
  const store = createAttachmentStore({ revokeUrl: (url) => revoked.push(url) });
  const a = store.add(file('a.jpg', 'image/jpeg'));
  store.add(file('b.jpg', 'image/jpeg'));
  const replaced = store.replace(a.attachmentId, { name: 'better.pdf', mimeType: 'application/pdf', sizeBytes: 900, localObjectUrl: 'blob:demo/better.pdf' }, 'replace-1');
  assert.equal(replaced.attachmentId, a.attachmentId);
  assert.equal(replaced.sortOrder, 0);
  assert.equal(replaced.kind, 'pdf');
  assert.deepEqual(revoked, ['blob:demo/a.jpg']);
});

test('CE: reorder validates the id set and applies the exact order', () => {
  const store = createAttachmentStore({ revokeUrl: () => {} });
  const a = store.add(file('a.jpg', 'image/jpeg'));
  const b = store.add(file('b.jpg', 'image/jpeg'));
  const c = store.add(file('c.jpg', 'image/jpeg'));
  const ordered = store.reorder('draft', 'draft-1', [c.attachmentId, a.attachmentId, b.attachmentId]);
  assert.deepEqual(ordered.map((item) => item.attachmentId), [c.attachmentId, a.attachmentId, b.attachmentId]);
  assert.throws(() => store.reorder('draft', 'draft-1', [a.attachmentId, a.attachmentId, b.attachmentId]), /排序无效/);
  assert.throws(() => store.reorder('draft', 'draft-1', [a.attachmentId]), /排序无效/);
});

test('CF: duplicate clientEventId never duplicates an attachment', () => {
  const store = createAttachmentStore({ revokeUrl: () => {} });
  const input = file('a.jpg', 'image/jpeg', { clientEventId: 'stable-add' });
  const first = store.add(input);
  const second = store.add(input);
  assert.equal(second.attachmentId, first.attachmentId);
  assert.equal(store.countFor('draft', 'draft-1'), 1);
});

test('CG: per-owner maximum is configurable, not a hardcoded single slot', () => {
  const store = createAttachmentStore({ maxPerOwner: 2, revokeUrl: () => {} });
  store.add(file('a.jpg', 'image/jpeg'));
  store.add(file('b.jpg', 'image/jpeg'));
  assert.throws(() => store.add(file('c.jpg', 'image/jpeg')), /最多/);
  assert.equal(DEFAULT_MAX_ATTACHMENTS > 1, true);
});

test('CH: long filenames keep full metadata for the manager view', () => {
  const store = createAttachmentStore({ revokeUrl: () => {} });
  const longName = `${'非常长的发票文件名'.repeat(6)}.pdf`;
  const added = store.add(file(longName, 'application/pdf'));
  assert.equal(added.name, longName);
  assert.equal(added.thumbnail.label, 'PDF');
  assert.equal(added.sizeBytes, 2048);
});

test('CI: reset revokes session URLs and restores the seed state', () => {
  const revoked = [];
  const store = createAttachmentStore({ revokeUrl: (url) => revoked.push(url) });
  store.add(file('a.jpg', 'image/jpeg'));
  store.add(file('b.pdf', 'application/pdf'));
  store.reset();
  assert.equal(store.getSnapshot().length, 0);
  assert.deepEqual(revoked.sort(), ['blob:demo/a.jpg', 'blob:demo/b.pdf']);
});

test('CJ: transactions carry attachment collections through save, count and reset', () => {
  const data = createDemoDataSource();
  const draftId = 'capture-test-1';
  const a = data.addAttachment({ ownerEntityType: 'draft', ownerEntityId: draftId, name: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 100, localObjectUrl: '', clientEventId: 'cj-1' });
  const b = data.addAttachment({ ownerEntityType: 'draft', ownerEntityId: draftId, name: 'order.pdf', mimeType: 'application/pdf', sizeBytes: 100, localObjectUrl: '', clientEventId: 'cj-2' });
  const c = data.addAttachment({ ownerEntityType: 'draft', ownerEntityId: draftId, name: 'note.txt', mimeType: 'text/plain', sizeBytes: 100, localObjectUrl: '', clientEventId: 'cj-3' });
  const transaction = data.addTransaction({ kind: 'expense', amount: 12, catId: 'food', catLabel: '餐饮', sourceAccountId: 'sv-mbb', desc: '附件测试', date: '2026-07-13', time: '12:00', attachmentIds: [a.attachmentId, b.attachmentId, c.attachmentId] });
  data.assignAttachmentOwner('draft', draftId, 'transaction', transaction.id);
  assert.equal(data.getTransaction(transaction.id).attachmentCount, 3);
  assert.deepEqual(data.getTransactionAttachments(transaction.id).map((item) => item.name), ['receipt.jpg', 'order.pdf', 'note.txt']);
  data.removeAttachment(b.attachmentId);
  data.setTransactionAttachments(transaction.id, [a.attachmentId, c.attachmentId]);
  assert.equal(data.getTransaction(transaction.id).attachmentCount, 2);
  const events = data.getIntegrationOutbox();
  assert.equal(events.some((event) => event.eventType === 'attachment.added'), true);
  assert.equal(events.some((event) => event.eventType === 'attachment.removed'), true);
  data.resetDemoData();
  assert.equal(data.getAttachments('transaction', transaction.id).length, 0);
});

test('CK: relationship entries and settlements accept attachment collections', () => {
  const data = createDemoDataSource();
  const a = data.addAttachment({ ownerEntityType: 'draft', ownerEntityId: 'rel-draft', name: 'proof.jpg', mimeType: 'image/jpeg', sizeBytes: 10, localObjectUrl: '', clientEventId: 'ck-1' });
  const result = data.recordRelationshipEntry({ ledgerId: 'ledger-abi', entryType: 'direct_receivable', participantId: 'participant-abi', payerParticipantId: 'participant-me', amount: 30, description: '附件关系账', sourceAccountId: 'sv-mbb', date: '2026-07-13', time: '10:00', sourceChannel: 'app', clientEventId: 'ck-entry', attachmentIds: [a.attachmentId] });
  data.assignAttachmentOwner('draft', 'rel-draft', 'transaction', result.transaction.id);
  assert.deepEqual(result.entry.attachmentIds, [a.attachmentId]);
  assert.equal(data.getTransaction(result.transaction.id).attachmentCount, 1);
  const settle = data.settleRelationship({ ledgerId: 'ledger-abi', direction: 'received', amount: 10, destinationAccountId: 'ew-tng', date: '2026-07-13', time: '10:30', sourceChannel: 'app', clientEventId: 'ck-settle', attachmentIds: [] });
  assert.deepEqual(settle.settlement.attachmentIds, []);
});

test('CL: attachment reorder emits one canonical idempotent outbox event', () => {
  const data = createDemoDataSource();
  const a = data.addAttachment({ ownerEntityType: 'draft', ownerEntityId: 'cl-draft', name: 'a.jpg', mimeType: 'image/jpeg', clientEventId: 'cl-a' });
  const b = data.addAttachment({ ownerEntityType: 'draft', ownerEntityId: 'cl-draft', name: 'b.pdf', mimeType: 'application/pdf', clientEventId: 'cl-b' });
  const order = [b.attachmentId, a.attachmentId];
  data.reorderAttachments('draft', 'cl-draft', order, 'cl-reorder');
  data.reorderAttachments('draft', 'cl-draft', order, 'cl-reorder');
  assert.deepEqual(data.getAttachments('draft', 'cl-draft').map((item) => item.attachmentId), order);
  assert.equal(data.getIntegrationOutbox().filter((event) => event.eventType === 'attachment.reordered' && event.payload.ownerEntityId === 'cl-draft').length, 1);
});

test('CM: demo reset restores the three mixed attachment evidence set', () => {
  const data = createDemoDataSource();
  const initial = data.getTransactionAttachments('t-0');
  assert.deepEqual(initial.map((item) => item.kind), ['photo', 'pdf', 'file']);
  assert.equal(initial.at(-1).name.length > 60, true);
  data.removeAttachment(initial[1].attachmentId, 'cm-remove');
  assert.equal(data.getTransaction('t-0').attachmentCount, 2);
  data.resetDemoData();
  assert.deepEqual(data.getTransactionAttachments('t-0').map((item) => item.attachmentId), initial.map((item) => item.attachmentId));
  assert.equal(data.getTransaction('t-0').attachmentCount, 3);
});
